import type { Proposal } from "../contracts";
import { TIERS, type JevRouterConfig, type Mode } from "../core/config";
import { firstAvailable, findModel, type AvailableModel, type Decision } from "../core/router";

export interface Defaults { model?: string; thinking?: string }
/** Adapter to the public optional select UI; no host launch/session methods. */
export interface SelectUI { select(title: string, options: string[]): Promise<string | undefined> }
export interface ModeChoice {
  defaults: Defaults;
  decision?: Decision;
  reason: string;
  degraded?: string[];
}
export function defaultsFor(decision: Decision | undefined): Defaults {
  if (!decision?.model) return {};
  return {
    model: `${decision.model.provider}/${decision.model.id}`,
    ...(decision.target.thinkingLevel === undefined ? {} : { thinking: decision.target.thinkingLevel }),
  };
}

/** Confirmation-only alternative: existing lower tier chains, in their order. */
export function cheaperDecision(decision: Decision, config: JevRouterConfig, candidates: readonly AvailableModel[]): Decision | undefined {
  for (let i = decision.tierIndex - 1; i >= 0; i--) {
    const available = firstAvailable(candidates, config.routes[TIERS[i]]);
    if (!available || (available.model.provider === decision.model?.provider && available.model.id === decision.model.id)) continue;
    return {
      ...structuredClone(decision), target: structuredClone(available.target), model: structuredClone(available.model),
      tier: TIERS[i], tierIndex: i, downgraded: true, held: false, kindSpecialised: false,
      reason: `${decision.reason} · confirmed cheaper ${TIERS[i]}`,
      notes: [...decision.notes, `confirmation chose ${TIERS[i]} chain`],
    };
  }
  return undefined;
}

export async function chooseDefaults(mode: Mode, proposal: Proposal, config: JevRouterConfig, candidates: readonly AvailableModel[], ui?: SelectUI, signal?: AbortSignal): Promise<ModeChoice> {
  const decision = proposal.decision ? structuredClone(proposal.decision) : undefined;
  if (signal?.aborted) return { defaults: {}, reason: "cancelled" };
  if (!decision?.model || !findModel(candidates, decision.target)) return { defaults: {}, reason: "no-permitted-candidate" };
  if (mode === "notify") return { defaults: {}, decision, reason: "notify" };
  if (mode === "auto") return { defaults: defaultsFor(decision), decision, reason: "auto" };
  if (!ui?.select) return { defaults: defaultsFor(decision), decision, reason: "confirm-unavailable-auto" };
  const cheaper = cheaperDecision(decision, structuredClone(config), structuredClone([...candidates]));
  const selectedLabel = `Selected: ${defaultsFor(decision).model}`;
  const cheaperLabel = cheaper ? `Cheaper: ${defaultsFor(cheaper).model}` : undefined;
  const options = [selectedLabel, ...(cheaperLabel ? [cheaperLabel] : []), "Keep native defaults"];
  let choice: string | undefined;
  try { choice = await ui.select("Child routing defaults", [...options]); }
  catch { return { defaults: {}, reason: "confirmation-failed", degraded: ["ui-callback-failed"] }; }
  if (signal?.aborted) return { defaults: {}, reason: "cancelled" };
  const picked = choice === selectedLabel ? decision : cheaperLabel !== undefined && choice === cheaperLabel ? cheaper : undefined;
  return { defaults: defaultsFor(picked), decision: picked, reason: picked ? "confirmed" : "keep" };
}
