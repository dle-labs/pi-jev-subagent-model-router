import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from '../../extensions/pi-jev-subagent-router/index';
import { ExtensionCoordinator } from '../../src/extension/coordinator';
import type { CommandServices } from '../../src/commands';
import type { ChildController, ControllerOptions, ConfigureRequest } from '../../src/children/controller';
import { analysis } from '../support/fixtures';
import { decide } from '../../src/core/router';

function deferred(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
// Synthetic verified public 3B fixture. This never tampers with a native backend
// or proves native unauthorized mutation; the factory/coordinator are real.
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'control-safety-'));await mkdir(join(cwd,'.pi'));
 await writeFile(join(cwd,'.pi','pi-jev-subagent-router.json'),JSON.stringify({useDefaultModels:false,stickiness:false,kindModels:{},routes:{high:[{provider:'p',model:'m'}]},stateFile:'ledger.json'}));
 const handlers=new Map<string,Function[]>(),commands=new Map<string,any>(),branch:any[]=[],bus=new Map<string,Set<Function>>();
 const events={on:(channel:string,fn:Function)=>{const group=bus.get(channel)??new Set();group.add(fn);bus.set(channel,group);return ()=>{group.delete(fn);};}};
 const model={provider:'p',id:'m',cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const ctx:any={cwd,isProjectTrusted:()=>true,hasUI:false,ui:{notify:()=>{}},modelRegistry:{getAll:()=>[model],getAvailable:()=>[model]},sessionManager:{getSessionId:()=> 'parent',getBranch:()=>branch}};
 const pi:any={events,on:(name:string,fn:Function)=>{const group=handlers.get(name)??[];group.push(fn);handlers.set(name,group);},registerCommand:(name:string,d:any)=>commands.set(name,d),registerTool:()=>{},appendEntry:(type:string,data:unknown)=>branch.push({type:'custom',customType:type,data}),getAllTools:()=>[]};
 const emit=async(name:string,event:any={})=>{for(const fn of handlers.get(name)??[])await fn(event,ctx);};
 const session:any={sessionId:'sdk',subscribe:()=>()=>{},isIdle:true,isCompacting:false,model,thinkingLevel:'off',getContextUsage:()=>({tokens:0}),sessionManager:{getCwd:()=>cwd}};
 const record={id:'child',type:'probe',status:'completed',startedAt:1,toolUses:0,compactionCount:0,lifetimeUsage:{input:1,output:1,cacheWrite:0,cost:.2},session};
 let requests=0;const entered=deferred(),held=deferred();let wait=false;
 const registry={getRecord:(id:string)=>id==='child'?record:undefined,getIdleChildConfigurationSnapshot:()=>({status:'ready',childId:'child',snapshot:{sessionId:'sdk',revision:0,model,thinkingLevel:'off'}}),
  configureIdleChild:async(_r:ConfigureRequest)=>{requests++;entered.release();if(wait)await held.promise;throw Error('synthetic unresolvable acknowledgement');},
  getIdleChildConfigurationReceipt:(r:{operationId:string})=>({status:'rejected',operationId:r.operationId,reason:'unauthorized'})};
 const symbol=Symbol.for('pi-subagents:manager'),previous=(globalThis as any)[symbol];(globalThis as any)[symbol]=registry;
 let current:ExtensionCoordinator|undefined;const original=ExtensionCoordinator.prototype.toolCall;
 // Observe coordinator identity at the public host adapter, never SDK methods.
 ExtensionCoordinator.prototype.toolCall=async function(...args){current=this;return original.apply(this,args);};
 extension(pi);await emit('session_start');
 const input={subagent_type:'probe',description:'d',prompt:'p',model:'p/m',thinking:'off'};
 await emit('tool_call',{toolName:'Agent',toolCallId:'spawn',input});
 branch.push({type:'message',message:{role:'assistant',content:[{type:'toolCall',id:'spawn',name:'Agent',arguments:input}]}},{type:'message',message:{role:'toolResult',toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}}});
 await emit('tool_result',{toolName:'Agent',toolCallId:'spawn',details:{agentId:'child'}});await current!.flush();
 const controller=(c:ExtensionCoordinator)=>((c.commands as unknown as {services:CommandServices}).services).controller! as ChildController;
 const old=controller(current!);
 // Authored 3B fixture uses its verified catalogue at the existing callback seam;
 // the published unpatched SDK's absent scope resolver is not a native fault.
 (old as unknown as {options:ControllerOptions}).options.getCandidates=()=>({status:'ready',models:[model]});
 const proposal=()=>{const a=analysis({complexity:2,budgetIntensity:2,deepReasoning:.5});return {analysis:a,decision:decide(a,current!.getRuntime().config,{models:[model],spend:{today:0,month:0,pressure:0}})};};
 return {emit,ctx,commands,old,controller,proposal,entered,held,record,get current(){return current!;},get requests(){return requests;},wait:()=>{wait=true;},
  cleanup:async()=>{held.release();await emit('session_shutdown');ExtensionCoordinator.prototype.toolCall=original;if(previous===undefined)delete (globalThis as any)[symbol];else (globalThis as any)[symbol]=previous;}};
}
for(const late of [false,true])test(`actual factory/coordinator same-SDK safety across mode/budget/off-on/reload/cancelled transition, late=${late}`,async()=>{
 const f=await fixture();let pending:Promise<unknown>|undefined;
 try{
  const b=f.current.getBinding('child')!;expect(b.session).toBe(f.record.session);if(late)f.wait();
  pending=f.old.apply(b,f.proposal(),f.current.getRuntime());await f.entered.promise;
  if(!late)expect((await pending as {status:string}).status).toBe('degraded');
  const n=f.requests;
  const blocked=async()=>{await f.current.flush();const binding=f.current.getBinding('child')!;expect(binding.session).toBe(f.record.session);const c=f.controller(f.current);expect(c).not.toBe(f.old);expect(c.history(binding)).toHaveLength(0);const result=await c.apply(binding,f.proposal(),f.current.getRuntime());expect(late?result.reason:result.status).toBe(late?'in-flight':'degraded');expect(f.requests).toBe(n);};
  for(const policy of ['mode notify','mode confirm','budget daily 2','off','on']){await f.commands.get('jev-subagent-router').handler(policy,f.ctx);await blocked();}
  await f.current.reloadGenerated(f.current.getRuntime());await blocked();
  const before=f.current;await f.emit('session_before_compact');await f.emit('tool_call',{toolName:'bash',toolCallId:'reacquire',input:{command:'unchanged'}});expect(f.current).not.toBe(before);await blocked();
  // Real entry-factory start replacement restores the same retained SDK record.
  await f.emit('session_start');await f.emit('tool_call',{toolName:'bash',toolCallId:'reload',input:{command:'unchanged'}});await blocked();
  f.held.release();expect((await pending as {status:string}).status).toBe('degraded');
  const binding=f.current.getBinding('child')!,c=f.controller(f.current);expect(c.metadata(binding)).toMatchObject({status:'degraded',depth:0});expect((await c.apply(binding,f.proposal(),f.current.getRuntime())).status).toBe('degraded');expect(f.requests).toBe(n);
 }finally{f.held.release();if(pending)await pending;await f.cleanup();}
});
