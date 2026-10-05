import { describe, expect, test } from "bun:test";
import { omitted } from "../src/contracts";
import { DEFAULT_CONFIG } from "../src/core/config";
import { FakeBus } from "./support/bus";
import { agentInput, analysis, config } from "./support/fixtures";

describe("omitted", () => {
  test("missing and explicit undefined fields are omitted", () => {
    expect(omitted({}, "model")).toBe(true);
    expect(omitted({ model: undefined }, "model")).toBe(true);
  });

  test("explicit null, false, empty string, zero and thinking off are preserved", () => {
    for (const value of [null, false, "", 0, "off"]) {
      expect(omitted({ thinking: value }, "thinking")).toBe(false);
    }
  });
});

describe("fresh fixtures", () => {
  test("config deeply clones defaults without sharing nested values", () => {
    const first = config();
    const second = config();
    expect(first).toEqual(DEFAULT_CONFIG);
    expect(second).toEqual(DEFAULT_CONFIG);
    first.routes.quick[0].model = "changed";
    first.kindModels.implement[0].model = "changed";
    first.kindMinimumTier.implement = "quick";
    first.taskKinds.implement = "changed";
    first.budget.softRatio = 0;
    first.cache.deadband = 0;
    first.free.pool.push({ provider: "test", model: "free" });
    first.ranking.cutoffs.standard = 0;
    expect(second).toEqual(DEFAULT_CONFIG);
    expect(config()).toEqual(DEFAULT_CONFIG);
    expect(first.routes.quick[0]).not.toBe(DEFAULT_CONFIG.routes.quick[0]);
    expect(second.ranking.cutoffs).not.toBe(DEFAULT_CONFIG.ranking.cutoffs);
  });

  test("analysis defaults and probability maps are fresh", () => {
    const first = analysis();
    const second = analysis();
    expect(second).toEqual({
      kind: "implement",
      kindConfidence: 0.9,
      kindProbabilities: { implement: 0.9 },
      complexity: 2,
      complexityConfidence: 0.9,
      budgetIntensity: 2,
      budgetIntensityConfidence: 0.9,
      deepReasoning: 0.8,
      latencyMs: 1,
    });
    first.kind = "debug";
    first.kindProbabilities.implement = 0;
    expect(second.kind).toBe("implement");
    expect(second.kindProbabilities).toEqual({ implement: 0.9 });
    expect(analysis().kindProbabilities).toEqual({ implement: 0.9 });
  });

  test("analysis patches override defaults", () => {
    expect(analysis({ kind: "debug", complexity: 3, kindProbabilities: { debug: 1 } })).toEqual({
      ...analysis(), kind: "debug", complexity: 3, kindProbabilities: { debug: 1 },
    });
  });

  test("agent inputs are independent fresh records", () => {
    const first = agentInput();
    const second = agentInput();
    expect(second).toEqual({
      prompt: "Implement a safe parser", description: "Parser task", subagent_type: "worker",
    });
    first.prompt = "changed";
    expect(second.prompt).toBe("Implement a safe parser");
    expect(agentInput()).toEqual(second);
    expect(first).not.toBe(second);
  });
});

describe("FakeBus", () => {
  test("registration before emit catches an immediate synchronous reply", () => {
    const bus = new FakeBus();
    const replies: unknown[] = [];
    bus.on("request", (payload) => bus.emit("reply", payload));
    const unsubscribe = bus.on("reply", (payload) => replies.push(payload));
    const payload = { id: "request-1" };
    bus.emit("request", payload);
    expect(replies).toEqual([payload]);
    expect(replies[0]).toBe(payload);
    unsubscribe();
    expect(bus.count()).toBe(1);
  });

  test("unsubscribe is idempotent, removes empty sets and permits reuse", () => {
    const bus = new FakeBus();
    const seen: unknown[] = [];
    const unsubscribe = bus.on("event", (payload) => seen.push(payload));
    const removeOther = bus.on("other", () => {});
    expect(bus.count()).toBe(2);
    unsubscribe();
    unsubscribe();
    expect(bus.count()).toBe(1);
    bus.emit("event", "removed");
    expect(seen).toEqual([]);
    const removeNew = bus.on("event", (payload) => seen.push(payload));
    bus.emit("event", "new");
    expect(seen).toEqual(["new"]);
    removeNew();
    removeOther();
    expect(bus.count()).toBe(0);
    expect(bus.listeners.size).toBe(0);
    bus.emit("missing", "ignored");
    expect(bus.listeners.size).toBe(0);
  });

  test("emit snapshots listeners despite registration and removal during delivery", () => {
    const bus = new FakeBus();
    const seen: string[] = [];
    const late = () => { seen.push("late"); };
    let removeSecond = () => {};
    bus.on("event", () => {
      seen.push("first");
      removeSecond();
      bus.on("event", late);
    });
    removeSecond = bus.on("event", () => { seen.push("second"); });
    bus.emit("event", undefined);
    expect(seen).toEqual(["first", "second"]);
    bus.emit("event", undefined);
    expect(seen).toEqual(["first", "second", "first", "late"]);
    expect(bus.count()).toBe(2);
  });

  test("instances do not share listeners", () => {
    const first = new FakeBus();
    const second = new FakeBus();
    const seen: unknown[] = [];
    first.on("event", (payload) => seen.push(payload));
    second.emit("event", "isolated");
    expect(second.count()).toBe(0);
    expect(first.count()).toBe(1);
    expect(seen).toEqual([]);
  });
});
