"""Non-Bun bootstrap; invoke with python3 -I and an explicit Bun executable.
This is environment hygiene, not an OS sandbox. Current verification requires
verify-sandbox.sh. No ambient Python/Bun config or credential environment is kept.
"""
import argparse
import ctypes
import os
from pathlib import Path
import signal
import select
import re
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]
KEEP = ('PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
        'LANG', 'LC_ALL', 'TZ', 'TERM', 'CI', 'PI_PROBE_HOST_ROOT',
        'PI_PATCHED_HOST_ROOT', 'PI_PATCHED_TINTIN_ROOT')

def process_tree(pid):
    """Linux ownership tree, including children spawned by runtime threads."""
    tree = {}
    def visit(parent):
        children = set()
        try:
            tasks = list(Path(f'/proc/{parent}/task').iterdir())
        except FileNotFoundError:
            return
        for task in tasks:
            try:
                children.update(map(int, (task / 'children').read_text().split()))
            except FileNotFoundError:
                pass
        tree[parent] = children
        for child in children:
            visit(child)
    visit(pid)
    return tree


def process_identity(pid):
    # /proc comm may itself contain spaces or ')'. Fields after its final ')'
    # start with state; ppid and starttime are fields 4 and 22 respectively.
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return int(fields[1]), int(fields[19])


def require_pidfds():
    message = 'Linux supervision requires working os.pidfd_open and signal.pidfd_send_signal; no numeric PID fallback'
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError(message)
    fd = None
    try:
        fd = os.pidfd_open(os.getpid())
        signal.pidfd_send_signal(fd, 0)
    except OSError as error:
        raise RuntimeError(message) from error
    finally:
        if fd is not None:
            os.close(fd)


class OwnedProcess:
    def __init__(self, pid, fd):
        self.pid, self.fd = pid, fd
        self.signalled = False
        self.deadline = None

    def alive(self):
        # Exited pidfds stay readable even after the PID is reaped and reused.
        return not select.select([self.fd], [], [], 0)[0]


class OwnedProcesses:
    """Small pidfd registry for this supervisor's /proc ownership snapshots."""
    def __init__(self, owner):
        self.owner = owner
        self.refs = {}

    def close(self):
        for ref in self.refs.values():
            os.close(ref.fd)
        self.refs.clear()

    def refresh(self, tree):
        for pid, ref in list(self.refs.items()):
            if not ref.alive():
                os.close(ref.fd)
                del self.refs[pid]  # discard TERM/grace along with the old fd
        owned = {}
        def visit(parent):
            for pid in tree.get(parent, ()):
                if pid == self.owner or pid in owned:
                    continue
                ref = self.refs.get(pid)
                fd = None
                try:
                    observed = process_identity(pid)
                    if ref is None:
                        fd = os.pidfd_open(pid)
                        ref = OwnedProcess(pid, fd)
                    # Open BEFORE validating ownership, then test liveness AFTER
                    # stat. If exit/reuse occurred around open/stat, the old fd is
                    # readable or the observations differ: neither is tracked.
                    confirmed = process_identity(pid)
                    if (observed != confirmed or confirmed[0] != parent or
                            not ref.alive() or
                            (parent != self.owner and not owned[parent].alive())):
                        continue
                    if fd is not None:
                        self.refs[pid] = ref
                        fd = None
                    owned[pid] = ref
                    visit(pid)
                except (FileNotFoundError, ProcessLookupError):
                    pass  # reaping/adoption races are retried on the next tree
                finally:
                    if fd is not None:
                        os.close(fd)
        visit(self.owner)
        return owned

    def shutdown(self, tree, signum, now):
        owned = self.refresh(tree)
        for pid, ref in owned.items():
            try:
                if not ref.signalled:
                    signal.pidfd_send_signal(ref.fd, signum)
                    ref.signalled = True
                if tree.get(pid):
                    ref.deadline = None
                else:
                    if ref.deadline is None:
                        ref.deadline = now + 1
                    if now >= ref.deadline:
                        signal.pidfd_send_signal(ref.fd, signal.SIGKILL)
            except ProcessLookupError:
                pass  # fd remains identity-bound; refresh closes it after exit


def supervise(command, env, stderr):
    require_pidfds()  # probe kernel/Python support before launching any runtime
    # PR_SET_CHILD_SUBREAPER: orphaned nested sessions remain ours to wait/reap.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'Cannot enable Linux child subreaper')
    shutdown = None
    def cancel(signum, frame):
        nonlocal shutdown
        if shutdown is None:
            shutdown = signum
    previous = {s: signal.signal(s, cancel) for s in (signal.SIGTERM, signal.SIGINT)}
    child = None
    processes = OwnedProcesses(os.getpid())
    try:
        child = subprocess.Popen(command, cwd=REPO, env=env, start_new_session=True, stderr=stderr)
        while True:
            status = child.poll()
            # Reap adopted children without stealing Popen's direct-child status.
            tree = process_tree(os.getpid())
            # Only reserve the direct PID while Popen still owns its status.
            # After poll reaps it, that number may name a newly adopted child.
            reserved = {child.pid} if status is None else set()
            for pid in tree.get(os.getpid(), set()) - reserved:
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass
            tree = process_tree(os.getpid())
            descendants = set(tree) - {os.getpid()}
            processes.refresh(tree)
            if status is not None and not descendants:
                return status
            if status is not None and shutdown is None:
                shutdown = signal.SIGTERM
            if shutdown is not None:
                # Bottom-up grace still lets nested supervisors reap and remove
                # HOME, but both signals and escalation state belong to pidfds.
                processes.shutdown(tree, shutdown, time.monotonic())
            time.sleep(.01)
    finally:
        processes.close()
        for s, handler in previous.items():
            signal.signal(s, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bun', required=True)
    parser.add_argument('mode', choices=['test', 'run', 'typecheck'])
    parser.add_argument('paths', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if sys.platform != 'linux':
        parser.error('Linux only; descendant supervision requires prctl and /proc')
    if 'PI_JEV_TEST_ISOLATED_ROOT' in os.environ:
        parser.error('Inherited isolation marker forbidden; use the outer launcher')
    bun = Path(args.bun)
    if not bun.is_absolute() or not bun.is_file():
        parser.error('--bun must name an explicit absolute executable')
    if args.mode != 'typecheck' and not args.paths:
        parser.error('Explicit test paths or script required; unrestricted discovery forbidden')
    paths = []
    if args.mode == 'test':
        for item in args.paths:
            p = Path(item)
            if not p.is_absolute() or not p.exists():
                parser.error('Test paths must be existing absolute paths')
            paths.extend(sorted(p.rglob('*.test.ts')) if p.is_dir() else [p])
        paths = sorted(set(paths))
        if not paths or any(not p.name.endswith('.test.ts') for p in paths):
            parser.error('No explicit test files discovered')
    elif args.mode == 'run':
        p = Path(args.paths[0])
        if not p.is_absolute() or not p.is_file() or p.suffix != '.ts':
            parser.error('Script must be an existing absolute TypeScript path')
    elif args.paths:
        parser.error('typecheck takes no paths')
    with tempfile.TemporaryDirectory(prefix='jev-core-test-') as directory:
        root = Path(directory)
        env = {k: os.environ[k] for k in KEEP if k in os.environ}
        for name in ('home', 'agent', 'config', 'cache', 'data'):
            (root / name).mkdir()
        env.update(HOME=str(root/'home'), USERPROFILE=str(root/'home'),
                   PI_CODING_AGENT_DIR=str(root/'agent'), XDG_CONFIG_HOME=str(root/'config'),
                   XDG_CACHE_HOME=str(root/'cache'), XDG_DATA_HOME=str(root/'data'),
                   TMPDIR=str(root), PI_OFFLINE='1', PI_JEV_TEST_ISOLATED_ROOT=str(root))
        config = root/'bunfig.toml'
        config.write_text('[test]\npreload = []\n')
        flags = ['--no-env-file', '--no-install', '--config='+str(config),
                 '--preload='+str(REPO/'test/support/agent-dir-preload.ts')]
        if args.mode == 'test':
            command = [str(bun), 'test', *flags, *map(str, paths)]
            print(f'Isolation discovery: {len(paths)} explicit files', flush=True)
        elif args.mode == 'run':
            command = [str(bun), *flags, *args.paths]
        else:
            node = '/opt/node' if Path('/opt/node').is_file() else None
            if not node:
                parser.error('typecheck currently requires sandbox /opt/node')
            command = [node, str(REPO/'node_modules/typescript/bin/tsc'), '--noEmit']
        # Bun can exit 0 for an explicit file containing no tests. Require a real
        # positive test summary matching discovery, not merely successful exit.
        test_output = tempfile.TemporaryFile(mode='w+', encoding='utf8') if args.mode == 'test' else None
        status = supervise(command, env, test_output)
        if test_output is not None:
            test_output.seek(0)
            output = test_output.read()
            test_output.close()
            sys.stderr.write(output)
            summary = re.search(r'Ran (\d+) tests? across (\d+) files?\.', output)
            if status == 0 and (not summary or int(summary[1]) == 0 or int(summary[2]) != len(paths)):
                print('Missing/zero/incomplete test summary; refusing silent success', file=sys.stderr)
                status = 1
        return status if status >= 0 else 128-status

if __name__ == '__main__':
    sys.exit(main())
