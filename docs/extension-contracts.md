# Task12 production composition (implementation handoff, not acceptance)

The only package entry is `extensions/pi-jev-subagent-router/index.ts`. It imports local `src/extension/install.ts`, never the vendor/parent factory. Registration is idempotent per public ExtensionAPI object. Factory registration performs no file writes, discovery, classification, service construction, timers, processes or TUI imports. Optional command/tool/entry-renderer capabilities are guarded independently.

## Public host boundaries

Pi 1.0.0 declares `tool_call`, `tool_execution_update`, `tool_execution_end`, `tool_result`, `session_start`, `session_shutdown`, before-switch/fork/tree/compact, tree and compact events, `ctx.isProjectTrusted()`, session-manager `getSessionId/getBranch`, public `appendEntry` and `events`. No private extension runner/session handle is imported or guessed. Schema-validated tool_call is observed before launch routing; pre-validation execution_start never establishes ownership. Results/updates correlate exact details.agentId. Parent `before_agent_start/message_end` are not registered, switched, reclassified or charged.

## Owner and services

`ExtensionCoordinator` uses realpath-canonical public cwd plus public parent session ID via `rootOwnerId`. Configuration is detached via loadConfiguration with project trust only. Relative child ledger paths resolve against that canonical cwd. Both launch and command engines compose `createUsageRecorder(AccountingStore)`; no legacy saveLedger/parent accounting or original Jev resources are written. Corrupt/unavailable ledger skips automatic classification/default injection rather than manufacturing zero spend. Commands display reported money as incomplete/unavailable.

One central generation governs synchronous session-only CAS, generated reload CAS, configuration and observed scope/auth/catalogue/trust changes. Invalidations abort service and store signals, update/dispose launch discovery/classification, clear task/decision memory, detach observer bus/SDK subscriptions and replace terminally invalidated controllers. Cleanup independently attempts every service. New controllers do not reconstruct old revert stacks. Ordinary unchanged native tool calls preserve the controller instance/history. Session overrides remain above reloaded generated/manual config; updates never write personal defaults.

Before-switch/fork/tree/compact immediately dispose active services and fence pending work, but cancellation or failure need not produce a start/tree/compact completion event. After a real `session_start`, the next validated public `tool_call` (including both-explicit Agent calls) can acquire replacement services from its supplied fresh context when none are active. An aborted context cannot acquire. Existing explicit command/tool acquisition uses the same admission guard. Admission captures the epoch and expected active owner before reading even `ctx.signal`; normal-return public getters can still synchronously emit lifecycle events. Signal, refresh, cwd, construction and policy-restoration reads are followed by callback-free started/epoch/identity checks. An ordinary refresh failure may advance only through its own stop token: stop fences and clears ownership before runtime/cleanup callbacks and returns its own epoch, never the epoch left by reentrant shutdown/start. Invalidated refresh success cannot return a stale coordinator. Unpublished coordinators are disposed once when construction or policy replay invalidates admission. Registered commands refuse failed acquisition without late UI; the recommendation tool returns an inactive result instead of delegating into a replacement owner. Results, bus notifications and captured callbacks never acquire; calls and stray completion events before initial start or after terminal shutdown cannot resurrect services. A later real start opens admission again. No cancellation event, timer or polling is invented. Published compaction also exposes failure notifications, but recovery does not depend on them.

Same-owner recovery preserves only detached **successful session-policy CAS patches** (enabled, mode and individual budget overrides). Registration records those patches through the coordinator's existing public `updateRuntime` method and reapplies them above freshly loaded configuration, so `off` cannot silently become enabled and unrelated external config changes remain visible. Different owners, real start/shutdown and successful tree/compact boundaries discard this registration cache, retaining the existing successful-transition reset behavior. Generations remain monotonic across replacement and policy replay. Recovery does not preserve in-memory task/decision metadata, discovery/warning history or controller revert stacks; only validated current-branch origins can reconstruct child observation. Old listeners are detached and old pending classifications/accounting cannot mutate replacement calls or write replacement state.

No continuous settings/auth/catalogue watch event is invented: external state is freshly read/revalidated on operations, and the backend revalidates strict scope/auth at atomic commit. Detection is not a guarantee of observing an external ABA that emits no public event. Missing Tintin warns once per coordinator session with install/reload guidance and leaves native input unchanged; discovery is event-driven with existing bounded timeouts, not interval polling.

## Scope and ownership

Launch uses Task6 legacy exact semantics against the full public getAll universe first, then authoritative getAvailable auth intersection (empty means empty). The public hasConfiguredAuth fallback is required if getAvailable is absent. Unknown trust refuses scope without reading project settings.

Explicit controls capability-detect the public SDK namespace resolveModelScopeFromModels. They freshly read global plus exact child's public session-manager cwd project enabledModels, project-over-global, absent/empty unrestricted; diagnostics/restricted-empty deny. A different child project requires its own public settings-manager trust. Missing resolver/atomic methods is unsupported, never a private import or raw setter fallback. Low-level Tintin independently revalidates commit. Recommendations without bindings follow owner launch scope.

Task9 adds only `ChildObserver.getBinding(child)`: detached public control binding from a currently validated acknowledged origin, exact SDK session and tool correlation. Replacement/suspended/disposed/unregistered associations refuse. Global records and persisted entries alone are not control authorization. Runtime status projects only bindings returned by this accessor.

## Branch and privacy

Observer reconstruction reads only current getBranch custom origins and parent messages, choosing latest child entries. Abandoned entries and guessed lineage/display ownership are excluded. Parent messages are not sent to Jev. Projected decision cards remain branch entries, but /why does not reconstruct raw in-memory task/decision history after reload. Its absence is explained without guessing task text. Task13 corrects the earlier no-rerun interpretation: when native eligible launch admission has retained a bounded task, why reclassifies that original launch task cold using the existing engine/counter adapter.

Native prompt/options/output remain untouched; independently undefined model/thinking alone can be filled by LaunchRouter. The hook always returns normally; no duplicate execution, replacement Agent tool or automatic retained-child control. Both-explicit calls are observed without classification. Raw native tasks are only a bounded admission cache (16 tasks/16,384 characters, each at most 4,096), cleared on generation/owner changes and never persisted. This composition retains only prefixes plus the exact original UTF-16 character count, not complete oversized tasks. Correlation and repeated binding reads preserve that count through `rememberTask`'s optional numeric metadata. Cached apply classifies only the prefix and reports `cached task truncated: ORIGINAL → RETAINED characters`; use explicit `apply CHILD -- TASK` when the complete task is required. No padding or reconstructed full prompt is classified or stored. Correlated tasks are admitted to existing CommandRouter binding-specific apply memory. Separately, Task13 admits the most recent classifier-eligible immediate top-level Agent task to CommandRouter's one-task why memo before SDK receipt/classifier success. Both-explicit, nonempty resume/schedule and nested calls do not replace it; standalone route/apply never populate it. This memo is bounded to 4,096 characters plus exact original count and uses the same owner/generation/off/context invalidation. Custom entries contain projected analysis/decision or immutable accounting origin only.

Explicit commands can drain already-enqueued accounting before reading current state; this is neither polling nor registry scanning. Before delegation, registration rechecks the captured epoch, coordinator identity and generation immediately after the drain. A callback-free `isCurrentGeneration(generation)` fence plus repeated local epoch/identity checks refuses reentrant runtime reads that return stale snapshots. No pre-admission command can enter replacement-generation command/controller/write/classification services. This guard is distinct from postcommit truthful acknowledgements. UI notifications and lazy renderer registration have lifecycle fences; the command notification wrapper returns the actual callback result so synchronous throws and asynchronous rejections are contained by `notifyResult`. Shutdown is idempotent; already committed store/native receipts are not described as rolled back.

## Package

private:true, exact development pins and MIT LICENSE/NOTICE attribution remain unchanged. pi.extensions exposes only the new entry. Source pack includes required local modules, README, licenses, example and this contract; excludes tests, evidence, vendor parent factory, upstream patches, settings and keys. No publish/install/commit/push is performed.

## Verification

All runtime commands used the existing clean-environment `scripts/verify-sandbox.sh` OS launcher; no launcher mounts were added, host home/config exposed, package installed or paid/network call made. Initial source gates: `/tmp/jev-sandbox-evidence-W3ckq3/`; initial native gates: `/tmp/jev-sandbox-evidence-wUv1XF/final-native.log`. The scoped finding rerun below supersedes these counts.

| Gate | Result |
| --- | --- |
| Explicit extension unit + real npm pack dry-run | 20 pass, 0 fail, 249 assertions, 2 files |
| Default isolated suite (includes extension tests) | 820 pass, 0 fail, 4,151 assertions, 29 files |
| Unchanged vendor reference groups | 31 + 13 + 52 + 12 + 20 + 12 = 140 pass, 0 fail |
| Public/native gates (five explicitly named files) | 7 pass, 0 fail, 554 assertions |
| Typecheck | exit 0, no diagnostics |
| Baseline | 18 byte-identical files; 0.6.0 `f1a6f0381ef10899319542525f4d53c76c368396` |
| Launcher/isolation tests | 20 tests, OK |

Extension counts overlap the default suite; do not sum them as unique tests. The native production-entry cases load the actual default factory beside unchanged Tintin on published and patched public SDKs. Each verifies seven launch-precedence cells, exactly one native child execution each, native receipts, parent pair/settings invariance, seven correlated child origins, $0.2 reported per child, durable Jev usage from both engines, recommendation without execution and absence of raw tasks in persisted records. Patched explicit apply/revert execute through the real public atomic control backend, restoring the pair without submitting a child prompt. Published controls remain unsupported.

RED evidence (sandbox directories): `vyN3D4/red-extension.log` missing entry; `Ox9IO6/red-native-entry.log` missing production accounting composition; `WUeJAu/red-control-entry.log` patched command integration; `4Uk0mf/red-reentrant-pack.log` reentrant lifecycle and initial npm configuration; `9eWuL4/red-late-ui.log` late notification; `Mf1QoI/red-capability.log` false capability advertisement; `7TjhHT/red-ledger-final.log` late corrupt ledger. Prefix each with `/tmp/jev-sandbox-evidence-`. Last targeted regression: `/tmp/jev-sandbox-evidence-vlXRdw/red-stale-observer.log` produced a stale old-observer notification (19 pass, 1 fail); restoring its generation-bound warning fence yielded `/tmp/jev-sandbox-evidence-XB41hc/green-stale-observer.log` (20 pass, 0 fail). Supplementary tests that passed immediately are not represented as red-first. The rejected test-filter invocation in `T5fxyn` was launcher argument validation, not a behavioral RED.

Real pack command in a disposable private copy: `/opt/node /usr/lib/node_modules/npm/bin/npm-cli.js pack --dry-run --json --ignore-scripts --offline`, with empty, separate global/user npmrc and isolated HOME/cache. The JSON lists 31 entries, all relative runtime imports present and no tests/evidence/vendor/upstream/settings/auth files. npm was already present through the existing read-only `/usr` mount.

Reproduction of the source gates:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh -c 'set -eu; for mode in extension test reference typecheck baseline isolation; do /bin/sh /workspace/scripts/isolated.sh "$mode" > "/evidence/final-$mode.log" 2>&1; done'
/usr/bin/env -i PATH=/usr/bin:/bin JEV_SANDBOX_NATIVE=1 /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh -c 'set -eu; /bin/sh /workspace/scripts/isolated.sh native-gates /workspace/test/integration/child-observer.test.ts /workspace/test/integration/child-control.test.ts /workspace/test/integration/extension.test.ts > /evidence/final-native.log 2>&1'
```

Limitations remain: operation-boundary external-change detection (no continuous watcher or external ABA guarantee), no restored revert stacks/raw task history, incomplete price/coverage accounting, and published strict resolver/atomic controls unsupported. Parent reruns and independent Astra specification/quality review remain required. No full parity or Task12 acceptance is claimed.

### Scoped follow-up: Task12 findings `1da9be26`

Only `src/extension/install.ts`, `src/extension/coordinator.ts`, the narrow `rememberTask` metadata path in `src/commands.ts`, new `test/extension/lifecycle-findings.test.ts`, and the extension/commands contracts changed. No entry feature, controller/policy rewrite, vendor/package/patch/launcher change, installation, host runtime or personal resource mutation, network call or commit occurred.

The 18 added cases include six actual registered commands held on a real enqueued `AccountingStore.observe` drain while a same-coordinator policy refresh replaces services; three final runtime-getter reentrancy cases (advance/dispose/shutdown); one full native-prompt/correlation/binding/cached-apply case with repeated reads, exact prefix and original count, visible note and privacy assertions; six invalid length-metadata cases; and actual registered synchronous-throw/asynchronous-reject notification cases. The published SDK's absent strict retained-child resolver is bypassed only by an existing command candidate-service test seam in the cached-apply case; real correlation, engine, bounded cache and controller result remain exercised. Native integration is separately rerun without that seam.

All runtime verification used the unchanged approved OS launcher and `isolated.sh`. Evidence directories include `process-tree.strace`.

| Evidence | Result |
| --- | --- |
| `/tmp/jev-sandbox-evidence-vk4jPx/red-task12-findings.log` | 21 pass, 17 fail before production fixes: stale delegation/reentrancy, lost count, invalid metadata and escaping asynchronous rejection. The synchronous-throw control already passed. |
| `/tmp/jev-sandbox-evidence-uZud48/green-task12-extension.log` | Initial targeted green: 38 pass; commands 122 pass. Typecheck then caught two test-only implicit-any parameters, corrected before final gates. |
| `/tmp/jev-sandbox-evidence-pWDFJB/red-held-accounting.log` | Strengthened actual-store-drain replay with only the admission fix removed: 29 pass, 9 expected failures. Tests explicitly prove each handler remains pending until the held observation is released. The initial async entry-callback test was not relied on as a deterministic drain: the public host discards its promise. |
| `/tmp/jev-sandbox-evidence-1fEAL0/final-extension.log` | 38 pass, 0 fail, 378 assertions, 3 files; includes the actual offline npm pack dry-run. |
| `1fEAL0/final-commands.log` | 122 pass, 0 fail, 619 assertions. |
| `1fEAL0/final-ui.log` | 22 pass, 0 fail, 81 assertions. |
| `1fEAL0/final-test.log` | 838 pass, 0 fail, 4,280 assertions, 30 files; overlaps extension/commands/UI counts. |
| `1fEAL0/final-reference.log` | 140 pass across six unchanged vendor groups. |
| `1fEAL0/final-typecheck.log` | Exit 0, no diagnostics. |
| `1fEAL0/final-baseline.log` | 18 byte-identical files at the unchanged upstream revision. |
| `1fEAL0/final-isolation.log` | 20 tests, OK. |
| `/tmp/jev-sandbox-evidence-hx9GO7/final-native.log` | 7 pass, 0 fail, 554 assertions, five explicitly named published/patched files, `JEV_SANDBOX_NATIVE=1`. |

Relative evidence prefixes above mean `/tmp/jev-sandbox-evidence-`. Source reproduction adds `commands ui` to the source gate loop shown above; the native reproduction command is unchanged. This is a scoped fix handoff, not Task12 acceptance; parent verification and independent Astra review remain required.

### Scoped follow-up: Task12 quality finding `cebed3dd`

Only `src/extension/install.ts`, `test/extension/lifecycle-findings.test.ts`, the minimal native cancelled-tree case in `test/integration/extension.test.ts`, and this contract changed for this finding. Existing dirty work was preserved. No coordinator redesign, vendor/patch/launcher changes, install, network call, personal-resource or host-runtime execution, or commit occurred.

The 22 new public-event fixture tests cover before-switch/fork/tree/compact cancellation and the same no-completion-event pattern after failed compaction: omitted/both-explicit Agent recovery, monotonic generations, detached bus/SDK listeners, observation correlation, held old-classifier disposal without late input/card/ledger mutation, session-only disabled/mode/budget preservation with fresh external config, owner boundaries, and terminal/no-start admission. Supplemental assertions also reject aborted contexts and stray status commands. These fixtures do not execute a native Agent or reproduce a host compaction failure; failed-compaction fixtures deliberately omit all success/start follow-up events.

Separately, both native production-factory cases now load a tiny cancelling extension alongside the unchanged production entry and Tintin. They call public `AgentSession.navigateTree()` on an existing non-leaf entry, assert cancellation and an unchanged branch, then invoke the next ordinary native Agent **before any command**. Existing checks prove fresh routing, exactly one native execution, native receipts, seven correlated origins, durable accounting, parent/settings invariance, and zero residual shutdown listeners. This is real published/patched native cancelled-tree coverage, not native switch/fork/failed-compaction coverage. Public published declarations, extension documentation and switch/fork/tree/manual/automatic-compaction cancellation paths were read; no private runner was imported or invoked.

All runtime evidence was produced by the unchanged clean-environment OS launcher. Each evidence directory also contains `process-tree.strace`; prefixes below are `/tmp/jev-sandbox-evidence-`.

| Evidence | Result |
| --- | --- |
| `H1pns6/red-cebed3dd-extension.log` | 38 pass, 22 expected failures before implementation; includes actual offline npm pack dry-run. |
| `sRL0Sb/red-cebed3dd-native.log` | 5 pass, 2 expected production native failures: the next Agent retained native medium thinking instead of routed high thinking after cancelled tree. |
| `Gn68Mq/green-cebed3dd-extension.log` | Initial green: 60 pass, 0 fail; typecheck exit 0 in the same directory. |
| `ptGQoH/final-cebed3dd-extension.log` | 60 pass, 0 fail, 765 assertions, 3 files; actual offline npm pack dry-run included. |
| `ptGQoH/final-cebed3dd-test.log` | 860 pass, 0 fail, 4,667 assertions, 30 files; overlaps extension counts. |
| `ptGQoH/final-cebed3dd-reference.log` | 140 pass across unchanged reference groups. |
| `ptGQoH/final-cebed3dd-typecheck.log` | Exit 0, no diagnostics. |
| `ptGQoH/final-cebed3dd-baseline.log` | 18 byte-identical files at unchanged upstream revision. |
| `ptGQoH/final-cebed3dd-isolation.log` | 20 tests, OK. |
| `m6GpwA/green-cebed3dd-native.log` | 7 pass, 0 fail, 554 assertions across the five named published/patched files, with `JEV_SANDBOX_NATIVE=1`. |

Reproduction uses the source/native gate commands above, with `final-cebed3dd-` log names; source modes are `extension test reference typecheck baseline isolation`. Recovery retains session policy only, not raw-task/original-length admission metadata or revert stacks; successful lifecycle resets and published strict-control limitations remain unchanged. Parent verification and independent Astra review remain required. No Task12 acceptance is claimed.

### Scoped follow-up: Task12 quality finding `ff00a50e`

Only `src/extension/install.ts`, `test/extension/lifecycle-findings.test.ts`, and this contract changed. Existing dirty work, the 22 cancelled-transition cases, and actual published/patched native cancelled-tree coverage remain unchanged. No coordinator/vendor/patch/launcher changes, install, network call, personal files, host runtime execution, or commit occurred.

The 26 added public-entry cases cover normal-return signal getters, trust reads returning true/false, session-manager reads, cwd reads, true-but-invalidated refresh, ordinary refresh-failure cleanup/runtime reads, policy replay, registered recommendation-tool admission, and constructor session/trust/branch reads. Each shutdown case checks no replacement service/listeners, delegation, classification, entries, state writes or late notifications; restart cases refuse the outer operation and retain the independently started owner. Constructor cases verify exactly one disposal of the unpublished coordinator. Supplemental native-hook calls after shutdown preserve input; later legitimate start/status operations work. Admission denial is not a claim that already-admitted or committed work was rolled back.

All runtime commands used the unchanged approved clean-environment OS launcher, with existing read-only mounts and no new timers or repeated external-validation loops. Evidence prefixes below mean `/tmp/jev-sandbox-evidence-`; each directory contains `process-tree.strace`.

| Evidence | Result |
| --- | --- |
| `utsyId/red-ff00a50e-extension.log` | 62 pass, 12 expected failures: public command admission before signal/refresh/cleanup, stale refresh return and late inactive notifications. Two initial supplemental cases already passed; they are not claimed as behavioral RED. |
| `Cnj2rs/green-ff00a50e-extension.log` | Initial command-admission green: 74 pass; typecheck exit 0. |
| `xVqJ4O/red-ff00a50e-tool.log` | 81 pass, 1 expected failure: the registered tool delegated into a reentrantly started replacement after failed outer admission. Six constructor cases and the shutdown-only tool case already passed with the preceding admission fix. |
| `8ZAxg1/final-ff00a50e-extension.log` | 86 pass, 0 fail, 1,194 assertions, 3 files, actual offline npm pack dry-run included. |
| `8ZAxg1/final-ff00a50e-test.log` | 886 pass, 0 fail, 5,096 assertions, 30 files; overlaps extension counts. |
| `8ZAxg1/final-ff00a50e-reference.log` | 140 pass across unchanged reference groups. |
| `8ZAxg1/final-ff00a50e-typecheck.log` | Exit 0, no diagnostics. |
| `8ZAxg1/final-ff00a50e-baseline.log` | 18 byte-identical files at unchanged upstream revision. |
| `8ZAxg1/final-ff00a50e-isolation.log` | 20 tests, OK. |
| `ArF5hP/final-ff00a50e-native.log` | 7 pass, 0 fail, 554 assertions, five named published/patched files, `JEV_SANDBOX_NATIVE=1`. |

An intermediate green run (`CR2GvU`) caught before-event handlers accidentally returning the new numeric stop token; these handlers were corrected to return normally before the initial green above. A later full source run (`sLF9PH`) passed tests but typecheck caught a missing inactive tool-result `details` shape; it was corrected before the final source gates. These diagnostic runs are not behavioral RED evidence. Four supplemental trust-false/runtime-stop cases passed immediately with the admission fix and are not described as red-first. Source and native reproduction commands are unchanged from the preceding scoped follow-up; use `final-ff00a50e-` log names. Parent verification and independent Astra review remain required; this is not Task12 acceptance.
