import { expect, test } from "bun:test";
import { FakeBus } from "../support/bus";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { pingTintin, validateAgentSchema, TintinDiscovery } from "../../src/tintin/discovery";

function tool(schedule = true) {
  return { name: "Agent", description: "Native agent", parameters: { type: "object", required: ["prompt", "description", "subagent_type"], properties: Object.fromEntries(["prompt", "description", "subagent_type", "model", "thinking", "resume", ...(schedule ? ["schedule"] : [])].map(k => [k, { type: "string" }])) } };
}
function answering(reply: unknown = { success: true, data: { version: 2 } }) {
  const bus = new FakeBus();
  const ids: string[] = [];
  bus.on("subagents:rpc:ping", data => { const { requestId } = data as { requestId: string }; ids.push(requestId); bus.emit(`subagents:rpc:ping:reply:${requestId}`, reply); });
  return { bus, ids };
}
test("immediate replies subscribe first, use unique UUID channels and clean up", async () => {
  const { bus, ids } = answering();
  expect(await pingTintin(bus, undefined, 20)).toBe(true);
  expect(await pingTintin(bus, undefined, 20)).toBe(true);
  expect(new Set(ids).size).toBe(2);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(bus.count()).toBe(1);
});
for (const reply of [null, {}, { success: false }, { success: 1, data: { version: 2 } }, { success: true, data: { version: "2" } }, { success: true, data: { version: 3 } }]) {
  test(`malformed/version/error reply fails open: ${JSON.stringify(reply)}`, async () => {
    const { bus } = answering(reply); expect(await pingTintin(bus, undefined, 20)).toBe(false); expect(bus.count()).toBe(1);
  });
}
test("timeout, already aborted and emit/subscribe failures are bounded false", async () => {
  const bus = new FakeBus(); expect(await pingTintin(bus, undefined, 2)).toBe(false); expect(bus.count()).toBe(0);
  const controller = new AbortController(); controller.abort();
  expect(await pingTintin(bus, controller.signal, 20)).toBe(false); expect(bus.count()).toBe(0);
  expect(await pingTintin({ on() { throw Error("private"); }, emit() {} }, undefined, 20)).toBe(false);
  expect(await pingTintin({ on: bus.on.bind(bus), emit() { throw Error("private"); } }, undefined, 20)).toBe(false); expect(bus.count()).toBe(0);
  for (const n of [NaN, Infinity, 0, -1, 2 ** 32]) expect(await pingTintin(bus, undefined, n)).toBe(false);
});
test("concurrent requests cancel independently, late replies do not leak", async () => {
  const bus = new FakeBus(); const requests: string[] = [];
  bus.on("subagents:rpc:ping", p => requests.push((p as { requestId: string }).requestId));
  const c = new AbortController(); const a = pingTintin(bus, c.signal, 50); const b = pingTintin(bus, undefined, 50);
  c.abort(); bus.emit(`subagents:rpc:ping:reply:${requests[1]}`, { success: true, data: { version: 2 } });
  expect(await a).toBe(false); expect(await b).toBe(true);
  bus.emit(`subagents:rpc:ping:reply:${requests[0]}`, { success: true, data: { version: 2 } }); expect(bus.count()).toBe(1);
});
test("schema checks required strings and optional native string fields, schedule may be absent", () => {
  expect(validateAgentSchema([tool()]).compatible).toBe(true); expect(validateAgentSchema([tool(false)]).compatible).toBe(true);
  expect(validateAgentSchema([{ name: "Agent" }]).compatible).toBe(false);
  for (const k of ["prompt", "description", "subagent_type", "model", "thinking", "resume", "schedule"]) {
    const t = tool(); t.parameters.properties[k] = { type: "number" }; expect(validateAgentSchema([t]).compatible).toBe(false);
  }
  const t = tool(); t.parameters.required.push("model"); expect(validateAgentSchema([t]).compatible).toBe(false);
  expect(validateAgentSchema([tool(), tool()]).compatible).toBe(false);
});
test("public discovery epochs bind ready results and increase across schema restoration and lifecycle changes", async () => {
  const { bus, ids } = answering(); let tools = [tool()];
  const d = new TintinDiscovery(bus, { getAllTools: () => tools }); const epochs: number[] = [];
  const off = d.onInvalidation(epoch => epochs.push(epoch));
  const first = await d.discover("owner", 1); expect(first.ready).toBe(true);
  expect(d.status.epoch).toBe(first.epoch);
  expect((await d.discover("owner", 1)).epoch).toBe(first.epoch); expect(ids).toHaveLength(1);
  expect(epochs).toEqual([first.epoch]);
  tools = [{ ...tool(), description: "Replacement" }];
  expect(d.status.ready).toBe(false); const changed = await d.discover("owner", 1);
  tools = [tool()]; const restored = await d.discover("owner", 1);
  expect(restored.schema.fingerprint).toBe(first.schema.fingerprint);
  expect(changed.epoch).toBeGreaterThan(first.epoch); expect(restored.epoch).toBeGreaterThan(changed.epoch);
  const generation = await d.discover("owner", 2), owner = await d.discover("new", 2);
  expect(generation.epoch).toBeGreaterThan(restored.epoch); expect(owner.epoch).toBeGreaterThan(generation.epoch);
  d.reset(); expect(epochs.at(-1)!).toBeGreaterThan(owner.epoch);
  off(); off(); const count = epochs.length; d.reset(); expect(epochs).toHaveLength(count);
  expect(bus.count()).toBe(1);
});
test("invalidation subscriber errors are contained and pending probes clean up before current rediscovery", async () => {
  const bus = new FakeBus(); const requests: string[] = [];
  bus.on("subagents:rpc:ping", p => requests.push((p as { requestId: string }).requestId));
  let tools = [tool()]; const d = new TintinDiscovery(bus, { getAllTools: () => tools });
  const epochs: number[] = []; const bad = d.onInvalidation(() => { throw Error("subscriber failure"); });
  const off = d.onInvalidation(epoch => epochs.push(epoch));
  const old = d.discover("owner", 1, undefined, 100);
  tools = [{ ...tool(), description: "Replacement" }]; const current = d.discover("owner", 1, undefined, 100);
  expect(bus.count()).toBe(2); expect((await old).reason).toBe("stale");
  bus.emit(`subagents:rpc:ping:reply:${requests[1]}`, { success: true, data: { version: 2 } });
  const ready = await current; expect(ready.ready).toBe(true); expect(ready.epoch).toBe(epochs.at(-1)!);
  expect(bus.count()).toBe(1); bad(); off(); d.reset(); expect(epochs).toHaveLength(2);
});
test("coordinator is lazy; retries misses; validates schema and invalidates owner/generation", async () => {
  const { bus, ids } = answering(); let tools: unknown = []; const owner = {};
  const discovery = new TintinDiscovery(bus, { getAllTools: () => tools }); expect(ids).toHaveLength(0);
  expect((await discovery.discover(owner, 1, undefined, 20)).ready).toBe(false);
  tools = [tool()]; expect((await discovery.discover(owner, 1, undefined, 20)).ready).toBe(true);
  const count = ids.length; expect((await discovery.discover(owner, 1, undefined, 20)).ready).toBe(true); expect(ids.length).toBe(count);
  expect((await discovery.discover(owner, 2, undefined, 20)).ready).toBe(true); expect(ids.length).toBe(count + 1);
  expect((await discovery.discover({}, 2, undefined, 20)).ready).toBe(true); expect(ids.length).toBe(count + 2);
  tools = [{ name: "Agent" }]; const bad = await discovery.discover(owner, 2, undefined, 20); expect(bad.ready).toBe(false); expect(bad.schema.compatible).toBe(false);
});
test("schema mutation and stale replies cannot publish current readiness", async () => {
  const bus = new FakeBus(); const requests: string[] = []; bus.on("subagents:rpc:ping", p => requests.push((p as { requestId: string }).requestId));
  const tools = [tool()]; const d = new TintinDiscovery(bus, { getAllTools: () => tools }); const owner = {};
  const old = d.discover(owner, 1, undefined, 100); const current = d.discover(owner, 2, undefined, 100);
  bus.emit(`subagents:rpc:ping:reply:${requests[0]}`, { success: true, data: { version: 2 } }); expect((await old).reason).toBe("stale");
  tools[0].parameters.properties.model = { type: "number" };
  bus.emit(`subagents:rpc:ping:reply:${requests[1]}`, { success: true, data: { version: 2 } }); expect((await current).ready).toBe(false); expect(d.status.ready).toBe(false); expect(bus.count()).toBe(1);
});
test("public host EventBus callable unsubscriber contract", async () => {
  const bus = createEventBus();
  const off = bus.on("subagents:rpc:ping", p => bus.emit(`subagents:rpc:ping:reply:${(p as { requestId: string }).requestId}`, { success: true, data: { version: 2 } }));
  expect(await pingTintin(bus, undefined, 20)).toBe(true); off(); expect(await pingTintin(bus, undefined, 2)).toBe(false); bus.clear();
});
test("ping misses retry and pending coordinator probes cancel independently", async () => {
  const bus = new FakeBus(); const d = new TintinDiscovery(bus, { getAllTools: () => [tool()] }); const owner = {};
  expect((await d.discover(owner, 1, undefined, 2)).ready).toBe(false);
  const requests: string[] = []; bus.on("subagents:rpc:ping", p => requests.push((p as { requestId: string }).requestId));
  const c = new AbortController(); const a = d.discover(owner, 1, c.signal, 50); const b = d.discover(owner, 1, undefined, 50); c.abort();
  expect((await a).reason).toBe("cancelled"); bus.emit(`subagents:rpc:ping:reply:${requests[1]}`, { success: true, data: { version: 2 } });
  expect((await b).ready).toBe(true); expect(d.status.ready).toBe(true); expect(bus.count()).toBe(1);
});
test("unavailable/throwing host catalogue and reset degrade safely", async () => {
  for (const pi of [{}, { getAllTools() { throw Error("private"); } }]) {
    const bus = new FakeBus(); expect((await new TintinDiscovery(bus, pi).discover({}, 1, undefined, 2)).ready).toBe(false); expect(bus.count()).toBe(0);
  }
  const bus = new FakeBus(); const d = new TintinDiscovery(bus, { getAllTools: () => [tool()] }); const pending = d.discover({}, 1, undefined, 50);
  d.reset(); expect((await pending).reason).toBe("stale"); expect(d.status.ready).toBe(false); expect(bus.count()).toBe(0);
});
test("concurrent coordinator cancellation does not poison another call or cached success", async () => {
  const { bus } = answering(); const d = new TintinDiscovery(bus, { getAllTools: () => [tool()] }); const owner = {};
  const c = new AbortController(); c.abort();
  const [a, b] = await Promise.all([d.discover(owner, 1, c.signal, 20), d.discover(owner, 1, undefined, 20)]);
  expect(a.ready).toBe(false); expect(b.ready).toBe(true); expect(d.status.ready).toBe(true); expect(bus.count()).toBe(1);
});
