import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AccountingStore, rootOwnerId } from "../../src/state/accounting";
import { ChildObserver, observerEntryType, type ObserverEntry } from "../../src/tintin/observer";
import { declaredPublicEntry, dependencyPackageRoot } from "../../scripts/probe/public-package";
import { prepareNativeFiles, createNativeParent, nativeCall, shutdownNative, managerKey, type NativeToolCall } from "../../scripts/probe/tintin-native";
import { withNativeCleanup } from "../../scripts/probe/native-cleanup";
import { bounded, check } from "../../scripts/compatibility-probe";
import { validateIsolation } from "../support/agent-dir-preload";
import { isolatedChild } from "../support/isolated-child";

async function nativeObserverFixture() {
 validateIsolation();const host=process.env.PI_PROBE_HOST_ROOT;check(host,"Explicit public host root required");
 const tintin=resolve("node_modules/@tintinweb/pi-subagents");
 const sdkEntry=await declaredPublicEntry(host),selected=await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-coding-agent",tintin));
 check(await realpath(selected)===await realpath(sdkEntry),"Different Tintin SDK dependency");
 const root=await mkdtemp(join(tmpdir(),"native-observer-")),cwd=join(root,"project"),agentDir=process.env.PI_CODING_AGENT_DIR!;
 const oldCwd=process.cwd(),oldFetch=globalThis.fetch,cleanup:(()=>void)[]=[];
 let parent:any,observer:ChildObserver|undefined,extension:any,network=0,listeners=0,release:()=>void=()=>{};
 const warnings:string[]=[],observations:string[]=[];let pending:NativeToolCall|undefined,hold:Promise<void>|undefined;
 const value=await withNativeCleanup(async()=>{
  await mkdir(cwd);await prepareNativeFiles(cwd,agentDir);process.chdir(cwd);
  const deny=()=>{network++;throw Error("Network forbidden");};globalThis.fetch=Object.assign(deny,{preconnect:deny}) as any;
  const sdk:any=await bounded(import(pathToFileURL(sdkEntry).href),"public SDK");
  const ai:any=await bounded(import(pathToFileURL(await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-ai",host))).href),"public provider");
  const runtime=await bounded<any>(sdk.ModelRuntime.create({authPath:join(agentDir,"fake-auth.json"),modelsPath:null,modelsStorePath:join(agentDir,"fake-models.json"),allowModelNetwork:false,refreshOnCreate:false}),"fake runtime");
  const model={id:"observer",provider:"jev-observer-local",name:"Observer local fixture",api:"jev-observer",baseUrl:"https://invalid.invalid",reasoning:true,input:["text"],contextWindow:32768,maxTokens:128,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const stream=(_m:any,context:any)=>{
   const events=ai.createAssistantMessageEventStream();
   const text=context.messages.filter((m:any)=>m.role==="user").map((m:any)=>typeof m.content==="string"?m.content:m.content.filter((c:any)=>c.type==="text").map((c:any)=>c.text).join("\n")).join("\n");
   const isParent=text.includes("Execute the deterministic native call "),call=isParent?pending:undefined;if(call)pending=undefined;
   const barrier=isParent?undefined:hold;if(!isParent)hold=undefined;
   const message:any={role:"assistant",api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:call?"toolUse":"stop",
    content:call?[{type:"toolCall",id:call.id,name:"Agent",arguments:call.arguments}]:[{type:"text",text:"Local native answer"}],
    usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:isParent?0:0.2}}};
   queueMicrotask(()=>{void (async()=>{
    events.push({type:"start",partial:message});if(barrier)await barrier;
    if(call){events.push({type:"toolcall_start",contentIndex:0,partial:message});events.push({type:"toolcall_delta",contentIndex:0,delta:JSON.stringify(call.arguments),partial:message});events.push({type:"toolcall_end",contentIndex:0,toolCall:message.content[0],partial:message});}
    else{events.push({type:"text_start",contentIndex:0,partial:message});events.push({type:"text_delta",contentIndex:0,delta:message.content[0].text,partial:message});events.push({type:"text_end",contentIndex:0,content:message.content[0].text,partial:message});}
    events.push({type:"done",reason:message.stopReason,message});events.end();
   })().catch(e=>events.error(e));});return events;
  };
  runtime.registerNativeProvider({id:model.provider,name:model.name,getModels:()=>[model],stream,streamSimple:stream,auth:{apiKey:{name:"Fake",check:async()=>({type:"api_key",source:"local"}),resolve:async()=>({auth:{apiKey:"not-a-real-key"}})}}});
  await bounded(runtime.refresh({allowNetwork:false}),"provider ready");
  const underlying=sdk.createEventBus(),eventBus={emit:underlying.emit.bind(underlying),on(c:string,fn:any){listeners++;const off=underlying.on(c,fn);let live=true;return ()=>{if(live){live=false;listeners--;off();}};}};
  const file=join(root,"ledger.json"),store=new AccountingStore(file),entries:ObserverEntry[]=[];
  const factory=(pi:any)=>{
   extension=pi;
   pi.on("session_start",(_e:any,ctx:any)=>{
    observer?.dispose();observer=new ChildObserver({owner:rootOwnerId(cwd,ctx.sessionManager.getSessionId()),eventBus:pi.events,
     getOwner:()=>rootOwnerId(cwd,ctx.sessionManager.getSessionId()),store:{file,registerOrigin:store.registerOrigin.bind(store),observe:async o=>{observations.push(o.reportedCumulativeUsd?.toString()??"missing");return store.observe(o);}},
     appendEntry:(type,e)=>{entries.push(structuredClone(e));pi.appendEntry(type,e);},warn:code=>{warnings.push(code);}});
   });
   pi.on("tool_call",(e:any)=>observer?.observeToolCall(e));pi.on("tool_result",(e:any)=>observer?.observeToolResult(e));pi.on("session_shutdown",()=>observer?.dispose());
   cleanup.push(pi.events.on("subagents:completed",(data:any)=>pi.events.emit("subagents:rpc:consume",{requestId:"consume-"+data.id,agentId:data.id})));
  };
  const pkg=JSON.parse(await readFile(join(tintin,"package.json"),"utf8"));
  parent=await createNativeParent(sdk,cwd,agentDir,join(tintin,pkg.main??"dist/index.js"),runtime,model,
   sdk.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:{enabled:false}},{projectTrusted:true}),
   async result=>{try{await bounded(shutdownNative(result.session),"late shutdown");}finally{result.session.dispose();}},{eventBus,extensionFactories:[factory]});
  check(observer,"Production observer missing after public session_start");
  cleanup.push(parent.subscribe((event:any)=>observer?.observeHostEvent(event)));
  const enqueue=(call:NativeToolCall)=>{check(!pending,"Pending native call");pending=call;};
  const registry=(globalThis as any)[managerKey];
  for(const background of [false,true]){
   const id=background?"bg-spawn":"fg-spawn",args={subagent_type:"probe",description:id,prompt:"Local fixture task",model:"jev-observer-local/observer",thinking:"off",isolated:true,inherit_context:false,run_in_background:background};
   const r=await bounded(nativeCall(parent,{id,name:"Agent",arguments:args},enqueue,{allowPendingBackground:true}),"native spawn");
   await bounded(registry.waitForAll(),"native settlement");await observer.flush();
   const initial=entries.filter(e=>e.origin.childId===r.id).at(-1);check(initial?.sdkSessionId===r.session.sessionId,"Observer did not bind real ready SDK child");
   const lifetime=r.session;
   if(background)hold=new Promise<void>(resolve=>release=resolve);
   await bounded(nativeCall(parent,{id:id+"-resume",name:"Agent",arguments:{...args,resume:r.id,prompt:"Local continuation"}},enqueue),"same-mode native resume");
   await observer.flush();check(r.session===lifetime,"Native resume replaced session");
   if(background){const before=JSON.parse(await readFile(file,"utf8")).accounting.records[initial!.accountingId];check(before.accountedUsd==="0.2" && before.pricing.reasons.includes("observation-gap"),"Resume gap absent before new stream money");release();}
   await bounded(registry.waitForAll(),"resume completion");await observer.flush();
   const ledger=JSON.parse(await readFile(file,"utf8"));check(ledger.accounting.records[initial!.accountingId].accountedUsd==="0.4","Real lifetime cumulative cost not reconciled");
   const last=entries.filter(e=>e.origin.childId===r.id).at(-1)!;check(last.accountingId===initial!.accountingId && last.generation>initial!.generation,"Resume origin or generation wrong");
   const receipt=parent.messages.find((m:any)=>m.role==="toolResult" && m.toolCallId===id);const saved=JSON.stringify(receipt);
   observer.observeToolResult({toolName:"Agent",toolCallId:id+"-resume",details:{agentId:r.id},usage:{cost:{total:99}}});extension.events.emit("subagents:completed",{id:r.id,usage:{cost:{total:99}}});await observer.flush();
   check(JSON.stringify(receipt)===saved,"Observer changed native receipt");
  }
  const ledger=JSON.parse(await readFile(file,"utf8"));check(Object.keys(ledger.accounting.records).length===2,"Wrong lifetime count");
  check(Object.values(ledger.accounting.exactDays).every((b:any)=>b.total==="0.8"),"Replay/pool counted more than real .8");
  const retained=parent.sessionManager.getEntries().filter((e:any)=>e.type==="custom" && e.customType===observerEntryType).map((e:any)=>e.data);
  check(retained.length>=4,"Public appendEntry seam did not persist bindings");
  observer.dispose();observer=new ChildObserver({owner:retained[0].owner,store:new AccountingStore(file),eventBus:extension.events,appendEntry:(t,e)=>extension.appendEntry(t,e),warn:code=>{warnings.push(code);}});
  for(const e of [retained.filter((e:any)=>e.origin.spawnToolCallId==="fg-spawn").at(-1),retained.filter((e:any)=>e.origin.spawnToolCallId==="bg-spawn").at(-1)])observer.restore(e,parent.messages);
  await observer.flush();check(observer.status==="observing","Native reload public history revalidation failed");
  check(Object.values(JSON.parse(await readFile(file,"utf8")).accounting.exactDays).every((b:any)=>b.total==="0.8"),"Reload recharged lifetime");
  check(warnings.length===0,"Production observer degraded during native fixture");
  return {native:true,origins:2,subtotal:"0.8",reported:observations,persistedEntries:retained.length,replay:true,reload:true,pricing:"incomplete",replacementSupport:false};
 },{releaseAuthentication:()=>release(),abort:async()=>{if(parent)await bounded(parent.abort(),"abort");},shutdown:async()=>{if(parent)await bounded(shutdownNative(parent),"shutdown");},dispose:()=>{observer?.dispose();parent?.dispose();},unsubscribe:cleanup,
 restoreFetch:()=>{globalThis.fetch=oldFetch;},restoreCwd:()=>process.chdir(oldCwd),removeTemp:()=>rm(root,{recursive:true,force:true})});
 check(listeners===0,"Native bus listeners leaked");check(network===0,"Native network attempted");check((globalThis as any)[managerKey]===undefined,"Native registry leaked");return {...value,listeners,network};
}
if(process.argv.includes("--native-child")) {
 try{console.log(JSON.stringify(await nativeObserverFixture()));}catch(e){console.error(e);process.exitCode=1;}
} else test("production observer + locked accounting through published native Agent FG/BG/resume/replay/reload",async()=>{
 if(!process.env.PI_PROBE_HOST_ROOT)throw Error("Native opt-in public host root required; never skip");
 const childSpec=isolatedChild("run",[resolve(import.meta.path),"--native-child"]),child=Bun.spawn(childSpec.argv,{env:childSpec.env,stdout:"pipe",stderr:"pipe"});
 const timer=setTimeout(()=>child.kill(),60_000);
 try{const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({exit,err}).toEqual({exit:0,err:""});
  expect(JSON.parse(out)).toMatchObject({native:true,origins:2,subtotal:"0.8",replay:true,reload:true,pricing:"incomplete",listeners:0,network:0});
 }finally{clearTimeout(timer);}
},65_000);
