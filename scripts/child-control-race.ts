// Diagnostic negative control against the public SDK. This is NOT a safe controller.
// Run in a dedicated process: the probe deliberately clears env and denies fetch.
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateIsolation } from "../test/support/agent-dir-preload";
import { assessRace, type RaceEvent } from "./probe/race-evidence";
import { acquireWithin } from "./probe/setup-deadline";
import { createNativeParent, managerKey, nativeCall, prepareNativeFiles, shutdownNative, type NativeToolCall } from "./probe/tintin-native";

type Scenario = "active" | "settled" | "idle" | "denied";
const phases = ["active", "settled", "idle", "denied"] as const;
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Probe timed out at ${label}`)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

async function main() {
  const args = process.argv.slice(2);
  if (![2, 4].includes(args.length) || args[0] !== "--host-root" || (args.length === 4 && args[2] !== "--tintin-root")) {
    throw new Error("Usage: bun scripts/child-control-race.ts --host-root /path/to/pi-coding-agent [--tintin-root /path/to/pi-subagents]");
  }
  const tintinRoot = args.length === 4 ? resolve(args[3]) : undefined;
  const tintinPkg = tintinRoot ? JSON.parse(await readFile(join(tintinRoot, "package.json"), "utf8")) : undefined;
  if (tintinPkg && (tintinPkg.name !== "@tintinweb/pi-subagents" || tintinPkg.version !== "0.19.0")) throw new Error("Unsupported Tintin package");
  const tintinEntry = tintinRoot ? join(tintinRoot, "src", "index.ts") : undefined;
  const hostRoot = resolve(args[1]);
  const pkg = JSON.parse(await readFile(join(hostRoot, "package.json"), "utf8"));
  if (pkg.name !== "@earendil-works/pi-coding-agent" || pkg.version !== "1.0.0") {
    throw new Error("This reproduction targets @earendil-works/pi-coding-agent 1.0.0; unsupported host");
  }
  // Use import conditions: the installed SDK intentionally has no require export.
  const base = pathToFileURL(join(hostRoot, "package.json")).href;
  const sdkEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent", base));
  const aiEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai", base));
  const originalCwd = process.cwd();
  validateIsolation();
  const root = await mkdtemp(join(tmpdir(), "jev-race-"));
  try {
  const agentDir = process.env.PI_CODING_AGENT_DIR!, cwd = join(root, "workspace");
  await mkdir(cwd);
  // HOME remains the launcher's startup HOME; Bun caches homedir before imports.
  validateIsolation();
  process.chdir(cwd);
  if (tintinEntry) await prepareNativeFiles(cwd, agentDir);
  let fetchAttempts = 0;
  const prohibitNetwork = () => {
    fetchAttempts++;
    throw new Error("Network fetch prohibited in the race probe");
  };
  globalThis.fetch = Object.assign(prohibitNetwork, { preconnect: prohibitNetwork });
    // Dynamic imports occur only after credentials/resource isolation is established.
    const sdk = await bounded(import(pathToFileURL(sdkEntry).href), "SDK import");
    const ai = await bounded(import(pathToFileURL(aiEntry).href), "provider API import");
    for (const name of ["createAgentSession", "createExtensionRuntime", "ModelRuntime", "SettingsManager", "SessionManager"]) {
      if (!(name in sdk)) throw new Error(`Required public SDK export unavailable: ${name}`);
    }
    const scenarios = [];
    for (const phase of phases) scenarios.push(await runScenario(phase, sdk, ai, cwd, agentDir, root, tintinEntry));
    if (fetchAttempts) throw new Error(`Probe attempted ${fetchAttempts} network fetches`);
    console.log(JSON.stringify({
      executionPath: tintinEntry ? "tintin-native-Agent" : "public-pi-sdk",
      nativeTintinVerified: Boolean(tintinEntry),
      tintin: tintinEntry ? { name: tintinPkg.name, version: tintinPkg.version, entrySha256: hash(await readFile(tintinEntry)) } : undefined,
      registryReleased: (globalThis as any)[managerKey] === undefined,
      safeControlCapabilityVerified: false,
      host: {
        name: pkg.name, version: pkg.version, entrySha256: hash(await readFile(sdkEntry)),
        modelSetterSha256: hash(sdk.AgentSession.prototype.setModel.toString()),
      },
      networkFetchAttempts: fetchAttempts,
      scenarios,
      limitation: tintinEntry ? "Native foreground Agent spawn/resume only; not a safe-operation implementation or full compatibility gate." :
        "Actual Pi AgentSession.prompt continuation, not a Tintin Agent-tool resume or a safe-operation implementation.",
    }, null, 2));
  } finally { process.chdir(originalCwd); await rm(root, { recursive: true, force: true }); }
}

// Runtime imports are deliberately late-bound to the explicitly selected host.
// The probe's observations use public SDK members only, without method replacement.
async function runScenario(phase: Scenario, sdk: Record<string, any>, ai: Record<string, any>, cwd: string, agentDir: string, root: string, tintinEntry?: string) {
  const trace: RaceEvent[] = [];
  const authEntered = deferred(), authRelease = deferred(), streamStarted = deferred(), streamRelease = deferred();
  let armed = false, consumed = false;
  let nextNativeCall: NativeToolCall | undefined;
  let nativeRecord: any;
  const nativeStats = { spawnCalls: 0, resumeCalls: 0, sameRetainedSession: false };
  const enqueue = (call: NativeToolCall) => { if (nextNativeCall) throw new Error("Pending native call was not consumed"); nextNativeCall = call; };
  const models = ["before", "after", "parent"].map(id => ({
    id, name: `Probe ${id}`, provider: `jev-probe-${id}`, api: "jev-probe",
    baseUrl: "https://invalid.invalid", reasoning: false, input: ["text"],
    contextWindow: 32768, maxTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  const runtime = await acquireWithin<any>(signal => sdk.ModelRuntime.create({
    authPath: join(agentDir, `${phase}-auth.json`), modelsPath: null,
    modelsStorePath: join(agentDir, `${phase}-models.json`),
    allowModelNetwork: false, refreshOnCreate: false, signal,
  }), "model runtime setup", async () => { await rm(root, { recursive: true, force: true }); });
  for (const model of models) {
    const stream = (_model: typeof model, _context: unknown, options?: { signal?: AbortSignal }) => {
      const events = ai.createAssistantMessageEventStream();
      const gateThisStream = armed && model.id !== "parent";
      const toolCall = model.id === "parent" ? nextNativeCall : undefined;
      if (toolCall) nextNativeCall = undefined;
      const message: any = {
        role: "assistant", api: model.api, provider: model.provider, model: model.id,
        content: [{ type: "text", text: "" }], timestamp: Date.now(), stopReason: "pending",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      void (async () => {
        const abort = () => streamRelease.release();
        options?.signal?.addEventListener("abort", abort, { once: true });
        try {
          events.push({ type: "start", partial: message });
          if (gateThisStream) streamStarted.release();
          if (gateThisStream && !options?.signal?.aborted) await streamRelease.promise;
          if (options?.signal?.aborted) {
            Object.assign(message, { stopReason: "aborted", errorMessage: "Probe aborted" });
            events.push({ type: "error", reason: "aborted", error: message });
          } else if (toolCall) {
            message.content = [{ type: "toolCall", id: toolCall.id, name: toolCall.name, arguments: {} }];
            events.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            message.content[0].arguments = toolCall.arguments;
            events.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
            events.push({ type: "toolcall_end", contentIndex: 0, toolCall: message.content[0], partial: message });
            message.stopReason = "toolUse";
            events.push({ type: "done", reason: "toolUse", message });
          } else {
            events.push({ type: "text_start", contentIndex: 0, partial: message });
            message.content[0].text = "Deterministic local response";
            events.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
            events.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message });
            message.stopReason = "stop";
            events.push({ type: "done", reason: "stop", message });
          }
        } finally {
          options?.signal?.removeEventListener("abort", abort);
          events.end();
        }
      })();
      return events;
    };
    runtime.registerNativeProvider({
      id: model.provider, name: model.name, getModels: () => [model], stream, streamSimple: stream,
      auth: { apiKey: {
        name: "Fake local credential",
        check: async () => {
          if (model.id === "after" && armed && !consumed) {
            consumed = true;
            trace.push({ kind: "auth-blocked" });
            authEntered.release();
            await authRelease.promise;
            if (phase === "denied") return undefined;
          }
          return { type: "api_key", source: "deterministic-probe" };
        },
        resolve: async () => ({ auth: { type: "api_key", key: "not-a-real-key" } }),
      } },
    });
  }
  await bounded(runtime.refresh({ allowNetwork: false }), "provider initialization");
  const settings = sdk.SettingsManager.inMemory({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { enabled: false },
  }, { projectTrusted: true });
  const globalBefore = JSON.stringify(settings.getGlobalSettings());
  const loader = () => ({
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Local race probe. No tools.", getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources: () => {}, reload: async () => {},
  });
  const create = () => sdk.createAgentSession({
    cwd, agentDir, modelRuntime: runtime, model: models[0], thinkingLevel: "off",
    settingsManager: settings, sessionManager: sdk.SessionManager.inMemory(cwd),
    resourceLoader: loader(), tools: [],
  });
  let parent: any, child: any, execution: Promise<void> | undefined;
  let mutation: Promise<{ ok: boolean; error?: string }> | undefined;
  let unsubscribeNative: (() => void) | undefined;
  const nativeArgs = { subagent_type: "probe", description: "Native child race fixture", prompt: "Complete the initial local child task",
    model: "jev-probe-before/before", run_in_background: false, isolated: true };
  const nativeResume = async () => {
    const record = await nativeCall(parent, { id: `probe-${phase}-resume`, name: "Agent", arguments: {
      ...nativeArgs, prompt: "Continue the local test session", resume: nativeRecord.id,
    } }, enqueue);
    if (record.session !== child) throw new Error("Native resume replaced the retained SDK session");
    nativeStats.sameRetainedSession = true;
  };
  try {
    const acquireSession = (label: string) => acquireWithin<any>(() => create(), label, async result => {
      try { await bounded(result.session.abort(), "late session cleanup"); }
      finally { result.session.dispose(); await rm(root, { recursive: true, force: true }); }
    });
    if (tintinEntry) {
      parent = await createNativeParent(sdk, cwd, agentDir, tintinEntry, runtime, models[2], settings, async result => {
        try { await bounded(shutdownNative(result.session), "late native shutdown"); }
        finally { result.session.dispose(); }
      });
      unsubscribeNative = parent.subscribe((event: any) => {
        if (event.type === "tool_execution_start" && event.toolName === "Agent") {
          if (event.args?.resume) nativeStats.resumeCalls++; else nativeStats.spawnCalls++;
        }
      });
      nativeRecord = await bounded(nativeCall(parent, { id: `probe-${phase}-spawn`, name: "Agent", arguments: nativeArgs }, enqueue), "native child spawn");
      child = nativeRecord.session;
      nativeStats.sameRetainedSession = true;
    } else {
      parent = (await acquireSession("parent session setup")).session;
      child = (await acquireSession("child session setup")).session;
      await bounded(child.prompt("Complete the initial local child task"), "initial child completion");
    }
    const parentBefore = { model: parent.model.id, thinking: parent.thinkingLevel, messages: JSON.stringify(parent.messages),
      messageCount: parent.messages.length };
    const initialMessages = structuredClone(child.messages);
    const initialEntries = structuredClone(child.sessionManager.getBranch());
    if (!child.isIdle || child.model.id !== "before") throw new Error("Child did not begin idle on the expected model");
    trace.push({ kind: "idle-snapshot", model: child.model.id, idle: child.isIdle });
    armed = true;
    // Real SDK setter. The only delayed behavior is the fake provider's public auth callback.
    const pendingMutation: Promise<{ ok: boolean; error?: string }> = child.setModel(models[1], { persist: false }).then(
      () => ({ ok: true }), (error: Error) => ({ ok: false, error: error.message }),
    );
    mutation = pendingMutation;
    await bounded(authEntered.promise, "authentication barrier");
    if (phase !== "idle") {
      const pendingExecution: Promise<void> = tintinEntry ? nativeResume() : child.prompt("Continue the local test session");
      execution = pendingExecution;
      // Attach a rejection handler immediately; still await the original promise below.
      void pendingExecution.catch(() => {});
      await bounded(streamStarted.promise, "real provider stream start");
      trace.push({ kind: "execution-start", model: child.model.id, idle: child.isIdle });
      if (child.isIdle || child.model.id !== "before") throw new Error("Execution did not begin on the original model");
      if (phase === "settled") {
        streamRelease.release();
        await bounded(pendingExecution, "intervening execution settlement");
        trace.push({ kind: "execution-end", model: child.model.id, idle: child.isIdle });
      }
    }
    trace.push({ kind: "auth-released" });
    authRelease.release();
    const outcome = await bounded(pendingMutation, "model setter completion");
    if (outcome.ok) {
      trace.push({ kind: "mutation-observed", model: child.model.id, idle: child.isIdle });
      if (child.model.id !== "after") throw new Error("Setter succeeded without the expected observable model");
    } else {
      if (phase !== "denied" || child.model.id !== "before") throw new Error("Unexpected setter failure or partial mutation");
      trace.push({ kind: "mutation-refused" });
    }
    streamRelease.release();
    if (execution && phase !== "settled") {
      await bounded(execution, "execution settlement");
      trace.push({ kind: "execution-end", model: child.model.id, idle: child.isIdle });
    }
    const parentUnchanged = parent.model.id === parentBefore.model && parent.thinkingLevel === parentBefore.thinking;
    const globalSettingsUnchanged = JSON.stringify(settings.getGlobalSettings()) === globalBefore;
    const parentTranscriptUnchanged = JSON.stringify(parent.messages) === parentBefore.messages;
    const parentTranscriptPreserved = JSON.stringify(parent.messages.slice(0, parentBefore.messageCount)) === parentBefore.messages;
    const childTranscriptPreserved = JSON.stringify(child.messages.slice(0, initialMessages.length)) === JSON.stringify(initialMessages) &&
      JSON.stringify(child.sessionManager.getBranch().slice(0, initialEntries.length)) === JSON.stringify(initialEntries);
    const addedMessages = child.messages.slice(initialMessages.length).filter((m: { role: string }) => m.role !== "system");
    const continuationVerified = phase === "idle" ? addedMessages.length === 0 :
      addedMessages.length === 2 && addedMessages[0].role === "user" &&
      addedMessages[0].content[0]?.text === "Continue the local test session" &&
      addedMessages[1].role === "assistant" && addedMessages[1].stopReason === "stop";
    if (!parentUnchanged || !globalSettingsUnchanged || !parentTranscriptPreserved || (!tintinEntry && !parentTranscriptUnchanged) || !childTranscriptPreserved || !continuationVerified) {
      throw new Error("Probe changed parent/settings or violated child transcript expectations");
    }
    return { phase, assessment: assessRace(trace), trace, parentUnchanged, globalSettingsUnchanged,
      parentTranscriptUnchanged, parentTranscriptPreserved, childTranscriptPreserved, continuationVerified,
      native: tintinEntry ? nativeStats : undefined, disposed: true };
  } finally {
    armed = false;
    authRelease.release(); streamRelease.release();
    unsubscribeNative?.();
    const cleanup = await Promise.allSettled([
      ...(mutation ? [bounded(mutation, "mutation cleanup")] : []),
      ...[child, parent].filter(Boolean).map(async session => {
        try {
          await bounded(session.abort(), "session cleanup");
          if (tintinEntry && session === parent) await bounded(shutdownNative(parent), "native extension shutdown");
        } finally { session.dispose(); }
      }),
    ]);
    if (cleanup.some(result => result.status === "rejected")) throw new Error("Probe cleanup did not complete");
  }
}

await main().catch(error => {
  console.error(JSON.stringify({ outcome: "probe-failed", message: error instanceof Error ? error.message : String(error) }));
  // main's finally has removed temporary state. Terminate any stalled dependency
  // setup that ignored cancellation and never returned a disposable resource.
  process.exit(1);
});
