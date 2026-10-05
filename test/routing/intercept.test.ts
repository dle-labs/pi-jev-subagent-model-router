import { afterEach, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eligible, applyDefaults, LaunchRouter } from "../../src/routing/intercept";
import { config, agentInput, analysis } from "../support/fixtures";
import { FakeBus } from "../support/bus";
import { resolveExactScope } from "../../src/tintin/scope";
import type { RouteAnalysis } from "../../src/core/jev";
import { TintinDiscovery } from "../../src/tintin/discovery";

const realFetch = globalThis.fetch; afterEach(() => { globalThis.fetch = realFetch; });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function tool() { return { name: "Agent", description: "Native", parameters: { type: "object", required: ["prompt", "description", "subagent_type"], properties: Object.fromEntries(["prompt", "description", "subagent_type", "model", "thinking", "resume", "schedule"].map(k => [k, { type: "string" }])) } }; }
function setup(extra: Partial<ConstructorParameters<typeof LaunchRouter>[0]> = {}) {
  const c = config(); c.apiKey = "fake-key"; c.kindModels = {}; c.routes = { quick: [{ provider: "p", model: "cheap", thinkingLevel: "off" }], standard: [], high: [], premium: [{ provider: "p", model: "m", thinkingLevel: "high" }], xpremium: [] };
  const bus = new FakeBus(); bus.on("subagents:rpc:ping", data => { const id = (data as any).requestId; bus.emit(`subagents:rpc:ping:reply:${id}`, { success: true, data: { version: 2 } }); });
  let models = [{ provider: "p", id: "m" }, { provider: "p", id: "cheap" }]; let tools: unknown = [tool()];
  const records: any[] = []; const usages: any[] = [];
  const router = new LaunchRouter({ owner: "o", config: c, bus, catalogue: { getAllTools: () => tools }, classify: async () => analysis(), scope: async () => ({ kind: "unrestricted" }), recordUsage: e => { usages.push(e); }, audit: e => { records.push(e); }, ...extra });
  const context = { owner: "o", signal: new AbortController().signal, modelRegistry: { getAll: () => models, getAvailable: () => models }, spend: { today: 0, month: 0, pressure: 0 }, cwd: "/tmp/fixture", isProjectTrusted: () => true };
  const event = (input: Record<string, unknown> = agentInput()) => ({ toolName: "Agent", toolCallId: "call", input });
  return { router, c, context, event, records, usages, bus, setModels: (m: typeof models) => { models = m; }, setTools: (t: unknown) => { tools = t; } };
}
for (const explicit of ["off", null, "", false, "invalid"]) {
  test(`eligibility respects undefined only, including explicit ${JSON.stringify(explicit)}`, () => {
    expect(eligible("Agent", { ...agentInput(), model: explicit, thinking: explicit })).toBe(false);
    expect(eligible("Agent", { ...agentInput(), model: explicit })).toBe(true);
    expect(eligible("Other", agentInput())).toBe(false);
  });
}
test("empty resume/schedule are eligible, actual truthy operations and malformed tasks skip", () => {
  for (const field of ["resume", "schedule"]) { expect(eligible("Agent", { ...agentInput(), [field]: "" })).toBe(true); expect(eligible("Agent", { ...agentInput(), [field]: "actual" })).toBe(false); }
  for (const patch of [{ prompt: " " }, { subagent_type: "" }, { prompt: false }, { subagent_type: null }]) expect(eligible("Agent", { ...agentInput(), ...patch })).toBe(false);
});
test("mutation primitive only fills still undefined independent fields and guards state", () => {
  const input: Record<string, unknown> = { model: null, thinking: undefined, other: {} }; const captured = { owner: "o", generation: 1 }; const state = { ...captured, enabled: true };
  expect(applyDefaults(input, { model: "p/m", thinking: "off" }, captured, state)).toBe(true); expect(input.model).toBeNull(); expect(input.thinking).toBe("off");
  for (const current of [{ ...state, enabled: false }, { ...state, generation: 2 }, { ...state, owner: "x" }]) expect(applyDefaults({}, { model: "p/m" }, captured, current)).toBe(false);
  expect(applyDefaults({}, { model: "p/m" }, captured, state, AbortSignal.abort())).toBe(false);
});
test("deferred classification preserves native input identity and every unrelated option", async () => {
  const gate = deferred<RouteAnalysis>(); const started = deferred<void>(); const s = setup({ classify: async () => { started.resolve(); return gate.promise; } });
  const input: Record<string, unknown> = { ...agentInput(), tools: ["Read"], isolation: "worktree", run_in_background: true, context: { inherit: false }, resume: "", schedule: "" }; const original = { ...input }; const event = s.event(input);
  const pending = s.router.handle(event, s.context); await started.promise; expect(input.model).toBeUndefined(); gate.resolve(analysis());
  expect((await pending).changed).toBe(true); expect(event.input).toBe(input); for (const k of Object.keys(original)) expect(input[k]).toBe(original[k]); expect(input.model).toBe("p/m"); expect(input.thinking).toBe("high"); expect(s.usages).toHaveLength(1);
});
for (const field of ["model", "thinking"]) {
  for (const value of ["off", null, "", false, "invalid"]) test(`hook preserves explicit ${field}=${JSON.stringify(value)} and defaults the other`, async () => {
    const s = setup(); const input: Record<string, unknown> = { ...agentInput(), [field]: value }; await s.router.handle(s.event(input), s.context);
    expect(input[field]).toBe(value); expect(input[field === "model" ? "thinking" : "model"]).toBe(field === "model" ? "high" : "p/m");
  });
}
test("both explicit and actual resume/schedule skip classification and discovery", async () => {
  let n = 0; const s = setup({ classify: async () => { n++; return analysis(); } });
  for (const patch of [{ model: "m", thinking: "off" }, { resume: "id" }, { schedule: "tomorrow" }]) { const input = { ...agentInput(), ...patch }; const before = { ...input }; await s.router.handle(s.event(input), s.context); expect(input).toEqual(before); }
  expect(n).toBe(0); expect(s.usages).toHaveLength(0);
});
for (const transition of ["off-on", "owner", "config", "mode", "dispose", "operation"]) test(`pending classification cannot survive ${transition}`, async () => {
  const gate = deferred<RouteAnalysis>(); const started = deferred<AbortSignal>(); const s = setup({ classify: async (_i, _c, _k, signal) => { started.resolve(signal!); return gate.promise; } }); const ctrl = new AbortController();
  const input = agentInput(); const pending = s.router.handle(s.event(input), { ...s.context, signal: ctrl.signal }); const signal = await started.promise;
  if (transition === "off-on") { s.router.update({ enabled: false }); s.router.update({ enabled: true }); }
  if (transition === "owner") s.router.update({ owner: "new" });
  if (transition === "config") s.router.update({ config: s.c });
  if (transition === "mode") s.router.update({ mode: "notify" });
  if (transition === "dispose") s.router.dispose();
  if (transition === "operation") ctrl.abort();
  expect(signal.aborted).toBe(true); gate.resolve(analysis()); expect((await pending).changed).toBe(false); expect(input).toEqual(agentInput());
});
test("off cancels ALL concurrent request controllers and does not resurrect them", async () => {
  const gate = deferred<RouteAnalysis>(); const ready = deferred<void>(); const signals: AbortSignal[] = []; const s = setup({ classify: async (_i, _c, _k, sig) => { signals.push(sig!); if (signals.length === 2) ready.resolve(); return gate.promise; } });
  const a = agentInput(), b = agentInput(); const pa = s.router.handle(s.event(a), s.context), pb = s.router.handle(s.event(b), s.context); await ready.promise;
  s.router.update({ enabled: false }); s.router.update({ enabled: true }); expect(signals.every(x => x.aborted)).toBe(true); gate.resolve(analysis()); await Promise.all([pa, pb]); expect(a).toEqual(agentInput()); expect(b).toEqual(agentInput());
});
for (const restore of [false, true]) test(`schema epoch aborts old classifier after compatible rediscovery${restore ? " and restoration" : ""}`, async () => {
  const gate = deferred<RouteAnalysis>(), started = deferred<AbortSignal>(); let calls = 0;
  const signals: AbortSignal[] = [];
  const s = setup({ classify: async (_i, _c, _k, signal) => {
    signals.push(signal!); if (++calls === 1) { started.resolve(signal!); return gate.promise; } return analysis();
  } });
  const a = agentInput(), b = agentInput(); const pa = s.router.handle(s.event(a), s.context);
  const oldSignal = await started.promise;
  const changed = tool(); changed.description = "Compatible replacement"; s.setTools([changed]);
  expect((await s.router.handle(s.event(b), s.context)).changed).toBe(true);
  if (restore) { s.setTools([tool()]); expect((await s.router.handle(s.event(), s.context)).changed).toBe(true); }
  expect(oldSignal.aborted).toBe(true);
  gate.resolve(analysis());
  expect((await pa).changed).toBe(false); expect(oldSignal.aborted).toBe(true);
  expect(a).toEqual(agentInput()); expect(b).toMatchObject({ model: "p/m", thinking: "high" });
  expect(signals.slice(1).every(signal => !signal.aborted)).toBe(true);
  expect(s.bus.count()).toBe(1); s.router.dispose(); expect(s.bus.count()).toBe(1);
});
test("post-ping catalogue reentrancy cannot publish an old epoch after schema change and restoration", async () => {
  const bus = new FakeBus(), replies: string[] = [], classified: string[] = [], epochs: number[] = [];
  let discovery: TintinDiscovery | undefined;
  const subscribe = TintinDiscovery.prototype.onInvalidation; let listeners = 0;
  const spy = spyOn(TintinDiscovery.prototype, "onInvalidation").mockImplementation(function (this: TintinDiscovery, listener) {
    discovery = this;
    listeners++; const off = subscribe.call(this, epoch => { epochs.push(epoch); listener(epoch); }); let active = true;
    return () => { if (active) { active = false; listeners--; } off(); };
  });
  let tools = [tool()], reenter = false;
  const reply = (id: string) => bus.emit(`subagents:rpc:ping:reply:${id}`, { success: true, data: { version: 2 } });
  const offPing = bus.on("subagents:rpc:ping", payload => {
    const id = (payload as { requestId: string }).requestId; replies.push(id);
    if (replies.length === 1) { reenter = true; reply(id); }
  });
  const operation = new AbortController(), operationListeners = new Set<unknown>();
  const add = operation.signal.addEventListener.bind(operation.signal), remove = operation.signal.removeEventListener.bind(operation.signal);
  const addSpy = spyOn(operation.signal, "addEventListener").mockImplementation((...args: Parameters<typeof add>) => {
    if (args[0] === "abort") operationListeners.add(args[1]); add(...args);
  });
  const removeSpy = spyOn(operation.signal, "removeEventListener").mockImplementation((...args: Parameters<typeof remove>) => {
    if (args[0] === "abort") operationListeners.delete(args[1]); remove(...args);
  });
  const a = { ...agentInput(), prompt: "A" }, b = { ...agentInput(), prompt: "B" }, c = { ...agentInput(), prompt: "C" };
  let pb: ReturnType<LaunchRouter["handle"]> | undefined, pc: ReturnType<LaunchRouter["handle"]> | undefined;
  let s: ReturnType<typeof setup> | undefined;
  try {
    s = setup({ bus, catalogue: { getAllTools: () => {
      if (reenter) {
        reenter = false;
        const changed = tool(); changed.description = "Compatible replacement"; tools = [changed];
        pb = s!.router.handle(s!.event(b), { ...s!.context, signal: operation.signal });
        tools = [tool()];
        pc = s!.router.handle(s!.event(c), { ...s!.context, signal: operation.signal });
        // Both newer probes emitted their ping, but neither reply is released.
        expect(replies).toHaveLength(3); expect(classified).toHaveLength(0);
      }
      return tools;
    } }, classify: async input => { classified.push(input.prompt); return analysis(); } });
    const outcome = await s.router.handle(s.event(a), { ...s.context, signal: operation.signal });
    expect(outcome.changed).toBe(false); expect(a).toEqual({ ...agentInput(), prompt: "A" });
    expect(classified).toHaveLength(0); expect(s.usages).toHaveLength(0);
    expect(operation.signal.aborted).toBe(false); expect(listeners).toBe(1);
    expect(epochs).toEqual([1, 2, 3]);
    // Read the real discovery instance: stale A must not overwrite C's state.
    expect(discovery!.status).toMatchObject({ epoch: 3, ready: false, reason: "discovery-required" });
    for (const id of replies.slice(1)) reply(id);
    expect((await pb!).changed).toBe(false); expect(b).toEqual({ ...agentInput(), prompt: "B" });
    expect((await pc!).changed).toBe(true); expect(c).toMatchObject({ model: "p/m", thinking: "high" });
    expect((await s.router.handle(s.event(), { ...s.context, signal: operation.signal })).changed).toBe(true);
    expect(classified).toHaveLength(2); expect(replies).toHaveLength(3);
    expect(operationListeners.size).toBe(0); expect(bus.count()).toBe(1);
    s.router.dispose(); expect(listeners).toBe(0); expect(bus.count()).toBe(1);
  } finally {
    for (const id of replies.slice(1)) reply(id);
    await Promise.all([pb, pc]); s?.router.dispose(); offPing();
    spy.mockRestore(); addSpy.mockRestore(); removeSpy.mockRestore();
  }
  expect(bus.count()).toBe(0); expect(operationListeners.size).toBe(0);
});
test("production hook rejects old confirmation after compatible schema change and restoration", async () => {
  const started = deferred<void>(), answer = deferred<string | undefined>(); let selected = "";
  const signals: AbortSignal[] = [];
  globalThis.fetch = (async (_url, init) => {
    signals.push(init!.signal!);
    return Response.json({ answers: { task_kind: { choice: "implement", confidence: .9 }, complexity: { score: 2 }, capability_deserved: { score: 2 }, needs_deep_reasoning: { noul: .8 } } });
  }) as typeof fetch;
  const s = setup({ classify: undefined, scope: undefined }); s.router.update({ mode: "confirm" });
  const a = agentInput(), b = agentInput();
  const pa = s.router.handle(s.event(a), { ...s.context, ui: { select: async (_title, options) => {
    selected = options[0]; started.resolve(); return answer.promise;
  } } });
  await started.promise;
  const changed = tool(); changed.description = "Compatible replacement"; s.setTools([changed]);
  expect((await s.router.handle(s.event(b), s.context)).changed).toBe(true);
  s.setTools([tool()]); expect((await s.router.handle(s.event(), s.context)).changed).toBe(true);
  answer.resolve(selected);
  expect((await pa).changed).toBe(false); expect(a).toEqual(agentInput());
  expect(b).toMatchObject({ model: "p/m", thinking: "high" }); expect(signals).toHaveLength(3);
  s.router.dispose();
});
test("dispose releases the public discovery subscription and aborts bound requests", async () => {
  const subscribe = TintinDiscovery.prototype.onInvalidation; let listeners = 0;
  const spy = spyOn(TintinDiscovery.prototype, "onInvalidation").mockImplementation(function (this: TintinDiscovery, listener) {
    listeners++; const off = subscribe.call(this, listener); let active = true;
    return () => { if (active) { active = false; listeners--; } off(); };
  });
  try {
    const started = deferred<AbortSignal>(), gate = deferred<RouteAnalysis>();
    const s = setup({ classify: async (_i, _c, _k, signal) => { started.resolve(signal!); return gate.promise; } });
    const a = agentInput(), pa = s.router.handle(s.event(a), s.context); const signal = await started.promise;
    expect(listeners).toBe(1); s.router.dispose(); s.router.dispose();
    expect(listeners).toBe(0); expect(signal.aborted).toBe(true);
    gate.resolve(analysis()); expect((await pa).changed).toBe(false); expect(a).toEqual(agentInput());
    expect((await s.router.handle(s.event(), s.context)).reason).toBe("inactive"); expect(s.bus.count()).toBe(1);
  } finally { spy.mockRestore(); }
});
test("external operation cancellation remains independent for same-epoch bound requests", async () => {
  const gate = deferred<RouteAnalysis>(), started = deferred<void>(); const signals: AbortSignal[] = [];
  const s = setup({ classify: async (_i, _c, _k, signal) => {
    signals.push(signal!); if (signals.length === 2) started.resolve(); return gate.promise;
  } });
  const operation = new AbortController(), a = agentInput(), b = agentInput();
  const pa = s.router.handle(s.event(a), { ...s.context, signal: operation.signal });
  const pb = s.router.handle(s.event(b), s.context); await started.promise; operation.abort();
  expect(signals[0].aborted).toBe(true); expect(signals[1].aborted).toBe(false); gate.resolve(analysis());
  expect((await pa).changed).toBe(false); expect((await pb).changed).toBe(true);
  expect(a).toEqual(agentInput()); expect(s.bus.count()).toBe(1); s.router.dispose();
});
test("later handler can fill one or both fields during classification", async () => {
  const gate = deferred<RouteAnalysis>(); const ready = deferred<void>(); const s = setup({ classify: async () => { ready.resolve(); return gate.promise; } });
  const input: Record<string, unknown> = agentInput(); const p = s.router.handle(s.event(input), s.context); await ready.promise; input.model = "caller/later"; gate.resolve(analysis()); await p;
  expect(input.model).toBe("caller/later"); expect(input.thinking).toBe("high");
});
test("scope A allowed but chains B empty never restores candidates or thinking", async () => {
  const s = setup({ scope: async (_ctx, registry) => resolveExactScope((registry as any).getAvailable(), ["q/allowed"]) }); s.setModels([{ provider: "q", id: "allowed" }, { provider: "p", id: "m" }]);
  const input = agentInput(); const result = await s.router.handle(s.event(input), s.context); expect(result.changed).toBe(false); expect(result.reason).toBe("restricted-empty"); expect(input).toEqual(agentInput());
});
test("unknown scope omits defaults and explains why", async () => {
  const s = setup({ scope: async () => ({ kind: "unknown", reason: "trust-unavailable" }) }); const result = await s.router.handle(s.event(), s.context); expect(result.reason).toBe("scope-unknown"); expect(result.changed).toBe(false);
});
for (const change of ["auth", "scope", "schema"]) test(`fresh final ${change} rejects formerly allowed decision`, async () => {
  const gate = deferred<RouteAnalysis>(); const ready = deferred<void>(); let restricted = false;
  const s = setup({ classify: async () => { ready.resolve(); return gate.promise; }, scope: async () => restricted ? { kind: "restricted", allowed: new Set(["q/allowed"]) } : { kind: "unrestricted" } });
  const input = agentInput(); const p = s.router.handle(s.event(input), s.context); await ready.promise;
  if (change === "auth") s.setModels([]); if (change === "scope") restricted = true; if (change === "schema") s.setTools([]);
  gate.resolve(analysis()); expect((await p).changed).toBe(false); expect(input).toEqual(agentInput());
});
test("getAll fallback requires public auth validation; available empty is authoritative", async () => {
  const s = setup(); const input = agentInput(); const registry = { getAll: () => [{ provider: "p", id: "m" }] };
  expect((await s.router.handle(s.event(input), { ...s.context, modelRegistry: registry })).changed).toBe(false);
  expect((await s.router.handle(s.event(), { ...s.context, modelRegistry: { ...registry, hasConfiguredAuth: () => true } })).changed).toBe(true);
  expect((await s.router.handle(s.event(), { ...s.context, modelRegistry: { ...registry, getAvailable: () => [] } })).changed).toBe(false);
});
test("malformed asynchronous registry/auth methods are rejected and rejection is observed", async () => {
  const s = setup();
  for (const registry of [
    { getAll: () => Promise.reject(Error("private")), hasConfiguredAuth: () => true },
    { getAll: () => [{ provider: "p", id: "m" }], hasConfiguredAuth: () => Promise.reject(Error("private")) },
    { getAll: () => [], getAvailable: () => Promise.reject(Error("private")) },
  ]) {
    const result = await s.router.handle(s.event(), { ...s.context, modelRegistry: registry }); expect(result.changed).toBe(false);
  }
});
test("schema unavailable is fail open, reload readiness can recover", async () => {
  const s = setup(); s.setTools([]); expect((await s.router.handle(s.event(), s.context)).changed).toBe(false); s.setTools([tool()]); expect((await s.router.handle(s.event(), s.context)).changed).toBe(true);
});
test("notify and confirm keep still record classifier usage; audit/UI failures are contained", async () => {
  for (const mode of ["notify", "confirm"] as const) {
    const s = setup({ audit: () => { throw Error("secret raw task"); } }); s.router.update({ mode });
    const input = agentInput(); const result = await s.router.handle(s.event(input), { ...s.context, ui: { select: async () => undefined } });
    expect(result.changed).toBe(false); expect(result.degraded).toContain("audit-callback-failed"); expect(s.usages).toHaveLength(1); expect(input).toEqual(agentInput()); expect(JSON.stringify(result)).not.toContain("secret");
  }
});
test("confirm selected/cheaper validated again after dialog; mode change makes it stale", async () => {
  for (const change of ["auth", "mode", "none"] as const) {
    const ready = deferred<void>(), answer = deferred<string | undefined>(); const s = setup(); s.router.update({ mode: "confirm" }); const input = agentInput(); let opts: string[] = [];
    const p = s.router.handle(s.event(input), { ...s.context, ui: { select: async (_t, o) => { opts = o; ready.resolve(); return answer.promise; } } }); await ready.promise;
    if (change === "auth") s.setModels([{ provider: "p", id: "m" }]); if (change === "mode") s.router.update({ mode: "auto" });
    answer.resolve(opts[1]); const result = await p;
    expect(result.changed).toBe(change === "none"); if (change === "none") expect(input).toMatchObject({ model: "p/cheap", thinking: "off" }); else expect(input).toEqual(agentInput());
  }
});
test("production engine through exported hook reaches real fake-fetch Jev then decide and mutation", async () => {
  let requests = 0; globalThis.fetch = (async (_u, init) => { requests++; const state = JSON.parse(String(init?.body)).state; expect(state.conversation_excerpt).toBeNull(); expect(state.request).toContain("worker"); return Response.json({ answers: { task_kind: { choice: "implement", confidence: .9 }, complexity: { score: 2 }, capability_deserved: { score: 2 }, needs_deep_reasoning: { noul: .8 } }, usage: { input_tokens: 7, output_tokens: 2 } }); }) as typeof fetch;
  const s = setup({ classify: undefined, scope: undefined }); const input = { ...agentInput(), prompt: "hi" }; expect((await s.router.handle(s.event(input), s.context)).changed).toBe(true); expect(input).toMatchObject({ model: "p/m", thinking: "high", prompt: "hi" }); expect(requests).toBe(1); expect(s.usages[0].usage).toEqual({ input_tokens: 7, output_tokens: 2 });
});
test("concurrent calls have independent immutable task/config/spend snapshots", async () => {
  const first = deferred<RouteAnalysis>(), second = deferred<RouteAnalysis>(), ready = deferred<void>(); const inputs: any[] = []; const configs: any[] = [];
  const s = setup({ classify: async (i, c) => { inputs.push(i); configs.push(c); if (inputs.length === 2) ready.resolve(); return inputs.length === 1 ? first.promise : second.promise; } });
  const a = { ...agentInput(), prompt: "first" }, b = { ...agentInput(), prompt: "second" }; const pa = s.router.handle(s.event(a), s.context), pb = s.router.handle(s.event(b), { ...s.context, spend: { today: 5, month: 6, pressure: 0 } }); await ready.promise;
  s.c.routes.premium[0].model = "mutated outside"; a.prompt = "mutated task"; first.resolve(analysis()); second.resolve(analysis()); await Promise.all([pa, pb]); expect(inputs[0].prompt).toContain("first"); expect(inputs[1].prompt).toContain("second"); expect(inputs[0].spend.today).toBe(0); expect(inputs[1].spend.today).toBe(5); expect(configs[0]).not.toBe(configs[1]); expect(a).toMatchObject({ model: "p/m" }); expect(b).toMatchObject({ model: "p/m" });
});
test("hook classifier failure, missing key and real timeout leave native input untouched", async () => {
  for (const kind of ["throw", "key", "timeout"]) {
    const s = setup({ classify: kind === "throw" ? async () => { throw Error("secret task fake-key"); } : undefined });
    if (kind === "key") { s.c.apiKey = undefined; s.c.apiKeyEnv = "UNSET_TASK7_KEY"; s.router.update({ config: s.c }); }
    if (kind === "timeout") { s.c.timeoutMs = 3; s.router.update({ config: s.c }); globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch; }
    const input = agentInput(); const result = await s.router.handle(s.event(input), s.context);
    expect(result.changed).toBe(false); expect(input).toEqual(agentInput()); expect(JSON.stringify(result)).not.toContain("secret task");
    expect(s.usages.length).toBe(kind === "key" ? 0 : 1);
  }
});
test("noninteractive confirm is auto fallback; failing interactive UI is not", async () => {
  const s = setup(); s.router.update({ mode: "confirm" });
  expect((await s.router.handle(s.event(), s.context)).reason).toBe("confirm-unavailable-auto");
  const input = agentInput(); const result = await s.router.handle(s.event(input), { ...s.context, ui: { select: async () => { throw Error("secret dialog"); } } });
  expect(result.changed).toBe(false); expect(result.reason).toBe("confirmation-failed"); expect(result.degraded).toContain("ui-callback-failed"); expect(input).toEqual(agentInput());
});
test("final omission check preserves both fields filled while dialog waits", async () => {
  const ready = deferred<void>(), answer = deferred<string | undefined>(); const s = setup(); s.router.update({ mode: "confirm" }); const input: Record<string, unknown> = agentInput(); let selected = "";
  const p = s.router.handle(s.event(input), { ...s.context, ui: { select: async (_t, options) => { selected = options[0]; ready.resolve(); return answer.promise; } } }); await ready.promise;
  input.model = null; input.thinking = "off"; answer.resolve(selected); const result = await p;
  expect(result.changed).toBe(false); expect(result.reason).toBe("preserved"); expect(input.model).toBeNull(); expect(input.thinking).toBe("off"); expect(s.usages).toHaveLength(1);
});
test("scope change during dialog rejects selected and thinking together", async () => {
  const ready = deferred<void>(), answer = deferred<string | undefined>(); let restricted = false;
  const s = setup({ scope: async () => restricted ? { kind: "restricted", allowed: new Set(["other/allowed"]) } : { kind: "unrestricted" } }); s.router.update({ mode: "confirm" }); const input = agentInput(); let selected = "";
  const p = s.router.handle(s.event(input), { ...s.context, ui: { select: async (_t, options) => { selected = options[0]; ready.resolve(); return answer.promise; } } }); await ready.promise; restricted = true; answer.resolve(selected);
  expect((await p).changed).toBe(false); expect(input).toEqual(agentInput());
});
test("scope await cannot survive owner/config/operation replacement", async () => {
  const ready = deferred<void>(), scopeGate = deferred<import("../../src/tintin/scope").ResolvedScope>(); let calls = 0;
  const s = setup({ scope: async () => { ready.resolve(); return scopeGate.promise; }, classify: async () => { calls++; return analysis(); } }); const input = agentInput(); const p = s.router.handle(s.event(input), s.context); await ready.promise;
  s.router.update({ owner: "new", config: s.c }); scopeGate.resolve({ kind: "unrestricted" }); expect((await p).changed).toBe(false); expect(calls).toBe(0);
});
test("protocol absence warns without throwing even when warning callback fails", async () => {
  const warnings: string[] = []; const s = setup({ warning: code => { warnings.push(code); throw Error("private warning"); } }); s.setTools([]);
  const result = await s.router.handle(s.event(), s.context); expect(result.changed).toBe(false); expect(result.reason).toBe("tintin-unavailable"); expect(warnings).toEqual(["tintin-unavailable"]); expect(result.degraded).toContain("warning-callback-failed");
});
test("routing production modules contain no launch, parent, settings mutation or unsafe ledger references", () => {
  for (const file of ["engine", "intercept", "modes"]) {
    const text = readFileSync(new URL(`../../src/routing/${file}.ts`, import.meta.url), "utf8");
    for (const forbidden of ["executeTool", "setModel(", "setThinkingLevel(", "rpc:spawn", "saveLedger(", "recordJevUsage(", "parentHistory"]) expect(text).not.toContain(forbidden);
  }
});
