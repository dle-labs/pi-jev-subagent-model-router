/** Trusted-host, same-realm package protocol, not a hostile-JS security sandbox.
 * Always use the canonical key, including after protocol upgrades. Only an
 * ABSENT own slot may initialize; legacy/malformed/incompatible slots require
 * a process restart. Inspect descriptors, never execute a slot/field getter.
 */
export function facadeShape(value:unknown,protocol:string,version:number,methods:readonly string[]):boolean {
 if(value===null || typeof value!=="object" || !Object.isFrozen(value) || Object.getPrototypeOf(value)!==Object.prototype)return false;
 const names=Object.getOwnPropertyNames(value);
 if(Object.getOwnPropertySymbols(value).length || names.length!==methods.length+2 || !names.every(n=>n==="protocol" || n==="version" || methods.includes(n)))return false;
 const data=(name:string)=>{
  const d=Object.getOwnPropertyDescriptor(value,name);
  return d && "value" in d && !d.writable && !d.configurable?d:undefined;
 };
 return data("protocol")?.value===protocol && data("version")?.value===version && methods.every(name=>typeof data(name)?.value==="function");
}
export function realmAuthority<T>(key:symbol,validate:(value:unknown)=>value is T,create:()=>T):T|undefined {
 try {
  let descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
  if(descriptor===undefined) {
   const value=create();
   if(!validate(value))return;
   Object.defineProperty(globalThis,key,{value,writable:false,configurable:false,enumerable:false});
   descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
  }
  if(!descriptor || !("value" in descriptor) || descriptor.writable || descriptor.configurable)return;
  const value:unknown=descriptor.value;
  return validate(value)?value:undefined;
 }catch{return undefined;}
}
