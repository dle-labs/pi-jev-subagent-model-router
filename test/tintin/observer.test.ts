import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountingStore, rootOwnerId } from "../../src/state/accounting";
import { ChildObserver, type ObserverEntry } from "../../src/tintin/observer";
const owner=rootOwnerId("/workspace","parent");
function session(id="sdk") {
 const callbacks=new Set<(e:any)=>void>(), retired:((e:any)=>void)[]=[];
 let subscriptions=0, removals=0;
 return {sessionId:id,subscribe(fn:(e:any)=>void){subscriptions++;callbacks.add(fn);return ()=>{removals++;callbacks.delete(fn);retired.push(fn);};},
 emit(e:any={type:"message_end",message:{role:"assistant"}}){for(const f of callbacks) f(e);},
 stale(){for(const f of retired) f({type:"message_end",message:{role:"assistant"}});},
 counts:()=>({subscriptions,removals,live:callbacks.size})};
}
function record(id="child",cost:number|undefined=0.2) {return {id,type:"probe",status:"running",startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:cost as number|undefined},session:session(id+"-sdk")};}
function bus(){const channels=new Map<string,Set<(v:any)=>void>>();return {on(c:string,f:(v:any)=>void){const s=channels.get(c)??new Set();s.add(f);channels.set(c,s);return ()=>{s.delete(f);};},emit(c:string,v:any){for(const f of channels.get(c)??[])f(v);},count:()=>[...channels.values()].reduce((n,s)=>n+s.size,0)};}
async function setup(overrides:any={}) {
 const file=join(await mkdtemp(join(tmpdir(),"observer-")),"ledger.json"),store=new AccountingStore(file);
 const records=new Map<string,any>(), events=bus(),entries:ObserverEntry[]=[],warnings:string[]=[];
 let currentOwner=owner;
 const observer=new ChildObserver({owner,store,eventBus:events,getRegistry:()=>({getRecord:(id:string)=>records.get(id)}),getOwner:()=>currentOwner,
 appendEntry:(_type:string,e:ObserverEntry)=>{entries.push(structuredClone(e));},warn:(code:string)=>warnings.push(code),now:()=>new Date("2026-04-01T00:00:01Z"),...overrides});
 const load=async()=>JSON.parse(await readFile(file,"utf8"));
 const call=(id="spawn",resume?:string,extra:any={})=>observer.observeToolCall({toolName:"Agent",toolCallId:id,input:{subagent_type:"probe",description:"private-description",prompt:"PRIVATE-PROMPT",...(resume?{resume}:{}),...extra}});
 const receipt=(callId="spawn",child="child",extra:any={})=>observer.observeToolResult({toolName:"Agent",toolCallId:callId,details:{agentId:child},...extra});
 return {file,store,records,events,entries,warnings,observer,load,call,receipt,changeOwner:()=>{currentOwner="other";}};
}
const only=(l:any)=>Object.values(l.accounting.records)[0] as any;
test("started without session/correlation waits for late exact update and actual readiness",async()=>{
 const f=await setup();const r=record();r.session=undefined as any;f.records.set(r.id,r);
 f.events.emit("subagents:started",{id:r.id,description:"PRIVATE"});await f.observer.flush();expect(f.entries).toHaveLength(0);
 f.call();f.observer.observeToolUpdate({toolName:"Agent",toolCallId:"spawn",partialResult:{details:{agentId:r.id}}});await f.observer.flush();
 expect(only(await f.load()).accountedUsd).toBe("0.2");
 r.session=session();f.events.emit("subagents:compacted",{id:r.id});await f.observer.flush();expect(r.session.counts().live).toBe(1);
 f.receipt();await f.observer.flush();expect(r.session.counts().subscriptions).toBe(1);f.observer.dispose();expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
test("native empty resume/schedule fields still describe an immediate new spawn",async()=>{
 const f=await setup();f.records.set("child",record());f.call("spawn",undefined,{resume:"",schedule:""});f.receipt();await f.observer.flush();expect(f.entries).toHaveLength(1);expect(only(await f.load()).accountedUsd).toBe("0.2");f.observer.dispose();
});
test("SDK events microtask-read authoritative accumulator; never per-message or pooled receipt money",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call("spawn",undefined,{model:"p/m",thinking:"high"});f.receipt("spawn","child",{usage:{cost:{total:9}}});await f.observer.flush();
 r.session.emit({type:"message_end",message:{role:"assistant",usage:{cost:{total:20}}}});r.lifetimeUsage.cost=0.3;await f.observer.flush();
 const l=await f.load();expect(only(l).accountedUsd).toBe("0.3");expect(l.accounting.exactDays["2026-04-01"].byModel).toEqual({"unknown-child-model":"0.3"});expect(only(l).late).toBe(true);
 expect(JSON.stringify(f.entries)).not.toContain("PRIVATE");f.observer.dispose();
});
for(const channel of ["subagents:completed","subagents:failed"]) test(`terminal foreground/background authoritative reconcile and replay ${channel}`,async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();
 r.lifetimeUsage.cost=0.4;r.status=channel.endsWith("failed")?"error":"completed";
 f.events.emit(channel,{id:r.id,usage:{cost:{total:99}}});f.events.emit(channel,{id:r.id,usage:{cost:{total:99}}});await f.observer.flush();
 expect(only(await f.load()).accountedUsd).toBe("0.4");f.observer.dispose();
});
test("cross-child pooled native result never gets charged",async()=>{
 const f=await setup();for(const [id,cost] of [["a",0.2],["b",0.1]] as const){f.records.set(id,record(id,cost));f.call("call-"+id);f.receipt("call-"+id,id,{usage:{cost:{total:30}}});}
 await f.observer.flush();expect((await f.load()).accounting.exactDays["2026-04-01"].total).toBe("0.3");f.observer.dispose();
});
test("same-mode resume retains origin/highwater and records zero-delta gap before increase",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();const first=f.entries.at(-1)!;
 f.call("resume",r.id);f.receipt("resume");await f.observer.flush();const l=await f.load();expect(only(l).accountedUsd).toBe("0.2");expect(only(l).pricing.reasons).toContain("observation-gap");expect(only(l).pricing.reasons).toContain("activity-uncovered");
 expect(f.entries.at(-1)!.origin).toEqual(first.origin);expect(f.entries.at(-1)!.generation).toBeGreaterThan(first.generation);
 r.lifetimeUsage.cost=0.3;r.session.emit();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.3");f.observer.dispose();
});
test("strict optional old background toolCallId blocks cross-mode resume",async()=>{
 const f=await setup();const r={...record(),toolCallId:"spawn"};f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();
 f.call("resume",r.id);f.receipt("resume");r.lifetimeUsage.cost=10;r.session.emit();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");expect(f.observer.status).toBe("unknown-attribution");f.observer.dispose();
});
for(const bad of [{parentAgentId:"parent"},{workflowId:"workflow"}]) test(`descendants/workflows rejected before store ${JSON.stringify(bad)}`,async()=>{
 const f=await setup();f.records.set("child",{...record(),...bad});f.call();f.receipt();await f.observer.flush();expect(f.entries).toHaveLength(0);expect(f.observer.status).toBe("unknown-attribution");f.observer.dispose();
});
test("ancestor aggregate already includes descendant: .3 not .4",async()=>{
 const f=await setup();f.records.set("child",record("child",0.3));f.records.set("nested",{...record("nested",0.1),parentAgentId:"child"});
 f.call();f.receipt();f.call("nested-call");f.receipt("nested-call","nested");await f.observer.flush();expect((await f.load()).accounting.exactDays["2026-04-01"].total).toBe("0.3");f.observer.dispose();
});
for(const seam of ["parent-tool","start-only"])test(`unknown scope/pre-validation ${seam} cannot establish native ownership`,async()=>{
 const f=await setup();f.records.set("child",record());
 if(seam==="parent-tool")f.observer.observeToolCall({toolName:"Agent",toolCallId:seam,parentToolCallId:"parent-tool",input:{subagent_type:"probe",description:"d",prompt:"p"}});
 else f.observer.observeHostEvent({type:"tool_execution_start",toolName:"Agent",toolCallId:seam,args:{subagent_type:"probe",description:"d",prompt:"p"}});
 f.receipt(seam);await f.observer.flush();expect(f.entries).toHaveLength(0);f.observer.dispose();
});
for(const unavailable of [null,undefined])test(`explicit unknown registry source does not reopen the global manager (${unavailable})`,async()=>{
 const symbol=Symbol.for("pi-subagents:manager"),previous=(globalThis as any)[symbol],r=record();(globalThis as any)[symbol]={getRecord:()=>r};
 try{const f=await setup({getRegistry:()=>unavailable});f.call();f.receipt();await f.observer.flush();expect(f.entries).toHaveLength(0);f.observer.dispose();}finally{if(previous===undefined)delete (globalThis as any)[symbol];else (globalThis as any)[symbol]=previous;}
});
test("unavailable public runtime owner does not silently retain old ownership",async()=>{
 const f=await setup({getOwner:()=>undefined});f.call();expect(f.observer.status).toBe("disposed");expect(f.events.count()).toBe(0);
});
test("tokens without cost and serialized zero keep an incomplete zero subtotal, never verified free",async()=>{
 const f=await setup();const r=record();r.lifetimeUsage.cost=0;f.records.set("child",r);f.call();f.receipt();await f.observer.flush();const l=await f.load();expect(only(l).accountedUsd).toBe("0");expect(only(l).pricing.reasons).toContain("zero-unproven");expect(l.accounting.exactDays).toEqual({});f.observer.dispose();
});
test("unobserved external started cannot establish ownership; bounded hints contain no prompts",async()=>{
 const f=await setup();for(let i=0;i<300;i++){f.records.set(String(i),record(String(i)));f.events.emit("subagents:started",{id:String(i),prompt:"PRIVATE"});}
 await f.observer.flush();expect(f.entries).toHaveLength(0);expect(f.observer.pendingCount).toBeLessThanOrEqual(128);f.observer.dispose();expect(f.observer.pendingCount).toBe(0);
});
test("ambiguous replacement refuses; verified distinct new spawn reuses id with new origin; stale callbacks cannot charge",async()=>{
 const f=await setup();const a=record();f.records.set("child",a);f.call();f.receipt();await f.observer.flush();
 const b=record("child",0.1);f.records.set("child",b);a.session.emit();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");
 f.call("new-spawn");f.receipt("new-spawn");await f.observer.flush();a.lifetimeUsage.cost=99;a.session.stale();f.events.emit("subagents:completed",{id:"child",usage:{cost:{total:99}}});await f.observer.flush();
 const l=await f.load();expect(Object.keys(l.accounting.records)).toHaveLength(2);expect(l.accounting.exactDays["2026-04-01"].total).toBe("0.3");f.observer.dispose();
});
for(const cost of [undefined,NaN,Infinity,-1,0,0.1]) test(`missing/invalid/serialized zero never resets watermark or proves free (${cost})`,async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();r.lifetimeUsage.cost=cost;r.session.emit();await f.observer.flush();
 const saved=only(await f.load());expect(saved.accountedUsd).toBe("0.2");expect(saved.pricing.status).toBe("incomplete");expect(saved.pricing.reasons).toContain("aggregate-loses-missing-cost");f.observer.dispose();
});
test(".2 plus unpriced replay keeps known subtotal and persists new same-dollar gaps",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();
 r.session.emit({type:"message_end",message:{role:"assistant",usage:{input:10}}});await f.observer.flush();f.events.emit("subagents:completed",{id:r.id,usage:{cost:{total:0.2}}});await f.observer.flush();
 const saved=only(await f.load());expect(saved.accountedUsd).toBe("0.2");expect(saved.pricing.reasons).toContain("unpriced-contribution");f.observer.dispose();
});
function history(entry:ObserverEntry) {return [{role:"assistant",content:[{type:"toolCall",id:entry.origin.spawnToolCallId,name:"Agent",arguments:{subagent_type:"probe",description:"d",prompt:"p"}}]},
 {role:"toolResult",toolCallId:entry.origin.spawnToolCallId,toolName:"Agent",details:{agentId:entry.origin.childId}}];}
test("reload validates public origin/history and SDK identity; generation does not restart",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();const entry=f.entries.at(-1)!;f.observer.dispose();
 const g=new ChildObserver({owner,store:new AccountingStore(f.file),eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});
 g.restore(entry,[]);await g.flush();expect(g.status).toBe("unknown-attribution");expect(r.session.counts().live).toBe(0);
 g.restore(entry,history(entry));await g.flush();const l=await f.load();expect(only(l).accountedUsd).toBe("0.2");expect(Object.values(l.accounting.associations)[0]).toMatchObject({generation:entry.generation+1});
 r.lifetimeUsage.cost=0.3;r.session.emit();await g.flush();expect(only(await f.load()).accountedUsd).toBe("0.3");g.dispose();
});
for(const kind of ["superseded-receipt","forged-generation"])test(`restore refuses ${kind} even with matching SDK`,async()=>{
 const f=await setup();const r=record();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();const e=f.entries.at(-1)!;f.observer.dispose();
 const g=new ChildObserver({owner,store:f.store,eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});
 const resumed=[...history(e),{role:"assistant",content:[{type:"toolCall",id:"later",name:"Agent",arguments:{subagent_type:"probe",description:"d",prompt:"p",resume:"child"}}]},{role:"toolResult",toolName:"Agent",toolCallId:"later",details:{agentId:"child"}}];
 if(kind==="superseded-receipt")g.restore(e,resumed);else g.restore({...e,generation:999},history(e));
 await g.flush();expect(r.session.counts().live).toBe(0);expect(Object.values((await f.load()).accounting.associations)[0]).toMatchObject({generation:e.generation});g.dispose();
});
test("restore projects origin metadata; unknown persisted prompt/key fields are never forwarded",async()=>{
 const f=await setup();const r=record();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();const e=f.entries.at(-1)!;f.observer.dispose();
 const entries:any[]=[];const g=new ChildObserver({owner,store:f.store,eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:(_t,e)=>{entries.push(e);}});
 g.restore({...e,origin:{...e.origin,prompt:"SECRET-PROMPT",apiKey:"SECRET-KEY"}},history(e));await g.flush();expect(entries.length).toBe(1);expect(JSON.stringify(entries)).not.toContain("SECRET");g.dispose();
});
test("async warning rejection cannot leak or become an unhandled observer failure",async()=>{
 const f=await setup({warn:async()=>{throw Error("SECRET");}});const r=record();r.session.subscribe=()=>{throw Error("SECRET");};f.records.set("child",r);f.call();f.receipt();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");f.observer.dispose();
});
test("reload refuses changed SDK identity or forged origin",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();const entry=f.entries.at(-1)!;f.observer.dispose();r.session=session("replacement");
 const g=new ChildObserver({owner,store:f.store,eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});g.restore(entry,history(entry));await g.flush();expect(r.session.counts().live).toBe(0);expect(g.status).toBe("unknown-attribution");g.dispose();
});
for(const replacement of ["new-sdk","same-sdk-id","missing"] as const)for(const route of ["compact","receipt","resume","restore"] as const)
 test(`synthetic public record SDK replacement is unknown, not continuity: ${replacement}/${route}`,async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();
 const old=r.session,entry=f.entries.at(-1)!,ledger=await readFile(f.file,"utf8"),entries=f.entries.length;
 r.session=replacement==="missing"?undefined as any:session(replacement==="same-sdk-id"?old.sessionId:"new-sdk");r.lifetimeUsage.cost=3;
 if(route==="compact")f.events.emit("subagents:compacted",{id:r.id});
 if(route==="receipt")f.receipt();
 if(route==="resume"){f.call("resume",r.id);f.receipt("resume");}
 if(route==="restore")f.observer.restore(entry,history(entry));
 await f.observer.flush();
 expect(f.observer.status).toBe("unknown-attribution");expect(old.counts().live).toBe(0);
 expect(r.session?.counts().subscriptions??0).toBe(0);expect(f.entries).toHaveLength(entries);
 expect(await readFile(f.file,"utf8")).toBe(ledger);expect(f.observer.getBinding(r.id)).toBeUndefined();
 // Compact, old receipts and a fresh resume cannot launder the changed SDK.
 f.events.emit("subagents:compacted",{id:r.id});f.receipt();f.call("later-resume",r.id);f.receipt("later-resume");
 r.session?.emit();old.stale();await f.observer.flush();
 expect(r.session?.counts().subscriptions??0).toBe(0);expect(await readFile(f.file,"utf8")).toBe(ledger);
 f.observer.dispose();
});
test("unknown SDK association can revalidate only the original bound object",async()=>{
 const f=await setup();const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();const old=r.session;
 r.session=session(old.sessionId);f.events.emit("subagents:compacted",{id:r.id});await f.observer.flush();
 expect(f.observer.getBinding(r.id)).toBeUndefined();expect(r.session.counts().subscriptions).toBe(0);
 r.session=old;f.call("verified-resume",r.id);f.receipt("verified-resume");await f.observer.flush();
 expect(f.observer.getBinding(r.id)?.session).toBe(old as any);expect(old.counts().live).toBe(1);f.observer.dispose();
});
for(const service of ["current","replacement"] as const)test(`synthetic old-origin restore cannot launder a different record with a reused SDK identifier: ${service}`,async()=>{
 const f=await setup(),old=record();f.records.set(old.id,old);f.call();f.receipt();await f.observer.flush();const entry=f.entries.at(-1)!,ledger=await readFile(f.file,"utf8");
 const replacement=record();replacement.session=session(old.session.sessionId);f.records.set(old.id,replacement);f.receipt();await f.observer.flush();expect(f.observer.getBinding(old.id)).toBeUndefined();
 const g=service==="current"?f.observer:new ChildObserver({owner,store:new AccountingStore(f.file),eventBus:f.events,getRegistry:()=>({getRecord:()=>replacement}),appendEntry:()=>{}});
 if(service==="replacement")f.observer.dispose();g.restore(entry,history(entry));await g.flush();expect(replacement.session.counts().subscriptions).toBe(0);expect(g.status).toBe("unknown-attribution");expect(g.getBinding(old.id)).toBeUndefined();expect(await readFile(f.file,"utf8")).toBe(ledger);g.dispose();
});
test("synthetic resume cleanup cannot launder a late same-record SDK replacement",async()=>{
 const f=await setup(),r=record(),replacement=session("late-sdk");let armed=false;
 const subscribe=r.session.subscribe.bind(r.session);
 r.session.subscribe=fn=>{const off=subscribe(fn);return ()=>{off();if(armed){armed=false;r.session=replacement;}};};
 f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();const ledger=await readFile(f.file,"utf8"),entries=f.entries.length;
 // Suspension's first detach changes nothing; bind's later cleanup is held
 // until a new revalidated resume actually tries to detach a live subscription.
 f.call("resume",r.id);f.receipt("resume");await f.observer.flush();
 armed=true;f.observer.restore(f.entries.at(-1),[...history(f.entries[0]),
  {role:"assistant",content:[{type:"toolCall",id:"resume",name:"Agent",arguments:{subagent_type:"probe",description:"d",prompt:"p",resume:r.id}}]},
  {role:"toolResult",toolName:"Agent",toolCallId:"resume",details:{agentId:r.id}}]);
 await f.observer.flush();expect(replacement.counts().subscriptions).toBe(0);expect(f.observer.getBinding(r.id)).toBeUndefined();expect(f.observer.status).toBe("unknown-attribution");
 expect(f.entries).toHaveLength(entries+1);expect(only(await f.load()).accountedUsd).toBe(only(JSON.parse(ledger)).accountedUsd);f.observer.dispose();
});
for(const change of ["dispose","owner"]) test(`${change} during register await invalidates callbacks and removes all listeners`,async()=>{
 let release!:(v:string)=>void;const pending=new Promise<string>(resolve=>release=resolve);let observed=0;
 const f=await setup({store:{registerOrigin:()=>pending,observe:async()=>{observed++;return {status:"unknown-attribution"};}}});
 const r=record();f.records.set(r.id,r);f.call();f.receipt();await Promise.resolve();await Promise.resolve();
 if(change==="dispose") f.observer.dispose();else f.changeOwner();release("id");await f.observer.flush();expect(observed).toBe(0);expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
test("an old exact receipt cannot prove continuity of an ambiguous replacement",async()=>{
 const f=await setup();const a=record();f.records.set("child",a);f.call();f.receipt();await f.observer.flush();
 const b=record("child",3);f.records.set("child",b);f.receipt();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");expect(b.session.counts().live).toBe(0);f.observer.dispose();
});
test("old terminal replay with new reused child missing cost cannot substitute old money",async()=>{
 const f=await setup();f.records.set("child",record());f.call();f.receipt();await f.observer.flush();
 const b=record();b.lifetimeUsage.cost=undefined;f.records.set("child",b);f.call("new");f.receipt("new");await f.observer.flush();
 f.events.emit("subagents:completed",{id:"child",usage:{cost:{total:99}}});await f.observer.flush();const l=await f.load();expect(l.accounting.exactDays["2026-04-01"].total).toBe("0.2");expect(f.observer.status).not.toBe("disposed");f.observer.dispose();
});
test("failed subscribe degrades without blocking receipt accounting",async()=>{
 const f=await setup();const r=record();r.session.subscribe=()=>{throw Error("SECRET");};f.records.set("child",r);f.call();f.receipt();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");expect(f.warnings).toContain("session-subscribe-failed");expect(JSON.stringify(f.warnings)).not.toContain("SECRET");f.observer.dispose();expect(f.events.count()).toBe(0);
});
test("runtime owner invalidation is explicit even without another backend event",async()=>{
 const f=await setup();const r=record();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();f.observer.ownerChanged("other");expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
for(const phase of ["observe","append"])test(`dispose during ${phase} await rejects later work and queued callbacks`,async()=>{
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),pending=new Promise<void>(r=>release=r);let observes=0;
 const f=await setup();const g=new ChildObserver({owner,eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),store:{registerOrigin:f.store.registerOrigin.bind(f.store),observe:async o=>{observes++;enter();await pending;return f.store.observe(o);}},
 appendEntry:async()=>{if(phase==="append"){enter();await pending;}}});const r=record();g.observeToolCall({toolName:"Agent",toolCallId:"spawn",input:{subagent_type:"probe",description:"d",prompt:"p"}});g.observeToolResult({toolName:"Agent",toolCallId:"spawn",details:{agentId:"child"}});
 await entered;r.session.emit();g.dispose();release();await g.flush();expect(observes).toBe(phase==="observe"?1:0);expect(r.session.counts().live).toBe(0);f.observer.dispose();
});
test("reload of mixed priced/unpriced subtotal deduplicates and preserves model/gap metadata",async()=>{
 const f=await setup();const r=record();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();r.session.emit({type:"message_end",message:{role:"assistant",usage:{input:10}}});await f.observer.flush();const e=f.entries.at(-1)!;f.observer.dispose();
 const g=new ChildObserver({owner,store:f.store,eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});g.restore(e,history(e));await g.flush();const l=await f.load();expect(only(l).accountedUsd).toBe("0.2");expect(only(l).pricing.reasons).toContain("unpriced-contribution");expect(only(l).lastModelKey).toBe("unknown-child-model");g.dispose();
});
for(const phase of ["register","append","observe"] as const)for(const ownerState of ["changed","unavailable","throws"] as const)
 test(`${ownerState} owner during rejected ${phase} await cleans listeners without another event`,async()=>{
 let enter!:()=>void,reject!:(e:Error)=>void;const entered=new Promise<void>(r=>enter=r),pending=new Promise<never>((_r,j)=>reject=j);
 let currentOwner:string|undefined=owner,readsThrow=false,appends=0,observes=0;
 const f=await setup({getOwner:()=>{if(readsThrow)throw Error("SECRET-OWNER");return currentOwner;},
   store:{registerOrigin:async()=>{if(phase==="register"){enter();return pending;}return "id";},
     observe:async()=>{observes++;enter();return pending;}},
   appendEntry:async()=>{appends++;if(phase==="append"){enter();await pending;}}});
 const r=record();f.records.set(r.id,r);f.call();f.receipt();await entered;
 if(ownerState==="throws")readsThrow=true;else currentOwner=ownerState==="changed"?"other":undefined;
 reject(Error("SECRET-REJECTION"));await f.observer.flush();
 expect(f.observer.status).toBe("disposed");expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
 expect(appends).toBe(phase==="register"?0:1);expect(observes).toBe(phase==="observe"?1:0);
 r.session.stale();f.receipt();await f.observer.flush();expect(observes).toBe(phase==="observe"?1:0);
 expect(JSON.stringify(f.warnings)).not.toContain("SECRET");
});
for(const mode of ["initial","resume"] as const)for(const failure of ["throw","reject"] as const)
 test(`${mode} ${failure} append failure retries the same registration before charging and restores persisted history`,async()=>{
 const persisted:ObserverEntry[]=[];let appends=0,fail=false,registers=0;
 const f=await setup({appendEntry:(_t:string,e:ObserverEntry)=>{
   appends++;if(fail){fail=false;if(failure==="throw")throw Error("SECRET-APPEND");return Promise.reject(Error("SECRET-APPEND"));}
   persisted.push(structuredClone(e));
 }});
 const register=f.store.registerOrigin.bind(f.store);f.store.registerOrigin=async(...args)=>{registers++;return register(...args);};
 const r=record();f.records.set(r.id,r);
 if(mode==="resume"){f.call();f.receipt();await f.observer.flush();r.lifetimeUsage.cost=0.3;}
 fail=true;f.call(mode==="resume"?"resume":"spawn",mode==="resume"?r.id:undefined);f.receipt(mode==="resume"?"resume":"spawn");await f.observer.flush();
 const before=await f.load(),association=Object.values(before.accounting.associations)[0];
 expect(only(before).accountedUsd).toBe(mode==="resume"?"0.2":"0");expect(f.observer.status).toBe("degraded");
 expect(persisted).toHaveLength(mode==="resume"?1:0);const priorRegisters=registers,priorAppends=appends;
 await f.observer.flush();expect(appends).toBe(priorAppends); // No timer/flush-driven retry.
 const messages=mode==="resume"?[...history(persisted[0]),
   {role:"assistant",content:[{type:"toolCall",id:"resume",name:"Agent",arguments:{subagent_type:"probe",description:"d",prompt:"p",resume:"child"}}]},
   {role:"toolResult",toolCallId:"resume",toolName:"Agent",details:{agentId:"child"}}]:history({origin:{spawnToolCallId:"spawn",childId:"child"}} as ObserverEntry);
 if(mode==="resume"){
   const stale=new ChildObserver({owner,store:new AccountingStore(f.file),eventBus:bus(),getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});
   stale.restore(persisted[0],messages);await stale.flush();expect(stale.status).toBe("unknown-attribution");stale.dispose();
 }
 r.lifetimeUsage.cost=0.3;r.session.emit();r.session.emit();await f.observer.flush();
 const after=await f.load(),entry=persisted.at(-1)!;
 expect(registers).toBe(priorRegisters);expect(appends).toBe(priorAppends+1);expect(Object.values(after.accounting.associations)[0]).toEqual(association);
 expect(entry.correlationToolCallId).toBe(mode==="resume"?"resume":"spawn");expect(entry.generation).toBe(mode==="resume"?2:1);
 expect(only(after).accountedUsd).toBe("0.3");expect(only(after).lastReportedUsd).toBe("0.3");expect(after.accounting.exactDays["2026-04-01"].total).toBe("0.3");
 expect(JSON.stringify(f.warnings)).not.toContain("SECRET");f.observer.dispose();
 const restored=new ChildObserver({owner,store:new AccountingStore(f.file),eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:(_t,e)=>{persisted.push(structuredClone(e));}});
 restored.restore(entry,messages);await restored.flush();expect(restored.status).toBe("observing");expect(r.session.counts().live).toBe(1);
 r.session.emit();await restored.flush();const reload=await f.load();expect(only(reload).accountedUsd).toBe("0.3");expect(reload.accounting.exactDays["2026-04-01"].total).toBe("0.3");
 restored.dispose();expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
test("permanent append rejection never observes and cleanup remains available",async()=>{
 let appends=0,observes=0;const f=await setup({appendEntry:async()=>{appends++;throw Error("SECRET");}});
 const observe=f.store.observe.bind(f.store);f.store.observe=async(...args)=>{observes++;return observe(...args);};
 const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();r.session.emit();await f.observer.flush();
 expect(appends).toBe(2);expect(observes).toBe(0);expect(only(await f.load()).accountedUsd).toBe("0");expect(f.observer.status).toBe("degraded");
 expect(f.warnings).toEqual(["accounting-observation-failed","accounting-observation-failed"]);f.observer.dispose();expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
for(const failure of ["registry-throws","registry-disposes","warning-throws","warning-disposes"] as const)
 test(`rejection revalidation contains ${failure} without skipping binding cleanup`,async()=>{
 let enter!:()=>void,reject!:(e:Error)=>void;const entered=new Promise<void>(r=>enter=r),pending=new Promise<never>((_r,j)=>reject=j);
 let broken=false,observes=0;const r=record();
 const f=await setup({getRegistry:()=>{
   if(broken && failure.startsWith("registry")){if(failure==="registry-disposes")f.observer.dispose();throw Error("SECRET-READ");}
   return {getRecord:()=>broken?undefined:r};
 },appendEntry:()=>{enter();return pending;},warn:()=>{
   if(failure==="warning-disposes")f.observer.dispose();if(failure.startsWith("warning"))throw Error("SECRET-WARNING");
 }});
 f.store.observe=async()=>{observes++;return {status:"unknown-attribution"};};
 f.call();f.receipt();await entered;broken=true;reject(Error("SECRET-APPEND"));await f.observer.flush();
 expect(observes).toBe(0);expect(r.session.counts().live).toBe(0);
 expect(f.observer.status).toBe(failure.endsWith("disposes")?"disposed":"degraded");
 f.observer.dispose();expect(f.events.count()).toBe(0);r.session.stale();await f.observer.flush();expect(observes).toBe(0);
});
test("stale rejected append cannot invalidate or persist a resumed replacement binding",async()=>{
 let enter!:()=>void,reject!:(e:Error)=>void;const entered=new Promise<void>(r=>enter=r),pending=new Promise<never>((_r,j)=>reject=j);
 const persisted:ObserverEntry[]=[];let appends=0;
 const f=await setup({appendEntry:(_t:string,e:ObserverEntry)=>{if(++appends===1){enter();return pending;}persisted.push(structuredClone(e));}});
 const r=record();f.records.set(r.id,r);f.call();f.receipt();await entered;
 f.call("resume",r.id);f.receipt("resume");reject(Error("SECRET"));await f.observer.flush();
 expect(persisted).toHaveLength(1);expect(persisted[0].correlationToolCallId).toBe("resume");expect(persisted[0].generation).toBe(2);
 expect(r.session.counts()).toEqual({subscriptions:2,removals:1,live:1});expect(only(await f.load()).accountedUsd).toBe("0.2");
 r.lifetimeUsage.cost=0.3;r.session.stale();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.2");
 r.session.emit();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0.3");f.observer.dispose();expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
test("append write with lost acknowledgement may duplicate identity but latest persisted entry safely restores",async()=>{
 const persisted:ObserverEntry[]=[];const f=await setup({appendEntry:async(_t:string,e:ObserverEntry)=>{persisted.push(structuredClone(e));if(persisted.length===1)throw Error("SECRET-ACK");}});
 const r=record();f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();expect(only(await f.load()).accountedUsd).toBe("0");
 r.session.emit();await f.observer.flush();expect(persisted).toHaveLength(2);expect(persisted[1]).toEqual(persisted[0]);expect(only(await f.load()).accountedUsd).toBe("0.2");f.observer.dispose();
 const restored=new ChildObserver({owner,store:new AccountingStore(f.file),eventBus:f.events,getRegistry:()=>({getRecord:()=>r}),appendEntry:()=>{}});
 restored.restore(persisted.at(-1),history(persisted[1]));await restored.flush();expect(restored.status).toBe("observing");expect(only(await f.load()).accountedUsd).toBe("0.2");restored.dispose();expect(f.events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
});
function barrier() {
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>enter=r),pending=new Promise<void>(r=>release=r);
 return {entered,release:()=>release(),hold:async()=>{enter();await pending;}};
}
for(const seam of ["getRegistry","getRecord"] as const)for(const phase of ["register","append"] as const)
 test(`reentrant ${seam} disposal returning valid record after ${phase} admits no later write`,async()=>{
 const gate=barrier(),r=record();let readsUntilDispose=0,appends=0,observes=0;
 const disposeOnRead=()=>{if(readsUntilDispose>0 && --readsUntilDispose===0)f.observer.dispose();};
 const f=await setup({getRegistry:()=>{
   if(seam==="getRegistry")disposeOnRead();
   return {getRecord:()=>{if(seam==="getRecord")disposeOnRead();return r;}};
 },appendEntry:async()=>{appends++;if(phase==="append")await gate.hold();}});
 const register=f.store.registerOrigin.bind(f.store),observe=f.store.observe.bind(f.store);
 f.store.registerOrigin=async(...args)=>{const id=await register(...args);if(phase==="register")await gate.hold();return id;};
 f.store.observe=async(...args)=>{observes++;return observe(...args);};
 f.call();f.receipt();await gate.entered;readsUntilDispose=phase==="register"?1:2;gate.release();await f.observer.flush();
 expect(appends).toBe(phase==="register"?0:1);expect(observes).toBe(0);
 expect(only(await f.load()).accountedUsd).toBe("0"); // Registration already committed; no rollback claim.
 expect(f.observer.status).toBe("disposed");expect(f.events.count()).toBe(0);
 expect(r.session.counts()).toEqual({subscriptions:1,removals:1,live:0});
 r.session.stale();f.receipt();await f.observer.flush();expect(observes).toBe(0);
});
for(const returned of ["valid","unknown"] as const)
 test(`reentrant record read returning ${returned} cannot detach or mark a replacement binding unknown`,async()=>{
 const gate=barrier(),old=record(),replacement=record("child",0.3),persisted:ObserverEntry[]=[];
 let current=old,armed=false,appends=0;
 const f=await setup({getRegistry:()=>({getRecord:()=>{
   const read=current;
   if(armed){armed=false;current=replacement;f.call("replacement");f.receipt("replacement");return returned==="valid"?read:undefined;}
   return read;
 }}),appendEntry:(_t:string,e:ObserverEntry)=>{appends++;persisted.push(structuredClone(e));}});
 const register=f.store.registerOrigin.bind(f.store);let registers=0;
 f.store.registerOrigin=async(...args)=>{const id=await register(...args);if(++registers===1)await gate.hold();return id;};
 f.call();f.receipt();await gate.entered;armed=true;gate.release();await f.observer.flush();
 expect(appends).toBe(1);expect(persisted[0].correlationToolCallId).toBe("replacement");
 expect(f.observer.status).toBe("observing");expect(old.session.counts()).toEqual({subscriptions:1,removals:1,live:0});
 expect(replacement.session.counts()).toEqual({subscriptions:1,removals:0,live:1});
 const ledger=await f.load();expect(Object.values(ledger.accounting.records).map((v:any)=>v.accountedUsd).sort()).toEqual(["0","0.3"]);
 replacement.lifetimeUsage.cost=0.4;old.session.stale();replacement.session.emit();await f.observer.flush();
 expect((await f.load()).accounting.exactDays["2026-04-01"].total).toBe("0.4");
 f.observer.dispose();expect(f.events.count()).toBe(0);expect(replacement.session.counts().live).toBe(0);
});
test("reentrant owner read disposing but returning original owner admits no lifecycle hint",async()=>{
 let armed=false;const f=await setup({getOwner:()=>{if(armed){armed=false;f.observer.dispose();}return owner;}});
 armed=true;f.events.emit("subagents:started",{id:"child"});
 expect(f.observer.status).toBe("disposed");expect(f.observer.pendingCount).toBe(0);expect(f.events.count()).toBe(0);
 await f.observer.flush();expect(f.entries).toHaveLength(0);
});
for(const seam of ["getRegistry","getRecord"] as const)for(const returned of ["valid","unknown"] as const)
 test(`initial ${seam} disposal returning ${returned} cannot install a binding`,async()=>{
 const r=record();let armed=false,registers=0,observes=0;
 const read=()=>{if(armed){armed=false;f.observer.dispose();return returned==="valid"?r:undefined;}return r;};
 const f=await setup({getRegistry:()=>{if(seam==="getRegistry"){const value=read();return {getRecord:()=>value};}return {getRecord:read};}});
 const register=f.store.registerOrigin.bind(f.store),observe=f.store.observe.bind(f.store);
 f.store.registerOrigin=async(...args)=>{registers++;return register(...args);};f.store.observe=async(...args)=>{observes++;return observe(...args);};
 f.events.emit("subagents:started",{id:"child"});f.call();armed=true;f.receipt();await f.observer.flush();
 expect(registers).toBe(0);expect(observes).toBe(0);expect(f.entries).toHaveLength(0);
 expect(r.session.counts()).toEqual({subscriptions:0,removals:0,live:0});expect(f.events.count()).toBe(0);
 expect(f.observer.pendingCount).toBe(0);expect(f.observer.status).toBe("disposed");
});
for(const route of ["receipt","refresh","restore"] as const)for(const seam of ["getRegistry","getRecord"] as const)
 test(`${route} ${seam} dispose-but-return-valid cannot rebind a session`,async()=>{
 const r=record();let armed=false;
 const read=()=>{if(armed){armed=false;g.dispose();}return r;};
 const f=await setup();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();const entry=f.entries.at(-1)!;f.observer.dispose();
 const events=bus(),entries:ObserverEntry[]=[];
 const g=new ChildObserver({owner,store:f.store,eventBus:events,getRegistry:()=>{if(seam==="getRegistry")read();return {getRecord:seam==="getRecord"?read:()=>r};},appendEntry:(_t,e)=>{entries.push(e);}});
 if(route!=="restore"){g.restore(entry,history(entry));await g.flush();r.session=session("replacement-sdk");}
 armed=true;
 if(route==="receipt") {g.observeToolCall({toolName:"Agent",toolCallId:"spawn",input:{subagent_type:"probe",description:"d",prompt:"p"}});g.observeToolResult({toolName:"Agent",toolCallId:"spawn",details:{agentId:"child"}});}
 else if(route==="refresh")events.emit("subagents:compacted",{id:"child"});else g.restore(entry,history(entry));
 await g.flush();expect(g.status).toBe("disposed");expect(events.count()).toBe(0);expect(r.session.counts().live).toBe(0);
 expect(r.session.counts().subscriptions).toBe(route==="restore"?1:0);expect(entries).toHaveLength(route==="restore"?0:1);
 expect(only(await f.load()).accountedUsd).toBe("0.2");
});
for(const change of ["dispose","owner"] as const)test(`observation clock ${change} returning Date admits no new observe`,async()=>{
 let armed=false,observes=0;const f=await setup({now:()=>{if(armed){armed=false;if(change==="dispose")f.observer.dispose();else f.changeOwner();}return new Date("2026-04-01T00:00:01Z");}});
 const observe=f.store.observe.bind(f.store);f.store.observe=async(...args)=>{observes++;return observe(...args);};
 const r=record();f.records.set("child",r);f.call();f.receipt();await f.observer.flush();expect(observes).toBe(1);
 r.lifetimeUsage.cost=0.3;armed=true;r.session.emit();await f.observer.flush();expect(observes).toBe(1);
 expect(only(await f.load()).accountedUsd).toBe("0.2");expect(f.observer.status).toBe("disposed");expect(r.session.counts().live).toBe(0);expect(f.events.count()).toBe(0);
});
for(const change of ["dispose","owner","replacement"] as const)for(const cleanupThrows of [false,true])
 test(`SDK acquisition ${change} releases returned cleanup (throws=${cleanupThrows})`,async()=>{
 const f=await setup(),r=record(),replacement=record("child",0.3);let live=0,released=0;
 r.session.subscribe=()=>{live++;if(change==="dispose")f.observer.dispose();else if(change==="owner")f.changeOwner();else {f.records.set("child",replacement);f.call("new");f.receipt("new");}
   return ()=>{live--;released++;if(cleanupThrows)throw Error("SECRET-CLEANUP");};};
 f.records.set("child",r);f.call();f.receipt();await f.observer.flush();expect(live).toBe(0);expect(released).toBe(1);
 if(change==="replacement"){expect(replacement.session.counts().live).toBe(1);expect(only(await f.load()).accountedUsd).toBe("0.3");}
 else {expect(f.entries).toHaveLength(0);expect(f.observer.status).toBe("disposed");expect(f.events.count()).toBe(0);}
 f.observer.dispose();expect(replacement.session.counts().live).toBe(0);expect(JSON.stringify(f.warnings)).not.toContain("SECRET");
});
for(const action of ["dispose","replacement"] as const)test(`old SDK cleanup ${action} cannot clobber reentrant binding`,async()=>{
 const f=await setup(),r=record(),replacement=record("child",0.3);const subscribe=r.session.subscribe.bind(r.session);let armed=false;
 r.session.subscribe=fn=>{const off=subscribe(fn);return ()=>{off();if(armed){armed=false;if(action==="dispose")f.observer.dispose();else {f.records.set("child",replacement);f.call("new");f.receipt("new");}}};};
 f.records.set("child",r);f.call();f.receipt();await f.observer.flush();const old=r.session;r.session=session("rebind-sdk");armed=true;
 f.events.emit("subagents:compacted",{id:"child"});await f.observer.flush();expect(old.counts().live).toBe(0);expect(r.session.counts().live).toBe(0);
 if(action==="replacement"){expect(replacement.session.counts().live).toBe(1);expect((await f.load()).accounting.exactDays["2026-04-01"].total).toBe("0.5");}
 else expect(f.observer.status).toBe("disposed");f.observer.dispose();expect(replacement.session.counts().live).toBe(0);
});
for(const returned of ["valid","unknown"] as const)test(`initial read returning ${returned} cannot clobber reentrant replacement`,async()=>{
 const old=record(),replacement=record("child",0.3);let armed=false,current=old;
 const f=await setup({getRegistry:()=>({getRecord:()=>{const r=current;if(armed){armed=false;current=replacement;f.call("new");f.receipt("new");return returned==="valid"?r:undefined;}return r;}})});
 f.call();armed=true;f.receipt();await f.observer.flush();expect(f.entries).toHaveLength(1);expect(f.entries[0].correlationToolCallId).toBe("new");
 expect(old.session.counts().subscriptions).toBe(0);expect(replacement.session.counts().live).toBe(1);expect(f.observer.status).toBe("observing");expect(only(await f.load()).accountedUsd).toBe("0.3");f.observer.dispose();
});
for(const cleanupThrows of [false,true])test(`constructor bus acquisition reentrant disposal releases returned listener (throws=${cleanupThrows})`,()=>{
 let currentOwner=owner,live=0,released=0,acquired=0;
 const g=new ChildObserver({owner,getOwner:()=>currentOwner,store:{registerOrigin:async()=>"id",observe:async()=>({status:"unknown-attribution"})},
 eventBus:{on:(_c,fn)=>{acquired++;live++;currentOwner="other";fn({id:"child"});return ()=>{live--;released++;if(cleanupThrows)throw Error("SECRET");};}},appendEntry:()=>{}});
 expect(g.status).toBe("disposed");expect(g.pendingCount).toBe(0);expect(live).toBe(0);expect(released).toBe(1);expect(acquired).toBe(1);g.dispose();
});
test("unsubscribe failures do not skip other cleanup; warnings sanitized and no rejected callbacks",async()=>{
 const f=await setup({warn:(code:string)=>{if(code.includes("SECRET"))throw Error("leak");}});const r=record();r.session.subscribe=()=>()=>{throw Error("SECRET");};f.records.set(r.id,r);f.call();f.receipt();await f.observer.flush();f.observer.dispose();expect(f.events.count()).toBe(0);
});
