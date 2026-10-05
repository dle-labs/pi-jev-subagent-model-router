import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Public host EventBus returns a callable unsubscriber (not an off method). */
export interface Bus extends Pick<ExtensionAPI["events"], "on" | "emit"> {}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A correlated compatibility handshake, never authentication or a launch. */
export function pingTintin(bus: Bus, signal?: AbortSignal, timeoutMs = 250): Promise<boolean> {
  if (signal?.aborted || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + timeoutMs;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const off = unsubscribe; unsubscribe = undefined;
      try { off?.(); } catch { /* Discovery failure cannot become a native error. */ }
    };
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true; cleanup(); resolve(ready);
    };
    const abort = () => finish(false);
    try {
      const requestId = randomUUID();
      unsubscribe = bus.on(`subagents:rpc:ping:reply:${requestId}`, reply => {
        try {
          finish(!signal?.aborted && performance.now() < deadline && object(reply) && reply.success === true && object(reply.data) && reply.data.version === 2);
        } catch { finish(false); }
      });
      if (settled) { cleanup(); return; }
      if (typeof unsubscribe !== "function") { finish(false); return; }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted || performance.now() >= deadline) { finish(false); return; }
      timer = setTimeout(abort, timeoutMs);
      bus.emit("subagents:rpc:ping", { requestId });
    } catch { finish(false); }
  });
}

export interface AgentSchemaStatus {
  compatible: boolean;
  reason: string;
  /** Serializable snapshot including schema/source metadata, not a signature. */
  fingerprint?: string;
  schedule?: boolean;
}

/** Validates the pinned native parameter contract exposed by getAllTools().
 * Thinking is a string (not a schema enum); schedule is registration-time opt-in.
 * Descriptions/source metadata are retained but cannot authenticate an extension.
 */
export function validateAgentSchema(tools: unknown): AgentSchemaStatus {
  try {
    if (!Array.isArray(tools)) return { compatible: false, reason: "tools-unavailable" };
    const agents = tools.filter(tool => object(tool) && tool.name === "Agent");
    if (agents.length !== 1) return { compatible: false, reason: "agent-missing-or-ambiguous" };
    const tool = agents[0];
    const schema = tool.parameters;
    if (typeof tool.description !== "string" || !object(schema) || schema.type !== "object" ||
        !object(schema.properties) || !Array.isArray(schema.required) ||
        !schema.required.every((key: unknown) => typeof key === "string")) return { compatible: false, reason: "agent-schema-malformed" };
    const required = schema.required as string[];
    const properties = schema.properties;
    for (const field of ["prompt", "description", "subagent_type"]) {
      if (!required.includes(field) || !object(properties[field]) || properties[field].type !== "string") return { compatible: false, reason: "agent-required-contract" };
    }
    for (const field of ["model", "thinking", "resume", "schedule"]) {
      if (field === "schedule" && !Object.hasOwn(properties, field)) continue;
      if (required.includes(field) || !object(properties[field]) || properties[field].type !== "string") return { compatible: false, reason: "agent-optional-contract" };
    }
    if (required.length !== 3 || new Set(required).size !== 3) return { compatible: false, reason: "agent-required-contract" };
    return { compatible: true, reason: "compatible", schedule: Object.hasOwn(properties, "schedule"), fingerprint: JSON.stringify(tool) };
  } catch { return { compatible: false, reason: "agent-schema-unavailable" }; }
}

export interface DiscoveryStatus {
  /** Monotonic runtime-local binding; equal fingerprints do not revive old epochs. */
  epoch: number;
  ready: boolean;
  reason: string;
  schema: AgentSchemaStatus;
}
/** Accepts the public host method; absent older-host capability degrades safely. */
export interface ToolCatalogue { getAllTools?: () => unknown }

/** One instance per router runtime, keyed by captured owner + generation.
 * No factory-time listeners/timers, global promise, polling, or launcher.
 * Success alone is cached; each eligible miss retries. Caller cancellation is
 * independent, while owner/generation/schema changes cancel all stale probes.
 */
export class TintinDiscovery {
  private owner: unknown;
  private generation: unknown;
  private fingerprint: string | undefined;
  private epoch = 0;
  private readonly pending = new Set<AbortController>();
  private readonly invalidationListeners = new Set<(epoch: number) => void>();
  private current: DiscoveryStatus = { epoch: 0, ready: false, reason: "not-discovered", schema: { compatible: false, reason: "not-inspected" } };

  constructor(private readonly bus: Bus, private readonly pi: ToolCatalogue) {}

  /** Synchronous notification after invalidation, never a discovery/reset request.
   * The callable unsubscriber is idempotent; subscriber exceptions are contained. */
  onInvalidation(listener: (epoch: number) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => { this.invalidationListeners.delete(listener); };
  }
  private inspect(): AgentSchemaStatus {
    try { return validateAgentSchema(this.pi.getAllTools?.()); }
    catch { return { compatible: false, reason: "tools-unavailable" }; }
  }
  private invalidate(schema: AgentSchemaStatus, reason: string): void {
    this.epoch++;
    this.fingerprint = schema.fingerprint;
    this.current = { epoch: this.epoch, ready: false, reason, schema };
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    for (const listener of [...this.invalidationListeners]) {
      try { listener(this.epoch); } catch { /* Observers cannot interfere with native execution. */ }
    }
  }
  get status(): DiscoveryStatus {
    const schema = this.inspect();
    if (!schema.compatible || schema.fingerprint !== this.fingerprint) this.invalidate(schema, "schema-changed");
    return { ...this.current, schema: { ...this.current.schema } };
  }
  /** Lifecycle shutdown/off/reload can invalidate without starting discovery. */
  reset(): void {
    this.invalidate({ compatible: false, reason: "not-inspected" }, "reset");
    this.owner = undefined; this.generation = undefined;
  }
  async discover(owner: unknown, generation: unknown, signal?: AbortSignal, timeoutMs = 250): Promise<DiscoveryStatus> {
    const schema = this.inspect();
    if (owner !== this.owner || generation !== this.generation || schema.fingerprint !== this.fingerprint || !schema.compatible) {
      this.owner = owner; this.generation = generation;
      this.invalidate(schema, schema.compatible ? "discovery-required" : schema.reason);
    }
    if (signal?.aborted) return { epoch: this.epoch, ready: false, reason: "cancelled", schema };
    if (!schema.compatible) return { epoch: this.epoch, ready: false, reason: schema.reason, schema };
    if (this.current.ready) return { ...this.current, schema: { ...schema } };
    const epoch = this.epoch;
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.pending.add(controller);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) controller.abort();
      const reply = await pingTintin(this.bus, controller.signal, timeoutMs);
      if (epoch !== this.epoch) return { epoch, ready: false, reason: "stale", schema };
      const latest = this.inspect();
      // The synchronous catalogue callback can invalidate and restore the schema.
      if (epoch !== this.epoch) return { epoch, ready: false, reason: "stale", schema };
      if (!latest.compatible || latest.fingerprint !== schema.fingerprint) {
        this.invalidate(latest, "schema-changed");
        return { epoch: this.epoch, ready: false, reason: "schema-changed", schema: latest };
      }
      const result = { epoch, ready: reply && !controller.signal.aborted, reason: controller.signal.aborted ? "cancelled" : reply ? "ready" : "ping-unavailable", schema: latest };
      // A cancelled/missed concurrent request must not erase another success.
      if (result.ready || !this.current.ready) this.current = result;
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.pending.delete(controller);
    }
  }
}
