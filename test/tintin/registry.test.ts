import { expect, test } from "bun:test";
import { getOwnedRecord, readLifetimeCost, readTerminalCost } from "../../src/tintin/registry";
const association={owner:"owner",childId:"child",toolCallId:"call"};
const record=()=>({id:"child",type:"probe",status:"running",startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:0.2},session:{sessionId:"sdk",subscribe:()=>()=>{}}});
const registry=(value:unknown)=>({getRecord:()=>value});
test("ownership requires association, not lineage/display name; optional exact call correlation",()=>{
 const r=record(); expect(getOwnedRecord("owner","child",undefined,registry(r)).kind).toBe("unknown");
 expect(getOwnedRecord("owner","child",association,registry(r)).kind).toBe("owned");
 expect(getOwnedRecord("wrong","child",association,registry(r)).kind).toBe("unknown");
 expect(getOwnedRecord("owner","child",association,registry({...r,rootSessionId:"owner",toolCallId:"different"})).kind).toBe("unknown");
});
for(const extra of [{parentAgentId:"parent"},{workflowId:"workflow"},{id:"wrong"},{status:"invented"},{lifetimeUsage:null},{session:{}},{session:{sessionId:"sdk",subscribe:3}}]) test(`malformed/nested public record fails open ${JSON.stringify(extra)}`,()=>{
 expect(getOwnedRecord("owner","child",association,registry({...record(),...extra})).kind).toBe("unknown");
});
test("absent session is pending; malformed and throwing manager fail open",()=>{
 expect(getOwnedRecord("owner","child",association,registry({...record(),session:undefined}))).toMatchObject({kind:"owned",session:undefined});
 for(const manager of [null,{}, {getRecord:()=>{throw Error("SECRET");}}]) expect(getOwnedRecord("owner","child",association,manager).kind).toBe("unknown");
});
test("distinct lifetime and terminal shapes normalize dollars only",()=>{
 expect(readLifetimeCost({cost:0.2})).toBe(0.2);expect(readLifetimeCost({input:900})).toBeUndefined();
 expect(readLifetimeCost({cost:{total:2}})).toBeUndefined();expect(readTerminalCost({cost:{total:0.3}})).toBe(0.3);
 for(const n of [NaN,Infinity,-1]) {expect(readLifetimeCost({cost:n})).toBeUndefined();expect(readTerminalCost({cost:{total:n}})).toBeUndefined();}
 expect(readLifetimeCost({cost:0})).toBe(0);
});
