import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, resolve } from "node:path";
import type { ChildBinding, DecisionEntry, Proposal, RoutingSnapshot, TaskSnapshot } from "./contracts";
import type { ChildController, ControlOutcome, ScopedCandidates } from "./children/controller";
import { TIERS, type JevRouterConfig, type Mode } from "./core/config";
import { spendSnapshot, type Ledger } from "./core/budget";
import { tierForModel, type AvailableModel } from "./core/router";
import { loadScores, suggestRoutes } from "./core/ranking";
import { propose, type Engine, type ChildContext } from "./routing/engine";
import { normalizeLedger } from "./state/accounting";
import { AtomicError, withAtomicJson } from "./state/atomic";
import { prepareDecision, projectEntry, type DecisionDisplay, type EffectiveSettings } from "./ui/entries";
import { prepareStatus, type StatusView } from "./ui/status";

export interface SessionChange {enabled?:boolean;mode?:Mode;budget?:Partial<JevRouterConfig["budget"]>}
export interface Admission {owner:string;generation:number}
/** Composition authority: validated configuration, exact live binding and scoped
 * authenticated registry. No parent setter, launcher, tool execution or prompts. */
export interface CommandServices {
 getRuntime():RoutingSnapshot;
 /** Synchronous CAS: verify expected, invalidate launch/controller/command work,
  * merge session-only changes, advance generation. Never write manual defaults. */
 updateRuntime(change:SessionChange,expected:Admission):boolean;
 getLedger():Ledger|Promise<Ledger>;
 getCandidates(binding?:ChildBinding):ScopedCandidates|Promise<ScopedCandidates>;
 getBinding(childId:string):ChildBinding|undefined;
 /** Must return the validated CHILD generated resource, not a caller filename. */
 getGeneratedPath(runtime:RoutingSnapshot):string|undefined;
 /** After commit only. Must CAS expected owner/generation itself after any await,
  * reload the generated layer via loadConfiguration, preserve session overrides. */
 reloadGenerated(expected:Admission):void|Promise<void>;
 getView():StatusView;
 controller:Pick<ChildController,"apply"|"revert">;
 /** Compose createEngine({recordUsage:createUsageRecorder(store)}) in Task12. */
 engine?:Engine;
 /** Synchronously notify on owner/config/off/context change; required for mutable
  * hosts unless the host directly invokes invalidate(). Cleanup is idempotent. */
 onInvalidate?:(invalidate:()=>void)=>(()=>void);
}
export interface CommandResult {
 text:string;level:"info"|"warning";
 proposal?:Proposal;
 /** Exact controller outcome; diagnostics are never echoed to UI. */
 control?:ControlOutcome;
 written?:boolean;
}
const usage="usage: /jev-subagent-router status|on|off|mode auto|confirm|notify|budget [daily|monthly USD]|why|suggest [--write]|apply CHILD_ID [-- TASK]|revert CHILD_ID";
const warning=(text:string):CommandResult=>({text,level:"warning"});
const info=(text:string):CommandResult=>({text,level:"info"});
const id=(text:string)=>/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(text) && !["__proto__","prototype","constructor"].includes(text);
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v);
/** Race callback waits, while observing both eventual loser outcomes. */
function pending<T>(operation:Promise<T>,signal:AbortSignal):Promise<T> {
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener("abort",abort);reject(new AtomicError("cancelled"));};
  signal.addEventListener("abort",abort,{once:true});
  operation.then(value=>{signal.removeEventListener("abort",abort);signal.aborted?reject(new AtomicError("cancelled")):resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(error);});
  if(signal.aborted)abort();
 });
}
interface Attempt {runtime:RoutingSnapshot;epoch:number;abort:AbortController}
function generatedObject(value:unknown):asserts value is Record<string,unknown> {
 if(!object(value))throw new AtomicError("invalid-generated-config");
 for(const field of ["routes","kindModels"]){
  const chains=value[field];if(chains===undefined)continue;
  if(!object(chains))throw new AtomicError("invalid-generated-config");
  for(const chain of Object.values(chains))if(!Array.isArray(chain) || !chain.every(t=>object(t) && typeof t.provider==="string" && t.provider.length>0 && typeof t.model==="string" && t.model.length>0 &&
   (t.thinkingLevel===undefined || ["off","minimal","low","medium","high","xhigh","max"].includes(t.thinkingLevel as string)) &&
   (t.minTier===undefined || TIERS.includes(t.minTier as typeof TIERS[number])) &&
   (t.priority===undefined || (typeof t.priority==="number" && Number.isFinite(t.priority)))))throw new AtomicError("invalid-generated-config");
 }
}
/** Task11 runtime-local command layer. Timers, subscriptions to child events and
 * production factory registration remain owned by Task12. */
export class CommandRouter {
 private epoch=0;
 private disposed=false;
 private acquiring=false;
 private seen?:Admission;
 private off?:()=>void;
 private readonly active=new Set<AbortController>();
 private readonly history:DecisionDisplay[]=[];
 private readonly tasks=new Map<string,{text:string;originalChars:number}>();
 private eligibleTask?:{text:string;originalChars:number;agent:string};
 private readonly sessions=new WeakMap<object,number>();
 private sessionNumber=0;
 constructor(private readonly services:CommandServices) {
  if(services.onInvalidate)try{
   this.acquiring=true;const before=this.epoch;
   const off=services.onInvalidate(()=>this.invalidate());
   if(typeof off!=="function")throw Error("invalid-cleanup");
   if(this.disposed || this.epoch!==before){this.dispose();try{off();}catch{/* optional cleanup */}}else this.off=off;
  }catch{this.dispose();}finally{this.acquiring=false;}
 }
 private runtime():RoutingSnapshot|undefined {
  if(this.disposed || this.acquiring)return;
  const before=this.epoch,r=structuredClone(this.services.getRuntime());
  if(this.disposed || this.epoch!==before)return;
  if(this.seen && (this.seen.owner!==r.owner || this.seen.generation!==r.generation))this.invalidate();
  this.seen={owner:r.owner,generation:r.generation};return r;
 }
 /** Callback-free fence: never read runtime again after the final callback. */
 private current(a:Attempt):boolean {return !this.disposed && this.epoch===a.epoch && !a.abort.signal.aborted;}
 private valid(a:Attempt,enabled=true):boolean {
  if(!this.current(a))return false;
  const current=this.runtime();
  return this.current(a) && !!current && (!enabled || current.config.enabled) && current.owner===a.runtime.owner && current.generation===a.runtime.generation && isDeepStrictEqual(current.config,a.runtime.config);
 }
 private start(enabled=true,external?:AbortSignal):{attempt:Attempt;finish:()=>void}|undefined {
  const runtime=this.runtime();if(!runtime || (enabled && !runtime.config.enabled))return;
  const abort=new AbortController(),hostAbort=()=>abort.abort();
  this.active.add(abort);external?.addEventListener("abort",hostAbort,{once:true});if(external?.aborted)hostAbort();
  return {attempt:{runtime,epoch:this.epoch,abort},finish:()=>{external?.removeEventListener("abort",hostAbort);this.active.delete(abort);}};
 }
 /** Clear bounded context AND invalidate pending work. Wire on generation/owner,
  * reload, off, context replacement and disposal. No disk reconstruction. */
 invalidate():void {this.epoch++;for(const abort of this.active)abort.abort();this.active.clear();this.history.length=0;this.tasks.clear();this.eligibleTask=undefined;}
 clear():void {this.invalidate();}
 dispose():void {if(this.disposed)return;this.disposed=true;this.invalidate();const off=this.off;this.off=undefined;try{off?.();}catch{/* contained */}}
 get entries():DecisionDisplay[] {try{this.runtime();}catch{return [];}return structuredClone(this.history);}
 get memory():Readonly<{entries:number;entryChars:number;tasks:number;taskChars:number}> {
  try{this.runtime();}catch{this.invalidate();}
  return Object.freeze({entries:this.history.length,entryChars:this.history.reduce((n,e)=>n+JSON.stringify(e).length,0),tasks:this.tasks.size,taskChars:[...this.tasks.values()].reduce((n,t)=>n+t.text.length,0)});
 }
 remember(entry:DecisionEntry,expected:Admission,effective?:EffectiveSettings):void {this.retain(entry,expected,effective);}
 private retain(entry:DecisionEntry,expected:Admission,effective?:EffectiveSettings,a?:Attempt):boolean {
  const epoch=a?.epoch??this.epoch;
  try{
   if(this.disposed || this.epoch!==epoch || (a && !this.current(a)))return false;
   const r=this.runtime();
   if(!r || !r.config.enabled || this.disposed || this.epoch!==epoch || r.owner!==entry.owner || r.owner!==expected.owner || r.generation!==expected.generation || (a && (!this.current(a) || !isDeepStrictEqual(r.config,a.runtime.config))))return false;
   const projected=projectEntry(entry,effective);
   if(this.disposed || this.epoch!==epoch || (a && !this.current(a)))return false;
   this.history.push(projected);
   while(this.history.length>32 || this.history.reduce((n,e)=>n+JSON.stringify(e).length,0)>32768)this.history.shift();
   return true;
  }catch{/* Optional display memory never breaks host hooks. */return false;}
 }
 private taskKey(binding:ChildBinding,runtime:RoutingSnapshot):string {
  let session=this.sessions.get(binding.session);if(session===undefined){session=++this.sessionNumber;this.sessions.set(binding.session,session);}
  return JSON.stringify([runtime.owner,runtime.generation,binding.id,binding.toolCallId,binding.sessionKey,binding.generation,session]);
 }
 /** Optional count describes an already bounded prefix, never reconstructed text. */
 rememberTask(binding:ChildBinding,text:string,expected:Admission,originalChars:number=text.length):void {
  const epoch=this.epoch;
  try{const retained=text.slice(0,4096);
   if(!Number.isSafeInteger(originalChars) || originalChars<0 || originalChars<retained.length)return;
   const r=this.runtime();if(!r || !r.config.enabled || r.owner!==expected.owner || r.generation!==expected.generation || binding.owner!==r.owner || binding.disposed || !text.trim())return;
   const key=this.taskKey(binding,r);if(this.disposed || this.epoch!==epoch)return;
   this.tasks.delete(key);this.tasks.set(key,{text:retained,originalChars});
   while(this.tasks.size>16 || [...this.tasks.values()].reduce((n,t)=>n+t.text.length,0)>16384)this.tasks.delete(this.tasks.keys().next().value!);
  }catch{/* Bound plain task text only. Never native options/credentials. */}
 }
 /** Native eligible launch admission ONLY; independent of receipt/classifier success.
  * Standalone recommendations and retained apply must never call this method. */
 rememberEligibleTask(text:string,expected:Admission,originalChars:number=text.length,agent:string="recommendation"):void {
  const epoch=this.epoch;
  try {
   const retained=text.slice(0,4096);
   // Eligibility was checked on the full native prompt before truncation.
   // A known longer admitted task can have a wholly blank retained prefix;
   // refusing it would silently leave the previous launch as the why target.
   // Whole empty/blank inputs without admission truncation remain invalid.
   if(typeof agent!=="string" || !agent.trim() || (!text.trim() && (text.length!==4096 || originalChars<=text.length)) || !Number.isSafeInteger(originalChars) || originalChars<retained.length)return;
   const r=this.runtime();
   if(!r || !r.config.enabled || r.owner!==expected.owner || r.generation!==expected.generation || this.disposed || this.epoch!==epoch)return;
   this.eligibleTask={text:retained,originalChars,agent:agent.slice(0,1000)};
  }catch{/* Never retain options/credentials or reconstruct task text. */}
 }
 private binding(child:string,a:Attempt):ChildBinding|undefined {
  if(!id(child))return;
  const b=this.services.getBinding(child);
  if(!this.valid(a) || !b || b.owner!==a.runtime.owner || b.id!==child || b.disposed || !b.session || b.session.sessionId!==b.sessionKey || !Number.isSafeInteger(b.generation) || b.generation<=0 || !b.toolCallId)return;
  return {...b};
 }
 private currentBinding(b:ChildBinding,a:Attempt):boolean {
  const current=this.binding(b.id,a);
  return !!current && current.owner===b.owner && current.id===b.id && current.toolCallId===b.toolCallId && current.sessionKey===b.sessionKey && current.session===b.session && current.generation===b.generation;
 }
 private async evaluate(text:string,a:Attempt,binding?:ChildBinding,call:string=randomUUID(),agent:string="recommendation"):Promise<Proposal> {
  const signal=a.abort.signal;
  const pool=await pending(Promise.resolve(this.services.getCandidates(binding?{...binding}:undefined)),signal);
  if(!this.valid(a) || (binding && !this.currentBinding(binding,a)))throw new AtomicError("cancelled");
  if(pool.status!=="ready")return {reason:pool.reason};
  const models=structuredClone([...pool.models]);
  const ledger=normalizeLedger(structuredClone(await pending(Promise.resolve(this.services.getLedger()),signal)));
  if(!this.valid(a) || (binding && !this.currentBinding(binding,a)))throw new AtomicError("cancelled");
  let child:ChildContext|undefined;
  if(binding){
   const tokens=binding.session.getContextUsage()?.tokens??undefined;
   const actual=binding.session.model;
   child={contextTokens:tokens,current:{index:tierForModel(actual?`${actual.provider}/${actual.id}`:undefined,a.runtime.config),model:models.find(m=>m.provider===actual?.provider && m.id===actual?.id)}};
   if(!this.valid(a) || !this.currentBinding(binding,a))throw new AtomicError("cancelled");
  }
  const task:TaskSnapshot={owner:a.runtime.owner,generation:a.runtime.generation,toolCallId:call,prompt:text,agent:binding?"retained-child":agent,original:{}};
  const proposal=await pending((this.services.engine??propose)(task,structuredClone(a.runtime),models,spendSnapshot(ledger,a.runtime.config.budget),signal,child),signal);
  if(!this.valid(a) || (binding && !this.currentBinding(binding,a)))throw new AtomicError("cancelled");
  return proposal;
 }
 private recommendation(proposal:Proposal,a:Attempt,child?:string):CommandResult {
  const projected=projectEntry({version:1,owner:a.runtime.owner,child,action:proposal.decision?"proposed":"skipped",reason:proposal.decision?"recommendation only":safeReason(proposal.reason),analysis:proposal.analysis,decision:proposal.decision});
  const clean:Proposal={analysis:projected.analysis,decision:projected.decision,reason:safeReason(proposal.reason),...(proposal.degraded?{degraded:proposal.degraded.map(safeReason)}:{})};
  if(!this.retain(projected,{owner:a.runtime.owner,generation:a.runtime.generation},undefined,a))return warning("recommendation failed or cancelled");
  const result={...(proposal.analysis?info(prepareDecision(projected,true)):warning(prepareDecision(projected,true))),proposal:clean};
  return this.current(a)?result:warning("recommendation failed or cancelled");
 }
 async route(text:string,signal?:AbortSignal,call?:string):Promise<CommandResult> {
  if(!text.trim())return warning("usage: /jev-subagent-route TASK (recommendation only)");
  let work:ReturnType<CommandRouter["start"]>;
  try{work=this.start(true,signal);if(!work)return warning("inactive");const proposal=await this.evaluate(text,work.attempt,undefined,call);if(!this.valid(work.attempt))return warning("recommendation failed or cancelled");return this.recommendation(proposal,work.attempt);}
  catch{return warning("recommendation failed or cancelled");}finally{work?.finish();}
 }
 async command(args:string):Promise<CommandResult> {
  const tokens=args.trim().split(/\s+/).filter(Boolean),[sub="status",...rest]=tokens;
  if(!["status","on","off","mode","budget","why","suggest","apply","revert"].includes(sub))return warning(usage);
  if(["status","on","off","why"].includes(sub) && rest.length)return warning(usage);
  if(sub==="mode" && (rest.length!==1 || !["auto","confirm","notify"].includes(rest[0])))return warning(usage);
  if(sub==="budget" && rest.length && (rest.length!==2 || !["daily","monthly"].includes(rest[0]) || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rest[1]) || !Number.isFinite(Number(rest[1])) || Number(rest[1])<0))return warning(usage);
  if(sub==="suggest" && !(rest.length===0 || (rest.length===1 && rest[0]==="--write")))return warning(usage);
  if(sub==="revert" && (rest.length!==1 || !id(rest[0])))return warning(usage);
  if(sub==="apply" && (!rest.length || !id(rest[0]) || (rest.length>1 && (rest[1]!=="--" || rest.length<3))))return warning(usage);
  let work:ReturnType<CommandRouter["start"]>;
  try{
   const needsEnabled=["suggest","apply","revert"].includes(sub);
   work=this.start(needsEnabled);if(!work)return warning("inactive");const a=work.attempt;
   if(sub==="on" || sub==="off" || sub==="mode" || (sub==="budget" && rest.length)){
    const change:SessionChange=sub==="on" || sub==="off"?{enabled:sub==="on"}:sub==="mode"?{mode:rest[0] as Mode}:{budget:{[rest[0]==="daily"?"dailyUsd":"monthlyUsd"]:Number(rest[1])}};
    if(!this.valid(a,false))return warning("cancelled-or-stale");
    const changed=this.services.updateRuntime(change,{owner:a.runtime.owner,generation:a.runtime.generation});
    // Callback may intentionally invalidate the old generation; CAS result is truth.
    if(!changed)return warning("cancelled-or-stale");
    this.invalidate();return info(`${sub}: session only — persist manually in pi-jev-subagent-router.json; parent/global defaults unchanged`);
   }
   if(sub==="why"){
    if(!a.runtime.config.enabled)return warning("inactive");
    const task=this.eligibleTask;
    if(!task)return warning("no retained eligible child task after reload/owner/generation change; bounded in-memory context only");
    // Original launch was cold; an observed child is NOT a warm-cache baseline.
    const proposal=await this.evaluate(task.text,a,undefined,undefined,task.agent);
    if(task.originalChars>task.text.length && proposal.decision)proposal.decision.notes.push(`cached task truncated: ${task.originalChars} → ${task.text.length} characters`);
    if(!this.valid(a))return warning("recommendation failed or cancelled");
    const result=this.recommendation(proposal,a);
    if(task.originalChars>task.text.length && !proposal.decision && this.current(a))result.text+=`\ncached task truncated: ${task.originalChars} → ${task.text.length} characters`;
    return result;
   }
   if(sub==="status" || sub==="budget"){
    let ledger:Ledger|undefined;try{ledger=normalizeLedger(structuredClone(await pending(Promise.resolve(this.services.getLedger()),a.abort.signal)));}catch{/* unavailable is not zero */}
    if(!this.valid(a,false))return warning("cancelled-or-stale");
    let models:AvailableModel[]=[];try{const pool=await pending(Promise.resolve(this.services.getCandidates()),a.abort.signal);if(pool.status==="ready")models=structuredClone([...pool.models]);}catch{/* scope unknown */}
    if(!this.valid(a,false))return warning("cancelled-or-stale");
    const view=this.services.getView();if(!this.valid(a,false))return warning("cancelled-or-stale");
    const last=this.history.at(-1);
    return info(`${prepareStatus(a.runtime,ledger,models,view)}\nlast retained decision: ${last?`\n${prepareDecision(last,false)}`:"none"}`);
   }
   if(sub==="suggest")return await this.suggest(a,rest.length>0);
   const b=this.binding(rest[0],a);if(!b)return warning(usage);
   if(sub==="revert"){
    if(!this.valid(a) || !this.currentBinding(b,a))return warning("cancelled-or-stale");
    const outcome=await this.services.controller.revert({...b},structuredClone(a.runtime));return this.controlResult(outcome);
   }
   const cached=rest.length===1?this.tasks.get(this.taskKey(b,a.runtime)):undefined;
   const text=rest.length>1?args.trim().replace(/^apply\s+\S+\s+--\s+/,""):cached?.text;
   if(!text?.trim())return warning(usage);
   const proposal=await this.evaluate(text,a,b);
   if(cached && cached.originalChars>cached.text.length && proposal.decision)proposal.decision.notes.push(`cached task truncated: ${cached.originalChars} → ${cached.text.length} characters`);
   if(!this.valid(a) || !this.currentBinding(b,a))return warning("cancelled-or-stale");
   const outcome=await this.services.controller.apply({...b},proposal,structuredClone(a.runtime));
   // An acknowledged controller receipt is truth even after a late invalidation.
   try {
    if(this.valid(a) && this.currentBinding(b,a))this.remember({version:1,owner:a.runtime.owner,child:b.id,action:outcome.status==="committed"?"applied":outcome.status==="held"?"held":outcome.status==="notified"?"notified":outcome.status==="noop" || outcome.status==="kept"?"preserved":"skipped",reason:safeReason(outcome.reason),analysis:proposal.analysis,decision:proposal.decision},{owner:a.runtime.owner,generation:a.runtime.generation},outcome.receipt?.after.model?{model:`${outcome.receipt.after.model.provider}/${outcome.receipt.after.model.id}`,thinking:outcome.receipt.after.thinkingLevel}:undefined);
   }catch{/* Display callbacks cannot discard an acknowledged native outcome. */}
   return this.controlResult(outcome);
  }catch{return warning("command failed or cancelled");}finally{work?.finish();}
 }
 private controlResult(outcome:ControlOutcome):CommandResult {return {text:`child control: ${outcome.status} · ${safeReason(outcome.reason)}`,level:outcome.status==="rejected" || outcome.status==="degraded"?"warning":"info",control:outcome};}
 private async suggest(a:Attempt,write:boolean):Promise<CommandResult> {
  const loaded=loadScores(a.runtime.config.ranking.scoresFile);if(!loaded.ok)return warning("scores-unavailable");
  if(!this.valid(a))return warning("cancelled-or-stale");
  const pool=await pending(Promise.resolve(this.services.getCandidates()),a.abort.signal);
  if(!this.valid(a))return warning("cancelled-or-stale");if(pool.status!=="ready")return warning(safeReason(pool.reason));
  const suggestion=suggestRoutes(a.runtime.config,[...pool.models],loaded.scores);
  const json=JSON.stringify({routes:suggestion.routes,kindModels:suggestion.kindModels},null,2);
  const headline=`suggested ${Object.keys(suggestion.routes).length} tier(s) and ${Object.keys(suggestion.kindModels).length} kind specialist(s); ${suggestion.unmatched.length} unmatched in current authenticated scope (xpremium remains manual)`;
  if(!write)return info(`${headline}\npreview only: /jev-subagent-router suggest --write\n${json}`);
  if(!Object.keys(suggestion.routes).length && !Object.keys(suggestion.kindModels).length)return warning("nothing to write: no scored model matches current authenticated scope");
  const file=this.services.getGeneratedPath(structuredClone(a.runtime));
  if(!this.valid(a))return warning("cancelled-or-stale");
  if(!file || !isAbsolute(file) || basename(file)!=="pi-jev-subagent-router.generated.json" || resolve(file)===resolve(a.runtime.config.stateFile) || resolve(file)===resolve(a.runtime.config.ranking.scoresFile))return warning("generated-resource-unavailable");
  try {
   await withAtomicJson<Record<string,unknown>,void>(file,previous=>{
    // Admission repeated UNDER lock after waiting, not just before acquisition.
    if(!this.valid(a))throw new AtomicError("cancelled");
    const currentFile=this.services.getGeneratedPath(structuredClone(a.runtime));
    if(!this.valid(a) || currentFile!==file)throw new AtomicError("cancelled");
    if(previous!==undefined)generatedObject(previous);
    const current=previous??{};
    return {state:{...current,routes:{...(current.routes as Record<string,unknown>|undefined),...suggestion.routes},kindModels:{...(current.kindModels as Record<string,unknown>|undefined),...suggestion.kindModels}},value:undefined};
   },{signal:a.abort.signal});
  }catch{return warning("generated write refused or cancelled (existing bytes preserved)");}
  // Rename already committed: never say rollback on late invalidation/refresh failure.
  let refresh=false;try{refresh=this.valid(a);}catch{/* Commit remains truth on callback failure. */}
  if(!refresh)return {...info(`${headline}\ncommitted generated layer; runtime changed/unavailable, refresh deferred`),written:true};
  try{await this.services.reloadGenerated({owner:a.runtime.owner,generation:a.runtime.generation});}
  catch{return {...warning(`${headline}\ncommitted generated layer; refresh failed — reload manually; manual layers unchanged`),written:true};}
  return {...info(`${headline}\ncommitted generated layer; refresh requested, manual layers still win`),written:true};
 }
}
/** Only reviewed static reasons reach plaintext. Never echo raw errors/diagnostics. */
function safeReason(value:string|undefined):string {
 const allowed=["proposed","recommendation only","disabled","missing-api-key","cancelled","classification-failed","routing-failed","no-permitted-candidate","scope-unknown","scope-denied","unsupported","disposed","stale","stale-binding","stale-runtime","busy","degraded","outcome-unresolved","held","cache-held","sticky","notified","notify","kept","keep","noop","committed","committed-with-diagnostics","history-empty","history-conflict","restore-unavailable","in-flight","controller-invalidated","invalid-snapshot","snapshot-conflict","invalid-candidates","invalid-context","invalid-spend","analysis-required","missing-proposal-model","invalid-proposal","cancelled-or-stale","confirmation-failed","callback-failed","invalid-operation-id","invalid-clock","storage","invalid","unauthorized","capacity","not-found","operation-conflict","usage-unrecorded","usage-callback-failed"];
 return value && allowed.includes(value)?value:"unavailable";
}
interface NoticeUI {notify?:(text:string,level:"info"|"warning"|"error")=>void|Promise<void>}
function notifyResult(ui:NoticeUI|undefined,result:CommandResult):void {
 try{void Promise.resolve(ui?.notify?.(result.text,result.level)).catch(()=>{});}catch{/* cosmetic */}
}
export type CommandAPI=Partial<Pick<ExtensionAPI,"registerCommand"|"registerTool">>;
export function registerCommands(api:CommandAPI,router:Pick<CommandRouter,"command"|"route">):void {
 if(typeof api.registerCommand==="function"){
  try{api.registerCommand("jev-subagent-router",{description:"Child router status, session policy, ranking and explicit idle-child control",handler:async(args,ctx)=>{const result=await router.command(args);notifyResult(ctx.ui,result);}});}catch{/* optional API */}
  try{api.registerCommand("jev-subagent-route",{description:"Recommend a child model tier for specified task text; never launch or switch",handler:async(args,ctx)=>{const result=await router.route(args,ctx.signal);notifyResult(ctx.ui,result);}});}catch{/* optional API */}
 }
 if(typeof api.registerTool==="function")try{
  api.registerTool({name:"jev_subagent_route",label:"Jev Subagent Route",description:"Classify ONLY the supplied task and recommend a child model tier. Never spawns, switches or submits a child prompt.",annotations:{readOnlyHint:true,destructiveHint:false},parameters:Type.Object({request:Type.String({minLength:1,description:"Exact task text to classify; parent conversation is not included"})},{additionalProperties:false}),
   async execute(call,params,signal){const result=await router.route(params.request,signal,call);return {content:[{type:"text" as const,text:result.text}],details:result.proposal?{kind:"recommendation" as const,...result.proposal}:undefined,...(result.level==="warning"?{isError:true}:{})};},
  });
 }catch{/* optional API */}
}
