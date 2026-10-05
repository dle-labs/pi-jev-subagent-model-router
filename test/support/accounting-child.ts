import { AccountingStore, rootOwnerId } from "../../src/state/accounting";
const [file,spawnToolCallId,cost]=process.argv.slice(2);
const store=new AccountingStore(file);
const id=await store.registerOrigin({backend:"@tintinweb/pi-subagents",rootOwnerId:rootOwnerId("/workspace","parent-public"),spawnToolCallId,childId:"child-a"},{owner:"public-owner",child:"child-a",generation:1});
await store.observe({accountingId:id,authorizedOwner:"public-owner",child:"child-a",bindingGeneration:1,reportedCumulativeUsd:Number(cost),provenance:"record-lifetime",aggregationScope:"top-level-including-descendants",pricing:{status:"incomplete",reasons:["native-coverage-unverified"]},modelKey:"p/m",at:"2026-03-31T23:59:59Z",late:false});
