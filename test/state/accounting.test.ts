import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccountingStore, rootOwnerId, accountingId, createUsageRecorder } from "../../src/state/accounting";
import { emptyLedger, loadLedger } from "../../src/core/budget";
import { isolatedChild } from "../support/isolated-child";
import { createEngine } from "../../src/routing/engine";
import { config, analysis } from "../support/fixtures";
const origin = {backend:"@tintinweb/pi-subagents" as const,rootOwnerId:rootOwnerId("/workspace","parent-public"),spawnToolCallId:"spawn-a",childId:"child-a"};
const binding={owner:"public-owner",child:"child-a",generation:1};
const at="2026-03-31T23:59:59Z";
const setup=async()=> {const file=join(await mkdtemp(join(tmpdir(),"accounting-")),"ledger.json");return {file,store:new AccountingStore(file)};};
const observation=(id:string,cost?:number,extra:any={})=>({accountingId:id,authorizedOwner:binding.owner,child:binding.child,bindingGeneration:1,reportedCumulativeUsd:cost,provenance:"record-lifetime" as const,aggregationScope:"top-level-including-descendants" as const,pricing:{status:"incomplete" as const,reasons:["native-coverage-unverified"]},modelKey:"p/m",at,late:false,...extra});
const load=async(file:string)=>JSON.parse(await readFile(file,"utf8"));

for(const missing of ["jev","requests","inputTokens","outputTokens","version","days","months","updatedAt"]) test(`versioned ledger missing ${missing} rejects read and duplicate/write without repairing counters`, async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);await store.observe(observation(id,0.2));
 const event={owner:"o",toolCallId:"t",requests:1 as const,status:"classified" as const,usage:{input_tokens:3,output_tokens:4}};
 await store.recordUsage(event,"delivery");const valid=await readFile(file,"utf8"),l=JSON.parse(valid);
 if(["requests","inputTokens","outputTokens"].includes(missing))delete l.jev[missing];else delete l[missing];
 const malformed=JSON.stringify(l);await writeFile(file,malformed);
 expect(()=>loadLedger(file)).toThrow();expect(await readFile(file,"utf8")).toBe(malformed);
 await expect(new AccountingStore(file).recordUsage(event,"delivery")).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(malformed);
 await expect(new AccountingStore(file).registerOrigin(origin,binding)).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(malformed);
 await writeFile(file,valid);expect(await new AccountingStore(file).recordUsage(event,"delivery")).toMatchObject({status:"duplicate"});
 expect((await load(file)).jev).toEqual({requests:1,inputTokens:3,outputTokens:4});
});

test("absent legacy base fields migrate only before envelope allocation, retaining surplus counters", async()=>{
 for(const legacy of [{},{jev:{requests:7}},{jev:{inputTokens:9,outputTokens:10}}]) {
 const {file,store}=await setup();await writeFile(file,JSON.stringify(legacy));const expected={requests:0,inputTokens:0,outputTokens:0,...legacy.jev};
 expect(loadLedger(file).jev).toEqual(expected);await store.registerOrigin(origin,binding);
 const event={owner:"o",toolCallId:"t",requests:1 as const,status:"failed" as const};await store.recordUsage(event,"delivery");await store.recordUsage(event,"delivery");
 expect((await load(file)).jev).toEqual({...expected,requests:expected.requests+1});
 }
});

test("metadata projection cannot persist unexpected raw prompts or credentials", async()=>{
 const {file,store}=await setup();
 const id=await store.registerOrigin({...origin,prompt:"SECRET-PROMPT",apiKey:"SECRET-KEY"} as any,{...binding,prompt:"SECRET-PROMPT"} as any);
 await store.recordUsage({owner:"o",toolCallId:"t",requests:1,status:"classified",prompt:"SECRET-PROMPT",apiKey:"SECRET-KEY",usage:{input_tokens:1,output_tokens:2,prompt:"SECRET-PROMPT"}} as any);
 await store.observe(observation(id,1,{prompt:"SECRET-PROMPT"}));
 const text=await readFile(file,"utf8");expect(text).not.toContain("SECRET-PROMPT");expect(text).not.toContain("SECRET-KEY");
});
test("malformed legacy nulls fail closed rather than replacing history", async()=>{
 for(const malformed of [{days:null},{jev:null},{jev:{requests:null}}]){
 const {file,store}=await setup();await writeFile(file,JSON.stringify(malformed));const text=await readFile(file,"utf8");
 await expect(store.registerOrigin(origin,binding)).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(text);
 }
});

test("partitioned versus aggregate persisted costs are exact through restarts", async()=>{
 const a=await setup(), b=await setup(); const ia=await a.store.registerOrigin(origin,binding), ib=await b.store.registerOrigin(origin,binding);
 for(let i=1;i<=10;i++) await new AccountingStore(a.file).observe(observation(ia,Number((i*0.00001).toFixed(5))));
 await b.store.observe(observation(ib,0.00010));
 const la=await load(a.file),lb=await load(b.file);
 expect(la.accounting.exactDays).toEqual(lb.accounting.exactDays);
 expect(la.days).toEqual(lb.days);
 expect(la.accounting.records[ia].accountedUsd).toBe("0.0001");
 expect(la.days["2026-03-31"].total).toBe(0.0001);
});
test("immutable origin, replay and revalidated same-lifetime reassociation retain watermark", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 await store.observe(observation(id,1));
 expect(id).toBe(accountingId((await load(file)).accounting.namespace,origin));
 expect(await new AccountingStore(file).registerOrigin(origin,{...binding,owner:"replacement",generation:2})).toBe(id);
 expect(await store.observe(observation(id,2))).toMatchObject({status:"stale-binding"});
 expect((await load(file)).days["2026-03-31"].total).toBe(1);
 await store.observe(observation(id,0.2,{authorizedOwner:"replacement",bindingGeneration:2}));
 await store.observe(observation(id,1.4,{authorizedOwner:"replacement",bindingGeneration:2}));
 expect((await load(file)).accounting.records[id].accountedUsd).toBe("1.4");
 expect((await load(file)).days["2026-03-31"].total).toBe(1.4);
 await expect(store.registerOrigin(origin,{...binding,generation:1})).rejects.toThrow("stale-binding");
});
test("verified new spawn reusing child id is distinct; unresolved attribution never charges", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 await store.observe(observation(id,1));
 const id2=await store.registerOrigin({...origin,spawnToolCallId:"spawn-b"},binding);
 expect(id2).not.toBe(id);await store.observe(observation(id2,2));
 expect((await load(file)).days["2026-03-31"].total).toBe(3);
 expect(await store.observe(observation("unknown-replacement",99))).toMatchObject({status:"unknown-attribution"});
 await expect(store.registerOrigin({...origin,spawnToolCallId:""},binding)).rejects.toThrow();
});
test("cost gaps, forged complete proof and duplicate terminal zero deltas stay incomplete", async()=>{
 const {file,store}=await setup(); const id=await store.registerOrigin(origin,binding);
 for(const [cost,extra] of [[undefined,{}],[NaN,{}],[0,{}],[1,{}],[1,{provenance:"terminal-lifetime",pricing:{status:"incomplete",reasons:["terminal-gap"]}}],[1,{pricing:{status:"complete",evidenceId:"forged"}}]] as const) await store.observe(observation(id,cost,extra));
 const r=(await load(file)).accounting.records[id];
 expect(r.accountedUsd).toBe("1");expect(r.pricing.status).toBe("incomplete");
 for(const gap of ["cost-unavailable","cost-invalid","zero-unproven","terminal-gap","unsupported-complete-proof","native-coverage-unverified"])expect(r.pricing.reasons).toContain(gap);
 await store.observe(observation(id,1,{at:"2026-03-01T00:00:00Z",pricing:{status:"complete",evidenceId:"stale"}}));
 expect((await load(file)).accounting.records[id].lastObservedAt).toBe(at);
 expect((await load(file)).accounting.records[id].pricing.reasons).toContain("terminal-gap");
});
test("explicit UTC month rollover and late aggregate use observation time", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 await store.observe(observation(id,0.00004));
 await store.observe(observation(id,0.0001,{at:"2026-04-01T00:00:01Z",late:true,modelKey:undefined}));
 const l=await load(file);expect(l.accounting.exactMonths["2026-03"].total).toBe("0.00004");expect(l.accounting.exactMonths["2026-04"].total).toBe("0.00006");
 expect(l.accounting.exactDays["2026-04-01"].byModel["unknown-child-model"]).toBe("0.00006");expect(l.accounting.records[id].late).toBe(true);
});
test("legacy numbers seed exact buckets once without losing Jev counters", async()=>{
 const {file,store}=await setup(); const l=emptyLedger();l.days["2026-03-31"]={total:0.3,byModel:{"p/m":0.3}}; l.months["2026-03"]={...l.days["2026-03-31"]};l.jev.requests=7; await writeFile(file,JSON.stringify(l));
 const id=await store.registerOrigin(origin,binding);await store.observe(observation(id,0.00004));await new AccountingStore(file).observe(observation(id,0.00004));
 const out=await load(file);expect(out.accounting.exactDays["2026-03-31"].total).toBe("0.30004");expect(out.jev.requests).toBe(7);expect(out.accounting.migration.status).toBe("incomplete");
});
test("corruption and failed transactions preserve both watermark and buckets", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);await store.observe(observation(id,1));const before=await readFile(file,"utf8");
 for(const stage of ["temp-write","rename"] as const) {
 const bad=new AccountingStore(file,{before:s=>{if(s===stage)throw Error("failure");}});
 await expect(bad.observe(observation(id,2))).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(before);
 }
 await mkdir(file+".lock");await expect(new AccountingStore(file,{timeoutMs:5}).observe(observation(id,2))).rejects.toThrow("lock-timeout");expect(await readFile(file,"utf8")).toBe(before);
 const other=await setup();await writeFile(other.file,"{bad");await expect(other.store.registerOrigin(origin,binding)).rejects.toThrow();expect(await readFile(other.file,"utf8")).toBe("{bad");
});
test("persisted decimals and identity tampering are rejected before arithmetic", async()=>{
 for(const tamper of [(l:any,id:string)=>l.accounting.records[id].accountedUsd="1e999999",(l:any,id:string)=>l.accounting.records[id].origin.spawnToolCallId="tampered",(l:any)=>l.accounting.exactDays["2026-03-31"].total="-1"]) {
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);await store.observe(observation(id,1));const l=await load(file);tamper(l,id);await writeFile(file,JSON.stringify(l));const before=await readFile(file,"utf8");await expect(store.observe(observation(id,2))).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(before);
 }
});
test("durable classifier adapter counts legitimate retries independently; explicit event id dedups", async()=>{
 const {file,store}=await setup();const recorder=createUsageRecorder(store);
 await recorder({owner:"o",toolCallId:"t",requests:1,status:"failed"});await recorder({owner:"o",toolCallId:"t",requests:1,status:"classified",usage:{input_tokens:3,output_tokens:4}});
 await store.recordUsage({owner:"o",toolCallId:"t",requests:1,status:"failed"},"delivery-1");await store.recordUsage({owner:"o",toolCallId:"t",requests:1,status:"failed"},"delivery-1");
 const l=await load(file);expect(l.jev).toEqual({requests:3,inputTokens:3,outputTokens:4});expect(Object.values(l.accounting.evaluations).filter((e:any)=>e.usageStatus==="unavailable").length).toBe(2);
 await mkdir(file+".lock");const bad=createUsageRecorder(new AccountingStore(file,{timeoutMs:5}));await expect(bad({owner:"o",toolCallId:"t",requests:1,status:"failed"})).rejects.toThrow("lock-timeout");
});
test("Task7 recordUsage adapter persists evaluations and exposes commit failure without prompts", async()=>{
 const {file,store}=await setup(); const c=config();c.apiKey="SYNTHETIC-KEY";
 const engine=createEngine({classify:async()=>analysis({usage:undefined}),recordUsage:createUsageRecorder(store)});
 const task={owner:"public-owner",toolCallId:"call",generation:1,prompt:"SECRET-PROMPT",agent:"worker",original:{}};
 const snapshot={owner:"public-owner",generation:1,config:c};
 const result=await engine(task,snapshot,[],{today:0,month:0,pressure:0},new AbortController().signal);
 expect(result.degraded).toEqual([]);expect((await load(file)).jev.requests).toBe(1);
 await mkdir(file+".lock");
 const bad=createEngine({classify:async()=>analysis(),recordUsage:createUsageRecorder(new AccountingStore(file,{timeoutMs:5}))});
 const failed=await bad(task,snapshot,[],{today:0,month:0,pressure:0},new AbortController().signal);
 expect(failed.degraded).toContain("usage-callback-failed");expect((await load(file)).jev.requests).toBe(1);
 expect(await readFile(file,"utf8")).not.toContain("SECRET-PROMPT");expect(await readFile(file,"utf8")).not.toContain("SYNTHETIC-KEY");
});

test("independent isolated processes deduplicate same origin and retain different updates", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 const spawn=(spawnId:string,cost:string)=>{const spec=isolatedChild("run",[fileURLToPath(new URL("../support/accounting-child.ts",import.meta.url)),file,spawnId,cost]);return Bun.spawn(spec.argv,{env:spec.env,stdout:"pipe",stderr:"pipe"});};
 const a=spawn("spawn-a","1"),b=spawn("spawn-a","1");expect(await a.exited).toBe(0);expect(await b.exited).toBe(0);
 expect((await load(file)).accounting.records[id].accountedUsd).toBe("1");
 const c=spawn("spawn-b","2"),d=spawn("spawn-c","3");expect(await c.exited).toBe(0);expect(await d.exited).toBe(0);
 expect((await load(file)).days["2026-03-31"].total).toBe(6);
},30000);
test("two first-launch processes allocate only one namespace and deduplicate durable origin", async()=>{
 const {file}=await setup();
 const spec=isolatedChild("run",[fileURLToPath(new URL("../support/accounting-child.ts",import.meta.url)),file,"spawn-a","0.0001"]);
 const a=Bun.spawn(spec.argv,{env:spec.env,stdout:"pipe",stderr:"pipe"});
 const second=isolatedChild("run",[fileURLToPath(new URL("../support/accounting-child.ts",import.meta.url)),file,"spawn-a","0.0001"]);
 const b=Bun.spawn(second.argv,{env:second.env,stdout:"pipe",stderr:"pipe"});
 expect(await a.exited).toBe(0);expect(await b.exited).toBe(0);
 const l=await load(file);expect(Object.keys(l.accounting.records)).toEqual([accountingId(l.accounting.namespace,origin)]);expect(l.accounting.exactDays["2026-03-31"].total).toBe("0.0001");
},30000);

test("partition and aggregate with same explicit attribution time agree on either side of UTC rollover", async()=>{
 for(const time of [at,"2026-04-01T00:00:00Z"]) {
 const a=await setup(),b=await setup();const ia=await a.store.registerOrigin(origin,binding),ib=await b.store.registerOrigin(origin,binding);
 for(const cost of [0.00001,0.00002,0.00003,0.00004,0.00005,0.00006,0.00007,0.00008,0.00009,0.0001])await a.store.observe(observation(ia,cost,{at:time}));
 await b.store.observe(observation(ib,0.0001,{at:time}));
 expect((await load(a.file)).accounting.exactDays).toEqual((await load(b.file)).accounting.exactDays);expect((await load(a.file)).accounting.exactMonths).toEqual((await load(b.file)).accounting.exactMonths);
 }
});
test("lost acknowledgement replay deduplicates durable watermark and namespace allocation", async()=>{
 const {file}=await setup();const store=new AccountingStore(file);const id=await store.registerOrigin(origin,binding);
 const lostAck=async()=>{await store.observe(observation(id,1));throw Error("simulated-lost-caller-ack");};
 await expect(lostAck()).rejects.toThrow("simulated-lost-caller-ack");const restarted=new AccountingStore(file);expect(await restarted.registerOrigin(origin,binding)).toBe(id);expect(await restarted.observe(observation(id,1))).toMatchObject({delta:"0"});expect((await load(file)).days["2026-03-31"].total).toBe(1);
});
test("cancelled/overflow commits leave durable origin watermark unchanged", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);await store.observe(observation(id,Number.MAX_VALUE));const before=await readFile(file,"utf8");
 const c=new AbortController();const cancelStore=new AccountingStore(file,{signal:c.signal,before:s=>{if(s==="rename")c.abort();}});
 await expect(cancelStore.observe(observation(id,Number.MAX_VALUE,{pricing:{status:"incomplete",reasons:["new-gap"]}}))).rejects.toThrow("cancelled");expect(await readFile(file,"utf8")).toBe(before);
 const second=await store.registerOrigin({...origin,spawnToolCallId:"other"},binding);const registered=await readFile(file,"utf8");await expect(store.observe(observation(second,Number.MAX_VALUE))).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(registered);expect((await load(file)).accounting.records[second].accountedUsd).toBe("0");
});
test("missing, serialized absent-cost zero and mixed positive/unpriced activity do not imply coverage", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 await store.observe(observation(id));await store.observe(JSON.parse(JSON.stringify(observation(id,0))));await store.observe(observation(id,0.1,{pricing:{status:"incomplete",reasons:["mixed-unpriced-activity"]}}));await store.observe(observation(id,0.1,{provenance:"terminal-lifetime",pricing:{status:"incomplete",reasons:["terminal-gap"]}}));
 const r=(await load(file)).accounting.records[id];expect(r.accountedUsd).toBe("0.1");expect(r.pricing).toEqual({status:"incomplete",reasons:["native-coverage-unverified","cost-unavailable","zero-unproven","mixed-unpriced-activity","terminal-gap"]});
});
test("binding conflict and malformed completeness in persisted history never authorize a new lifetime", async()=>{
 const {file,store}=await setup();const id=await store.registerOrigin(origin,binding);
 await expect(store.registerOrigin(origin,{...binding,owner:"other"})).rejects.toThrow("stale-binding");
 const l=await load(file);l.accounting.records[id].pricing={status:"complete",evidenceId:"forged"};await writeFile(file,JSON.stringify(l));const before=await readFile(file,"utf8");await expect(store.observe(observation(id,1))).rejects.toThrow();expect(await readFile(file,"utf8")).toBe(before);
});
