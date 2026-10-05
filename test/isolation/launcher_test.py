"""Synthetic-only regression gate. Run with python3 -I inside verify-sandbox.sh."""
import json
import os
from pathlib import Path
import signal
import subprocess
import hashlib
import importlib.util
from unittest.mock import patch
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[2]
LAUNCHER = REPO / 'scripts/isolated-runtime.py'
PRELOAD = REPO / 'test/support/agent-dir-preload.ts'

class Isolation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-isolation-')
        self.root = Path(self.temp.name)
        self.home = self.root / 'ambient-home'
        self.home.mkdir()
        self.sentinel = self.home / 'sentinel'
        self.sentinel.write_text('untouched')
        for name in ['pi-jev-model-router.json', 'pi-jev-model-router.generated.json']:
            p = self.home / '.pi/agent' / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('synthetic sentinel '+name)
        self.snapshot = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.home.rglob('*') if p.is_file()}
        (self.home / '.bunfig.toml').write_text('preload = ["./poison.ts"]\n')
        (self.root / 'poison.ts').write_text('throw new Error("AMBIENT PRELOAD");')
        (self.root / 'bunfig.toml').write_text('preload = ["./poison.ts"]\n[test]\npreload = ["./poison.ts"]\n')
        (self.root / '.env').write_text('DOTENV_POISON=loaded\nHOME=/tmp/wrong-home\n')
        self.env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.home), 'USERPROFILE': str(self.home),
                    'BUN_OPTIONS': '--preload ./poison.ts', 'NODE_OPTIONS': '--require ./poison.ts',
                    'TYPESAFE_API_KEY': 'synthetic', 'PI_PROBE_HOST_ROOT': '/tmp/explicit-probe'}
    def tearDown(self):
        self.assertEqual(self.sentinel.read_text(), 'untouched')
        for p, digest in self.snapshot.items():
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), digest)
        self.temp.cleanup()
    def command(self, *args):
        return ['/usr/bin/python3', '-I', str(LAUNCHER), '--bun', '/opt/bun', *map(str, args)]
    def call(self, *args, env=None):
        return subprocess.run(self.command(*args), cwd=self.root, env=env or self.env, capture_output=True, text=True)
    def fixture(self, name, content):
        p = self.root / name
        p.write_text(content)
        return p
    def test_noargs_fails(self):
        self.assertNotEqual(self.call().returncode, 0)
    def test_inherited_marker_fails(self):
        env = dict(self.env, PI_JEV_TEST_ISOLATED_ROOT='/tmp/forged')
        self.assertNotEqual(self.call('test', self.fixture('marker.test.ts', 'throw new Error("must not run")'), env=env).returncode, 0)
    def test_startup_home_sanitized_and_probe_env(self):
        p = self.fixture('home.ts', 'import {homedir} from "node:os"; console.log(JSON.stringify({home:homedir(),env:process.env}));')
        result = self.call('run', p)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        env = data['env']
        self.assertEqual(data['home'], env['HOME'])
        self.assertNotEqual(data['home'], str(self.home))
        self.assertEqual(env['USERPROFILE'], data['home'])
        self.assertEqual(env['PI_PROBE_HOST_ROOT'], '/tmp/explicit-probe')
        for key in ['DOTENV_POISON', 'TYPESAFE_API_KEY', 'BUN_OPTIONS', 'NODE_OPTIONS']:
            self.assertNotIn(key, env)
        self.assertFalse(Path(env['PI_JEV_TEST_ISOLATED_ROOT']).exists())
    def test_exact_discovery(self):
        for name in ['a', 'b']:
            self.fixture(name+'.test.ts', 'import {test,expect} from "bun:test"; test("witness",()=>expect(1).toBe(1));')
        result = self.call('test', self.root)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('2 pass', result.stderr)
        self.assertIn('across 2 files', result.stderr)
    def test_empty_discovery_fails(self):
        self.assertNotEqual(self.call('test', self.home).returncode, 0)
    def test_empty_explicit_suite_fails(self):
        result = self.call('test', self.fixture('empty.test.ts', 'export {};'))
        self.assertNotEqual(result.returncode, 0)
    def test_exit_failure_propagates(self):
        self.assertEqual(self.call('run', self.fixture('exit.ts', 'process.exit(23);')).returncode, 23)
        result = self.call('test', self.fixture('bad.test.ts', 'import {test,expect} from "bun:test"; test("failure",()=>expect(1).toBe(2));'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('1 fail', result.stderr)
    def test_direct_unsafe_import_fails_without_replay(self):
        config = self.fixture('empty.toml', '[test]\npreload = []\n')
        script = self.fixture('unsafe.ts', f'import {json.dumps(str(PRELOAD))}; console.log("UNSAFE BODY");')
        result = subprocess.run(['/opt/bun', '--no-env-file', '--no-install', '--config='+str(config), str(script)], cwd=self.root,
                                env={'PATH':'/usr/bin:/bin', 'HOME':str(self.home)}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('UNSAFE BODY', result.stdout)
    def test_cached_home_mismatch_fails(self):
        script = self.fixture('mismatch.ts', f'process.env.HOME="/tmp/wrong"; (await import({json.dumps(str(PRELOAD))})).validateIsolation();')
        self.assertNotEqual(self.call('run', script).returncode, 0)
    def test_validator_not_a_launcher(self):
        self.assertNotEqual(self.call('run', PRELOAD).returncode, 0)
    def test_probe_direct_imports_fail_closed(self):
        config = self.fixture('empty.toml', '[test]\npreload = []\n')
        for name in ['child-control-race.ts', 'child-control-safe.ts']:
            result = subprocess.run(['/opt/bun', '--no-env-file', '--no-install', '--config='+str(config), str(REPO/'scripts'/name)],
                cwd=self.root, env={'PATH':'/usr/bin:/bin', 'HOME':str(self.home)}, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('isolation marker', result.stderr)
    def test_actual_cached_home_mismatch(self):
        with tempfile.TemporaryDirectory(prefix='jev-core-test-') as d:
            root = Path(d)
            env = {'PATH':'/usr/bin:/bin', 'HOME':str(self.home), 'USERPROFILE':str(root/'home'),
                'PI_JEV_TEST_ISOLATED_ROOT':d, 'PI_CODING_AGENT_DIR':str(root/'agent'), 'PI_OFFLINE':'1'}
            for name in ['home','agent','config','cache','data']:
                (root/name).mkdir()
            for kind in ['CONFIG','CACHE','DATA']:
                env['XDG_'+kind+'_HOME'] = str(root/kind.lower())
            script = self.fixture('cached.ts', f'process.env.HOME={json.dumps(str(root/"home"))}; await import({json.dumps(str(PRELOAD))});')
            config = self.fixture('empty.toml', '[test]\npreload = []\n')
            result = subprocess.run(['/opt/bun','--no-env-file','--no-install','--config='+str(config),str(script)], cwd=self.root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('cached home', result.stderr)
    def test_probe_arguments_preserved(self):
        script = self.fixture('args.ts', 'console.log(JSON.stringify(process.argv.slice(2)));')
        result = self.call('run', script, '--host-root', '/tmp/explicit-pi', '--tintin-root', '/tmp/explicit-tintin')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ['--host-root','/tmp/explicit-pi','--tintin-root','/tmp/explicit-tintin'])
    def test_nested_child_startup_and_failure(self):
        nested = self.fixture('nested.ts', 'import {homedir} from "node:os"; console.log(JSON.stringify({home:homedir(),env:process.env})); process.exit(17);')
        helper = REPO/'test/support/isolated-child.ts'
        script = self.fixture('parent.ts', f'import {{isolatedChild}} from {json.dumps(str(helper))}; const spec=isolatedChild("run",[{json.dumps(str(nested))}]); const c=Bun.spawnSync(spec.argv,{{env:spec.env}}); console.log(JSON.stringify({{exit:c.exitCode,out:c.stdout.toString(),parent:process.env.HOME}}));')
        result = self.call('run', script)
        self.assertEqual(result.returncode, 0, result.stderr)
        data=json.loads(result.stdout)
        child=json.loads(data['out'])
        self.assertEqual(data['exit'],17)
        self.assertEqual(child['home'],child['env']['HOME'])
        self.assertNotEqual(child['home'],data['parent'])
        self.assertEqual(child['env']['PI_PROBE_HOST_ROOT'],'/tmp/explicit-probe')
        self.assertFalse(Path(child['env']['PI_JEV_TEST_ISOLATED_ROOT']).exists())
    def test_nested_cancellation_reaps_before_home_cleanup(self):
        # A pipe is an explicit ready event, emitted after the TERM handler exists.
        helper = REPO / 'test/support/isolated-child.ts'
        nested = self.fixture('ignore-term.ts', '''
process.on("SIGTERM", () => {});
console.log(JSON.stringify({pid:process.pid, root:process.env.PI_JEV_TEST_ISOLATED_ROOT}));
setInterval(() => {}, 1000);
''')
        outer = self.fixture('outer.ts', f'''
import {{isolatedChild}} from {json.dumps(str(helper))};
const spec = isolatedChild("run", [{json.dumps(str(nested))}]);
console.log(JSON.stringify({{pid:process.pid, root:process.env.PI_JEV_TEST_ISOLATED_ROOT}}));
const child = Bun.spawn(spec.argv, {{env:spec.env, stdout:"inherit", stderr:"inherit"}});
await child.exited;
''')
        # Own/reap any orphans on RED; never strand a process under strace.
        import ctypes
        import selectors
        self.assertEqual(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0), 0)
        child = subprocess.Popen(self.command('run', outer), cwd=self.root, env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        witnesses = []
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ)
        try:
            deadline = time.monotonic() + 5
            buffered = b''
            while len(witnesses) < 2 and time.monotonic() < deadline:
                if not selector.select(max(0, deadline-time.monotonic())):
                    break
                chunk = os.read(child.stdout.fileno(), 4096)
                if not chunk:
                    break
                buffered += chunk
                while b'\n' in buffered:
                    line, buffered = buffered.split(b'\n', 1)
                    witnesses.append(json.loads(line))
            self.assertEqual(len(witnesses), 2, 'both runtimes must explicitly report ready')
            self.assertNotEqual(witnesses[0]['root'], witnesses[1]['root'])
            cancelled_at = time.monotonic()
            child.send_signal(signal.SIGTERM)
            deadline = cancelled_at + 5
            premature_cleanup = set()
            while time.monotonic() < deadline:
                live = [w for w in witnesses if Path(f"/proc/{w['pid']}").exists()]
                premature_cleanup.update(w['pid'] for w in live
                    if not Path(w['root']).exists() and Path(f"/proc/{w['pid']}").exists())
                if child.poll() is not None and not live:
                    break
                time.sleep(.01)  # condition polling, not a readiness delay
            self.assertFalse(premature_cleanup, 'HOME removed while its runtime still exists')
            self.assertIsNotNone(child.poll(), 'outer launcher must terminate within five seconds')
            self.assertNotEqual(child.returncode, 0)
            for witness in witnesses:
                self.assertFalse(Path(f"/proc/{witness['pid']}").exists(), 'nested runtime stranded')
                self.assertFalse(Path(witness['root']).exists(), 'owned fixture HOME leaked')
            child.communicate(timeout=1)
            print('Nested cancellation witness: ' + json.dumps({
                'runtimes': witnesses, 'exit': child.returncode,
                'seconds': round(time.monotonic()-cancelled_at, 3),
                'both_reaped': True, 'homes_removed_after_reaping': True,
            }), flush=True)
        finally:
            selector.close()
            # /proc traversal is confined to this test's synthetic launch tree.
            def descendants(pid):
                try:
                    children = Path(f'/proc/{pid}/task/{pid}/children').read_text().split()
                except FileNotFoundError:
                    return []
                return [int(p) for p in children] + [q for p in children for q in descendants(int(p))]
            victims = set(descendants(child.pid)) | set(descendants(os.getpid()))
            for pid in victims:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if child.poll() is None:
                child.kill()
            child.communicate(timeout=2)
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                try:
                    pid, _ = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if pid == 0:
                    time.sleep(.01)
            self.assertFalse(descendants(os.getpid()), 'guard left synthetic descendants')
            for witness in witnesses:
                self.assertFalse(Path(f"/proc/{witness['pid']}").exists(), 'guard failed to reap traced fixture')

    def test_pid_reuse_does_not_transfer_signals_or_grace(self):
        # Fake only kernel/process observations; run the actual supervisor and
        # identity acquisition, validation, signalling and descriptor lifecycle.
        spec = importlib.util.spec_from_file_location('isolated_runtime', LAUNCHER)
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        owner, direct, reused = 100, 101, 102
        now = [0.0]
        stage = [0]
        current = {owner: ('owner', owner), direct: ('direct', owner),
                   reused: ('old', direct)}
        descriptors, closed, sent, numeric_signals = {}, [], [], []
        raced = [False]
        class Child:
            pid = direct
            def poll(self):
                if stage[0] == 0:
                    signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                return 23 if stage[0] == 5 else None
        def tree(pid):
            if stage[0] == 5:
                return {owner: set()}
            # Deliberately stale discovery also includes the unowned replacement.
            return {owner: {direct}, direct: {reused}, reused: set()}
        def open_fd(pid, flags=0):
            fd = len(descriptors) + 200
            descriptors[fd] = (pid, current[pid][0])
            if stage[0] == 1 and pid == reused and not raced[0]:
                raced[0] = True
                current[reused] = ('unowned', 999)  # exits/reuses after pidfd_open
            return fd
        def alive(fd):
            pid, identity = descriptors[fd]
            return pid in current and current[pid][0] == identity
        def select_fds(read, write, error, timeout):
            return ([fd for fd in read if not alive(fd)], [], [])
        original_read = Path.read_text
        def read_stat(path, *args, **kwargs):
            if str(path).startswith('/proc/') and path.name == 'stat':
                pid = int(path.parent.name)
                identity, parent = current[pid]
                birth = {'owner': 1, 'direct': 2, 'old': 3, 'dying': 4,
                         'unowned': 5, 'owned-new': 6}[identity]
                # comm contains spaces and ')' to exercise /proc stat parsing.
                return f'{pid} (fixture ) comm) S {parent} ' + '0 '*17 + str(birth) + ' 0'
            return original_read(path, *args, **kwargs)
        def send_fd(fd, sig, info=None, flags=0):
            if not alive(fd):
                raise ProcessLookupError()
            pid, identity = descriptors[fd]
            if sig:
                sent.append((identity, sig, now[0]))
        def numeric_kill(pid, sig):
            numeric_signals.append((pid, sig))
            if stage[0] == 1 and pid == reused:
                current[reused] = ('unowned', 999)
            sent.append((current[pid][0], sig, now[0]))
        def tick(delay):
            if stage[0] == 1 and descriptors:
                stale = [fd for fd, (_, identity) in descriptors.items()
                         if identity in ('old', 'dying')]
                self.assertTrue(stale)
                self.assertTrue(all(fd in closed for fd in stale),
                                'exited/rejected references must close before replacement tracking')
            stage[0] += 1
            now[0] = [0, .2, .3, 1.05, 1.31, 1.4][stage[0]]
            if stage[0] == 1:
                current[reused] = ('dying', direct)
            elif stage[0] == 2:
                current[reused] = ('owned-new', direct)
            elif stage[0] == 5:
                current.pop(direct)
                current.pop(reused)
        with patch.object(runtime, 'process_tree', tree), \
             patch.object(runtime.os, 'getpid', return_value=owner), \
             patch.object(runtime.os, 'pidfd_open', open_fd, create=True), \
             patch.object(runtime.os, 'close', closed.append), \
             patch.object(runtime.os, 'kill', numeric_kill), \
             patch.object(runtime.signal, 'pidfd_send_signal', send_fd, create=True), \
             patch.object(runtime.subprocess, 'Popen', return_value=Child()), \
             patch.object(runtime.time, 'monotonic', side_effect=lambda: now[0]), \
             patch.object(runtime.time, 'sleep', tick), \
             patch('select.select', select_fds), \
             patch.object(Path, 'read_text', read_stat):
            self.assertEqual(runtime.supervise(['fixture'], {}, None), 23)
        self.assertFalse(numeric_signals, 'numeric PID signalling is forbidden')
        self.assertFalse(any(identity == 'unowned' for identity, _, _ in sent),
                         'stale discovery must never signal a replacement/unowned process')
        self.assertIn(('owned-new', signal.SIGTERM, .3), sent,
                      'a replacement owned identity needs its own initial signal')
        self.assertNotIn(('owned-new', signal.SIGKILL, 1.05), sent,
                         'the old identity deadline must not transfer')
        self.assertIn(('owned-new', signal.SIGKILL, 1.31), sent)
        self.assertEqual(set(closed), set(descriptors), 'all stale/live pidfds must close')
        self.assertEqual(len(closed), len(set(closed)), 'descriptors close exactly once')

    def test_pidfd_validation_and_adoption(self):
        spec = importlib.util.spec_from_file_location('isolated_runtime', LAUNCHER)
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        self.assertTrue(hasattr(runtime, 'OwnedProcesses'), 'identity-bound ownership helper required')
        owner, parent, leaf = 100, 101, 102
        current = {parent: (owner, 1), leaf: (parent, 2)}
        descriptors, closed, sent = {}, [], []
        race = [None]
        def open_fd(pid, flags=0):
            # Reuse BEFORE open, with identical starttime (same kernel tick).
            if race[0] == 'before-open':
                current[pid] = (999, current[pid][1])
            fd = len(descriptors) + 200
            descriptors[fd] = (pid, current[pid], object())
            return fd
        def alive(fd):
            pid, identity, _ = descriptors[fd]
            return current.get(pid) == identity
        def select_fds(read, write, error, timeout):
            return ([fd for fd in read if not alive(fd)], [], [])
        original_read = Path.read_text
        def read_stat(path, *args, **kwargs):
            if str(path).startswith('/proc/') and path.name == 'stat':
                ppid, birth = current[int(path.parent.name)]
                return f'0 (fixture) S {ppid} ' + '0 '*17 + str(birth)
            return original_read(path, *args, **kwargs)
        def send_fd(fd, sig, info=None, flags=0):
            if race[0] == 'before-send':
                pid, identity, _ = descriptors[fd]
                current[pid] = (999, identity[1] + 1)
                race[0] = None
            if not alive(fd):
                raise ProcessLookupError()
            sent.append((descriptors[fd][0], sig))
        with patch.object(runtime.os, 'pidfd_open', open_fd), \
             patch.object(runtime.os, 'close', closed.append), \
             patch.object(runtime.signal, 'pidfd_send_signal', send_fd), \
             patch('select.select', select_fds), \
             patch.object(Path, 'read_text', read_stat):
            refs = runtime.OwnedProcesses(owner)
            try:
                race[0] = 'before-open'
                self.assertFalse(refs.refresh({owner: {leaf}, leaf: set()}))
                self.assertFalse(refs.refs, 'unowned replacement cannot be tracked')
                self.assertEqual(closed, [200])
                race[0] = None
                current[leaf] = (parent, 2)
                owned = refs.refresh({owner: {parent}, parent: {leaf}, leaf: set()})
                original = owned[leaf]
                original.signalled, original.deadline = True, 4
                # Parent exit + subreaper adoption is not leaf identity reuse.
                current.pop(parent)
                current[leaf] = (owner, 2)
                # PPid may change without pidfd exit; emulate that kernel rule.
                fd = original.fd
                descriptors[fd] = (leaf, current[leaf], descriptors[fd][2])
                adopted = refs.refresh({owner: {leaf}, leaf: set()})
                self.assertIs(adopted[leaf], original)
                self.assertTrue(original.signalled)
                self.assertEqual(original.deadline, 4)
                self.assertIn(201, closed, 'exited parent fd must be pruned')
                original.signalled = False
                race[0] = 'before-send'
                refs.shutdown({owner: {leaf}, leaf: set()}, signal.SIGTERM, 0)
                self.assertFalse(sent, 'exit/reuse immediately before send cannot redirect fd')
                refs.refresh({owner: set()})
                self.assertFalse(refs.refs)
            finally:
                refs.close()
        self.assertEqual(set(closed), set(descriptors))
        self.assertEqual(len(closed), len(set(closed)))

    def test_adopted_reused_direct_pid_is_reaped(self):
        spec = importlib.util.spec_from_file_location('isolated_runtime', LAUNCHER)
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        class Child:
            pid = 101
            def poll(self):
                return 23  # original direct child has already been reaped
        with patch.object(runtime.os, 'getpid', return_value=100), \
             patch.object(runtime.os, 'pidfd_open', return_value=200), \
             patch.object(runtime.os, 'close'), \
             patch.object(runtime.signal, 'pidfd_send_signal'), \
             patch.object(runtime.subprocess, 'Popen', return_value=Child()), \
             patch.object(runtime, 'process_tree', side_effect=[{100: {101}}, {100: set()}]), \
             patch.object(runtime.os, 'waitpid', return_value=(101, 0)) as reap:
            self.assertEqual(runtime.supervise(['fixture'], {}, None), 23)
            reap.assert_called_once_with(101, os.WNOHANG)

    def test_pidfd_requirements_fail_before_launch(self):
        spec = importlib.util.spec_from_file_location('isolated_runtime', LAUNCHER)
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        for failure in (OSError(38, 'not implemented'), PermissionError(1, 'blocked')):
            with patch.object(runtime.os, 'pidfd_open', side_effect=failure), \
                 patch.object(runtime.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'requires working.*no numeric PID fallback'):
                    runtime.supervise(['must-not-launch'], {}, None)
                launch.assert_not_called()
        with patch.object(runtime.signal, 'pidfd_send_signal', side_effect=OSError(38, 'not implemented')), \
             patch.object(runtime.os, 'pidfd_open', return_value=200), \
             patch.object(runtime.os, 'close') as close, \
             patch.object(runtime.subprocess, 'Popen') as launch:
            with self.assertRaisesRegex(RuntimeError, 'requires working.*no numeric PID fallback'):
                runtime.supervise(['must-not-launch'], {}, None)
            close.assert_called_once_with(200)
            launch.assert_not_called()

    def test_cancellation_cleanup(self):
        witness = self.root / 'root.json'
        script = self.fixture('wait.ts', f'import {{writeFileSync}} from "node:fs"; writeFileSync({json.dumps(str(witness))}, JSON.stringify(process.env.PI_JEV_TEST_ISOLATED_ROOT)); process.on("SIGTERM",()=>{{}}); setInterval(()=>{{}},1000);')
        child = subprocess.Popen(self.command('run', script), cwd=self.root, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic()+5
            while not witness.exists() and time.monotonic()<deadline:
                time.sleep(.02)
            self.assertTrue(witness.exists())
            root = Path(json.loads(witness.read_text()))
            child.send_signal(signal.SIGTERM)
            child.communicate(timeout=5)
            self.assertNotEqual(child.returncode, 0)
            self.assertFalse(root.exists())
        finally:
            if child.poll() is None:
                child.kill()
                child.communicate()

if __name__ == '__main__':
    unittest.main(verbosity=2)
