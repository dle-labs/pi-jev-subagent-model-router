import { expect, test } from "bun:test";
import { DEFAULT_CONFIG, loadConfig, TIERS, type JevRouterConfig, type RouteTarget } from "../../src/core/config";
import { decide, type AvailableModel, type DecideOptions } from "../../src/core/router";
import type { RouteAnalysis } from "../../src/core/jev";
// Pure policy modules only: never import the vendor extension or vendor tests.
import { DEFAULT_CONFIG as upstreamDefaults, loadConfig as upstreamLoadConfig } from "../../vendor/pi-jev-model-router/extensions/pi-jev-model-router/config";
import { decide as upstreamDecide } from "../../vendor/pi-jev-model-router/extensions/pi-jev-model-router/router";

const baseAnalysis: RouteAnalysis = {
  kind: "chat", kindConfidence: 0.9, kindProbabilities: {}, complexity: 1,
  complexityConfidence: 0.9, budgetIntensity: 1, budgetIntensityConfidence: 0.9,
  deepReasoning: 0.5, latencyMs: 1,
};
function config(): JevRouterConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  c.routes.xpremium = [{ provider: "openrouter", model: "fixture/xpremium", thinkingLevel: "max" }];
  c.kindModels.custom = [
    { provider: "openrouter", model: "fixture/specialist", minTier: "standard", priority: 2, thinkingLevel: "high" },
    { provider: "openrouter", model: "fixture/xpremium", minTier: "xpremium", priority: 5 },
  ];
  c.kindMinimumTier.custom = "standard";
  c.taskKinds.custom = "Synthetic custom taxonomy";
  c.free = { enabled: true, policy: "prefer", pool: [{ provider: "freeprov", model: "fixture/free", thinkingLevel: "off" }] };
  return c;
}
function catalogue(c: JevRouterConfig): AvailableModel[] {
  const targets = [...Object.values(c.routes).flat(), ...Object.values(c.kindModels).flat(), ...c.free.pool];
  const unique = [...new Map(targets.map(t => [`${t.provider}/${t.model}`, t])).values()];
  return unique.map((t, i) => ({ provider: t.provider, id: t.model, reasoning: i % 2 === 0,
    cost: i % 3 === 0 ? undefined : { input: i + 1, output: (i + 1) * 4, cacheRead: 0.3, cacheWrite: i % 2 ? 0 : 3.75 } }));
}
function compare(a: RouteAnalysis, c: JevRouterConfig, o: DecideOptions) {
  // Resource namespaces differ, but both routers receive exactly these policy inputs.
  expect(decide(a, c, o)).toEqual(upstreamDecide(a, c, o));
}
function policy(c: JevRouterConfig) {
  const { stateFile: _state, ranking: { scoresFile: _scores, ...ranking }, ...rest } = c;
  return { ...rest, ranking };
}

test("default policy inputs and taxonomy remain exactly upstream, excluding mutable resource paths", () => {
  expect(policy(DEFAULT_CONFIG)).toEqual(policy(upstreamDefaults));
  expect(policy(loadConfig())).toEqual(policy(upstreamLoadConfig()));
});

for (const scenario of ["demand/reasoning", "confidence/floors", "budget", "specialist priority/minTier", "xpremium", "free prefer", "free fallback", "availability", "cache prices/context"] as const) {
  test(`full upstream decisions: ${scenario}`, () => {
    const c = config();
    c.free.enabled = scenario.startsWith("free");
    if (scenario === "free fallback") c.free.policy = "fallback-only";
    if (scenario === "specialist priority/minTier") c.kindModels.custom[0].priority = 9;
    const models = catalogue(c);
    const points = [0, 0.2, 0.21, 0.34, 0.64, 0.65, 0.7, 0.9, 1, 1.25, 1.3, 2, 2.49, 2.5, 3];
    for (let i = 0; i < points.length; i++) {
      const a = { ...baseAnalysis, complexity: points[i], budgetIntensity: points[points.length - 1 - i], deepReasoning: points[i] };
      const o: DecideOptions = { models, spend: { today: 1.2345, month: 9, pressure: 0 } };
      switch (scenario) {
        case "demand/reasoning": a.budgetIntensity = a.complexity; break;
        case "confidence/floors": a.kind = i % 2 ? "plan" : "custom"; a.kindConfidence = points[i]; break;
        case "budget": o.spend.pressure = points[i]; break;
        case "specialist priority/minTier": a.kind = "custom"; a.budgetIntensity = a.complexity; break;
        case "xpremium": a.complexity = a.budgetIntensity = 3; a.kindConfidence = points[i]; break;
        case "free prefer": a.kind = "implement"; break;
        case "free fallback": o.models = i % 2 ? models.filter(m => m.provider === "freeprov") : models; break;
        case "availability": o.models = models.filter((_, j) => j % (i + 2) === 0); break;
        case "cache prices/context": {
          const t = c.routes.standard[i % c.routes.standard.length];
          o.current = { index: 1, model: models.find(m => m.provider === t.provider && m.id === t.model) };
          o.contextTokens = [0, 1000, 100_000, 1_000_000, Number.NaN][i % 5];
          break;
        }
      }
      compare(a, c, o);
    }
  });
}

test("512 reproducible seeded full-decision combinations with exact providers", () => {
  let seed = 0x4a657630;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
  const boundary = [0, 0.2, 0.21, 0.64, 0.65, 1, 1.25, 1.3, 2, 2.49, 2.5, 3];
  for (let i = 0; i < 512; i++) {
    const c = config();
    c.free.enabled = next() > 0.5;
    c.free.policy = pick(["prefer", "fallback-only"]);
    c.cache.aware = next() > 0.25;
    c.cache.maxPenaltyUsd = pick([0, 0.05, 0.645, 1]);
    c.cache.deadband = pick([0, 0.25, 0.6]);
    if (next() < 0.5) c.routes.xpremium = [];
    c.kindModels.custom[0].priority = pick([-1, 0, 9]);
    c.kindModels.custom[0].minTier = pick(TIERS);
    const full = catalogue(c);
    const models = full.filter(() => next() > 0.25);
    const a = { ...baseAnalysis, kind: pick([...Object.keys(c.taskKinds), "unknown"]), complexity: pick(boundary), budgetIntensity: pick(boundary), deepReasoning: pick(boundary), kindConfidence: pick([0, 0.2, 0.34, 0.9]) };
    const tier = Math.floor(next() * TIERS.length);
    const t = c.routes[TIERS[tier]][0];
    const current = t && full.find(m => m.provider === t.provider && m.id === t.model);
    compare(a, c, { models, spend: { today: 1.2345, month: 9, pressure: pick([0, 0.69, 0.7, 0.89, 0.9, 1]) }, contextTokens: pick([0, 1000, 100_000, 1_000_000]), current: current ? { index: tier, model: current } : undefined });
  }
});

test("intentional provider difference: upstream substitutes an ID; child searches configured neighbours", () => {
  const c = config();
  c.free.enabled = false;
  c.kindModels = {};
  const requested: RouteTarget = c.routes.premium[0];
  const foreign: AvailableModel = { provider: "unconfigured", id: requested.model };
  const near = catalogue(c).find(m => m.id === c.routes.high[0].model)!;
  const a = { ...baseAnalysis, complexity: 3, budgetIntensity: 3, kindConfidence: 0 };
  const o = { models: [foreign, near], spend: { today: 0, month: 0, pressure: 0 } };
  expect(upstreamDecide(a, c, o)?.model).toBe(foreign);
  expect(decide(a, c, o)?.model).toBe(near);
  expect(decide(a, c, { ...o, models: [foreign] })).toBeUndefined();
});
