# Task 3 native compatibility evidence

Task 1/2 work is preserved. These opt-in scripts implement standalone gates, not a
router engine, production child controller, or Tasks 7–10. No installed runtime
was patched, no private SDK module was imported, and no real provider/network
call, install, commit, remote operation or personal configuration was used.

## Task13 additive production acceptance (historical reconciliation checkpoint)

The pending-review and unprovisioned/exit-78 statuses in this checkpoint are historical, not current. Task13 specification and quality reviews subsequently passed; the user-approved [verification-only CI adaptation](#ci-verification-only-adaptation-hosted-execution-unverified) supersedes the unconditional CI blocker. Hosted CI execution remains unverified. Task14 findings and follow-up are tracked separately in [task14-finalaudit-followup.md](task14-finalaudit-followup.md); full final acceptance remains pending.

`test/integration/parity-native.test.ts` is a separate native opt-in file; default discovery still runs only static `parity.test.ts`. It copies byte-identical production `src`, entry and manifest into the existing private fixture and resolves unchanged public package dependencies like `extension.test.ts`. Calls originate from actual fake-provider model-issued Agent tools, never direct execute callbacks/backend setters. The only additive fixture option is `childToolCall(prompt, context)`, an authored public-provider response seam needed to issue an actual nested Agent; it does not alter backend execution or usage.

New acceptance cells, executed in `/tmp/jev-sandbox-evidence-ozAerS/final-native.log`:

- Auto: allowed/high; notify and UI keep: native parent/medium; headless confirm: allowed/high; selected: allowed/high; cheaper: parent/off. Each checks exactly one provider execution, effective retained model/thinking, actual native tool receipt, unchanged parent/global pair and nonzero 0.2 reported cost.
- Missing key: zero classifier calls, native parent/medium success. Excluded configured chain with allowed native scope but empty intersection: one classification, **no automatic model or thinking injection**, native parent/medium success, not a call-error fallback.
- Valid `resume:""` and `schedule:""`: immediate new launch, allowed/high, one classification/execution. Truthy operations remain separate existing skip/resume evidence.
- Real pending fake classifier transport (not backend mock), configured 25ms deadline: native parent/medium success without stale input injection. Non-OK secret-bearing error: one attempt, native fallback, no raw task/key in notifications/cards/ledger.
- Deferred classification plus public off/on or project-config-generation change: unchanged native defaults and one native execution, no stale injection. Those invalidated admissions lose safe accounting correlation; logs explicitly label their cost **unobserved-cancelled-admission**, never zero or complete. Public `parent.abort()` during the classification barrier: no child execution or injected settings; subsequent admitted launch executes once. No private cancellation patch, elapsed sleep, controller or backend replacement.
- Two real native launches through one preserved production binding verify WHY replaces an old eligible task with a new valid task whose retained 4,096-character prefix is blank. It retains original agent/count and visible truncation, sends no suffix/previous task, and launches no new child. The command method correction is documented in [commands-contracts.md](commands-contracts.md#task13-narrow-why-follow-up-astra-finding-a977136f); Astra re-review is pending.

Actual aggregate-descendant witness: authored `maxSubagentDepth:3`, `allowed_subagents:[nest-leaf]`, nonisolated parent and public nested Agent tool. Top-level child performs two 0.125 provider turns; its real nested child performs one 0.125 turn. The public record reports input/output 3/3 and **cost 0.375**; production observer records **one immutable ancestor origin/watermark 0.375**, unchanged on repeat status/replay. No `lifetimeUsage` field is assigned by the test. Published Tintin `src/nested-tools.ts:274–289` folds descendant assistant usage into ancestors; native receipts/provider witnesses now establish this path executes, not just a unit example. Pricing still reports `incomplete`, `aggregate-loses-missing-cost` and `descendant-coverage-unknown`: one measured nested branch does not prove universal lifetime coverage.

This adds **two native test declarations** (15 successful launch cells plus public cancellation, and one actual nested aggregate case), not 16 or 18 new test declarations. Final native gate is **9 pass, 0 fail, 559 assertions, six files**: previous seven native tests plus these two; no static parity count is included. Existing cancelled-tree, real compaction/control, published unsupported 3B and patched synchronization evidence are preserved unchanged. Full outcomes and per-row provenance are reconciled in [feature-parity.md](feature-parity.md); CI remains unprovisioned/exit 78 and independent full-parity acceptance is not claimed.

## Status matrix

| Gate / layer | Observed status | Coverage |
| --- | --- | --- |
| 3A, published Pi 1.0.0 / Tintin 0.19.0 | Measured, with limitations below | 16 native calls: omitted/model-only/thinking-only/both definitions × caller omitted/explicit model + thinking `off` × foreground/background. Same-mode resume retains exact SDK session. |
| 3B, published packages | **BLOCKED**, exit 2 | Public Pi lacks `getConfigurationSnapshot`, `configureIfIdle`, `getConfigurationReceipt`. Live published Tintin registry also lacks its three control methods (3A report). No raw-setter fallback. |
| 3B, reviewed local patched sources, current approved scope | **VERIFIED SUPPORTED LIFECYCLE**, exit 0 | All unchanged 15-native-scenario foundation checks, second-field/listener/receipt contracts, and deferred-auth public disposal pass. Same-record replacement/ownership transfer are explicitly **not applicable**, not verified successes. Field attacks remain supplemental. |
| 3B, prior broader lifecycle scope (historical) | **BLOCKED**, exit 2 | Prior reports required absent public same-record replacement/owner-transfer transitions. Preserved below as historical evidence, superseded only by the explicit user applicability decision. |
| Full router/controller and Jev parity | **NOT VERIFIED** | Not implemented by these gates. |

### Concrete published limitations

- Omitted thinking in Tintin leaves selection to the SDK default (`medium` in
  this fixture), **not** the parent's live `off`. Explicit caller `off` and
  authored definition `high` are separately measured; the gate does not label
  the omitted case as inheritance of the parent's live pair.
- A background-to-foreground resume retains the background spawn's optional
  `record.toolCallId`. Strict existing correlation correctly refuses it. RED
  evidence: `/tmp/jev-sandbox-evidence-rDw8Or/process-tree.strace` and its
  recorded test failure. The accepted measured matrix uses same-mode resume;
  cross-mode resume is **not claimed compatible**, and the assertion was not
  weakened or the record rewritten to conceal the conflict.
- Published scope policy trusts authored definitions and parent inheritance;
  the gate tests authenticated excluded caller selection refusal, not an
  invented strict policy for every authored definition.

## What is observed, rather than copied from static evidence

`runCompatibilityProbe()` loads the declared public SDK package export and the
unchanged published Tintin entry. `DefaultResourceLoader` trusts only the private
fixture project and explicit entries; personal extension/skill/settings discovery
is excluded. The selected Tintin dependency resolves to the same selected SDK
public entry, avoiding the old development peer or monorepo source alias.

Normal `Agent` calls come from the fake parent's provider stream and execute via
`parent.prompt()`, validation, `tool_call`, native tool execution and native tool
results. No direct execute callback or replacement launcher is used. The host
mutates input in `tool_call`; the actual native record's description and
`tool_result` input establish that the mutation reached execution. A separate
excluded-to-allowed mutation verifies actual selected model. Child provider
witnesses use each unique child prompt, independently of parent generation loops
and provider IDs (children can inherit the parent's model). Each spawn has one
actual child stream. Foreground progress updates, result prose, background
receipt status, exact result tool-call ID to child ID, optional record ID, idle
retention, same-mode resume identity, parent pair and settings preservation are
asserted from observations. Background readiness is verified after actual manager
settlement and provider witnesses, not assumed from an early started event.

RPC ping uses a unique reply channel subscribed before emit, checks the v2 success
/data envelope, and removes its listener in `finally`. Native malformed prompt
arguments are rejected before any child stream. Authenticated excluded RPC model
selection returns the authoritative scope error without starting a provider.
Fixture bus subscriptions are counted through the real SDK event bus; native
shutdown and fixture unsubscription leave zero. Fetch attempts are intercepted
and counted, in addition to OS network confinement. Setup/run/shutdown waits are
bounded; temporary fixtures and subscriptions are released in `finally`.

`runChildControlCapabilityProbe()` checks actual public API availability and
returns a structured nonzero blocked result for published Pi. On the patched
runtime it uses only the documented registry request signatures (no consumer
validator callback). Additional observations:

| Additional check | Actual fixture / assertion |
| --- | --- |
| Second-field validation | Valid new model plus invalid thinking is rejected; exact snapshot and transcript remain unchanged. |
| Supplemental ownership guard attack | Adversarial public record `parentAgentId` input refuses snapshot and valid configure; **both real SDK sessions' exact snapshots, entries and messages** are compared before/after each refusal and after restoration. Original field presence/value restored in `finally`; parent/settings unchanged. Not an ownership lifecycle. |
| Supplemental session-association guard attack | Public record temporarily points to a second real native SDK child. Both original **and other.session** snapshots/transcripts are captured and unchanged after each refusal/restoration. This is **not** supported SDK replacement. |
| Public disposal during authentication | Capture owner/session/revision; start wrapper configure; wait for fake provider auth entry; call real `AgentSession.dispose(): void`; release auth; require `rejected/disposed`. Compare all three real child sessions before lifecycle and after refusal (pair/transcript/messages unchanged), and exact snapshots after disposal against after refusal (only lifecycle revision advance allowed). Parent pair/snapshot/history and settings unchanged. No record assignments/backend mocks. |
| Post-commit listener failure | Real SDK subscriber throws on thinking notification; pair remains committed and receipt carries diagnostic error, not rollback. Receipt is already accessible inside the listener. |
| Lost acknowledgement | Acknowledgement is deliberately discarded; public wrapper receipt lookup recovers the exact committed receipt without another commit. |

`additional.supplementalIdentity.coverageLayer` is explicitly
`supplemental-adversarial-public-record`, with
`nativeLifecycleReplacementVerified: false`. These guard attacks do not establish
native replacement/ownership-transfer coverage; those unsupported transitions are
not applicable under the current approved scope. `requiredPublicLifecycle.disposal` reports
`native-public-lifecycle`, separate from ownership change and actual replacement.
The additional commit appends exactly two configuration entries and preserves
settings. The unchanged `child-control-safe.ts` runs in its own startup-isolated
subprocess and measures 15 phases: in-memory/persisted/glob-scoped commits;
active, intervening-settled, background, queued, compaction, busy, cancelled,
auth-denied, changed/malformed scope, switch and stale refusals. Its original
assertions, receipt replay/conflict tests and new-pair native resume remain
unchanged. Negative old-setter probes remain a separate unsafe baseline control.

Archived focused SDK/wrapper ownership, replacement, storage failure, queue/bash,
capacity and notification tests are documented in
[`upstream-patches/README.md`](../upstream-patches/README.md),
[`upstream-synchronization-workspaces.md`](upstream-synchronization-workspaces.md),
and [`evidence/patched-child-control.json`](evidence/patched-child-control.json).
Their previously reviewed counts are **focused-layer prior evidence**, not new
native execution or a claim that every matrix cell is end-to-end.

## Approved applicability and preserved source justification

The user explicitly selected **“Scope to supported lifecycle (Recommended)”**.
Same-record SDK replacement and retained-child ownership transfer have no
established supported public transition in this backend. Their structured
`requiredPublicLifecycle` entries now report `status: "not-applicable"`,
`reason: "unsupported-public-lifecycle"`, `exercised: false`, `nativeVerified:
false`, the exact `userDecision`, and source evidence/detail. They are not passing
native cells. The justification below remains unchanged.

Only after all additional assertions and the unchanged native foundation pass,
the local patched capability report returns `status:
"verified-supported-lifecycle"`, gate `3B`, runtime `local-patched-only`,
`supportedLifecycleVerified: true`, `measuredContractsValid: true`, and exit **0**.
Missing public SDK/wrapper methods still return `blocked`, exit **2**; setup or
measured-evidence failure exits **1**. No arbitrary blocked report can count as
success. `fullRouterParityVerified` remains **false**. Published support,
production controls and full parity are not established.

Read-only source/doc evidence from the approved sandbox roots:

- Pi `docs/sdk.md` (Session lifecycle) and
  `examples/sdk/13-session-runtime.ts`: bare `AgentSession` exposes
  `dispose(): void`; replacement is provided by a distinct `AgentSessionRuntime`.
- Pi `src/core/agent-session-runtime.ts:83–95,196–260`:
  `newSession(options?: { parentSession?: string; setup?: (sessionManager:
  SessionManager) => Promise<void>; withSession?: (ctx: ReplacedSessionContext)
  => Promise<void> }): Promise<{ cancelled: boolean }>`;
  `switchSession(sessionPath: string, options?: { cwdOverride?: string;
  withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
  projectTrustContextFactory?: (cwd: string) => ProjectTrustContext }):
  Promise<{ cancelled: boolean }>`.
  These replace **runtime-owned** sessions; they are not retained-child registry
  replacement methods. Creating an unrelated host runtime would not establish a
  replacement of Tintin's pending child lease.
- Tintin `src/agent-runner.ts:1008–1026` uses
  `createAgentSession(sessionOpts)` and binds the bare child; it does not expose
  an `AgentSessionRuntime` for that child.
- Tintin `src/index.ts:746–757` exposes exactly the three conditional control
  operations, `waitForAll`, `hasRunning`, `spawn`, and `getRecord` on the public
  registry. There is no retained-child replacement or owner-transfer method.
  `spawnTopLevel` strips `parentAgentId` and `resumeSessionFile` (`699–717`).
- Tintin `src/agent-manager.ts:377–394,852–856` binds the lease to private owner
  session-manager/session identity. `resume(id, prompt, signal?, options?):
  Promise<AgentRecord | undefined>` (`1161–1173`) reuses the retained session.
  Eviction (`1515–1530`) removes the record and disposes it; public mention
  revival (`src/index.ts:996–1012`) calls `spawnResolved` to create a new record,
  rather than replacing the SDK session under an existing pending lease.

The existing foundation `switch` case emits `session_before_switch`; it proves
lifecycle epoch/record invalidation, **not** an actual runtime replacement or
ownership transfer. It remains unchanged. No field assignment, fake callback,
raw setter, archived focused test, or newly invented upstream API is substituted
for an absent public transition. The current user decision scopes these native
cells out; it authorizes no new API, maintained fork, installation or publication.
Future backend support requires fresh public-contract evidence before enabling
these transitions. Strict stale/foreign/identity refusal remains required.
The requested README RPC cross-reference is absent from the approved patched
root (`docs/rpc.md`); no network fetch or extra mount was attempted. Source
signatures above are the exact available evidence, not invented documentation.

## Reproduction and execution evidence

Only the parent-approved sandbox invocation is supported:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin JEV_SANDBOX_NATIVE=1 \
  /bin/bash --noprofile --norc scripts/verify-sandbox.sh \
  /bin/sh /workspace/scripts/isolated.sh native-gates
```

The parent wrapper supplies published and patched roots. For raw JSON use
`compatibility --host-root "$PI_PROBE_HOST_ROOT" --tintin-root
/workspace/node_modules/@tintinweb/pi-subagents`, or `capability` with the
published roots (expected exit **2**) or patched root variables (expected exit
**0** only for verified supported lifecycle), all through the same outer wrapper and `isolated.sh`. Never invoke host
Bun/Node or treat no-arguments exit zero as execution evidence. New modes remain
explicit opt-ins; default tests do not discover native integration.

- Initial tests-first RED: `/tmp/jev-sandbox-evidence-ctQax3`, 0 pass / 3 fail,
  two files; new probe entrypoints did not yet exist.
- Provider-contract RED: `/tmp/jev-sandbox-evidence-40vGWe`: actual native
  provider context has `messages`, not an assumed `tools` field. Fixture now uses
  prompt witnesses, never global provider-count assumptions.
- Progress tests-first RED: `/tmp/jev-sandbox-evidence-mPNrqO`, one failing
  foreground progress assertion before progress observations were implemented.
- Native gates GREEN: `/tmp/jev-sandbox-evidence-oaGUOI`, **3 pass / 0 fail,
  302 assertions, two files** (16-case 3A and published/patched 3B tests).
- Raw JSON/unchanged regressions collection:
  `/tmp/jev-sandbox-evidence-Tw551Y`. Exact `compatibility.stdout.json`,
  `published-capability.stdout.json` (exit 2), `patched-capability.stdout.json`,
  and per-mode stdout/stderr were written under sandbox `/evidence` and retained.
  Integration: **5 pass / 0 fail, 344 assertions, four files**;
  unchanged patched suite: **2 pass / 0 fail, 160 assertions, two files**.
  That collection preceded the additional foreground progress field; final
  refreshed report location is recorded below.
- Default suite: `/tmp/jev-sandbox-evidence-o93raE`, **148 pass / 0 fail,
  376 assertions, eight files**. Typecheck:
  `/tmp/jev-sandbox-evidence-LCDlQX`, exit 0, no diagnostics.

- Prior collection, **superseded for identity coverage**: **`/tmp/jev-sandbox-evidence-VYEFAE`**. Raw
  `compatibility.stdout.json` (16 cases, foreground progress, live published
  Tintin capability absence and malformed-schema refusal),
  `published-capability.stdout.json` (blocked, exit 2),
  `patched-capability.stdout.json` (15 unchanged native phases plus five
  additional checks), and all mode stdout/stderr are retained. **Native gates:
  3 pass / 0 fail, 305 assertions / two files; integration: 5 pass / 0 fail,
  355 assertions / four files; unchanged patched suite: 2 pass / 0 fail,
  160 assertions / two files; typecheck: exit 0 without diagnostics.**
  Strengthened valid configure ownership/replacement checks first failed at
  `/tmp/jev-sandbox-evidence-2eYMoG` before their observations existed.

### Focused identity revision (historical broader-scope evidence)

- Tests-first RED: `/tmp/jev-sandbox-evidence-8SUtd0`, **2 pass / 1 fail,
  219 assertions**. The unchanged patched probe returned exit 0 instead of the
  newly required blocked exit 2; no implementation preceded this test.
- Expanded transcript evidence exposed truncated 65,536-byte pipe output
  (`/tmp/jev-sandbox-evidence-lOtlci`; native tests failed JSON decoding at
  `/tmp/jev-sandbox-evidence-cxbl3F` and `-OIH6XM`). The probe now awaits the
  stdout stream write callback; it does not discard or summarize transcript
  evidence to conceal the truncation.
- Final collection: **`/tmp/jev-sandbox-evidence-Igma3W`**. Retained files:
  `compatibility.stdout.json` (**16 cases**, measured, exit 0),
  `published-capability.stdout.json` (**blocked, exit 2**),
  `patched-capability.stdout.json` (**blocked, exit 2**, 226,631 bytes;
  15 valid unchanged foundation scenarios, supplemental both-session snapshots /
  entries / messages before and after each refusal and restoration, and genuine
  deferred-auth SDK disposal evidence). All three raw reports have empty stderr.
  `verification-summary.json` records exits/counts; every mode has retained
  stdout/stderr and the process tree trace is retained.
- **Native gates: 3 pass / 0 fail, 333 assertions, two files; integration:
  5 pass / 0 fail, 383 assertions, four files; unchanged patched suite:
  2 pass / 0 fail, 160 assertions, two files; default: 148 pass / 0 fail,
  376 assertions, eight files; typecheck: exit 0, no diagnostics.** The passing
  blocked-status tests do not mean the required replacement gate passed.
- Public disposal result is exactly
  `{ status: "rejected", operationId: "pending-auth-disposal", reason: "disposed" }`.
  All affected child pairs/history are unchanged; only the disposed child's
  lifecycle revision advances, and exact post-lifecycle snapshots equal those
  after refusal. Both unrelated SDK children remain exactly unchanged through
  disposal. Parent/settings checks pass. Final bus listeners and network fetch
  attempts are **0**. The original safe-probe assertions and 3A same-mode /
  cross-mode limitations are unchanged.

### Approved lifecycle revision (current evidence)

- Tests-first RED: **`/tmp/jev-sandbox-evidence-zbn3eU`**, retained
  `red.stdout`, `red.stderr`, `red.exit`: **2 pass / 1 fail, 219 assertions,
  two files**. The newly approved scoped-success assertion expected patched
  exit 0; unchanged implementation returned blocked exit 2. The diagnostic
  display command also encountered unavailable `/dev/stderr`; this did not
  affect the captured test output or expected assertion failure.
- Fresh GREEN collection: **`/tmp/jev-sandbox-evidence-0Qvuml`**. Raw
  `compatibility.stdout.json` (**16 cases**, exit 0),
  `published-capability.stdout.json` (**blocked**, exit 2), and
  `patched-capability.stdout.json` (**verified-supported-lifecycle**, exit 0)
  have empty stderr. `verification-summary.json` records every exit; all modes
  retain stdout/stderr and the process tree trace.
- **Native gates: 3 pass / 0 fail, 499 assertions, two files; integration:
  5 pass / 0 fail, 549 assertions, four files; unchanged patched suite:
  2 pass / 0 fail, 160 assertions, two files; default: 148 pass / 0 fail,
  376 assertions, eight files; typecheck: exit 0, no diagnostics.**
- Integration assertions now check scoped status/gate/runtime, both structured
  applicability entries, and every foundation phase/pair/receipt/replay/resume/
  persistence/queue/compaction proof, in addition to all existing disposal,
  both-session identity refusal, invalid-field, listener, lost-acknowledgement,
  parent/settings/network/cleanup checks. No assertion was removed to conceal
  an unsupported transition. The safe probe and 3A tests were not edited;
  same-mode retention and cross-mode unsupported limitations remain unchanged.
- This is standalone capability evidence only. Supplemental record assignments
  remain `nativeLifecycleReplacementVerified: false`; no production controller,
  full-router parity, new backend API or maintained fork is authorized or claimed.

Evidence directories contain `process-tree.strace`; sandbox guard output verified
read-only workspace, inaccessible personal HOME and unreachable network before
runtime startup. These are execution witnesses, not static report snapshots.
The parent independently verifies and arranges Astra review; implementation
verification alone is not review acceptance.

### Task13 fresh reconciliation handoff (historical, superseded)

This earlier handoff is preserved historical evidence, superseded for outcome reconciliation by the [current reconciled receipts](feature-parity.md#reconciled-receipts) and [final local receipts](feature-parity.md#final-task13-local-reconciliation-receipts). The prior pending-outcome status below is not current. The [30-row report](feature-parity.md) maps actual code/testcase/approved-command anchors without declaring row acceptance. Fresh source logs: `/tmp/jev-sandbox-evidence-WlZ7ug/` (899 default, 132 commands, 88 extension including actual offline pack, 140 unchanged reference, clean typecheck, 18 immutable baseline files, isolation 20). Fresh native logs: `/tmp/jev-sandbox-evidence-8ckm33/` (8 combined gates including 1 static parity test; 10 integration including static/negative-control tests; 2 patched). Counts overlap; negative unsafe-baseline/unsupported assertions do not become safe control proof.

The production factory now proves registered why reruns the original most recent eligible native launch task/agent cold, records durable usage and emits fresh analysis without another child execution or parent/history use. Both-explicit launches and arbitrary recommendations do not replace it. Published 3B remains unsupported exit 2; the local patched supported-lifecycle gate remains separate. Same-record replacement/ownership transfer remain user-approved N/A. Strict background→foreground old-tool-call conflicts and absent complete-pricing evidence remain unsupported, not green native cells.

At this historical handoff the manual self-hosted workflow was static/unexecuted and deliberately blocked before tests (exit 78), and inventory rows still awaited complete outcome reconciliation. Those statuses are superseded by the links above and the verification-only CI decision below; the historical test logs are unchanged. No install/network/CI trigger occurred. No full parity or published retained-control claim was made.

### CI verification-only adaptation (hosted execution UNVERIFIED)

The parent human selected **“Verification-only CI (Recommended)”** ([decision and policy](feature-parity.md#ci-deployment-boundary)). This approved deviation removes the unconditional blocker, not the read-only sandbox: offline frozen-lock dependency provisioning remains a trusted external prerequisite, **not performed** by CI. The manual reviewed self-hosted runner must prestage the exact clean dispatch commit at `GITHUB_WORKSPACE`, selected pinned inputs/native patch roots/binaries and external checkout/selected-file digest attestations. Missing, dirty, mismatched or stale prerequisites fail closed; selected-file digests do not establish full dependency integrity. [README operator contract](../README.md#verification-only-ci-manual-operator-policy-hosted-execution-unverified) defines paths and trust.

Baseline/reference/default/typecheck/isolation/real offline pack/static parity and explicit nine-native gate (including `parity-native.test.ts`), integration and patched verification all run under the unchanged reviewed OS sandbox. Existing public-package provenance/capability assertions remain; published 3B exit 2 stays unsupported, and missing local patch support fails, never skips. Retained local evidence paths/logs and traces are printed, not uploaded. Static YAML/policy/shell checks are not hosted execution proof. No hosted run, provisioning, install, network action or Task13 acceptance is claimed.

### Task 3 cleanup sequencing finding (implementation evidence, pending review)

- Scope: only fixture cleanup in `scripts/compatibility-probe.ts`, the small
  callback helper `scripts/probe/native-cleanup.ts`, and focused
  `test/unit/native-cleanup.test.ts`. No native SDK/backend method was replaced
  or patched to inject cleanup faults; no foundation/3A/lifecycle assertion or
  applicability metadata was changed.
- Tests were written first against an extraction of the original defective
  sequence. Focused behavioral RED: **`/tmp/jev-sandbox-evidence-daflae`**,
  `red.stdout`, `red.stderr`, `red.exit` (exit **1**): **1 pass / 16 fail,
  22 assertions**. Abort rejection/timeout skipped shutdown/dispose; shutdown
  rejection skipped dispose; throwing unsubscribe skipped later unsubscribe
  and restoration. This is synthetic callback-seam regression evidence, not
  injected native execution or a passing native proof.
- The helper is wired into the actual `withNativeFixture`: independently attempt
  authentication release, bounded parent abort, bounded native shutdown, dispose
  in nested `finally`, each unsubscribe, fetch restoration, cwd restoration and
  temporary directory removal. All later actions are attempted after earlier
  callback failures. A successful body with cleanup faults rejects with a
  stage-labelled `AggregateError` retaining every thrown cleanup value. A failed
  body retains its exact original thrown value, including undefined/null/false/
  zero/empty string, rather than being masked by cleanup failures.
- Focused GREEN: **`/tmp/jev-sandbox-evidence-M2SgOr`**, `green.stdout`,
  `green.stderr`, `green.exit` (exit **0**): **17 pass / 0 fail, 64 assertions**.
  Exact focused invocation, after the required outer sandbox wrapper:
  `/usr/bin/python3 -I /workspace/scripts/isolated-runtime.py --bun /opt/bun
  test /workspace/test/unit/native-cleanup.test.ts`. The timeout test uses a
  synthetic never-settling abort callback raced against a short deadline; it
  does not monkeypatch native abort or claim native timeout lifecycle coverage.
- Fresh regression/report collection: **`/tmp/jev-sandbox-evidence-1P1Nb6`**.
  `test`, `typecheck`, `native-gates`, `integration`, `patched` each have retained
  `.stdout`, `.stderr`, `.exit` files. Default: **165 pass / 0 fail, 440 assertions,
  nine files**; typecheck: exit **0**, no diagnostics; native gates: **3 pass /
  0 fail, 499 assertions**; integration: **5 pass / 0 fail, 549 assertions**;
  unchanged patched suite: **2 pass / 0 fail, 160 assertions**.
- Raw `compatibility.stdout.json` remains measured genuine published-native
  Agent prompt pipeline (16 calls), exit **0**, zero shutdown listeners/fetch
  attempts. `published-capability.stdout.json` remains **blocked**, exit **2**,
  no setter fallback. `patched-capability.stdout.json` remains
  **verified-supported-lifecycle**, exit **0**, all **15** unchanged foundation
  phases, approved not-applicable ownership/replacement metadata, zero shutdown
  listeners/fetch attempts. Each raw report has retained `.stderr` and `.exit`;
  all reports continue to disclaim full-router parity.
- Every runtime command used `/usr/bin/env -i PATH=/usr/bin:/bin
  JEV_SANDBOX_NATIVE=1 /bin/bash --noprofile --norc scripts/verify-sandbox.sh`;
  regression/report modes used inner `/bin/sh /workspace/scripts/isolated.sh`.
  Each evidence directory retains `process-tree.strace`; guards verified
  read-only workspace, private temporary resources, absent personal HOME and
  unreachable network. No commit, install or network operation was performed.
  Parent rerun and Astra review remain required; this is not quality acceptance.
