import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createAssistantMessageEventStream, type Api, type Model, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { ChildController, type ControlOutcome, type ScopedCandidates } from "../../src/children/controller";
import type { ChildBinding, RoutingSnapshot } from "../../src/contracts";
import { rootOwnerId } from "../../src/state/accounting";
import { decide, estimateCachePenaltyUsd, tierForModel } from "../../src/core/router";
import { config, analysis } from "../support/fixtures";
import { isolatedChild } from "../support/isolated-child";
import { validateIsolation } from "../support/agent-dir-preload";
import { nativeCall, type NativeToolCall } from "../../scripts/probe/tintin-native";
import { bounded, check, withNativeFixture } from "../../scripts/compatibility-probe";

interface NativeFixture {
 parent:AgentSession;
 registry:unknown;
 models:Model<Api>[];
 witnesses:{model:{provider:string;id:string};thinking:string}[];
 cwd:string;
 enqueue:(call:NativeToolCall)=>void;
 deferAuthentication:()=>{entered:Promise<void>;release:()=>void};
 settingsUnchanged:()=>Promise<boolean>;
 sdk:{resolveModelScopeFromModels:(patterns:string[],models:readonly Model<Api>[])=>{scopedModels:{model:Model<Api>}[];diagnostics:readonly unknown[]}};
}
function deferred(){let release!:()=>void;const promise=new Promise<void>(yes=>release=yes);return {promise,release};}
function observe(session:AgentSession){return {model:session.model?.id,provider:session.model?.provider,thinking:session.thinkingLevel,messages:structuredClone(session.messages),entries:structuredClone(session.sessionManager.getEntries())};}

async function nativeCacheProof(roots:{hostRoot:string;tintinRoot:string}){
 return withNativeFixture(roots,async(raw:unknown)=>{
  const f=raw as NativeFixture;
  await writeFile(join(f.cwd,".pi","settings.json"),JSON.stringify({enabledModels:["jev-compat-*/*:high"]}));
  const args={subagent_type:"omitted",description:"native-cache",prompt:"NATIVE-CACHE-CONTEXT",model:"jev-compat-parent/parent",thinking:"off",isolated:true,inherit_context:false,run_in_background:false};
  const record=await bounded(nativeCall(f.parent,{id:"cache-spawn",name:"Agent",arguments:args},f.enqueue),"cache retained child");
  const child:AgentSession=record.session;
  check(record.status==="completed" && child.isIdle,"Cache child not retained completed/idle");
  const receipt=f.parent.messages.find(m=>m.role==="toolResult" && m.toolCallId==="cache-spawn");
  check(receipt?.role==="toolResult" && !receipt.isError && (receipt.details as {agentId?:string})?.agentId===record.id,"Cache origin receipt missing");
  const tokens=child.getContextUsage()?.tokens;
  check(typeof tokens==="number" && tokens>0,"No actual native public context tokens; do not claim cache witness");
  const owner=rootOwnerId(f.cwd,f.parent.sessionId),binding:ChildBinding={owner,id:record.id,toolCallId:"cache-spawn",session:child,sessionKey:child.sessionId,generation:1,disposed:false};
  const runtime:RoutingSnapshot={owner,generation:1,config:config()};Object.assign(runtime.config,{mode:"auto",stickiness:false,kindModels:{},kindMinimumTier:{},confidenceThreshold:0});
  runtime.config.cache={aware:true,deadband:.2,maxPenaltyUsd:.01,bypassTierDelta:2};
  runtime.config.routes={quick:[],standard:[{provider:"jev-compat-parent",model:"parent"}],high:[{provider:"jev-compat-allowed",model:"allowed",thinkingLevel:"high"}],premium:[{provider:"jev-compat-allowed",model:"allowed",thinkingLevel:"high"}],xpremium:[]};
  const candidates=():ScopedCandidates=>{
   const patterns=JSON.parse(readFileSync(join(f.cwd,".pi","settings.json"),"utf8")).enabledModels;
   const resolved=f.sdk.resolveModelScopeFromModels(patterns,f.parent.modelRuntime.getAvailableSnapshot());
   check(!resolved.diagnostics.length && resolved.scopedModels.length>0,"Cache strict public scope failed");
   return {status:"ready",models:resolved.scopedModels.map(({model})=>({provider:model.provider,id:model.id,cost:model.cost}))};
  };
  const list=candidates();check(list.status==="ready","Cache candidates missing");
  const current=list.models.find(m=>m.provider==="jev-compat-parent" && m.id==="parent")!,target=list.models.find(m=>m.provider==="jev-compat-allowed" && m.id==="allowed")!;
  const penalty=estimateCachePenaltyUsd(tokens,current,target);check(penalty>runtime.config.cache.maxPenaltyUsd && penalty>0,"Cache penalty not nonzero/expensive");
  const controller=new ChildController({getRuntime:()=>runtime,getBinding:()=>binding,getRegistry:()=>f.registry,getCandidates:candidates,getSpend:()=>({today:0,month:0,pressure:0})});
  const initial=observe(child),parentBefore=observe(f.parent),projectSettings=readFileSync(join(f.cwd,".pi","settings.json"),"utf8"),state=JSON.stringify(child.agent.state),executions=f.witnesses.length;
  const holds:{kind:string;notes:string[];status:string;reason:string}[]=[];
  const proposal=(score:number)=>{const a=analysis({complexity:score,budgetIntensity:score,deepReasoning:.5});return {analysis:a,decision:decide(a,runtime.config,{models:list.models,spend:{today:0,month:0,pressure:0}})};};
  try{
   for(const kind of ["same-tier","deadband","outside-band-penalty"] as const){
    runtime.config.routes.standard=kind==="same-tier"?[{provider:target.provider,model:target.id,thinkingLevel:"high"},{provider:current.provider,model:current.id}]:[{provider:current.provider,model:current.id}];
    const p=proposal(kind==="same-tier"?1:kind==="deadband"?1.55:2);
    const decision=decide(p.analysis!,runtime.config,{models:list.models,spend:{today:0,month:0,pressure:0},contextTokens:tokens,current:{index:tierForModel(`${current.provider}/${current.id}`,runtime.config),model:current}});
    check(decision?.held && decision.notes.some(n=>n.includes(kind==="same-tier"?"same-tier swap":kind==="deadband"?"inside the standard band":"cache penalty")),`Missing measured ${kind} cache notes`);
    const result=await bounded(controller.apply(binding,p,runtime),`native cache ${kind} hold`);
    check(result.status==="held" && result.reason==="cache-held",`Cache ${kind} was not held`);
    check(JSON.stringify(observe(child))===JSON.stringify(initial) && JSON.stringify(child.agent.state)===state,"Held control changed exact pair/transcript/native state or appended apply trace");
    check(controller.history(binding).length===0 && f.witnesses.length===executions,"Held control changed history or ran provider");
    check(JSON.stringify(observe(f.parent))===JSON.stringify(parentBefore) && await f.settingsUnchanged() && readFileSync(join(f.cwd,".pi","settings.json"),"utf8")===projectSettings,"Held control changed parent/settings");
    holds.push({kind,notes:decision.notes,status:result.status,reason:result.reason});
   }
   const p=proposal(3),allowed=decide(p.analysis!,runtime.config,{models:list.models,spend:{today:0,month:0,pressure:0},contextTokens:tokens,current:{index:1,model:current}});
   check(allowed && !allowed.held && allowed.tierIndex===3,"Same expensive pricing failed big-tier bypass");
   const applied=await bounded(controller.apply(binding,p,runtime),"native expensive-cache bypass apply");
   check(applied.status==="committed" && applied.receipt?.after.model?.id==="allowed" && applied.receipt.after.thinkingLevel==="high" && child.model?.id==="allowed" && child.thinkingLevel==="high" && controller.history(binding).length===1,"Cache bypass exact pair/history ack missing");
   const restored=await bounded(controller.revert(binding,runtime),"native cache exact revert");
   check(restored.status==="committed" && restored.receipt?.after.model?.provider===current.provider && restored.receipt.after.model.id===current.id && restored.receipt.after.thinkingLevel==="off" && controller.history(binding).length===0,"Cache exact restore receipt/history missing");
   check(child.model?.provider===current.provider && child.model?.id===current.id && observe(child).thinking==="off","Restored public child pair wrong");
   check(JSON.stringify(child.messages)===JSON.stringify(initial.messages) && JSON.stringify(child.agent.state)===state && JSON.stringify(observe(f.parent))===JSON.stringify(parentBefore),"Cache apply/revert mutated conversation/parent/native state");
   check(f.witnesses.length===executions,"Controller ran a provider");
   const changes=child.sessionManager.getEntries().slice(initial.entries.length);
   check(changes.length===4 && changes.filter(e=>e.type==="model_change" || e.type==="thinking_level_change").length===4,"Cache bypass/revert not exactly two acknowledged pairs");
   check(await f.settingsUnchanged() && readFileSync(join(f.cwd,".pi","settings.json"),"utf8")===projectSettings,"Cache control mutated settings");
   await bounded(nativeCall(f.parent,{id:"cache-resume",name:"Agent",arguments:{...args,resume:record.id,prompt:"Test-only observe restored cache pair"}},f.enqueue),"test-only native cache resume");
   binding.toolCallId="cache-resume";
   check(record.session===child && f.witnesses.length===executions+1 && f.witnesses.at(-1)?.model.provider===current.provider && f.witnesses.at(-1)?.model.id===current.id && f.witnesses.at(-1)?.thinking==="off","Test-only native resume did not witness exact restored pair");
   return {fixturePricing:"authored-fake-provider-no-invoice",tokens,penaltyUsd:penalty,maxPenaltyUsd:runtime.config.cache.maxPenaltyUsd,holds,bypassTierDelta:2,apply:applied.status,revert:restored.status,historyDepth:controller.history(binding).length,controlProviderExecutions:0,testResumeProviderExecutions:1,configurationEntries:changes.length,restoredPairWitness:true,parentPreserved:true,settingsPreserved:true};
  }finally{controller.dispose();await bounded(child.abort(),"cache child cleanup abort");child.dispose();}
 },{modelCosts:{parent:{input:1,output:1,cacheRead:1,cacheWrite:0},allowed:{input:1_000_000,output:1,cacheRead:0,cacheWrite:1_000_000}}});
}

async function nativeControllerProof(){
 validateIsolation();
 const hostRoot=process.env.PI_PATCHED_HOST_ROOT,tintinRoot=process.env.PI_PATCHED_TINTIN_ROOT;
 check(hostRoot && tintinRoot,"Explicit local patched roots required, never skip");
 const cells=[];
 for(const phase of ["pair-resume","resume-race","queued-work","queued-resume","compaction","cancel","disposal","context-switch"] as const){
  const cell=await withNativeFixture({hostRoot,tintinRoot},async(raw:unknown)=>{
   const f=raw as NativeFixture;
   const started=deferred(),released=deferred();let armed=false;let nextStarted:(()=>void)|undefined;
   const witnesses:{model:string;thinking:string}[]=[];
   const beforeModel:Model<Api>={...f.models[0],id:"before",name:"Controller before",provider:"jev-compat-before"};
   // Public provider registration, not replacement of SDK/backend methods.
   const stream=(_model:Model<Api>,_context:Context,options?:{signal?:AbortSignal;reasoning?:string})=>{
    const events=createAssistantMessageEventStream();const gated=armed;
    witnesses.push({model:beforeModel.id,thinking:options?.reasoning??"off"});
    const message:AssistantMessage={role:"assistant",api:beforeModel.api,provider:beforeModel.provider,model:beforeModel.id,timestamp:Date.now(),stopReason:"stop",content:[{type:"text",text:"Controller native answer."}],
     usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    void (async()=>{const abort=()=>released.release();options?.signal?.addEventListener("abort",abort,{once:true});try{
     events.push({type:"start",partial:message});if(gated){started.release();const notify=nextStarted;nextStarted=undefined;notify?.();await released.promise;}
     if(options?.signal?.aborted){message.stopReason="aborted";message.errorMessage="Fixture aborted";events.push({type:"error",reason:"aborted",error:message});}
     else {events.push({type:"text_start",contentIndex:0,partial:message});events.push({type:"text_delta",contentIndex:0,delta:"Controller native answer.",partial:message});events.push({type:"text_end",contentIndex:0,content:"Controller native answer.",partial:message});events.push({type:"done",reason:"stop",message});}
    }finally{options?.signal?.removeEventListener("abort",abort);events.end();}})();return events;
   };
   f.parent.modelRuntime.registerNativeProvider({id:beforeModel.provider,name:beforeModel.name,getModels:()=>[beforeModel],stream,streamSimple:stream,
    auth:{apiKey:{name:"Local fixture",check:async()=>({type:"api_key",source:"controller-fixture"}),resolve:async()=>({auth:{apiKey:"not-a-real-key"}})}}});
   await bounded(f.parent.modelRuntime.refresh({allowNetwork:false}),"controller provider registration");
   // Approved public explicit-control globs; project overrides global scope.
   await writeFile(join(f.cwd,".pi","settings.json"),JSON.stringify({enabledModels:["jev-compat-*/*:high"]}));
   const args={subagent_type:"omitted",description:phase,prompt:"CONTROLLER-NATIVE-WITNESS",model:"jev-compat-before/before",thinking:"off",isolated:true,inherit_context:false,run_in_background:false};
   const record=await bounded(nativeCall(f.parent,{id:`${phase}-spawn`,name:"Agent",arguments:args},f.enqueue),"controller retained foreground child");
   const child:AgentSession=record.session;
   check(record.status==="completed" && child.isIdle,"No retained completed idle child");
   const owner=rootOwnerId(f.cwd,f.parent.sessionId);
   // Exact native receipt/provenance, not a persisted entry or lineage alone.
   const receipt=f.parent.messages.find(m=>m.role==="toolResult" && m.toolCallId===`${phase}-spawn`);
   check(receipt?.role==="toolResult" && !receipt.isError && (receipt.details as {agentId?:string})?.agentId===record.id,"No validated Task9 origin association");
   const binding:ChildBinding={owner,id:record.id,toolCallId:`${phase}-spawn`,session:child,sessionKey:child.sessionId,generation:1,disposed:false};
   const runtime:RoutingSnapshot={owner,generation:1,config:config()};Object.assign(runtime.config,{mode:"auto",stickiness:false,kindModels:{},kindMinimumTier:{}});
   runtime.config.routes={quick:[],standard:[{provider:beforeModel.provider,model:beforeModel.id}],high:[{provider:"jev-compat-allowed",model:"allowed",thinkingLevel:"high"}],premium:[],xpremium:[]};
   runtime.config.cache.aware=true;
   const candidates=():ScopedCandidates=>{
    const settings:unknown=JSON.parse(readFileSync(join(f.cwd,".pi","settings.json"),"utf8"));
    if(!settings || typeof settings!=="object" || !("enabledModels" in settings) || !Array.isArray(settings.enabledModels) || !settings.enabledModels.every(x=>typeof x==="string"))return {status:"rejected",reason:"scope-unknown"};
    const universe=f.parent.modelRuntime.getAvailableSnapshot();
    const resolved=f.sdk.resolveModelScopeFromModels(settings.enabledModels,universe);
    if(resolved.diagnostics.length || !resolved.scopedModels.length)return {status:"rejected",reason:"scope-denied"};
    return {status:"ready",models:resolved.scopedModels.map(({model})=>({provider:model.provider,id:model.id,cost:model.cost}))};
   };
   const controller=new ChildController({getRuntime:()=>runtime,getBinding:()=>binding,getRegistry:()=>f.registry,getCandidates:candidates,getSpend:()=>({today:0,month:0,pressure:0})});
   const a=analysis({complexity:2,budgetIntensity:2,deepReasoning:0.5});
   const list=candidates();check(list.status==="ready","Fixture strict scope failed");
   const proposal={analysis:a,decision:decide(a,runtime.config,{models:list.models,spend:{today:0,month:0,pressure:0}})};
   const initial=observe(child),parentBefore=observe(f.parent);
   const childState=JSON.stringify(child.agent.state);
   let pending:Promise<ControlOutcome>|undefined,execution:Promise<unknown>|undefined;
   let result:ControlOutcome|undefined,restore:ControlOutcome|undefined;
   let authentication:ReturnType<NativeFixture["deferAuthentication"]>|undefined;
   let actualRestoredWitness=false;
   try{
    if(phase==="pair-resume"){
     result=await bounded(controller.apply(binding,proposal,runtime),"production controller apply");
     check(result.status==="committed" && controller.history(binding).length===1,`Controller did not commit: ${JSON.stringify(result)}`);
     check(child.model?.id==="allowed" && child.thinkingLevel==="high","Controller target pair absent");
     restore=await bounded(controller.revert(binding,runtime),"production controller revert");
     check(restore.status==="committed" && controller.history(binding).length===0,"Controller did not acknowledge exact restore");
     check(observe(child).model==="before" && observe(child).thinking==="off","Controller failed exact pair restoration");
     check(JSON.stringify(child.messages)===JSON.stringify(initial.messages) && JSON.stringify(child.agent.state)===childState,"Controller changed child conversation/native state");
     check(JSON.stringify(observe(f.parent))===JSON.stringify(parentBefore),"Controller mutated parent transcript/pair");
     const entries=child.sessionManager.getEntries();check(JSON.stringify(entries.slice(0,initial.entries.length))===JSON.stringify(initial.entries),"Controller rewrote historical transcript");
     const changes=entries.slice(initial.entries.length).filter(e=>e.type==="model_change" || e.type==="thinking_level_change");
     check(changes.length===4,"Controller apply/revert did not append exactly two atomic pairs");
     await bounded(nativeCall(f.parent,{id:`${phase}-resume`,name:"Agent",arguments:{...args,resume:record.id,prompt:"Observe actual restored pair"}},f.enqueue),"native resume after controller restoration");
     actualRestoredWitness=witnesses.at(-1)?.model==="before" && witnesses.at(-1)?.thinking==="off";
     check(actualRestoredWitness && record.session===child,"Native fake provider did not observe restored SDK pair");
    }else{
     if(phase==="compaction"){
      child.settingsManager.applyOverrides({compaction:{enabled:false,keepRecentTokens:1,reserveTokens:256}});
      await bounded(nativeCall(f.parent,{id:`${phase}-warmup`,name:"Agent",arguments:{...args,resume:record.id,prompt:"Another completed child turn"}},f.enqueue),"compaction warmup");
      binding.toolCallId=`${phase}-warmup`; // validated native receipt, same SDK lifetime
     }
     authentication=f.deferAuthentication();
     pending=controller.apply(binding,proposal,runtime);
     await bounded(Promise.race([authentication.entered,pending.then(r=>{throw Error(`Controller settled before auth barrier: ${JSON.stringify(r)}`);})]),"production controller auth barrier");
     if(phase==="resume-race"){
      armed=true;execution=nativeCall(f.parent,{id:`${phase}-resume`,name:"Agent",arguments:{...args,resume:record.id,prompt:"Race native foreground continuation"}},f.enqueue);void execution.catch(()=>{});
      await bounded(started.promise,"native resumed provider barrier");check(!child.isIdle,"Native resume not active");
     }else if(phase==="queued-work"){
      child.agent.followUp({role:"user",content:"Queued native child work",timestamp:Date.now()});
      check(child.agent.hasQueuedMessages() && child.agent.peekQueuedMessages().length===1,"Native queued work absent");
     }else if(phase==="queued-resume"){
      armed=true;let capacityObserved=false;
      // No backend/config monkeypatch: use real public background Agent calls
      // until the pinned native capacity (default ten) visibly queues a record.
      for(let i=0;i<12;i++){
       const ready=deferred();nextStarted=ready.release;
       const blocker=await bounded(nativeCall(f.parent,{id:`${phase}-blocker-${i}`,name:"Agent",arguments:{...args,prompt:"Hold native background capacity",run_in_background:true}},f.enqueue,{allowPendingBackground:true}),"native capacity blocker");
       if(blocker.status==="queued"){nextStarted=undefined;capacityObserved=true;break;}
       await bounded(ready.promise,"background provider barrier");
      }
      check(capacityObserved,"No native capacity queue observed; do not claim success");
      const streams=witnesses.length;
      await bounded(nativeCall(f.parent,{id:`${phase}-resume`,name:"Agent",arguments:{...args,resume:record.id,prompt:"Queue retained child continuation",run_in_background:true}},f.enqueue,{allowPendingBackground:true}),"native retained queued resume");
      check(record.status==="queued" && record.session===child && child.isIdle && witnesses.length===streams,"Native retained child was not queued without starting");
     }else if(phase==="compaction"){
      armed=true;execution=child.compact();void execution.catch(()=>{});
      await bounded(Promise.race([started.promise,execution.then(()=>{throw Error("Compaction did not enter provider");})]),"native compaction provider barrier");check(child.isCompacting,"Actual public compaction not active");
     }else if(phase==="cancel")controller.invalidate();
     else if(phase==="disposal")child.dispose();
     else if(phase==="context-switch"){
      check(f.parent.extensionRunner,"Public extension runner missing");
      await f.parent.extensionRunner.emit({type:"session_before_switch",reason:"new"});
     }
     const afterNative=observe(child),nativeParent=observe(f.parent);
     authentication.release();result=await bounded(pending,"production controller race refusal");
     check(result.status==="rejected",`Race not refused: ${JSON.stringify(result)}`);
     check(JSON.stringify(observe(child))===JSON.stringify(afterNative),"Controller changed child after independent lifecycle activity");
     check(JSON.stringify(observe(f.parent))===JSON.stringify(nativeParent),"Controller changed parent after independent native activity");
     check(child.model?.id==="before" && child.thinkingLevel==="off" && controller.history(binding).length===0,"Refusal changed pair/history");
    }
    check(await f.settingsUnchanged(),"Controller mutated global settings/defaults");
    return {phase,result:result?.status,reason:result?.reason,restore:restore?.status,actualRestoredWitness,depth:controller.history(binding).length,parentPreserved:true,settingsPreserved:true,
     supportedIdentityInvalidation:phase==="context-switch",queueLayer:phase==="queued-work"?"native-Agent-followUp":phase==="queued-resume"?"Tintin-native-background-capacity":"not-applicable",replacement:"not-applicable",ownershipTransfer:"not-applicable"};
   }finally{
    controller.dispose();armed=false;authentication?.release();released.release();child.agent.clearAllQueues();
    if(pending)await bounded(pending,"pending controller cleanup");
    if(execution)await bounded(execution,"native execution cleanup");
    if(phase==="queued-resume")await bounded((f.registry as {waitForAll:()=>Promise<void>}).waitForAll(),"native capacity settlement");
    await bounded(child.abort(),"retained child abort");child.dispose();
   }
  });cells.push(cell);
 }
 const cache=await nativeCacheProof({hostRoot,tintinRoot});
 return {runtime:"local-patched-only",productionController:true,cells,cache,fullRouterParityVerified:false};
}
if(process.argv.includes("--controller-native-child")){
 try{console.log(JSON.stringify(await nativeControllerProof()));}catch(error){console.error(error);process.exitCode=1;}
}else test("production controller public-native apply/revert/resume and authentication races",async()=>{
 if(!process.env.PI_PATCHED_HOST_ROOT || !process.env.PI_PATCHED_TINTIN_ROOT)throw Error("Explicit native opt-in required");
 const spec=isolatedChild("run",[resolve(import.meta.path),"--controller-native-child"]),child=Bun.spawn(spec.argv,{env:spec.env,stdout:"pipe",stderr:"pipe"});
 const timer=setTimeout(()=>child.kill(),90_000);
 try{const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({exit,err}).toEqual({exit:0,err:""});
  const report=JSON.parse(out);expect(report.productionController).toBe(true);expect(report.runtime).toBe("local-patched-only");expect(report.fullRouterParityVerified).toBe(false);expect(report.cells).toHaveLength(8);
  expect(report.cache.tokens).toBeGreaterThan(0);expect(report.cache.penaltyUsd).toBeGreaterThan(report.cache.maxPenaltyUsd);
  expect(report.cache.holds.map((h:any)=>h.kind)).toEqual(["same-tier","deadband","outside-band-penalty"]);
  for(const h of report.cache.holds){expect(h).toMatchObject({status:"held",reason:"cache-held"});expect(h.notes.length).toBeGreaterThan(0);}
  expect(report.cache).toMatchObject({fixturePricing:"authored-fake-provider-no-invoice",apply:"committed",revert:"committed",historyDepth:0,controlProviderExecutions:0,testResumeProviderExecutions:1,configurationEntries:4,restoredPairWitness:true,parentPreserved:true,settingsPreserved:true,shutdownListenerCount:0,networkFetchAttempts:0});
  console.log(`Native cache measurement: ${JSON.stringify(report.cache)}`);
  expect(report.cells[0]).toMatchObject({result:"committed",restore:"committed",actualRestoredWitness:true,depth:0});
  for(const c of report.cells){expect(c.parentPreserved).toBe(true);expect(c.settingsPreserved).toBe(true);expect(c.networkFetchAttempts).toBe(0);expect(c.shutdownListenerCount).toBe(0);if(c.phase!=="pair-resume")expect(c.result).toBe("rejected");}
 }finally{clearTimeout(timer);}
},95_000);
