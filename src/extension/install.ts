import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { realpathSync } from 'node:fs';
import { registerCommands, type CommandAPI, type CommandResult, type SessionChange } from '../commands';
import { registerRenderer } from '../ui/entries';
import { ExtensionCoordinator } from './coordinator';

const installed=new WeakSet<object>();
/** Registration only. No services/files/discovery/TUI import at factory time. */
export function install(pi:ExtensionAPI):void {
 if(installed.has(pi))return;installed.add(pi);
 let active:ExtensionCoordinator|undefined,epoch=0,rendererRegistered=false,rendererPending:Promise<boolean>|undefined;
 let started=false;
 // Retain only successful session-policy CAS patches, never full configuration,
 // services, callbacks or task/control history from the disposed coordinator.
 let sessionPolicy:{owner:string;patch:SessionChange}|undefined;
 // Fence BEFORE runtime/cleanup callbacks; never overwrite a reentrant owner.
 // Return the epoch belonging to this stop, not the epoch after its callbacks.
 const stop=()=>{
  const old=active;active=undefined;let stopped=++epoch;
  try{const generation=old?.getRuntime().generation??-1;if(epoch===stopped && active===undefined)epoch=stopped=Math.max(stopped,generation+1);}catch{/* independent epoch fence */}
  try{old?.dispose();}catch{/* independent epoch fence */}return stopped;
 };
 const acquire=(ctx:ExtensionContext)=>{
  let now=epoch,expected=active;
  const current=()=>started && epoch===now && active===expected;
  if(!current())return;
  let unpublished:ExtensionCoordinator|undefined;
  try {
   const aborted=ctx.signal?.aborted;if(!current() || aborted)return;
   if(expected){
    let refreshed=false;try{refreshed=expected.refresh(ctx);}catch{/* degraded */}
    if(!current())return;
    if(refreshed)return expected;
    // Only our ordinary refresh failure may move admission to its own stop.
    // A lifecycle transition inside refresh/stop must not be adopted.
    now=stop();expected=undefined;if(!current())return;
   }
   const directory=ctx.cwd;if(!current())return;
   const cwd=realpathSync(directory);if(!current())return;
   const service=unpublished=new ExtensionCoordinator(pi,ctx,cwd,now);
   if(!current())return;
   const runtime=service.getRuntime();if(!current())return;
   if(sessionPolicy?.owner===runtime.owner)service.updateRuntime(sessionPolicy.patch,runtime);
   if(!current())return;
   if(sessionPolicy?.owner!==runtime.owner)sessionPolicy=undefined;
   active=service;unpublished=undefined;expected=service;
   const update=service.updateRuntime.bind(service);
   service.updateRuntime=(change,expected)=>{
    const patch=structuredClone(change),committed=update(change,expected);
    if(committed && epoch===now && active===service){
     const previous=sessionPolicy?.owner===expected.owner?sessionPolicy.patch:{};
     sessionPolicy={owner:expected.owner,patch:{...previous,...patch,budget:{...previous.budget,...patch.budget}}};
    }
    return committed;
   };
   if(!rendererRegistered && !rendererPending && typeof pi.registerEntryRenderer==='function'){
    const pending=registerRenderer({registerEntryRenderer:((...args:Parameters<ExtensionAPI['registerEntryRenderer']>)=>{if(epoch===now && active===service){pi.registerEntryRenderer(...args);rendererRegistered=true;}}) as ExtensionAPI['registerEntryRenderer']});
    rendererPending=pending;void pending.catch(()=>{}).finally(()=>{if(rendererPending===pending)rendererPending=undefined;});
   }
   return current()?service:undefined;
  }catch{/* Failed admission cannot clear a reentrant replacement. */}
  finally{try{unpublished?.dispose();}catch{/* Dispose unpublished resources once. */}}
 };
 pi.on('session_start',(_e,ctx)=>{started=true;sessionPolicy=undefined;stop();acquire(ctx);});
 pi.on('session_shutdown',()=>{started=false;sessionPolicy=undefined;stop();});
 pi.on('session_before_switch',()=>{stop();});
 pi.on('session_before_fork',()=>{stop();});
 pi.on('session_before_tree',()=>{stop();});
 pi.on('session_before_compact',()=>{stop();});
 pi.on('session_tree',(_e,ctx)=>{if(started){sessionPolicy=undefined;stop();acquire(ctx);}});
 pi.on('session_compact',(_e,ctx)=>{if(started){sessionPolicy=undefined;stop();acquire(ctx);}});
 // Before hooks cannot know whether another handler cancels or compaction fails.
 // Only a subsequent validated operation with fresh context may recover; result
 // events/old callbacks never acquire, nor can stray calls revive shutdown.
 pi.on('tool_call',async(event,ctx)=>{try{await (active??acquire(ctx))?.toolCall(event,ctx);}catch{/* ALWAYS return normally; never block/replace/launch. */}});
 pi.on('tool_execution_update',event=>{active?.observeUpdate(event);});
 pi.on('tool_execution_end',event=>{if(!event.isError)active?.observeResult({...event,details:event.result?.details});});
 pi.on('tool_result',event=>{active?.observeResult(event);});
 const inactive=():CommandResult=>({text:'Jev child router inactive; start/reload a session. Native input unchanged.',level:'warning'});
 // CommandRouter services read the current coordinator, not a disposed initial
 // instance. Public registration closures acquire the supplied fresh context.
 const api:CommandAPI={
  registerCommand:typeof pi.registerCommand==='function'?((name,definition)=>pi.registerCommand(name,{...definition,handler:async(args,ctx)=>{
   const service=acquire(ctx);if(!service)return;
   const captured=epoch,generation=service.getRuntime().generation;
   // Explicit commands can drain already enqueued accounting. No scan/timer.
   await service?.flush();
   if(epoch!==captured || active!==service)return;
   // Pre-admission, unlike truthful postcommit notifications below: a command
   // waiting on old accounting must never enter replacement-generation services.
   if(service?.getRuntime().generation!==generation)return;
   // The runtime getter can reenter lifecycle/policy callbacks and return its
   // old snapshot. Final local checks invoke no external runtime callbacks.
   if(epoch!==captured || active!==service || (service && !service.isCurrentGeneration(generation!)))return;
   await definition.handler(args,{...ctx,ui:{...ctx.ui,notify:(text,level)=>{
    // Session-policy CAS/generated/native commits remain truthful acknowledgements;
    // ordinary late recommendation/status UI cannot cross a generation fence.
    const committed=text.includes('session only') || text.includes('committed generated layer') || text.startsWith('child control: committed');
    if(epoch===captured && active===service && (service?.getRuntime().generation===generation || committed))return ctx.ui.notify(text,level);
   }}});
  }})):undefined,
  registerTool:typeof pi.registerTool==='function'?((tool)=>pi.registerTool({...tool,execute:async(call,params,signal,update,ctx)=>{
   // This adapter registers only the recommendation tool; inactive has no proposal.
   if(!acquire(ctx))return {content:[{type:'text' as const,text:inactive().text}],details:undefined,isError:true} as Awaited<ReturnType<typeof tool.execute>>;
   return tool.execute(call,params,signal,update,ctx);
  }})):undefined,
 };
 registerCommands(api,{command:async args=>active?active.commands.command(args):inactive(),route:async(text,signal,call)=>active?active.commands.route(text,signal,call):inactive()});
}
