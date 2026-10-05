import { expect, test } from "bun:test";
import { chooseDefaults, defaultsFor, cheaperDecision } from "../../src/routing/modes";
import { decide } from "../../src/core/router";
import { analysis, config } from "../support/fixtures";
function setup() {
  const c = config(); c.kindModels = {}; c.routes = { quick: [{ provider: "p", model: "cheap", thinkingLevel: "off" }], standard: [], high: [], premium: [{ provider: "p", model: "selected", thinkingLevel: "high" }], xpremium: [] };
  const models = [{ provider: "p", id: "selected" }, { provider: "p", id: "cheap" }];
  const proposal = { analysis: analysis(), decision: decide(analysis(), c, { models, spend: { today: 0, month: 0, pressure: 0 } })! };
  return { c, models, proposal };
}
test("defaults are exact identities, thinking pins only, no invented tier thinking", () => {
  const { proposal } = setup(); expect(defaultsFor(proposal.decision)).toEqual({ model: "p/selected", thinking: "high" });
  delete proposal.decision.target.thinkingLevel; expect(defaultsFor(proposal.decision)).toEqual({ model: "p/selected" });
  expect(defaultsFor(undefined)).toEqual({});
});
test("cheaper skips empty/unavailable chains, preserves cheap config pin and immutable decision metadata", () => {
  const { c, models, proposal } = setup(); const before = JSON.stringify(proposal);
  const cheap = cheaperDecision(proposal.decision, c, models)!;
  expect(cheap.tier).toBe("quick"); expect(cheap.tierIndex).toBe(0); expect(cheap.kindSpecialised).toBe(false); expect(cheap.downgraded).toBe(true);
  expect(defaultsFor(cheap)).toEqual({ model: "p/cheap", thinking: "off" }); expect(JSON.stringify(proposal)).toBe(before);
  expect(cheaperDecision(proposal.decision, c, [models[0]])).toBeUndefined();
});
test("auto, notify and noninteractive confirm fallback", async () => {
  const { c, models, proposal } = setup();
  expect((await chooseDefaults("auto", proposal, c, models)).defaults.model).toBe("p/selected");
  expect((await chooseDefaults("notify", proposal, c, models)).defaults).toEqual({});
  expect(await chooseDefaults("confirm", proposal, c, models)).toMatchObject({ defaults: { model: "p/selected" }, reason: "confirm-unavailable-auto" });
});
test("confirm exposes selected, validated cheaper and keep; only returned offered labels apply", async () => {
  const { c, models, proposal } = setup(); let options: string[] = [];
  const ui = { select: async (_title: string, choices: string[]) => { options = choices; return choices[1]; } };
  expect((await chooseDefaults("confirm", proposal, c, models, ui)).defaults).toEqual({ model: "p/cheap", thinking: "off" }); expect(options).toHaveLength(3);
  for (const choice of [undefined, "Keep native defaults", "not offered"]) {
    expect((await chooseDefaults("confirm", proposal, c, models, { select: async () => choice })).defaults).toEqual({});
  }
  await chooseDefaults("confirm", proposal, c, [models[0]], ui); expect(options).toHaveLength(2);
});
test("UI errors, no valid model and abort after dialog never apply", async () => {
  const { c, models, proposal } = setup(); const ctrl = new AbortController();
  expect((await chooseDefaults("confirm", proposal, c, models, { select: async () => { throw Error("secret"); } })).reason).toBe("confirmation-failed");
  expect((await chooseDefaults("confirm", proposal, c, [], { select: async () => { throw Error("must not call"); } })).defaults).toEqual({});
  expect((await chooseDefaults("confirm", proposal, c, models, { select: async (_t, opts) => { ctrl.abort(); return opts[0]; } }, ctrl.signal)).defaults).toEqual({});
});
