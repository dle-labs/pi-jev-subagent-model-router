import { expect, test } from "bun:test";
import { acquireWithin } from "../../scripts/probe/setup-deadline";

test("setup returns a timely acquisition without disposing it", async () => {
  let disposed = false;
  expect(await acquireWithin(async () => "resource", "setup", async () => { disposed = true; })).toBe("resource");
  expect(disposed).toBe(false);
});
test("timed out setup aborts and disposes a subsequently acquired resource", async () => {
  let release!: (value: string) => void;
  const resource = new Promise<string>(resolve => { release = resolve; });
  let signal!: AbortSignal;
  let disposedValue: string | undefined;
  let cleaned!: () => void;
  const cleanup = new Promise<void>(resolve => { cleaned = resolve; });
  await expect(acquireWithin(s => { signal = s; return resource; }, "late setup", async value => {
    disposedValue = value; cleaned();
  }, 1)).rejects.toThrow("late setup");
  expect(signal.aborted).toBe(true);
  release("late resource");
  await cleanup;
  expect(disposedValue).toBe("late resource");
});
test("setup propagates an immediate failure", async () => {
  await expect(acquireWithin(async () => { throw new Error("bad fixture"); }, "setup", async () => {}))
    .rejects.toThrow("bad fixture");
});
