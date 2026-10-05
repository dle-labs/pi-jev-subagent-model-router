export type RaceEvent = {
  kind: "idle-snapshot" | "auth-blocked" | "execution-start" | "auth-released" |
    "mutation-observed" | "mutation-refused" | "execution-end";
  model?: string;
  idle?: boolean;
};

export type RaceAssessment = "mutated-during-execution" |
  "mutated-after-intervening-execution" | "no-race-observed";

export function assessRace(events: readonly RaceEvent[]): RaceAssessment {
  const index = (kind: RaceEvent["kind"]) => events.findIndex(event => event.kind === kind);
  const fail = () => { throw new Error("Incomplete or inconsistent race evidence"); };
  if (new Set(events.map(event => event.kind)).size !== events.length) fail();
  const snapshot = index("idle-snapshot"), blocked = index("auth-blocked");
  const released = index("auth-released"), changed = index("mutation-observed");
  const refused = index("mutation-refused"), started = index("execution-start"), ended = index("execution-end");
  const outcome = Math.max(changed, refused);
  if (snapshot !== 0 || events[0]?.idle !== true || !events[0]?.model ||
      blocked <= snapshot || released <= blocked || outcome <= released ||
      (changed >= 0) === (refused >= 0)) fail();
  if ((started < 0) !== (ended < 0) || (started >= 0 && (started <= blocked || ended <= started))) fail();
  if (started >= 0) {
    if (events[started].idle !== false || events[started].model !== events[0].model || events[ended].idle !== true) fail();
    const endModel = changed >= 0 && changed < ended ? events[changed].model : events[0].model;
    if (!endModel || events[ended].model !== endModel) fail();
  }
  if (refused >= 0) return "no-race-observed";
  const mutation = events[changed];
  if (!mutation.model || typeof mutation.idle !== "boolean") fail();
  const during = started >= 0 && started < changed && changed < ended;
  if (mutation.idle === during) fail();
  if (mutation.model === events[0].model || started < 0 || started > changed) return "no-race-observed";
  return during ? "mutated-during-execution" : "mutated-after-intervening-execution";
}
