import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

async function run(host: string, tintin: string) {
  const isolated = isolatedChild("run", [resolve("scripts/child-control-capability-probe.ts"),
    "--host-root", host, "--tintin-root", tintin]);
  const child = Bun.spawn(isolated.argv, { env: isolated.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 90_000);
  try {
    const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { exit, err, report: out ? JSON.parse(out) : undefined };
  } finally { clearTimeout(timer); }
}

test("published 3B is explicitly blocked without raw setter fallback", async () => {
  const host = process.env.PI_PROBE_HOST_ROOT;
  if (!host) throw new Error("PI_PROBE_HOST_ROOT required");
  const result = await run(host, resolve("node_modules/@tintinweb/pi-subagents"));
  expect(result.exit).toBe(2);
  expect(result.err).toBe("");
  expect(result.report.gate).toBe("3B");
  expect(result.report.status).toBe("blocked");
  expect(result.report.missing).toContain("Pi.configureIfIdle");
  expect(result.report.setterFallbackUsed).toBe(false);
}, 95_000);

test("local patched 3B verifies only the user-approved supported lifecycle", async () => {
  const host = process.env.PI_PATCHED_HOST_ROOT, tintin = process.env.PI_PATCHED_TINTIN_ROOT;
  if (!host || !tintin) throw new Error("Explicit patched runtime roots required");
  const result = await run(host, tintin);
  expect({ exit: result.exit, err: result.err }).toEqual({ exit: 0, err: "" });
  expect(result.report.gate).toBe("3B");
  expect(result.report.status).toBe("verified-supported-lifecycle");
  expect(result.report.runtime).toBe("local-patched-only");
  expect(result.report.supportedLifecycleVerified).toBe(true);
  expect(result.report.missing).toEqual([]);
  expect(result.report.setterFallbackUsed).toBe(false);
  for (const key of ["actualRetainedChildReplacement", "ownershipChange"]) {
    const cell = result.report.requiredPublicLifecycle[key];
    expect(cell).toMatchObject({
      status: "not-applicable", reason: "unsupported-public-lifecycle", exercised: false,
      nativeVerified: false, userDecision: "Scope to supported lifecycle (Recommended)",
    });
    expect(cell.sourceEvidence.length).toBeGreaterThan(0);
    expect(cell.detail.length).toBeGreaterThan(0);
  }
  expect(result.report.requiredPublicLifecycle.disposal).toMatchObject({
    coverageLayer: "native-public-lifecycle", authenticationPending: true,
    result: { status: "rejected", reason: "disposed" },
    allSessionsUnchangedAfterLifecycle: true, allPairsAndTranscriptsPreserved: true,
    parentUnchanged: true, settingsUnchanged: true,
  });
  expect(result.report.requiredPublicLifecycle.disposal.afterLifecycle.original.snapshot.revision)
    .toBeGreaterThan(result.report.requiredPublicLifecycle.disposal.before.original.snapshot.revision);
  expect(result.report.requiredPublicLifecycle.disposal.afterRefusal)
    .toEqual(result.report.requiredPublicLifecycle.disposal.afterLifecycle);
  expect(result.report.foundation.scenarios).toHaveLength(15);
  expect(result.report.foundation.networkFetchAttempts).toBe(0);
  expect(result.report.foundation.registryReleased).toBe(true);
  expect(result.report.foundation.executionPath).toBe("tintin-native-Agent-public-control");
  expect(result.report.foundation.scenarios.map((row: any) => row.phase)).toEqual([
    "idle", "persisted", "scope-glob", "active", "settled", "background-active", "queued",
    "compaction-active", "busy", "cancelled", "denied", "scope-changed", "scope-malformed", "switch", "stale",
  ]);
  for (const row of result.report.foundation.scenarios) {
    expect(row.childUsesSelectedHost).toBe(true);
    expect(row.parentUnchanged).toBe(true);
    expect(row.globalSettingsUnchanged).toBe(true);
    expect(row.transcriptPreserved).toBe(true);
    const commits = ["idle", "persisted", "scope-glob"].includes(row.phase);
    expect(row.configurationEntriesAdded).toBe(commits ? 2 : 0);
    expect(row.result.status).toBe(commits ? "committed" : "rejected");
    expect(row.finalModel).toBe(commits ? "after" : "before");
    expect(row.finalThinking).toBe(commits ? "high" : "off");
    expect(row.replayVerified).toBe(commits);
    expect(row.conflictRejected).toBe(commits);
    expect(row.nativeResumeAfterCommit).toBe(commits);
    expect(row.diskPairVerified).toBe(row.phase === "persisted");
    expect(row.queuedWithoutStarting).toBe(row.phase === "queued");
    expect(row.compactionStreamObserved).toBe(row.phase === "compaction-active");
    expect(row.disposed).toBe(true);
  }
  expect(result.report.measuredContractsValid).toBe(true);
  expect(result.report.additional.configurationEntriesAdded).toBe(2);
  expect(result.report.additional.invalid).toMatchObject({ status: "rejected", reason: "invalid" });
  expect(result.report.additional.committed.status).toBe("committed");
  expect(result.report.additional.recovered).toEqual(result.report.additional.committed);
  expect(result.report.requiredPublicLifecycle.actualRetainedChildReplacement.sourceEvidence.length).toBeGreaterThan(0);
  expect(result.report.additional.shutdownListenerCount).toBe(0);
  expect(result.report.additional.networkFetchAttempts).toBe(0);
  expect(result.report.additional.secondFieldNonmutation).toBe(true);
  expect(result.report.additional.invalidAfter).toEqual(result.report.additional.invalidBefore);
  expect(result.report.additional.postCommitListenerError).toBe(true);
  expect(result.report.additional.lostAcknowledgementReceiptLookup).toBe(true);
  const supplemental = result.report.additional.supplementalIdentity;
  expect(supplemental.coverageLayer).toBe("supplemental-adversarial-public-record");
  expect(supplemental.nativeLifecycleReplacementVerified).toBe(false);
  for (const row of [supplemental.ownership, supplemental.replacement]) {
    expect(row.control).toMatchObject({ status: "rejected", reason: "unauthorized" });
    expect(row.before.original.snapshot).toBeDefined();
    expect(row.before.other.snapshot).toBeDefined();
    expect(row.snapshotResult).toMatchObject({ status: "rejected", reason: "unauthorized" });
    expect(row.afterSnapshotRefusal).toEqual(row.before);
    expect(row.afterRefusal).toEqual(row.before);
    expect(row.afterRestore).toEqual(row.before);
    expect(row.publicFieldRestored).toBe(true);
    expect(row.parentUnchanged).toBe(true);
    expect(row.settingsUnchanged).toBe(true);
  }
  expect(result.report.fullRouterParityVerified).toBe(false);
}, 95_000);
