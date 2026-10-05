import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../../extensions/pi-jev-subagent-router/index';
import { ExtensionCoordinator } from '../../src/extension/coordinator';
import { DEFAULT_CONFIG } from '../../src/core/config';
const classified=()=>Response.json({answers:{task_kind:{choice:'implement',confidence:.9},complexity:{score:2},capability_deserved:{score:2},needs_deep_reasoning:{noul:.8}},usage:{input_tokens:3,output_tokens:2}});
const tool=()=>({name:'Agent',description:'native',parameters:{type:'object',required:['prompt','description','subagent_type'],properties:Object.fromEntries(['prompt','description','subagent_type','model','thinking','resume'].map(k=>[k,{type:'string'}]))}});
async function routable(f:Awaited<ReturnType<typeof host>>) {
 await writeFile(join(f.cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify({apiKey:'fake',endpoint:'https://fixture.invalid',useDefaultModels:false,kindModels:{},routes:{high:[{provider:'p',model:'m',thinkingLevel:'high'}]},stateFile:'ledger.json'}));
 f.pi.getAllTools=()=>[tool()];f.ctx.modelRegistry={getAll:()=>[{provider:'p',id:'m'}],getAvailable:()=>[{provider:'p',id:'m'}]};
 return f.events.on('subagents:rpc:ping',(e:any)=>f.events.emit(`subagents:rpc:ping:reply:${e.requestId}`,{success:true,data:{version:2}}));
}

import { ChildObserver } from '../../src/tintin/observer';
import { AccountingStore, rootOwnerId } from '../../src/state/accounting';

function bus() { const handlers=new Map<string,Set<(v:any)=>void>>();return {on(c:string,h:(v:any)=>void){const s=handlers.get(c)??new Set();s.add(h);handlers.set(c,s);return ()=>{s.delete(h);};},emit(c:string,v:any){for(const h of handlers.get(c)??[])h(v);},count(){return [...handlers.values()].reduce((n,s)=>n+s.size,0);}}; }
async function host() {
 const cwd=await mkdtemp(join(tmpdir(),'extension-'));await mkdir(join(cwd,'.pi'));
 const handlers=new Map<string,Function[]>(),commands=new Map<string,any>(),tools=new Map<string,any>(),entries:any[]=[],notices:string[]=[],events=bus();
 let session='parent';const ctx:any={cwd,isProjectTrusted:()=>true,hasUI:false,ui:{notify:(s:string)=>notices.push(s)},modelRegistry:{getAll:()=>[],getAvailable:()=>[]},sessionManager:{getSessionId:()=>session,getBranch:()=>[]}};
 const pi:any={events,on(name:string,h:Function){const hs=handlers.get(name)??[];hs.push(h);handlers.set(name,hs);return ()=>{};},registerCommand:(n:string,d:any)=>commands.set(n,d),registerTool:(d:any)=>tools.set(d.name,d),appendEntry:(type:string,data:any)=>entries.push({type,data}),getAllTools:()=>[]};
 const emit=async(name:string,e:any={})=>{for(const h of handlers.get(name)??[])expect(await h(e,ctx)).toBeUndefined();};
 return {cwd,ctx,pi,events,handlers,commands,tools,entries,notices,emit,switch:()=>session='other'};
}
test('late classifier cannot write accounting/cards/memory after generation invalidation',async()=>{
 const f=await host(),off=await routable(f),old=globalThis.fetch;
 let enter!:()=>void,release!:()=>void;const started=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
 globalThis.fetch=(async()=>{enter();await held;return classified();}) as unknown as typeof fetch;
 const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd),input:any={prompt:'PRIVATE',description:'d',subagent_type:'probe'};
 try{const work=c.toolCall({toolName:'Agent',toolCallId:'late',input},f.ctx);await started;c.updateRuntime({mode:'notify'},c.getRuntime());release();await work;await Promise.resolve();await Promise.resolve();expect(input.model).toBeUndefined();expect(f.entries).toHaveLength(0);expect(c.commands.memory.entries).toBe(0);
  const {existsSync}=await import('node:fs');expect(existsSync(join(f.cwd,'ledger.json'))).toBe(false);
 }finally{release();c.dispose();off();globalThis.fetch=old;}
});
test('live classifier routes undefined fields and both engines record durable evaluations, without parent changes',async()=>{
 const f=await host(),off=await routable(f),old=globalThis.fetch;let evaluations=0;
 globalThis.fetch=(async()=>{evaluations++;return classified();}) as unknown as typeof fetch;
 const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd),input:any={prompt:'PRIVATE',description:'d',subagent_type:'probe',thinking:'off',other:{same:true}};const other=input.other;
 try{await c.toolCall({toolName:'Agent',toolCallId:'live',input},f.ctx);expect(input.model).toBe('p/m');expect(input.thinking).toBe('off');expect(input.other).toBe(other);expect(JSON.stringify(f.entries)).not.toContain('PRIVATE');expect((await c.commands.route('RECOMMENDATION')).proposal?.decision).toBeDefined();expect(JSON.parse(await readFile(join(f.cwd,'ledger.json'),'utf8')).jev.requests).toBe(2);
 await c.toolCall({toolName:'Agent',toolCallId:'both',input:{prompt:'PRIVATE',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'}},f.ctx);expect(evaluations).toBe(2);
 }finally{c.dispose();off();globalThis.fetch=old;}
});
for(const unavailable of ['failed-classification','no-available-model'] as const)test(`why captures eligible admission before SDK receipt after ${unavailable}`,async()=>{
 const f=await host(),off=await routable(f),old=globalThis.fetch;let fail=unavailable==='failed-classification',requests:string[]=[];
 if(unavailable==='no-available-model')f.ctx.modelRegistry.getAvailable=()=>[];
 globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{requests.push(JSON.parse(String(init?.body)).state.request);return fail?Response.json({}, {status:401}):classified();}) as unknown as typeof fetch;
 const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);
 try{await c.toolCall({toolName:'Agent',toolCallId:'admitted',input:{prompt:'original launch',description:'d',subagent_type:'probe',resume:'',schedule:''}},f.ctx);
  expect(c.getBinding('child')).toBeUndefined();fail=false;const before=requests.length;
  const result=await c.commands.command('why');expect(requests.length).toBe(before+1);expect(requests.at(-1)).toBe('Agent: probe\nTask:\noriginal launch');expect(result.text).toContain('complexity');
  expect(JSON.parse(await readFile(join(f.cwd,'ledger.json'),'utf8')).jev.requests).toBe(requests.length);expect(JSON.stringify(f.entries)).not.toContain('original launch');
 }finally{c.dispose();off();globalThis.fetch=old;}
});
test('generated reload await cannot overwrite a newer session override',async()=>{const f=await host(),c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd),a=c.getRuntime();const reload=c.reloadGenerated(a);c.updateRuntime({enabled:false,mode:'confirm'},a);await reload;expect(c.getRuntime().config.enabled).toBe(false);expect(c.getRuntime().config.mode).toBe('confirm');expect(c.getRuntime().generation).toBe(a.generation+1);c.dispose();});
test('throwing observer cleanup cannot skip later listeners and disposed callbacks remain inert',async()=>{const f=await host();const on=f.events.on.bind(f.events);let cleanups=0;f.events.on=(channel,h)=>{const off=on(channel,h);return ()=>{off();cleanups++;if(cleanups===1)throw Error('cleanup failure');};};const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);c.dispose();expect(cleanups).toBe(4);expect(f.events.count()).toBe(0);c.dispose();expect(cleanups).toBe(4);});
test('reentrant cleanup policy update cannot clobber replacement services or retain duplicate listeners',async()=>{
 const f=await host(),on=f.events.on.bind(f.events);let c:ExtensionCoordinator|undefined,reentered=false;
 f.events.on=(channel,h)=>{const off=on(channel,h);return ()=>{off();if(c && !reentered){reentered=true;c.updateRuntime({mode:'confirm'},c.getRuntime());}};};
 c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);c.updateRuntime({mode:'notify'},c.getRuntime());expect(c.getRuntime().config.mode).toBe('confirm');expect(f.events.count()).toBe(4);expect((await c.commands.command('status')).level).toBe('info');c.dispose();expect(f.events.count()).toBe(0);
});
test('missing Tintin warns once and preserves native input; missing key never calls classifier',async()=>{
 const f=await host();await routable(f);f.pi.getAllTools=()=>[];const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd),input:any={prompt:'PRIVATE',description:'d',subagent_type:'probe'};
 await c.toolCall({toolName:'Agent',toolCallId:'a',input},f.ctx);await c.toolCall({toolName:'Agent',toolCallId:'b',input},f.ctx);expect(f.notices.filter(n=>n.includes('install @tintinweb/pi-subagents'))).toHaveLength(1);expect(input.model).toBeUndefined();c.dispose();
 const g=await host(),off=await routable(g);const config=JSON.parse(await readFile(join(g.cwd,'.pi','pi-jev-subagent-router.json'),'utf8'));delete config.apiKey;config.apiKeyEnv='NONEXISTENT_TEST_KEY';await writeFile(join(g.cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify(config));const d=new ExtensionCoordinator(g.pi,g.ctx,g.cwd);await d.toolCall({toolName:'Agent',toolCallId:'no-key',input},g.ctx);expect(input.model).toBeUndefined();d.dispose();off();
});
test('scope/auth/catalogue/trust changes advance generation only when observed, not ordinary unchanged tools',async()=>{
 const f=await host(),off=await routable(f),c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);let generation=c.getRuntime().generation;
 c.refresh(f.ctx);expect(c.getRuntime().generation).toBe(generation);
 await writeFile(join(f.cwd,'.pi','settings.json'),JSON.stringify({enabledModels:['p/m']}));c.refresh(f.ctx);expect(c.getRuntime().generation).toBe(++generation);
 f.ctx.modelRegistry.getAvailable=()=>[];c.refresh(f.ctx);expect(c.getRuntime().generation).toBe(++generation);
 f.pi.getAllTools=()=>[];c.refresh(f.ctx);expect(c.getRuntime().generation).toBe(++generation);
 f.ctx.isProjectTrusted=()=>false;c.refresh(f.ctx);expect(c.getRuntime().generation).toBe(++generation);c.dispose();off();
});
test('restore uses current branch only and /why never reconstructs raw task history',async()=>{
 const f=await host(),file=join(f.cwd,'ledger.json'),owner=rootOwnerId(f.cwd,'parent');await writeFile(join(f.cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify({stateFile:file}));
 const session:any={sessionId:'sdk',subscribe:()=>()=>{},isIdle:true,model:{provider:'p',id:'m'},thinkingLevel:'off'};
 const record:any={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:.2},session};
 const symbol=Symbol.for('pi-subagents:manager'),previous=(globalThis as any)[symbol];(globalThis as any)[symbol]={getRecord:(id:string)=>id==='child'?record:undefined};
 const entries:any[]=[],o=new ChildObserver({owner,store:new AccountingStore(file),eventBus:f.events,appendEntry:(t,e)=>{entries.push({type:'custom',customType:t,data:e});}});
 try{
  const input={prompt:'PRIVATE-TASK',description:'d',subagent_type:'probe'};o.observeToolCall({toolName:'Agent',toolCallId:'spawn',input});o.observeToolResult({toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await o.flush();o.dispose();
  f.ctx.sessionManager.getEntries=()=>{throw Error('Abandoned branch scan forbidden');};
  f.ctx.sessionManager.getBranch=()=>[{type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'spawn',name:'Agent',arguments:input}]}},{type:'message',message:{role:'toolResult',toolCallId:'spawn',toolName:'Agent',details:{agentId:'child'}}},...entries];
  const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);await c.flush();expect(c.getBinding('child')?.session).toBe(session);expect(c.commands.memory.tasks).toBe(0);expect((await c.commands.command('why')).text).toContain('no retained eligible child task');expect(JSON.stringify(f.entries)).not.toContain('PRIVATE-TASK');c.dispose();
  f.ctx.sessionManager.getBranch=()=>[];const other=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);await other.flush();expect(other.getBinding('child')).toBeUndefined();other.dispose();
 }finally{o.dispose();if(previous===undefined)delete (globalThis as any)[symbol];else (globalThis as any)[symbol]=previous;}
});
test('late recommendation UI notification is inert after a policy generation change',async()=>{
 const f=await host(),off=await routable(f),old=globalThis.fetch;let enter!:()=>void,release!:()=>void;const started=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
 globalThis.fetch=(async()=>{enter();await held;return classified();}) as unknown as typeof fetch;
 extension(f.pi);await f.emit('session_start');
 try{const request=f.commands.get('jev-subagent-route').handler('PRIVATE',f.ctx);await started;await f.commands.get('jev-subagent-router').handler('mode notify',f.ctx);const notices=f.notices.length;release();await request;expect(f.notices.length).toBe(notices);expect(f.notices.every(n=>n.includes('session only'))).toBe(true);expect(f.entries).toHaveLength(0);}
 finally{release();await f.emit('session_shutdown');off();globalThis.fetch=old;}
});
test('status never advertises unsupported strict scope/partial atomic backend as supported',async()=>{
 const f=await host(),key=Symbol.for('pi-subagents:manager'),previous=(globalThis as any)[key];
 try{(globalThis as any)[key]={configureIdleChild:async()=>undefined};const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);expect(c.view().control).toBe('unsupported');c.dispose();}
 finally{if(previous===undefined)delete (globalThis as any)[key];else (globalThis as any)[key]=previous;}
});
test('ledger corruption during evaluation fails open before default injection',async()=>{
 const f=await host(),off=await routable(f),old=globalThis.fetch,c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd),input:any={prompt:'PRIVATE',description:'d',subagent_type:'probe'};
 globalThis.fetch=(async()=>{await writeFile(join(f.cwd,'ledger.json'),'null');return classified();}) as unknown as typeof fetch;
 try{await c.toolCall({toolName:'Agent',toolCallId:'corrupt-late',input},f.ctx);expect(input.model).toBeUndefined();expect(await readFile(join(f.cwd,'ledger.json'),'utf8')).toBe('null');}
 finally{c.dispose();off();globalThis.fetch=old;}
});
test('obsolete observer failures cannot notify the replacement policy generation',async()=>{
 const f=await host(),off=await routable(f),symbol=Symbol.for('pi-subagents:manager'),previous=(globalThis as any)[symbol];
 const session:any={sessionId:'sdk',subscribe:()=>()=>{},isIdle:true,model:{provider:'p',id:'m'},thinkingLevel:'off'};
 const record:any={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:.2},session};
 (globalThis as any)[symbol]={getRecord:(id:string)=>id==='child'?record:undefined};
 const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);
 f.pi.appendEntry=()=>{c.updateRuntime({mode:'notify'},c.getRuntime());throw Error('old observer callback failed');};
 try{await c.toolCall({toolName:'Agent',toolCallId:'spawn',input:{prompt:'PRIVATE',description:'d',subagent_type:'probe',model:'p/m',thinking:'off'}},f.ctx);c.observeResult({toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await c.flush();expect(c.getRuntime().config.mode).toBe('notify');expect(f.notices).toEqual([]);expect(c.commands.memory.entries).toBe(0);}
 finally{c.dispose();off();if(previous===undefined)delete (globalThis as any)[symbol];else (globalThis as any)[symbol]=previous;}
});
test('factory registers once, with no services/listeners/writes before session_start',async()=>{const f=await host();extension(f.pi);extension(f.pi);expect(f.handlers.get('tool_call')).toHaveLength(1);expect(f.commands.size).toBe(2);expect(f.tools.size).toBe(1);expect(f.events.count()).toBe(0);expect(f.entries).toHaveLength(0);expect(f.handlers.has('before_agent_start')).toBe(false);expect(f.handlers.has('message_end')).toBe(false);await f.emit('session_start');expect(f.events.count()).toBe(4);await f.emit('session_start');expect(f.events.count()).toBe(4);await f.emit('session_shutdown');await f.emit('session_shutdown');expect(f.events.count()).toBe(0);});
test('optional registration APIs and headless context load normally',async()=>{const f=await host();delete f.pi.registerCommand;delete f.pi.registerTool;extension(f.pi);await f.emit('session_start');await f.emit('tool_call',{toolName:'bash',toolCallId:'x',input:{command:'unchanged'}});await f.emit('session_shutdown');expect(f.events.count()).toBe(0);});
test('session-only synchronous CAS advances generation, keeps detached snapshots, and clears memory',async()=>{const f=await host();const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);const r=c.getRuntime();r.config.enabled=false;expect(c.getRuntime().config.enabled).toBe(true);c.commands.remember({version:1,owner:r.owner,action:'skipped',reason:'test'},r);expect(c.commands.memory.entries).toBe(1);expect(c.updateRuntime({mode:'notify',budget:{dailyUsd:2}},r)).toBe(true);expect(c.getRuntime().generation).toBe(r.generation+1);expect(c.getRuntime().config.budget.dailyUsd).toBe(2);expect(c.commands.memory.entries).toBe(0);expect(c.updateRuntime({enabled:false},r)).toBe(false);c.dispose();expect(f.events.count()).toBe(0);});
test('generated reload preserves session overrides and rejects stale admissions',async()=>{const f=await host();const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);const r=c.getRuntime();c.updateRuntime({mode:'notify'},r);const current=c.getRuntime();await c.reloadGenerated(current);expect(c.getRuntime().config.mode).toBe('notify');const after=c.getRuntime();await c.reloadGenerated(current);expect(c.getRuntime().generation).toBe(after.generation);c.dispose();});
test('owner changes before hook invalidate old observer and fail open',async()=>{const f=await host();const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);f.switch();const input={prompt:'Do the work',subagent_type:'probe',description:'d'};await c.toolCall({toolName:'Agent',toolCallId:'x',input},f.ctx);expect(input).toEqual({prompt:'Do the work',subagent_type:'probe',description:'d'});expect(f.events.count()).toBe(0);});
test('corrupt ledger skips classifier rather than fabricate empty spend',async()=>{const f=await host();const file=join(f.cwd,'ledger.json');await writeFile(file,'null');await writeFile(join(f.cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify({apiKey:'fake',stateFile:file}));const c=new ExtensionCoordinator(f.pi,f.ctx,f.cwd);const input={prompt:'PRIVATE task',subagent_type:'probe',description:'d'};await c.toolCall({toolName:'Agent',toolCallId:'x',input},f.ctx);expect(input).not.toHaveProperty('model');expect(c.view().discovery).toBe('unavailable');expect(await readFile(file,'utf8')).toBe('null');c.dispose();});
test('observer read-only validated binding accessor refuses pre-registration, replacement, resume suspension and disposal',async()=>{const f=await host(),owner=rootOwnerId(f.cwd,'parent'),store=new AccountingStore(join(f.cwd,'ledger.json'));const session:any={sessionId:'sdk',subscribe:()=>()=>{}};let record:any={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:0.2},session};const observer=new ChildObserver({owner,store,eventBus:f.events,getRegistry:()=>({getRecord:()=>record}),appendEntry:()=>{}});observer.observeToolCall({toolName:'Agent',toolCallId:'spawn',input:{prompt:'p',description:'d',subagent_type:'probe'}});observer.observeToolResult({toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});expect(observer.getBinding('child')).toBeUndefined();await observer.flush();const binding=observer.getBinding('child')!;expect(binding.session).toBe(session);binding.toolCallId='tampered';expect(observer.getBinding('child')?.toolCallId).toBe('spawn');record={...record};expect(observer.getBinding('child')).toBeUndefined();observer.dispose();expect(observer.getBinding('child')).toBeUndefined();});
