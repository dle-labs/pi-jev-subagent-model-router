import { expect, test } from 'bun:test';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { dependencyPackageRoot } from '../../scripts/probe/public-package';
import { withNativeFixture, bounded, check } from '../../scripts/compatibility-probe';
import { nativeCall } from '../../scripts/probe/tintin-native';
import { isolatedChild } from '../support/isolated-child';

// Public provider/loader fixture only. The copied production default entry and
// public Tintin Agent execution are unchanged; no backend/controller setters.
async function matrix() {
 const host=process.env.PI_PROBE_HOST_ROOT!;
 const source=resolve('.'), paths:string[]=[], requests:unknown[]=[], notices:string[]=[];
 let configFile='',ledgerFile='',release:(()=>void)|undefined,entered:(()=>void)|undefined;
 let pending:Promise<Response>|undefined;
 let failureResponse:Response|undefined;
 const report=await withNativeFixture({hostRoot:host,tintinRoot:resolve('node_modules/@tintinweb/pi-subagents')},async f=>{
  const pair={model:f.parent.model.id,provider:f.parent.model.provider,thinking:f.parent.thinkingLevel};
  const ui=(pick?:string)=>({notify:(text:string)=>notices.push(text),setWidget:()=>{},setStatus:()=>{},setTitle:()=>{},select:async(_title:string,options:string[])=>pick==='cheaper'?options.find(x=>x.startsWith('Cheaper:')):pick==='selected'?options[0]:'Keep native defaults',confirm:async()=>false,input:async()=>undefined,editor:async()=>undefined});
  const base=JSON.parse(await readFile(configFile,'utf8'));
  const cells:unknown[]=[];
  async function cell(id:string,changes:object,expectedModel:string,expectedThinking:string,classified:number,fields:object={},interactive?:string){
   await writeFile(configFile,JSON.stringify({...base,...changes}));
   if(interactive!=='preserve')await f.parent.bindExtensions(interactive?{mode:'interactive',uiContext:ui(interactive)}:{mode:'json'});
   const start=f.witnesses.length,before=requests.length;
   const prior=JSON.parse(await readFile(ledgerFile,'utf8').catch(()=>'{}'));
   const originsBefore=Object.keys(prior.accounting?.records??{}).length;
   const record=await bounded(nativeCall(f.parent,{id,name:'Agent',arguments:{subagent_type:'omitted',description:id,prompt:`PRIVATE-${id}`,isolated:true,inherit_context:false,...fields}},f.enqueue),id);
   await bounded(f.registry.waitForAll(),'parity cell settlement');
   const observed=f.witnesses.slice(start),receipt=f.parent.messages.find((m:any)=>m.role==='toolResult'&&m.toolCallId===id);
   check(observed.length===1,`${id}: execution count ${observed.length}`);
   check(observed[0].model.id===expectedModel&&observed[0].model.provider===`jev-compat-${expectedModel}`&&observed[0].thinking===expectedThinking,`${id}: provider mismatch ${JSON.stringify(observed)}`);
   check(record.session.model.id===expectedModel&&record.session.model.provider===`jev-compat-${expectedModel}`&&record.session.thinkingLevel===expectedThinking,`${id}: retained pair mismatch`);
   check(requests.length-before===classified,`${id}: classifier count ${requests.length-before}`);
   if(['notify','confirm-keep','missing-key','scope-empty','bounded-timeout','secret-transport-error','off-on-deferred','config-generation-deferred'].includes(id)){
    const mutation=f.mutations.get(id);
    check(mutation&&!('model' in mutation.after)&&!('thinking' in mutation.after),`${id}: unexpected automatic input injection`);
   }
   check(receipt?.details?.agentId===record.id&&!receipt.isError&&receipt.content.some((c:any)=>c.text?.includes('Native fixture answer.')),`${id}: tool receipt lost`);
   check(f.parent.model.id===pair.model&&f.parent.model.provider===pair.provider&&f.parent.thinkingLevel===pair.thinking,`${id}: parent mutated`);
   check(await f.settingsUnchanged(),`${id}: global settings mutated`);
   await f.parent.prompt('/jev-subagent-router status');
   const ledger=JSON.parse(await readFile(ledgerFile,'utf8'));
   // off/on intentionally cancels correlation of the in-flight admission.
   // Native executes fail-open, but no accounting origin can be invented.
   const originExpected=['off-on-deferred','config-generation-deferred'].includes(id)?0:1;
   check(Object.values(ledger.accounting.records).length===originsBefore+originExpected,`${id}: immutable origin count mismatch`);
   check(Object.values(ledger.accounting.records).every((r:any)=>r.accountedUsd==='0.2'),`${id}: nonzero cost missing`);
   check(!JSON.stringify(ledger).includes('PRIVATE-')&&!JSON.stringify(ledger).includes('fixture-secret'),`${id}: task or key persisted`);
   cells.push({id,provider:observed[0].model,thinking:observed[0].thinking,executions:1,classifications:classified,receipt:true,reportedUsd:originExpected?'0.2':'unobserved-cancelled-admission',parentPreserved:true,settingsPreserved:true});
  }
  await cell('auto',{},'allowed','high',1);
  await cell('notify',{mode:'notify'},'parent','medium',1);
  await cell('confirm-noninteractive',{mode:'confirm'},'allowed','high',1);
  await cell('confirm-keep',{mode:'confirm'},'parent','medium',1,{},'keep');
  await cell('confirm-selected',{mode:'confirm'},'allowed','high',1,{},'selected');
  await cell('confirm-cheaper',{mode:'confirm'},'parent','off',1,{},'cheaper');
  await cell('missing-key',{apiKey:''},'parent','medium',0);
  await cell('scope-empty',{routes:{high:[{provider:'jev-compat-excluded',model:'excluded',thinkingLevel:'high'}],quick:[],standard:[],premium:[],xpremium:[]}},'parent','medium',1);
  await cell('empty-resume-schedule',{},'allowed','high',1,{resume:'',schedule:''});
  failureResponse=Response.json({error:'fixture-secret PRIVATE-provider-error'},{status:400});
  await cell('secret-transport-error',{},'parent','medium',1,{},'keep');failureResponse=undefined;
  // Timeout uses a real pending fake transport and the configured deadline. No
  // sleep, echo, cancellation shortcut or private service manipulation.
  pending=new Promise<Response>(resolve=>{release=()=>resolve(Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}}}));});
  await cell('bounded-timeout',{timeoutMs:25},'parent','medium',1);
  release!();pending=undefined;
  // Public off/on command during a classifier barrier invalidates the admission
  // generation even though enabled is true again when the response arrives.
  let enter!:()=>void;const barrier=new Promise<void>(resolve=>{enter=resolve;});entered=enter;
  pending=new Promise<Response>(resolve=>{release=()=>resolve(Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}}}));});
  const flight=cell('off-on-deferred',{},'parent','medium',1);
  await bounded(barrier,'classifier entered');
  await f.parent.prompt('/jev-subagent-router off');
  await f.parent.prompt('/jev-subagent-router on');
  release!();await flight;pending=undefined;
  const generationBarrier=new Promise<void>(resolve=>{entered=resolve;});
  pending=new Promise<Response>(resolve=>{release=()=>resolve(Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}}}));});
  const generationFlight=cell('config-generation-deferred',{},'parent','medium',1);
  await bounded(generationBarrier,'generation classifier entered');
  await writeFile(configFile,JSON.stringify({...base,mode:'notify'}));
  await f.parent.prompt('/jev-subagent-router status');release!();await generationFlight;pending=undefined;
  // A genuine host operation cancellation while the real service is waiting.
  await writeFile(configFile,JSON.stringify(base));await f.parent.prompt('/jev-subagent-router status');
  const cancelBarrier=new Promise<void>(resolve=>{entered=resolve;});
  pending=new Promise<Response>(resolve=>{release=()=>resolve(Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}}}));});
  const beforeCancel=f.witnesses.length;
  f.enqueue({id:'host-cancel-deferred',name:'Agent',arguments:{subagent_type:'omitted',description:'host-cancel-deferred',prompt:'PRIVATE-host-cancel-deferred',isolated:true}});
  const cancelled=f.parent.prompt('Execute the deterministic native call host-cancel-deferred');
  await bounded(cancelBarrier,'cancel classifier entered');await bounded(f.parent.abort(),'public host abort');release!();await bounded(cancelled,'cancelled parent settlement');pending=undefined;
  check(f.witnesses.length===beforeCancel,'Cancelled classification executed a child');
  const cancelledMutation=f.mutations.get('host-cancel-deferred');
  check(cancelledMutation&&!('model' in cancelledMutation.after)&&!('thinking' in cancelledMutation.after),'Cancelled classification injected stale settings');
  await cell('why-old-launch',{},'allowed','high',1,{prompt:'valid old native task'},'keep');
  await f.parent.prompt('/jev-subagent-router why');
  check((requests.at(-1) as any).state.request==='Agent: omitted\nTask:\nvalid old native task','First native launch was not remembered');
  const full=' '.repeat(4096)+'actualnewtask';
  await cell('why-leading-space-launch',{},'allowed','high',1,{prompt:full},'preserve');
  const executions=f.witnesses.length,beforeWhy=requests.length;
  await f.parent.prompt('/jev-subagent-router why');
  check(notices.at(-1)?.includes(`cached task truncated: ${full.length} → 4096`),'Native why lost original count/truncation label');
  check(requests.length===beforeWhy+1,'Why did not evaluate new task');
  check((requests.at(-1) as any).state.request==='Agent: omitted\nTask:\n'+' '.repeat(4096),'Why used previous task or reconstructed suffix');
  check(f.witnesses.length===executions,'Why launched another child');
  check(!JSON.stringify(notices).includes('PRIVATE-'),'Notifications echo raw native task');
  check(!JSON.stringify(notices).includes('fixture-secret'),'Notifications expose API key');
  const cards=f.parent.sessionManager.getBranch().filter((e:any)=>e.type==='custom');
  check(!JSON.stringify(cards).includes('PRIVATE-')&&!JSON.stringify(cards).includes('fixture-secret'),'Durable cards echo tasks or key');
  return {cells,requests:requests.length,hostCancel:{childExecutions:0,staleInjection:false},parentPreserved:true};
 },{extensionPaths:paths,childCost:.2,afterPrepare:async({cwd})=>{
  const copy=join(cwd,'production-package');await mkdir(copy);
  for(const name of ['src','extensions','package.json'])await cp(join(source,name),join(copy,name),{recursive:true});
  await mkdir(join(copy,'node_modules','@earendil-works'),{recursive:true});
  for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-agent-core','@earendil-works/pi-tui','typebox'])await symlink(name==='@earendil-works/pi-coding-agent'?host:await dependencyPackageRoot(name,host),join(copy,'node_modules',name));
  paths.push(join(copy,'extensions/pi-jev-subagent-router/index.ts'));
  configFile=join(cwd,'.pi','pi-jev-subagent-router.json');ledgerFile=join(cwd,'ledger.json');
  await writeFile(configFile,JSON.stringify({apiKey:'fixture-secret',endpoint:'https://jev-fixture.invalid',timeoutMs:1000,useDefaultModels:false,kindModels:{},kindMinimumTier:{implement:'high'},routes:{high:[{provider:'jev-compat-allowed',model:'allowed',thinkingLevel:'high'}],standard:[{provider:'jev-compat-parent',model:'parent',thinkingLevel:'off'}]},stateFile:ledgerFile}));
 },classifier:body=>{requests.push(body);entered?.();entered=undefined;return pending??failureResponse?.clone()??Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:3,output_tokens:2}});}});
 return report;
}
async function aggregate(){
 const host=process.env.PI_PROBE_HOST_ROOT!,source=resolve('.'),paths:string[]=[];let ledgerFile='',issued=false;
 return withNativeFixture({hostRoot:host,tintinRoot:resolve('node_modules/@tintinweb/pi-subagents')},async f=>{
  const pair={model:f.parent.model.id,provider:f.parent.model.provider,thinking:f.parent.thinkingLevel};
  const record=await bounded(nativeCall(f.parent,{id:'ancestor',name:'Agent',arguments:{subagent_type:'nest-parent',description:'ancestor',prompt:'AGGREGATE-ANCESTOR',isolated:false,inherit_context:false}},f.enqueue),'nested native Agent');
  await bounded(f.registry.waitForAll(),'nested settlement');
  await f.parent.prompt('/jev-subagent-router status');
  check(issued,'Provider did not issue nested Agent');
  const own=f.witnesses.filter((w:any)=>w.prompt.includes('AGGREGATE-ANCESTOR'));
  const descendants=f.witnesses.filter((w:any)=>w.prompt.includes('AGGREGATE-DESCENDANT')&&!w.prompt.includes('AGGREGATE-ANCESTOR'));
  check(own.length===2&&descendants.length===1,`Nested provider counts ${JSON.stringify(f.witnesses)}`);
  check(own.every((w:any)=>w.model.provider==='jev-compat-allowed'&&w.model.id==='allowed'&&w.thinking==='high')&&descendants[0].model.provider==='jev-compat-allowed'&&descendants[0].model.id==='allowed'&&descendants[0].thinking==='medium','Nested provider/level witness mismatch');
  const childReceipt=record.session.messages.find((m:any)=>m.role==='toolResult'&&m.toolCallId==='descendant-call');
  check(childReceipt&&!childReceipt.isError&&childReceipt.content.some((c:any)=>c.text?.includes('Native fixture answer.')),'Actual nested public tool receipt absent');
  const ledger=JSON.parse(await readFile(ledgerFile,'utf8'));
  const origins=Object.values(ledger.accounting.records) as any[];
  // Inspect real public record totals; never manually assign lifetimeUsage.
  console.log(JSON.stringify({aggregatePublicRecord:{id:record.id,lifetimeUsage:record.lifetimeUsage},origins,witnesses:f.witnesses}));
  check(record.lifetimeUsage.cost===.375,`Ancestor did not aggregate descendant cost: ${JSON.stringify(record.lifetimeUsage)}`);
  check(origins.length===1&&origins[0].accountedUsd==='0.375','Observer charged descendant separately or lost aggregate');
  await f.parent.prompt('/jev-subagent-router status');
  check(JSON.stringify(JSON.parse(await readFile(ledgerFile,'utf8')).accounting.records)===JSON.stringify(ledger.accounting.records),'Replay charged aggregate twice');
  check(f.parent.model.id===pair.model&&f.parent.model.provider===pair.provider&&f.parent.thinkingLevel===pair.thinking&&await f.settingsUnchanged(),'Nested call mutated parent/settings');
  return {aggregate:true,ancestorOwnTurns:2,descendantTurns:1,reportedUsd:'0.375',origins:1};
 },{extensionPaths:paths,childCost:.125,childToolCall:(prompt,context)=>{
  if(prompt.includes('AGGREGATE-ANCESTOR')&&!issued){
   issued=true;
   return {id:'descendant-call',name:'Agent',arguments:{subagent_type:'nest-leaf',description:'descendant',prompt:'AGGREGATE-DESCENDANT',isolated:true,inherit_context:false}};
  }
 },afterPrepare:async({cwd})=>{
  const copy=join(cwd,'production-package');await mkdir(copy);
  for(const name of ['src','extensions','package.json'])await cp(join(source,name),join(copy,name),{recursive:true});
  await mkdir(join(copy,'node_modules','@earendil-works'),{recursive:true});
  for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-agent-core','@earendil-works/pi-tui','typebox'])await symlink(name==='@earendil-works/pi-coding-agent'?host:await dependencyPackageRoot(name,host),join(copy,'node_modules',name));
  paths.push(join(copy,'extensions/pi-jev-subagent-router/index.ts'));
  const nativeConfig=join(cwd,'.pi','subagents.json'),settings=JSON.parse(await readFile(nativeConfig,'utf8'));settings.maxSubagentDepth=3;await writeFile(nativeConfig,JSON.stringify(settings));
  await writeFile(join(cwd,'.pi','agents','nest-parent.md'),'---\nname: nest-parent\ndescription: Nested aggregate fixture\ntools: Agent\nallowed_subagents: [nest-leaf]\nextensions: false\nskills: false\nisolated: false\n---\nDelegate once.\n');
  await writeFile(join(cwd,'.pi','agents','nest-leaf.md'),'---\nname: nest-leaf\ndescription: Aggregate leaf\ntools: none\nextensions: false\nskills: false\n---\nAnswer locally.\n');
  ledgerFile=join(cwd,'aggregate-ledger.json');await writeFile(join(cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify({apiKey:'fake',endpoint:'https://jev-fixture.invalid',useDefaultModels:false,kindModels:{},routes:{high:[{provider:'jev-compat-allowed',model:'allowed',thinkingLevel:'high'}]},stateFile:ledgerFile}));
 },classifier:()=>Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}}})});
}
if(process.argv.includes('--aggregate-child')){
 try{console.log(JSON.stringify(await aggregate()));}catch(error){console.error(error);process.exitCode=1;}
}else if(process.argv.includes('--parity-native-child')){
 try{console.log(JSON.stringify(await matrix()));}catch(error){console.error(error);process.exitCode=1;}
}else test('production native parity modes, scope, placeholders, deadline and off-on admission',async()=>{
 const spec=isolatedChild('run',[resolve(import.meta.path),'--parity-native-child']);
 const child=Bun.spawn(spec.argv,{env:spec.env,stdout:'pipe',stderr:'pipe'});
 const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 expect({exit,err}).toEqual({exit:0,err:''});
 const report=JSON.parse(out);expect(report.cells).toHaveLength(15);
 expect(report).toMatchObject({parentPreserved:true,shutdownListenerCount:0,networkFetchAttempts:0});
 console.log(JSON.stringify(report));
},120_000);
if(!process.argv.includes('--parity-native-child')&&!process.argv.includes('--aggregate-child'))test('production native ancestor includes descendant cost exactly once',async()=>{
 const spec=isolatedChild('run',[resolve(import.meta.path),'--aggregate-child']);const child=Bun.spawn(spec.argv,{env:spec.env,stdout:'pipe',stderr:'pipe'});
 const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 console.log(out);expect({exit,err}).toEqual({exit:0,err:''});
 const report=JSON.parse(out.trim().split('\n').at(-1)!);expect(report).toMatchObject({aggregate:true,origins:1,reportedUsd:'0.375',shutdownListenerCount:0,networkFetchAttempts:0});
},120_000);
