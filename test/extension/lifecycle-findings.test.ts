import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../../extensions/pi-jev-subagent-router/index';
import { ExtensionCoordinator } from '../../src/extension/coordinator';
import { CommandRouter, type CommandServices } from '../../src/commands';
import { ChildController } from '../../src/children/controller';
import { AccountingStore } from '../../src/state/accounting';

function deferred() {let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
async function fixture() {
 const cwd=await mkdtemp(join(tmpdir(),'extension-findings-'));await mkdir(join(cwd,'.pi'));
 const config={apiKey:'fake',endpoint:'https://fixture.invalid',useDefaultModels:false,kindModels:{},routes:{high:[{provider:'p',model:'m'}]},stateFile:'ledger.json'};
 const file=join(cwd,'.pi','pi-jev-subagent-router.json');await writeFile(file,JSON.stringify(config));
 const handlers=new Map<string,Function[]>(),commands=new Map<string,any>(),tools=new Map<string,any>(),entries:any[]=[],notices:string[]=[];
 const bus=new Map<string,Set<Function>>();
 const events={on(channel:string,fn:Function){const group=bus.get(channel)??new Set();group.add(fn);bus.set(channel,group);return()=>{group.delete(fn);};},emit(channel:string,event:any){for(const fn of bus.get(channel)??[])fn(event);}};
 const ctx:any={cwd,isProjectTrusted:()=>true,hasUI:false,ui:{notify:(text:string)=>{notices.push(text);}},modelRegistry:{getAll:()=>[{provider:'p',id:'m'}],getAvailable:()=>[{provider:'p',id:'m'}]},sessionManager:{getSessionId:()=> 'parent',getBranch:()=>[]}};
 const pi:any={events,on(name:string,fn:Function){const group=handlers.get(name)??[];group.push(fn);handlers.set(name,group);},registerCommand:(name:string,definition:any)=>commands.set(name,definition),registerTool:(tool:any)=>tools.set(tool.name,tool),appendEntry:(type:string,data:any)=>{entries.push({type,data});},getAllTools:()=>[]};
 const emit=async(name:string,event:any={},context=ctx)=>{for(const fn of handlers.get(name)??[])expect(await fn(event,context)).toBeUndefined();};
 const session:any={sessionId:'sdk',subscribe:()=>()=>{},isIdle:true,model:{provider:'p',id:'m'},thinkingLevel:'off',getContextUsage:()=>({tokens:0}),sessionManager:{getCwd:()=>cwd}};
 const record={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:.2},session};
 return {cwd,file,config,commands,tools,entries,notices,pi,ctx,emit,record,bus};
}
const classified=()=>Response.json({answers:{task_kind:{choice:'implement',confidence:.9},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:3,output_tokens:2}});
async function routingFixture() {
 const f=await fixture();
 f.pi.getAllTools=()=>[{name:'Agent',description:'native',parameters:{type:'object',required:['prompt','description','subagent_type'],properties:Object.fromEntries(['prompt','description','subagent_type','model','thinking','resume'].map(key=>[key,{type:'string'}]))}}];
 const off=f.pi.events.on('subagents:rpc:ping',(event:any)=>f.pi.events.emit(`subagents:rpc:ping:reply:${event.requestId}`,{success:true,data:{version:2}}));
 return {...f,off,count:()=>[...f.bus.values()].reduce((n,group)=>n+group.size,0)};
}
const manager=Symbol.for('pi-subagents:manager');
function registry(record:unknown) {const previous=(globalThis as any)[manager];(globalThis as any)[manager]={getRecord:(id:string)=>id==='child'?record:undefined};return()=>{if(previous===undefined)delete (globalThis as any)[manager];else (globalThis as any)[manager]=previous;};}

const interrupted=['session_before_switch','session_before_fork','session_before_tree','session_before_compact','failed-compaction'] as const;
for(const transition of interrupted)for(const explicit of [false,true])
 test(`ordinary validated Agent reacquires after ${transition}, both-explicit=${explicit}`,async()=>{
  const f=await routingFixture(),restore=registry(f.record),fetch=globalThis.fetch,toolCall=ExtensionCoordinator.prototype.toolCall;
  const owners:ExtensionCoordinator[]=[];let evaluations=0,subscriptions=0,unsubscribed=0;
  f.record.session.subscribe=()=>{subscriptions++;return()=>{unsubscribed++;};};
  ExtensionCoordinator.prototype.toolCall=async function(...args){owners.push(this);return toolCall.apply(this,args);};
  globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof globalThis.fetch;
  extension(f.pi);await f.emit('session_start');
  try{
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'old',input:{prompt:'OLD',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'}});
   await f.emit('tool_result',{toolName:'Agent',toolCallId:'old',details:{agentId:'child'}});await owners[0].flush();
   const old=owners[0],generation=old.getRuntime().generation,oldListeners=[...f.bus.values()].flatMap(group=>[...group]);
   expect(subscriptions).toBe(1);
   await f.emit(transition==='failed-compaction'?'session_before_compact':transition);
   // Cancellation/failure has NO session_start/tree/compact follow-up. Only a
   // new validated public operation supplies a fresh (non-aborted) context.
   expect(f.count()).toBe(1);expect(unsubscribed).toBe(1);
   const stale=new AbortController();stale.abort();
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'aborted',input:{prompt:'ABORTED',description:'d',subagent_type:'probe'}},{...f.ctx,signal:stale.signal});
   expect(owners).toHaveLength(1);expect(f.count()).toBe(1);
   const fresh={...f.ctx,signal:new AbortController().signal};
   const input:any={prompt:'NEW',description:'d',subagent_type:'probe',...(explicit?{model:'p/m',thinking:'off'}:{})};
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'new',input},fresh);
   const current=owners.at(-1)!;expect(current).not.toBe(old);expect(current.getRuntime().generation).toBeGreaterThan(generation);
   expect(evaluations).toBe(explicit?0:1);expect(input.model).toBe('p/m');
   await f.emit('tool_result',{toolName:'Agent',toolCallId:'new',details:{agentId:'child'}});await current.flush();
   expect(current.getBinding('child')?.toolCallId).toBe('new');expect(old.getBinding('child')).toBeUndefined();
   expect(subscriptions).toBe(2);expect(f.count()).toBe(5);expect(owners).toHaveLength(2);
   const entries=f.entries.length;
   for(const callback of oldListeners)callback({type:'ignored',agentId:'child'});
   await old.flush();expect(f.entries.length).toBe(entries);
   expect(JSON.parse(await readFile(join(f.cwd,'ledger.json'),'utf8')).accounting.records).toBeDefined();
  }finally{await f.emit('session_shutdown');expect(f.count()).toBe(1);expect(unsubscribed).toBe(subscriptions);f.off();restore();globalThis.fetch=fetch;ExtensionCoordinator.prototype.toolCall=toolCall;}
 });

for(const transition of interrupted)
 test(`pending old classification cannot mutate recovery after ${transition}`,async()=>{
  const f=await routingFixture(),fetch=globalThis.fetch,entered=deferred(),held=deferred();let evaluations=0;
  globalThis.fetch=(async()=>{if(++evaluations===1){entered.resolve();await held.promise;}return classified();}) as unknown as typeof globalThis.fetch;
  extension(f.pi);await f.emit('session_start');const input:any={prompt:'OLD',description:'d',subagent_type:'probe'};
  try{
   const pending=f.emit('tool_call',{toolName:'Agent',toolCallId:'old',input});await entered.promise;
   await f.emit(transition==='failed-compaction'?'session_before_compact':transition);
   const fresh:any={prompt:'NEW',description:'d',subagent_type:'probe'};
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'new',input:fresh},{...f.ctx,signal:new AbortController().signal});
   expect(fresh.model).toBe('p/m');const entries=f.entries.length,ledger=await readFile(join(f.cwd,'ledger.json'),'utf8');
   held.resolve();await pending;
   expect(input).toEqual({prompt:'OLD',description:'d',subagent_type:'probe'});expect(f.entries.length).toBe(entries);
   expect(await readFile(join(f.cwd,'ledger.json'),'utf8')).toBe(ledger);expect(JSON.parse(ledger).jev.requests).toBe(1);
  }finally{held.resolve();await f.emit('session_shutdown');f.off();globalThis.fetch=fetch;}
 });

for(const transition of interrupted)
 test(`same-owner recovery preserves session off/mode/budget overrides after ${transition}`,async()=>{
  const f=await routingFixture(),fetch=globalThis.fetch,toolCall=ExtensionCoordinator.prototype.toolCall;let current:ExtensionCoordinator|undefined,evaluations=0;
  ExtensionCoordinator.prototype.toolCall=async function(...args){current=this;return toolCall.apply(this,args);};
  globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof globalThis.fetch;
  extension(f.pi);await f.emit('session_start');
  try{
   for(const args of ['off','mode confirm','budget daily 2'])await f.commands.get('jev-subagent-router').handler(args,f.ctx);
   await f.emit(transition==='failed-compaction'?'session_before_compact':transition);
   // Fresh external config is still read; do not pin the entire old config.
   await writeFile(f.file,JSON.stringify({...f.config,stateFile:'new-ledger.json'}));
   const input={prompt:'NEW',description:'d',subagent_type:'probe'};
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'new',input},{...f.ctx});
   expect(current?.getRuntime().config).toMatchObject({enabled:false,mode:'confirm',budget:{dailyUsd:2},stateFile:join(f.cwd,'new-ledger.json')});
   expect(evaluations).toBe(0);expect(input).not.toHaveProperty('model');expect(f.count()).toBe(5);
  }finally{await f.emit('session_shutdown');f.off();globalThis.fetch=fetch;ExtensionCoordinator.prototype.toolCall=toolCall;}
 });

test('stray calls cannot acquire before start or after shutdown, and a real start recovers',async()=>{
 const f=await routingFixture(),fetch=globalThis.fetch;let evaluations=0;
 globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof globalThis.fetch;
 extension(f.pi);
 try{
  for(const state of ['unstarted','shutdown']){
   if(state==='shutdown'){await f.emit('session_start');await f.emit('session_shutdown');}
   for(const transition of interrupted)await f.emit(transition==='failed-compaction'?'session_before_compact':transition);
   await f.emit('session_tree');await f.emit('session_compact');
   await f.commands.get('jev-subagent-router').handler('status',f.ctx);
   const input={prompt:'STRAY',description:'d',subagent_type:'probe'};await f.emit('tool_call',{toolName:'Agent',toolCallId:state,input});
   expect(f.count()).toBe(1);expect(evaluations).toBe(0);expect(input).not.toHaveProperty('model');
  }
  await f.emit('session_start');const input:any={prompt:'REAL',description:'d',subagent_type:'probe'};
  await f.emit('tool_call',{toolName:'Agent',toolCallId:'real',input});expect(input.model).toBe('p/m');expect(evaluations).toBe(1);
 }finally{await f.emit('session_shutdown');f.off();globalThis.fetch=fetch;}
});

test('recovery never transfers session overrides to a different owner or successful start',async()=>{
 const f=await routingFixture(),toolCall=ExtensionCoordinator.prototype.toolCall;let current:ExtensionCoordinator|undefined;
 ExtensionCoordinator.prototype.toolCall=async function(...args){current=this;return toolCall.apply(this,args);};extension(f.pi);await f.emit('session_start');
 try{
  await f.commands.get('jev-subagent-router').handler('off',f.ctx);await f.emit('session_before_switch');
  const other={...f.ctx,sessionManager:{...f.ctx.sessionManager,getSessionId:()=> 'other'}};
  await f.emit('tool_call',{toolName:'bash',toolCallId:'other',input:{command:'unchanged'}},other);expect(current?.getRuntime().config.enabled).toBe(true);
  await f.commands.get('jev-subagent-router').handler('off',other);await f.emit('session_start',{},other);
  await f.emit('tool_call',{toolName:'bash',toolCallId:'started',input:{command:'unchanged'}},other);expect(current?.getRuntime().config.enabled).toBe(true);
 }finally{await f.emit('session_shutdown');f.off();ExtensionCoordinator.prototype.toolCall=toolCall;}
});

for(const args of ['off','mode confirm','suggest --write','apply child -- PRIVATE','revert child','route'])
 test(`registered command held in accounting drain refuses same-service generation replacement: ${args}`,async()=>{
  const f=await fixture(),restore=registry(f.record),entered=deferred(),held=deferred();
  const originalCommand=CommandRouter.prototype.command,originalRoute=CommandRouter.prototype.route,originalApply=ChildController.prototype.apply,originalRevert=ChildController.prototype.revert,observe=AccountingStore.prototype.observe,fetch=globalThis.fetch;
  let delegated=0,controlled=0,classifications=0;
  CommandRouter.prototype.command=async function(...values){delegated++;return originalCommand.apply(this,values);};
  CommandRouter.prototype.route=async function(...values){delegated++;return originalRoute.apply(this,values);};
  ChildController.prototype.apply=async function(...values){controlled++;return originalApply.apply(this,values);};
  ChildController.prototype.revert=async function(...values){controlled++;return originalRevert.apply(this,values);};
  globalThis.fetch=(async()=>{classifications++;throw Error('classification forbidden');}) as unknown as typeof globalThis.fetch;
  // Hold an actual enqueued accounting observation, not an optional UI/entry
  // callback whose return value the synchronous public host discards.
  AccountingStore.prototype.observe=async function(...values){entered.resolve();await held.promise;return observe.apply(this,values);};
  extension(f.pi);await f.emit('session_start');
  try {
   const input={prompt:'PRIVATE',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'};
   await f.emit('tool_call',{toolName:'Agent',toolCallId:'spawn',input});
   await f.emit('tool_result',{toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await entered.promise;
   let finished=false;
   const work=f.commands.get(args==='route'?'jev-subagent-route':'jev-subagent-router').handler(args==='route'?'PRIVATE':args,f.ctx).then(()=>{finished=true;});
   // refresh() observes policy changes and replaces commands on the SAME owner.
   await writeFile(f.file,JSON.stringify({...f.config,mode:'notify'}));
   await f.emit('tool_call',{toolName:'bash',toolCallId:'refresh',input:{command:'unchanged'}});
   expect(finished).toBe(false);held.resolve();await work;
   expect(delegated).toBe(0);expect(controlled).toBe(0);expect(classifications).toBe(0);
   expect(f.notices).toEqual([]);expect(input).toEqual({prompt:'PRIVATE',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'});
   expect(JSON.parse(await readFile(f.file,'utf8')).mode).toBe('notify');
   expect(existsSync(join(f.cwd,'.pi','pi-jev-subagent-router.generated.json'))).toBe(false);
  } finally {held.resolve();await f.emit('session_shutdown');restore();CommandRouter.prototype.command=originalCommand;CommandRouter.prototype.route=originalRoute;ChildController.prototype.apply=originalApply;ChildController.prototype.revert=originalRevert;AccountingStore.prototype.observe=observe;globalThis.fetch=fetch;}
 });

for(const invalidate of ['advance','dispose','shutdown'] as const)
 test(`post-drain runtime getter reentrancy cannot authorize delegation: ${invalidate}`,async()=>{
  const f=await fixture(),runtime=ExtensionCoordinator.prototype.getRuntime,flush=ExtensionCoordinator.prototype.flush,command=CommandRouter.prototype.command;
  let armed=false,reentered=false,delegated=0;
  ExtensionCoordinator.prototype.flush=async function(){await flush.call(this);armed=true;};
  ExtensionCoordinator.prototype.getRuntime=function(){const snapshot=runtime.call(this);if(armed && !reentered){reentered=true;if(invalidate==='advance')this.updateRuntime({mode:'notify'},snapshot);else if(invalidate==='dispose')this.dispose();else void f.emit('session_shutdown');}return snapshot;};
  CommandRouter.prototype.command=async function(...args){delegated++;return command.apply(this,args);};
  extension(f.pi);await f.emit('session_start');
  try{await f.commands.get('jev-subagent-router').handler('off',f.ctx);expect(reentered).toBe(true);expect(delegated).toBe(0);expect(f.notices).toEqual([]);}
  finally{armed=false;ExtensionCoordinator.prototype.getRuntime=runtime;ExtensionCoordinator.prototype.flush=flush;CommandRouter.prototype.command=command;await f.emit('session_shutdown');}
 });

for(const boundary of ['signal','trust','trust-false','session','cwd','cleanup','stop-runtime','restore','refresh-true'] as const)
 for(const restart of [false,true])
 test(`public command acquisition refuses ${boundary} reentrancy, restart=${restart}`,async()=>{
  const f=await routingFixture(),runtime=ExtensionCoordinator.prototype.getRuntime,refresh=ExtensionCoordinator.prototype.refresh,dispose=ExtensionCoordinator.prototype.dispose,update=ExtensionCoordinator.prototype.updateRuntime,command=CommandRouter.prototype.command,fetch=globalThis.fetch;
  let armed=false,reentered=false,delegated=0,constructed=0,evaluations=0,disposals=0;
  const coordinators=new Set<ExtensionCoordinator>();
  const invalidate=()=>{if(!armed || reentered)return;reentered=true;void f.emit('session_shutdown');if(restart)void f.emit('session_start',{},f.ctx);};
  ExtensionCoordinator.prototype.getRuntime=function(){if(!coordinators.has(this)){coordinators.add(this);constructed++;}const snapshot=runtime.call(this);if(boundary==='stop-runtime')invalidate();return snapshot;};
  ExtensionCoordinator.prototype.dispose=function(){disposals++;if(boundary==='cleanup')invalidate();return dispose.call(this);};
  ExtensionCoordinator.prototype.refresh=function(ctx){if((boundary==='cleanup' || boundary==='stop-runtime') && armed)return false;if(boundary==='refresh-true'){invalidate();return true;}return refresh.call(this,ctx);};
  ExtensionCoordinator.prototype.updateRuntime=function(...args){if(boundary==='restore')invalidate();return update.apply(this,args);};
  CommandRouter.prototype.command=async function(...args){delegated++;return command.apply(this,args);};
  globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof globalThis.fetch;
  extension(f.pi);await f.emit('session_start');
  const context={...f.ctx};
  if(boundary==='signal')Object.defineProperty(context,'signal',{get(){invalidate();return new AbortController().signal;}});
  if(boundary==='trust' || boundary==='trust-false')context.isProjectTrusted=()=>{invalidate();return boundary==='trust';};
  if(boundary==='session')context.sessionManager={...f.ctx.sessionManager,getSessionId:()=>{invalidate();return 'parent';}};
  if(boundary==='cwd')Object.defineProperty(context,'cwd',{get(){invalidate();return f.cwd;}});
  try{
   if(boundary==='restore')await f.commands.get('jev-subagent-router').handler('off',f.ctx);
   if(['signal','cwd','restore'].includes(boundary))await f.emit('session_before_tree');
   const before=constructed;delegated=0;armed=true;
   await f.commands.get('jev-subagent-router').handler('off',context);
   expect(reentered).toBe(true);expect(delegated).toBe(0);expect(evaluations).toBe(0);
   expect(constructed).toBe(before+(restart?1:0)+(boundary==='restore'?1:0));
   expect(f.count()).toBe(restart?5:1);
   expect(f.entries).toEqual([]);expect(existsSync(join(f.cwd,'ledger.json'))).toBe(false);
   expect(existsSync(join(f.cwd,'.pi','pi-jev-subagent-router.generated.json'))).toBe(false);
   // Only the earlier intentional policy command can have notified.
   expect(f.notices).toHaveLength(boundary==='restore'?1:0);
   if(boundary==='restore')expect(disposals).toBe(2); // old owner and unpublished recovery, once each
   if(!restart){
    const input={prompt:'PRIVATE-STRAY',description:'d',subagent_type:'probe'};
    await f.emit('tool_call',{toolName:'Agent',toolCallId:'shutdown-stray',input});
    expect(input).toEqual({prompt:'PRIVATE-STRAY',description:'d',subagent_type:'probe'});
    expect(constructed).toBe(before+(boundary==='restore'?1:0));expect(evaluations).toBe(0);expect(f.count()).toBe(1);
   }
   armed=false;
   if(!restart)await f.emit('session_start');
   await f.commands.get('jev-subagent-router').handler('status',f.ctx);expect(delegated).toBe(1);expect(f.count()).toBe(5);
  }finally{armed=false;await f.emit('session_shutdown');f.off();ExtensionCoordinator.prototype.getRuntime=runtime;ExtensionCoordinator.prototype.refresh=refresh;ExtensionCoordinator.prototype.dispose=dispose;ExtensionCoordinator.prototype.updateRuntime=update;CommandRouter.prototype.command=command;globalThis.fetch=fetch;}
 });

for(const restart of [false,true])
 test(`registered route tool does not enter a replacement after signal invalidation, restart=${restart}`,async()=>{
  const f=await routingFixture(),fetch=globalThis.fetch,route=CommandRouter.prototype.route;let evaluations=0,delegated=0;
  globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof globalThis.fetch;
  CommandRouter.prototype.route=async function(...args){delegated++;return route.apply(this,args);};
  extension(f.pi);await f.emit('session_start');await f.emit('session_before_tree');
  let reentered=false;const context={...f.ctx};Object.defineProperty(context,'signal',{get(){if(!reentered){reentered=true;void f.emit('session_shutdown');if(restart)void f.emit('session_start');}return new AbortController().signal;}});
  try{
   const result=await f.tools.get('jev_subagent_route').execute('probe',{request:'PRIVATE'},undefined,undefined,context);
   expect(reentered).toBe(true);expect(result.isError).toBe(true);expect(delegated).toBe(0);expect(evaluations).toBe(0);
   expect(f.count()).toBe(restart?5:1);expect(f.entries).toEqual([]);expect(f.notices).toEqual([]);expect(existsSync(join(f.cwd,'ledger.json'))).toBe(false);
  }finally{await f.emit('session_shutdown');f.off();globalThis.fetch=fetch;CommandRouter.prototype.route=route;}
 });

for(const boundary of ['session','trust','branch'] as const)for(const restart of [false,true])
 test(`unpublished constructor ${boundary} invalidation cleans exactly once, restart=${restart}`,async()=>{
  const f=await routingFixture(),runtime=ExtensionCoordinator.prototype.getRuntime,dispose=ExtensionCoordinator.prototype.dispose,command=CommandRouter.prototype.command;
  const owners=new Set<ExtensionCoordinator>(),disposed=new Map<ExtensionCoordinator,number>();let delegated=0;
  ExtensionCoordinator.prototype.getRuntime=function(){owners.add(this);return runtime.call(this);};
  ExtensionCoordinator.prototype.dispose=function(){disposed.set(this,(disposed.get(this)??0)+1);return dispose.call(this);};
  CommandRouter.prototype.command=async function(...args){delegated++;return command.apply(this,args);};
  extension(f.pi);await f.emit('session_start');await f.emit('session_before_tree');owners.clear();disposed.clear();
  let reentered=false;const invalidate=()=>{if(reentered)return;reentered=true;void f.emit('session_shutdown');if(restart)void f.emit('session_start');};
  const context={...f.ctx,sessionManager:{...f.ctx.sessionManager}};
  if(boundary==='session')Object.defineProperty(context,'sessionManager',{get(){invalidate();return f.ctx.sessionManager;}});
  if(boundary==='trust')context.isProjectTrusted=()=>{invalidate();return true;};
  if(boundary==='branch')context.sessionManager.getBranch=()=>{invalidate();return [];};
  try{
   await f.commands.get('jev-subagent-router').handler('off',context);
   expect(reentered).toBe(true);expect(delegated).toBe(0);expect(owners.size).toBe(restart?2:1);
   expect([...disposed.values()]).toEqual([1]);expect(f.count()).toBe(restart?5:1);expect(f.entries).toEqual([]);expect(f.notices).toEqual([]);
   expect(existsSync(join(f.cwd,'ledger.json'))).toBe(false);
   if(restart){await f.commands.get('jev-subagent-router').handler('status',f.ctx);expect(delegated).toBe(1);expect(owners.size).toBe(2);}
  }finally{await f.emit('session_shutdown');f.off();ExtensionCoordinator.prototype.getRuntime=runtime;ExtensionCoordinator.prototype.dispose=dispose;CommandRouter.prototype.command=command;}
 });

test('long native prompt retains exact length through real correlation and repeated binding reads, with bounded-prefix apply',async()=>{
 const f=await fixture(),restore=registry(f.record),fetch=globalThis.fetch,c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);
 const prompt='PRIVATE-PREFIX '.repeat(700)+'PRIVATE-TAIL',input={prompt,description:'d',subagent_type:'probe',model:'p/m',thinking:'off'};
 let request='';globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{request=JSON.parse(String(init?.body)).state.request;return Response.json({answers:{task_kind:{choice:'implement',confidence:.9},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:3,output_tokens:2}});}) as unknown as typeof globalThis.fetch;
 try{
  await c.toolCall({toolName:'Agent',toolCallId:'spawn',input},f.ctx);c.observeResult({toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await c.flush();
  for(let i=0;i<3;i++)expect(c.getBinding('child')?.session).toBe(f.record.session);
  // Published SDK lacks strict retained-child resolution. Supply only scoped
  // candidates at that existing service seam; correlation/engine/cache stay real.
  ((c.commands as unknown as {services:CommandServices}).services).getCandidates=()=>({status:'ready',models:[{provider:'p',id:'m'}]});
  const result=await c.commands.command('apply child');expect(result.control).toBeDefined();
  expect(request).toBe(`Agent: retained-child\nTask:\n${prompt.slice(0,4096)}`);
  // Both-explicit launch remains eligible for observation/apply memo, NOT why.
  expect(c.commands.entries.at(-1)?.decision?.notes).toContain(`cached task truncated: ${prompt.length} → 4096 characters`);
  expect((await c.commands.command('why')).text).toContain('no retained eligible child task');
  expect(c.commands.memory).toMatchObject({tasks:1,taskChars:4096});expect(input.prompt).toBe(prompt);
  const memos=[...(c as unknown as {calls:Map<string,unknown>}).calls.values()];
  expect(memos).toEqual([{text:prompt.slice(0,4096),originalChars:prompt.length,admission:{owner:c.getRuntime().owner,generation:c.getRuntime().generation}}]);
  const persisted=JSON.stringify(f.entries)+await readFile(join(f.cwd,'ledger.json'),'utf8');expect(persisted).not.toContain('PRIVATE-PREFIX');expect(persisted).not.toContain('PRIVATE-TAIL');
 }finally{c.dispose();restore();globalThis.fetch=fetch;}
});

for(const originalChars of [-1,1.5,Number.MAX_SAFE_INTEGER+1,NaN,Infinity,2])
 test(`rememberTask rejects invalid bounded-task original count ${originalChars}`,async()=>{
  const f=await fixture(),restore=registry(f.record),c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);
  try{await c.toolCall({toolName:'Agent',toolCallId:'spawn',input:{prompt:'task',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'}},f.ctx);c.observeResult({toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await c.flush();const binding=c.getBinding('child')!;expect(binding).toBeDefined();c.commands.clear();c.commands.rememberTask(binding,'bounded',c.getRuntime(),originalChars);expect(c.commands.memory.tasks).toBe(0);}
  finally{c.dispose();restore();}
 });

for(const failure of ['throw','reject'] as const)
 test(`actual registered extension notification contains ${failure} without native mutation or command failure`,async()=>{
  const f=await fixture(),unhandled:unknown[]=[],onUnhandled=(error:unknown)=>{unhandled.push(error);};
  process.on('unhandledRejection',onUnhandled);extension(f.pi);await f.emit('session_start');
  f.ctx.ui.notify=()=>{if(failure==='throw')throw Error('PRIVATE cosmetic failure');return Promise.reject(Error('PRIVATE cosmetic failure'));};
  const input={command:'native unchanged'};
  try{expect(await f.commands.get('jev-subagent-router').handler('status',f.ctx)).toBeUndefined();await new Promise<void>(resolve=>setTimeout(resolve,0));expect(unhandled).toEqual([]);await f.emit('tool_call',{toolName:'bash',toolCallId:'native',input});expect(input).toEqual({command:'native unchanged'});}
  finally{await f.emit('session_shutdown');process.off('unhandledRejection',onUnhandled);}
 });
