import { expect, test } from 'bun:test';
import { readFile, writeFile, cp, mkdir, symlink, realpath } from 'node:fs/promises';
import { declaredPublicEntry, dependencyPackageRoot } from '../../scripts/probe/public-package';
import { join, resolve } from 'node:path';
import { withNativeFixture, bounded, check } from '../../scripts/compatibility-probe';
import { nativeCall } from '../../scripts/probe/tintin-native';
import { isolatedChild } from '../support/isolated-child';

async function productionFixture(patched:boolean){
 const host=patched?process.env.PI_PATCHED_HOST_ROOT:process.env.PI_PROBE_HOST_ROOT;
 const tintin=patched?process.env.PI_PATCHED_TINTIN_ROOT:resolve('node_modules/@tintinweb/pi-subagents');
 check(host && tintin,'Explicit native roots required');let file='',configFile='',evaluations=0,firstChild:any;
 const requests:unknown[]=[],extensionPaths:string[]=[],source=resolve('.');
 return withNativeFixture({hostRoot:host,tintinRoot:tintin},async f=>{
  const notices:string[]=[];
  await f.parent.bindExtensions({mode:'json',uiContext:{notify:(text:string)=>notices.push(text),setWidget:()=>{},setStatus:()=>{},setTitle:()=>{},select:async()=>undefined,confirm:async()=>false,input:async()=>undefined,editor:async()=>undefined}});
  const pair={model:f.parent.model.id,thinking:f.parent.thinkingLevel};
  const counts:{definition:string;model:string;thinking:string;nativeExecutions:number;classified:number}[]=[];
  for(const [definition,fields,model,thinking] of [
   ['omitted',{},'allowed','high'],
   ['omitted',{model:'jev-compat-parent/parent'},'parent','high'],
   ['omitted',{thinking:'off'},'allowed','off'],
   ['model',{},'allowed','high'],
   ['thinking',{},'allowed','high'],
   ['both',{model:'jev-compat-parent/parent',thinking:'off'},'allowed','high'],
   ['omitted',{model:'jev-compat-parent/parent',thinking:'off'},'parent','off'],
  ] as const){
   if(counts.length===1){
    const leaf=f.parent.sessionManager.getLeafId(),target=f.parent.sessionManager.getBranch().find((entry:any)=>entry.id!==leaf);
    check(target,'Native cancelled-tree target missing');
    const branch=JSON.stringify(f.parent.sessionManager.getBranch());
    const cancelled=await f.parent.navigateTree(target.id,{summarize:false});
    check(cancelled.cancelled===true,'Public native tree hook did not cancel');
    check(JSON.stringify(f.parent.sessionManager.getBranch())===branch,'Cancelled tree changed branch');
    // No command or completion/start event before the NEXT native Agent. The
    // normal precedence/classification/origin checks below must recover.
   }
   const id:string=`production-${counts.length}`,start=f.witnesses.length,before=evaluations;
   const input={subagent_type:definition,description:id,prompt:`PRIVATE-NATIVE-${id}`,isolated:true,inherit_context:false,...fields};
   const record:any=await bounded(nativeCall(f.parent,{id,name:'Agent',arguments:input},f.enqueue),'production native Agent');
   await bounded(f.registry.waitForAll(),'child settlement');
   if(!firstChild)firstChild=record;
   const observed=f.witnesses.slice(start);check(observed.length===1,'Production routing duplicated child execution');
   check(observed[0].model.id===model && observed[0].thinking===thinking,`Production default/definition precedence failed: ${JSON.stringify(observed)}`);
   check(record.session.model.id===model,'Actual child model mismatch');
   check(f.parent.model.id===pair.model && f.parent.thinkingLevel===pair.thinking,'Parent pair mutated');
   check(await f.settingsUnchanged(),'Personal/default settings mutated');
   const receipt=f.parent.messages.find((m:any)=>m.role==='toolResult' && m.toolCallId===id);
   check(receipt.content.some((c:any)=>c.text?.includes('Native fixture answer.')),'Native output changed');
   const result=await f.parent.prompt('/jev-subagent-router status');
   const accounting=JSON.parse(await readFile(file,'utf8'));
   check(Object.values(accounting.accounting.records).length===counts.length+1,'Production observer did not correlate child');
   check(Object.values(accounting.accounting.records).every((r:any)=>r.accountedUsd==='0.2'),`Actual production cost not captured: ${JSON.stringify(accounting.accounting.records)}`);
   const both='model' in fields && 'thinking' in fields;
   check(evaluations-before===(both?0:1),'Both-explicit call classified or eligible launch skipped');
   counts.push({definition,model,thinking,nativeExecutions:observed.length,classified:evaluations-before});
  }
  const before=f.witnesses.length,evals=evaluations;
  await f.parent.prompt('/jev-subagent-route Recommendation only, do not execute a child');
  check(f.witnesses.length===before && evaluations===evals+1,'Recommendation launched child or failed to evaluate');
   await f.parent.prompt('/jev-subagent-router why');
   check(evaluations===evals+2,'Why did not reclassify the last eligible native child task');
   check((requests.at(-1) as any).state.request==='Agent: thinking\nTask:\nPRIVATE-NATIVE-production-4','Why did not preserve original eligible launch task and agent identity');
   check((requests.at(-1) as any).state.conversation_excerpt===null,'Why used parent history');
   check(f.witnesses.length===before,'Why executed another child');
   check(notices.at(-1)?.includes('complexity'),'Why omitted fresh analysis');
  const ledger=JSON.parse(await readFile(file,'utf8'));
  check(ledger.jev.requests===evaluations,'Both production engines not durably wired');
  check(!JSON.stringify(ledger).includes('PRIVATE-NATIVE'),'Raw tasks persisted to ledger');
  const entries=f.parent.sessionManager.getBranch().filter((e:any)=>e.type==='custom');
  check(entries.some((e:any)=>e.customType==='jev-subagent-router-decision'),'Production projected decision entries absent');
  check(!JSON.stringify(entries).includes('PRIVATE-NATIVE'),'Raw tasks persisted to custom entries');
  check(f.parent.sessionManager.getBranch().filter((e:any)=>e.type==='model_change'||e.type==='thinking_level_change').length===2,'Parent configuration entries changed');
  let controlled=false;
  if(patched){
   const before={model:firstChild.session.model.id,thinking:firstChild.session.thinkingLevel},entries=JSON.stringify(firstChild.session.sessionManager.getEntries()),messages=JSON.stringify(firstChild.session.messages);
   const config=JSON.parse(await readFile(configFile,'utf8'));config.routes.high=[{provider:'jev-compat-parent',model:'parent',thinkingLevel:'off'}];config.stickiness=false;
   await writeFile(configFile,JSON.stringify(config));
   await f.parent.prompt(`/jev-subagent-router apply ${firstChild.id} -- Explicit retained task, never submit it to the child`);
   check(firstChild.session.model.id==='parent' && firstChild.session.thinkingLevel==='off',`Patched production command apply did not commit: ${notices.at(-1)}`);
   check(f.witnesses.length===7,'Apply launched child');
   await f.parent.prompt(`/jev-subagent-router revert ${firstChild.id}`);
   check(firstChild.session.model.id===before.model && firstChild.session.thinkingLevel===before.thinking,'Patched command revert did not restore exact pair');
   check(JSON.stringify(firstChild.session.messages)===messages,'Control submitted a child prompt');
   check(firstChild.session.sessionManager.getEntries().length===JSON.parse(entries).length+4,'Control did not append exact two pairs');
   check(await f.settingsUnchanged(),'Control changed global settings');controlled=true;
  }
  return {production:true,cancelledTreeRecovered:true,patched,cells:counts,evaluations,recommendationOnly:true,origins:7,reported:'1.4',controlled,control:typeof f.registry.configureIdleChild==='function'?'available':'unsupported',parentPreserved:true,rawTasksAbsent:true};
 },{extensionPaths,childCost:.2,
  afterPrepare:async({cwd,agentDir})=>{
   // Byte-identical production source copy, with only selected PUBLIC package
   // roots symlinked read-only. Bun native resolution otherwise finds published
   // workspace peers even when the loader itself is the patched public SDK.
   const copy=join(cwd,'production-package');await mkdir(copy);
   for(const name of ['src','extensions','package.json'])await cp(join(source,name),join(copy,name),{recursive:true});
   await mkdir(join(copy,'node_modules','@earendil-works'),{recursive:true});
   for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-agent-core','@earendil-works/pi-tui','typebox']){
    const root=name==='@earendil-works/pi-coding-agent'?host:await dependencyPackageRoot(name,host);
    await symlink(root,join(copy,'node_modules',name));
   }
   check(await realpath(await declaredPublicEntry(await dependencyPackageRoot('@earendil-works/pi-coding-agent',copy)))===await realpath(await declaredPublicEntry(host)),'Production entry resolves wrong public SDK');
   extensionPaths.push(join(copy,'extensions/pi-jev-subagent-router/index.ts'));
   const cancel=join(cwd,'cancel-tree.ts');
   await writeFile(cancel,`export default function(pi){pi.on('session_before_tree',()=>({cancel:true}));}`);
   extensionPaths.push(cancel);
   file=join(cwd,'child-ledger.json');configFile=join(cwd,'.pi','pi-jev-subagent-router.json');await writeFile(configFile,JSON.stringify({apiKey:'fake',endpoint:'https://jev-fixture.invalid',useDefaultModels:false,kindModels:{},kindMinimumTier:{implement:'high'},routes:{high:[{provider:'jev-compat-allowed',model:'allowed',thinkingLevel:'high'}]},stateFile:file}));},
  classifier:body=>{requests.push(body);evaluations++;return Response.json({answers:{task_kind:{choice:'implement',confidence:.99},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:3,output_tokens:2}});},
 });
}
if(process.argv.includes('--extension-child')){
 try{console.log(JSON.stringify(await productionFixture(process.argv.includes('--patched'))));}catch(e){console.error(e);process.exitCode=1;}
}else for(const patched of [false,true])test(`production extension factory native routing, observation and commands (${patched?'patched':'published'})`,async()=>{
 const spec=isolatedChild('run',[resolve(import.meta.path),'--extension-child',...(patched?['--patched']:[])]),child=Bun.spawn(spec.argv,{env:spec.env,stdout:'pipe',stderr:'pipe'});
 const timer=setTimeout(()=>child.kill(),90_000);
 try{const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect({exit,err}).toEqual({exit:0,err:''});const report=JSON.parse(out);expect(report).toMatchObject({production:true,cancelledTreeRecovered:true,patched,recommendationOnly:true,origins:7,parentPreserved:true,rawTasksAbsent:true,shutdownListenerCount:0,networkFetchAttempts:0});expect(report.cells).toHaveLength(7);expect(report.controlled).toBe(patched);}
 finally{clearTimeout(timer);}
},95_000);
