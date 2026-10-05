import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { isolatedChild } from '../support/isolated-child';
const fixture=fileURLToPath(new URL('../support/realm-authority-child.ts',import.meta.url));
async function run(args:string[]) {
 const child=isolatedChild('run',[fixture,...args]);
 const proc=Bun.spawn(child.argv,{env:child.env,stdout:'pipe',stderr:'pipe'});
 const [stdout,stderr,exit]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);
 expect({exit,stderr}).toEqual({exit:0,stderr:''});expect(stdout).toContain('realm-authority OK');
}
test('sealed SDK authority shares pending/quarantine with a distinct module copy and ignores JS safety injection',()=>run(['control']));
test('sealed observer evidence survives replacement attempts and a distinct module copy',()=>run(['observer']));
for(const slot of ['0','1','2'])for(const kind of ['undefined','null','wrongshape','legacy','unsealed','incompatible','getter','mutable-slot','wrongversion','wrongmethod','field-getter','absent-uninstallable'])
 test(`preexisting authority ${slot}/${kind} fails closed without getter execution or blocking native hooks`,()=>run(['poison',slot,kind]));
