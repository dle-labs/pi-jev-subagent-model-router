import { expect, test } from 'bun:test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateIsolation } from '../support/agent-dir-preload';

test('private production pack dry-run contains every relative module and attribution, no settings/evidence/vendor',async()=>{
 validateIsolation();const root=await mkdtemp(join(tmpdir(),'extension-pack-')),copy=join(root,'package');await mkdir(copy);
 const pkg=JSON.parse(await readFile(resolve('package.json'),'utf8'));
 expect(pkg.private).toBe(true);expect(pkg.pi.extensions).toEqual(['./extensions/pi-jev-subagent-router/index.ts']);
 for(const file of ['package.json',...pkg.files])await cp(resolve(file),join(copy,file),{recursive:true});
 const home=join(root,'home');await mkdir(home);const npmrc=join(root,'user.npmrc'),globalrc=join(root,'global.npmrc');await writeFile(npmrc,'');await writeFile(globalrc,'');
 const command=['/opt/node','/usr/lib/node_modules/npm/bin/npm-cli.js','pack','--dry-run','--json','--ignore-scripts','--offline'];
 const child=Bun.spawn(command,{cwd:copy,env:{PATH:'/opt:/usr/bin:/bin',HOME:home,USERPROFILE:home,npm_config_userconfig:npmrc,npm_config_globalconfig:globalrc,npm_config_cache:join(root,'cache'),npm_config_offline:'true',npm_config_ignore_scripts:'true'},stdout:'pipe',stderr:'pipe'});
 const [out,err,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
 console.log(`Pack command (private disposable copy): ${command.join(' ')}`);console.log(out);expect({exit,err}).toEqual({exit:0,err:''});
 const files:string[]=JSON.parse(out)[0].files.map((f:{path:string})=>f.path);
 for(const required of ['extensions/pi-jev-subagent-router/index.ts','src/extension/coordinator.ts','src/extension/scope.ts','LICENSE','NOTICE','examples/pi-jev-subagent-router.example.json'])expect(files).toContain(required);
 for(const file of files){expect(file).not.toMatch(/^(?:test|vendor|upstream-patches|node_modules|scripts|\.pi|docs\/evidence)\//);expect(file).not.toMatch(/(?:settings|auth|keys|transcript)\.json$/);}
 // Follow ALL relative runtime imports, not just a handpicked manifest list.
 for(const file of files.filter(f=>f.endsWith('.ts'))){const text=await readFile(join(copy,file),'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)){
  const target=resolve(join(copy,file,'..'),match[1]).slice(copy.length+1);expect(files.includes(target) || files.includes(target+'.ts')).toBe(true);
 }}
});
