import { facadeShape, realmAuthority } from "../realm-authority";
/** SDK-object weak safety; no mutable state/collection or reset API escapes.
 * Duplicate module versions MUST use this same key and refuse incompatibility.
 */
export type ControlSafetyStatus="ready"|"pending"|"unresolved";
export interface ControlSafetyAuthority {
 readonly protocol:"pi-jev-control-safety";
 readonly version:1;
 status(session:object):ControlSafetyStatus;
 acquire(session:object,token:symbol):ControlSafetyStatus;
 finish(session:object,token:symbol,outcome:"known"|"unresolved"):boolean;
}
function valid(value:unknown):value is ControlSafetyAuthority {
 return facadeShape(value,"pi-jev-control-safety",1,["status","acquire","finish"]);
}
function create():ControlSafetyAuthority {
 const sessions=new WeakMap<object,{unresolved:boolean;pending?:symbol}>();
 const status=(session:object):ControlSafetyStatus=>{
  const state=sessions.get(session);
  return state?.unresolved?"unresolved":state?.pending?"pending":"ready";
 };
 return Object.freeze({protocol:"pi-jev-control-safety",version:1,status,
  acquire(session:object,token:symbol):ControlSafetyStatus {
   const current=status(session);if(current!=="ready")return current;
   if(typeof token!=="symbol")return "unresolved";
   sessions.set(session,{unresolved:false,pending:token});return "ready";
  },
  finish(session:object,token:symbol,outcome:"known"|"unresolved"):boolean {
   const state=sessions.get(session);
   if(!state || state.unresolved || state.pending!==token || (outcome!=="known" && outcome!=="unresolved"))return false;
   if(outcome==="unresolved")state.unresolved=true;else delete state.pending;
   return true;
  }});
}
export const controlSafety=realmAuthority(Symbol.for("pi-jev-subagent-router:control-safety:v1"),valid,create);
