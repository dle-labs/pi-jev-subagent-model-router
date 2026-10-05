import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyLedger,
  formatUsd,
  loadLedger,
  recordCost,
  recordJevUsage,
  saveLedger,
  spendSnapshot,
} from "../../src/core/budget";
import type { Ledger } from "../../src/core/budget";
import type { BudgetConfig } from "../../src/core/config";
import { AccountingStore, accountingId, normalizeLedger } from "../../src/state/accounting";

const budget = (caps: Partial<BudgetConfig>): BudgetConfig => ({ softRatio: 0.7, hardRatio: 0.9, ...caps });

afterEach(() => setSystemTime());

describe("spendSnapshot", () => {
  function ledgerWith(today: number, month: number): Ledger {
    setSystemTime(new Date("2026-03-15T12:00:00Z"));
    const ledger = emptyLedger();
    ledger.days["2026-03-15"] = { total: today, byModel: {} };
    ledger.days["2026-03-14"] = { total: 99, byModel: {} };
    ledger.months["2026-03"] = { total: month, byModel: {} };
    return ledger;
  }

  test("pressure is the max of daily and monthly cap ratios", () => {
    const ledger = ledgerWith(1, 30);
    expect(spendSnapshot(ledger, budget({ dailyUsd: 4, monthlyUsd: 100 })).pressure).toBe(0.3);
    expect(spendSnapshot(ledger, budget({ dailyUsd: 2, monthlyUsd: 100 })).pressure).toBe(0.5);
  });

  test("only the configured cap contributes and other days are ignored", () => {
    const ledger = ledgerWith(1, 30);
    const snap = spendSnapshot(ledger, budget({ dailyUsd: 2 }));
    expect(snap).toEqual({ today: 1, month: 30, pressure: 0.5, dailyCap: 2, monthlyCap: undefined });
  });

  test("no caps or non-positive caps give zero pressure", () => {
    const ledger = ledgerWith(5, 50);
    expect(spendSnapshot(ledger, budget({})).pressure).toBe(0);
    expect(spendSnapshot(ledger, budget({ dailyUsd: 0, monthlyUsd: -1 })).pressure).toBe(0);
  });

  test("empty ledger reports zero spend", () => {
    const snap = spendSnapshot(emptyLedger(), budget({ dailyUsd: 1 }));
    expect(snap.today).toBe(0);
    expect(snap.pressure).toBe(0);
  });
});

describe("recordCost", () => {
  test("accumulates per day, month and model without rounding admissions", () => {
    setSystemTime(new Date("2026-03-15T12:00:00Z"));
    const ledger = emptyLedger();
    recordCost(ledger, "testprov/model-a", 0.1);
    recordCost(ledger, "testprov/model-a", 0.2);
    recordCost(ledger, "testprov/model-b", 0.00004);
    expect(ledger.days["2026-03-15"]).toEqual({ total: 0.30004, byModel: { "testprov/model-a": 0.3, "testprov/model-b": 0.00004 } });
    expect(ledger.months["2026-03"]).toEqual(ledger.days["2026-03-15"]);
  });

  test("new day starts a fresh day bucket while the month keeps accumulating", () => {
    const ledger = emptyLedger();
    setSystemTime(new Date("2026-03-15T23:59:00Z"));
    recordCost(ledger, "testprov/model-a", 1);
    setSystemTime(new Date("2026-03-16T00:01:00Z"));
    recordCost(ledger, "testprov/model-a", 2);
    expect(ledger.days["2026-03-15"].total).toBe(1);
    expect(ledger.days["2026-03-16"].total).toBe(2);
    expect(ledger.months["2026-03"].total).toBe(3);
  });

  test("new month starts a fresh month bucket", () => {
    const ledger = emptyLedger();
    setSystemTime(new Date("2026-03-31T12:00:00Z"));
    recordCost(ledger, "testprov/model-a", 1);
    setSystemTime(new Date("2026-04-01T12:00:00Z"));
    recordCost(ledger, "testprov/model-a", 2);
    expect(ledger.months["2026-03"].total).toBe(1);
    expect(ledger.months["2026-04"].total).toBe(2);
  });

  test("ignores zero, negative and non-finite costs", () => {
    const ledger = emptyLedger();
    for (const usd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) recordCost(ledger, "testprov/model-a", usd);
    expect(ledger.days).toEqual({});
    expect(ledger.months).toEqual({});
  });
});

describe("ledger persistence", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("missing file is empty but corrupt history refuses to load", () => {
    dir = mkdtempSync(join(tmpdir(), "jev-ledger-"));
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{ nope");
    expect(() => loadLedger(corrupt)).toThrow("invalid-json");
    for (const file of [join(dir, "missing.json")]) {
      const ledger = loadLedger(file);
      expect(ledger.days).toEqual({});
      expect(ledger.months).toEqual({});
      expect(ledger.jev).toEqual({ requests: 0, inputTokens: 0, outputTokens: 0 });
    }
  });

  test("partial file is filled with empty defaults", () => {
    dir = mkdtempSync(join(tmpdir(), "jev-ledger-"));
    const file = join(dir, "partial.json");
    writeFileSync(file, JSON.stringify({ jev: { requests: 3 } }));
    const ledger = loadLedger(file);
    expect(ledger.days).toEqual({});
    expect(ledger.jev).toEqual({ requests: 3, inputTokens: 0, outputTokens: 0 });
  });

  test("saveLedger then loadLedger round-trips, creating parent dirs", async () => {
    dir = mkdtempSync(join(tmpdir(), "jev-ledger-"));
    const file = join(dir, "nested", "deeper", "ledger.json");
    setSystemTime(new Date("2026-03-15T12:00:00Z"));
    const ledger = emptyLedger();
    recordCost(ledger, "testprov/model-a", 0.25);
    recordJevUsage(ledger, 100, 5);
    recordJevUsage(ledger);
    await saveLedger(file, ledger);
    const loaded = loadLedger(file);
    expect(loaded.days).toEqual(ledger.days);
    expect(loaded.months).toEqual(ledger.months);
    expect(loaded.jev).toEqual({ requests: 2, inputTokens: 100, outputTokens: 5 });
  });
});

test("CAS saving stale or untracked state cannot overwrite newer durable counters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-cas-"));
  try {
    const file = join(dir, "ledger.json");
    await saveLedger(file, emptyLedger());
    const a = loadLedger(file), b = loadLedger(file);
    recordJevUsage(a, 1, 2);
    await saveLedger(file, a);
    recordJevUsage(b, 9, 9);
    await expect(saveLedger(file, b)).rejects.toThrow();
    await expect(saveLedger(file, emptyLedger())).rejects.toThrow();
    expect(loadLedger(file).jev).toEqual({requests:1,inputTokens:1,outputTokens:2});
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

test("legacy in-memory additions do not allocate a namespace before the file lock", async () => {
  const dir=mkdtempSync(join(tmpdir(),"jev-namespace-"));
  try {
    const ledger=emptyLedger();recordCost(ledger,"p/m",0.00001);
    expect(ledger.accounting).toBeUndefined();
    await saveLedger(join(dir,"ledger.json"),ledger);
    expect(typeof ledger.accounting?.namespace).toBe("string");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("explicit recordCost timestamp seeds once across save/load", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-at-"));
  try {
    const file = join(dir,"ledger.json"), l = emptyLedger();
    recordCost(l,"p/m",0.00001,"2026-03-31T23:59:59Z");
    await saveLedger(file,l);
    const loaded=loadLedger(file);
    recordCost(loaded,"p/m",0.00001,"2026-04-01T00:00:00Z");
    await saveLedger(file,loaded);
    expect(loadLedger(file).months["2026-03"].total).toBe(0.00001);
    expect(loadLedger(file).months["2026-04"].total).toBe(0.00001);
  } finally { rmSync(dir, {recursive:true,force:true}); }
});

const durableOrigin = {backend:"@tintinweb/pi-subagents" as const,rootOwnerId:"public-root",spawnToolCallId:"spawn",childId:"child"};
const durableBinding = {owner:"owner",child:"child",generation:1};
const durableObservation = (id: string) => ({accountingId:id,authorizedOwner:"owner",child:"child",bindingGeneration:1,reportedCumulativeUsd:0.2,provenance:"record-lifetime" as const,aggregationScope:"top-level-including-descendants" as const,pricing:{status:"incomplete" as const,reasons:["native-coverage-unverified"]},modelKey:"p/m",at:"2026-03-31T23:59:59Z",late:false});

const snapshotAttacks: [string, (l: Ledger, id: string) => void][] = [
  ["remove envelope", l => {delete l.accounting;}],
  ["replace namespace and rehash identities", (l,id) => {
    const a=l.accounting!;a.namespace="00000000-0000-4000-8000-000000000000";
    const replacement=accountingId(a.namespace,a.records[id].origin);
    a.records[replacement]=a.records[id];a.associations[replacement]=a.associations[id];
    delete a.records[id];delete a.associations[id];
  }],
  ["remove record and association", (l,id) => {delete l.accounting!.records[id];delete l.accounting!.associations[id];}],
  ["regress watermark", (l,id) => {l.accounting!.records[id].accountedUsd="0.1";}],
  ["advance watermark", (l,id) => {l.accounting!.records[id].accountedUsd="0.3";}],
  ["edit association", (l,id) => {l.accounting!.associations[id].generation++;}],
  ["edit proof history", (l,id) => {l.accounting!.records[id].evidence.push("complete-proof-rejected");}],
  ["remove evaluation", l => {delete l.accounting!.evaluations["delivery"];}],
  ["remove all money buckets", l => {l.days={};l.months={};l.accounting!.exactDays={};l.accounting!.exactMonths={};}],
  ["reduce exact money below numeric precision", l => {l.accounting!.exactDays["2026-03-31"].total="0.199999999999999999";}],
  ["reduce money and projections", l => {
    for(const [numeric,exact,key] of [[l.days,l.accounting!.exactDays,"2026-03-31"],[l.months,l.accounting!.exactMonths,"2026-03"]] as const) {
      numeric[key]={total:0.1,byModel:{"p/m":0.1}};exact[key]={total:"0.1",byModel:{"p/m":"0.1"}};
    }
  }],
  ["remove model bucket", l => {l.days["2026-03-31"].byModel={};l.accounting!.exactDays["2026-03-31"].byModel={};}],
  ...(["requests","inputTokens","outputTokens"] as const).map(field => [`reduce ${field}`, (l: Ledger) => {l.jev[field]--;} ] as [string,(l:Ledger,id:string)=>void]),
];
for(const [name,attack] of snapshotAttacks) test(`compatibility save rejects ${name} without resetting replay history`, async () => {
  const dir=mkdtempSync(join(tmpdir(),"jev-transition-"));
  try {
    const file=join(dir,"ledger.json"),store=new AccountingStore(file);
    const id=await store.registerOrigin(durableOrigin,durableBinding);await store.observe(durableObservation(id));
    await store.recordUsage({owner:"o",toolCallId:"t",requests:1,status:"classified",usage:{input_tokens:3,output_tokens:4}},"delivery");
    const before=readFileSync(file,"utf8"),snapshot=loadLedger(file);
    attack(snapshot,id);normalizeLedger(structuredClone(snapshot)); // Every attack is internally valid.
    await expect(saveLedger(file,snapshot)).rejects.toThrow("invalid-ledger-transition");
    expect(readFileSync(file,"utf8")).toBe(before);
    const fresh=new AccountingStore(file);expect(await fresh.registerOrigin(durableOrigin,durableBinding)).toBe(id);
    expect(await fresh.observe(durableObservation(id))).toMatchObject({delta:"0",accounted:"0.2"});
    const restored=loadLedger(file);expect(restored.accounting!.namespace).toBe(JSON.parse(before).accounting.namespace);
    expect(restored.days["2026-03-31"].total).toBe(0.2);expect(restored.jev).toEqual({requests:1,inputTokens:3,outputTokens:4});
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("legacy file cannot accept caller-assigned namespace or reduced legacy history", async () => {
  const dir=mkdtempSync(join(tmpdir(),"jev-legacy-transition-"));
  try {
    const file=join(dir,"ledger.json"),seed=emptyLedger();recordCost(seed,"p/m",0.2,"2026-03-31T23:59:59Z");recordJevUsage(seed,3,4);
    writeFileSync(file,JSON.stringify(seed));const before=readFileSync(file,"utf8");
    const donorFile=join(dir,"donor.json");await new AccountingStore(donorFile).registerOrigin(durableOrigin,durableBinding);
    const forged=loadLedger(file),donor=loadLedger(donorFile).accounting!;
    donor.exactDays={"2026-03-31":{total:"0.2",byModel:{"p/m":"0.2"}}};donor.exactMonths={"2026-03":{total:"0.2",byModel:{"p/m":"0.2"}}};
    forged.accounting=donor;
    await expect(saveLedger(file,forged)).rejects.toThrow("invalid-ledger-transition");expect(readFileSync(file,"utf8")).toBe(before);
    for(const edit of [(l:Ledger)=>{l.days={};},(l:Ledger)=>{l.months["2026-03"].byModel={};},(l:Ledger)=>{l.jev.requests=0;}]) {
      const l=loadLedger(file);edit(l);await expect(saveLedger(file,l)).rejects.toThrow("invalid-ledger-transition");expect(readFileSync(file,"utf8")).toBe(before);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("compatibility exact additions and counter increments retain durable events across repeated saves", async () => {
  const dir=mkdtempSync(join(tmpdir(),"jev-compatible-"));
  try {
    const file=join(dir,"ledger.json"),store=new AccountingStore(file);
    const id=await store.registerOrigin(durableOrigin,durableBinding);await store.observe(durableObservation(id));
    const event={owner:"o",toolCallId:"t",requests:1 as const,status:"classified" as const,usage:{input_tokens:3,output_tokens:4}};
    await store.recordUsage(event,"delivery");const l=loadLedger(file),history=structuredClone(l.accounting!);
    recordCost(l,"p/m",0.00001,"2026-03-31T23:59:59Z");recordJevUsage(l,5,6);
    await saveLedger(file,l);await saveLedger(file,l);
    const out=loadLedger(file);expect(out.accounting!.records).toEqual(history.records);expect(out.accounting!.evaluations).toEqual(history.evaluations);
    expect(out.accounting!.namespace).toBe(history.namespace);expect(out.accounting!.exactDays["2026-03-31"].total).toBe("0.20001");
    expect(await store.recordUsage(event,"delivery")).toMatchObject({status:"duplicate"});expect(loadLedger(file).jev).toEqual({requests:2,inputTokens:8,outputTokens:10});
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("formatUsd picks precision by magnitude", () => {
  expect(formatUsd(12.345)).toBe("$12.35");
  expect(formatUsd(1)).toBe("$1.00");
  expect(formatUsd(0.0567)).toBe("$0.057");
  expect(formatUsd(0.01)).toBe("$0.010");
  expect(formatUsd(0.00123)).toBe("$0.0012");
});
