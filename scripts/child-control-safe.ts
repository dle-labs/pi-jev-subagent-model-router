// Positive contract probe for separately patched sources, never the installed runtime.
// Run in a dedicated process: environment and resources are isolated before SDK imports.
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateIsolation } from "../test/support/agent-dir-preload";
import { declaredPublicEntry, dependencyPackageRoot } from "./probe/public-package";
import { acquireWithin } from "./probe/setup-deadline";
import { createNativeParent, managerKey, nativeCall, prepareNativeFiles, shutdownNative, type NativeToolCall } from "./probe/tintin-native";

const phases = ["idle", "persisted", "scope-glob", "active", "settled", "background-active", "queued",
  "compaction-active", "busy", "cancelled", "denied", "scope-changed", "scope-malformed", "switch", "stale"] as const;
type Phase = typeof phases[number];
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8_000);
    })]);
  } finally { clearTimeout(timer); }
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const pairEntry = (entry: any) => entry.type === "model_change" || entry.type === "thinking_level_change";

async function main() {
  const args = process.argv.slice(2);
  check(args.length === 4 && args[0] === "--host-root" && args[2] === "--tintin-root",
    "Usage: bun scripts/child-control-safe.ts --host-root PATCHED_PI_PACKAGE --tintin-root PATCHED_TINTIN_SOURCE");
  const hostRoot = resolve(args[1]), tintinRoot = resolve(args[3]);
  const hostPackage = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
  const tintinPackage = JSON.parse(await readFile(join(tintinRoot, "package.json"), "utf8"));
  check(hostPackage.name === "@earendil-works/pi-coding-agent" && hostPackage.version === "1.0.0", "Unexpected Pi baseline");
  check(tintinPackage.name === "@tintinweb/pi-subagents" && tintinPackage.version === "0.19.0", "Unexpected Tintin baseline");
  const sdkEntry = await declaredPublicEntry(hostRoot);
  const aiEntry = await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-ai", hostRoot));
  const tintinEntry = join(tintinRoot, "src", "index.ts");
  const tintinSdkEntry = await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-coding-agent", tintinRoot));
  const selectedDependency = await realpath(tintinSdkEntry) === await realpath(sdkEntry);
  const originalCwd = process.cwd();
  validateIsolation();
  const root = await mkdtemp(join(tmpdir(), "jev-safe-control-"));
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR!, cwd = join(root, "project");
    await mkdir(cwd);
    // Never change HOME midprocess: cached home must match before SDK imports.
    validateIsolation();
    process.chdir(cwd);
    let networkFetchAttempts = 0;
    const denyFetch = () => { networkFetchAttempts++; throw new Error("Network prohibited in safe-control probe"); };
    globalThis.fetch = Object.assign(denyFetch, { preconnect: denyFetch });
    const sdk = await bounded(import(pathToFileURL(sdkEntry).href), "SDK import");
    const ai = await bounded(import(pathToFileURL(aiEntry).href), "AI import");
    check(typeof sdk.AgentSession?.prototype.configureIfIdle === "function" && typeof sdk.resolveModelScopeFromModels === "function",
      "Unsupported Pi: patched public atomic configuration and scope APIs required");
    const scenarios = [];
    for (const phase of phases) {
      try { scenarios.push(await scenario(phase, sdk, ai, cwd, agentDir, tintinEntry, root, selectedDependency)); }
      catch (error) { throw new Error(`${phase}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    check(networkFetchAttempts === 0, "Unexpected network attempts");
    check((globalThis as any)[managerKey] === undefined, "Tintin registry leaked");
    console.log(JSON.stringify({
      executionPath: "tintin-native-Agent-public-control", verifiedContract: "local-patched-idle-configuration",
      fullRouterParityVerified: false, networkFetchAttempts, registryReleased: true,
      host: { version: hostPackage.version, entrySha256: hash(await readFile(sdkEntry)),
        atomicOperationSha256: hash(sdk.AgentSession.prototype.configureIfIdle.toString()) },
      tintin: { version: tintinPackage.version, entrySha256: hash(await readFile(tintinEntry)) },
      scenarios,
      limits: "Local source patches only. Scope/ownership adversarial unit cases supplement native tests; not a full router parity claim.",
    }, null, 2));
  } finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
}

async function scenario(phase: Phase, sdk: Record<string, any>, ai: Record<string, any>, cwd: string, agentDir: string, tintinEntry: string, root: string, selectedDependency: boolean) {
  await prepareNativeFiles(cwd, agentDir);
  await rm(join(cwd, ".pi", "settings.json"), { force: true });
  const configPath = join(cwd, ".pi", "subagents.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, JSON.stringify({ ...config, maxConcurrent: 1 }));
  const settingsPath = join(agentDir, "settings.json");
  const fileSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  await writeFile(settingsPath, JSON.stringify({ ...fileSettings,
    compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 256 } }));
  if (phase === "persisted") {
    const agentPath = join(cwd, ".pi", "agents", "probe.md");
    await writeFile(agentPath, (await readFile(agentPath, "utf8")).replace("persist_session: false", "persist_session: true"));
  }
  if (phase === "scope-glob") await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["jev-safe-*/*:high"] }));
  const authEntered = deferred(), authRelease = deferred(), streamStarted = deferred(), streamRelease = deferred();
  let armed = false, consumed = false, nextCall: NativeToolCall | undefined;
  let childStreamCount = 0;
  let lastChildReasoning: string | undefined;
  const enqueue = (call: NativeToolCall) => { check(!nextCall, "Native call not consumed"); nextCall = call; };
  const models = ["before", "after", "parent"].map(id => ({
    id, name: `Safe fixture ${id}`, provider: `jev-safe-${id}`, api: "jev-safe", baseUrl: "https://invalid.invalid",
    reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  const runtime = await acquireWithin<any>(signal => sdk.ModelRuntime.create({
    authPath: join(agentDir, `${phase}-auth.json`), modelsPath: null, modelsStorePath: join(agentDir, `${phase}-models.json`),
    allowModelNetwork: false, refreshOnCreate: false, signal,
  }), "safe model runtime", async () => { await rm(root, { recursive: true, force: true }); });
  for (const model of models) {
    const stream = (_model: unknown, _context: unknown, options?: { signal?: AbortSignal; reasoning?: string }) => {
      const events = ai.createAssistantMessageEventStream();
      const gate = armed && model.id !== "parent";
      const call = model.id === "parent" ? nextCall : undefined;
      if (call) nextCall = undefined;
      if (model.id !== "parent") { childStreamCount++; lastChildReasoning = options?.reasoning; }
      const message: any = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "" }], timestamp: Date.now(), stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      void (async () => {
        const abort = () => streamRelease.release();
        options?.signal?.addEventListener("abort", abort, { once: true });
        try {
          events.push({ type: "start", partial: message });
          if (gate) streamStarted.release();
          if (gate && !options?.signal?.aborted) await streamRelease.promise;
          if (options?.signal?.aborted) {
            Object.assign(message, { stopReason: "aborted", errorMessage: "Fixture aborted" });
            events.push({ type: "error", reason: "aborted", error: message });
          } else if (call) {
            message.content = [{ type: "toolCall", id: call.id, name: call.name, arguments: {} }];
            events.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            message.content[0].arguments = call.arguments;
            events.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(call.arguments), partial: message });
            events.push({ type: "toolcall_end", contentIndex: 0, toolCall: message.content[0], partial: message });
            message.stopReason = "toolUse";
            events.push({ type: "done", reason: "toolUse", message });
          } else {
            events.push({ type: "text_start", contentIndex: 0, partial: message });
            message.content[0].text = "Deterministic safe-control response.";
            events.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
            events.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
            message.stopReason = "stop";
            events.push({ type: "done", reason: "stop", message });
          }
        } finally { options?.signal?.removeEventListener("abort", abort); events.end(); }
      })();
      return events;
    };
    runtime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model], stream, streamSimple: stream,
      auth: { apiKey: { name: "Fake local key", check: async () => ({ type: "api_key", source: "safe-fixture" }),
        // configureIfIdle uses getAuth, unlike the legacy setter's checkAuth.
        resolve: async () => {
          if (model.id === "after" && armed && !consumed) {
            consumed = true; authEntered.release(); await authRelease.promise;
            if (phase === "denied") return undefined;
          }
          return { auth: { apiKey: "not-a-real-key" } };
        },
      } },
    });
  }
  await bounded(runtime.refresh({ allowNetwork: false }), "provider setup");
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { enabled: false } }, { projectTrusted: true });
  const globalBefore = JSON.stringify(settings.getGlobalSettings()), settingsFileBefore = await readFile(settingsPath, "utf8");
  let parent: any, child: any, blocker: any, control: Promise<any> | undefined, execution: Promise<any> | undefined;
  const nativeArgs = { subagent_type: "probe", description: "Safe public control fixture", prompt: "Complete a local task",
    model: "jev-safe-before/before", thinking: "off", run_in_background: false, isolated: true };
  try {
    parent = await createNativeParent(sdk, cwd, agentDir, tintinEntry, runtime, models[2], settings, async result => {
      try { await bounded(shutdownNative(result.session), "late native shutdown"); } finally { result.session.dispose(); }
    });
    const registry = (globalThis as any)[managerKey];
    for (const method of ["configureIdleChild", "getIdleChildConfigurationSnapshot", "getIdleChildConfigurationReceipt"]) {
      check(typeof registry[method] === "function", `Unsupported Tintin public registry: missing ${method}`);
    }
    const record = await bounded(nativeCall(parent, { id: `${phase}-spawn`, name: "Agent", arguments: nativeArgs }, enqueue), "native spawn");
    child = record.session;
    // The native extension loader can evaluate the same module twice. Class reference
    // identity is not provenance: verify the actual dependency path and public method sources.
    const childUsesSelectedHost = selectedDependency &&
      ["getConfigurationSnapshot", "configureIfIdle", "getConfigurationReceipt"].every(name =>
        typeof child[name] === "function" && child[name].toString() === sdk.AgentSession.prototype[name].toString());
    check(childUsesSelectedHost, "Native child dependency/public API differs from the explicitly selected host SDK");
    const resume = async (suffix: string, background = false) => {
      const resumed = await nativeCall(parent, { id: `${phase}-${suffix}`, name: "Agent", arguments: {
        ...nativeArgs, resume: record.id, prompt: "Continue the retained child", run_in_background: background,
      } }, enqueue);
      check(resumed.session === child, "Native resume replaced the retained session");
    };
    if (phase === "compaction-active") await bounded(resume("warmup"), "compaction warmup");
    const expectedResult = registry.getIdleChildConfigurationSnapshot(record.id);
    check(expectedResult.status === "ready", `No ready configuration snapshot: ${JSON.stringify({ result: expectedResult,
      childCapabilities: ["getConfigurationSnapshot", "configureIfIdle", "getConfigurationReceipt"].map(name => [name, typeof child[name]]),
      childUsesHostConstructor: child.constructor === sdk.AgentSession })}`);
    const snapshot = expectedResult.snapshot;
    check(snapshot?.sessionId === child.sessionId && snapshot.model?.id === "before" && snapshot.thinkingLevel === "off", "Unexpected child snapshot");
    const entriesBefore = structuredClone(child.sessionManager.getEntries());
    const parentBefore = { model: parent.model.id, thinking: parent.thinkingLevel, messages: JSON.stringify(parent.messages) };
    const parentCount = parent.messages.length;
    const abort = new AbortController();
    const request = { operationId: `${phase}-operation`, childId: record.id, expectedSessionId: snapshot.sessionId,
      expectedRevision: snapshot.revision + (phase === "stale" ? 1 : 0), model: { provider: models[1].provider, id: "after" }, thinking: "high", signal: abort.signal };
    armed = true;
    if (phase === "busy") {
      execution = resume("resume"); void execution.catch(() => {});
      await bounded(streamStarted.promise, "busy native start");
    }
    const pendingControl: Promise<any> = registry.configureIdleChild(request);
    control = pendingControl;
    void pendingControl.catch(() => {});
    let queuedWithoutStarting = false, compactionStreamObserved = false;
    if (phase !== "busy" && phase !== "stale") {
      await bounded(Promise.race([authEntered.promise, pendingControl.then(result => {
        throw new Error(`Control settled before expected auth barrier: ${JSON.stringify(result)}`);
      })]), "public configuration deferred auth");
      if (["active", "settled", "background-active"].includes(phase)) {
        execution = resume("resume", phase === "background-active"); void execution.catch(() => {});
        await bounded(streamStarted.promise, "native resumed stream");
        check(!child.isIdle && child.model.id === "before", "Resume must run original model");
        if (phase === "settled") { streamRelease.release(); await bounded(execution, "settled native resume"); check(child.isIdle, "Resume did not settle"); }
      } else if (phase === "queued") {
        blocker = await bounded(nativeCall(parent, { id: `${phase}-blocker`, name: "Agent", arguments: {
          ...nativeArgs, run_in_background: true, prompt: "Hold the only background slot",
        } }, enqueue, { allowPendingBackground: true }), "background blocker");
        await bounded(streamStarted.promise, "blocker stream");
        check(blocker.session && registry.getRecord(blocker.id) === blocker, "Blocker startup did not retain the correlated SDK session");
        const streamsBefore = childStreamCount;
        await bounded(resume("queued-resume", true), "queued native resume");
        check(record.status === "queued" && child.isIdle && childStreamCount === streamsBefore, "Retained child was not queued without starting");
        queuedWithoutStarting = true;
      } else if (phase === "compaction-active") {
        const compaction: Promise<any> = child.compact();
        execution = compaction; void compaction.catch(() => {});
        await bounded(Promise.race([streamStarted.promise, compaction.then(() => { throw new Error("Compaction completed without a gated provider stream"); })]), "compaction stream");
        check(child.isCompacting && !child.isIdle, "Actual compaction is not active");
        compactionStreamObserved = true;
      } else if (phase === "cancelled") abort.abort();
      else if (phase === "scope-changed") await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["jev-safe-before/before"] }));
      else if (phase === "scope-malformed") await writeFile(join(cwd, ".pi", "settings.json"), "{corrupt");
      else if (phase === "switch") await parent.extensionRunner.emit({ type: "session_before_switch", reason: "new" });
      authRelease.release();
    }
    const result = await bounded(pendingControl, "public configuration result");
    const commits = ["idle", "persisted", "scope-glob"].includes(phase);
    check(result.status === (commits ? "committed" : "rejected"), `Unexpected configuration result: ${JSON.stringify(result)}`);
    check(child.model.id === (commits ? "after" : "before") && child.thinkingLevel === (commits ? "high" : "off"), "Pair is incorrect after control");
    const added = child.sessionManager.getEntries().slice(entriesBefore.length).filter(pairEntry);
    check(added.length === (commits ? 2 : 0), "Unexpected configuration transcript entries");
    let replayVerified = false, conflictRejected = false, nativeResumeAfterCommit = false, diskPairVerified = false;
    if (commits) {
      check(added[0].type === "model_change" && added[0].modelId === "after" && added[1].type === "thinking_level_change" && added[1].thinkingLevel === "high", "Transcript pair wrong");
      const receipt = registry.getIdleChildConfigurationReceipt({ childId: record.id, expectedSessionId: snapshot.sessionId, operationId: request.operationId });
      check(JSON.stringify(receipt) === JSON.stringify(result), "Committed receipt lookup mismatch");
      const replay = await bounded(registry.configureIdleChild(request), "receipt replay");
      check(JSON.stringify(replay) === JSON.stringify(result), "Duplicate operation did not replay");
      replayVerified = true;
      const conflict = await bounded<any>(registry.configureIdleChild({ ...request, thinking: "low" }), "conflicting ID");
      check(conflict.status === "rejected" && conflict.reason === "operation-conflict", "Conflicting operation ID accepted");
      conflictRejected = true;
      check(child.sessionManager.getEntries().slice(entriesBefore.length).filter(pairEntry).length === 2,
        "Receipt replay or conflicting reuse appended another configuration pair");
      check(JSON.stringify(child.getConfigurationSnapshot()) === JSON.stringify(result.after),
        "Receipt replay or conflicting reuse changed the committed revision");
      if (phase === "persisted") {
        const persisted = (await readFile(child.sessionManager.getSessionFile(), "utf8")).trim().split("\n").map(line => JSON.parse(line));
        check(JSON.stringify(persisted.slice(-2)) === JSON.stringify(added), "Persisted pair differs from receipt transcript");
        diskPairVerified = true;
      }
    }
    armed = false; streamRelease.release(); authRelease.release();
    if (execution) await bounded(execution, "native execution settlement");
    await bounded(registry.waitForAll(), "background settlement");
    if (commits) {
      const start = child.messages.length;
      await bounded(resume("post-commit"), "native resume after commit");
      const answer = child.messages.slice(start).find((m: any) => m.role === "assistant");
      check(answer?.model === "after" && answer.provider === models[1].provider && child.thinkingLevel === "high" && lastChildReasoning === "high", "Native resume ignored committed pair");
      nativeResumeAfterCommit = true;
    }
    const transcriptPreserved = JSON.stringify(child.sessionManager.getEntries().slice(0, entriesBefore.length)) === JSON.stringify(entriesBefore);
    const parentUnchanged = parent.model.id === parentBefore.model && parent.thinkingLevel === parentBefore.thinking &&
      JSON.stringify(parent.messages.slice(0, parentCount)) === parentBefore.messages;
    const globalSettingsUnchanged = JSON.stringify(settings.getGlobalSettings()) === globalBefore && await readFile(settingsPath, "utf8") === settingsFileBefore;
    check(parentUnchanged && globalSettingsUnchanged && transcriptPreserved, "Parent/settings/history changed unexpectedly");
    return { phase, result, childUsesSelectedHost, parentUnchanged, globalSettingsUnchanged, transcriptPreserved, configurationEntriesAdded: added.length,
      finalModel: child.model.id, finalThinking: child.thinkingLevel, replayVerified, conflictRejected, nativeResumeAfterCommit,
      diskPairVerified, queuedWithoutStarting, compactionStreamObserved, disposed: true };
  } finally {
    armed = false; authRelease.release(); streamRelease.release();
    const outcomes = await Promise.allSettled([
      ...(control ? [bounded(control, "control cleanup")] : []),
      ...(execution ? [bounded(execution, "execution cleanup")] : []),
      ...[child, blocker?.session].filter(Boolean).map(session => bounded(session.abort(), "child abort")),
    ]);
    if (parent) {
      try {
        await bounded(parent.abort(), "parent abort");
        const registry = (globalThis as any)[managerKey];
        if (registry) await bounded(registry.waitForAll(), "late native activity cleanup");
        await bounded(shutdownNative(parent), "native shutdown");
      } finally { parent.dispose(); }
    }
    child?.dispose();
    check(outcomes.every(outcome => outcome.status === "fulfilled"), "Incomplete native cleanup");
  }
}

await main().catch(error => {
  console.error(JSON.stringify({ outcome: "safe-probe-failed", message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
