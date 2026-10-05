import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withAtomicJson } from "../../src/state/atomic";

test("cleanup refuses another owner's replacement metadata", async () => {
 const file=await path();
 await withAtomicJson(file,update,{afterRename:()=>{}});
 await withAtomicJson(file,async s=>{
   await writeFile(file+".lock/owner.json",JSON.stringify({token:"another-owner",pid:99}));
   return update(s);
 });
 expect(JSON.parse(await readFile(file+".lock/owner.json","utf8")).token).toBe("another-owner");
});
const path = async () => join(await mkdtemp(join(tmpdir(), "atomic-")), "ledger.json");
const update = (s: any) => ({ state: { n: (s?.n ?? 0)+1 }, value: "ok" });
test("transaction reads latest under lock, private replacement and owner cleanup", async () => {
 const file = await path();
 await Promise.all(Array.from({length:20},()=>withAtomicJson(file, update)));
 expect(JSON.parse(await readFile(file,"utf8"))).toEqual({n:20});
 expect((await stat(file)).mode & 0o777).toBe(0o600);
 expect(await readdir(join(file,".."))).toEqual(["ledger.json"]);
});
test("corrupt or nonreadable existing history never becomes empty", async () => {
 const file=await path(); await writeFile(file,"{broken");
 await expect(withAtomicJson(file,update)).rejects.toThrow("invalid-json");
 expect(await readFile(file,"utf8")).toBe("{broken");
 const dir=await path(); await mkdir(dir);
 await expect(withAtomicJson(dir,update)).rejects.toThrow();
});
test("stale lock timeout and cancellation never steal another owner's lock", async () => {
 const file=await path(); await mkdir(file+".lock"); await writeFile(file+".lock/owner.json", "other-process");
 await expect(withAtomicJson(file,update,{timeoutMs:15,retryMs:2})).rejects.toThrow("lock-timeout");
 const c=new AbortController();c.abort();
 await expect(withAtomicJson(file,update,{signal:c.signal})).rejects.toThrow("cancelled");
 expect(await readFile(file+".lock/owner.json","utf8")).toBe("other-process");
});
test("cancel before replacement preserves history and cleans owned lock/temp", async () => {
 const file=await path(); await withAtomicJson(file, update);
 const c=new AbortController();
 await expect(withAtomicJson(file,s=>{ c.abort(); return update(s); },{signal:c.signal})).rejects.toThrow("cancelled");
 expect(JSON.parse(await readFile(file,"utf8"))).toEqual({n:1});
 expect(await readdir(join(file,".."))).toEqual(["ledger.json"]);
});
test("faults before rename preserve ledger; committed rename remains truthful even after abort", async () => {
 const file=await path(); await withAtomicJson(file,update);
 for(const stage of ["temp-write","rename"] as const) {
   await expect(withAtomicJson(file,update,{before: s=>{if(s===stage)throw new Error("injected");}})).rejects.toThrow("transaction-failed");
   expect(JSON.parse(await readFile(file,"utf8"))).toEqual({n:1});
 }
 const c=new AbortController();
 expect(await withAtomicJson(file,update,{signal:c.signal,afterRename:()=>c.abort()})).toBe("ok");
 expect(JSON.parse(await readFile(file,"utf8"))).toEqual({n:2});
});
test("failed owner metadata write cleans only this invocation's partial owner file", async () => {
 const file=await path();
 await expect(withAtomicJson(file,update,{before:s=>{if(s==="owner-write")throw Error("owner-fault");}})).rejects.toThrow("transaction-failed");
 expect(await readdir(join(file,".."))).toEqual([]);
});

test("crash remnants are not authoritative and owner metadata is written", async () => {
 const file=await path(); await writeFile(file+".tmp-crash", "{bad");
 await withAtomicJson(file, async s => {
   const owner=JSON.parse(await readFile(file+".lock/owner.json","utf8"));
   expect(owner.pid).toBe(process.pid); expect(typeof owner.token).toBe("string");
   return update(s);
 });
 expect(JSON.parse(await readFile(file,"utf8"))).toEqual({n:1});
 expect(await readFile(file+".tmp-crash","utf8")).toBe("{bad");
});
