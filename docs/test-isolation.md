# Test isolation and supported verification entry

Isolation remediation passed independent Astra safety review and parent
verification under the documented Linux sandbox. Task 1 baseline tooling also
passed Astra quality review (`eb451723-595d-4eb`). This is not a native-control
or full-router compatibility claim.
No personal settings were inspected, restored, or guessed. The prior incident's
original legacy Jev file contents remain unknown.

## Outer entry (before the first Bun process)

Current verification is supported **only inside the parent's verified Linux OS
sandbox**, using this exact outer command from the repository:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh isolation
```

After the synthetic `isolation` gate passes, replace the final mode with `core`,
`test`, `reference`, `typecheck`, or `baseline`. `test` is unit plus adapted core.
`integration`, `patched`, `race`, and `safe` remain explicit opt-ins and need
explicit runtime package locations **already mounted by the parent**. Do not add
mounts, install dependencies, or fall back to host execution to satisfy them.
The sandbox has no personal HOME, no user services, read-only source, private
writable `/tmp`, hidden Git metadata, and unreachable external networking.

`package.json` scripts delegate to the same shell/Python bootstrap, but
**`bun run` itself starts Bun before the script executes**. It is NOT a supported
outer safety boundary. In-runtime sanitation cannot undo prior startup config
or preload discovery. Use the outer command above, not ambient `bun run`,
`bun test`, direct preload execution, or direct probe execution.

### Opt-in native dependency mounts

The local wrapper now supports `JEV_SANDBOX_NATIVE=1` in the outer `env -i`
invocation. Astra review `d2445fc3-d48a-4c7` approved this scoped mount extension
with no actionable findings; native-gate acceptance remains separate. It mounts
only the fixed disposable patched Tintin runtime,
its dependency directory, the Pi dependency directory, and eight selected Pi
package roots, all read-only. It does not mount enclosing source checkouts,
their Git metadata, `/tmp` from the host, or personal HOME. The default remains
no external runtime mounts; invalid values and missing roots fail closed.

The wrapper supplies `PI_PROBE_HOST_ROOT` from the repository's installed public
dev dependency and `PI_PATCHED_HOST_ROOT` / `PI_PATCHED_TINTIN_ROOT` from the
archived local-patch workspaces. Synthetic mount checks verify read-only package
roots, expected public dependency links, and continued absence of personal home
and source Git metadata. Passing these checks is not native compatibility proof.

The generic bootstrap is `scripts/isolated-runtime.py`, invoked with isolated
Python (`python3 -I`), an explicit absolute `--bun` executable, and `test` plus
existing absolute test paths, or `run` plus an absolute TypeScript entry. It uses
only Python's standard library, no package installation. Linux `prctl` child
subreaping, `/proc` ownership traversal, and working `os.pidfd_open` /
`signal.pidfd_send_signal` are required (Python 3.9+ and a kernel with both
pidfd syscalls, normally Linux 5.3+). Both syscalls are probed before runtime
launch; missing APIs, unsupported syscalls, or denied access fail closed with an
explicit diagnostic, never a numeric-PID signalling fallback. Only Linux/Bun
1.4.2 was tested. Other platforms are rejected. The shell mode wrapper currently
selects sandbox `/opt/bun`, and `typecheck` requires sandbox `/opt/node`.

## Environment and validator contract

The bootstrap allocates a new `jev-core-test-*` root and creates HOME,
USERPROFILE, PI_CODING_AGENT_DIR, XDG_CONFIG_HOME, XDG_CACHE_HOME and XDG_DATA_HOME
before Bun starts. TMPDIR is also private to that invocation. Credentials,
NODE_OPTIONS, BUN_OPTIONS, router settings and other ambient variables are not
forwarded. OS basics and the three explicitly opt-in probe-location variables
are retained. An inherited isolation marker is rejected by the outer bootstrap;
the nested-child helper deliberately removes it to allocate a fresh child root.

An explicit empty Bun config and `--no-env-file`, `--no-install`, and explicit
validator preload are supplied. Flag syntax was verified using sandboxed help
and a real single-test witness: **`--config=/absolute/path`**, not a separated
`--config /path` token. On this Bun build the latter was observed to exit 0
without running the intended command. Do not use version-only exit status as a
test-run witness.

`test/support/agent-dir-preload.ts` is a validator only. It checks the marker,
directories, complete expected environment and Bun's cached `node:os.homedir()`.
It never modifies HOME, replays `/proc/self/cmdline`, spawns a restart, or exits
an importing application. Missing or inconsistent isolation throws before SDK
or core imports. Direct execution of the validator also throws.

The launcher expands directories into an explicit sorted/deduplicated list of
`.test.ts` files; no unrestricted discovery or test-filter options are accepted.
It requires a positive Bun test summary whose reported file count matches that
list; zero-test exit 0 is converted to failure. Test stderr is buffered in a
private temporary file and printed after exit, so live test progress is delayed.
A Bun summary-format change fails closed. This checks positive execution and
file discovery, not a source-parsed count of every test declaration.

Each integration/patched subprocess goes through `isolatedChild`, Python, then
a fresh Bun startup HOME. Race/safe probes retain their original fake providers,
assertions and temporary projects but do not change HOME midprocess. They
revalidate cached home before SDK imports. Reference tests remain byte-identical
and execute one file per process with distinct startup HOME. No vendor or core
policy code was edited.

Normal exit propagates exact exit status. Every Python bootstrap is a Linux
child subreaper before starting its runtime. SIGINT/SIGTERM are forwarded to
owned descendants, including nested runtime sessions, using `/proc` child
ownership (all runtime threads), not just the direct Bun process group.
Each signal uses an identity-bound pidfd, not `os.kill(pid, ...)`. Discovery
numbers are candidates only: acquisition observes `/proc` PPid/starttime, opens
the pidfd, rechecks the observation and current parent ownership, then verifies
that both the child fd and its validated parent fd are still live. Exited fds
remain readable after reaping/PID reuse, so the post-validation liveness check
rejects an old fd even if replacement stat data happen to match. Parent-first
validation anchors the chain at this still-running subreaper; racing adoption
is retried from the next snapshot. Exit between validation and signal cannot
redirect a pidfd to a replacement process.

TERM delivery and leaf deadlines live on each process reference, not its reusable
PID. Refresh closes exited descriptors and removes their state before accepting
a replacement; rejected acquisitions close immediately and finalization closes
all retained descriptors. A live child adopted by the subreaper keeps its fd and
state. A newly owned replacement starts fresh TERM/grace state. Numeric `waitpid`
is used only for adopted direct children, whose status the kernel binds to this
parent; the original direct PID is reserved for Popen only until Popen reaps it.
Orphaned descendants are adopted and reaped. The direct runtime's exit does not
finish supervision: its remaining descendants are terminated and reaped before
owned HOME removal. No environment/schema/helper field was added.

Escalation is bottom-up: a leaf process gets one second before SIGKILL; parents
with children are not killed prematurely. After their last child disappears,
parents get their own one-second opportunity to reap and clean up before
escalation. Thus a nested Python supervisor can remove its HOME after its
SIGTERM-ignoring Bun is reaped, even if outer Bun exits immediately. This is
ownership supervision, not a larger fixed delay or a claim that direct-child
exit means descendant exit. Finite synthetic trees terminate boundedly; this
is not a hard wall-clock guarantee for arbitrary continually forking processes
or uninterruptible kernel waits. SIGKILL of a bootstrap or loss of `/proc`
availability is not a cleanup guarantee. The OS sandbox, not environment
variables or a marker, remains the actual confinement boundary.

## Regression and verification evidence

All execution below used the exact outer wrapper. Evidence directories contain
`process-tree.strace` (`%file,%network,%process`). Traces are supporting evidence,
**not proof of confinement alone**; the parent-owned bwrap setup and its guards
establish the boundary before executing any command.

- CLI help: `/tmp/jev-sandbox-evidence-hcgj8O/process-tree.strace`, exit 0.
- Explicit `--config=...` single-test CLI witness:
  `/tmp/jev-sandbox-evidence-Sd7rTG/process-tree.strace`, 1 pass / 1 file, exit 0.
- Initial synthetic red:
  `/tmp/jev-sandbox-evidence-22CzHL/process-tree.strace`, 9 cases, 5 failures,
  exit 1. In particular the old unsafe preload import incorrectly exited 0;
  the other failures included the intentionally absent new bootstrap.
- Cancellation escalation red:
  `/tmp/jev-sandbox-evidence-u29jKw/process-tree.strace`, gate timed out after
  20 seconds on a synthetic Bun child deliberately ignoring SIGTERM. The
  escalation fix subsequently passed; no SDK or real HOME was involved.
- Explicit empty-suite red:
  `/tmp/jev-sandbox-evidence-Bwv834/process-tree.strace`, 14 cases, 1 failure,
  exit 1 because Bun returned successful zero-test execution.
- Probe-argument propagation red:
  `/tmp/jev-sandbox-evidence-hoeUZK/process-tree.strace`, 15 cases, 1 failure,
  exit 1: bootstrap argparse incorrectly consumed probe flags. A remainder
  argument list fixes forwarding without accepting Bun test flags.
- Final green collection:
  `/tmp/jev-sandbox-evidence-MlCFuP/process-tree.strace`. Each mode exited 0:
  - `isolation`: 15 Python regression cases. Synthetic-only: sentinel legacy
    configs, ambient bunfig/dotenv/preload poison, noargs, inherited marker,
    direct imports, actual cached-home mismatch, complete discovery, empty
    directory/file rejection, exit/failure propagation, nested probe-location
    propagation, probe argument forwarding, cancellation and HOME cleanup.
  - `core`: 129 pass, 0 fail, 5 files.
  - `test`: 138 pass, 0 fail, 7 files (129 core + 9 unit).
  - `reference`: config 31, jev 13, router 52, budget 12, ranking 20,
    extension 12; total 140 pass, 0 fail, 6 separate Bun test processes.
  - `typecheck`: exit 0, no diagnostics.
  Exact stdout/stderr are retained as `<mode>.stdout` / `<mode>.stderr` in that
  evidence directory. The collector executed, in order:
  `/bin/sh /workspace/scripts/isolated.sh isolation`, `core`, `test`,
  `reference`, `typecheck`, `baseline`, through sandboxed `/usr/bin/python3 -I`.
- Pinned vendor integrity:
  `/tmp/jev-sandbox-evidence-icI8S8/process-tree.strace`, outer wrapper plus
  `/bin/sh /workspace/scripts/isolated.sh baseline`, exit 0: 18 byte-identical
  upstream files at `f1a6f0381ef10899319542525f4d53c76c368396`.

### Nested cancellation repair (reviewed; PID identity correction below)

- RED: `/tmp/jev-sandbox-evidence-vGyxNM/process-tree.strace`, focused actual
  `isolatedChild` topology regression, exit 1 in 5.147 seconds. Inner Bun PID 16
  remained alive after its owned root had been removed. The synthetic test's
  subreaper guard killed/reaped fixture descendants; the traced command returned,
  rather than stranding strace. An in-sandbox timeout was also installed as a
  bounded outer guard for this RED run.
- GREEN: `/tmp/jev-sandbox-evidence-45gaRl/process-tree.strace`, exact `isolation`
  gate, 16 cases passed in 3.465 seconds, exit 0. Readiness is an explicit pipe
  witness emitted after inner Bun installs its SIGTERM-ignore handler. Cancelling
  the outer launcher must finish nonzero within five seconds, both runtime PIDs
  must be absent from `/proc`, and both fixture roots must be absent. Polling
  rejects any observed HOME removal while its runtime still exists; the guard
  also asserts no synthetic descendant remains to strand tracing. Existing
  one-level cancellation and nonzero propagation tests remain unchanged.
- After that gate: `baseline` at `/tmp/jev-sandbox-evidence-1p6CMb` (18 identical
  vendor files); `test` at `/tmp/jev-sandbox-evidence-fuDGYG` (138 pass / 7 files);
  `reference` at `/tmp/jev-sandbox-evidence-TtXYSv` (140 pass / 6 separate files);
  `typecheck` at `/tmp/jev-sandbox-evidence-tKE0Ir` (no diagnostics). All exited 0
  through the exact wrapper; each directory contains `process-tree.strace`.
- Final refreshed collection: `/tmp/jev-sandbox-evidence-S8oWY2`, with exact
  `<mode>.stdout`, `<mode>.stderr` and `process-tree.strace`. In order, `isolation`
  (16 cases, 3.493 seconds), `baseline`, `test`, `reference`, `typecheck` all
  exited 0 with the same counts above. The nested witness recorded outer Bun
  PID 68 and inner Bun PID 74; cancellation returned 143 in 1.064 seconds,
  both were reaped and both fixture roots removed, with no premature cleanup
  observed and no descendants left for the guard to kill.

### PID identity repair (reviewed)

- Deterministic RED: `/tmp/jev-sandbox-evidence-SunQPJ/red.stdout`,
  `red.stderr`, and `process-tree.strace`. The existing numeric-PID supervisor
  failed because an owned replacement received SIGKILL at 1.05 seconds using the
  old identity's deadline, without its own TERM at 0.3 seconds.
- Adopted reused-direct-PID RED: `/tmp/jev-sandbox-evidence-ipRM7y/reap-red.stdout`,
  `reap-red.stderr`, and `process-tree.strace`. Once Popen had reaped its original
  child, the old unconditional PID exclusion incorrectly skipped a newly adopted
  child using the same number. Conditional exclusion preserves exact Popen status
  while allowing that adopted child to be reaped.
- Final GREEN: `/tmp/jev-sandbox-evidence-1tNjB2`, containing exact
  `<mode>.stdout`, `<mode>.stderr`, and `process-tree.strace`. The required outer
  wrapper ran `isolation` first, then `baseline`, `test`, `reference`, `typecheck`;
  all exited 0. Counts: 20 isolation cases in 3.499 seconds, 18 byte-identical
  baseline files, 138 default tests / 7 files, 140 reference tests / 6 separate
  files, and typecheck without diagnostics. Each mode had a sandbox-local
  60-second timeout guard.
- The deterministic tests execute the actual supervisor and identity helper with
  synthetic kernel observations. They cover exit/reuse after fd open, unowned
  reuse before open (including equal starttime), exit immediately before signal,
  fresh owned replacement TERM/grace, prompt stale-fd pruning and final closure,
  adoption retaining a live reference, exact direct status despite adopted PID
  reuse, and unavailable/denied pidfd syscalls before runtime launch. No real PID
  exhaustion or real unowned signal target is used.
- The unchanged real `isolatedChild` SIGTERM-ignore cancellation regression
  reported runtime PIDs 69/75, exit 143 in 1.064 seconds, both reaped and both
  fixture roots removed, with no premature cleanup observed. This is condition
  polling evidence, not continuous proof of cleanup ordering. Readiness and the
  five-second assertion plus synthetic-descendant guard remain intact.

Pidfds prevent signalling a reused numeric PID; they do not make `/proc` a
transactional tree snapshot or provide a hard shutdown bound for continuously
forking/uninterruptible processes. Resource exhaustion, supervisor SIGKILL, or
loss of required kernel facilities still cannot guarantee cleanup. This repair
is not a new sandbox or SDK/native-control compatibility claim. Astra review
`f21b4ea5-b06e-494` found no confirmed issues in the scoped repair. Parent's fresh
confined run `/tmp/jev-sandbox-evidence-GU1zBr` passed 20 isolation cases,
baseline integrity, default/reference suites and typecheck; per-mode logs are
retained. Task 1 baseline tooling subsequently passed final Astra quality review.

Integration/patched native-control suites were **not executed**: explicit
patched runtime dependencies were not mounted. Synthetic direct-import and
nested-child guards cover startup isolation, not their SDK scenario outcomes.
No commits, installs, network calls, paid calls, or Tasks 2+ were performed.
Native integration acceptance remains separate from Task 1 tooling review.
