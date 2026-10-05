import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import type { BudgetConfig } from "./config";
import { addExactLedgerUsd, ensureAccounting, seedExactBuckets, normalizeLedger, type AccountingEnvelope, type ExactBucket } from "../state/accounting";
import { cumulativeDelta, decimalUsd } from "../state/money";
import { AtomicError, withAtomicJson } from "../state/atomic";

export interface LedgerBucket {
  total: number;
  byModel: Record<string, number>;
}

export interface Ledger {
  version: 1;
  days: Record<string, LedgerBucket>;
  months: Record<string, LedgerBucket>;
  jev: { requests: number; inputTokens: number; outputTokens: number };
  updatedAt: string;
  accounting?: AccountingEnvelope;
}

export function emptyLedger(): Ledger {
  return { version: 1, days: {}, months: {}, jev: { requests: 0, inputTokens: 0, outputTokens: 0 }, updatedAt: new Date().toISOString() };
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function monthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

// Legacy, nonproduction in-memory adapters. All production writers use
// AccountingStore's locked transaction, including Jev counters. Whole-snapshot
// saves remain available ONLY with compare-and-swap against their loaded state.
const baselines = new WeakMap<Ledger, { file: string; json: string | undefined }>();
// Exact compatibility additions, without allocating a durable identity outside
// the file lock. Existing envelopes carry their own exact buckets.
const pendingExact = new WeakMap<Ledger, Pick<AccountingEnvelope, "exactDays" | "exactMonths">>();
export function loadLedger(file: string): Ledger {
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw Error("ledger-read-failed");
    const ledger = emptyLedger(); baselines.set(ledger, { file, json: undefined }); return ledger;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw Error("invalid-json"); }
  const json = JSON.stringify(parsed);
  const ledger = normalizeLedger(parsed);
  baselines.set(ledger, { file, json }); return ledger;
}

// Compatibility snapshots may add spend/counters, but never edit store-owned
// identity, binding, evaluation, proof or migration history, even if valid in
// isolation. Both checks run against the latest normalized state under lock.
function guardDurableHistory(previous: Ledger | undefined, next: Ledger): void {
  const before=previous?.accounting, after=next.accounting;
  if(!before) {
    if(after)throw new AtomicError("invalid-ledger-transition");
    return;
  }
  if(!after)throw new AtomicError("invalid-ledger-transition");
  const {exactDays: _beforeDays, exactMonths: _beforeMonths, ...beforeHistory}=before;
  const {exactDays: _afterDays, exactMonths: _afterMonths, ...afterHistory}=after;
  if(!isDeepStrictEqual(beforeHistory,afterHistory))throw new AtomicError("invalid-ledger-transition");
}
function guardBucketGrowth(before: Record<string,ExactBucket>, after: Record<string,ExactBucket>): void {
  const retains=(old: string, value: string | undefined)=>value!==undefined && cumulativeDelta(value,old).delta==="0";
  for(const [key,bucket] of Object.entries(before)) {
    const next=Object.hasOwn(after,key) ? after[key] : undefined;
    if(!next || !retains(bucket.total,next.total))throw new AtomicError("invalid-ledger-transition");
    for(const [model,cost] of Object.entries(bucket.byModel)) {
      if(!retains(cost,Object.hasOwn(next.byModel,model) ? next.byModel[model] : undefined))throw new AtomicError("invalid-ledger-transition");
    }
  }
}
function guardBalanceGrowth(previous: Ledger | undefined, next: Ledger): void {
  if(!previous)return;
  for(const key of ["requests","inputTokens","outputTokens"] as const) {
    if(next.jev[key]<previous.jev[key])throw new AtomicError("invalid-ledger-transition");
  }
  guardBucketGrowth(previous.accounting?.exactDays ?? seedExactBuckets(previous.days),next.accounting?.exactDays ?? seedExactBuckets(next.days));
  guardBucketGrowth(previous.accounting?.exactMonths ?? seedExactBuckets(previous.months),next.accounting?.exactMonths ?? seedExactBuckets(next.months));
}

/** Async CAS plus monotonic compatibility transition; never edits durable history. */
export async function saveLedger(file: string, ledger: Ledger): Promise<void> {
  const baseline = baselines.get(ledger);
  if (baseline && baseline.file !== file) throw Error("ledger-path-mismatch");
  const expected = baseline?.json;
  const next = normalizeLedger(structuredClone(ledger));
  const shadow = pendingExact.get(ledger);
  const capturedExact = shadow ? structuredClone(shadow) : undefined;
  await withAtomicJson<Ledger, void>(file, previous => {
    if (JSON.stringify(previous) !== expected) throw Error("stale-ledger-snapshot");
    const normalizedPrevious = previous === undefined ? undefined : normalizeLedger(previous);
    guardDurableHistory(normalizedPrevious, next);
    // Only this transaction may allocate the first namespace after the guard.
    if (capturedExact) {
      const a = ensureAccounting(next);
      a.exactDays = capturedExact.exactDays; a.exactMonths = capturedExact.exactMonths;
    }
    next.updatedAt = new Date().toISOString();
    normalizeLedger(next);
    guardBalanceGrowth(normalizedPrevious, next);
    return { state: next, value: undefined };
  });
  ledger.updatedAt = next.updatedAt;
  if (next.accounting) ledger.accounting = structuredClone(next.accounting);
  pendingExact.delete(ledger);
  baselines.set(ledger, { file, json: JSON.stringify(next) });
}

/** Nonproduction compatibility adapter, never a parent/child attribution source. */
export function recordCost(ledger: Ledger, modelKey: string, usd: number, at: string = new Date().toISOString()): void {
  if (!Number.isFinite(usd) || usd <= 0) return;
  normalizeLedger(ledger);
  let exact = ledger.accounting ?? pendingExact.get(ledger);
  if (!exact) {
    exact = {exactDays:seedExactBuckets(ledger.days),exactMonths:seedExactBuckets(ledger.months)};
    pendingExact.set(ledger, exact);
  }
  addExactLedgerUsd(ledger, exact, modelKey, decimalUsd(usd), at);
}

export function recordJevUsage(ledger: Ledger, inputTokens = 0, outputTokens = 0): void {
  ledger.jev.requests += 1;
  ledger.jev.inputTokens += inputTokens;
  ledger.jev.outputTokens += outputTokens;
}

export interface SpendSnapshot {
  today: number;
  month: number;
  /** max(today/dailyCap, month/monthlyCap); 0 when no caps are configured. */
  pressure: number;
  dailyCap?: number;
  monthlyCap?: number;
}

export function spendSnapshot(ledger: Ledger, budget: BudgetConfig): SpendSnapshot {
  const today = ledger.days[dayKey()]?.total ?? 0;
  const month = ledger.months[monthKey()]?.total ?? 0;
  const ratios: number[] = [];
  if (budget.dailyUsd && budget.dailyUsd > 0) ratios.push(today / budget.dailyUsd);
  if (budget.monthlyUsd && budget.monthlyUsd > 0) ratios.push(month / budget.monthlyUsd);
  return {
    today,
    month,
    pressure: ratios.length > 0 ? Math.max(...ratios) : 0,
    dailyCap: budget.dailyUsd,
    monthlyCap: budget.monthlyUsd,
  };
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}