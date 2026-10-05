import { DEFAULT_CONFIG } from "../../src/core/config";
import type { JevRouterConfig } from "../../src/core/config";
import type { RouteAnalysis } from "../../src/core/jev";

export const config = (): JevRouterConfig => structuredClone(DEFAULT_CONFIG);

export const analysis = (patch: Partial<RouteAnalysis> = {}): RouteAnalysis => ({
  kind: "implement",
  kindConfidence: 0.9,
  kindProbabilities: { implement: 0.9 },
  complexity: 2,
  complexityConfidence: 0.9,
  budgetIntensity: 2,
  budgetIntensityConfidence: 0.9,
  deepReasoning: 0.8,
  latencyMs: 1,
  ...patch,
});

export const agentInput = () => ({
  prompt: "Implement a safe parser",
  description: "Parser task",
  subagent_type: "worker",
});
