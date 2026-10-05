import { expect, test } from "bun:test";
import { assessRace, type RaceEvent } from "../../scripts/probe/race-evidence";

const trace: RaceEvent[] = [
  { kind: "idle-snapshot", model: "before", idle: true },
  { kind: "auth-blocked" },
  { kind: "execution-start", model: "before", idle: false },
  { kind: "auth-released" },
  { kind: "mutation-observed", model: "after", idle: false },
  { kind: "execution-end", model: "after", idle: true },
];

test("recognizes mutation during execution after deferred authentication", () => {
  expect(assessRace(trace)).toBe("mutated-during-execution");
});
test("recognizes intervening completed execution (idle ABA)", () => {
  expect(assessRace([
    ...trace.slice(0, 3),
    { kind: "execution-end", model: "before", idle: true },
    trace[3],
    { kind: "mutation-observed", model: "after", idle: true },
  ])).toBe("mutated-after-intervening-execution");
});
test("an ordinary idle mutation is not evidence of a race", () => {
  expect(assessRace([trace[0], trace[1], trace[3], { kind: "mutation-observed", model: "after", idle: true }]))
    .toBe("no-race-observed");
});
test("refused mutation is not evidence of a race", () => {
  expect(assessRace([trace[0], trace[1], trace[2], trace[3], { kind: "mutation-refused" }, { kind: "execution-end", model: "before", idle: true }]))
    .toBe("no-race-observed");
});
test("contradictory execution observations are rejected", () => {
  for (const bad of [
    trace.map(e => e.kind === "execution-start" ? { ...e, idle: true } : e),
    trace.map(e => e.kind === "execution-start" ? { ...e, model: "after" } : e),
    trace.map(e => e.kind === "execution-end" ? { ...e, idle: false } : e),
    trace.map(e => e.kind === "execution-end" ? { ...e, model: "before" } : e),
  ]) expect(() => assessRace(bad)).toThrow();
});

test("malformed or incomplete evidence is rejected, not reported as safe", () => {
  expect(() => assessRace([])).toThrow();
  expect(() => assessRace([trace[0], trace[1]])).toThrow();
  expect(() => assessRace([trace[0], trace[4], trace[1], trace[3]])).toThrow();
});
