import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AccountingOrigin, ChildBinding } from "../contracts";
import { facadeShape, realmAuthority } from "../realm-authority";
import { loadLedger } from "../core/budget";
import { accountingId, type AccountingStore } from "../state/accounting";
import { getOwnedRecord, identity, object, readLifetimeCost, readTerminalCost, managerKey,
  type PublicRecord, type ObservedSession } from "./registry";

export const observerEntryType = "jev:child-observer";
export interface ObserverEntry {
  version: 1; owner: string; origin: AccountingOrigin; accountingId: string;
  correlationToolCallId: string; generation: number; sdkSessionId?: string;
}
export interface ObserverOptions {
  /** Canonical project root + PUBLIC parent session ID, made with rootOwnerId. */
  owner: string;
  getOwner?: () => string;
  store: Pick<AccountingStore,"registerOrigin"|"observe"> & {readonly file?:string};
  eventBus: {on(channel:string, callback:(payload:unknown)=>void):()=>void};
  getRegistry?: () => unknown;
  appendEntry: (type: string, entry: ObserverEntry) => void | Promise<void>;
  warn?: (code:string)=>void | Promise<void>;
  now?: () => Date;
}
interface Call { id:string; resume?:string }
interface Binding {
  origin:AccountingOrigin; record:PublicRecord; callId:string; generation:number;
  epoch:number; session?:ObservedSession; off?:()=>void; id?:string;
  registered:boolean; entryPersisted:boolean; suspended:boolean; reasons:Set<string>;
}
// Sealed package-owned protocols. Collection/evidence references never escape.
// All versions use these canonical keys; incompatible live state is NOT upgraded.
interface SdkEvidence {
 readonly protocol:"pi-jev-observer-sdk";readonly version:1;
 matches(record:PublicRecord,session:ObservedSession|undefined):boolean;
 remember(record:PublicRecord,session:ObservedSession):boolean;
}
const knownSdkLifetimes=realmAuthority(Symbol.for("pi-jev-subagent-router:observer-sdk-lifetimes:v1"),
 (value:unknown):value is SdkEvidence=>facadeShape(value,"pi-jev-observer-sdk",1,["matches","remember"]),()=>{
  const lifetimes=new WeakMap<PublicRecord,ObservedSession>();
  const matches=(record:PublicRecord,session:ObservedSession|undefined)=>!lifetimes.has(record) || lifetimes.get(record)===session;
  return Object.freeze({protocol:"pi-jev-observer-sdk",version:1,matches,
   remember(record:PublicRecord,session:ObservedSession):boolean {
    if(!matches(record,session))return false;
    lifetimes.set(record,session);return true;
   }});
 });
interface OriginLifetime {record:WeakRef<PublicRecord>;session:WeakRef<ObservedSession>}
interface OriginEvidence {
 readonly protocol:"pi-jev-observer-origin";readonly version:1;
 matches(key:string,record:PublicRecord,session:ObservedSession|undefined):boolean;
 remember(key:string,record:PublicRecord,session:ObservedSession):boolean;
}
const originMemory=realmAuthority(Symbol.for("pi-jev-subagent-router:observer-origin-lifetimes:v1"),
 (value:unknown):value is OriginEvidence=>facadeShape(value,"pi-jev-observer-origin",1,["matches","remember"]),()=>{
  const lifetimes=new Map<string,OriginLifetime>();
  const cleanup=new FinalizationRegistry<{key:string;evidence:OriginLifetime}>(({key,evidence})=>{
   // An old finalizer cannot remove later verified evidence.
   if(lifetimes.get(key)===evidence)lifetimes.delete(key);
  });
  const matches=(key:string,record:PublicRecord,session:ObservedSession|undefined)=>{
   const evidence=lifetimes.get(key);
   return !evidence || (evidence.record.deref()===record && evidence.session.deref()===session);
  };
  return Object.freeze({protocol:"pi-jev-observer-origin",version:1,matches,
   remember(key:string,record:PublicRecord,session:ObservedSession):boolean {
    if(!matches(key,record,session))return false;
    if(!lifetimes.has(key)){
     const evidence={record:new WeakRef(record),session:new WeakRef(session)};
     lifetimes.set(key,evidence);cleanup.register(session,{key,evidence});
    }
    return true;
   }});
 });
const baseReasons=["aggregate-loses-missing-cost","descendant-coverage-unknown","observation-gap"];
const key=(o:AccountingOrigin)=>JSON.stringify([o.backend,o.rootOwnerId,o.spawnToolCallId,o.childId]);
function nativeCall(event:unknown):Call|undefined {
  if(!object(event) || event.toolName!=="Agent" || event.parentToolCallId!==undefined ||
      !identity(event.toolCallId) || !object(event.input))return;
  const p=event.input;
  if(!identity(p.subagent_type) || typeof p.prompt!=="string" || typeof p.description!=="string" ||
      (p.resume!==undefined && p.resume!=="" && !identity(p.resume)) ||
      (p.schedule!==undefined && p.schedule!=="") || p.workflow!==undefined)return;
  // The native handler tests resume/schedule truthiness; empty schema-valid
  // strings still execute the immediate NEW spawn branch.
  return {id:event.toolCallId,...(p.resume?{resume:p.resume}:{})};
}
/** Event-driven accounting only. Host seams must be the current schema-validated
 * native Agent tool_call / tool_execution_update / tool_result events, not RPC,
 * schedules, mentions or classifier decisions. Native execution is never awaited. */
export class ChildObserver {
  status:"observing"|"unknown-attribution"|"degraded"|"disposed"="observing";
  private disposed=false;
  private calls=new Map<string,Call>();
  private pending=new Set<string>();
  private bindings=new Map<string,Binding>();
  private queues=new Map<string,Promise<void>>();
  private busOff:(()=>void)[]=[];
  constructor(private readonly options:ObserverOptions) {
    if(!identity(options.owner))throw Error("invalid-observer-owner");
    if(!knownSdkLifetimes || !originMemory){this.status="unknown-attribution";return;}
    for(const channel of ["subagents:started","subagents:completed","subagents:failed","subagents:compacted"]) {
      try {
        const off=options.eventBus.on(channel,payload=>this.safe(()=>this.lifecycle(channel,payload)));
        if(typeof off!=="function")throw Error("invalid-unsubscriber");
        if(!this.alive()){this.release(off,"bus-unsubscribe-failed");break;}
        this.busOff.push(off);
      } catch {this.warning("bus-subscribe-failed");this.dispose();break;}
    }
  }
  get pendingCount(){return this.pending.size;}
  /** Read-only composition seam. Only an acknowledged, live native correlation
   * can authorize commands; persisted associations/global records alone cannot. */
  getBinding(child:string):ChildBinding|undefined {
    try {
      const b=this.bindings.get(child),epoch=b?.epoch;
      if(!b || epoch===undefined || !b.registered || !b.entryPersisted || !b.id || !b.session || !this.valid(b,epoch))return;
      return {owner:this.options.owner,id:child,toolCallId:b.callId,
        session:b.session as AgentSession,sessionKey:b.session.sessionId,
        generation:b.generation,disposed:false,accountingId:b.id};
    }catch{return undefined;}
  }
  /** Host session_start/switch/shutdown owner seam; no event needed from child. */
  ownerChanged(owner:string):void {if(owner!==this.options.owner)this.dispose();}
  private warning(code:string){
    if(!this.disposed)this.status="degraded";
    try{void Promise.resolve(this.options.warn?.(code)).catch(()=>{});}catch{/* Static codes only. */}
  }
  private safe(action:()=>void){try{
    if(!knownSdkLifetimes || !originMemory){this.unknown();return;}
    if(this.alive())action();
  }catch{this.warning("observer-callback-failed");}}
  private alive():boolean {
    if(this.disposed)return false;
    try{
      const owner=this.options.getOwner ? this.options.getOwner() : this.options.owner;
      if(this.disposed)return false;
      if(owner!==this.options.owner){this.dispose();return false;}
    }
    catch{this.warning("owner-read-failed");this.dispose();return false;}
    return true;
  }
  private registry(){
    // An explicitly supplied but unknown source must not reopen global scope.
    return this.options.getRegistry ? (this.options.getRegistry()??null) : (globalThis as any)[managerKey];
  }
  private read(child:string,callId:string){return getOwnedRecord(this.options.owner,child,{owner:this.options.owner,childId:child,toolCallId:callId},this.registry());}
  private release(off:()=>void,code:string){try{off();}catch{this.warning(code);}}
  private detach(b:Binding){const off=b.off;b.off=undefined;b.epoch++;if(off)this.release(off,"session-unsubscribe-failed");}
  private unknown(b?:Binding){
    if(this.disposed || (b && this.bindings.get(b.origin.childId)!==b))return;
    this.status="unknown-attribution";if(b){b.suspended=true;this.detach(b);}
  }
  /** Snapshot BEFORE an external read; the returned guard invokes no callbacks. */
  private admission(child:string,callId:string){
    const call=this.calls.get(callId),b=this.bindings.get(child),epoch=b?.epoch;
    return ()=>!this.disposed && this.calls.get(callId)===call &&
      this.bindings.get(child)===b && b?.epoch===epoch;
  }
  private currentBinding(b:Binding,epoch:number):boolean {
    return !this.disposed && !b.suspended && b.epoch===epoch && this.bindings.get(b.origin.childId)===b;
  }
  private valid(b:Binding,epoch:number):boolean {
    if(!this.alive() || !this.currentBinding(b,epoch))return false;
    const current=this.read(b.origin.childId,b.callId);
    // Public owner/registry callbacks can synchronously dispose or replace us
    // while still returning valid old data. Recheck local state, not callbacks.
    if(!this.currentBinding(b,epoch))return false;
    if(current.kind!=="owned" || current.record!==b.record || current.session!==b.session){this.unknown(b);return false;}
    return true;
  }
  private hint(id:string){this.pending.delete(id);this.pending.add(id);if(this.pending.size>128)this.pending.delete(this.pending.values().next().value!);}
  /** Only identifiers are retained, never input task/description/key/result text. */
  observeToolCall(event:unknown):void {this.safe(()=>{
    const call=nativeCall(event);if(!call)return;
    const old=this.calls.get(call.id);
    if(old){if(old.resume!==call.resume)this.unknown();return;}
    this.calls.set(call.id,call);
    if(this.calls.size>128)this.calls.delete(this.calls.keys().next().value!);
    if(call.resume){const b=this.bindings.get(call.resume);if(b){b.suspended=true;this.detach(b);}}
  });}
  observeToolUpdate(event:unknown):void {this.safe(()=>{
    if(!object(event))return;
    this.correlate(event.toolName,event.toolCallId,event.partialResult);
  });}
  observeToolResult(event:unknown):void {this.safe(()=>{
    if(!object(event) || event.isError)return;
    // Tool usage is PendingUsagePool.drain(), pooling unrelated children. Do not
    // even read it. Only exact native receipt.details.agentId is correlation.
    this.correlate(event.toolName,event.toolCallId,{details:event.details});
  });}
  /** Optional adapter for PUBLIC parent AgentSession.subscribe updates/results.
   * execution_start precedes validation and cannot establish ownership. A host
   * extension tool_call (without parentToolCallId) must have been observed first. */
  observeHostEvent(event:unknown):void {this.safe(()=>{
    if(!object(event))return;
    if(event.type==="tool_execution_update")this.observeToolUpdate(event);
    if(event.type==="tool_execution_end" && !event.isError && object(event.result))this.observeToolResult({toolName:event.toolName,toolCallId:event.toolCallId,details:event.result.details});
  });}
  private correlate(toolName:unknown,callId:unknown,result:unknown) {
    if(toolName!=="Agent" || !identity(callId) || !object(result) || !object(result.details) || !identity(result.details.agentId))return;
    const call=this.calls.get(callId),child=result.details.agentId;
    if(!call || (call.resume!==undefined && call.resume!==child)){this.unknown();return;}
    const old=this.bindings.get(child),current=this.admission(child,callId);
    const found=this.read(child,callId);
    if(!current())return;
    if(found.kind!=="owned"){this.unknown(old);return;}
    if(!knownSdkLifetimes?.matches(found.record,found.session)){this.unknown(old);return;}
    if((old?.callId===callId && old.record!==found.record) ||
        (call.resume && (!old || old.record!==found.record))){this.unknown(old);return;}
    if(old?.callId===callId && !old.suspended && old.record===found.record) {this.refresh(old);return;}
    // A new immediate native spawn is proof of a new origin only for a distinct
    // public record. Continuations cannot fabricate a lifetime from startedAt.
    if(!call.resume && old && old.origin.spawnToolCallId!==callId && old.record===found.record){this.unknown(old);return;}
    const origin:AccountingOrigin=call.resume ? old!.origin : {
      backend:"@tintinweb/pi-subagents",rootOwnerId:this.options.owner,spawnToolCallId:callId,childId:child};
    this.bind(origin,found.record,callId,old?.origin===origin?old.generation:0);
  }
  private originLifetimeKey(origin:AccountingOrigin):string|undefined {
    // Restore already requires this public durable-store identity. Separate
    // ledgers are separate attestations; no path is read as authority here.
    return this.options.store.file?JSON.stringify([this.options.store.file,key(origin)]):undefined;
  }
  private durableGeneration(origin:AccountingOrigin):number {
    if(!this.options.store.file)return 0;
    const ledger=loadLedger(this.options.store.file),a=ledger.accounting;
    return a?.associations[accountingId(a.namespace,origin)]?.generation??0;
  }
  private bind(origin:AccountingOrigin,record:PublicRecord,callId:string,previousGeneration:number) {
    if(this.disposed)return;
    const old=this.bindings.get(origin.childId),epoch=old?.epoch??0,call=this.calls.get(callId);
    if(old)this.detach(old);
    // Cleanup can dispose, suspend, or synchronously install a replacement.
    if(this.disposed || this.bindings.get(origin.childId)!==old ||
        (old && old.epoch!==epoch+1) || this.calls.get(callId)!==call)return;
    // Old public cleanup can change the record's SDK after correlation's read.
    // Never overwrite remembered lifetime evidence with that replacement.
    const originLifetimeKey=this.originLifetimeKey(origin);
    if(!knownSdkLifetimes?.matches(record,record.session) || !originMemory ||
        (originLifetimeKey && !originMemory.matches(originLifetimeKey,record,record.session))){this.unknown(old);return;}
    const generation=Math.max(previousGeneration,this.durableGeneration(origin))+1;
    if(!Number.isSafeInteger(generation))throw Error("generation-exhausted");
    const projected:AccountingOrigin={backend:origin.backend,rootOwnerId:origin.rootOwnerId,spawnToolCallId:origin.spawnToolCallId,childId:origin.childId};
    const b:Binding={origin:projected,record,callId,generation,epoch:0,session:record.session,
      registered:false,entryPersisted:false,suspended:false,reasons:new Set(baseReasons)};
    if(b.session){
      if(!knownSdkLifetimes.remember(record,b.session) ||
          (originLifetimeKey && !originMemory.remember(originLifetimeKey,record,b.session))){this.unknown(old);return;}
    }
    this.bindings.set(origin.childId,b);this.pending.delete(origin.childId);
    this.subscribe(b);if(this.currentBinding(b,0))this.enqueue(b);
  }
  private subscribe(b:Binding) {
    if(!b.session)return;
    const epoch=b.epoch;
    try {
      const off=b.session.subscribe((event:AgentSessionEvent)=>this.safe(()=>{
        if(!this.valid(b,epoch))return;
        if(event.type==="message_end"){
          const message=event.message;
          if(message.role==="assistant") {
            // Missing/zero per-message cost can prove a gap, NEVER a dollar delta
            // or complete coverage. Read only the authoritative lifetime later.
            if(!readTerminalCost(message.usage))b.reasons.add("unpriced-contribution");
            this.enqueue(b);
          }
        }
        if(event.type==="agent_end" || event.type==="compaction_end")this.enqueue(b);
      }));
      if(typeof off!=="function")throw Error("invalid-unsubscriber");
      // Acquisition callbacks may invalidate us BEFORE returning their cleanup.
      if(!this.alive() || !this.currentBinding(b,epoch)){this.release(off,"session-unsubscribe-failed");return;}
      b.off=off;
    } catch {b.reasons.add("observation-gap");this.warning("session-subscribe-failed");}
  }
  private refresh(b:Binding){
    const epoch=b.epoch,current=this.admission(b.origin.childId,b.callId);
    if(!this.currentBinding(b,epoch))return;
    const found=this.read(b.origin.childId,b.callId);
    if(!current() || !this.currentBinding(b,epoch))return;
    if(found.kind!=="owned" || found.record!==b.record){this.unknown(b);return;}
    if(!knownSdkLifetimes?.matches(found.record,found.session)){this.unknown(b);return;}
    // Only never-bound undefined -> ready is public readiness, not replacement.
    if(b.session!==found.session){this.bind(b.origin,found.record,b.callId,b.generation);return;}
    this.enqueue(b);
  }
  private lifecycle(channel:string,payload:unknown) {
    if(!object(payload) || !identity(payload.id))return;
    const b=this.bindings.get(payload.id);
    if(!b){this.hint(payload.id);return;}
    if(b.suspended)return;
    // Published lifecycle payloads lack an immutable origin/tool correlation.
    // Normalize their different shape, but never substitute for a missing record
    // or missing/invalid accumulator: a delayed replay could name a reused id.
    if(channel==="subagents:completed" || channel==="subagents:failed")readTerminalCost(payload.usage);
    this.refresh(b);
  }
  private enqueue(b:Binding) {
    const epoch=b.epoch,k=key(b.origin),prior=this.queues.get(k)??Promise.resolve();
    const next=prior.then(async()=>{
      // Backend's synchronous message_end subscribers can run after ours.
      // A microtask fresh read observes the accumulator after the full emission.
      await Promise.resolve();
      if(!this.valid(b,epoch))return;
      if(!b.registered){
        const id=await this.options.store.registerOrigin(b.origin,{owner:this.options.owner,child:b.origin.childId,generation:b.generation});
        if(!this.valid(b,epoch))return;
        b.id=id;b.registered=true;
      }
      // Registration commits independently of the public correlation entry.
      // Retry only on a later authorized event, retaining this binding's identity.
      if(!b.entryPersisted && b.id){
        const entry:ObserverEntry={version:1,owner:this.options.owner,origin:{...b.origin},accountingId:b.id,
          correlationToolCallId:b.callId,generation:b.generation,...(b.session?{sdkSessionId:b.session.sessionId}:{})};
        await this.options.appendEntry(observerEntryType,entry);
        if(!this.valid(b,epoch))return;
        b.entryPersisted=true;
      }
      if(!b.id || !b.entryPersisted)return;
      const raw=b.record.lifetimeUsage.cost,cost=readLifetimeCost(b.record.lifetimeUsage);
      const reasons=[...b.reasons];if(cost===undefined)reasons.push("usage-unavailable");
      const at=(this.options.now?.()??new Date()).toISOString();
      // Prepare external-derived payload BEFORE the final authorization read.
      if(!this.valid(b,epoch))return;
      const result=await this.options.store.observe({accountingId:b.id,authorizedOwner:this.options.owner,child:b.origin.childId,
        bindingGeneration:b.generation,reportedCumulativeUsd:typeof raw==="number"?raw:undefined,
        provenance:"record-lifetime",aggregationScope:"top-level-including-descendants",pricing:{status:"incomplete",reasons},
        // An aggregate is not proof the current model produced the residual.
        // Attribution uses UTC observation time, never startedAt redistribution.
        at,late:true});
      if(!this.valid(b,epoch))return;
      if(result.status!=="committed")this.unknown(b);
    }).catch(()=>{
      // Rejections cross the same ownership boundary as successful awaits.
      // A throwing/reentrant public read or warning must not leave stale work
      // live, invalidate a replacement binding, or reject this queue's tail.
      try{this.valid(b,epoch);}catch{
        if(!this.disposed && this.bindings.get(b.origin.childId)===b && b.epoch===epoch)this.unknown(b);
      }finally{this.warning("accounting-observation-failed");}
    });
    this.queues.set(k,next);
    void next.then(()=>{if(this.queues.get(k)===next)this.queues.delete(k);});
  }
  /** Restore requires public parent message history, not persisted associations
   * as authority. SDK identity AND original spawn/current receipt are revalidated.
   * No polling or guessing origin from a resumed current call/startedAt. */
  restore(entry:unknown,publicParentMessages:readonly unknown[]):void {this.safe(()=>{
    if(!object(entry) || entry.version!==1 || entry.owner!==this.options.owner || !object(entry.origin) ||
        entry.origin.backend!=="@tintinweb/pi-subagents" || entry.origin.rootOwnerId!==this.options.owner ||
        !identity(entry.origin.childId) || !identity(entry.origin.spawnToolCallId) || !identity(entry.correlationToolCallId) ||
        !identity(entry.accountingId) || !identity(entry.sdkSessionId) || !Number.isSafeInteger(entry.generation) || entry.generation<1 ||
        !this.options.store.file){this.unknown();return;}
    const e=entry as ObserverEntry;
    const prove=(id:string,resume?:string)=>{
      let call:Call|undefined,receipt=false;
      for(const m of publicParentMessages){
        if(!object(m))continue;
        if(m.role==="assistant" && Array.isArray(m.content))for(const c of m.content){
          if(object(c) && c.type==="toolCall" && c.id===id)call=nativeCall({toolName:c.name,toolCallId:c.id,input:c.arguments});
        }
        if(m.role==="toolResult" && m.toolCallId===id && m.toolName==="Agent" && !m.isError && object(m.details) && m.details.agentId===e.origin.childId)receipt=true;
      }
      return call?.id===id && call.resume===resume && receipt;
    };
    const latestReceipt=publicParentMessages.filter(m=>object(m) && m.role==="toolResult" && m.toolName==="Agent" &&
      !m.isError && object(m.details) && m.details.agentId===e.origin.childId).at(-1);
    if(!object(latestReceipt) || latestReceipt.toolCallId!==e.correlationToolCallId || !prove(e.origin.spawnToolCallId) ||
        !prove(e.correlationToolCallId,e.correlationToolCallId===e.origin.spawnToolCallId?undefined:e.origin.childId)){this.unknown();return;}
    const current=this.admission(e.origin.childId,e.correlationToolCallId);
    const found=this.read(e.origin.childId,e.correlationToolCallId);
    if(!current())return;
    const old=this.bindings.get(e.origin.childId),originLifetimeKey=this.originLifetimeKey(e.origin);
    if(found.kind!=="owned" || found.session?.sessionId!==e.sdkSessionId ||
        (old && key(old.origin)===key(e.origin) && (old.record!==found.record || (old.session && old.session!==found.session))) ||
        !originMemory || (originLifetimeKey && !originMemory.matches(originLifetimeKey,found.record,found.session)) ||
        !knownSdkLifetimes?.matches(found.record,found.session)){
      this.unknown(old);return;
    }
    const a=loadLedger(this.options.store.file).accounting;
    if(!a || accountingId(a.namespace,e.origin)!==e.accountingId || !a.records[e.accountingId] ||
        key(a.records[e.accountingId].origin)!==key(e.origin) ||
        e.generation>a.associations[e.accountingId].generation){this.unknown();return;}
    this.bind(e.origin,found.record,e.correlationToolCallId,a.associations[e.accountingId].generation);
  });}
  /** Drain only already event-enqueued work (test/shutdown seam). No registry scan
   * or background loop. Dispose invalidates queued work but never waits on it. */
  async flush():Promise<void>{while(this.queues.size)await Promise.all([...this.queues.values()]);}
  dispose():void {
    if(this.disposed)return;this.disposed=true;this.status="disposed";
    for(const b of this.bindings.values())this.detach(b);
    this.bindings.clear();this.calls.clear();this.pending.clear();
    const offs=this.busOff.splice(0);for(const off of offs)try{off();}catch{this.warning("bus-unsubscribe-failed");}
  }
}
