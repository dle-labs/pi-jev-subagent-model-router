import * as sdk from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ChildBinding } from '../contracts';
import type { ConfigurationContext } from '../configuration';
import type { AvailableModel } from '../core/router';
import type { ScopedCandidates } from '../children/controller';
import { resolveSettingsScope, filterExactScope, type ResolvedScope } from '../tintin/scope';

/** Detect settings edits on operation boundaries without retaining raw settings,
 * touching untrusted project files or pretending public watch events exist. */
export function scopeFingerprint(context:ConfigurationContext):string {
 try{
  if(context.isProjectTrusted?.()!==true)return 'scope-untrusted';
  const hash=createHash('sha256');
  for(const file of [join(sdk.getAgentDir(),'settings.json'),join(context.cwd!,'.pi','settings.json')]){
   try{hash.update(readFileSync(file));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;hash.update('missing');}
   if(context.isProjectTrusted?.()!==true)return 'scope-untrusted';
  }
  return hash.digest('hex');
 }catch{return 'scope-unavailable';}
}
type Registry = {getAll():AvailableModel[];getAvailable?:()=>AvailableModel[];hasConfiguredAuth?:(model:AvailableModel)=>boolean};
/** Full registry FIRST for legacy resolution; available remains authoritative
 * only at the subsequent auth intersection. Never use a shortlist as universe. */
export async function launchScope(context:ConfigurationContext,registry:unknown):Promise<ResolvedScope> {
 const r=registry as Registry;
 return resolveSettingsScope(context,{getAll:()=>r.getAll(),getAvailable:()=>r.getAll()});
}
export function authenticated(registry:unknown):AvailableModel[] {
 const r=registry as Registry;
 const all=r.getAvailable ? r.getAvailable() : r.hasConfiguredAuth ? r.getAll().filter(m=>r.hasConfiguredAuth!(m)===true) : undefined;
 if(!Array.isArray(all) || !all.every(m=>m && typeof m.provider==='string' && typeof m.id==='string'))throw Error('authentication-unavailable');
 return all.map(m=>({provider:m.provider,id:m.id,name:m.name,reasoning:m.reasoning,...(m.cost?{cost:{...m.cost}}:{})}));
}
async function patterns(file:string):Promise<string[]|undefined> {
 let text:string;try{text=await readFile(file,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 const value:unknown=JSON.parse(text);
 if(!value || typeof value!=='object' || Array.isArray(value))throw Error('scope-unknown');
 const p=(value as {enabledModels?:unknown}).enabledModels;
 if(p===undefined)return;
 if(!Array.isArray(p) || !p.every(x=>typeof x==='string' && x.trim()))throw Error('scope-unknown');
 return p;
}
type Resolver=(patterns:string[],models:readonly AvailableModel[])=>{scopedModels:{model:AvailableModel}[];diagnostics:readonly unknown[]};
export function strictScopeSupported():boolean {return typeof (sdk as unknown as {resolveModelScopeFromModels?:Resolver}).resolveModelScopeFromModels==='function';}
/** Explicit controls use public strict resolver, never legacy exact semantics.
 * Namespace detection lets unchanged published packages load without 3B. */
export async function candidates(context:ConfigurationContext,registry:unknown,binding?:ChildBinding):Promise<ScopedCandidates> {
 try {
  if(context.isProjectTrusted?.()!==true)return {status:'rejected',reason:'scope-unknown'};
  if(!binding){const scope=await launchScope(context,registry);return scope.kind==='unknown'?{status:'rejected',reason:'scope-unknown'}:{status:'ready',models:filterExactScope(authenticated(registry),scope)};}
  const resolver=(sdk as unknown as {resolveModelScopeFromModels?:Resolver}).resolveModelScopeFromModels;
  if(typeof resolver!=='function')return {status:'rejected',reason:'unsupported'};
  const childCwd=binding.session.sessionManager.getCwd();
  const trusted=()=>context.isProjectTrusted?.()===true && (childCwd===context.cwd || binding.session.settingsManager.isProjectTrusted()===true);
  if(!childCwd || !trusted())return {status:'rejected',reason:'scope-unknown'};
  const global=await patterns(join(sdk.getAgentDir(),'settings.json'));
  if(!trusted())return {status:'rejected',reason:'scope-unknown'};
  const project=await patterns(join(childCwd,'.pi','settings.json'));
  if(!trusted())return {status:'rejected',reason:'scope-unknown'};
  const entries=project??global,auth=authenticated(registry);
  if(!entries?.length)return {status:'ready',models:auth};
  const r=registry as Registry,universe=r.getAll();
  const resolved=resolver(entries,universe);
  if(resolved.diagnostics.length || !resolved.scopedModels.length)return {status:'rejected',reason:'scope-denied'};
  const allowed=new Set(resolved.scopedModels.map(({model})=>`${model.provider}/${model.id}`));
  return {status:'ready',models:auth.filter(m=>allowed.has(`${m.provider}/${m.id}`))};
 }catch{return {status:'rejected',reason:'scope-unknown'};}
}
