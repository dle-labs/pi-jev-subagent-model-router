import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { DecisionEntry } from "../contracts";
import type { RouteAnalysis } from "../core/jev";
import type { Decision } from "../core/router";
import { actionGlyph, label } from "./status";

export const decisionEntryType="jev-subagent-router-decision";
export interface EffectiveSettings { model:string; thinking:string }
/** Additive display projection; effective requires an actual observed/receipt pair. */
export interface DecisionDisplay extends DecisionEntry {effective?:EffectiveSettings}
const number=(value:number):number=>{if(!Number.isFinite(value))throw Error("invalid-decision-number");return value;};
/** Deliberate projection of the existing entry contract, never a native payload. */
export function projectEntry(entry:DecisionEntry,effective?:EffectiveSettings):DecisionDisplay {
 const a=entry.analysis,d=entry.decision;
 const analysis:RouteAnalysis|undefined=a?{
  kind:label(a.kind,64),kindConfidence:number(a.kindConfidence),
  kindProbabilities:Object.fromEntries(Object.entries(a.kindProbabilities).slice(0,64).map(([k,v])=>[label(k,64),number(v)])),
  complexity:number(a.complexity),complexityConfidence:number(a.complexityConfidence),budgetIntensity:number(a.budgetIntensity),budgetIntensityConfidence:number(a.budgetIntensityConfidence),deepReasoning:number(a.deepReasoning),latencyMs:number(a.latencyMs),
  ...(a.usage?{usage:{input_tokens:number(a.usage.input_tokens),output_tokens:number(a.usage.output_tokens)}}:{}),
  ...(a.requestTruncation?{requestTruncation:{originalChars:number(a.requestTruncation.originalChars),sentChars:number(a.requestTruncation.sentChars)}}:{}),
 }:undefined;
 const decision:Decision|undefined=d?{
  desiredTier:d.desiredTier,tier:d.tier,target:{provider:label(d.target.provider),model:label(d.target.model),...(d.target.thinkingLevel?{thinkingLevel:d.target.thinkingLevel}:{})},
  ...(d.model?{model:{provider:label(d.model.provider),id:label(d.model.id)}}:{}),
  tierIndex:number(d.tierIndex),demandScore:number(d.demandScore),budgetPressure:number(d.budgetPressure),downgraded:d.downgraded,lowConfidenceFallback:d.lowConfidenceFallback,kindSpecialised:d.kindSpecialised,...(d.held===undefined?{}:{held:d.held}),reason:label(d.reason,1024),notes:d.notes.slice(0,16).map(note=>label(note,256)),
 }:undefined;
 return {version:1,owner:label(entry.owner,4096),...(entry.toolCallId?{toolCallId:label(entry.toolCallId)}:{}),...(entry.child?{child:label(entry.child)}:{}),...(entry.agent?{agent:label(entry.agent)}:{}),action:entry.action,reason:label(entry.reason,1024),...(analysis?{analysis}:{}),...(decision?{decision}:{}),...(effective?{effective:{model:label(effective.model),thinking:label(effective.thinking)}}:{})};
}
/** Pure derived text. A proposal is never advertised as launch effectiveness. */
export function prepareDecision(input:DecisionDisplay|undefined,expanded:boolean,effective?:EffectiveSettings):string {
 if(!input)return "jev-subagent-router: no decision data";
 let e:DecisionDisplay;
 try{e=projectEntry(input,effective??input.effective);}catch{return "jev-subagent-router: decision data unavailable (invalid projection)";}
 const a=e.analysis,d=e.decision;
 effective=e.effective;
 const target=d?`${d.target.provider}/${d.target.model}${d.target.thinkingLevel?` (${d.target.thinkingLevel})`:""}`:"no route available";
 const lines=[`jev-subagent-router ${actionGlyph(e.action)} ${e.action} ${d?.tier??"not routed"}${e.child?` · child ${e.child}`:""}`,
  `proposed: ${target}`,`effective: ${effective?`${label(effective.model)} (${label(effective.thinking)})`:"unobserved"}`,e.reason,
  ...(d?[d.reason,...d.notes.map(note=>`· ${note}`)]:[])];
 if(expanded && a)lines.push(
  `raw Jev judgment: kind ${a.kind} (conf ${a.kindConfidence.toFixed(2)}) · ${Object.entries(a.kindProbabilities).map(([kind,p])=>`${kind} ${(p*100).toFixed(0)}%`).join(", ")}`,
  `complexity ${a.complexity.toFixed(2)}/3 (conf ${a.complexityConfidence.toFixed(2)}) · capability deserved ${a.budgetIntensity.toFixed(2)}/3 (conf ${a.budgetIntensityConfidence.toFixed(2)}) · required reasoning ${(a.deepReasoning*100).toFixed(0)}%`,
  `latency ${a.latencyMs}ms${a.usage?` · reported Jev tokens ${a.usage.input_tokens}/${a.usage.output_tokens}`:" · Jev token usage unknown"}`,
  ...(a.requestTruncation?[`classification truncated: ${a.requestTruncation.originalChars} → ${a.requestTruncation.sentChars} characters`]:[]),
 );
 if(expanded && d)lines.push(`desired tier ${d.desiredTier} · proposed tier ${d.tier} · demand ${d.demandScore.toFixed(2)} · budget pressure ${(d.budgetPressure*100).toFixed(0)}% based on reported spend; advisory, not guaranteed remaining allowance`,
  `specialist ${d.kindSpecialised?"yes":"no"} · cache held ${d.held?"yes":"no"} · low-confidence fallback ${d.lowConfidenceFallback?"yes":"no"}`);
 return lines.filter(Boolean).join("\n");
}
/** Small public-primitives seam; optional dependency is loaded only on registration. */
export interface RendererPrimitives {
 Text:new(text:string,paddingX:number,paddingY:number)=>Component;
 Box:new(paddingX:number,paddingY:number,background:(text:string)=>string)=>Component & {addChild(child:Component):void};
}
export type RendererAPI=Partial<Pick<ExtensionAPI,"registerEntryRenderer">>;
export async function registerRenderer(api:RendererAPI,load:()=>Promise<RendererPrimitives>=()=>import("@earendil-works/pi-tui")):Promise<boolean> {
 if(typeof api.registerEntryRenderer!=="function")return false;
 try {
  const {Box,Text}=await load();
  api.registerEntryRenderer<DecisionDisplay>(decisionEntryType,(entry,{expanded},theme)=>{
   try {
    const box=new Box(1,1,text=>theme.bg("customMessageBg",text));
    const [headline,...details]=prepareDecision(entry.data,expanded).split("\n");
    box.addChild(new Text(theme.fg("accent",headline),0,0));
    box.addChild(new Text(theme.fg("dim",details.join("\n")),0,0));return box;
   }
   catch {return undefined;}
  });
  return true;
 }catch{return false;}
}
