import { expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const prefix = '/usr/bin/env -i PATH=/usr/bin:/bin ';
function check(text: string) {
 const ci = parse(text);
 expect(Object.keys(ci.on)).toEqual(['workflow_dispatch']);
 expect(ci.permissions).toEqual({contents: 'read'});
 expect(Object.keys(ci.jobs)).toEqual(['parity-gates']);
 const job = ci.jobs['parity-gates'];
 expect(job['runs-on']).toEqual(['self-hosted','linux','jev-reviewed-offline-runtime']);
 expect(text).not.toMatch(/\buses:|continue-on-error|exit 78|\b(?:curl|wget)\b|(?:npm\s+ci|(?:npm|bun)\s+install)|actions\/(?:checkout|download|upload)|\bgit\s+(?:fetch|clone|pull|push)\b|secrets\.|\b(?:push|pull_request):/);
 expect(job.steps).toHaveLength(3);
 const preflight = job.steps[0].run as string;
 for (const guard of [
  'cd -- "$GITHUB_WORKSPACE"', '[[ "$checkout" == "$GITHUB_SHA" ]]',
  'rev-parse --show-toplevel', 'status --porcelain --untracked-files=all',
  '[[ -z "$dirty" ]]', '[[ -f "$attestation/checkout.sha"',
  '[[ "$(<"$attestation/checkout.sha")" == "$GITHUB_SHA" ]]',
  '[[ -f "$attestation/inputs.sha256"', 'sha256sum -- "${inputs[@]}"',
  '[[ "$actual" == "$(<"$attestation/inputs.sha256")" ]]',
  '[[ -d "$root" && ! -L "$root" ]]', '[[ -x "$binary" ]]',
  '[[ -f "$file" ]]', 'exit 1', 'set -euo pipefail',
 ]) expect(preflight).toContain(guard);
 expect(preflight).not.toMatch(/^\s*(?:\/[^\s]+\/)?(?:bun|node|npm|python3)(?:\s|$)|isolated\.sh/m);
 for (const step of job.steps) {
  expect(step.shell).toBe('/bin/bash --noprofile --norc {0}');
  const syntax = spawnSync('/bin/bash',['--noprofile','--norc','-n'],{input:step.run,env:{PATH:'/usr/bin:/bin'}});
  expect(syntax.status).toBe(0);
 }
 const ordinary = job.steps[1].run as string;
 const native = job.steps[2].run as string;
 expect(ordinary.trim().startsWith(prefix+'/bin/bash --noprofile --norc scripts/verify-sandbox.sh ')).toBe(true);
 expect(native.trim().startsWith(prefix+'JEV_SANDBOX_NATIVE=1 /bin/bash --noprofile --norc scripts/verify-sandbox.sh ')).toBe(true);
 expect(ordinary).toContain('for mode in baseline reference test typecheck isolation extension parity');
 expect(native).toContain('isolated.sh native-gates');
 expect(native).toContain('isolated.sh integration');
 expect(native).toContain('isolated.sh patched');
 for (const name of ['child-observer','child-control','extension','parity-native']) {
  const file = `test/integration/${name}.test.ts`;
  expect(existsSync(file)).toBe(true); expect(native).toContain('/workspace/'+file);
 }
 for (const run of [ordinary,native]) {
  expect(run.trim().split('\n')).toHaveLength(1);
  expect(run).toMatch(/scripts\/verify-sandbox\.sh \/bin\/sh -c '[^']+'\s*$/);
  expect(run).toContain('set -eu;'); expect(run).toContain('/evidence/ci-');
  expect(run).not.toMatch(/\|\||set \+e|exit 0/);
 }
}

test('manual CI verifies exact preprovisioned inputs offline and confines every runtime gate',()=>check(workflow));

test('CI static negative controls reject blocked, network, stale-check and native omissions',()=>{
 for (const [before,after] of [
  ['workflow_dispatch:','push:'],
  ['    steps:','    continue-on-error: true\n    steps:'],
  ['    steps:','    steps:\n      - uses: actions/checkout@v4'],
  ['set -euo pipefail','set -euo pipefail\n          npm ci'],
  ['set -euo pipefail','set -euo pipefail\n          bun install'],
  ['set -euo pipefail','set -euo pipefail\n          curl example.invalid'],
  ['set -euo pipefail','set -euo pipefail\n          exit 78'],
  ['[[ "$checkout" == "$GITHUB_SHA" ]]','true'],
  ['[[ -z "$dirty" ]]','true'],
  ['[[ -f "$attestation/inputs.sha256"','[[ -n "$attestation/inputs.sha256"'],
  ['[[ "$(<"$attestation/checkout.sha")" == "$GITHUB_SHA" ]]','true'],
  ['[[ -d "$root" && ! -L "$root" ]]','true'],
  ['[[ -x "$binary" ]]','true'],
  ['[[ -f "$file" ]]','true'],
  ['[[ "$actual" == "$(<"$attestation/inputs.sha256")" ]]','true'],
  ['/workspace/test/integration/parity-native.test.ts',''],
  ['JEV_SANDBOX_NATIVE=1',''],
 ]) {
  expect(workflow).toContain(before);
  expect(()=>check(workflow.replace(before,after))).toThrow();
 }
});
