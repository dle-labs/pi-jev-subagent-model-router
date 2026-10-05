import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../../src/core/config";
import { loadConfiguration } from "../../src/configuration";
const file=new URL("../../examples/pi-jev-subagent-router.example.json",import.meta.url);
test("example has every supported config key with no literal credential and default chain coverage",()=>{
 const example=JSON.parse(readFileSync(file,"utf8")) as Record<string,unknown>;
 expect(Object.keys(example).sort()).toEqual([...Object.keys(DEFAULT_CONFIG),"apiKey"].sort());
 for(const key of ["routes","kindModels","kindMinimumTier","taskKinds"] as const){const actual=example[key] as Record<string,unknown>;for(const [name,value] of Object.entries(DEFAULT_CONFIG[key]))expect(actual[name]).toEqual(value);}
 for(const key of ["cache","ranking","budget","free"] as const)expect(Object.keys(example[key] as object).sort()).toEqual(Object.keys(DEFAULT_CONFIG[key]).sort());
 for(const [key,value] of Object.entries(DEFAULT_CONFIG))if(typeof value!=="object" && key!=="stateFile")expect(example[key]).toEqual(value);
 expect(example.cache).toEqual(DEFAULT_CONFIG.cache);
 expect(example.ranking).toMatchObject({cutoffs:DEFAULT_CONFIG.ranking.cutoffs,spreadProviders:DEFAULT_CONFIG.ranking.spreadProviders});
 expect(example.budget).toMatchObject({dailyUsd:5,monthlyUsd:100,softRatio:DEFAULT_CONFIG.budget.softRatio,hardRatio:DEFAULT_CONFIG.budget.hardRatio});
 expect(example.free).toMatchObject({enabled:false,policy:"prefer",pool:[{provider:"opencode-go",model:"space-bunny-free",thinkingLevel:"medium"},{provider:"opencode-go",model:"longcat-2.5-preview-free",thinkingLevel:"medium"}]});
 expect(example.taskKinds).toHaveProperty("data");expect(example.kindMinimumTier).toHaveProperty("infra");expect(example.apiKey).toBe("");expect(JSON.stringify(example)).not.toContain("pi-jev-model-router");
});
test("real loadConfiguration parses all example layers in private sandbox agent dir",()=>{
 const example=JSON.parse(readFileSync(file,"utf8"));writeFileSync(join(getAgentDir(),"pi-jev-subagent-router.json"),JSON.stringify(example));
 try{const loaded=loadConfiguration({});expect(loaded.routes).toEqual(example.routes);expect(loaded.kindModels).toEqual(example.kindModels);expect(loaded.timeoutMs).toBe(example.timeoutMs);expect(loaded.taskKinds.data).toBe(example.taskKinds.data);expect(loaded.ranking.scoresFile).toContain("pi-jev-subagent-router.scores.json");}
 finally{writeFileSync(join(getAgentDir(),"pi-jev-subagent-router.json"),'{}');}
});
