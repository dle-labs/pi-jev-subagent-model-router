# Test-isolation incident and corrective gate

## Confirmed incident

During Task 1, adapted configuration tests used `node:os.homedir()` after a Bun preload changed `HOME`. Bun 1.4.2 had already cached the original home. The test fixture consequently wrote and removed these personal paths instead of temporary fixture files:

- `/home/dle/.pi/agent/pi-jev-model-router.json`
- `/home/dle/.pi/agent/pi-jev-model-router.generated.json`

The successful pre-fix fixture executions, fixture source, and recorded `homedir()`/`HOME` mismatch substantiate the operations. Whether either file existed beforehand, its previous contents, and any effect on concurrent processes remain **unknown**. No before-image was captured. Confirmed destructive operations are not proof that preexisting data was lost.

This violated the project's isolation requirement. The incident was disclosed, implementation/test execution paused, and Task 1 acceptance blocked. No personal-settings inspection or restoration was attempted. The user subsequently authorized isolation remediation, independent review, and sandboxed verification—not personal-settings recovery.

## Evidence and review

Session worker identifiers:

- `bf41013f-c494-450`: stopped baseline worker; partial source/tooling work.
- `c208e8b7-6374-4f3`: continuation; pre-fix executions, diagnosis, initial fresh-process fix, and incident report.
- `83496499-a828-4cf`: read-only Astra review; confirmed incident mechanism and remaining isolation defects.

The review found that probe subprocesses still omitted startup HOME isolation; Bun startup could read ambient configuration before sanitization; the restarting preload had unsafe import/no-test modes; and direct opt-in commands were not portable. These findings block acceptance despite the worker's later passing test reports.

Earlier syscall evidence covered only selected `openat` and network calls and one literal path prefix. It did not prove absence of all filesystem access or mutations. Earlier passing counts are historical worker evidence, not fresh acceptance of a safe test boundary.

## Corrective execution boundary

`./scripts/verify-sandbox.sh` is a **local Linux verification harness**, not a package/runtime requirement. It uses bubblewrap to provide:

- Separate network, PID and other namespaces, with external network unreachable.
- No personal home or user-service socket directories.
- A read-only repository at `/workspace`, with Git metadata hidden.
- Private writable `/tmp` and synthetic HOME, agent and XDG directories.
- Only selected Bun/Node executable files from user-owned installations; not their parent directories or settings.
- A cleared environment and a dedicated writable evidence directory.
- Process-tree `%file`, `%network` and `%process` syscall tracing.

The guard checks personal-home/service absence, read-only workspace enforcement, and an `ENETUNREACH` result for a documentation-only test IP before running the requested command. These are boundary checks, not proof that all subsequent code is correct. Trace interpretation must account for relative paths, subprocesses, failed accesses and the explicitly mounted executables; zero keyword matches alone are insufficient.

Invocation from a clean shell environment:

```bash
env -i PATH=/usr/bin:/bin bash --noprofile --norc \
  scripts/verify-sandbox.sh <command> [arguments...]
```

The default executable paths match this local workstation; `JEV_SANDBOX_BUN` and `JEV_SANDBOX_NODE` may select other executable files. No dependency installation or external network access is enabled. Patched external SDK workspaces are not mounted by this baseline harness.

Initial boundary checks passed: the host and sandbox had distinct network namespace identities; personal home was absent; workspace writes failed read-only; external connection failed unreachable. Synthetic startup regressions must precede suite/SDK imports. Safe command dispatch and actual test execution/counts must be checked independently—a zero exit alone is not evidence that tests ran.

## Historical status at Task 1 acceptance (superseded)

The status and counts below describe that checkpoint, not current verification. Native and patched suites were subsequently rerun under the repaired sandbox; see [compatibility evidence](compatibility-evidence.md) and [Task 14 follow-up](task14-finalaudit-followup.md). Current native opt-in also mounts the explicitly selected read-only patched workspaces. These later checks do not resolve the unknown prior contents or effects of the personal-file incident.

Sol repaired startup isolation and added synthetic regression tests. Parent reruns passed 15 isolation cases (`/tmp/jev-sandbox-evidence-FGw2YM`), baseline integrity for 18 files, 138 adapted/unit tests, 140 reference tests in six separate processes, and typecheck (`/tmp/jev-sandbox-evidence-Jcz9yu`).

Astra's re-review (`762aea45-474c-4c9`) accepted the documented sandbox entry for confined baseline verification and found the original startup-isolation issues repaired. It identified one remaining nested-cancellation defect: the outer launcher can kill a nested Python supervisor before that supervisor terminates a separately grouped Bun runtime. This can orphan a runtime and stall tracing, but does not expose personal HOME through the sandbox. Sol added a failing-first nested-cancellation regression and Linux subreaper supervision. Parent verification then passed all 16 isolation cases: the nested cancellation returned 143 in 1.061 seconds, both runtime PIDs were gone, and both temporary roots were removed after reaping (`/tmp/jev-sandbox-evidence-VqmVzK`). Fresh baseline, default tests, reference tests and typecheck also passed (`/tmp/jev-sandbox-evidence-08UBxu`, per-mode logs retained). Re-review confirmed the nested-topology fix but identified PID-only signalling/state as a remaining reuse race. Sol replaced it with validated pidfd signalling and per-live-reference escalation state, with deterministic stale/reused-identity regressions. Parent then passed 20 isolation cases plus baseline/default/reference/typecheck in `/tmp/jev-sandbox-evidence-GU1zBr` (per-mode logs and process-tree trace retained). Astra review `f21b4ea5-b06e-494` found no confirmed issues in the identity-bound fix. Isolation remediation is accepted only within the documented Linux sandbox. Task 1 baseline tooling subsequently passed final Astra quality review (`eb451723-595d-4eb`), with no confirmed findings. Native integration and router parity are still unverified. Work proceeds to Task 2 contracts; no personal-settings recovery or remote/installed-package changes are authorized by this acceptance.

Native integration/patched suites have not been rerun under the repaired boundary. The router implementation and full parity gates remain incomplete. This remediation does not establish that the prior personal files were absent, restored, or unaffected.
