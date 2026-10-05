import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type JevRouterConfig } from "../../src/core/config";
import * as client from "../../src/core/jev";
import { classifyRequest, JevError, type ClassifyInput } from "../../src/core/jev";

const secret = "PRIVATE-key-url-task-body-sentinel";
const input: ClassifyInput = { prompt: secret, spend: { today: 0, month: 0, pressure: 0 } };
const config: JevRouterConfig = { ...DEFAULT_CONFIG, endpoint: "https://user:PRIVATE-key-url-task-body-sentinel@fixture.invalid/jev", timeoutMs: 2000 };
const good = { task_kind: { choice: "debug", confidence: 0.8, probabilities: { debug: 0.8 } }, complexity: { score: 2 }, capability_deserved: { score: 1 }, needs_deep_reasoning: { noul: 0.5 } };
const realFetch = globalThis.fetch;
let env: string | undefined;
let calls: RequestInit[];
function transport(fn: (init: RequestInit) => Promise<Response> | Response): void {
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => { calls.push(init); return fn(init); }) as typeof fetch;
}
function payload(value: unknown): void { transport(() => ({ ok: true, status: 200, json: async () => value }) as Response); }
async function rejection(promise: Promise<unknown>): Promise<JevError> {
  const result = await promise.then(() => undefined, (error: unknown) => error);
  expect(result).toBeInstanceOf(JevError);
  const error = result as JevError;
  expect(error.message).not.toContain(secret);
  expect(error.message.length).toBeLessThan(160);
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  return error;
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
beforeEach(() => { calls = []; env = process.env.TYPESAFE_API_URL; delete process.env.TYPESAFE_API_URL; });
afterEach(() => { globalThis.fetch = realFetch; if (env === undefined) delete process.env.TYPESAFE_API_URL; else process.env.TYPESAFE_API_URL = env; });

for (const value of [null, [], secret, 7, true]) {
  test(`rejects malformed root ${typeof value}/${Array.isArray(value)}`, async () => { payload(value); await rejection(classifyRequest(input, config, secret)); });
  test(`rejects malformed present answers ${typeof value}/${Array.isArray(value)}`, async () => { payload({ answers: value }); await rejection(classifyRequest(input, config, secret)); });
}
for (const name of ["task_kind", "complexity", "capability_deserved", "needs_deep_reasoning"]) {
  test(`rejects malformed answer object ${name}`, async () => { payload({ answers: { ...good, [name]: null } }); await rejection(classifyRequest(input, config, secret)); });
}
for (const choice of [secret, null, 4, [secret]]) {
  test(`rejects secret-safe invalid choice ${typeof choice}`, async () => { payload({ answers: { ...good, task_kind: { choice } } }); await rejection(classifyRequest(input, config, secret)); });
}
for (const [section, field, max] of [["complexity", "score", 3], ["capability_deserved", "score", 3], ["task_kind", "confidence", 1], ["complexity", "confidence", 1], ["capability_deserved", "confidence", 1], ["needs_deep_reasoning", "noul", 1], ["needs_deep_reasoning", "noul_score", 1]] as const) {
  for (const value of [NaN, Infinity, -0.01, max + 0.01, secret, null]) {
    test(`rejects ${section}.${field}=${String(value)}`, async () => {
      payload({ answers: { ...good, [section]: { [field]: value } } });
      await rejection(classifyRequest(input, config, secret));
    });
  }
}
for (const probabilities of [null, [], secret, { debug: NaN }, { debug: -0.1 }, { debug: 1.1 }, { [secret]: 0.3 }]) {
  test(`rejects malformed probabilities ${JSON.stringify(probabilities)}`, async () => { payload({ answers: { ...good, task_kind: { choice: "debug", probabilities } } }); await rejection(classifyRequest(input, config, secret)); });
}
for (const field of ["input_tokens", "output_tokens"] as const) {
  for (const value of [NaN, Infinity, -1, secret, null]) {
    test(`rejects invalid usage ${field}=${String(value)}`, async () => { payload({ answers: good, usage: { input_tokens: 1, [field]: value } }); await rejection(classifyRequest(input, config, secret)); });
  }
}
test("finiteRange rejects without reflecting its label or value", () => {
  const finiteRange = Reflect.get(client, "finiteRange") as (value: unknown, min: number, max: number, label: string) => number;
  expect(typeof finiteRange).toBe("function");
  expect(finiteRange(0, 0, 3, "score")).toBe(0);
  expect(finiteRange(3, 0, 3, "score")).toBe(3);
  for (const value of [NaN, Infinity, -1, 4, secret, null]) {
    try { finiteRange(value, 0, 3, secret); throw new Error("accepted invalid value"); }
    catch (error) { expect(error).toBeInstanceOf(JevError); expect((error as Error).message).not.toContain(secret); }
  }
});
test("keeps custom taxonomy, defaults, exact noul priority and non-normalized probabilities", async () => {
  payload({ answers: { task_kind: { choice: "custom", probabilities: { custom: 0.2, chat: 0.1 } }, needs_deep_reasoning: { noul: 0, noul_score: 0.9 } }, usage: { input_tokens: 0 } });
  expect(await classifyRequest(input, { ...config, taskKinds: { chat: "Chat", custom: "Custom" } }, secret)).toMatchObject({ kind: "custom", kindProbabilities: { custom: 0.2, chat: 0.1 }, complexity: 1, budgetIntensity: 1, deepReasoning: 0, usage: { input_tokens: 0, output_tokens: 0 } });
});
test("unknown usage stays undefined", async () => { payload({ answers: good, usage: { other: 123 } }); expect((await classifyRequest(input, config, secret)).usage).toBeUndefined(); });
test("invalid supplied output usage rejects even without input usage", async () => { payload({ answers: good, usage: { output_tokens: secret } }); await rejection(classifyRequest(input, config, secret)); });
test("bounds only request, reports optional truncation, preserves input and last history", async () => {
  const original = { ...input, prompt: "x".repeat(8001), history: "a".repeat(5) + "h".repeat(4000), cwd: "/fixture", activeModel: "fixture", contextTokens: 12 };
  payload({ answers: good });
  const result = await classifyRequest(original, config, secret);
  const state = JSON.parse(String(calls[0].body)).state;
  expect(state.request).toBe("x".repeat(8000)); expect(original.prompt.length).toBe(8001);
  expect(state.conversation_excerpt).toBe("h".repeat(4000));
  expect(state.environment).toEqual({ cwd: "/fixture", active_model: "fixture", context_tokens_used: 12 });
  expect(result.requestTruncation).toEqual({ originalChars: 8001, sentChars: 8000 });
});
test("short new task sends no parent history and no truncation property", async () => {
  payload({}); const result = await classifyRequest({ ...input, prompt: "hi" }, config, secret);
  const state = JSON.parse(String(calls[0].body)).state;
  expect(state.request).toBe("hi"); expect(state.conversation_excerpt).toBeNull();
  expect(Object.hasOwn(result, "requestTruncation")).toBe(false);
});
test("does not follow redirects or read secret-bearing non-OK bodies", async () => {
  let reads = 0;
  transport(() => ({ ok: false, status: 302, text: async () => { reads++; return secret; }, json: async () => { reads++; return {}; } }) as Response);
  const error = await rejection(classifyRequest(input, config, secret));
  expect(error.status).toBe(302); expect(calls).toHaveLength(1); expect(calls[0].redirect).toBe("error"); expect(reads).toBe(0);
});
test("normalizes secret transport exceptions and retries at most three times", async () => {
  transport(() => { throw new TypeError(secret); });
  await rejection(classifyRequest(input, config, secret)); expect(calls).toHaveLength(3);
});
test("JSON exceptions are secret-safe and not retried", async () => {
  transport(() => ({ ok: true, status: 200, json: async () => { throw new Error(secret); } }) as unknown as Response);
  await rejection(classifyRequest(input, config, secret)); expect(calls).toHaveLength(1);
});
for (const phase of ["fetch", "body"] as const) {
  test(`cancellation during ignored-signal ${phase} cannot return analysis`, async () => {
    const controller = new AbortController();
    transport(async () => {
      if (phase === "fetch") { controller.abort(secret); await delay(25); }
      return { ok: true, status: 200, json: async () => { if (phase === "body") { controller.abort(secret); await delay(25); } return { answers: good }; } } as Response;
    });
    await rejection(classifyRequest(input, config, secret, controller.signal)); expect(calls).toHaveLength(1);
  });
  test(`total deadline enforced during ignored-signal ${phase}`, async () => {
    transport(async () => {
      if (phase === "fetch") await delay(60);
      return { ok: true, status: 200, json: async () => { if (phase === "body") await delay(60); return { answers: good }; } } as Response;
    });
    const started = Date.now(); await rejection(classifyRequest(input, { ...config, timeoutMs: 10 }, secret));
    expect(Date.now() - started).toBeLessThan(50); expect(calls).toHaveLength(1);
  });
}
/** Keep timers pending while real monotonic elapsed time crosses a short deadline. */
function exhaustDeadline(): void {
  const until = performance.now() + 25;
  while (performance.now() < until) { /* synthetic synchronous transport work */ }
}
const shortDeadline = { ...config, timeoutMs: 10 };

test("synchronous fetch expiry never starts the JSON reader or retries", async () => {
  let reads = 0;
  transport(() => {
    exhaustDeadline();
    return Promise.resolve({ ok: true, status: 200, json: async () => { reads++; return { answers: good }; } } as Response);
  });
  const error = await rejection(classifyRequest(input, shortDeadline, secret));
  expect(error.message).toBe("aborted"); expect(reads).toBe(0); expect(calls).toHaveLength(1);
});
test("queued expiry before fetch operation prevents the first request", async () => {
  payload({ answers: good });
  const queuedInput = { ...input, get history() { queueMicrotask(exhaustDeadline); return undefined; } };
  const error = await rejection(classifyRequest(queuedInput, shortDeadline, secret));
  expect(error.message).toBe("aborted"); expect(calls).toHaveLength(0);
});
test("queued expiry before body operation prevents the JSON reader", async () => {
  let reads = 0;
  transport(() => ({
    get ok() { queueMicrotask(exhaustDeadline); return true; }, status: 200,
    json: async () => { reads++; return { answers: good }; },
  }) as Response);
  const error = await rejection(classifyRequest(input, shortDeadline, secret));
  expect(error.message).toBe("aborted"); expect(reads).toBe(0); expect(calls).toHaveLength(1);
});
test("late malformed body is aborted before analysis accesses the payload", async () => {
  let analyses = 0;
  const malformed = { get answers() { analyses++; return null; } };
  transport(() => ({ ok: true, status: 200, json: async () => { exhaustDeadline(); return malformed; } }) as Response);
  const error = await rejection(classifyRequest(input, shortDeadline, secret));
  expect(error.message).toBe("aborted"); expect(analyses).toBe(0); expect(calls).toHaveLength(1);
});
for (const phase of ["fetch", "body", "analysis"] as const) {
  test(`synchronous ${phase} expiry dominates secret-bearing exceptions`, async () => {
    const failLate = () => { exhaustDeadline(); throw new Error(secret); };
    transport(() => {
      if (phase === "fetch") return failLate();
      return { ok: true, status: 200, json: async () => {
        if (phase === "body") return failLate();
        return { get answers() { return failLate(); } };
      } } as Response;
    });
    const error = await rejection(classifyRequest(input, shortDeadline, secret));
    expect(error.message).toBe("aborted"); expect(calls).toHaveLength(1);
  });
}
test("expiry at overload boundary aborts rather than entering backoff or retry", async () => {
  let abortedBeforeBackoff = false;
  transport((init) => ({ ok: false, get status() {
    exhaustDeadline();
    queueMicrotask(() => { abortedBeforeBackoff = init.signal!.aborted; });
    return 429;
  } }) as Response);
  const error = await rejection(classifyRequest(input, shortDeadline, secret));
  expect(error.message).toBe("aborted"); expect(calls).toHaveLength(1);
  expect(abortedBeforeBackoff).toBe(true);
});
test("cancellation interrupts backoff without another attempt", async () => {
  const controller = new AbortController(); transport(() => { setTimeout(() => controller.abort(secret), 10); return new Response(null, { status: 429 }); });
  const started = Date.now(); await rejection(classifyRequest(input, config, secret, controller.signal));
  expect(Date.now() - started).toBeLessThan(100); expect(calls).toHaveLength(1);
});
test("429/529 share total deadline rather than per-attempt allowance", async () => {
  transport(() => new Response(null, { status: calls.length === 1 ? 429 : 529 }));
  const started = Date.now(); await rejection(classifyRequest(input, { ...config, timeoutMs: 250 }, secret));
  expect(calls).toHaveLength(2); expect(Date.now() - started).toBeLessThan(400);
});
test("three overloads have no final pointless sleep", async () => {
  transport(() => new Response(null, { status: 529 })); const started = Date.now();
  const error = await rejection(classifyRequest(input, config, secret));
  expect(error.status).toBe(529); expect(calls).toHaveLength(3); expect(Date.now() - started).toBeLessThan(1000);
});
test("transient transport retry can recover", async () => {
  transport(() => { if (calls.length < 3) throw new TypeError(secret); return Response.json({ answers: good }); });
  expect((await classifyRequest(input, config, secret)).kind).toBe("debug"); expect(calls).toHaveLength(3);
});
for (const timeoutMs of [secret, NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER]) {
  test(`invalid deadline is secret-safe and makes no request ${String(timeoutMs)}`, async () => {
    payload({ answers: good }); await rejection(classifyRequest(input, { ...config, timeoutMs } as JevRouterConfig, secret)); expect(calls).toHaveLength(0);
  });
}
test("configured endpoint env name is trimmed and bearer key remains caller supplied", async () => {
  const name = "JEV_TASK5_TEST_ENDPOINT"; const saved = process.env[name];
  try {
    process.env[name] = " https://configured.invalid/jev "; let url: unknown;
    globalThis.fetch = (async (target: unknown, init: RequestInit) => { url = target; calls.push(init); return Response.json({ answers: good }); }) as typeof fetch;
    await classifyRequest(input, { ...config, endpointEnv: name, jevModel: "configured-model" }, secret);
    expect(url).toBe("https://configured.invalid/jev"); expect((calls[0].headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
    const body = JSON.parse(String(calls[0].body)); expect(body.model).toBe("configured-model"); expect(Object.keys(body.questions)).toHaveLength(4);
    process.env[name] = "  "; await classifyRequest(input, { ...config, endpointEnv: name }, ""); expect(url).toBe(config.endpoint);
    expect((calls[1].headers as Record<string, string>).Authorization).toBe("Bearer ");
  } finally { if (saved === undefined) delete process.env[name]; else process.env[name] = saved; }
});
