import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { JevRouterConfig, ThinkingLevel } from "./core/config";
import type { RouteAnalysis } from "./core/jev";
import type { Decision } from "./core/router";

export const omitted = (input: Record<string, unknown>, field: string) => input[field] === undefined;

export interface TaskSnapshot {
  owner: string;
  toolCallId: string;
  generation: number;
  prompt: string;
  agent: string;
  original: Readonly<Record<string, unknown>>;
}

export interface Proposal {
  /** Absent on missing-key, cancellation, or classifier failure; never fabricated. */
  analysis?: RouteAnalysis;
  decision?: Decision;
  reason?: string;
  /** Static failure codes only; no raw transport/task/credential messages. */
  degraded?: string[];
}

export interface ModelSnapshot {
  model: Model<Api>;
  thinking: ThinkingLevel;
}

/** Immutable launch ORIGIN, not the SDK's current mutable owner/tool call money key. */
export interface AccountingOrigin {
  readonly backend: "@tintinweb/pi-subagents";
  readonly rootOwnerId: string;
  readonly spawnToolCallId: string;
  readonly childId: string;
}

/** Current control binding is separate from immutable accounting origin. */
export interface ChildBinding {
  owner: string;
  id: string;
  toolCallId: string;
  session: AgentSession;
  sessionKey: string;
  generation: number;
  disposed: boolean;
  /** Absence means unresolved attribution, never zero spend. */
  accountingId?: string;
}

export interface CostObservation {
  accountingId: string;
  authorizedOwner: string;
  child: string;
  bindingGeneration: number;
  reportedCumulativeUsd?: number;
  provenance: "record-lifetime" | "terminal-lifetime";
  aggregationScope: "top-level-including-descendants";
  /** Complete pricing requires future validated evidence, not merely a finite total. */
  pricing: { status: "incomplete"; reasons: string[] } | { status: "complete"; evidenceId: string };
  modelKey?: string;
  at: string;
  late: boolean;
}

export interface DecisionEntry {
  version: 1;
  owner: string;
  toolCallId?: string;
  child?: string;
  agent?: string;
  action: "proposed" | "applied" | "held" | "notified" | "skipped" | "preserved";
  reason: string;
  analysis?: RouteAnalysis;
  decision?: Decision;
}

export interface RoutingSnapshot {
  generation: number;
  owner: string;
  config: JevRouterConfig;
}
