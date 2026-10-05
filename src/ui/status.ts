import type { DecisionEntry, RoutingSnapshot } from "../contracts";
import { formatUsd, spendSnapshot, type Ledger } from "../core/budget";
import { TIERS } from "../core/config";
import { firstAvailable, describeKindRoutes, type AvailableModel } from "../core/router";

export interface ChildStatus { id:string; status:string; model?:string; thinking?:string }
/** Projected by the composition adapter, never native records/options or config. */
export interface StatusView {
 discovery:"ready"|"unknown"|"unavailable";
 control:"supported"|"unsupported"|"degraded"|"unknown";
 children:readonly ChildStatus[];
}
export const actionGlyph=(action:DecisionEntry["action"]):string=>({proposed:"→",applied:"→",held:"=",notified:"•",skipped:"×",preserved:"="})[action];
/** Terminal-safe, bounded labels; not an error-message sanitizer. */
export const label=(text:string,max=256):string=>text.replace(/[\u0000-\u001f\u007f-\u009f]/g," ").slice(0,max);
const code=(value:string):string=>/^[a-z][a-z0-9-]{0,100}$/.test(value)?value:"unknown-gap";
export function pricingText(ledger:Ledger):string {
 const records=Object.values(ledger.accounting?.records??{});
 const gaps=new Set<string>(["native-coverage-unverified"]);
 if(!records.length)gaps.add("no-observations");
 if(!ledger.accounting)gaps.add("legacy-coverage-unknown");
 if(ledger.accounting)gaps.add(ledger.accounting.migration.reason);
 for(const record of records)for(const reason of record.pricing.reasons)gaps.add(code(reason));
 return `pricing incomplete — ${[...gaps].sort().slice(0,32).join(", ")}`;
}
/** Reported subtotals, proof coverage, model attribution and time are independent. */
export function prepareStatus(runtime:RoutingSnapshot,ledger:Ledger|undefined,models:readonly AvailableModel[],view:StatusView):string {
 const c=runtime.config;
 const money=ledger?spendSnapshot(ledger,c.budget):undefined;
 const records=Object.values(ledger?.accounting?.records??{});
 const evaluations=Object.values(ledger?.accounting?.evaluations??{});
 const unknownUsage=evaluations.filter(e=>e.usageStatus==="unavailable").length;
 const untrackedUsage=Math.max(0,(ledger?.jev.requests??0)-evaluations.length);
 const lines=[
  `jev-subagent-router: ${c.enabled?"on":"off"} · mode ${c.mode} · generation ${runtime.generation}`,
  `jev model: ${label(c.jevModel)} · credentials: not displayed`,
  money?`today: Reported ${formatUsd(money.today)} — ${pricingText(ledger!)}\nmonth: Reported ${formatUsd(money.month)} — pricing incomplete`:"Reported USD unavailable — pricing incomplete (ledger unavailable)",
  "model attribution: aggregate component model unknown; reported bucket labels are not coverage proof",
  `temporal attribution: ${records.filter(r=>r.late).length} late observation(s); historical activity time unknown`,
  money?`budget pressure: ${(money.pressure*100).toFixed(0)}% · daily cap ${money.dailyCap===undefined?"unset":formatUsd(money.dailyCap)} · monthly cap ${money.monthlyCap===undefined?"unset":formatUsd(money.monthlyCap)}`:"budget pressure: unavailable",
  ...(money?[`reported remaining: daily ${money.dailyCap===undefined?"unset":formatUsd(Math.max(0,money.dailyCap-money.today))} · monthly ${money.monthlyCap===undefined?"unset":formatUsd(Math.max(0,money.monthlyCap-money.month))}`]:[]),
  "based on reported spend; advisory, not guaranteed remaining allowance; concurrent children may overshoot caps",
  ledger?`jev requests: ${ledger.jev.requests} · reported tokens input ${ledger.jev.inputTokens}, output ${ledger.jev.outputTokens} · usage unavailable ${unknownUsage}, legacy/unknown usage ${untrackedUsage}`:"jev requests/tokens: unknown (ledger unavailable)",
  `built-in models: ${c.useDefaultModels?"on":"off (config-only)"}`,
  `cache-aware: ${c.cache.aware?"on":"off"} · penalty cap ${formatUsd(c.cache.maxPenaltyUsd)} · deadband ${c.cache.deadband} · bypass ${c.cache.bypassTierDelta}`,
  `discovery: ${view.discovery} · control: ${view.control} (atomic idle-child public capability required; no launch or resume fallback)`,
  "routes:",
  ...TIERS.map(tier=>{const chain=c.routes[tier];const available=firstAvailable(models,chain);return `  ${tier}: ${chain.length?chain.map(t=>`${label(t.provider)}/${label(t.model)}${t.thinkingLevel?` (${t.thinkingLevel})`:""}`).join(" → "):tier==="xpremium"?"off":"none configured"} · ${available?"available":"unavailable in current scope"}`;}),
  `kind specialists (${Object.keys(c.kindModels).length}):`,
  ...Object.keys(c.kindModels).slice(0,64).map(kind=>`  ${label(kind)}: ${label(describeKindRoutes(c,[...models],kind),2048)}`),
  `free pool: ${c.free.enabled?c.free.policy:"off"} · ${c.free.pool.length} configured (preference, not accounting proof)`,
  ...c.free.pool.slice(0,64).map(t=>`  ${label(t.provider)}/${label(t.model)}`),
  `known children (${view.children.length}, validated association only):`,
  ...view.children.slice(0,128).map(child=>`  ${label(child.id)}: ${label(child.status)} · observed ${child.model?label(child.model):"model unknown"} (${child.thinking?label(child.thinking):"thinking unknown"})`),
  "commands: /jev-subagent-router status|on|off|mode|budget|why|suggest [--write]|apply CHILD_ID [-- TASK]|revert CHILD_ID · /jev-subagent-route TASK",
 ];
 return lines.join("\n");
}
