import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { loadConfiguration } from '../configuration';
import { configPaths, type JevRouterConfig } from '../core/config';
import { loadLedger, spendSnapshot } from '../core/budget';
import { AccountingStore, createUsageRecorder, rootOwnerId } from '../state/accounting';
import { LaunchRouter, eligible, type NativeCall } from '../routing/intercept';
import { createEngine } from '../routing/engine';
import { ChildController } from '../children/controller';
import { ChildObserver, observerEntryType } from '../tintin/observer';
import { managerKey } from '../tintin/registry';
import { CommandRouter, type Admission, type SessionChange } from '../commands';
import type { ChildBinding, DecisionEntry, RoutingSnapshot } from '../contracts';
import { decisionEntryType, projectEntry } from '../ui/entries';
import type { StatusView } from '../ui/status';
import { authenticated, candidates, launchScope, scopeFingerprint, strictScopeSupported } from './scope';

export type HostAPI=Pick<ExtensionAPI,'events'|'appendEntry'> & Partial<Pick<ExtensionAPI,'getAllTools'>>;
/** Context is supplied by public events, not a hidden AgentSession handle. */
export type HostContext=Pick<ExtensionContext,'cwd'|'sessionManager'|'modelRegistry'|'hasUI'|'ui'|'signal'> & Partial<Pick<ExtensionContext,'isProjectTrusted'>>;
interface TaskMemo {text:string;originalChars:number;admission:Admission}
/** Single session owner; construction happens ONLY after session_start/acquisition.
 * No timers/processes/watchers or startup discovery. Services own cancellation;
 * this coordinator owns detached policy/CAS, lifecycle and callback admission. */
export class ExtensionCoordinator {
 private disposed=false;
 private generation=0;
 private config:JevRouterConfig;
 private readonly owner:string;
 private sessionPatch:SessionChange={};
 private context:HostContext;
 private store:AccountingStore;
 private launch:LaunchRouter;
 private observer?:ChildObserver;
 private controller:ChildController;
 commands:CommandRouter;
 private operation=new AbortController();
 private readonly calls=new Map<string,TaskMemo>();
 private readonly childIds=new Set<string>();
 private fingerprint='';
 private readonly warned=new Set<string>();
 private discovery='not-discovered';
 constructor(private readonly pi:HostAPI,ctx:HostContext,readonly cwd:string,initialGeneration=0) {
  this.generation=initialGeneration;
  this.context=ctx;this.owner=rootOwnerId(cwd,ctx.sessionManager.getSessionId());
  this.config=this.loaded();this.store=new AccountingStore(this.config.stateFile,{signal:this.operation.signal});
  this.launch=this.newLaunch();this.controller=this.newController();this.commands=this.newCommands();
  this.fingerprint=this.externalFingerprint();
  this.attachObserver();
 }
 private usageRecorder(){
  const a=this.getRuntime(),record=createUsageRecorder(this.store);
  return async(event:Parameters<typeof record>[0])=>{if(!this.live(a))throw Error('stale');await record(event);};
 }
 private newLaunch():LaunchRouter {
  const admission=this.getRuntime();
  return new LaunchRouter({owner:this.owner,config:this.config,bus:this.pi.events,catalogue:{getAllTools:()=>this.pi.getAllTools?.()},scope:async(context,registry)=>{
    // LaunchRouter repeats this admission before/after classifier and UI; an
    // unavailable budget ledger must not become an injected default.
    try{if(!this.live(admission))throw Error('stale');this.ledger();const scope=await launchScope(context,registry);if(!this.live(admission))throw Error('stale');this.ledger();return scope;}
    catch{return {kind:'unknown',reason:'ledger-unavailable'};}
   },
   recordUsage:this.usageRecorder(),audit:e=>{if(this.live(admission))this.audit(e);},warning:c=>{if(this.live(admission))this.warn(c);}});
 }
 private newCommands():CommandRouter {
  const self=this;
  return new CommandRouter({getRuntime:()=>this.getRuntime(),updateRuntime:(c,a)=>this.updateRuntime(c,a),getLedger:()=>this.ledger(),
   getCandidates:b=>candidates(this.scopeContext(),this.context.modelRegistry,b),getBinding:id=>this.getBinding(id),
   getGeneratedPath:()=>configPaths().generated,reloadGenerated:a=>this.reloadGenerated(a),getView:()=>this.view(),
   get controller(){return self.controller;},engine:createEngine({recordUsage:this.usageRecorder()})});
 }
 private scopeContext(){return {cwd:this.cwd,isProjectTrusted:()=>this.context.isProjectTrusted?.()===true};}
 private loaded():JevRouterConfig {
  const c=structuredClone(loadConfiguration(this.scopeContext()));
  c.stateFile=resolve(this.cwd,c.stateFile);return c;
 }
 private merged(c:JevRouterConfig):JevRouterConfig {
  return {...c,...this.sessionPatch,budget:{...c.budget,...this.sessionPatch.budget}};
 }
 getRuntime():RoutingSnapshot {return {owner:this.owner,generation:this.generation,config:structuredClone(this.config)};}
 /** Callback-free final admission fence after a potentially reentrant read. */
 isCurrentGeneration(generation:number):boolean {return !this.disposed && this.generation===generation;}
 private current(a:Admission):boolean {return !this.disposed && a.owner===this.owner && a.generation===this.generation;}
 private live(a:Admission):boolean {
  if(!this.current(a))return false;
  try{const owner=rootOwnerId(this.cwd,this.context.sessionManager.getSessionId());return this.current(a) && owner===this.owner;}catch{return false;}
 }
 private newController():ChildController {
  const admission=this.getRuntime();
  return new ChildController({getRuntime:()=>this.getRuntime(),getBinding:id=>this.getBinding(id),getRegistry:()=>this.registry(),
   getCandidates:b=>candidates(this.scopeContext(),this.context.modelRegistry,b),getSpend:(_b,r)=>spendSnapshot(this.ledger(),r.config.budget),
   signal:this.operation.signal,ui:this.selectUI(),warn:c=>{if(this.live(admission))this.warn(c);}});
 }
 private registry():unknown {return (globalThis as unknown as Record<symbol,unknown>)[managerKey]??null;}
 private selectUI(){return this.context.hasUI && typeof this.context.ui?.select==='function'?{select:(title:string,options:string[])=>this.context.ui.select(title,options)}:undefined;}
 private warn(code:string):void {
  if(this.disposed || this.warned.has(code))return;this.warned.add(code);
  const a=this.getRuntime();if(!this.live(a))return;
  const text=code==='tintin-unavailable'?'Jev child routing unavailable: install @tintinweb/pi-subagents and reload; native input unchanged.':`Jev child router degraded (${code}); native execution unchanged.`;
  try{if(this.current(a))void Promise.resolve(this.context.ui?.notify?.(text,'warning')).catch(()=>{});}catch{/* Optional UI. */}
 }
 private ledger(){try{return loadLedger(this.store.file);}catch{this.discovery='ledger-unavailable';this.warn('ledger-unavailable');throw Error('ledger-unavailable');}}
 view():StatusView {
  const children:StatusView['children'][number][]=[];
  for(const id of this.childIds){const b=this.getBinding(id);if(b){const model=b.session.model;children.push({id,status:b.session.isIdle?'idle':'active',model:model?`${model.provider}/${model.id}`:undefined,thinking:b.session.thinkingLevel});}}
  return {discovery:this.discovery==='not-discovered'?'unknown':this.discovery==='auto'||this.discovery==='notify'?'ready':'unavailable',control:strictScopeSupported() && ['configureIdleChild','getIdleChildConfigurationSnapshot','getIdleChildConfigurationReceipt'].every(key=>typeof (this.registry() as Record<string,unknown>|null)?.[key]==='function')?'supported':'unsupported',children};
 }
 private externalFingerprint():string {
  try{return JSON.stringify([this.context.isProjectTrusted?.(),authenticated(this.context.modelRegistry),this.pi.getAllTools?.(),scopeFingerprint(this.scopeContext())]);}
  catch{return 'external-unavailable';}
 }
 /** Refresh on public operations: no fake catalogue/auth/scope watch events. */
 refresh(ctx:HostContext):boolean {
  const a=this.getRuntime();if(!this.live(a)){this.dispose();return false;}
  this.context=ctx;
  if(!this.live(a)){this.dispose();return false;}
  const config=this.merged(this.loaded()),fingerprint=this.externalFingerprint();
  if(!this.live(a))return false;
  if(!isDeepStrictEqual(config,this.config) || fingerprint!==this.fingerprint){this.fingerprint=fingerprint;this.advance(config);}
  return !this.disposed;
 }
 updateRuntime(change:SessionChange,expected:Admission):boolean {
  if(!this.live(expected))return false;
  const patch=structuredClone(change);
  this.sessionPatch={...this.sessionPatch,...patch,budget:{...this.sessionPatch.budget,...patch.budget}};
  this.advance(this.merged(this.config));return true;
 }
 async reloadGenerated(expected:Admission):Promise<void> {
  // Defer acquisition and fence both sides: a later manual/session change wins.
  await Promise.resolve();if(!this.live(expected))return;
  const config=this.merged(this.loaded());if(!this.live(expected))return;
  this.advance(config);
 }
 private advance(config:JevRouterConfig):void {
  if(this.disposed)return;
  const old={commands:this.commands,launch:this.launch,controller:this.controller,observer:this.observer,operation:this.operation};
  this.generation++;this.config=structuredClone(config);this.calls.clear();const admission=this.getRuntime();
  old.operation.abort();
  for(const cleanup of [()=>old.commands.dispose(),()=>{old.launch.update({config});old.launch.dispose();},()=>old.controller.dispose(),()=>old.observer?.dispose()])try{cleanup();}catch{/* Attempt every OLD cleanup, not reentrant replacement services. */}
  if(!this.current(admission))return;
  this.operation=new AbortController();this.store=new AccountingStore(this.config.stateFile,{signal:this.operation.signal});
  this.launch=this.newLaunch();this.controller=this.newController();this.commands=this.newCommands();this.attachObserver();
 }
 private attachObserver():void {
  const a=this.getRuntime();if(!this.live(a))return;
  const observer=new ChildObserver({owner:this.owner,store:this.store,eventBus:this.pi.events,getRegistry:()=>this.registry(),
   getOwner:()=>this.live(a)?this.owner:'invalidated',appendEntry:(type,data)=>{if(!this.live(a))throw Error('stale');this.pi.appendEntry(type,data);},warn:c=>{if(this.live(a))this.warn(c);}});
  if(!this.live(a)){observer.dispose();return;}this.observer=observer;
  let branch:ReturnType<HostContext['sessionManager']['getBranch']>;
  try{branch=this.context.sessionManager.getBranch();}catch{return;}
  if(!this.live(a))return;
  const messages=branch.filter(e=>e.type==='message').map(e=>(e as {message:unknown}).message);
  // Latest entry per child on CURRENT branch, not abandoned getEntries().
  const entries=new Map<string,unknown>();
  for(const e of branch)if(e.type==='custom' && e.customType===observerEntryType){const data=e.data as {origin?:{childId?:string}};if(typeof data?.origin?.childId==='string'){entries.set(data.origin.childId,data);this.trackChild(data.origin.childId);}}
  for(const entry of entries.values()){if(!this.live(a))return;observer.restore(entry,messages);}
  // Decision cards remain branch entries rendered by Pi. No raw-task or why
  // history reconstruction; /why accurately explains empty reload memory.
 }
 private audit(entry:DecisionEntry):void {
  const a=entry.toolCallId?this.calls.get(entry.toolCallId)?.admission:undefined;
  if(!a || !this.live(a))return;
  const projected=projectEntry(entry);if(!this.live(a))return;
  this.commands.remember(projected,a);if(!this.live(a))return;
  this.pi.appendEntry(decisionEntryType,projected);
 }
 getBinding(child:string):ChildBinding|undefined {
  const a=this.getRuntime(),b=this.observer?.getBinding(child);
  if(!b || !this.live(a))return;
  const memo=this.calls.get(b.toolCallId);
  if(memo && this.current(memo.admission))this.commands.rememberTask(b,memo.text,memo.admission,memo.originalChars);
  return this.live(a)?b:undefined;
 }
 async toolCall(event:NativeCall & {parentToolCallId?:string},ctx:HostContext):Promise<void> {
  try {
   if(!this.refresh(ctx))return;
   const a=this.getRuntime();this.observer?.observeToolCall(event);
   if(!this.live(a) || event.toolName!=='Agent' || event.parentToolCallId!==undefined)return;
   if(typeof event.input.prompt==='string'){
    this.calls.delete(event.toolCallId);this.calls.set(event.toolCallId,{text:event.input.prompt.slice(0,4096),originalChars:event.input.prompt.length,admission:{owner:a.owner,generation:a.generation}});
    while(this.calls.size>16 || [...this.calls.values()].reduce((n,m)=>n+m.text.length,0)>16384)this.calls.delete(this.calls.keys().next().value!);
   }
   if(!eligible(event.toolName,event.input))return;
   // Before receipt/classification: failed/no-model launches still define why's
   // most recent eligible task. Both-explicit/resume/schedule never replace it.
   const memo=this.calls.get(event.toolCallId);
   if(memo && this.live(a) && !ctx.signal?.aborted)this.commands.rememberEligibleTask(memo.text,memo.admission,memo.originalChars,event.input.subagent_type as string);
   const spend=spendSnapshot(this.ledger(),a.config.budget);if(!this.live(a))return;
   const result=await this.launch.handle(event,{...this.scopeContext(),owner:this.owner,modelRegistry:ctx.modelRegistry,spend,signal:ctx.signal,ui:this.selectUI()});
   if(this.live(a))this.discovery=result.reason;
  }catch{/* tool_call failures BLOCK native tools in Pi; ALWAYS return normally. */}
 }
 private trackChild(id:string):void {this.childIds.add(id);while(this.childIds.size>128)this.childIds.delete(this.childIds.values().next().value!);}
 observeUpdate(event:unknown):void {try{const a=this.getRuntime();if(this.live(a)){this.observer?.observeToolUpdate(event);if(!this.live(a))return;const e=event as {partialResult?:{details?:{agentId?:unknown}}};if(typeof e?.partialResult?.details?.agentId==='string')this.trackChild(e.partialResult.details.agentId);}}catch{/* fail open */}}
 observeResult(event:unknown):void {try{const a=this.getRuntime();if(this.live(a)){this.observer?.observeToolResult(event);if(!this.live(a))return;const e=event as {details?:{agentId?:unknown}};if(typeof e?.details?.agentId==='string')this.trackChild(e.details.agentId);}}catch{/* fail open */}}
 /** Event-driven drain is an explicit test/shutdown seam, never polling. */
 async flush():Promise<void>{await this.observer?.flush();}
 dispose():void {
  if(this.disposed)return;this.disposed=true;this.generation++;this.calls.clear();this.childIds.clear();this.operation.abort();
  // Failed cleanup must not skip remaining independent services.
  for(const dispose of [()=>this.commands.dispose(),()=>this.controller.dispose(),()=>this.launch.dispose(),()=>this.observer?.dispose()])try{dispose();}catch{/* Guarded by generation regardless of cleanup outcome. */}
 }
}
