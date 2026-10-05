import { lstat, mkdir, open, readFile, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export interface AtomicOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryMs?: number;
  /** Narrow failure-injection seam; no backend replacement or state exposure. */
  before?: (stage: "owner-write" | "temp-write" | "rename") => void | Promise<void>;
  afterRename?: () => void;
}
export class AtomicError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AtomicError"; }
}
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new AtomicError("cancelled"); };
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  cancelled(signal);
  await new Promise<void>((accept,reject)=>{
    const done=()=>{signal?.removeEventListener("abort",abort);accept();};
    const timer=setTimeout(done,ms);
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new AtomicError("cancelled"));};
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted)abort();
  });
}
/** One cooperating-writer transaction. Never steals locks, including crash locks.
 * File fsync precedes rename; directory fsync/power-loss durability is NOT claimed.
 * Successful rename is the commit point. Postcommit cancellation isn't rollback. */
export async function withAtomicJson<T,R>(file: string, update: (state: T | undefined) => {state:T;value:R} | Promise<{state:T;value:R}>, options: AtomicOptions = {}): Promise<R> {
  file = resolve(file);
  const timeout = options.timeoutMs ?? 2000, retry = options.retryMs ?? 10;
  if (!Number.isFinite(timeout) || timeout < 0 || timeout > 60000 || !Number.isFinite(retry) || retry < 1 || retry > 1000) throw new AtomicError("invalid-lock-options");
  const lock = file + ".lock", token = randomUUID(), temporary = `${file}.tmp-${token}`;
  let owned = false, tempOwned = false, metadataWritten = false;
  let lockIdentity: { dev: number; ino: number } | undefined;
  let ownerIdentity: { dev: number; ino: number } | undefined;
  const deadline = performance.now() + timeout;
  try {
    cancelled(options.signal);
    await mkdir(dirname(file),{recursive:true});
    for (;;) {
      cancelled(options.signal);
      try { await mkdir(lock,{mode:0o700}); owned=true; break; }
      catch(e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (performance.now() >= deadline) throw new AtomicError("lock-timeout");
        await pause(Math.min(retry, Math.max(1,deadline-performance.now())),options.signal);
      }
    }
    const lockStat = await lstat(lock); lockIdentity = {dev:lockStat.dev,ino:lockStat.ino};
    const ownerHandle = await open(`${lock}/owner.json`,"wx",0o600);
    try {
      const ownerStat=await ownerHandle.stat();ownerIdentity={dev:ownerStat.dev,ino:ownerStat.ino};
      await options.before?.("owner-write");
      cancelled(options.signal);
      await ownerHandle.writeFile(JSON.stringify({token,pid:process.pid,at:new Date().toISOString()}));metadataWritten=true;
    } finally { await ownerHandle.close(); }
    cancelled(options.signal);
    let state: T | undefined;
    let text: string | undefined;
    try { text = await readFile(file,"utf8"); } catch(e) { if(!missing(e))throw new AtomicError("ledger-read-failed"); }
    if(text !== undefined) {
      try { state = JSON.parse(text); } catch { throw new AtomicError("invalid-json"); }
    }
    const next = await update(state);
    cancelled(options.signal);
    const encoded = JSON.stringify(next.state);
    if (encoded === undefined) throw new AtomicError("invalid-state");
    const handle = await open(temporary,"wx",0o600);tempOwned=true;
    try {
      await options.before?.("temp-write");
      cancelled(options.signal);
      await handle.writeFile(encoded+"\n","utf8");await handle.sync();
    } finally { await handle.close(); }
    await options.before?.("rename");
    cancelled(options.signal);
    await rename(temporary,file);tempOwned=false;
    // A lost acknowledgement must be resolved by retrying the durable identity/
    // watermark, not advancing any caller-local watermark. Test seam is contained.
    try { options.afterRename?.(); } catch { /* already committed */ }
    return next.value;
  } catch(e) {
    if(e instanceof AtomicError)throw e;
    throw new AtomicError("transaction-failed");
  } finally {
    if(tempOwned) {try{await unlink(temporary);}catch{/* cleanup cannot rewrite history */}}
    // Only this invocation's successfully acquired directory. No stale lock removal.
    if(owned && lockIdentity) {
      try {
        const current = await lstat(lock);
        if(current.dev===lockIdentity.dev && current.ino===lockIdentity.ino) {
          if(metadataWritten) {
            const owner=JSON.parse(await readFile(`${lock}/owner.json`,"utf8"));
            if(owner.token===token) {await unlink(`${lock}/owner.json`);await rmdir(lock);}
          } else {
            // Failed write may leave our own partial metadata. Identity-check it,
            // never recursively erase unexpected contents or a replaced file.
            if(ownerIdentity) {
              const ownerStat=await lstat(`${lock}/owner.json`);
              if(ownerStat.dev===ownerIdentity.dev && ownerStat.ino===ownerIdentity.ino)await unlink(`${lock}/owner.json`);
            }
            await rmdir(lock);
          }
        }
      } catch {/* no stealing: residual lock degrades later writes to timeout */}
    }
  }
}
