import { omitted, type DecisionEntry, type RoutingSnapshot, type TaskSnapshot, type Proposal } from "../contracts";
import type { JevRouterConfig, Mode } from "../core/config";
import type { AvailableModel } from "../core/router";
import { findModel } from "../core/router";
import type { SpendSnapshot } from "../core/budget";
import type { ConfigurationContext } from "../configuration";
import { TintinDiscovery, type Bus, type ToolCatalogue } from "../tintin/discovery";
import { filterExactScope, resolveSettingsScope, type ResolvedScope } from "../tintin/scope";
import { createEngine, type EngineServices } from "./engine";
import { chooseDefaults, type Defaults, type SelectUI } from "./modes";

export function eligible(toolName: string, input: Record<string, unknown>): boolean {
  return toolName === "Agent" && typeof input.prompt === "string" && input.prompt.trim().length > 0 &&
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 &&
    !input.resume && !input.schedule && (omitted(input, "model") || omitted(input, "thinking"));
}
export function applyDefaults(input: Record<string, unknown>, defaults: Defaults,
  captured: { owner: string; generation: number }, current: { owner: string; generation: number; enabled: boolean }, signal?: AbortSignal): boolean {
  if (signal?.aborted || !current.enabled || captured.owner !== current.owner || captured.generation !== current.generation) return false;
  let changed = false;
  for (const field of ["model", "thinking"] as const) {
    if (omitted(input, field) && defaults[field] !== undefined) { input[field] = defaults[field]; changed = true; }
  }
  return changed;
}

export interface NativeCall { toolName: string; toolCallId: string; input: Record<string, unknown> }
/** Supplied by future lifecycle wiring; signal is the host session operation,
 * NOT an exact independently cancellable native tool-call signal. */
export interface LaunchContext extends ConfigurationContext {
  owner: string;
  signal?: AbortSignal;
  modelRegistry: unknown;
  spend: SpendSnapshot;
  ui?: SelectUI;
}
export interface LaunchServices extends EngineServices {
  owner: string;
  config: JevRouterConfig;
  bus: Bus;
  catalogue: ToolCatalogue;
  scope?: (context: ConfigurationContext, registry: unknown) => Promise<ResolvedScope>;
  audit?: (entry: DecisionEntry) => void | Promise<void>;
  warning?: (code: string) => void | Promise<void>;
}
export interface HookOutcome {
  changed: boolean;
  reason: string;
  proposal?: Proposal;
  scope?: ResolvedScope["kind"];
  scopeReason?: string;
  degraded: string[];
}

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** The public available view is authoritative, including empty. getAll is only
 * a fallback with public hasConfiguredAuth validation; never an auth assertion. */
function authenticatedModels(registry: unknown): { models: AvailableModel[]; reason?: string } {
  try {
    if (!object(registry)) return { models: [], reason: "registry-unavailable" };
    let models: unknown;
    if (typeof registry.getAvailable === "function") models = registry.getAvailable.call(registry);
    else {
      if (registry.getAvailable !== undefined || typeof registry.getAll !== "function" || typeof registry.hasConfiguredAuth !== "function") return { models: [], reason: "authentication-unavailable" };
      const all: unknown = registry.getAll.call(registry);
      if (all instanceof Promise) void all.catch(() => {});
      if (!Array.isArray(all)) return { models: [], reason: "registry-malformed" };
      const validate = registry.hasConfiguredAuth;
      models = all.filter(m => {
        const authenticated: unknown = validate.call(registry, m);
        if (authenticated instanceof Promise) void authenticated.catch(() => {});
        return authenticated === true;
      });
    }
    if (models instanceof Promise) void models.catch(() => {});
    if (!Array.isArray(models) || !models.every(m => object(m) && typeof m.provider === "string" && m.provider.trim() && typeof m.id === "string" && m.id.trim())) return { models: [], reason: "registry-malformed" };
    // Snapshot only policy data; no auth material or native model methods.
    return { models: models.map(m => ({ provider: m.provider, id: m.id, ...(typeof m.name === "string" ? { name: m.name } : {}), ...(typeof m.reasoning === "boolean" ? { reasoning: m.reasoning } : {}), ...(object(m.cost) ? { cost: { input: m.cost.input as number, output: m.cost.output as number, cacheRead: m.cost.cacheRead as number, cacheWrite: m.cost.cacheWrite as number } } : {}) })) };
  } catch { return { models: [], reason: "authentication-read-failed" }; }
}

/** Observe loser outcomes too; extension cancellation never starts native work. */
function pending<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Error("cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(value => { signal.removeEventListener("abort", abort); signal.aborted ? reject(new Error("cancelled")) : resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Runtime-local, lazy hook coordinator. Contains no launcher or session setter.
 * Config reload, mode/enable/owner replacement and dispose invalidate ALL calls.
 * No task history is retained; later Task 11 may add bounded memory retention. */
export class LaunchRouter {
  private owner: string;
  private generation = 0;
  private config: JevRouterConfig;
  private disposed = false;
  // Undefined bindings are still discovering and must survive the invalidation
  // that their own discovery observes. Only older completed bindings are aborted.
  private readonly controllers = new Map<AbortController, number | undefined>();
  private readonly discovery: TintinDiscovery;
  private readonly unsubscribeDiscovery: () => void;
  private readonly engine;
  private readonly scope;

  constructor(private readonly services: LaunchServices) {
    this.owner = services.owner;
    this.config = structuredClone(services.config);
    this.discovery = new TintinDiscovery(services.bus, services.catalogue);
    this.unsubscribeDiscovery = this.discovery.onInvalidation(epoch => {
      for (const [controller, bound] of this.controllers) {
        if (bound !== undefined && bound < epoch) controller.abort();
      }
    });
    this.engine = createEngine({ classify: services.classify, recordUsage: services.recordUsage });
    this.scope = services.scope ?? resolveSettingsScope;
  }
  get snapshot(): RoutingSnapshot { return { owner: this.owner, generation: this.generation, config: structuredClone(this.config) }; }
  update(change: { owner?: string; config?: JevRouterConfig; enabled?: boolean; mode?: Mode }): void {
    // Prepare a reload before modifying current state so a bad clone can't leave
    // an unversioned partial replacement.
    const config = change.config ? structuredClone(change.config) : structuredClone(this.config);
    if (change.enabled !== undefined) config.enabled = change.enabled;
    if (change.mode !== undefined) config.mode = change.mode;
    this.generation++;
    for (const c of this.controllers.keys()) c.abort();
    this.controllers.clear();
    this.discovery.reset();
    this.owner = change.owner ?? this.owner;
    this.config = config;
  }
  dispose(): void {
    this.unsubscribeDiscovery();
    this.update({ enabled: false });
    this.disposed = true;
  }
  private active(captured: RoutingSnapshot, signal: AbortSignal): boolean {
    return !signal.aborted && !this.disposed && this.config.enabled && captured.owner === this.owner && captured.generation === this.generation && captured.config.mode === this.config.mode;
  }

  async handle(event: NativeCall, context: LaunchContext): Promise<HookOutcome> {
    const result: HookOutcome = { changed: false, reason: "ineligible", degraded: [] };
    // The service is called from a hook: input is mutated in place and the host
    // proceeds through its existing execution path only after this returns.
    if (!eligible(event.toolName, event.input)) return result;
    const captured = this.snapshot;
    if (this.disposed || !captured.config.enabled || context.owner !== captured.owner || context.signal?.aborted) { result.reason = "inactive"; return result; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.controllers.set(controller, undefined);
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
    const signal = controller.signal;
    const task: TaskSnapshot = { owner: captured.owner, generation: captured.generation, toolCallId: event.toolCallId, prompt: event.input.prompt as string, agent: event.input.subagent_type as string, original: Object.freeze({ ...event.input }) };
    const spend = { ...context.spend };
    const scopeContext: ConfigurationContext = { cwd: context.cwd, isProjectTrusted: context.isProjectTrusted };
    const fresh = async () => {
      // resolveSettingsScope sees the FULL backend registry universe, before
      // scope/auth intersection and before policy route chains are consulted.
      const scope = await pending(this.scope(scopeContext, context.modelRegistry), signal);
      if (!this.active(captured, signal)) throw new Error("stale");
      const auth = authenticatedModels(context.modelRegistry);
      const models = filterExactScope(auth.models, scope);
      result.scope = scope.kind;
      const safeScopeReasons = ["trust-unavailable", "project-scope-untrusted", "project-path-unavailable", "trust-changed", "registry-unavailable", "registry-malformed", "registry-read-failed", "scope-read-failed"];
      result.scopeReason = scope.kind === "unknown" ? safeScopeReasons.includes(scope.reason) ? scope.reason : "scope-unavailable" : undefined;
      return { scope, models, authReason: auth.reason };
    };
    try {
      const discovered = await pending(this.discovery.discover(captured.owner, captured.generation, signal), signal);
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      if (!discovered.ready) { result.reason = "tintin-unavailable"; return result; }
      const discoveryEpoch = discovered.epoch;
      this.controllers.set(controller, discoveryEpoch);
      // Discovery may have been invalidated between its completion and our await.
      if (this.discovery.status.epoch !== discoveryEpoch) controller.abort();
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      const pool = await fresh();
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      if (pool.scope.kind === "unknown") { result.reason = "scope-unknown"; return result; }
      if (pool.authReason) { result.reason = pool.authReason; return result; }
      const proposal = await pending(this.engine(task, captured, pool.models, spend, signal), signal);
      result.proposal = proposal;
      result.degraded.push(...(proposal.degraded ?? []));
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      if (!proposal.decision) { result.reason = proposal.reason === "no-permitted-candidate" && pool.scope.kind === "restricted" ? "restricted-empty" : proposal.reason ?? "no-permitted-candidate"; return result; }
      const beforeUI = await fresh();
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      const beforeUISchema = this.discovery.status;
      if (beforeUISchema.epoch !== discoveryEpoch || !beforeUISchema.ready || beforeUI.authReason || beforeUI.scope.kind === "unknown" || !findModel(beforeUI.models, proposal.decision.target)) { result.reason = "candidate-invalidated"; return result; }
      const choice = await pending(chooseDefaults(captured.config.mode, proposal, captured.config, beforeUI.models, context.ui, signal), signal);
      result.degraded.push(...(choice.degraded ?? []));
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      result.reason = choice.reason;
      if (!choice.decision || choice.defaults.model === undefined) return result;
      const final = await fresh();
      if (!this.active(captured, signal)) { result.reason = "stale"; return result; }
      const finalSchema = this.discovery.status;
      if (finalSchema.epoch !== discoveryEpoch || !finalSchema.ready || final.authReason || final.scope.kind === "unknown" || !findModel(final.models, choice.decision.target)) { result.reason = "candidate-invalidated"; return result; }
      // No await between the final auth/scope/schema/version check and mutation.
      // Another handler may already have filled either field independently.
      result.changed = applyDefaults(event.input, choice.defaults, captured, { owner: this.owner, generation: this.generation, enabled: this.config.enabled }, signal);
      result.proposal = { ...proposal, decision: choice.decision };
      if (!result.changed) result.reason = "preserved";
      return result;
    } catch {
      result.reason = signal.aborted || !this.active(captured, signal) ? "cancelled-or-stale" : "routing-failed";
      return result;
    } finally {
      context.signal?.removeEventListener("abort", abort);
      this.controllers.delete(controller);
      // These callbacks receive no raw task, native options, credentials or
      // parent context. Failures never turn this hook into a native tool error.
      const action: DecisionEntry["action"] = result.changed ? "proposed" : result.reason === "notify" ? "notified" : result.reason === "keep" || result.reason === "preserved" ? "preserved" : "skipped";
      try { await this.services.audit?.({ version: 1, owner: captured.owner, toolCallId: task.toolCallId, action, reason: `${result.reason}${result.scope ? ` · scope ${result.scope}${result.scopeReason ? `:${result.scopeReason}` : ""}` : ""}`, analysis: structuredClone(result.proposal?.analysis), decision: structuredClone(result.proposal?.decision) }); }
      catch { result.degraded.push("audit-callback-failed"); }
      if (["tintin-unavailable", "scope-unknown", "authentication-unavailable", "authentication-read-failed", "registry-unavailable", "registry-malformed", "routing-failed", "missing-api-key", "classification-failed"].includes(result.reason)) {
        try { await this.services.warning?.(result.reason); }
        catch { result.degraded.push("warning-callback-failed"); }
      }
    }
  }
}
