import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AccountingOrigin, CostObservation } from "../contracts";
import type { Ledger, LedgerBucket } from "../core/budget";
import type { ClassifierUsage } from "../routing/engine";
import { withAtomicJson, AtomicError, type AtomicOptions } from "./atomic";
import { addUsd, canonicalUsd, cumulativeDelta, decimalUsd } from "./money";
export { cumulativeDelta } from "./money";

export interface ExactBucket { total: string; byModel: Record<string,string> }
export interface Association { owner: string; child: string; generation: number }
export interface AccountingRecord {
  origin: AccountingOrigin;
  accountedUsd: string;
  provenance: CostObservation["provenance"];
  aggregationScope: CostObservation["aggregationScope"];
  pricing: {status:"incomplete";reasons:string[]};
  evidence: string[];
  lastObservedAt?: string;
  lastReportedUsd?: string;
  lastModelKey?: string;
  late: boolean;
}
export interface EvaluationRecord {
  owner: string; toolCallId: string; requests: 1; status: ClassifierUsage["status"];
  usageStatus: "reported" | "unavailable";
  usage?: ClassifierUsage["usage"];
}
export interface AccountingEnvelope {
  version: 1;
  namespace: string;
  records: Record<string,AccountingRecord>;
  associations: Record<string,Association>;
  exactDays: Record<string,ExactBucket>;
  exactMonths: Record<string,ExactBucket>;
  evaluations: Record<string,EvaluationRecord>;
  migration: {status:"incomplete";reason:"legacy-rounded-loss-unrecoverable"};
}
const dictionary = <T>(): Record<string,T> => Object.create(null);
const own = <T>(map: Record<string,T>,key: string): T | undefined => Object.hasOwn(map,key) ? map[key] : undefined;
function object(value: unknown): asserts value is Record<string,unknown> {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("invalid-ledger");
}
function label(value: unknown): asserts value is string {
  if(typeof value!=="string" || !value.length || value.length>4096 || ["__proto__","prototype","constructor"].includes(value)) throw Error("invalid-identity");
}
function integer(value: unknown): asserts value is number {
  if(typeof value!=="number" || !Number.isSafeInteger(value) || value<0)throw Error("invalid-counter");
}
function timestamp(value: unknown): asserts value is string {
  if(typeof value!=="string" || value.length>40 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw Error("invalid-timestamp");
}
function validateOrigin(origin: AccountingOrigin) {
  object(origin);
  if(origin.backend!=="@tintinweb/pi-subagents")throw Error("invalid-origin");
  label(origin.rootOwnerId);label(origin.spawnToolCallId);label(origin.childId);
}
function validateBinding(binding: Association) {
  object(binding);label(binding.owner);label(binding.child);integer(binding.generation);
}
function validateReasons(reasons: unknown): asserts reasons is string[] {
  if(!Array.isArray(reasons) || reasons.length>256 || reasons.some(r=>typeof r!=="string" || !/^[a-z][a-z0-9-]{0,100}$/.test(r)))throw Error("invalid-pricing-reasons");
}
/** Caller supplies a canonical real project root from public context. No settings
 * or personal-directory reads. The JSON pair prevents separator ambiguity. */
export function rootOwnerId(canonicalProjectRoot: string, publicParentSessionId: string): string {
  label(canonicalProjectRoot);label(publicParentSessionId);
  if(resolve(canonicalProjectRoot)!==canonicalProjectRoot)throw Error("noncanonical-project-root");
  return JSON.stringify([canonicalProjectRoot,publicParentSessionId]);
}
export function accountingId(namespace: string, origin: AccountingOrigin): string {
  label(namespace);validateOrigin(origin);
  return createHash("sha256").update(JSON.stringify([namespace,origin.backend,origin.rootOwnerId,origin.spawnToolCallId,origin.childId])).digest("hex");
}
function numericBuckets(value: unknown): asserts value is Record<string,LedgerBucket> {
  object(value);
  for(const [key,bucket] of Object.entries(value)) {
    label(key);object(bucket);decimalUsd(bucket.total as number);object(bucket.byModel);
    for(const [model,n] of Object.entries(bucket.byModel)){label(model);decimalUsd(n as number);}
  }
}
export function seedExactBuckets(buckets: Record<string,LedgerBucket>): Record<string,ExactBucket> {
  numericBuckets(buckets);
  const output=dictionary<ExactBucket>();
  for(const [key,bucket] of Object.entries(buckets)) {
    const byModel=dictionary<string>();for(const [model,n] of Object.entries(bucket.byModel))byModel[model]=decimalUsd(n);
    output[key]={total:decimalUsd(bucket.total),byModel};
  }
  return output;
}
function validateExact(exact: Record<string,ExactBucket>,numeric: Record<string,LedgerBucket>) {
  object(exact);
  if(Object.keys(exact).length!==Object.keys(numeric).length)throw Error("invalid-projection");
  for(const [key,bucket] of Object.entries(exact)) {
    label(key);object(bucket);object(bucket.byModel);
    if(typeof bucket.total!=="string" || canonicalUsd(bucket.total)!==bucket.total)throw Error("invalid-exact-usd");
    const n=own(numeric,key);if(!n || n.total!==Number(bucket.total) || Object.keys(n.byModel).length!==Object.keys(bucket.byModel).length)throw Error("invalid-projection");
    for(const [model,cost] of Object.entries(bucket.byModel)) {
      label(model);if(typeof cost!=="string" || canonicalUsd(cost)!==cost || own(n.byModel,model)!==Number(cost))throw Error("invalid-projection");
    }
  }
}
/** Strict existing-state validation. Defaults only cover valid absent legacy fields;
 * corrupt/nonfinite/versioned data are never silently replaced by empty history. */
export function normalizeLedger(input: unknown): Ledger {
  object(input);
  if(input.version!==undefined && input.version!==1)throw Error("invalid-ledger-version");
  const ledger = input as unknown as Ledger;
  // An envelope marks completed migration: absent base history is corruption,
  // not permission to recreate counters/buckets alongside durable event IDs.
  const legacy=ledger.accounting===undefined;
  if(!legacy) {
    if(["version","days","months","jev","updatedAt"].some(key=>!Object.hasOwn(input,key) || input[key]===undefined))throw Error("invalid-ledger");
    object(ledger.jev);
    for(const key of ["requests","inputTokens","outputTokens"] as const) {
      if(!Object.hasOwn(ledger.jev,key))throw Error("invalid-counter");
      integer(ledger.jev[key]);
    }
  }
  ledger.version=1;
  if(legacy && ledger.days===undefined)ledger.days=dictionary();
  if(legacy && ledger.months===undefined)ledger.months=dictionary();
  numericBuckets(ledger.days);numericBuckets(ledger.months);
  if(legacy && ledger.jev===undefined)ledger.jev={requests:0,inputTokens:0,outputTokens:0};object(ledger.jev);
  if(legacy && ledger.jev.requests===undefined)ledger.jev.requests=0;
  if(legacy && ledger.jev.inputTokens===undefined)ledger.jev.inputTokens=0;
  if(legacy && ledger.jev.outputTokens===undefined)ledger.jev.outputTokens=0;
  integer(ledger.jev.requests);integer(ledger.jev.inputTokens);integer(ledger.jev.outputTokens);
  if(legacy && ledger.updatedAt===undefined)ledger.updatedAt=new Date().toISOString();timestamp(ledger.updatedAt);
  if(ledger.accounting!==undefined) {
    const a=ledger.accounting;object(a);
    if(a.version!==1 || typeof a.namespace!=="string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.namespace))throw Error("invalid-accounting-version");
    object(a.records);object(a.associations);object(a.evaluations);object(a.migration);
    if(a.migration.status!=="incomplete" || a.migration.reason!=="legacy-rounded-loss-unrecoverable")throw Error("invalid-migration");
    validateExact(a.exactDays,ledger.days);validateExact(a.exactMonths,ledger.months);
    for(const [id,r] of Object.entries(a.records)) {
      object(r);validateOrigin(r.origin);if(id!==accountingId(a.namespace,r.origin))throw Error("invalid-record-identity");
      if(typeof r.accountedUsd!=="string" || canonicalUsd(r.accountedUsd)!==r.accountedUsd)throw Error("invalid-watermark");
      if(!["record-lifetime","terminal-lifetime"].includes(r.provenance) || r.aggregationScope!=="top-level-including-descendants")throw Error("invalid-provenance");
      object(r.pricing);if(r.pricing.status!=="incomplete")throw Error("unsupported-complete-proof");validateReasons(r.pricing.reasons);validateReasons(r.evidence);
      if(r.lastObservedAt!==undefined)timestamp(r.lastObservedAt);
      if(r.lastReportedUsd!==undefined && canonicalUsd(r.lastReportedUsd)!==r.lastReportedUsd)throw Error("invalid-observed-usd");
      if(r.lastModelKey!==undefined)label(r.lastModelKey);if(typeof r.late!=="boolean")throw Error("invalid-late");
      const binding=own(a.associations,id);if(!binding)throw Error("missing-association");validateBinding(binding);if(binding.child!==r.origin.childId)throw Error("invalid-association");
    }
    for(const [id,binding] of Object.entries(a.associations)){if(!own(a.records,id))throw Error("orphan-association");validateBinding(binding);}
    for(const [id,event] of Object.entries(a.evaluations)) {label(id);validateUsage(event);if(!["reported","unavailable"].includes(event.usageStatus) || (event.usageStatus==="reported")!==(event.usage!==undefined))throw Error("invalid-usage-status");}
  }
  return ledger;
}
export function ensureAccounting(ledger: Ledger): AccountingEnvelope {
  if(ledger.accounting)return ledger.accounting;
  numericBuckets(ledger.days);numericBuckets(ledger.months);
  return ledger.accounting={version:1,namespace:randomUUID(),records:dictionary(),associations:dictionary(),evaluations:dictionary(),exactDays:seedExactBuckets(ledger.days),exactMonths:seedExactBuckets(ledger.months),migration:{status:"incomplete",reason:"legacy-rounded-loss-unrecoverable"}};
}
function addBucket(exact: Record<string,ExactBucket>, numeric: Record<string,LedgerBucket>,key:string,model:string,delta:string) {
  const bucket=own(exact,key) ?? {total:"0",byModel:dictionary<string>()};
  bucket.total=addUsd(bucket.total,delta);bucket.byModel[model]=addUsd(own(bucket.byModel,model)??"0",delta);exact[key]=bucket;
  const byModel=dictionary<number>();for(const [m,n] of Object.entries(bucket.byModel))byModel[m]=Number(n);
  numeric[key]={total:Number(bucket.total),byModel};
}
/** In-memory compatibility adapter only. Production mutations use AccountingStore
 * transactions; saveLedger performs CAS rather than stale whole-state overwrite. */
export function addExactLedgerUsd(ledger: Ledger,a:Pick<AccountingEnvelope,"exactDays"|"exactMonths">,model:string,usd:string,at:string) {
  label(model);timestamp(at);usd=canonicalUsd(usd);if(usd==="0")return;
  const date=new Date(at).toISOString();
  addBucket(a.exactDays,ledger.days,date.slice(0,10),model,usd);
  addBucket(a.exactMonths,ledger.months,date.slice(0,7),model,usd);
}
function addLedgerUsd(ledger: Ledger,model:string,usd:string,at:string) {
  addExactLedgerUsd(ledger,ensureAccounting(ledger),model,usd,at);
}
function validateUsage(event: ClassifierUsage) {
  object(event);label(event.owner);label(event.toolCallId);
  if(event.requests!==1 || !["classified","failed"].includes(event.status))throw Error("invalid-evaluation");
  if(event.usage!==undefined){object(event.usage);integer(event.usage.input_tokens);integer(event.usage.output_tokens);}
}
function empty():Ledger {return {version:1,days:dictionary(),months:dictionary(),jev:{requests:0,inputTokens:0,outputTokens:0},updatedAt:new Date().toISOString()};}
export type ObservationReceipt = {status:"committed";delta:string;accounted:string;pricing:"incomplete"} | {status:"unknown-attribution" | "stale-binding"};
export class AccountingStore {
  constructor(readonly file:string,private readonly options:AtomicOptions={}){}
  private transaction<R>(update:(ledger:Ledger,a:AccountingEnvelope)=>R):Promise<R> {
    return withAtomicJson<Ledger,R>(this.file,previous=>{
      const ledger=previous===undefined ? empty() : normalizeLedger(previous);
      const a=ensureAccounting(ledger);
      const value=update(ledger,a);ledger.updatedAt=new Date().toISOString();
      normalizeLedger(ledger);
      return {state:ledger,value};
    },this.options);
  }
  /** Trust boundary: origin/binding must come from futureobserver's live, public,
   * validated launch correlation. A persisted association is NOT authorization.
   * A verified continuation uses the same origin; unknown replacement cannot call
   * this with a guessed spawn. No private SDK or backend reads are performed. */
  async registerOrigin(origin:AccountingOrigin,binding:Association):Promise<string> {
    validateOrigin(origin);validateBinding(binding);
    if(binding.child!==origin.childId)throw Error("invalid-association");
    const originCopy:AccountingOrigin={backend:origin.backend,rootOwnerId:origin.rootOwnerId,spawnToolCallId:origin.spawnToolCallId,childId:origin.childId};
    const bindingCopy:Association={owner:binding.owner,child:binding.child,generation:binding.generation};
    return this.transaction((_ledger,a)=>{
      const id=accountingId(a.namespace,originCopy),old=own(a.associations,id);
      if(old && (bindingCopy.generation<old.generation || (bindingCopy.generation===old.generation && bindingCopy.owner!==old.owner)))throw new AtomicError("stale-binding");
      if(!own(a.records,id))a.records[id]={origin:originCopy,accountedUsd:"0",provenance:"record-lifetime",aggregationScope:"top-level-including-descendants",pricing:{status:"incomplete",reasons:["native-coverage-unverified"]},evidence:[],late:false};
      else if(old && bindingCopy.generation>old.generation) {
        const record=a.records[id];record.pricing.reasons=[...new Set([...record.pricing.reasons,"activity-uncovered"])];
      }
      a.associations[id]=bindingCopy;return id;
    });
  }
  async observe(observation:CostObservation):Promise<ObservationReceipt> {
    // Copy before any wait so caller mutation cannot change attribution/values.
    const o=structuredClone(observation);
    label(o.accountingId);label(o.authorizedOwner);label(o.child);integer(o.bindingGeneration);timestamp(o.at);
    if(!["record-lifetime","terminal-lifetime"].includes(o.provenance) || o.aggregationScope!=="top-level-including-descendants" || typeof o.late!=="boolean")throw Error("invalid-observation");
    object(o.pricing);
    if(o.pricing.status==="incomplete")validateReasons(o.pricing.reasons);
    else if(o.pricing.status!=="complete")throw Error("invalid-pricing");
    if(o.modelKey!==undefined)label(o.modelKey);
    return this.transaction((ledger,a)=>{
      const r=own(a.records,o.accountingId),b=own(a.associations,o.accountingId);
      if(!r || !b)return {status:"unknown-attribution"};
      if(b.owner!==o.authorizedOwner || b.child!==o.child || b.generation!==o.bindingGeneration)return {status:"stale-binding"};
      const reasons=[...r.pricing.reasons,"native-coverage-unverified"];
      if(o.pricing.status==="complete"){reasons.push("unsupported-complete-proof");r.evidence=[...new Set([...r.evidence,"complete-proof-rejected"])];}
      else reasons.push(...o.pricing.reasons);
      let observed:string|undefined;
      if(o.reportedCumulativeUsd===undefined)reasons.push("cost-unavailable");
      else {try{observed=decimalUsd(o.reportedCumulativeUsd);}catch{reasons.push("cost-invalid");}}
      if(observed==="0")reasons.push("zero-unproven");
      const high=observed===undefined ? {delta:"0",accounted:r.accountedUsd} : cumulativeDelta(r.accountedUsd,observed);
      if(high.delta!=="0")addLedgerUsd(ledger,o.modelKey??"unknown-child-model",high.delta,o.at);
      r.accountedUsd=high.accounted;r.pricing={status:"incomplete",reasons:[...new Set(reasons)]};
      if(!r.lastObservedAt || Date.parse(o.at)>=Date.parse(r.lastObservedAt)) {
        r.lastObservedAt=o.at;r.provenance=o.provenance;r.aggregationScope=o.aggregationScope;r.late=o.late;
        r.lastModelKey=o.modelKey??"unknown-child-model";
        if(observed!==undefined)r.lastReportedUsd=observed;else delete r.lastReportedUsd;
      }
      return {status:"committed",delta:high.delta,accounted:high.accounted,pricing:"incomplete"};
    });
  }
  /** One evaluation, independent of notify/keep/application. Only a caller-provided
   * delivery identity deduplicates; toolCallId alone never collapses retries. */
  async recordUsage(event:ClassifierUsage,eventId:string=randomUUID()):Promise<{status:"committed"|"duplicate";usageStatus:"reported"|"unavailable"}> {
    validateUsage(event);label(eventId);
    const e:ClassifierUsage={owner:event.owner,toolCallId:event.toolCallId,requests:1,status:event.status,
      ...(event.usage ? {usage:{input_tokens:event.usage.input_tokens,output_tokens:event.usage.output_tokens}} : {})};
    return this.transaction((ledger,a)=>{
      const old=own(a.evaluations,eventId);if(old) {
        const expected={...e,usageStatus:e.usage ? "reported" : "unavailable"};
        if(JSON.stringify(old)!==JSON.stringify(expected))throw Error("evaluation-identity-conflict");
        return {status:"duplicate",usageStatus:old.usageStatus};
      }
      const record:EvaluationRecord={...e,usageStatus:e.usage ? "reported" : "unavailable"};
      ledger.jev.requests+=1;ledger.jev.inputTokens+=e.usage?.input_tokens??0;ledger.jev.outputTokens+=e.usage?.output_tokens??0;
      integer(ledger.jev.requests);integer(ledger.jev.inputTokens);integer(ledger.jev.outputTokens);
      a.evaluations[eventId]=record;return {status:"committed",usageStatus:record.usageStatus};
    });
  }
}
/** Task7-compatible reusable adapter. Commit failures reject so Task7 exposes
 * usage-callback-failed; unavailable usage is a committed request, not measured 0.
 * No event-id seam in Task7 today: each invocation is a distinct evaluation. */
export function createUsageRecorder(store:AccountingStore):(event:ClassifierUsage)=>Promise<void> {
  return async event=>{await store.recordUsage(event);};
}
