import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isolatedChild } from "../test/support/isolated-child";
import { validateIsolation } from "../test/support/agent-dir-preload";
import { declaredPublicEntry } from "./probe/public-package";
import { nativeCall } from "./probe/tintin-native";
import { bounded, check, rootsFromArgs, withNativeFixture } from "./compatibility-probe";

export async function runChildControlCapabilityProbe(roots: { hostRoot: string; tintinRoot: string }) {
  validateIsolation();
  const sdk: any = await bounded(import(pathToFileURL(await declaredPublicEntry(roots.hostRoot)).href), "capability SDK import");
  const missing = ["getConfigurationSnapshot", "configureIfIdle", "getConfigurationReceipt"]
    .filter(name => typeof sdk.AgentSession?.prototype[name] !== "function").map(name => `Pi.${name}`);
  if (missing.length) return { gate: "3B", status: "blocked", missing, setterFallbackUsed: false, fullRouterParityVerified: false };
  const additional = await withNativeFixture(roots, async f => {
    const methods = ["getIdleChildConfigurationSnapshot", "configureIdleChild", "getIdleChildConfigurationReceipt"];
    const absent = methods.filter(name => typeof f.registry[name] !== "function");
    if (absent.length) return { blocked: absent.map(name => `Tintin.${name}`) };
    const args = { subagent_type: "omitted", description: "capability", prompt: "CAPABILITY-WITNESS", isolated: true,
      model: "jev-compat-parent/parent", thinking: "off", run_in_background: false };
    const record = await bounded(nativeCall(f.parent, { id: "capability-spawn", name: "Agent", arguments: args }, f.enqueue), "capability child");
    const child = record.session, snapshot = f.registry.getIdleChildConfigurationSnapshot(record.id);
    check(snapshot.status === "ready", "Missing ready child snapshot");
    const entriesBefore = JSON.stringify(child.sessionManager.getEntries());
    const other = await bounded(nativeCall(f.parent, { id: "replacement-spawn", name: "Agent", arguments: { ...args, prompt: "REPLACEMENT-WITNESS" } }, f.enqueue), "second real SDK child");
    const observe = (session: any) => structuredClone({ snapshot: session.getConfigurationSnapshot(),
      entries: session.sessionManager.getEntries(), messages: session.messages });
    const observeBoth = () => ({ original: observe(child), other: observe(other.session) });
    const parentBefore = JSON.stringify(observe(f.parent));
    const invalidBefore = observeBoth();
    const request = { operationId: "additional-invalid", childId: record.id, expectedSessionId: child.sessionId,
      expectedRevision: snapshot.snapshot.revision, model: { provider: "jev-compat-allowed", id: "allowed" }, thinking: "INVALID" };
    const invalid = await bounded<any>(f.registry.configureIdleChild(request), "second field validation");
    const invalidAfter = observeBoth();
    const secondFieldNonmutation = invalid.status === "rejected" && invalid.reason === "invalid" &&
      JSON.stringify(invalidAfter) === JSON.stringify(invalidBefore) && JSON.stringify(observe(f.parent)) === parentBefore && await f.settingsUnchanged();
    check(secondFieldNonmutation, "Invalid second field partially mutated pair/transcript");
    // SUPPLEMENTAL guard attacks only; these assignments are NOT supported lifecycles.
    const supplementalRows: any = {};
    for (const kind of ["ownership", "replacement"]) {
      const field = kind === "ownership" ? "parentAgentId" : "session";
      const hadField = Object.hasOwn(record, field), prior = record[field];
      const baseline = observeBoth();
      let snapshotResult: any, control: any, afterSnapshotRefusal: any, afterRefusal: any;
      try {
        record[field] = kind === "ownership" ? other.id : other.session;
        snapshotResult = f.registry.getIdleChildConfigurationSnapshot(record.id);
        afterSnapshotRefusal = observeBoth();
        check(JSON.stringify(afterSnapshotRefusal) === JSON.stringify(baseline), `${kind}: snapshot refusal mutated either SDK session`);
        control = await bounded(f.registry.configureIdleChild({ ...request, operationId: `${kind}-refusal`, thinking: "high" }), `${kind} control refusal`);
        afterRefusal = observeBoth();
        check(JSON.stringify(afterRefusal) === JSON.stringify(baseline), `${kind}: configure refusal mutated either SDK session`);
        check(snapshotResult.status === "rejected" && snapshotResult.reason === "unauthorized" &&
          control.status === "rejected" && control.reason === "unauthorized", `${kind}: guard did not refuse`);
      } finally { if (hadField) record[field] = prior; else delete record[field]; }
      const afterRestore = observeBoth(), publicFieldRestored = Object.hasOwn(record, field) === hadField && record[field] === prior;
      const parentUnchanged = JSON.stringify(observe(f.parent)) === parentBefore, settingsUnchanged = await f.settingsUnchanged();
      check(publicFieldRestored && parentUnchanged && settingsUnchanged && JSON.stringify(afterRestore) === JSON.stringify(baseline), `${kind}: fixture restoration or defaults changed`);
      supplementalRows[kind] = { before: baseline, snapshotResult, afterSnapshotRefusal, control, afterRefusal, afterRestore,
        publicFieldRestored, parentUnchanged, settingsUnchanged };
    }
    const supplementalIdentity = { coverageLayer: "supplemental-adversarial-public-record", nativeLifecycleReplacementVerified: false, ...supplementalRows };
    let receiptInsideListener: any;
    const committedRequest = { ...request, operationId: "additional-commit", thinking: "high" };
    const lookup = { childId: record.id, expectedSessionId: child.sessionId, operationId: committedRequest.operationId };
    const off = child.subscribe((event: any) => {
      if (event.type !== "thinking_level_changed") return;
      receiptInsideListener = f.registry.getIdleChildConfigurationReceipt(lookup);
      throw new Error("Task3 intentional post-commit listener error");
    });
    let committed: any;
    try { committed = await bounded(f.registry.configureIdleChild(committedRequest), "diagnostic commit"); } finally { off(); }
    const postCommitListenerError = committed.status === "committed" && committed.notificationErrors.includes("Task3 intentional post-commit listener error") &&
      child.model.id === "allowed" && child.thinkingLevel === "high" && receiptInsideListener?.status === "committed";
    check(postCommitListenerError, "Listener error misreported committed pair");
    // Deliberately discard the acknowledgement: lookup alone recovers exact committed receipt.
    const recovered = f.registry.getIdleChildConfigurationReceipt(lookup);
    const lostAcknowledgementReceiptLookup = recovered.status === "committed" && JSON.stringify(recovered) === JSON.stringify(committed);
    check(lostAcknowledgementReceiptLookup, "Lost acknowledgement cannot be recovered");
    const added = child.sessionManager.getEntries().slice(JSON.parse(entriesBefore).length)
      .filter((entry: any) => ["model_change", "thinking_level_change"].includes(entry.type));
    check(added.length === 2 && await f.settingsUnchanged(), "Additional cases changed defaults or duplicated pair");
    // REQUIRED public lifecycle evidence: dispose the real retained SDK child while auth awaits.
    // This proves disposal only, never replacement or ownership transfer.
    const disposedRecord = await bounded(nativeCall(f.parent, { id: "disposal-spawn", name: "Agent", arguments: { ...args, prompt: "DISPOSAL-WITNESS" } }, f.enqueue), "disposal child");
    const original = disposedRecord.session;
    const ready = f.registry.getIdleChildConfigurationSnapshot(disposedRecord.id);
    check(ready.status === "ready", "Disposal child not ready");
    const observeAll = () => ({ original: observe(original), other: observe(other.session), committed: observe(child) });
    const lifecycleBefore = observeAll(), lifecycleParentBefore = JSON.stringify(observe(f.parent));
    const expected = { ownerSessionId: f.parent.sessionId, childId: disposedRecord.id,
      sessionId: ready.snapshot.sessionId, revision: ready.snapshot.revision };
    const barrier = f.deferAuthentication();
    const pending = f.registry.configureIdleChild({ ...request, operationId: "pending-auth-disposal",
      childId: expected.childId, expectedSessionId: expected.sessionId, expectedRevision: expected.revision, thinking: "high" });
    let result: any, afterLifecycle: any, afterRefusal: any;
    try {
      await bounded(Promise.race([barrier.entered, pending.then((value: any) => { throw new Error(`Control settled before auth barrier: ${JSON.stringify(value)}`); })]), "disposal deferred authentication");
      check(JSON.stringify(observeAll()) === JSON.stringify(lifecycleBefore), "Pending auth changed SDK sessions");
      original.dispose(); // Documented public lifecycle; no record assignments or backend replacement.
      afterLifecycle = observeAll();
      check(afterLifecycle.original.snapshot.revision > expected.revision, "Disposal did not invalidate revision");
      check(JSON.stringify(afterLifecycle.other) === JSON.stringify(lifecycleBefore.other) &&
        JSON.stringify(afterLifecycle.committed) === JSON.stringify(lifecycleBefore.committed), "Disposal changed an unrelated SDK session");
      barrier.release(); result = await bounded(pending, "disposal refusal");
      afterRefusal = observeAll();
    } finally { barrier.release(); await bounded(pending, "pending disposal cleanup"); }
    const allSessionsUnchangedAfterLifecycle = JSON.stringify(afterRefusal) === JSON.stringify(afterLifecycle);
    const allPairsAndTranscriptsPreserved = Object.keys(lifecycleBefore).every(key => {
      const a = (lifecycleBefore as any)[key], b = afterRefusal[key];
      return JSON.stringify({ ...a.snapshot, revision: 0 }) === JSON.stringify({ ...b.snapshot, revision: 0 }) &&
        JSON.stringify(a.entries) === JSON.stringify(b.entries) && JSON.stringify(a.messages) === JSON.stringify(b.messages);
    });
    const parentUnchanged = JSON.stringify(observe(f.parent)) === lifecycleParentBefore, settingsUnchanged = await f.settingsUnchanged();
    check(result.status === "rejected" && result.reason === "disposed" && allSessionsUnchangedAfterLifecycle &&
      allPairsAndTranscriptsPreserved && parentUnchanged && settingsUnchanged, "Public disposal refusal mutated affected sessions/defaults");
    const disposal = { coverageLayer: "native-public-lifecycle", lifecycle: "AgentSession.dispose(): void", authenticationPending: true,
      expected, before: lifecycleBefore, afterLifecycle, result, afterRefusal, allSessionsUnchangedAfterLifecycle,
      allPairsAndTranscriptsPreserved, parentUnchanged, settingsUnchanged };
    return { secondFieldNonmutation, invalid, invalidBefore, invalidAfter, supplementalIdentity,
      postCommitListenerError, committed, lostAcknowledgementReceiptLookup, recovered, configurationEntriesAdded: added.length,
      disposal, coverageLayer: "native-public-contracts; identity field attacks reported separately as supplemental" };
  });
  if ("blocked" in additional) return { gate: "3B", status: "blocked", missing: additional.blocked, setterFallbackUsed: false, fullRouterParityVerified: false };
  // Reuse the unchanged measured foundation in its own startup-isolated process.
  const invocation = isolatedChild("run", [resolve("scripts/child-control-safe.ts"), "--host-root", roots.hostRoot, "--tintin-root", roots.tintinRoot]);
  const process = Bun.spawn(invocation.argv, { env: invocation.env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => process.kill(), 60_000);
  let foundation: any;
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    check(exit === 0 && stderr === "", `Native foundation failed: exit=${exit} ${stderr}`);
    foundation = JSON.parse(stdout);
    check(foundation.executionPath === "tintin-native-Agent-public-control" && foundation.scenarios.length === 15, "Wrong native foundation report");
  } finally { clearTimeout(timer); }
  // User-approved applicability is not native verification of an absent transition.
  const unsupportedLifecycle = { status: "not-applicable", reason: "unsupported-public-lifecycle", exercised: false,
    nativeVerified: false, userDecision: "Scope to supported lifecycle (Recommended)" };
  const requiredPublicLifecycle = { disposal: additional.disposal,
    ownershipChange: { ...unsupportedLifecycle,
      detail: "Registry has no retained-child ownership-transfer API. Foundation switch covers lifecycle epoch invalidation, not owner transfer.",
      sourceEvidence: ["Tintin src/index.ts:699-717,746-757", "Tintin src/agent-manager.ts:377-394,852-856"] },
    actualRetainedChildReplacement: { ...unsupportedLifecycle,
      detail: "AgentSessionRuntime.newSession(options?): Promise<{cancelled:boolean}> and switchSession(sessionPath, options?): Promise<{cancelled:boolean}> replace runtime-owned sessions; Tintin creates bare retained AgentSession instances and registry exposes no runtime/replacement API. Native resume reuses record.session. Eviction removes the record; tombstone revival spawns a new record, not a replacement under the pending child lease.",
      sourceEvidence: ["Pi docs/sdk.md: Session lifecycle; examples/sdk/13-session-runtime.ts",
        "Pi src/core/agent-session-runtime.ts:83-95,196-260", "Tintin src/index.ts:746-757",
        "Tintin src/agent-runner.ts:1008-1026", "Tintin src/agent-manager.ts:377-394,852-856,1161-1173,1515-1530",
        "Tintin src/index.ts:699-717,996-1012"] } };
  // Reached only after all additional checks and the unchanged native foundation pass.
  return { gate: "3B", status: "verified-supported-lifecycle", runtime: "local-patched-only", measuredContractsValid: true,
    supportedLifecycleVerified: true, missing: [], foundation, additional, requiredPublicLifecycle,
    setterFallbackUsed: false, fullRouterParityVerified: false,
    limits: "User-approved supported lifecycle only. Retained-child replacement/ownership transfer are not applicable, not native verified successes. Supplemental field attacks are not native lifecycle proof. Published runtimes remain blocked; no production controller or full parity." };
}

if (import.meta.main) {
  try { const report = await runChildControlCapabilityProbe(rootsFromArgs());
    await new Promise<void>((resolve, reject) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, error => error ? reject(error) : resolve()));
    if (report.status !== "verified-supported-lifecycle" || report.supportedLifecycleVerified !== true) process.exitCode = 2; }
  catch (error) { console.error(JSON.stringify({ gate: "3B", status: "failed", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
