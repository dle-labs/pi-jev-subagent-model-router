import { afterEach, expect, test } from "bun:test";
import { createEngine, propose } from "../../src/routing/engine";
import { config, analysis } from "../support/fixtures";
import type { TaskSnapshot } from "../../src/contracts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const spend = { today: 2, month: 3, pressure: 0 };
const task = (): TaskSnapshot => ({ owner: "owner", generation: 1, toolCallId: "call", prompt: "hi", agent: "worker", original: {} });
function setup() {
  const c = config(); c.apiKey = "fake-key"; c.kindModels = {}; c.routes = { quick: [], standard: [], high: [], premium: [{ provider: "p", model: "m", thinkingLevel: "off" }], xpremium: [] };
  return { snapshot: { owner: "owner", generation: 1, config: c }, candidates: [{ provider: "p", id: "m" }] };
}
test("production composition sends bounded identity plus short task, no parent context, then decides", async () => {
  const { snapshot, candidates } = setup(); let body: any; let auth: unknown;
  globalThis.fetch = (async (_url, init) => { body = JSON.parse(String(init?.body)); auth = (init?.headers as any).Authorization; return Response.json({ answers: { task_kind: { choice: "implement", confidence: .9 }, complexity: { score: 2 }, capability_deserved: { score: 2 }, needs_deep_reasoning: { noul: .8 } }, usage: { input_tokens: 12, output_tokens: 4 } }); }) as typeof fetch;
  const result = await propose(task(), snapshot, candidates, spend, new AbortController().signal);
  expect(body.state.request).toContain("worker"); expect(body.state.request).toContain("hi");
  expect(body.state.conversation_excerpt).toBeNull(); expect(body.state.environment.context_tokens_used).toBeNull(); expect(auth).toBe("Bearer fake-key");
  expect(result.decision?.model).toEqual(candidates[0]); expect(result.decision?.target.thinkingLevel).toBe("off");
  expect(result.degraded).toContain("usage-unrecorded");
});
test("classify captures independent copies and usage seam regardless of empty candidates", async () => {
  const { snapshot, candidates } = setup(); const t = task(); t.prompt = "x".repeat(10000); t.agent = "a".repeat(9000);
  let finish!: (value: ReturnType<typeof analysis>) => void; let seen: any; let seenConfig: any; const records: any[] = [];
  const engine = createEngine({ classify: async (input, c) => { seen = input; seenConfig = c; return await new Promise(resolve => { finish = resolve; }); }, recordUsage: async e => { records.push(e); } });
  const pending = engine(t, snapshot, [], spend, new AbortController().signal);
  t.prompt = "mutated"; snapshot.config.routes.premium[0].model = "changed"; spend.today = 999;
  finish(analysis({ usage: { input_tokens: 11, output_tokens: 2 } })); const result = await pending;
  expect(seen.prompt.length).toBeLessThanOrEqual(8000); expect(seen.prompt).toContain("xxx"); expect(seen.spend.today).toBe(2); spend.today = 2;
  expect(seenConfig.routes.premium[0].model).toBe("m"); expect(result.decision).toBeUndefined(); expect(result.reason).toBe("no-permitted-candidate");
  expect(records).toEqual([{ owner: "owner", toolCallId: "call", requests: 1, status: "classified", usage: { input_tokens: 11, output_tokens: 2 } }]);
  expect(JSON.stringify(records)).not.toContain("xxx"); expect(candidates).toHaveLength(1);
});
test("missing key and classifier errors fail open with static sanitized errors", async () => {
  const { snapshot, candidates } = setup(); snapshot.config.apiKey = ""; snapshot.config.apiKeyEnv = "UNSET_TASK7_KEY";
  let calls = 0; const engine = createEngine({ classify: async () => { calls++; throw Error("secret task fake-key"); } });
  expect((await engine(task(), snapshot, candidates, spend, new AbortController().signal)).reason).toBe("missing-api-key"); expect(calls).toBe(0);
  snapshot.config.apiKey = "key"; const failed = await engine(task(), snapshot, candidates, spend, new AbortController().signal);
  expect(failed.decision).toBeUndefined(); expect(failed.reason).toBe("classification-failed"); expect(JSON.stringify(failed)).not.toContain("secret");
});
test("usage callback throws are degraded, not discarded decisions or saved counters", async () => {
  const { snapshot, candidates } = setup(); const engine = createEngine({ classify: async () => analysis(), recordUsage: () => { throw Error("secret"); } });
  const result = await engine(task(), snapshot, candidates, spend, new AbortController().signal);
  expect(result.decision).toBeDefined(); expect(result.degraded).toEqual(["usage-callback-failed"]); expect(JSON.stringify(result)).not.toContain("secret");
});
test("new launch has no warm baseline; explicit future childContext alone may supply one", async () => {
  const { snapshot, candidates } = setup(); const inputs: any[] = [];
  const engine = createEngine({ classify: async input => { inputs.push(input); return analysis(); } });
  await engine(task(), snapshot, candidates, spend, new AbortController().signal);
  await engine(task(), snapshot, candidates, spend, new AbortController().signal, { history: "child only", contextTokens: 5, current: { index: 3, model: candidates[0] } });
  expect(inputs[0].history).toBeUndefined(); expect(inputs[0].activeModel).toBeUndefined(); expect(inputs[1].history).toBe("child only"); expect(inputs[1].contextTokens).toBe(5);
});
test("invalid configuration never escapes the proposal API or reflects bad values", async () => {
  const { snapshot, candidates } = setup(); snapshot.config.apiKey = { secret: "secret key" } as never;
  const result = await propose(task(), snapshot, candidates, spend, new AbortController().signal);
  expect(result.decision).toBeUndefined(); expect(result.reason).toBe("routing-failed"); expect(JSON.stringify(result)).not.toContain("secret");
});
test("real Jev timeout is fail open, even transport ignoring cancellation", async () => {
  const { snapshot, candidates } = setup(); snapshot.config.timeoutMs = 3;
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
  const result = await propose(task(), snapshot, candidates, spend, new AbortController().signal);
  expect(result.decision).toBeUndefined(); expect(result.reason).toBe("classification-failed");
});
