import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

test("patched-control probe refuses published Tintin instead of using raw setters", async () => {
  const host = process.env.PI_PATCHED_HOST_ROOT;
  if (!host) throw new Error("Set PI_PATCHED_HOST_ROOT; capability refusal test never silently skips");
  const isolated = isolatedChild("run", [resolve("scripts/child-control-safe.ts"),
    "--host-root", host, "--tintin-root", resolve("node_modules/@tintinweb/pi-subagents")]);
  const child = Bun.spawn(isolated.argv, {
    env: isolated.env, stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill(), 20_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(exit).toBe(1);
    expect(out).toBe("");
    const failure = JSON.parse(err);
    expect(failure.outcome).toBe("safe-probe-failed");
    expect(failure.message).toContain("Unsupported Tintin public registry: missing configureIdleChild");
  } finally { clearTimeout(watchdog); }
}, 25_000);
