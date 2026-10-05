// Executed only by isolatedChild: poisoned immutable globals never touch a parent test realm.
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, analysis } from './fixtures';
import { decide } from '../../src/core/router';
import { AccountingStore, rootOwnerId } from '../../src/state/accounting';
import type { ControllerOptions } from '../../src/children/controller';
import type { ChildBinding, RoutingSnapshot } from '../../src/contracts';
import type { ObserverEntry } from '../../src/tintin/observer';
// @ts-expect-error Production API cannot select an alternate safety registry.
type ForbiddenSafetyOption=ControllerOptions['safety'];

const scenario=process.argv[2], slot=process.argv[3];
const keys=['control-safety','observer-sdk-lifetimes','observer-origin-lifetimes'].map(s=>Symbol.for(`pi-jev-subagent-router:${s}:v1`));
let getterReads=0;
if(scenario==='poison') {
 const k=keys[Number(slot)],kind=process.argv[4];
 const shape=Number(slot)===0?{protocol:'pi-jev-control-safety',version:1,status:()=> 'ready',acquire:()=> 'ready',finish:()=>true}:Number(slot)===1?{protocol:'pi-jev-observer-sdk',version:1,matches:()=>true,remember:()=>true}:{protocol:'pi-jev-observer-origin',version:1,matches:()=>true,remember:()=>true};
 const legacy=Number(slot)===0?{sessions:new WeakMap()}:Number(slot)===1?new WeakMap():{lifetimes:new Map(),cleanup:new FinalizationRegistry(()=>{})};
 const value=kind==='undefined'?undefined:kind==='null'?null:kind==='legacy'?legacy:kind==='unsealed'?shape:kind==='mutable-slot'?Object.freeze(shape):kind==='wrongversion'?Object.freeze({...shape,version:99}):kind==='wrongmethod'?Object.freeze({...shape,...(Number(slot)===0?{finish:null}:{remember:null})}):kind==='field-getter'?Object.freeze(Object.defineProperty({...shape},'protocol',{get(){getterReads++;throw Error('facade getter must not run');}})):Object.freeze({protocol:'wrong',version:99});
 if(kind==='absent-uninstallable')Object.preventExtensions(globalThis);
 else if(kind==='getter')Object.defineProperty(globalThis,k,{get(){getterReads++;throw Error('must not run');},configurable:false});
 else Object.defineProperty(globalThis,k,{value,writable:['undefined','null','legacy','unsealed','mutable-slot'].includes(kind),configurable:['undefined','null','legacy','unsealed','mutable-slot'].includes(kind)});
}
const poisonedDescriptor=scenario==='poison'?Object.getOwnPropertyDescriptor(globalThis,keys[Number(slot)]):undefined;
const scratch=await mkdtemp(join(tmpdir(),'realm-authority-'));
await cp(new URL('../../src',import.meta.url),join(scratch,'src'),{recursive:true});
await symlink(new URL('../../node_modules',import.meta.url).pathname,join(scratch,'node_modules'));
const original=await import('../../src/children/controller');
const duplicate=await import(join(scratch,'src/children/controller.ts'));
assert.notEqual(original.ChildController,duplicate.ChildController,'actual distinct module cache paths');
const safetyModule=await import('../../src/children/control-safety');
const copiedSafetyModule=await import(join(scratch,'src/children/control-safety.ts'));
assert.equal(safetyModule.controlSafety,copiedSafetyModule.controlSafety);
assert.equal(Reflect.get(safetyModule,'sdkControlSafety'),undefined);
const firstObserver=await import('../../src/tintin/observer');
const secondObserver=await import(join(scratch,'src/tintin/observer.ts'));
assert.notEqual(firstObserver.ChildObserver,secondObserver.ChildObserver);
if(scenario==='poison')assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis,keys[Number(slot)]),poisonedDescriptor,'never replace/adopt/reset preexisting metadata');
function sealed(k:symbol) {
 const d=Object.getOwnPropertyDescriptor(globalThis,k)!;
 assert.equal(d.writable,false);assert.equal(d.configurable,false);assert.ok('value' in d);assert.ok(Object.isFrozen(d.value));
 assert.equal(Reflect.set(d.value,'protocol','replacement'),false);
 assert.equal(Reflect.set(d.value,Object.keys(d.value).find(n=>typeof d.value[n]==='function')!,()=>true),false);
 assert.equal(Reflect.set(globalThis,k,{}),false);assert.equal(Reflect.deleteProperty(globalThis,k),false);
 assert.throws(()=>Object.defineProperty(globalThis,k,{value:{}}),TypeError);
 for(const field of ['sessions','lifetimes','cleanup','reset','clear'])assert.equal(d.value[field],undefined);
 return d.value;
}
const runtime:RoutingSnapshot={owner:'owner',generation:1,config:config()};
Object.assign(runtime.config,{stickiness:false,kindModels:{},kindMinimumTier:{},confidenceThreshold:0});
runtime.config.cache.aware=false;runtime.config.routes={quick:[],standard:[{provider:'p',model:'before'}],high:[{provider:'p',model:'after',thinkingLevel:'high'}],premium:[],xpremium:[]};
const models=[{provider:'p',id:'before'},{provider:'p',id:'after'}];
const sdk={sessionId:'sdk',isIdle:true,isCompacting:false,model:models[0],thinkingLevel:'off',subscribe:()=>()=>{},getContextUsage:()=>({tokens:0})};
const binding:ChildBinding={owner:'owner',id:'child',toolCallId:'spawn',session:sdk as unknown as ChildBinding['session'],sessionKey:'sdk',generation:1,disposed:false};
let record:any={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:.2},session:sdk};
let requests=0,costs=0,bindings=0;
let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
const registry={getRecord:()=>record,getIdleChildConfigurationSnapshot:()=>({status:'ready',childId:'child',snapshot:{sessionId:'sdk',revision:0,model:models[0],thinkingLevel:'off'}}),configureIdleChild:async()=>{requests++;enter();await held;throw Error('unknown outcome');},getIdleChildConfigurationReceipt:(r:any)=>({status:'rejected',operationId:r.operationId,reason:'unauthorized'})};
const options:ControllerOptions={getRuntime:()=>runtime,getBinding:()=>{bindings++;return binding;},getRegistry:()=>registry,getCandidates:()=>({status:'ready',models}),getSpend:()=>{costs++;return {today:0,month:0,pressure:0};}};
const a=analysis({complexity:2,budgetIntensity:2,deepReasoning:.5}),proposal={analysis:a,decision:decide(a,runtime.config,{models,spend:{today:0,month:0,pressure:0}})};
if(scenario==='control') {
 const c=new original.ChildController(options),pending=c.apply(binding,proposal,runtime);await entered;
 const facade=sealed(keys[0]);assert.equal(facade.status(sdk),'pending');
 const c2=new duplicate.ChildController({...options,safety:{sessions:new WeakMap()}});
 const competing=c2.apply(binding,proposal,runtime);c.dispose();release();
 assert.equal((await competing).reason,'in-flight');assert.equal((await pending).status,'degraded');
 sealed(keys[0]);assert.equal((await c2.apply(binding,proposal,runtime)).status,'degraded');assert.equal(requests,1);
 // Narrow operations cannot let an old token release another attempt or quarantine.
 const fresh={},token=Symbol(),other=Symbol();assert.equal(facade.acquire(fresh,token),'ready');
 assert.equal(facade.finish(fresh,other,'known'),false);assert.equal(facade.status(fresh),'pending');
 assert.equal(facade.finish(fresh,token,'known'),true);assert.equal(facade.acquire(fresh,other),'ready');
 assert.equal(facade.finish(fresh,token,'known'),false);assert.equal(facade.finish(fresh,other,'unresolved'),true);
 assert.equal(facade.finish(fresh,other,'known'),false);assert.equal(facade.status(fresh),'unresolved');
} else if(scenario==='poison' && slot==='0') {
 release();const c=new duplicate.ChildController(options);assert.equal((await c.apply(binding,proposal,runtime)).status,'degraded');assert.equal(c.metadata(binding).status,'degraded');
 assert.equal(requests,0);assert.equal(costs,0);assert.equal(bindings,0);
} else {
 const owner=rootOwnerId(scratch,'parent'),file=join(scratch,'ledger.json'),entries:ObserverEntry[]=[];
 let subscriptions=0,registers=0,observes=0;
 const makeSession=()=>({sessionId:'sdk',subscribe:()=>{subscriptions++;return ()=>{};}});
 record.session=makeSession();const retained=record;
 const store=new AccountingStore(file),register=store.registerOrigin.bind(store),observe=store.observe.bind(store);
 store.registerOrigin=async(...args)=>{registers++;return register(...args);};store.observe=async(...args)=>{observes++;return observe(...args);};
 const observerOptions={owner,store,eventBus:{on:()=>()=>{}},getRegistry:()=>registry,appendEntry:(_t:string,e:ObserverEntry)=>{entries.push(e);}};
 const o=new firstObserver.ChildObserver(observerOptions);
 const correlate=(o:InstanceType<typeof firstObserver.ChildObserver>,id='spawn')=>{o.observeToolCall({toolName:'Agent',toolCallId:id,input:{subagent_type:'probe',description:'d',prompt:'p'}});o.observeToolResult({toolName:'Agent',toolCallId:id,details:{agentId:'child'}});};
 if(scenario==='poison') {
  correlate(o);await o.flush();assert.equal(o.status,'unknown-attribution');assert.equal(registers,0);assert.equal(observes,0);assert.equal(subscriptions,0);assert.equal(o.getBinding('child'),undefined);
 } else {
  // Readiness before a first SDK binding remains valid.
  record.session=undefined;correlate(o);await o.flush();record.session=makeSession();correlate(o);await o.flush();assert.ok(o.getBinding('child'));
  const entry=entries.at(-1)!;o.dispose();sealed(keys[1]);sealed(keys[2]);
  const history=[{role:'assistant',content:[{type:'toolCall',id:'spawn',name:'Agent',arguments:{subagent_type:'probe',description:'d',prompt:'p'}}]},{role:'toolResult',toolCallId:'spawn',toolName:'Agent',details:{agentId:'child'}}];
  const g=new secondObserver.ChildObserver(observerOptions),n=registers,usd=observes,subs=subscriptions;
  record={...retained,session:makeSession()};g.restore(entry,history);await g.flush();assert.equal(g.status,'unknown-attribution');assert.equal(g.getBinding('child'),undefined);assert.equal(registers,n);assert.equal(observes,usd);assert.equal(subscriptions,subs);
  // Same record and forged SDK identifier also fails, even in the second copy.
  record=retained;record.session=makeSession();correlate(g);await g.flush();assert.equal(registers,n);assert.equal(subscriptions,subs);
  // A distinct native spawn + distinct record is still a new origin.
  record={...retained,session:makeSession()};correlate(g,'new-spawn');await g.flush();assert.ok(g.getBinding('child'));assert.equal(registers,n+1);g.dispose();
 }
 o.dispose();
}
if(scenario==='poison') {
 assert.equal(getterReads,0);
 // Import and native tool_call remain fail-open, despite unavailable safety authority.
 const {default:extension}=await import('../../extensions/pi-jev-subagent-router/index');
 const handlers=new Map<string,Function[]>();const pi:any={events:{on:()=>()=>{}},on:(n:string,f:Function)=>handlers.set(n,[...(handlers.get(n)??[]),f]),registerCommand:()=>{},registerTool:()=>{},appendEntry:()=>{},getAllTools:()=>[]};
 await mkdir(join(scratch,'.pi'));extension(pi);
 const ctx:any={cwd:scratch,isProjectTrusted:()=>true,hasUI:false,ui:{notify:()=>{}},modelRegistry:{getAll:()=>[],getAvailable:()=>[]},sessionManager:{getSessionId:()=> 'parent',getBranch:()=>[]}};
 for(const fn of handlers.get('session_start')??[])await fn({},ctx);
 const input={subagent_type:'probe',description:'d',prompt:'p',model:'p/before',thinking:'off'};
 for(const fn of handlers.get('tool_call')??[])assert.equal(await fn({toolName:'Agent',toolCallId:'native',input},ctx),undefined);
 assert.equal(input.model,'p/before');assert.equal(getterReads,0);
 for(const fn of handlers.get('session_shutdown')??[])await fn({},ctx);
}
console.log(`realm-authority OK ${process.argv.slice(2).join(' ')}`);
