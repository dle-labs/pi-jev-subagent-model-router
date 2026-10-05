import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export const managerKey = Symbol.for("pi-subagents:manager");
export interface KnownOwnership { owner: string; childId: string; toolCallId: string }
export type ObservedSession = Pick<AgentSession, "sessionId"> & {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
};
export interface PublicRecord {
  id: string; type: string; status: string; startedAt: number;
  toolUses: number; compactionCount: number;
  lifetimeUsage: { input: number; output: number; cacheWrite: number; cacheRead?: number; cost?: number };
  session?: ObservedSession; toolCallId?: string;
}
export const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
export const identity = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !["__proto__","constructor","prototype"].includes(value);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** Separate public shapes. No token conversion and no pooled toolResult reader. */
export function readLifetimeCost(usage: unknown): number | undefined { return object(usage) && nonnegative(usage.cost) ? usage.cost : undefined; }
export function readTerminalCost(usage: unknown): number | undefined { return object(usage) && object(usage.cost) && nonnegative(usage.cost.total) ? usage.cost.total : undefined; }
export type OwnedRecord = {kind:"owned";record:PublicRecord;session?:ObservedSession} | {kind:"unknown";reason:string};
/** An already established live association is mandatory. rootSessionId is lineage,
 * never authorization. This function does not search managers by display name. */
export function getOwnedRecord(owner: string, childId: string, knownOwnership: KnownOwnership | undefined,
  registry: unknown = (globalThis as any)[managerKey]): OwnedRecord {
  try {
    if (!identity(owner) || !identity(childId) || !knownOwnership || knownOwnership.owner !== owner ||
        knownOwnership.childId !== childId || !identity(knownOwnership.toolCallId)) return {kind:"unknown",reason:"ownership-unverified"};
    if (!object(registry) || typeof registry.getRecord !== "function") return {kind:"unknown",reason:"registry-unavailable"};
    const r: unknown = registry.getRecord(childId);
    if (r instanceof Promise) void r.catch(()=>{});
    if (!object(r) || r.id !== childId || !identity(r.type) ||
        !["queued","running","completed","steered","aborted","stopped","error"].includes(r.status) ||
        !nonnegative(r.startedAt) || !Number.isSafeInteger(r.toolUses) || r.toolUses < 0 ||
        !Number.isSafeInteger(r.compactionCount) || r.compactionCount < 0 || !object(r.lifetimeUsage) ||
        ![r.lifetimeUsage.input,r.lifetimeUsage.output,r.lifetimeUsage.cacheWrite].every(nonnegative) ||
        (r.lifetimeUsage.cacheRead !== undefined && !nonnegative(r.lifetimeUsage.cacheRead))) return {kind:"unknown",reason:"record-malformed"};
    // Invalid/missing money does NOT invalidate the record: it must persist gaps
    // without discarding a previous highwater. Ancestors already include descendants.
    if (r.parentAgentId !== undefined || r.workflowId !== undefined) return {kind:"unknown",reason:"owned-by-other-scope"};
    if (r.toolCallId !== undefined && r.toolCallId !== knownOwnership.toolCallId) return {kind:"unknown",reason:"call-correlation-conflict"};
    if (r.session !== undefined && (!object(r.session) || !identity(r.session.sessionId) || typeof r.session.subscribe !== "function")) return {kind:"unknown",reason:"session-malformed"};
    return {kind:"owned",record:r as PublicRecord,session:r.session};
  } catch { return {kind:"unknown",reason:"registry-read-failed"}; }
}
