import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

test("published Tintin native Agent resume crosses the deferred SDK setter", async () => {
  const hostRoot = process.env.PI_PROBE_HOST_ROOT;
  if (!hostRoot) throw new Error("Set PI_PROBE_HOST_ROOT; native integration is never silently skipped");
  const isolated = isolatedChild("run", [resolve("scripts/child-control-race.ts"),
    "--host-root", hostRoot, "--tintin-root", resolve("node_modules/@tintinweb/pi-subagents")]);
  const child = Bun.spawn(isolated.argv, {
    env: isolated.env, stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill(), 25_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, err }).toEqual({ exit: 0, err: "" });
    const report = JSON.parse(out);
    expect(report.executionPath).toBe("tintin-native-Agent");
    expect(report.nativeTintinVerified).toBe(true);
    expect(report.safeControlCapabilityVerified).toBe(false);
    expect(report.tintin.version).toBe("0.19.0");
    expect(report.scenarios.map((s: { assessment: string }) => s.assessment)).toEqual([
      "mutated-during-execution", "mutated-after-intervening-execution", "no-race-observed", "no-race-observed",
    ]);
    for (const scenario of report.scenarios) {
      expect(scenario.native.spawnCalls).toBe(1);
      expect(scenario.native.resumeCalls).toBe(scenario.phase === "idle" ? 0 : 1);
      expect(scenario.native.sameRetainedSession).toBe(true);
      expect(scenario.parentUnchanged).toBe(true);
      expect(scenario.parentTranscriptPreserved).toBe(true);
      expect(scenario.childTranscriptPreserved).toBe(true);
      expect(scenario.continuationVerified).toBe(true);
      expect(scenario.disposed).toBe(true);
    }
    expect(report.registryReleased).toBe(true);
    expect(report.networkFetchAttempts).toBe(0);
  } finally { clearTimeout(watchdog); }
}, 30_000);
