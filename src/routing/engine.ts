import type { Proposal, RoutingSnapshot, TaskSnapshot } from "../contracts";
import { apiKeyFor } from "../core/config";
import type { SpendSnapshot } from "../core/budget";
import { classifyRequest, type RouteAnalysis } from "../core/jev";
import { decide, type AvailableModel, type DecideOptions } from "../core/router";

export interface ChildContext {
  history?: string;
  contextTokens?: number;
  current?: DecideOptions["current"];
}
/** One classifier evaluation, not transport-attempt or durable-ledger counters. */
export interface ClassifierUsage {
  owner: string;
  toolCallId: string;
  requests: 1;
  status: "classified" | "failed";
  usage?: RouteAnalysis["usage"];
}
export interface EngineServices {
  classify?: typeof classifyRequest;
  recordUsage?: (event: ClassifierUsage) => void | Promise<void>;
}
export type Engine = (task: TaskSnapshot, snapshot: RoutingSnapshot, candidates: AvailableModel[], spend: SpendSnapshot, signal: AbortSignal, childContext?: ChildContext) => Promise<Proposal>;

/** No persistence here: Task 8 supplies a transactional usage consumer. */
export function createEngine(services: EngineServices = {}): Engine {
  const classify = services.classify ?? classifyRequest;
  return async (task, snapshot, candidates, spend, signal, childContext) => {
    const degraded: string[] = [];
    try {
      // Capture policy/classification inputs before the first await. Native tool
      // options can have non-cloneable identities and are not classifier inputs.
      const identity = { owner: task.owner, toolCallId: task.toolCallId };
      const prompt = task.prompt;
      const agent = task.agent;
      const config = structuredClone(snapshot.config);
      const models = structuredClone(candidates);
      const budget = { ...spend };
      const child = childContext === undefined ? undefined : structuredClone(childContext);
      const key = apiKeyFor(config);
      // Pin environment-selected endpoint without changing process env. The
      // client's redirect/deadline/parser guards remain the production path.
      config.endpoint = process.env[config.endpointEnv]?.trim() || config.endpoint;
      config.endpointEnv = "";
      if (signal.aborted) return { reason: "cancelled" };
      if (!config.enabled) return { reason: "disabled" };
      if (!key) return { reason: "missing-api-key" };
      const usage = async (status: ClassifierUsage["status"], analysis?: RouteAnalysis) => {
        if (!services.recordUsage) { degraded.push("usage-unrecorded"); return; }
        try {
          await services.recordUsage({ ...identity, requests: 1, status, ...(analysis?.usage ? { usage: { ...analysis.usage } } : {}) });
        } catch { degraded.push("usage-callback-failed"); }
      };
      // Keep room for the task even with an unusually long agent identity.
      const request = `Agent: ${agent.slice(0, 1000)}\nTask:\n${prompt}`;
      let analysis: RouteAnalysis;
      try {
        analysis = await classify({
          prompt: request.slice(0, 8000),
          spend: budget,
          ...(child ? {
            history: child.history, contextTokens: child.contextTokens,
            activeModel: child.current?.model ? `${child.current.model.provider}/${child.current.model.id}` : undefined,
          } : {}),
        }, config, key, signal);
        analysis = structuredClone(analysis);
        if (request.length > 8000) analysis.requestTruncation = { originalChars: request.length, sentChars: 8000 };
      } catch {
        await usage("failed");
        return { reason: signal.aborted ? "cancelled" : "classification-failed", degraded };
      }
      await usage("classified", analysis);
      if (signal.aborted) return { analysis, reason: "cancelled", degraded };
      const decision = decide(analysis, config, { models, spend: budget, ...(child ? { current: child.current, contextTokens: child.contextTokens } : {}) });
      return { analysis, decision, reason: decision ? "proposed" : "no-permitted-candidate", degraded };
    } catch {
      return { reason: signal.aborted ? "cancelled" : "routing-failed", degraded };
    }
  };
}

/** Production default composes the accepted real Jev client and policy. */
export const propose: Engine = createEngine();
