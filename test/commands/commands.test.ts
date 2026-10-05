import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildBinding, DecisionEntry, RoutingSnapshot } from "../../src/contracts";
import type { ControlOutcome } from "../../src/children/controller";
import { CommandRouter, registerCommands, type CommandServices } from "../../src/commands";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { emptyLedger, loadLedger } from "../../src/core/budget";
import { configPaths } from "../../src/core/config";
import { loadConfiguration } from "../../src/configuration";
import { AccountingStore, createUsageRecorder } from "../../src/state/accounting";
import { decide } from "../../src/core/router";
import { createEngine } from "../../src/routing/engine";
import { withAtomicJson } from "../../src/state/atomic";
import { config, analysis } from "../support/fixtures";

const realFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=realFetch;});
export function fixture() {
 const directory=mkdtempSync(join(tmpdir(),"commands-"));
 const generated=join(directory,"pi-jev-subagent-router.generated.json"),scores=join(directory,"scores.json"),manual=join(directory,"pi-jev-subagent-router.json");
 const c=config();c.apiKey="fake-key";c.ranking.scoresFile=scores;c.kindModels={};c.routes={quick:[],standard:[],high:[{provider:"p",model:"m",thinkingLevel:"off"}],premium:[],xpremium:[]};
 let runtime:RoutingSnapshot={owner:"owner",generation:1,config:c};let listener=()=>{};
 const models=[{provider:"p",id:"m"}];let ledger=emptyLedger();
 const binding={owner:"owner",id:"child",toolCallId:"spawn",sessionKey:"sdk",generation:1,disposed:false,
  session:{sessionId:"sdk",model:models[0],thinkingLevel:"low",getContextUsage:()=>({tokens:123})}} as unknown as ChildBinding;
 const calls:{kind:string;args:unknown[]}[]=[];
 let outcome:ControlOutcome={status:"rejected",reason:"unsupported"};let reloads=0,engineCalls=0;
 const services:CommandServices={
  getRuntime:()=>structuredClone(runtime),
  updateRuntime:(change,expected)=>{if(runtime.owner!==expected.owner || runtime.generation!==expected.generation)return false;listener();runtime={...runtime,generation:runtime.generation+1,config:{...runtime.config,...change,budget:{...runtime.config.budget,...change.budget}}};return true;},
  onInvalidate:callback=>{listener=callback;return()=>{listener=()=>{};};},
  getLedger:()=>ledger,
  getCandidates:()=>({status:"ready",models}),
  getBinding:id=>id==="child"?binding:undefined,
  getGeneratedPath:()=>generated,
  reloadGenerated:()=>{reloads++;},
  getView:()=>({discovery:"ready",control:"unsupported",children:[{id:"child",status:"completed",model:"p/m",thinking:"low"}]}),
  engine:async(...args)=>{engineCalls++;return createEngine({classify:async()=>analysis()})(...args);},
  controller:{apply:async(...args)=>{calls.push({kind:"apply",args});return outcome;},revert:async(...args)=>{calls.push({kind:"revert",args});return outcome;}},
 };
 writeFileSync(scores,JSON.stringify({models:{"p/m":{score:.75,kinds:{implement:.8}},"other/m":{score:.99}}}));writeFileSync(manual,'{"manual":"keep"}');
 const router=new CommandRouter(services);
 return {router,services,binding,models,generated,scores,manual,calls,
  runtime:()=>runtime,change:(patch:Partial<RoutingSnapshot>)=>{listener();runtime={...runtime,...patch};},
  outcome:(value:ControlOutcome)=>{outcome=value;},reloads:()=>reloads,engineCalls:()=>engineCalls,ledger:(value:ReturnType<typeof emptyLedger>)=>{ledger=value;}};
}
const proposalEntry=():DecisionEntry=>({version:1,owner:"owner",child:"child",action:"proposed",reason:"test",analysis:analysis(),decision:decide(analysis(),config(),{models:[{provider:"openrouter",id:"openai/gpt-5.3-codex"}],spend:{today:0,month:0,pressure:0}})});

test("status is child-only, complete chains, capability limits and honest zero",async()=>{
 const f=fixture();const result=await f.router.command("status");
 for(const text of ["Reported $0.0000","pricing incomplete","unknown","jev requests","xpremium","free pool","unsupported","child","reported spend","advisory"])expect(result.text).toContain(text);
 expect(result.text).not.toContain("fake-key");expect(result.text).not.toContain("parent model");expect(f.engineCalls()).toBe(0);
});
for(const [command,field,value] of [["on","enabled",true],["off","enabled",false],["mode auto","mode","auto"],["mode confirm","mode","confirm"],["mode notify","mode","notify"]] as const)
 test(`session update ${command} advances generation via invalidator`,async()=>{const f=fixture();const before=f.runtime().generation;const result=await f.router.command(command);expect(f.runtime().config[field]).toBe(value);expect(f.runtime().generation).toBe(before+1);expect(result.text).toContain("session only");expect(f.calls).toEqual([]);});
for(const dimension of ["daily","monthly"] as const)for(const amount of ["0","2.5","1e2"])
 test(`budget ${dimension} ${amount}`,async()=>{const f=fixture();await f.router.command(`budget ${dimension} ${amount}`);expect(f.runtime().config.budget[dimension==="daily"?"dailyUsd":"monthlyUsd"]).toBe(Number(amount));expect(f.runtime().generation).toBe(2);});
for(const bad of ["on extra","off extra","mode","mode AUTO","mode auto extra","mode nope","budget daily -1","budget daily NaN","budget daily Infinity","budget daily 1junk","budget daily 0x10","budget daily 1 extra","budget daily","budget yearly 1","why extra","status extra","revert","revert child extra","apply","apply child task without delimiter","apply child --","suggest extra","suggest --write extra","wat"])
 test(`strict invalid tokens unchanged: ${bad}`,async()=>{const f=fixture(),before=f.runtime();const result=await f.router.command(bad);expect(result.level).toBe("warning");expect(result.text).toContain("usage:");expect(f.runtime()).toEqual(before);expect(f.engineCalls()).toBe(0);expect(f.calls).toEqual([]);expect(f.reloads()).toBe(0);});
test("budget with no arguments reports current status",async()=>{const f=fixture();expect((await f.router.command("budget")).text).toContain("Reported");expect(f.runtime().generation).toBe(1);});
test("why reclassifies last eligible launch cold, not arbitrary recommendations; reload clears task",async()=>{const f=fixture();expect((await f.router.command("why")).text).toContain("no retained eligible child task");f.router.remember(proposalEntry(),{owner:"owner",generation:1});await f.router.route("arbitrary recommendation");expect((await f.router.command("why")).text).toContain("no retained eligible child task");f.router.rememberEligibleTask("original child task",{owner:"owner",generation:1});const result=await f.router.command("why");expect(result.text).toContain("complexity");expect(f.engineCalls()).toBe(2);expect(f.calls).toEqual([]);f.change({generation:2});expect((await f.router.command("why")).text).toContain("no retained eligible child task");});
for(const invalidation of ["clear","dispose","off","generation"] as const)test(`why stale continuation refuses ${invalidation}`,async()=>{const f=fixture();f.router.rememberEligibleTask("original launch",{owner:"owner",generation:1});let release!:(value:ReturnType<typeof analysis>)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);f.services.engine=createEngine({classify:async()=>{started();return new Promise(r=>release=r);}});const pending=f.router.command("why");await ready;if(invalidation==="off")await f.router.command("off");else if(invalidation==="generation")f.change({generation:2});else f.router[invalidation]();release(analysis());const result=await pending;expect(result.level).toBe("warning");expect(result.proposal).toBeUndefined();expect(f.router.entries).toEqual([]);expect(f.calls).toEqual([]);});
for(const count of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,2])test(`why invalid original count is refused ${count}`,async()=>{const f=fixture();f.router.rememberEligibleTask("prefix",{owner:"owner",generation:1},count);expect((await f.router.command("why")).text).toContain("no retained eligible child task");expect(f.engineCalls()).toBe(0);});
test("route only specified text; empty has no remembered prompt fallback",async()=>{const f=fixture();f.router.rememberTask(f.binding,"secret cached task",{owner:"owner",generation:1});expect((await f.router.route(" ")).text).toContain("usage:");const result=await f.router.route("new task");expect(result.proposal?.decision?.model?.id).toBe("m");expect(f.engineCalls()).toBe(1);expect(f.calls).toEqual([]);});
for(const status of ["rejected","degraded","held","notified","kept","noop","committed"] as const)
 test(`control preserves exact outcome ${status}`,async()=>{const f=fixture(),outcome:ControlOutcome={status,reason:status==="rejected"?"unsupported":status};f.outcome(outcome);const applied=await f.router.command("apply child -- exact task");expect(applied.control).toBe(outcome);expect(f.calls[0].kind).toBe("apply");expect(f.calls[0].args[0]).toMatchObject({id:"child",session:f.binding.session});expect(f.calls[0].args[1]).toMatchObject({analysis:{kind:"implement"}});expect(f.calls[0].args[2]).toEqual(f.runtime());const reverted=await f.router.command("revert child");expect(reverted.control).toBe(outcome);expect(f.calls[1].kind).toBe("revert");});
for(const id of ["missing","../child","__proto__","--"])
 test(`invalid or unknown child never controls: ${id}`,async()=>{const f=fixture();expect((await f.router.command(`apply ${id} -- text`)).text).toContain("usage:");expect((await f.router.command(`revert ${id}`)).text).toContain("usage:");expect(f.calls).toEqual([]);expect(f.engineCalls()).toBe(0);});
test("task cache is binding-specific, bounded, generation-cleared and not in entries",async()=>{const f=fixture();f.router.rememberTask(f.binding,"SECRET".repeat(2000),{owner:"owner",generation:1});await f.router.command("apply child");expect(f.calls).toHaveLength(1);expect(f.router.memory.tasks).toBeLessThanOrEqual(16);expect(f.router.memory.taskChars).toBeLessThanOrEqual(16384);expect(JSON.stringify(f.router.entries)).not.toContain("SECRET");f.change({generation:2});expect((await f.router.command("apply child")).text).toContain("usage:");expect(f.router.memory.taskChars).toBe(0);});
test("entries are projected, bounded and detached",()=>{const f=fixture();for(let i=0;i<100;i++)f.router.remember({...proposalEntry(),reason:"r".repeat(5000)},{owner:"owner",generation:1});expect(f.router.entries.length).toBeLessThanOrEqual(32);expect(f.router.memory.entryChars).toBeLessThanOrEqual(32768);const entries=f.router.entries;entries[0].reason="mutated";expect(f.router.entries[0].reason).not.toBe("mutated");f.router.clear();expect(f.router.entries).toEqual([]);});
for(const invalidation of ["off","generation","owner","dispose"])
 test(`pending classification invalidated: ${invalidation}`,async()=>{const f=fixture();let finish!:(value:ReturnType<typeof analysis>)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);f.services.engine=createEngine({classify:async()=>{started();return new Promise(r=>finish=r);}});const p=f.router.command("apply child -- task");await ready;if(invalidation==="dispose")f.router.dispose();else if(invalidation==="off")await f.router.command("off");else f.change(invalidation==="owner"?{owner:"new"}:{generation:2});finish(analysis());const result=await p;expect(result.control).toBeUndefined();expect(f.calls).toEqual([]);expect(f.router.entries).toEqual([]);});
for(const seam of ["getBinding","getCandidates","getLedger","getGeneratedPath"] as const)
 test(`reentrant callback disposal before mutation: ${seam}`,async()=>{const f=fixture();const original=f.services[seam];f.services[seam]=((...args:never[])=>{f.router.dispose();return (original as (...args:never[])=>unknown)(...args);}) as never;await f.router.command(seam==="getGeneratedPath"?"suggest --write":"apply child -- task");expect(f.calls).toEqual([]);expect(f.reloads()).toBe(0);});
test("runtime getter disposal cannot authorize updates",async()=>{const f=fixture(),original=f.services.getRuntime;f.services.getRuntime=()=>{f.router.dispose();return original();};await f.router.command("off");expect(f.runtime().config.enabled).toBe(true);});
test("service rejections and UI failures expose only sanitized static text",async()=>{const f=fixture();f.services.getCandidates=async()=>{throw Error("SECRET key task path");};expect((await f.router.route("task")).text).not.toContain("SECRET");expect(f.calls).toEqual([]);});
for(const reason of ["classification-failed","missing-api-key","scope-unknown"] as const)test(`recommendation failure ${reason} is warning/skipped, not fabricated proposal`,async()=>{const f=fixture();f.services.engine=async()=>({reason});const result=await f.router.route("task");expect(result.level).toBe("warning");expect(result.text).toContain("× skipped");expect(result.proposal?.analysis).toBeUndefined();expect(f.router.entries[0].action).toBe("skipped");});
test("subscription acquisition invalidation cannot leave an active unsubscribed coordinator",async()=>{const f=fixture();let cleanups=0;f.services.onInvalidate=callback=>{callback();return()=>{cleanups++;};};const router=new CommandRouter(f.services);expect((await router.command("off")).level).toBe("warning");expect(f.runtime().config.enabled).toBe(true);expect(cleanups).toBe(1);});
test("real engine fake fetch proves recommendation composition and no parent history",async()=>{const f=fixture();let request:Record<string,unknown>={};f.services.engine=createEngine();globalThis.fetch=(async(_url,init)=>{request=JSON.parse(String(init?.body));return Response.json({answers:{task_kind:{choice:"implement",confidence:.9},complexity:{score:2,confidence:.7},capability_deserved:{score:2,confidence:.8},needs_deep_reasoning:{noul:.7}},usage:{input_tokens:9,output_tokens:2}});}) as typeof fetch;const result=await f.router.route("exact task");const state=request.state as Record<string,unknown>;expect(state.request).toBe("Agent: recommendation\nTask:\nexact task");expect(state.conversation_excerpt).toBeNull();expect(result.proposal?.analysis?.usage).toEqual({input_tokens:9,output_tokens:2});expect(result.proposal?.decision?.model?.id).toBe("m");expect(f.calls).toEqual([]);});
test("apply supplies actual child context only",async()=>{const f=fixture();let seen:unknown;f.services.engine=createEngine({classify:async input=>{seen=input;return analysis();}});await f.router.command("apply child -- task");expect(seen).toMatchObject({contextTokens:123,activeModel:"p/m"});expect((seen as {history?:string}).history).toBeUndefined();});
test("preview ranks without write; generated commit preserves unrelated keys and manual bytes",async()=>{const f=fixture();writeFileSync(f.generated,JSON.stringify({unknown:{counter:3},routes:{xpremium:[{provider:"x",model:"x"}]}}));const before=readFileSync(f.generated,"utf8"),manual=readFileSync(f.manual,"utf8");expect((await f.router.command("suggest")).text).toContain("preview only");expect(readFileSync(f.generated,"utf8")).toBe(before);const result=await f.router.command("suggest --write");expect(result.written).toBe(true);expect(f.reloads()).toBe(1);expect(JSON.parse(readFileSync(f.generated,"utf8"))).toMatchObject({unknown:{counter:3},routes:{high:[{provider:"p",model:"m"}],xpremium:[{provider:"x",model:"x"}]}});expect(readFileSync(f.manual,"utf8")).toBe(manual);});
test("unmatched exact provider scope leaves generated bytes untouched",async()=>{const f=fixture();writeFileSync(f.generated,'{"counter":3}');f.services.getCandidates=()=>({status:"ready",models:[{provider:"different",id:"m"}]});const result=await f.router.command("suggest --write");expect(result.written).not.toBe(true);expect(readFileSync(f.generated,"utf8")).toBe('{"counter":3}');expect(f.reloads()).toBe(0);});
for(const corrupt of ["not json","null","[]",'{"routes":null}', '{"kindModels":[]}', '{"routes":{"high":17}}', '{"routes":{"high":[{"provider":"p","model":"m","thinkingLevel":"invalid"}]}}', '{"kindModels":{"data":[{"provider":"p","model":"m","minTier":"wrong"}]}}', '{"kindModels":{"data":[{"provider":"p","model":"m","priority":"bad"}]}}'])
 test(`malformed generated file refuses instead of overwrite: ${corrupt}`,async()=>{const f=fixture();writeFileSync(f.generated,corrupt);expect((await f.router.command("suggest --write")).written).not.toBe(true);expect(readFileSync(f.generated,"utf8")).toBe(corrupt);expect(f.reloads()).toBe(0);});
test("scores errors never echo file JSON exception text",async()=>{const f=fixture();writeFileSync(f.scores,'SECRET invalid json');const result=await f.router.command("suggest");expect(result.text).toContain("scores-unavailable");expect(result.text).not.toContain("SECRET");expect(result.text).not.toContain(f.scores);});
test("under-lock admission cancellation preserves competing writer",async()=>{const f=fixture();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);const writer=withAtomicJson(f.generated,async()=>{entered();await gate;return {state:{counter:8},value:undefined};});await ready;const pending=f.router.command("suggest --write");await f.router.command("off");release();await writer;const result=await pending;expect(result.written).not.toBe(true);expect(JSON.parse(readFileSync(f.generated,"utf8"))).toEqual({counter:8});});
test("atomic merge reads latest locked state rather than pre-await cached config",async()=>{const f=fixture();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);const writer=withAtomicJson(f.generated,async()=>{entered();await gate;return {state:{counter:9},value:undefined};});await ready;const pending=f.router.command("suggest --write");release();await writer;expect((await pending).written).toBe(true);expect(JSON.parse(readFileSync(f.generated,"utf8"))).toMatchObject({counter:9});});
test("reload failure after commit remains truthful",async()=>{const f=fixture();f.services.reloadGenerated=()=>{throw Error("SECRET");};const result=await f.router.command("suggest --write");expect(result.written).toBe(true);expect(result.text).toContain("refresh failed");expect(result.text).not.toContain("SECRET");expect(JSON.parse(readFileSync(f.generated,"utf8"))).toHaveProperty("routes");});
test("reload invalidation after commit cannot be described as rollback",async()=>{const f=fixture();f.services.reloadGenerated=()=>{f.change({generation:2});};const result=await f.router.command("suggest --write");expect(result.written).toBe(true);expect(result.text).toContain("committed");});
test("optional registration has only namespaced commands and recommendation tool",async()=>{const f=fixture();expect(()=>registerCommands({},f.router)).not.toThrow();const names:string[]=[];let captured:unknown;
 registerCommands({registerCommand:(name)=>{names.push(name);},registerTool:definition=>{captured=definition;}},f.router);const tool=captured as ToolDefinition<import("typebox").TObject<{request:import("typebox").TString}>,unknown,unknown>|undefined;expect(names).toEqual(["jev-subagent-router","jev-subagent-route"]);expect(tool?.name).toBe("jev_subagent_route");expect(tool?.parameters).toHaveProperty("properties.request");expect(tool?.parameters).toHaveProperty("additionalProperties",false);
 if(!tool)throw Error("tool absent");const result=await tool.execute("call",{request:"tool task"},new AbortController().signal,undefined,{} as never);expect(result.content[0]).toMatchObject({type:"text"});expect(result.details).toMatchObject({kind:"recommendation"});expect(JSON.stringify(result.details)).not.toContain("tool task");expect(f.calls).toEqual([]);
});
test("old generation/owner cannot repopulate cleared bounded context",()=>{const f=fixture();f.change({generation:2});f.router.remember(proposalEntry(),{owner:"owner",generation:1});f.router.rememberTask(f.binding,"stale task",{owner:"owner",generation:1});expect(f.router.entries).toEqual([]);expect(f.router.memory.tasks).toBe(0);f.change({owner:"other"});f.router.rememberTask({...f.binding,owner:"other"},"stale owner task",{owner:"owner",generation:2});expect(f.router.memory.tasks).toBe(0);});
for(const resource of ["manual","scores","ledger"] as const)test(`reject non-child-generated resources: ${resource}`,async()=>{const f=fixture();const destination=resource==="manual"?f.manual:resource==="scores"?f.scores:f.generated;if(resource==="ledger")f.runtime().config.stateFile=f.generated;f.services.getGeneratedPath=()=>destination;if(resource==="ledger")writeFileSync(destination,'{"counter":4}');const before=readFileSync(destination,"utf8");const result=await f.router.command("suggest --write");expect(result.written).not.toBe(true);expect(readFileSync(destination,"utf8")).toBe(before);expect(f.reloads()).toBe(0);});
test("why bounded eligible task preserves original length and durable usage once per rerun",async()=>{const f=fixture(),file=join(mkdtempSync(join(tmpdir(),"why-counter-")),"state.json"),store=new AccountingStore(file);f.services.getLedger=()=>loadLedger(file);f.services.engine=createEngine({recordUsage:createUsageRecorder(store)});let request:Record<string,unknown>={};globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{request=JSON.parse(String(init?.body));return Response.json({answers:{task_kind:{choice:"implement",confidence:.9},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:7,output_tokens:3}});}) as unknown as typeof fetch;f.router.rememberEligibleTask("x".repeat(4096),{owner:"owner",generation:1},10000);const result=await f.router.command("why");expect(result.text).toContain("cached task truncated: 10000 → 4096");expect((request.state as Record<string,unknown>).request).toBe("Agent: recommendation\nTask:\n"+"x".repeat(4096));expect((request.state as Record<string,unknown>).conversation_excerpt).toBeNull();expect(loadLedger(file).jev).toEqual({requests:1,inputTokens:7,outputTokens:3});expect(f.calls).toEqual([]);await f.router.command("why");expect(loadLedger(file).jev.requests).toBe(2);expect(JSON.stringify(f.router.entries)).not.toContain("x".repeat(100));await f.router.command("off");expect((await f.router.command("why")).text).toContain("inactive");expect(loadLedger(file).jev.requests).toBe(2);});
test("why admitted blank bounded prefix replaces previous launch without suffix reconstruction",async()=>{
 const f=fixture(),tasks:unknown[]=[];
 f.services.engine=async(...args)=>{tasks.push(structuredClone(args[0]));return createEngine({classify:async()=>analysis()})(...args);};
 const admission={owner:"owner",generation:1};
 f.router.rememberEligibleTask("valid old task",admission,14,"old-agent");
 const full=" ".repeat(4096)+"actualnewtask";
 f.router.rememberEligibleTask(full.slice(0,4096),admission,full.length,"new-agent");
 const result=await f.router.command("why");
 expect(tasks).toHaveLength(1);
 expect(tasks[0]).toMatchObject({prompt:" ".repeat(4096),agent:"new-agent"});
 expect(JSON.stringify(tasks)).not.toContain("actualnewtask");
 expect(JSON.stringify(tasks)).not.toContain("valid old task");
 expect(result.text).toContain(`cached task truncated: ${full.length} → 4096`);
 expect(f.calls).toEqual([]);
});
test("why unadmitted empty whole task does not replace eligible launch",async()=>{
 const f=fixture(),tasks:unknown[]=[];f.services.engine=async(...args)=>{tasks.push(args[0]);return createEngine({classify:async()=>analysis()})(...args);};
 const admission={owner:"owner",generation:1};f.router.rememberEligibleTask("valid old task",admission);
 f.router.rememberEligibleTask("",admission);f.router.rememberEligibleTask("   ",admission);
 f.router.rememberEligibleTask("",admission,10000);f.router.rememberEligibleTask("   ",admission,10000);
 await f.router.command("why");expect(tasks).toHaveLength(1);expect(tasks[0]).toMatchObject({prompt:"valid old task"});
});
test("pending ledger callback invalidates before configuration/control admission",async()=>{const f=fixture();let finish!:(l:ReturnType<typeof emptyLedger>)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);f.services.getLedger=()=>{started();return new Promise(r=>finish=r);};const pending=f.router.command("apply child -- task");await ready;f.change({generation:2});finish(emptyLedger());await pending;expect(f.engineCalls()).toBe(0);expect(f.calls).toEqual([]);});
test("pending candidate rejection after owner change is contained and inert",async()=>{const f=fixture();let reject!:(e:Error)=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r);f.services.getCandidates=()=>{started();return new Promise((_r,j)=>reject=j);};const pending=f.router.command("apply child -- task");await ready;f.change({owner:"new"});reject(Error("SECRET"));const result=await pending;expect(result.text).not.toContain("SECRET");expect(f.calls).toEqual([]);expect(f.router.entries).toEqual([]);});
test("ranking delegates custom scores/cutoffs/kinds and preserves xpremium as manual",async()=>{const f=fixture();f.runtime().config.taskKinds.data="Data";f.runtime().config.ranking.cutoffs={standard:50,high:70,premium:85};const models=[{provider:"a",id:"q"},{provider:"a",id:"s"},{provider:"a",id:"h"},{provider:"a",id:"x"},{provider:"b",id:"x"},{provider:"a",id:"p"}];f.services.getCandidates=()=>({status:"ready",models});writeFileSync(f.scores,JSON.stringify({models:Object.fromEntries(models.map((m,i)=>[`${m.provider}/${m.id}`,{score:[10,55,75,78,76,90][i],kinds:{data:90-i},cost:{input:i===0?0:1,output:1}}]))}));const result=await f.router.command("suggest");for(const token of ['"quick"','"standard"','"high"','"premium"','"data"','"priority"','"minTier"'])expect(result.text).toContain(token);expect(result.text).not.toContain('"xpremium":');expect(f.engineCalls()).toBe(0);expect(f.reloads()).toBe(0);});
test("status includes last retained proposal without reclassification",async()=>{const f=fixture();expect((await f.router.command("status")).text).toContain("last retained decision: none");await f.router.route("task");const result=await f.router.command("status");expect(result.text).toContain("last retained decision:");expect(result.text).toContain("proposed: p/m");expect(f.engineCalls()).toBe(1);});
test("native diagnostic strings never appear in control plaintext or display entries",async()=>{const f=fixture();const outcome:ControlOutcome={status:"committed",reason:"committed-with-diagnostics",receipt:{status:"committed",operationId:"o",before:{sessionId:"sdk",revision:0,model:{provider:"p",id:"before"},thinkingLevel:"low"},after:{sessionId:"sdk",revision:1,model:{provider:"p",id:"observed"},thinkingLevel:"off"},revision:1,notificationErrors:["SECRET native diagnostic"]}};f.outcome(outcome);const result=await f.router.command("apply child -- task");expect(result.control).toBe(outcome);expect(result.text).not.toContain("SECRET");expect(JSON.stringify(f.router.entries)).not.toContain("SECRET");expect(f.router.entries[0].effective).toEqual({model:"p/observed",thinking:"off"});});
test("committed generated layer actually reloads through existing configuration with manual precedence",async()=>{const f=fixture(),paths=configPaths();writeFileSync(paths.global,JSON.stringify({useDefaultModels:false,routes:{high:[{provider:"p",model:"manual"}]}}));const manual=readFileSync(paths.global,"utf8");writeFileSync(paths.generated,JSON.stringify({counter:11}));f.services.getGeneratedPath=()=>paths.generated;let reloads=0;f.services.reloadGenerated=expected=>{expect(expected).toEqual({owner:"owner",generation:1});const loaded=loadConfiguration({});reloads++;f.change({generation:2,config:loaded});};try{const result=await f.router.command("suggest --write");expect(result.written).toBe(true);expect(reloads).toBe(1);expect(f.runtime().config.routes.high).toEqual([{provider:"p",model:"manual"}]);expect(JSON.parse(readFileSync(paths.generated,"utf8"))).toMatchObject({counter:11,routes:{high:[{provider:"p",model:"m"}]}});expect(readFileSync(paths.global,"utf8")).toBe(manual);}finally{writeFileSync(paths.global,'{}');writeFileSync(paths.generated,'{}');}});
test("real engine uses atomic classifier counter consumer rather than command-local totals",async()=>{const f=fixture(),file=join(mkdtempSync(join(tmpdir(),"command-counter-")),"state.json"),store=new AccountingStore(file);f.services.getLedger=()=>loadLedger(file);f.services.engine=createEngine({recordUsage:createUsageRecorder(store)});globalThis.fetch=(async()=>Response.json({answers:{task_kind:{choice:"implement",confidence:.9},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:7,output_tokens:3}})) as unknown as typeof fetch;await f.router.route("task");expect(loadLedger(file).jev).toEqual({requests:1,inputTokens:7,outputTokens:3});const status=await f.router.command("status");expect(status.text).toContain("jev requests: 1");expect(status.text).toContain("reported tokens input 7, output 3");expect(status.text).toContain("pricing incomplete");});
test("post-controller acknowledgement callback failure preserves exact committed truth",async()=>{const f=fixture(),outcome:ControlOutcome={status:"committed",reason:"committed"};f.services.controller.apply=async()=>{f.services.getRuntime=()=>{throw Error("SECRET");};return outcome;};const result=await f.router.command("apply child -- text");expect(result.control).toBe(outcome);expect(result.text).toContain("committed");expect(result.text).not.toContain("SECRET");});
test("committed write remains truthful when post-lock runtime callback fails",async()=>{const f=fixture(),original=f.services.getGeneratedPath,readRuntime=f.services.getRuntime;let underLock=false;f.services.getGeneratedPath=(r)=>{if(underLock){let reads=0;f.services.getRuntime=()=>{if(++reads>1)throw Error("SECRET");return readRuntime();};}underLock=true;return original(r);};const result=await f.router.command("suggest --write");expect(result.written).toBe(true);expect(result.text).toContain("committed");expect(result.text).not.toContain("SECRET");expect(f.reloads()).toBe(0);expect(JSON.parse(readFileSync(f.generated,"utf8"))).toHaveProperty("routes");});
test("late acknowledgement invalidation preserves control outcome",async()=>{const f=fixture(),outcome:ControlOutcome={status:"committed",reason:"committed"};f.services.controller.apply=async()=>{f.router.dispose();return outcome;};expect((await f.router.command("apply child -- text")).control).toBe(outcome);expect(f.router.entries).toEqual([]);});
test("memory count limits evict oldest bound child tasks",async()=>{const f=fixture();for(let i=0;i<30;i++)f.router.rememberTask({...f.binding,id:`child${i}`},"x".repeat(2000),{owner:"owner",generation:1});expect(f.router.memory.tasks).toBeLessThanOrEqual(16);expect(f.router.memory.taskChars).toBeLessThanOrEqual(16384);expect((await f.router.command("apply child")).text).toContain("usage:");});
test("dependency allowlist has no launcher or parent mutation; exposed API methods never invoked",async()=>{const f=fixture();const forbidden=["setModel","setThinkingLevel","sendUserMessage","sendMessage","executeTool","prompt","resume"];const source=readFileSync(new URL("../../src/commands.ts",import.meta.url),"utf8");for(const method of forbidden)expect(source).not.toContain(`.${method}(`);let forbiddenCalls=0;const api:Partial<ExtensionAPI> & Record<string,unknown>={registerCommand:()=>{},registerTool:()=>{}};for(const name of forbidden)api[name]=()=>{forbiddenCalls++;throw Error("must not launch");};registerCommands(api,f.router);await f.router.route("task");await f.router.command("apply child -- task");await f.router.command("revert child");expect(forbiddenCalls).toBe(0);});
test("throwing notification and registration callbacks contained",async()=>{const f=fixture();let command:Parameters<ExtensionAPI["registerCommand"]>[1]|undefined;registerCommands({registerCommand:(name,definition)=>{if(name==="jev-subagent-router")command=definition;else throw Error("SECRET");},registerTool:()=>{throw Error("SECRET");}},f.router);if(!command)throw Error("missing");await command.handler("status",{ui:{notify:()=>{throw Error("SECRET");}}} as never);expect(f.calls).toEqual([]);});
test("asynchronous notification rejection is observed and contained",async()=>{const f=fixture();let command:Parameters<ExtensionAPI["registerCommand"]>[1]|undefined;registerCommands({registerCommand:(name,definition)=>{if(name==="jev-subagent-router")command=definition;}},f.router);if(!command)throw Error("missing");await command.handler("status",{ui:{notify:()=>Promise.reject(Error("SECRET notification"))}} as never);await new Promise<void>(r=>setTimeout(r,0));expect(f.calls).toEqual([]);});
// A public runtime read in evaluate's final check queues invalidation. That
// microtask runs after evaluate returns, but before route's await continuation.
for(const invalidation of ["clear","invalidate","off","generation","dispose"] as const)
 test(`recommendation continuation gap refuses ${invalidation}`,async()=>{
  const f=fixture(),original=f.services.getRuntime,engine=f.services.engine!;
  let engineFinished=false,finalCheckReturned=false,invalidated=false;
  f.services.engine=async(...args)=>{const proposal=await engine(...args);engineFinished=true;return proposal;};
  f.services.getRuntime=()=>{
   const snapshot=original();
   if(engineFinished && !finalCheckReturned){
    finalCheckReturned=true;
    queueMicrotask(()=>{
     expect(finalCheckReturned).toBe(true);expect(invalidated).toBe(false);
     if(invalidation==="clear")f.router.clear();
     else if(invalidation==="invalidate")f.router.invalidate();
     else if(invalidation==="dispose")f.router.dispose();
     else if(invalidation==="off")f.runtime().config.enabled=false;
     else f.runtime().generation++;
     invalidated=true;
    });
   }
   return snapshot;
  };
  const result=await f.router.route("SECRET task");
  expect(engineFinished).toBe(true);expect(finalCheckReturned).toBe(true);expect(invalidated).toBe(true);
  if(invalidation==="clear" || invalidation==="invalidate")expect(f.runtime()).toMatchObject({owner:"owner",generation:1});
  expect(result.level).toBe("warning");expect(result.proposal).toBeUndefined();
  expect(result.text).not.toContain("p/m");expect(result.text).not.toContain("SECRET");
  expect(f.router.entries).toEqual([]);expect(f.router.memory.tasks).toBe(0);expect(f.calls).toEqual([]);
 });
for(const retention of ["remember","rememberTask"] as const)for(const invalidation of ["clear","dispose"] as const)
 test(`public ${retention} refuses normal-return reentrant ${invalidation}`,()=>{
  const f=fixture(),original=f.services.getRuntime;let reentered=false;
  f.services.getRuntime=()=>{const snapshot=original();if(!reentered){reentered=true;f.router[invalidation]();}return snapshot;};
  if(retention==="remember")f.router.remember(proposalEntry(),{owner:"owner",generation:1});
  else f.router.rememberTask(f.binding,"SECRET stale task",{owner:"owner",generation:1});
  expect(reentered).toBe(true);expect(f.router.entries).toEqual([]);expect(f.router.memory.tasks).toBe(0);
 });
for(const invalidation of ["clear","dispose"] as const)for(const callbackRead of [2,3])
 test(`recommendation publication read ${callbackRead} refuses normal-return reentrant ${invalidation}`,async()=>{
  const f=fixture(),original=f.services.getRuntime,engine=f.services.engine!;let engineFinished=false,reads=0,reentered=false;
  f.services.engine=async(...args)=>{const proposal=await engine(...args);engineFinished=true;return proposal;};
  f.services.getRuntime=()=>{
   const snapshot=original();
   // Evaluate final check is read 1. Every subsequent publication/retention
   // runtime read must survive a normal-return callback invalidation.
   if(engineFinished && ++reads===callbackRead){reentered=true;f.router[invalidation]();}
   return snapshot;
  };
  const result=await f.router.route("SECRET task");
  expect(reentered).toBe(true);expect(result.proposal).toBeUndefined();expect(result.level).toBe("warning");
  expect(result.text).not.toContain("p/m");expect(f.router.entries).toEqual([]);
 });
for(const surface of ["command","tool"] as const)
 test(`registered ${surface} cannot leak continuation-gap recommendation`,async()=>{
  const f=fixture(),original=f.services.getRuntime,engine=f.services.engine!;let engineFinished=false,queued=false;
  f.services.engine=async(...args)=>{const proposal=await engine(...args);engineFinished=true;return proposal;};
  f.services.getRuntime=()=>{const snapshot=original();if(engineFinished && !queued){queued=true;queueMicrotask(()=>f.router.clear());}return snapshot;};
  let command:Parameters<ExtensionAPI["registerCommand"]>[1]|undefined,tool:ToolDefinition<import("typebox").TObject<{request:import("typebox").TString}>,unknown,unknown>|undefined;
  registerCommands({registerCommand:(name,definition)=>{if(name==="jev-subagent-route")command=definition;},registerTool:definition=>{tool=definition as unknown as typeof tool;}},f.router);
  if(surface==="command"){
   if(!command)throw Error("command absent");const notices:{text:string;level:string}[]=[];
   await command.handler("SECRET task",{ui:{notify:(text:string,level:string)=>{notices.push({text,level});}}} as never);
   expect(notices).toHaveLength(1);expect(notices[0].level).toBe("warning");expect(notices[0].text).not.toContain("p/m");
  }else{
   if(!tool)throw Error("tool absent");const result=await tool.execute("call",{request:"SECRET task"},new AbortController().signal,undefined,{} as never);
   expect(result.details).toBeUndefined();expect(result.isError).toBe(true);expect(JSON.stringify(result.content)).not.toContain("p/m");
  }
  expect(queued).toBe(true);expect(f.router.entries).toEqual([]);expect(f.calls).toEqual([]);
 });
test("tool cancellation linked to execute signal",async()=>{const f=fixture();let started!:()=>void;const ready=new Promise<void>(r=>started=r);f.services.engine=createEngine({classify:async(_i,_c,_key,signal)=>{started();return new Promise((_r,reject)=>signal?.addEventListener("abort",()=>reject(Error("cancelled")),{once:true}));}});const abort=new AbortController();const pending=f.router.route("task",abort.signal,"tool-call");await ready;abort.abort();expect((await pending).proposal).toBeUndefined();expect(f.router.entries).toEqual([]);});
