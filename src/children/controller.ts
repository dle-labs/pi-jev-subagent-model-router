import { isDeepStrictEqual } from "node:util";
import { controlSafety } from "./control-safety";
import type { ChildBinding, Proposal, RoutingSnapshot } from "../contracts";
import type { SpendSnapshot } from "../core/budget";
import type { ThinkingLevel } from "../core/config";
import { decide, tierForModel, type AvailableModel } from "../core/router";
import { chooseDefaults, type SelectUI } from "../routing/modes";
import { getOwnedRecord, type PublicRecord } from "../tintin/registry";

/** Additive PUBLIC 3B contracts. No dependency on Tintin private modules. */
export interface ConfigurationSnapshot {
 readonly sessionId:string; readonly revision:number;
 readonly model:Readonly<{provider:string;id:string}>|undefined;
 readonly thinkingLevel:ThinkingLevel;
}
export type ConfigurationReason="busy"|"disposed"|"stale"|"invalid"|"unauthorized"|"cancelled"|"operation-conflict"|"capacity"|"storage"|"unsupported"|"not-found"|"scope-unknown"|"scope-denied";
export interface ConfigurationReceipt {
 readonly status:"committed"|"noop";readonly operationId:string;
 readonly before:ConfigurationSnapshot;readonly after:ConfigurationSnapshot;
 readonly revision:number;readonly notificationErrors:readonly string[];
}
export type ConfigurationResult=ConfigurationReceipt|{status:"rejected";operationId:string;reason:ConfigurationReason};
export interface ConfigureRequest {
 operationId:string;childId:string;expectedSessionId:string;expectedRevision:number;
 model:{provider:string;id:string};thinking:ThinkingLevel;signal?:AbortSignal;
}
export interface ReceiptRequest {operationId:string;childId:string;expectedSessionId:string}
export interface PublicControls {
 getIdleChildConfigurationSnapshot(childId:string):unknown;
 configureIdleChild(request:ConfigureRequest):Promise<unknown>;
 getIdleChildConfigurationReceipt(request:ReceiptRequest):unknown;
}
export type ScopedCandidates={status:"ready";models:readonly AvailableModel[]}|{status:"rejected";reason:"unsupported"|"scope-unknown"|"scope-denied"};
export interface ControllerOptions {
 getRuntime:()=>RoutingSnapshot;
 /** A live Task9-validated association, never a persisted entry alone. */
 getBinding:(childId:string)=>ChildBinding|undefined;
 getRegistry:()=>unknown;
 /** Strict public resolver against the full current registry, then shortlist. */
 getCandidates:(binding:ChildBinding,runtime:RoutingSnapshot)=>ScopedCandidates|Promise<ScopedCandidates>;
 getSpend:(binding:ChildBinding,runtime:RoutingSnapshot)=>SpendSnapshot|Promise<SpendSnapshot>;
 ui?:SelectUI;
 signal?:AbortSignal;
 /** Host owner/config/context invalidation must synchronously notify this seam. */
 onInvalidate?:(invalidate:()=>void)=>(()=>void);
 /** Optional UUID factory; values must be unique and lexically increasing. */
 operationId?:()=>string;
 now?:()=>number;
 warn?:(code:string)=>void|Promise<void>;
}
export interface ControlOutcome {
 status:"committed"|"noop"|"rejected"|"degraded"|"held"|"notified"|"kept";
 reason:string;
 receipt?:ConfigurationReceipt;
}
interface Lifetime {
 binding:ChildBinding;record:PublicRecord;registry:PublicControls;
 history:ConfigurationReceipt[];revision?:number;degraded:boolean;invalid:boolean;
}
interface Attempt {
 lifetime:Lifetime;binding:ChildBinding;runtime:RoutingSnapshot;epoch:number;abort:AbortController;lease:symbol;
}
const levels:readonly unknown[]=["off","minimal","low","medium","high","xhigh","max"];
const reasons:readonly unknown[]=["busy","disposed","stale","invalid","unauthorized","cancelled","operation-conflict","capacity","storage","unsupported","not-found","scope-unknown","scope-denied"];
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==="string" && v.length>0 && v.length<=4096 && !["__proto__","prototype","constructor"].includes(v);
const revision=(v:unknown):v is number=>Number.isSafeInteger(v) && typeof v==="number" && v>=0;
const model=(v:unknown):v is {provider:string;id:string}=>object(v) && id(v.provider) && id(v.id);
function snapshot(v:unknown):v is ConfigurationSnapshot {
 return object(v) && id(v.sessionId) && revision(v.revision) && (v.model===undefined || model(v.model)) && levels.includes(v.thinkingLevel);
}
function samePair(a:ConfigurationSnapshot,b:ConfigurationSnapshot):boolean {
 return a.sessionId===b.sessionId && a.model?.provider===b.model?.provider && a.model?.id===b.model?.id && a.thinkingLevel===b.thinkingLevel;
}
function sameSnapshot(a:ConfigurationSnapshot,b:ConfigurationSnapshot):boolean {return samePair(a,b) && a.revision===b.revision;}
function copySnapshot(s:ConfigurationSnapshot):ConfigurationSnapshot {
 return {sessionId:s.sessionId,revision:s.revision,model:s.model?{provider:s.model.provider,id:s.model.id}:undefined,thinkingLevel:s.thinkingLevel};
}
function controls(v:unknown):v is PublicControls {
 return object(v) && typeof v.getIdleChildConfigurationSnapshot==="function" && typeof v.configureIdleChild==="function" && typeof v.getIdleChildConfigurationReceipt==="function";
}
function sameBinding(a:ChildBinding|undefined,b:ChildBinding):boolean {
 return !!a && a.owner===b.owner && a.id===b.id && a.toolCallId===b.toolCallId && a.session===b.session && a.sessionKey===b.sessionKey && a.generation===b.generation && !a.disposed;
}
function validBinding(b:ChildBinding,r:RoutingSnapshot):boolean {
 return id(r.owner) && revision(r.generation) && typeof r.config.enabled==="boolean" && ["auto","confirm","notify"].includes(r.config.mode) && id(b.owner) && b.owner===r.owner && id(b.id) && id(b.toolCallId) && id(b.sessionKey) && b.session?.sessionId===b.sessionKey && revision(b.generation) && b.generation>0 && !b.disposed;
}
function validCandidates(value:unknown):value is ScopedCandidates {
 if(!object(value))return false;
 if(value.status==="rejected")return typeof value.reason==="string" && ["unsupported","scope-unknown","scope-denied"].includes(value.reason);
 return value.status==="ready" && Array.isArray(value.models) && value.models.every((m:unknown)=>{
  if(!object(m))return false;
  const cost=m.cost;
  return model(m) && (cost===undefined || (object(cost) && [cost.input,cost.output,cost.cacheRead,cost.cacheWrite].every(n=>typeof n==="number" && Number.isFinite(n) && n>=0)));
 });
}
const reject=(reason:string):ControlOutcome=>({status:"rejected",reason});
/** Explicit control only. This class never runs a child or reserves native idle. */
export class ChildController {
 private readonly options:ControllerOptions;
 private readonly lifetimes=new Map<string,Lifetime>();
 private readonly active=new Map<string,AbortController>();
 private readonly safety=controlSafety;
 private readonly ids=new Set<string>();
 private epoch=0;
 private operationTick=-1;
 private lastOperationId="";
 private disposed=false;
 private invalidated=false;
 private acquiring=false;
 private off?:()=>void;
 constructor(options:ControllerOptions) {
  this.options=options;
  // Runtime JS extra fields cannot inject alternate SDK safety. Always canonical.
  if(options.onInvalidate)try {
   this.acquiring=true;
   const off=options.onInvalidate(()=>this.invalidate());
   if(typeof off!=="function")throw Error("invalid-cleanup");
   if(this.disposed || this.epoch!==0){try{off();}catch{this.warning("cleanup-failed");}}
   else this.off=off;
  }catch{this.dispose();this.warning("invalidation-subscribe-failed");}finally{this.acquiring=false;}
 }
 private warning(code:string):void {try{void Promise.resolve(this.options.warn?.(code)).catch(()=>{});}catch{/* Static codes only. */}}
 /** Invalidates future control and aborts pending auth/UI. Known receipts remain readable. */
 invalidate():void {this.invalidated=true;this.epoch++;for(const l of this.lifetimes.values())l.invalid=true;for(const a of this.active.values())a.abort();}
 dispose():void {if(this.disposed)return;this.disposed=true;this.invalidate();const off=this.off;this.off=undefined;try{off?.();}catch{this.warning("cleanup-failed");}}
 history(binding:ChildBinding):readonly ConfigurationReceipt[] {
  const l=this.lifetimes.get(this.key(binding));
  return l && sameBinding(binding,l.binding)?structuredClone(l.history):[];
 }
 metadata(binding:ChildBinding):Readonly<{status:"ready"|"degraded"|"invalidated";depth:number;revision?:number}> {
  const found=this.lifetimes.get(this.key(binding));
  const l=found && sameBinding(binding,found.binding)?found:undefined;
  return Object.freeze({status:l?.degraded || !this.safety || this.safety.status(binding.session)==="unresolved"?"degraded":this.disposed || this.invalidated || l?.invalid?"invalidated":"ready",depth:l?.history.length??0,revision:l?.revision});
 }
 private key(b:ChildBinding):string {return JSON.stringify([b.owner,b.id,b.sessionKey,b.generation,b.toolCallId]);}
 private local(a:Attempt):boolean {return !this.disposed && this.epoch===a.epoch && !a.abort.signal.aborted && !a.lifetime.invalid && !this.options.signal?.aborted;}
 /** Callbacks can reenter; check local captured admission after every callback. */
 private valid(a:Attempt):boolean {
  if(!this.local(a))return false;
  const runtime=this.options.getRuntime();
  if(!this.local(a) || runtime.owner!==a.runtime.owner || runtime.generation!==a.runtime.generation || !runtime.config.enabled || !isDeepStrictEqual(runtime.config,a.runtime.config))return false;
  const binding=this.options.getBinding(a.binding.id);
  if(!this.local(a) || !sameBinding(binding,a.binding))return false;
  const registry=this.options.getRegistry();
  if(!this.local(a) || registry!==a.lifetime.registry)return false;
  const found=getOwnedRecord(a.binding.owner,a.binding.id,{owner:a.binding.owner,childId:a.binding.id,toolCallId:a.binding.toolCallId},registry);
  if(!this.local(a) || found.kind!=="owned" || found.record!==a.lifetime.record || found.session!==a.binding.session || found.record.status!=="completed")return false;
  if(!a.binding.session.isIdle || a.binding.session.isCompacting || !this.local(a))return false;
  const last=this.options.getRuntime();
  return this.local(a) && last.owner===a.runtime.owner && last.generation===a.runtime.generation && last.config.enabled && isDeepStrictEqual(last.config,a.runtime.config);
 }
 private degrade(a:Attempt):ControlOutcome {a.lifetime.degraded=true;this.safety?.finish(a.binding.session,a.lease,"unresolved");this.warning("control-outcome-unresolved");return {status:"degraded",reason:"outcome-unresolved"};}
 async apply(binding:ChildBinding,proposal:Proposal,runtimeSnapshot:RoutingSnapshot):Promise<ControlOutcome> {
  return this.run(binding,runtimeSnapshot,proposal);
 }
 async revert(binding:ChildBinding,runtimeSnapshot:RoutingSnapshot):Promise<ControlOutcome> {
  return this.run(binding,runtimeSnapshot);
 }
 private async run(input:ChildBinding,inputRuntime:RoutingSnapshot,proposal?:Proposal):Promise<ControlOutcome> {
  // Acquire before service callbacks; native synchronization is backend-owned.
  if(this.disposed)return reject("disposed");
  if(this.invalidated)return reject("controller-invalidated");
  if(!this.safety)return {status:"degraded",reason:"safety-authority-unavailable"};
  if(this.acquiring)return reject("in-flight");
  const child=input.id;
  if(this.active.has(child))return reject("in-flight");
  const abort=new AbortController();this.active.set(child,abort);
  let a:Attempt|undefined,admitted=false,resolved=false,leasedSession:object|undefined;
  const lease=Symbol("child-control-attempt");
  const hostAbort=()=>abort.abort();
  try {
   this.options.signal?.addEventListener("abort",hostAbort,{once:true});
   if(this.options.signal?.aborted)return reject("cancelled");
   const binding={...input},runtime=structuredClone(inputRuntime),epoch=this.epoch;
   proposal=proposal===undefined?undefined:structuredClone(proposal);
   if(!validBinding(binding,runtime))return reject("stale-binding");
   // Acquire before external callbacks; only exact lease ownership can finish.
   const safety=this.safety.acquire(binding.session,lease);
   if(safety==="unresolved")return {status:"degraded",reason:"outcome-unresolved"};
   if(safety==="pending")return reject("in-flight");
   leasedSession=binding.session;
   if(!runtime.config.enabled)return reject("disabled");
   const current=this.options.getRuntime();
   if(this.disposed || epoch!==this.epoch || !isDeepStrictEqual(current,runtime))return reject("stale-runtime");
   const live=this.options.getBinding(child);
   if(this.disposed || epoch!==this.epoch || !sameBinding(live,binding))return reject("stale-binding");
   const registry=this.options.getRegistry();
   if(this.disposed || epoch!==this.epoch)return reject("cancelled");
   if(!controls(registry))return reject("unsupported");
   const found=getOwnedRecord(binding.owner,child,{owner:binding.owner,childId:child,toolCallId:binding.toolCallId},registry);
   if(this.disposed || epoch!==this.epoch)return reject("cancelled");
   if(found.kind!=="owned" || found.session!==binding.session)return reject("stale-binding");
   if(found.record.status!=="completed" || !binding.session.isIdle || binding.session.isCompacting)return reject("busy");
   const k=this.key(binding);let lifetime=this.lifetimes.get(k);
   if(lifetime && (lifetime.record!==found.record || lifetime.binding.session!==binding.session || lifetime.registry!==registry))return reject("stale-binding");
   if(!lifetime){lifetime={binding,record:found.record,registry,history:[],degraded:false,invalid:false};this.lifetimes.set(k,lifetime);}
   if(lifetime.degraded)return {status:"degraded",reason:"outcome-unresolved"};
   a={lifetime,binding,runtime,epoch,abort,lease};
   if(!this.valid(a))return reject("cancelled");
   const ready:unknown=registry.getIdleChildConfigurationSnapshot(child);
   if(!this.valid(a))return reject("cancelled");
   if(object(ready) && ready.status==="rejected"){
    const reason=ready.reason;
    return typeof reason==="string" && reasons.includes(reason)?reject(reason):reject("invalid-snapshot");
   }
   if(!object(ready) || ready.status!=="ready" || ready.childId!==child || !snapshot(ready.snapshot) || ready.snapshot.sessionId!==binding.sessionKey || !ready.snapshot.model)return reject("invalid-snapshot");
   const before=copySnapshot(ready.snapshot);
   if(lifetime.revision!==undefined && lifetime.revision!==before.revision)return reject("history-conflict");
   if(!model(binding.session.model) || before.model?.provider!==binding.session.model.provider || before.model?.id!==binding.session.model.id || before.thinkingLevel!==binding.session.thinkingLevel)return reject("snapshot-conflict");
   if(!this.valid(a))return reject("cancelled");
   const top=lifetime.history.at(-1);
   if(!proposal && !top)return reject("history-empty");
   if(!proposal && top && !samePair(before,top.after))return reject("history-conflict");
   const candidates=await this.options.getCandidates({...binding},structuredClone(runtime));
   if(!this.valid(a))return reject("cancelled");
   if(!validCandidates(candidates))return reject("invalid-candidates");
   if(candidates.status==="rejected"){
    const reason=candidates.reason;
    return ["unsupported","scope-unknown","scope-denied"].includes(reason)?reject(reason):reject("invalid-candidates");
   }
   const models=structuredClone([...candidates.models]);
   let target:{model:{provider:string;id:string};thinking:ThinkingLevel};
   if(proposal) {
    if(!proposal.decision?.model || !model(proposal.decision.model))return reject("missing-proposal-model");
    if(proposal.decision.target.provider!==proposal.decision.model.provider || proposal.decision.target.model!==proposal.decision.model.id || (proposal.decision.target.thinkingLevel!==undefined && !levels.includes(proposal.decision.target.thinkingLevel)))return reject("invalid-proposal");
    if(!proposal.analysis)return reject("analysis-required");
    const spend=await this.options.getSpend({...binding},structuredClone(runtime));
    if(!this.valid(a))return reject("cancelled");
    if(![spend.today,spend.month,spend.pressure].every(n=>typeof n==="number" && Number.isFinite(n) && n>=0))return reject("invalid-spend");
    const usage=binding.session.getContextUsage();
    if(!this.valid(a))return reject("cancelled");
    const tokens=usage?.tokens;
    if(tokens!==undefined && tokens!==null && (!Number.isFinite(tokens) || tokens<0))return reject("invalid-context");
    const actual=models.find(m=>m.provider===before.model?.provider && m.id===before.model?.id);
    // Use only matching catalogue pricing, never the parent or an unfiltered universe.
    const decision=decide(structuredClone(proposal.analysis),runtime.config,{models,spend:{...spend},contextTokens:tokens??undefined,
     current:{index:tierForModel(`${before.model?.provider}/${before.model?.id}`,runtime.config),model:actual}});
    if(!this.valid(a))return reject("cancelled");
    if(!decision?.model)return reject("no-permitted-candidate");
    if(decision.held || (runtime.config.stickiness && decision.model.provider===before.model?.provider && decision.model.id===before.model?.id))return {status:"held",reason:decision.held?"cache-held":"sticky"};
    const choice=await chooseDefaults(runtime.config.mode,{analysis:proposal.analysis,decision},runtime.config,models,this.options.ui,abort.signal);
    if(!this.valid(a))return reject("cancelled");
    if(choice.reason==="notify")return {status:"notified",reason:"notify"};
    if(!choice.decision?.model || !choice.defaults.model)return choice.reason==="keep"?{status:"kept",reason:"keep"}:reject(choice.reason);
    target={model:{provider:choice.decision.model.provider,id:choice.decision.model.id},thinking:choice.decision.target.thinkingLevel??before.thinkingLevel};
   }else {
    if(!top?.before.model)return reject("missing-restore-model");
    if(!models.some(m=>m.provider===top.before.model?.provider && m.id===top.before.model?.id))return reject("restore-unavailable");
    if(runtime.config.mode==="notify")return {status:"notified",reason:"notify"};
    if(runtime.config.mode==="confirm" && this.options.ui?.select){
     const selected=`Restore: ${top.before.model.provider}/${top.before.model.id} (${top.before.thinkingLevel})`;
     let choice:string|undefined;try{choice=await this.options.ui.select("Restore child configuration",[selected,"Keep current child configuration"]);}catch{if(!this.valid(a))return reject("cancelled");return reject("confirmation-failed");}
     if(!this.valid(a))return reject("cancelled");
     if(choice!==selected)return {status:"kept",reason:"keep"};
    }
    target={model:{...top.before.model},thinking:top.before.thinkingLevel};
   }
   if(!this.valid(a))return reject("cancelled");
   const now=this.options.now?.()??Date.now();
   if(!this.valid(a))return reject("cancelled");
   if(!revision(now) || now>0xffffffffffff)return reject("invalid-clock");
   this.operationTick=Math.max(now,this.operationTick+1);
   if(this.operationTick>0xffffffffffff)return reject("invalid-clock");
   const tick=this.operationTick.toString(16).padStart(12,"0"),random=crypto.randomUUID();
   // UUIDv7 time prefix: a backwards/stationary clock cannot reorder operations.
   const operationId=this.options.operationId?.()??`${tick.slice(0,8)}-${tick.slice(8)}-7${random.slice(15,18)}-${random.slice(19)}`;
   if(!this.valid(a))return reject("cancelled");
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId) || this.ids.has(operationId) || operationId<=this.lastOperationId)return reject("invalid-operation-id");
   this.ids.add(operationId);this.lastOperationId=operationId;
   const request:ConfigureRequest=Object.freeze({operationId,childId:child,expectedSessionId:before.sessionId,expectedRevision:before.revision,model:Object.freeze({...target.model}),thinking:target.thinking,signal:abort.signal});
   if(!this.valid(a))return reject("cancelled");
   admitted=true;
   const result=await this.configure(a,request,before);
   resolved=result.status!=="degraded";
   // A valid native receipt remains truth even if host admission was invalidated.
   if(result.status==="committed" && result.receipt){
    if(proposal)lifetime.history.push(structuredClone(result.receipt));else lifetime.history.pop();
    lifetime.revision=result.receipt.revision;
   }else if(result.status==="noop")lifetime.revision=before.revision;
   let valid=false;try{valid=this.valid(a);}catch{/* Acknowledged truth cannot be lost to host callbacks. */}
   if(!valid){lifetime.invalid=true;abort.abort();}
   return result;
  }catch {
   if(admitted && a)return this.degrade(a);
   return reject(abort.signal.aborted || this.disposed?"cancelled":"callback-failed");
  }finally {
   this.options.signal?.removeEventListener("abort",hostAbort);
   if(this.active.get(child)===abort)this.active.delete(child);
   if(leasedSession && (!admitted || resolved))this.safety.finish(leasedSession,lease,"known");
  }
 }
 private checked(value:unknown,request:ConfigureRequest,before:ConfigurationSnapshot):ControlOutcome|undefined {
  if(!object(value) || value.operationId!==request.operationId)return;
  if(value.status==="rejected"){
   const reason=value.reason;
   return typeof reason==="string" && reasons.includes(reason)?reject(reason):undefined;
  }
  if((value.status!=="committed" && value.status!=="noop") || !snapshot(value.before) || !snapshot(value.after) || !revision(value.revision) || !Array.isArray(value.notificationErrors) || !value.notificationErrors.every(e=>typeof e==="string"))return;
  if(!sameSnapshot(value.before,before) || value.after.sessionId!==before.sessionId || value.after.model?.provider!==request.model.provider || value.after.model?.id!==request.model.id || value.after.thinkingLevel!==request.thinking || value.revision!==value.after.revision)return;
  const noop=samePair(value.before,value.after);
  if(value.status==="noop" ? !noop || value.after.revision!==before.revision || value.notificationErrors.length!==0 : noop || value.after.revision<=before.revision)return;
  const receipt:ConfigurationReceipt={status:value.status,operationId:request.operationId,before:copySnapshot(value.before),after:copySnapshot(value.after),revision:value.revision,notificationErrors:[...value.notificationErrors]};
  return {status:receipt.status,reason:receipt.notificationErrors.length?"committed-with-diagnostics":receipt.status,receipt};
 }
 private async configure(a:Attempt,request:ConfigureRequest,before:ConfigurationSnapshot):Promise<ControlOutcome> {
  const registry=a.lifetime.registry;
  let result:unknown;
  try{result=await registry.configureIdleChild(request);}catch{
   // Never blindly retry with a new ID. Lookup even when ownership has changed;
   // a denied lookup means outcome is unresolved, not rolled back.
   let recovered:unknown;
   try{recovered=registry.getIdleChildConfigurationReceipt({operationId:request.operationId,childId:request.childId,expectedSessionId:request.expectedSessionId});}catch{return this.degrade(a);}
   const known=this.checked(recovered,request,before);
   if(known?.status==="committed")return known;
   if(!known || known.reason!=="not-found" || !this.valid(a))return this.degrade(a);
   try{result=await registry.configureIdleChild(request);}catch{
    try{const final=this.checked(registry.getIdleChildConfigurationReceipt({operationId:request.operationId,childId:request.childId,expectedSessionId:request.expectedSessionId}),request,before);if(final?.status==="committed")return final;}catch{/* Unresolved. */}
    return this.degrade(a);
   }
  }
  const checked=this.checked(result,request,before);
  return checked??this.degrade(a);
 }
}
