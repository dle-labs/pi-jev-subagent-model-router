import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const inventory='docs/superpowers/specs/2026-10-02-upstream-feature-parity-inventory.md';
const report='docs/feature-parity.md';
const text=(path:string)=>readFileSync(resolve(path),'utf8');
const declarations=(file:string)=>[...text(file).matchAll(/\b(?:test|it)\(\s*(["'`])([^\n]*?)\1\s*,/g)].map(match=>match[2]);
interface Witness {mode:string;file:string;cases:string[];cells?:string[];command:string;log:string;outcome:string;sources:[string,string][]}
interface RowReceipt {feature:string;requiredOutcome:string;witnesses:string[];comparison:string;missing:string[]}
interface Receipts {logs:Record<string,{path:string;command:string;layer:string}>;witnesses:Record<string,Witness>;rows:RowReceipt[]}
// Structural reconciliation only: logs are named provenance, not re-executed or
// inferred from green status here. Behavioral/native gates run separately.
test('every upstream inventory row has unique real source/test evidence and honest status',()=>{
 const required=text(inventory).split('## Required parity checklist')[1].split('## Verified integration constraints')[0]
  .split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| Feature')&&!line.startsWith('| ---')).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
 expect(required).toHaveLength(30);
 const commands=JSON.parse(text(report).split('```json\n')[1].split('\n```')[0]) as Record<string,string>;
 for(const command of Object.values(commands)){
  expect(command.startsWith('/usr/bin/env -i PATH=/usr/bin:/bin ')).toBe(true);
  expect(command).toContain('/bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh ');
  expect(command).not.toMatch(/\|\||;|curl|npm install|bun install/);
 }
 const rows=text(report).split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| Feature')&&!line.startsWith('| ---')).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
 expect(rows).toHaveLength(required.length);expect(new Set(rows.map(row=>row[0])).size).toBe(rows.length);
 expect(rows.map(row=>row[0]).sort()).toEqual(required.map(row=>row[0]).sort());
 const receipts=JSON.parse(text(report).split('## Reconciled receipts')[1].split('```json\n')[1].split('\n```')[0]) as Receipts;
 expect(receipts.rows).toHaveLength(required.length);
 expect(new Set(receipts.rows.map(row=>row.feature)).size).toBe(required.length);
 const used=new Set<string>();
 for(const row of rows){
  expect(row).toHaveLength(8);
  const [name,owner,file,caseName,commandKey,mode,semantics,status]=row;
  expect(Object.hasOwn(commands,commandKey)).toBe(true);
  expect(owner.startsWith('src/')||owner==='package.json').toBe(true);expect(existsSync(resolve(owner))).toBe(true);
  expect(file.startsWith('test/')&&file.endsWith('.test.ts')).toBe(true);expect(declarations(file)).toContain(caseName);
  expect(['unit','differential','native','supplemental','unsupportedN/A']).toContain(mode);
  expect(['upstream-equivalent','user-approved-child-adaptation']).toContain(semantics);
  expect(['pending','local-evidence-verified-pending-independent-review','unsupported','not-applicable']).toContain(status);
  if(mode==='native')expect(commands[commandKey]).toContain('JEV_SANDBOX_NATIVE=1');
  const receipt=receipts.rows.find(r=>r.feature===name)!;expect(receipt).toBeDefined();
  // Preserve the ENTIRE authoritative outcome, not a reduced feature summary.
  expect(receipt.requiredOutcome).toBe(required.find(r=>r[0]===name)![2]);
  expect(receipt.comparison.length).toBeGreaterThan(40);
  expect(receipt.witnesses.length).toBeGreaterThanOrEqual(2);
  expect(new Set(receipt.witnesses).size).toBe(receipt.witnesses.length);
  if(status==='local-evidence-verified-pending-independent-review')expect(receipt.missing).toEqual([]);
  if(status==='pending')expect(receipt.missing.length).toBeGreaterThan(0);
  const cases=new Set<string>();let behavioral=false,native=false;
  for(const id of receipt.witnesses){
   used.add(id);const w=receipts.witnesses[id];expect(w).toBeDefined();
   expect(['unit','differential','native','supplemental']).toContain(w.mode);
   expect(w.file.startsWith('test/')&&w.file.endsWith('.test.ts')).toBe(true);
   expect(w.cases.length).toBeGreaterThan(0);expect(new Set(w.cases).size).toBe(w.cases.length);
   for(const c of w.cases){expect(declarations(w.file)).toContain(c);cases.add(w.file+'::'+c);}
   if(w.cells){
    expect(w.mode).toBe('native');expect(new Set(w.cells).size).toBe(w.cells.length);
    for(const cell of w.cells)expect(text(w.file).includes(`cell('${cell}'`)||text(w.file).includes(`id:'${cell}'`)).toBe(true);
   }
   expect(['passed-behavior','passed-structural']).toContain(w.outcome);
   if(w.outcome==='passed-behavior')behavioral=true;
   const log=receipts.logs[w.log];expect(log).toBeDefined();expect(log.command).toBe(w.command);
   expect(Object.hasOwn(commands,w.command)).toBe(true);
   expect(log.path).toMatch(/^\/tmp\/jev-sandbox-evidence-[A-Za-z0-9]+\/[A-Za-z0-9-]+\.log$/);
   expect(['default','native','structural']).toContain(log.layer);
   if(w.mode==='native'){native=true;expect(log.layer).toBe('native');expect(commands[w.command]).toContain('JEV_SANDBOX_NATIVE=1');}
   else if(w.outcome==='passed-behavior')expect(log.layer).toBe('default');
   expect(w.sources.length).toBeGreaterThan(0);
   for(const [source,branch] of w.sources){expect(source.startsWith('src/')||source==='package.json').toBe(true);expect(branch.length).toBeGreaterThan(2);expect(text(source)).toContain(branch);}
  }
  expect(cases.size).toBeGreaterThanOrEqual(2);expect(behavioral).toBe(true);
  if(['Thinking defaults','Spend ledger','Why','Revert','Auto/confirm/notify modes','Failure behavior','Candidate fallback'].includes(name))expect(native).toBe(true);
 }
 // No orphan paper receipts or native declarations hidden in default discovery.
 expect([...used].sort()).toEqual(Object.keys(receipts.witnesses).sort());
 expect(text('scripts/isolated.sh').split('  test)')[1].split(';;')[0]).not.toContain('parity-native');
 expect(commands.native).toContain('/workspace/test/integration/parity-native.test.ts');
 expect(commands.native).not.toContain('/workspace/test/integration/parity.test.ts');
});

test('parity distribution preserves upstream license and public host peers',()=>{
 const pkg=JSON.parse(text('package.json'));
 expect(pkg.license).toBe('MIT');expect(pkg.keywords).toContain('pi-package');
 expect(pkg.pi.extensions).toEqual(['./extensions/pi-jev-subagent-router/index.ts']);
 for(const name of ['@earendil-works/pi-coding-agent','@earendil-works/pi-ai','@earendil-works/pi-agent-core','@earendil-works/pi-tui','typebox']){
  expect(pkg.peerDependencies[name]).toBe('*');expect(pkg.dependencies?.[name]).toBeUndefined();
 }
 expect(pkg.peerDependenciesMeta['@earendil-works/pi-tui'].optional).toBe(true);
 expect(text('LICENSE')).toBe(text('vendor/pi-jev-model-router/LICENSE'));
 expect(text('NOTICE')).toContain('Copyright (c) 2026 Shah Rukh');
 expect(text('NOTICE')).toContain('f1a6f0381ef10899319542525f4d53c76c368396');
});
