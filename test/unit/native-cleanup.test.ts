import { expect, test } from "bun:test";
import { withNativeCleanup, type NativeCleanup } from "../../scripts/probe/native-cleanup";

const order = ["releaseAuthentication", "abort", "shutdown", "dispose", "unsubscribe:first", "unsubscribe:second", "restoreFetch", "restoreCwd", "removeTemp"];
function fixture(failing?: string, failure: unknown = new Error("cleanup fault")) {
  const attempts: string[] = [];
  const action = (name: string) => () => { attempts.push(name); if (name === failing) throw failure; };
  const cleanup: NativeCleanup = {
    releaseAuthentication: action("releaseAuthentication"), abort: async () => { action("abort")(); },
    shutdown: async () => { action("shutdown")(); }, dispose: action("dispose"),
    unsubscribe: [action("unsubscribe:first"), action("unsubscribe:second")],
    restoreFetch: action("restoreFetch"), restoreCwd: action("restoreCwd"), removeTemp: async () => { action("removeTemp")(); },
  };
  return { attempts, cleanup };
}
async function rejection(run: () => Promise<unknown>) {
  try { await run(); return { rejected: false, error: undefined }; }
  catch (error) { return { rejected: true, error }; }
}
for (const stage of ["abort", "shutdown", "dispose", "unsubscribe:first", "releaseAuthentication", "restoreFetch", "restoreCwd", "removeTemp"]) {
  test(`${stage} failure still attempts every later cleanup in order`, async () => {
    const error = new Error(`${stage} fault`), f = fixture(stage, error);
    const result = await rejection(() => withNativeCleanup(async () => "value", f.cleanup));
    expect(f.attempts).toEqual(order);
    expect(result.rejected).toBe(true);
    expect(result.error).toBeInstanceOf(AggregateError);
    expect((result.error as AggregateError).errors).toEqual([error]);
    expect((result.error as Error).message).toContain(stage.split(":")[0]);
  });
}
test("bounded abort timeout still reaches shutdown and disposal", async () => {
  const f = fixture(), timeout = new Error("Timed out: parent cleanup abort");
  f.cleanup.abort = async () => {
    f.attempts.push("abort");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([new Promise<void>(() => {}), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout), 5); })]); }
    finally { clearTimeout(timer); }
  };
  const result = await rejection(() => withNativeCleanup(async () => "value", f.cleanup));
  expect(f.attempts).toEqual(order);
  expect((result.error as AggregateError).errors).toEqual([timeout]);
});
for (const original of [new Error("body fault"), undefined, null, false, 0, ""]) {
  test(`body failure (${String(original)}) is preserved over cleanup failures`, async () => {
    const f = fixture("abort");
    f.cleanup.dispose = () => { f.attempts.push("dispose"); throw new Error("dispose fault"); };
    const result = await rejection(() => withNativeCleanup(async () => { throw original; }, f.cleanup));
    expect(f.attempts).toEqual(order);
    expect(result.rejected).toBe(true);
    expect(result.error).toBe(original);
  });
}
test("successful body returns only after complete successful cleanup", async () => {
  const f = fixture(), value = {};
  expect(await withNativeCleanup(async () => value, f.cleanup)).toBe(value);
  expect(f.attempts).toEqual(order);
});
test("successful body surfaces all cleanup failures, including undefined throws", async () => {
  const f = fixture("abort", undefined);
  // The fixture default parameter deliberately supplies an Error; replace it to throw undefined.
  f.cleanup.abort = async () => { f.attempts.push("abort"); throw undefined; };
  const later = new Error("shutdown fault");
  f.cleanup.shutdown = async () => { f.attempts.push("shutdown"); throw later; };
  const result = await rejection(() => withNativeCleanup(async () => 1, f.cleanup));
  expect(f.attempts).toEqual(order);
  expect((result.error as AggregateError).errors).toEqual([undefined, later]);
});
