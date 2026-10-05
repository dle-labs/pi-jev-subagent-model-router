import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateIsolation } from "../test/support/agent-dir-preload";
import { declaredPublicEntry, dependencyPackageRoot } from "./probe/public-package";
import { acquireWithin } from "./probe/setup-deadline";
import { withNativeCleanup } from "./probe/native-cleanup";
import { createNativeParent, managerKey, nativeCall, prepareNativeFiles, shutdownNative, type NativeToolCall } from "./probe/tintin-native";

export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 8_000);
  })]); } finally { clearTimeout(timer); }
}
export function rootsFromArgs() {
  const args = process.argv.slice(2);
  check(args.length === 4 && args[0] === "--host-root" && args[2] === "--tintin-root", "Explicit --host-root and --tintin-root required");
  return { hostRoot: resolve(args[1]), tintinRoot: resolve(args[3]) };
}

// Fixture infrastructure only: imports exactly the selected SDK's public export.
export interface NativeFixtureOptions {
  /** Additive public loader/provider seams; standalone 3A/3B defaults unchanged. */
  extensionPaths?: string[];
  extensionFactories?: any[];
  afterPrepare?: (paths: {cwd:string;agentDir:string}) => void | Promise<void>;
  classifier?: (body:unknown) => Response | Promise<Response>;
  childCost?: number;
  /** Authored fake catalogue rates only, never real-provider invoice evidence.
   * Omitted preserves every existing zero-priced 3A/3B fixture. */
  modelCosts?:Readonly<Record<string,{input:number;output:number;cacheRead:number;cacheWrite:number}>>;
  /** Authored child provider may issue a real public Agent call (nested fixture). */
  childToolCall?: (prompt:string, context:any) => NativeToolCall | undefined;
}
export async function withNativeFixture<T extends object>(roots: { hostRoot: string; tintinRoot: string }, body: (fixture: any) => Promise<T>, options:NativeFixtureOptions={}): Promise<T & { shutdownListenerCount: number; networkFetchAttempts: number }> {
  validateIsolation();
  const sdkEntry = await declaredPublicEntry(roots.hostRoot);
  const selected = await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-coding-agent", roots.tintinRoot));
  check(await realpath(selected) === await realpath(sdkEntry), "Tintin dependency does not resolve selected public SDK");
  const aiEntry = await declaredPublicEntry(await dependencyPackageRoot("@earendil-works/pi-ai", roots.hostRoot));
  const pkg = JSON.parse(await readFile(join(roots.tintinRoot, "package.json"), "utf8"));
  const tintinEntry = roots.tintinRoot.endsWith("pi-subagents") ? join(roots.tintinRoot, pkg.main ?? "dist/index.js") : join(roots.tintinRoot, "src/index.ts");
  const root = await mkdtemp(join(tmpdir(), "jev-compat-")), cwd = join(root, "project"), agentDir = process.env.PI_CODING_AGENT_DIR!;
  const previousCwd = process.cwd(), previousFetch = globalThis.fetch;
  let parent: any, networkFetchAttempts = 0, listenerCount = 0;
  const cleanup: (() => void)[] = [];
  let releaseAuthentication: (() => void) | undefined;
  let authBarrier: { entered: Promise<void>; enter: () => void; pending: Promise<void> } | undefined;
  const deferAuthentication = () => {
    check(!authBarrier, "Authentication barrier already armed");
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    authBarrier = { entered, enter, pending };
    releaseAuthentication = release;
    return { entered, release };
  };
  const value = await withNativeCleanup(async () => {
    await mkdir(cwd); await prepareNativeFiles(cwd, agentDir); process.chdir(cwd);
    await options.afterPrepare?.({cwd,agentDir});
    const deny = () => { networkFetchAttempts++; throw new Error("Network forbidden in native compatibility gate"); };
    const fetchFixture=async(url:unknown,init?:RequestInit)=>{
      if(options.classifier && String(url)==='https://jev-fixture.invalid')return options.classifier(JSON.parse(String(init?.body)));
      return deny();
    };
    globalThis.fetch = Object.assign(options.classifier?fetchFixture:deny, { preconnect: deny }) as any;
    const sdk: any = await bounded(import(pathToFileURL(sdkEntry).href), "public SDK import");
    const ai: any = await bounded(import(pathToFileURL(aiEntry).href), "public provider import");
    const configPath = join(cwd, ".pi", "subagents.json");
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, "utf8")), scopeModels: true }));
    const models = ["allowed", "excluded", "parent"].map(id => ({
      id, name: `Compatibility ${id}`, provider: `jev-compat-${id}`, api: "jev-compat", baseUrl: "https://invalid.invalid",
      reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 128,
      cost: options.modelCosts?.[id]??{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }));
    const settingsPath = join(agentDir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ ...JSON.parse(await readFile(settingsPath, "utf8")),
      enabledModels: ["jev-compat-allowed/allowed", "jev-compat-parent/parent"] }));
    for (const definition of ["omitted", "model", "thinking", "both"]) {
      const base = await readFile(join(cwd, ".pi", "agents", "probe.md"), "utf8");
      const fields = [definition === "model" || definition === "both" ? "model: jev-compat-allowed/allowed" : "",
        definition === "thinking" || definition === "both" ? "thinking: high" : ""].filter(Boolean).join("\n");
      await writeFile(join(cwd, ".pi", "agents", `${definition}.md`), base.replace("name: probe", `name: ${definition}\n${fields}`));
    }
    const runtime = await acquireWithin<any>(signal => sdk.ModelRuntime.create({ authPath: join(agentDir, "compat-auth.json"),
      modelsPath: null, modelsStorePath: join(agentDir, "compat-models.json"), allowModelNetwork: false, refreshOnCreate: false, signal }),
      "compatibility runtime", async () => {});
    const witnesses: any[] = [], mutations = new Map<string, any>(), executions = new Map<string, any>(), progress = new Map<string, any[]>();
    let pending: NativeToolCall | undefined;
    const enqueue = (call: NativeToolCall) => { check(!pending, "Unconsumed parent call"); pending = call; };
    for (const model of models) {
      const stream = (_selected: unknown, context: any, streamOptions?: any) => {
        const events = ai.createAssistantMessageEventStream();
        // Pi's native provider contract supplies messages, not a context.tools field.
        const prompt = context.messages.filter((message: any) => message.role === "user").map((message: any) =>
          typeof message.content === "string" ? message.content : message.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")).join("\n");
        // Exact parent prompt witness distinguishes loops from children even when they inherit its model.
        const isParent = prompt.includes("Execute the deterministic native call ");
        const call = isParent ? pending : options.childToolCall?.(prompt,context);
        if (call) pending = undefined;
        if (!isParent) witnesses.push({ prompt, model: { provider: model.provider, id: model.id }, thinking: streamOptions?.reasoning ?? "off" });
        const message: any = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
          stopReason: call ? "toolUse" : "stop", content: call ? [{ type: "toolCall", id: call.id, name: "Agent", arguments: call.arguments }] : [{ type: "text", text: "Native fixture answer." }],
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: isParent?0:(options.childCost??0) } } };
        queueMicrotask(() => { events.push({ type: "start", partial: message });
          if (call) { events.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            events.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(call.arguments), partial: message });
            events.push({ type: "toolcall_end", contentIndex: 0, toolCall: message.content[0], partial: message }); }
          else { events.push({ type: "text_start", contentIndex: 0, partial: message });
            events.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: message });
            events.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: message }); }
          events.push({ type: "done", reason: message.stopReason, message }); events.end(); });
        return events;
      };
      runtime.registerNativeProvider({ id: model.provider, name: model.name, getModels: () => [model], stream, streamSimple: stream,
        auth: { apiKey: { name: "Local fixture", check: async () => ({ type: "api_key", source: "compat-fixture" }),
          resolve: async () => {
            if (model.id === "allowed" && authBarrier) {
              const barrier = authBarrier; authBarrier = undefined;
              barrier.enter(); await barrier.pending;
            }
            return { auth: { apiKey: "not-a-real-key" } };
          } } } });
    }
    await bounded(runtime.refresh({ allowNetwork: false }), "provider registration");
    const underlyingBus = sdk.createEventBus();
    const eventBus = { emit: underlyingBus.emit.bind(underlyingBus), on(channel: string, handler: any) {
      listenerCount++; const off = underlyingBus.on(channel, handler); let live = true;
      return () => { if (live) { live = false; listenerCount--; off(); } };
    } };
    const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { enabled: false } }, { projectTrusted: true });
    const settingsBefore = JSON.stringify(settings.getGlobalSettings()), fileBefore = await readFile(settingsPath, "utf8");
    const observer = (pi: any) => {
      pi.on("tool_call", (event: any) => { if (event.toolName !== "Agent") return;
        const before = structuredClone(event.input);
        event.input.description = `${event.input.description} [host-observed]`;
        if (event.input.description.startsWith("scope-mutation")) event.input.model = "jev-compat-allowed/allowed";
        mutations.set(event.toolCallId, { before, after: structuredClone(event.input) });
      });
      pi.on("tool_result", (event: any) => { if (event.toolName === "Agent") executions.set(event.toolCallId, structuredClone(event.input)); });
      // Consume synchronously without replacing native results or triggering another parent run.
      cleanup.push(pi.events.on("subagents:completed", (data: any) => {
        pi.events.emit("subagents:rpc:consume", { requestId: `consume-${data.id}`, agentId: data.id });
      }));
    };
    parent = await createNativeParent(sdk, cwd, agentDir, tintinEntry, runtime, models[2], settings,
      async result => { try { await bounded(shutdownNative(result.session), "late shutdown"); } finally { result.session.dispose(); } },
      Object.assign({ eventBus, extensionFactories: [observer,...(options.extensionFactories??[])] },
        options.extensionPaths?{additionalExtensionPaths:[tintinEntry,...options.extensionPaths]}:{}));
    cleanup.push(parent.subscribe((event: any) => {
      if (event.type === "tool_execution_start") executions.set(event.toolCallId, structuredClone(event.args));
      if (event.type === "tool_execution_update") {
        const updates = progress.get(event.toolCallId) ?? [];
        updates.push(structuredClone(event.partialResult)); progress.set(event.toolCallId, updates);
      }
    }));
    const registry = (globalThis as any)[managerKey];
    const rpc = async (channel: string, payload: any = {}) => {
      const requestId = `compat-${channel}-${crypto.randomUUID()}`;
      let off!: () => void;
      try { return await bounded(new Promise<any>(resolve => { off = eventBus.on(`${channel}:reply:${requestId}`, resolve);
        eventBus.emit(channel, { ...payload, requestId }); }), channel); } finally { off?.(); }
    };
    const value = await body({ sdk, parent, registry, models, witnesses, mutations, executions, progress, enqueue, rpc, cwd, deferAuthentication,
      settingsUnchanged: async () => JSON.stringify(settings.getGlobalSettings()) === settingsBefore && await readFile(settingsPath, "utf8") === fileBefore });
    await bounded(registry.waitForAll(), "native fixture settlement");
    return value;
  }, {
    releaseAuthentication: () => releaseAuthentication?.(),
    abort: async () => { if (parent) await bounded(parent.abort(), "parent cleanup abort"); },
    shutdown: async () => { if (parent) await bounded(shutdownNative(parent), "parent cleanup shutdown"); },
    dispose: () => { if (parent) parent.dispose(); },
    unsubscribe: cleanup,
    restoreFetch: () => { globalThis.fetch = previousFetch; },
    restoreCwd: () => process.chdir(previousCwd),
    removeTemp: () => rm(root, { recursive: true, force: true }),
  });
  check(listenerCount === 0, `Shutdown leaked ${listenerCount} bus listeners`);
  check(networkFetchAttempts === 0, "Network fetch attempted");
  check((globalThis as any)[managerKey] === undefined, "Native registry leaked");
  return Object.assign(value, { shutdownListenerCount: listenerCount, networkFetchAttempts });
}

export async function runCompatibilityProbe(roots: { hostRoot: string; tintinRoot: string }) {
  return withNativeFixture(roots, async f => {
    const publicControlMissing = ["getIdleChildConfigurationSnapshot", "configureIdleChild", "getIdleChildConfigurationReceipt"]
      .filter(name => typeof f.registry[name] !== "function").map(name => `Tintin.${name}`);
    const rpcPing = await f.rpc("subagents:rpc:ping");
    check(rpcPing.success === true && rpcPing.data?.version === 2, "RPC ping v2 envelope invalid");
    const calls = [];
    const schema = f.parent.getToolDefinition("Agent")?.parameters;
    check(schema?.properties?.prompt?.type === "string" && schema.properties?.resume && schema.properties?.model && schema.properties?.thinking, "Published Agent schema changed");
    const witnessBeforeInvalid = f.witnesses.length;
    f.enqueue({ id: "schema-invalid", name: "Agent", arguments: { subagent_type: "omitted", description: "schema rejection", prompt: 42 } });
    await bounded(f.parent.prompt("Execute the deterministic native call schema-invalid"), "native schema rejection");
    const invalidReceipt = f.parent.messages.find((m: any) => m.role === "toolResult" && m.toolCallId === "schema-invalid");
    const schemaValidation = { rejected: invalidReceipt?.isError === true && f.witnesses.length === witnessBeforeInvalid,
      toolCallId: invalidReceipt?.toolCallId, content: invalidReceipt?.content };
    check(schemaValidation.rejected, "Invalid native Agent arguments did not fail schema validation before child execution");
    for (const definition of ["omitted", "model", "thinking", "both"]) for (const explicit of [false, true]) for (const background of [false, true]) {
      const id = `${definition}-${explicit}-${background}`, token = `CHILD-WITNESS-${id}`;
      const parentPair = { model: f.parent.model.id, thinking: f.parent.thinkingLevel };
      const expectedModel = { provider: definition === "model" || definition === "both" ? "jev-compat-allowed" : "jev-compat-parent",
        id: definition === "model" || definition === "both" ? "allowed" : "parent" };
      // Published Tintin leaves an omitted level to SDK defaults (medium), not parent's live off level.
      const expectedThinking = definition === "thinking" || definition === "both" ? "high" : explicit ? "off" : "medium";
      const args = { subagent_type: definition, description: id, prompt: token, run_in_background: background, isolated: true,
        ...(explicit ? { model: "jev-compat-parent/parent", thinking: "off" } : {}) };
      const start = f.witnesses.length;
      const record = await bounded(nativeCall(f.parent, { id, name: "Agent", arguments: args }, f.enqueue, { allowPendingBackground: true }), id);
      // A started event alone is too early. waitForAll settles actual SDK creation and execution.
      await bounded(f.registry.waitForAll(), "correlated child settlement");
      check(record.session?.isIdle && f.registry.getRecord(record.id) === record, "No retained idle correlated SDK child");
      const observed = f.witnesses.slice(start).filter((w: any) => w.prompt.includes(token));
      check(observed.length === 1, `Expected one actual provider child stream: ${JSON.stringify(observed)}`);
      const receipt = f.parent.messages.find((m: any) => m.role === "toolResult" && m.toolCallId === id);
      const receiptBefore = JSON.stringify(receipt);
      const sdkSession = record.session;
      const nativeReceiptCorrelation = receipt.toolCallId === id && receipt.details?.agentId === record.id && (record.toolCallId === undefined || record.toolCallId === id);
      await bounded(nativeCall(f.parent, { id: `${id}-resume`, name: "Agent", arguments: { ...args, resume: record.id, prompt: `RESUME-${id}`, run_in_background: background } }, f.enqueue), "identity resume");
      await bounded(f.registry.waitForAll(), "correlated resumed child settlement");
      check(record.session === sdkSession, "Resume replaced SDK identity");
      const mutation = f.mutations.get(id), execution = f.executions.get(id);
      const row = { id, definition, explicit, background, expectedModel, expectedThinking, observedModel: observed[0].model,
        observedThinking: observed[0].thinking, nativeExecutionCount: observed.length,
        nativeProgressPreserved: !background && (f.progress.get(id) ?? []).some((update: any) => Array.isArray(update.content) && update.content.some((c: any) => c.type === "text")),
        progressUpdateCount: (f.progress.get(id) ?? []).length,
        hostInputMutation: mutation?.before.description !== mutation?.after.description && execution?.description === mutation?.after.description && record.description === mutation?.after.description,
        definitionModelWins: JSON.stringify(observed[0].model) === JSON.stringify(expectedModel), definitionThinkingWins: observed[0].thinking === expectedThinking,
        foregroundReceiptPreserved: !background && receipt.details?.agentId === record.id && receipt.content.some((c: any) => c.text?.includes("Native fixture answer.")) && JSON.stringify(receipt) === receiptBefore,
        backgroundReceiptPreserved: background && receipt.details?.status === "background" && receipt.details?.agentId === record.id && JSON.stringify(receipt) === receiptBefore,
        nativeReceiptCorrelation,
        retainedIdleSession: sdkSession.isIdle, resumeIdentityPreserved: record.session === sdkSession,
        parentUnchanged: f.parent.model.id === parentPair.model && f.parent.thinkingLevel === parentPair.thinking,
        settingsUnchanged: await f.settingsUnchanged() };
      for (const field of ["hostInputMutation", "definitionModelWins", "definitionThinkingWins", "nativeReceiptCorrelation", "retainedIdleSession", "resumeIdentityPreserved", "parentUnchanged", "settingsUnchanged"]) check((row as any)[field], `${id}: ${field} failed: ${JSON.stringify(row)}`);
      calls.push(row);
    }
    const scopeWitnessBefore = f.witnesses.length;
    const rejected = await f.rpc("subagents:rpc:spawn", { type: "omitted", prompt: "DO-NOT-RUN", options: { model: "jev-compat-excluded/excluded", isolated: true } });
    const scopeExcludedRejected = rejected.success === false && typeof rejected.error === "string" && rejected.error.includes("Model not in scope");
    check(scopeExcludedRejected && f.witnesses.length === scopeWitnessBefore, "Excluded authenticated model not refused before execution by public RPC");
    const scopeRecord = await bounded(nativeCall(f.parent, { id: "scope-mutation", name: "Agent", arguments: { subagent_type: "omitted",
      description: "scope-mutation", prompt: "SCOPE-WITNESS", model: "jev-compat-excluded/excluded", thinking: "off", isolated: true } }, f.enqueue), "scope input mutation");
    const scopeMutationSelectedAllowed = scopeRecord.session.model.id === "allowed" && f.mutations.get("scope-mutation")?.after.model === "jev-compat-allowed/allowed";
    check(scopeMutationSelectedAllowed, "Host input mutation did not select allowed model");
    return { gate: "3A", status: "measured", executionPath: "published-native-Agent-prompt-pipeline", calls, rpcPing, publicControlMissing, schemaValidation, scopeExcludedRejected, scopeMutationSelectedAllowed, fullRouterParityVerified: false,
      limits: ["Same-mode resume measured. Background-to-foreground resume retains a stale optional record.toolCallId in published Tintin; strict correlation refuses it (observed in RED evidence).",
        "Omitted thinking uses SDK default medium; explicit caller off and authored definition high tested separately.", "No production controller or full-router parity."] };
  });
}

if (import.meta.main) {
  try { console.log(JSON.stringify(await runCompatibilityProbe(rootsFromArgs()), null, 2)); }
  catch (error) { console.error(JSON.stringify({ gate: "3A", status: "failed", message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; }
}
