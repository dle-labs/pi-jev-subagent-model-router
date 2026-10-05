import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

const phases = ["idle", "persisted", "scope-glob", "active", "settled", "background-active", "queued",
  "compaction-active", "busy", "cancelled", "denied", "scope-changed", "scope-malformed", "switch", "stale"];

test("patched public Tintin controls commit atomically or refuse native races", async () => {
  const host = process.env.PI_PATCHED_HOST_ROOT;
  const tintin = process.env.PI_PATCHED_TINTIN_ROOT;
  if (!host || !tintin) throw new Error("Set PI_PATCHED_HOST_ROOT and PI_PATCHED_TINTIN_ROOT; patched verification never silently skips");
  const isolated = isolatedChild("run", [resolve("scripts/child-control-safe.ts"),
    "--host-root", host, "--tintin-root", tintin]);
  const child = Bun.spawn(isolated.argv, {
    env: isolated.env, stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill(), 90_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ exit, err }).toEqual({ exit: 0, err: "" });
    const report = JSON.parse(out);
    expect(report.executionPath).toBe("tintin-native-Agent-public-control");
    expect(report.verifiedContract).toBe("local-patched-idle-configuration");
    expect(report.fullRouterParityVerified).toBe(false);
    expect(report.networkFetchAttempts).toBe(0);
    expect(report.registryReleased).toBe(true);
    expect(report.scenarios.map((s: { phase: string }) => s.phase)).toEqual(phases);
    for (const scenario of report.scenarios) {
      const commits = ["idle", "persisted", "scope-glob"].includes(scenario.phase);
      expect(scenario.result.status).toBe(commits ? "committed" : "rejected");
      expect(scenario.childUsesSelectedHost).toBe(true);
      expect(scenario.parentUnchanged).toBe(true);
      expect(scenario.globalSettingsUnchanged).toBe(true);
      expect(scenario.transcriptPreserved).toBe(true);
      expect(scenario.configurationEntriesAdded).toBe(commits ? 2 : 0);
      expect(scenario.finalModel).toBe(commits ? "after" : "before");
      expect(scenario.finalThinking).toBe(commits ? "high" : "off");
      expect(scenario.disposed).toBe(true);
      if (commits) {
        expect(scenario.replayVerified).toBe(true);
        expect(scenario.conflictRejected).toBe(true);
        expect(scenario.nativeResumeAfterCommit).toBe(true);
      }
      if (scenario.phase === "persisted") expect(scenario.diskPairVerified).toBe(true);
      if (scenario.phase === "queued") expect(scenario.queuedWithoutStarting).toBe(true);
      if (scenario.phase === "compaction-active") expect(scenario.compactionStreamObserved).toBe(true);
    }
    expect(report.host.atomicOperationSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.tintin.entrySha256).toMatch(/^[a-f0-9]{64}$/);
  } finally { clearTimeout(watchdog); }
}, 95_000);
