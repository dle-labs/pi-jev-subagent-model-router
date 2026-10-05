# Task10: retained-idle-child controller

Audience: future host adapters and command authors. This is an explicit-control library, not a command, UI registration, extension entry point, launch interception change, or child execution service. Tasks1–9 remain unchanged.

## Public prerequisite and API

`src/children/controller.ts` exports `ChildController`:

```ts
const control = new ChildController(services);
const applied = await control.apply(binding, proposal, runtimeSnapshot);
const restored = await control.revert(binding, runtimeSnapshot);
const receipts = control.history(binding); // detached read-only copy
const status = control.metadata(binding); // frozen depth/status/revision
control.invalidate(); // synchronous host lifecycle/config cancellation
control.dispose(); // cancellation plus guarded subscription cleanup
```

`ChildBinding`, `Proposal`, and `RoutingSnapshot` are the existing contracts. Services must supply the **current live Task9-validated origin/binding**, including owner, positive binding generation, exact SDK object/session ID and native tool receipt correlation. Neither an entry from disk, a child display name, `rootSessionId` lineage nor a classifier proposal establishes ownership. `getOwnedRecord` is used with strict optional `record.toolCallId` matching. Parent IDs, foreign/nested/workflow records, queued/running/non-completed records and mismatching SDK objects refuse before mutation. Native admission independently covers disposal, queued work, compaction and record/session/owner changes.

The only mutation is the public Tintin registry's `configureIdleChild`. Structural additive types reproduce the reviewed contract; there are no Tintin-private imports or additional expected/request fields:

- `getIdleChildConfigurationSnapshot(childId)` → ready `{childId,snapshot}` or a rejected static reason.
- `configureIdleChild({operationId,childId,expectedSessionId,expectedRevision,model:{provider,id},thinking,signal})` → committed/noop receipt or `{status:"rejected",operationId,reason}`.
- `getIdleChildConfigurationReceipt({operationId,childId,expectedSessionId})` → committed receipt, or rejected (including `not-found`).

Snapshot and receipt lookup are synchronous; configuration is asynchronous. Pi/Tintin, not the local in-flight map, atomically revalidate the execution/configuration revision, record/SDK instance, owner, root context epoch, scope and authentication before commit. Published runtimes missing these methods return `unsupported`; no setter, execution, spawning, RPC, prompting, waiting-for-idle or compensating rollback fallback exists.

Sources read before implementation: reviewed Tintin `src/idle-child-configuration.ts` (complete), `src/types.ts`, `src/control-model-scope.ts`, `docs/rpc.md`; Pi public `docs/sdk.md` and exported session/model/provider contracts; unchanged capability/safe probes and their public native fixtures. Host base is a13d35a, Tintin base 4f572ea. Only the already assembled, read-only local patched runtime supplies 3B in native tests; no source patch/archive/installed package was edited.

## Services and cancellation responsibility

`ControllerOptions` documents these seams:

- Safety is **not injectable** in `ControllerOptions`; extra JavaScript `safety` fields are ignored. Every controller uses the canonical `controlSafety` authority under `Symbol.for('pi-jev-subagent-router:control-safety:v1')`. Its frozen protocol/version facade exposes only `status(session)` → ready/pending/unresolved, `acquire(session, token)` → ready/pending/unresolved, and `finish(session, token, known|unresolved)` → boolean. Private closure-owned weak records never escape; there is no `.sessions`, mutable state return, reset or clear API. Only an exact pending-token owner can finish, and unresolved is sticky. Safety survives controller/coordinator disposal, policy/off-on/generated reload, cancelled same-owner transitions and distinct module copies within one JavaScript realm, independently of controller-local history.
- `getRuntime()` returns the current Task6-validated configuration snapshot. Owner, generation, enabled/mode and configuration contents must match admission.
- `getBinding(childId)` returns the current live validated association, never a persisted association alone.
- `getRegistry()` returns a stable public manager identity, not a new facade on every read.
- `getCandidates(binding,runtime)` returns a scoped catalogue/pricing shortlist or a static scope refusal. `getSpend` returns the current scoped spend snapshot. Callback arguments are detached copies so callbacks cannot rewrite the captured admission.
- `ui.select` is the optional existing Task7 selection interface. No UI is registered here.
- `signal` is a host cancellation signal. `onInvalidate` optionally subscribes the controller to host lifecycle/config invalidation and returns a cleanup function. **For a mutable host, wire this subscription or synchronously call `invalidate()` before runtime off/config-generation/owner/context changes.** Plain getters cannot signal a change while native authentication or a UI callback is suspended. There is no polling. Omission is suitable only for an immutable host context or an adapter that directly calls `invalidate()`.
- `now` defaults to `Date.now`; default operation IDs are UUIDv7-shaped with a strictly advancing 48-bit time prefix even if the clock stalls/reverses. An optional UUID factory must produce unique lexically increasing IDs. Clock/ID callbacks are checked before admission.
- `warn` receives only static codes; throwing/rejected callbacks and cleanup are contained. Native diagnostic strings are retained only in receipts for future UI sanitization, never echoed by the warning callback.

Admission is captured before callbacks and checked after each service callback/await, context read, policy calculation, UI selection and clock/ID generation. Per-child and shared per-SDK pending leases refuse immediately, rather than queue. The lease is acquired before external callbacks/awaits. Pre-native refusal releases its own lease; once native configure is admitted, disposal/invalidation cannot release it. Only a validated committed/noop/direct configure rejection releases that lease. Unresolvable outcomes retain both quarantine and their admitted lease, including when the old controller settles after a new service has restored that same SDK. Different child lifetimes can proceed independently. Invalidation/disposal abort pending request signals and prohibit future mutation on that controller. Cleanup acquired during synchronous invalidation is released once. Known committed receipts remain truthful/readable after invalidation; cancellation cannot undo an already committed atomic operation.

## Scope authority

The candidate adapter must freshly read trusted effective settings and the **full** current public registry universe, use the public synchronous `resolveModelScopeFromModels(patterns,models)`, fail closed on malformed/unreadable scope, diagnostics or restricted-empty results, and only then apply routing shortlist filters. Project `enabledModels` overrides global; absent/empty scope is unrestricted under the approved public contract. No legacy literal-only launch resolver or unfiltered fallback is an explicit-control authority.

The native integration's adapter uses the selected SDK's public resolver with `jev-compat-*/*:high` and the current full public model runtime catalogue. Regardless of shortlist decisions, Tintin independently recomputes strict scope and resolves actual availability/auth at the atomic boundary. A scoped shortlist is not an authentication attestation.

## Apply policy and thinking

Retained completed children are not cold launches. Apply requires both a proposal model and its existing `analysis`; it does not rerun classification or read parent history. Model/target identity and thinking pins must be coherent. A previous ready snapshot model is mandatory; missing previous/proposed models refuse instead of guessing defaults.

Apply composes `decide`, `tierForModel` and existing Task7 `chooseDefaults` using:

1. current validated runtime config and scoped spend/candidates;
2. this child's public `getContextUsage()` tokens and actual current model;
3. pricing only from the matching current scoped catalogue entry.

Thus same-tier expensive cache holds, tier deadband and big-upgrade bypass retain core semantics. Unknown pricing/context is not fabricated: the accepted core estimates zero for missing target input pricing or unknown/empty context; a missing current cache-read rate uses the core's existing zero-rate convention. No parent/default model is substituted. Task7 fresh-child launch remains unchanged/cold. Core `held`, or stickiness when the decided model is already selected, leaves **both fields and history untouched**, even if a route carries a thinking pin.

Modes:

| Mode | Apply | Revert |
|---|---|---|
| auto | selected recomputed decision | exact historical before pair |
| notify | `notified`, no change | `notified`, no change |
| confirm + selection UI | selected, existing validated lower-tier cheaper choice, or keep | exact restore target or keep only |
| confirm without UI | documented Task7 noninteractive auto | exact restore auto |
| cancelled/failed selection | refusal/keep, no mutation | refusal/keep, no mutation |

Thinking uses the selected target's pin **including `off`**, otherwise exactly the previous child's thinking level. No clamping is invented; native validation can refuse unsupported target levels. Native noop does not append history.

## Receipts, lost acknowledgements and degradation

Validate operation ID, session ID, safe nonnegative revisions, all before/after model-and-thinking fields, receipt revision/status relationship and diagnostic/rejection shapes. Committed receipts must match the admitted before snapshot and the complete requested target pair, with an advancing revision. Noop requires an unchanged pair/revision and empty diagnostics. Malformed ready snapshots refuse before mutation.

A thrown call triggers public receipt lookup **before any retry**. A valid committed lookup is acknowledged once. Only `not-found` plus still-valid admission allows one retry using the same frozen request, operation ID and signal object. A second thrown call gets a final receipt lookup. IDs are never blindly regenerated. A denied/throwing/conflicting lookup, partial/malformed acknowledgement or unresolvable outcome sets that actual SDK lifetime `degraded` and blocks further mutation, including after binding generation/owner/correlation changes. Metadata reports the same SDK degradation across those changes; a different SDK instance does not inherit its stack or degradation. No unsafe second-field repair or rollback occurs. A new controller still requires explicit host verification of the actual current public context/pair and starts with no recovered history, but **cannot reset the SDK's unresolved quarantine or pending lease**. Safety retention is separate from controller-local revert-stack retention. A different SDK lifetime requires an authoritative observer new-origin association, not tampered record/session reassociation. Receipt lookup rejections (`not-found`, denial, unsupported scope) are not proof of a configure rejection and never release an unknown admitted outcome; only a checked committed recovery receipt attests that lookup path. There is no persistence/reload recovery or unsafe clear API.

Committed `notificationErrors` mean `committed-with-diagnostics`, **not** rollback. A valid acknowledged receipt is recorded even when a subsequent host validation throws or invalidates; future mutation is then blocked. Receipts returned to callers and `history()` copies cannot rewrite the stored target.

## Exact revert stack

Stacks are process-local to the controller and separated by owner, child, SDK session ID, binding generation, tool correlation, actual SDK/record and registry identities. Each acknowledged committed apply pushes one exact before/after receipt. Held, notify, keep, rejected, malformed and noop outcomes never push a false receipt.

Revert requires the current pair to equal the stack top's `after` and current revision to equal the controller's latest acknowledged cursor. It restores the exact stored `before` model **and** thinking. Availability/scope/auth still must permit that pair; no cheaper substitute or cache hold changes the restore target. The stack pops only on acknowledged committed exact restoration.

Example: A→B (rev1), B→C (rev2), C→B (rev3), B→A (rev4). The second revert compares B with the older receipt's after **pair**, but compares revision with the current cursor (rev3), not that receipt's obsolete rev1. External native work/config ABA advances the real revision and refuses rather than rewriting a target. Failed/notify/keep revert leaves the historical receipt unchanged.

## Native proof and limits

`test/integration/child-control.test.ts` loads the actual production controller separately from the unchanged standalone 3B capability probe. Public `nativeCall` creates a foreground retained completed SDK child, production apply/revert appends exactly two atomic pairs, then **Tintin**, not the controller, resumes it. The public fake provider observes the restored `before/off` pair on the same SDK instance.

Eight locally patched cells exercise:

- apply → exact revert → native resume, preserving prior entries/messages/native state;
- delayed authentication concurrent with native foreground resume;
- delayed authentication with public native `Agent.followUp` queued work;
- delayed authentication with a real Tintin retained-child background resume queued behind native background capacity (real public Agent calls and provider barriers, no manager/config monkeypatch);
- delayed authentication with actual public child compaction/provider barrier;
- host/controller cancellation during authentication;
- public `AgentSession.dispose()` during authentication;
- public host `session_before_switch` epoch invalidation during authentication.

An additional authored-priced native cache scenario observes the retained completed child's real public context (2 tokens), catalogue-only penalty 3.999998 USD versus a 0.01 threshold. It asserts same-tier, deadband and outside-band expensive-switch `held/cache-held` outcomes and explanatory notes; every hold preserves the exact pair, transcript/native state, all entries (no apply trace), history depth, parent and global/project settings, with zero controller provider execution. Under the same expensive prices a two-tier premium bypass commits `allowed/high`, then exact revert commits `parent/off`, with depth 1→0 and exactly four configuration entries. Only the test subsequently invokes native Agent resume, which produces one fake-provider witness of that restored pair. These authored extreme fake catalogue prices are policy witnesses, not real-provider prices or invoice evidence. Existing fixture models remain zero-priced unless `modelCosts` is explicitly supplied; standalone 3B is unchanged.

Refusals append no controller configuration pair and retain empty receipt stacks. Parent/global settings and parent/child transcript comparisons are taken around controller work; native resume/compaction can legitimately add their own entries/messages. All fake providers are offline, barriers establish ordering (no readiness sleeps), and fixture shutdown checks listeners/registry/network cleanup.

**Coverage limits:** both native Agent message admission and Tintin capacity-queued resume are measured through the production controller; this does not expand the supported lifetime model. Same-record SDK replacement and ownership transfer have no supported public lifecycle and are **N/A**, not measured successes; defensive fake-unit stale guards are not native lifecycle proof. This is Task10-only supported local lifecycle evidence, not published-runtime support, independent Astra review, or full router-parity acceptance.

## Reproduction and evidence

Every runtime command uses the sandbox; no ambient Bun/Node/import execution, install, paid/network access, package mutation, commit or push:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh children
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh test
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh isolation
/usr/bin/env -i PATH=/usr/bin:/bin JEV_SANDBOX_NATIVE=1 /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh native-gates /workspace/test/integration/child-observer.test.ts /workspace/test/integration/child-control.test.ts
```

TDD evidence directories (each has `process-tree.strace`, with full runtime results in the session tool log):

- initial missing-feature RED: `/tmp/jev-sandbox-evidence-qbEfkt` (controller module absent);
- post-commit/invalidation/proposal-capture RED: `/tmp/jev-sandbox-evidence-Rmz9WC`, then 52/0 GREEN `/tmp/jev-sandbox-evidence-XJXHVq`;
- UUID/clock/proposal-shape RED: `/tmp/jev-sandbox-evidence-By1MFe`;
- returned-receipt isolation RED: `/tmp/jev-sandbox-evidence-5YXlew`;
- captured-service-argument admission RED: `/tmp/jev-sandbox-evidence-pBaSHC`;
- runtime/metadata-lifetime RED: `/tmp/jev-sandbox-evidence-Hs0McE`;
- static reason shape RED: `/tmp/jev-sandbox-evidence-2L8JZg`;
- same-SDK degradation generation-bypass RED: `/tmp/jev-sandbox-evidence-js79aF`, then 85/0 GREEN `/tmp/jev-sandbox-evidence-bGqOp6`;
- native mutation witness RED: `/tmp/jev-sandbox-evidence-2WCDwi` (temporarily refused production `apply`; real integration asserted controller commit absent; restored immediately);
- native seven-cell initial GREEN: `/tmp/jev-sandbox-evidence-WKX9IJ` (1/0, 40 assertions);
- unchanged isolation guard after wiring: `/tmp/jev-sandbox-evidence-rpmF1y` (20/0).

Native direct eight-cell JSON report: `/tmp/jev-sandbox-evidence-A7JqF4` (full JSON in the session tool log). Actual result cells: pair apply/revert `committed`; resume/message-queue/compaction `stale`; Tintin capacity queue `unauthorized`; cancellation `cancelled`; public disposal/context-before-switch `disposed`. All eight have depth 0 after acknowledgement/refusal/restore, parent/settings preserved, zero network attempts and zero shutdown listeners. Context-before-switch invalidates the current native lifetime; it is not ownership transfer or same-record replacement.

Final gate evidence:

| Gate | Result | Evidence |
|---|---|---|
| controller focused | 85 pass / 0 fail; 226 assertions | `/tmp/jev-sandbox-evidence-bGqOp6`; full output `/tmp/jev-task10-children-green-Rz635i.log` |
| default explicit discovery | 656 pass / 0 fail; 24 files, 3202 assertions | `/tmp/jev-sandbox-evidence-adhNLz`; full output `/tmp/jev-task10-default-green-EOCfco.log` |
| existing Tintin suites | 154 pass / 0 fail; 681 assertions | `/tmp/jev-sandbox-evidence-mP67L7`; full output `/tmp/jev-task10-tintin-green-ufybC0.log` |
| reference suites | 140 pass / 0 fail (31+13+52+12+20+12) | `/tmp/jev-sandbox-evidence-Tr9Ihg`; full output `/tmp/jev-task10-reference-green-lbD3nV.log` |
| pinned vendor baseline | 18 byte-identical files | `/tmp/jev-sandbox-evidence-n0dFRd`; full output `/tmp/jev-task10-baseline-green-CTuVDL.log` |
| TypeScript | clean exit 0 | `/tmp/jev-sandbox-evidence-FhBk24`; full output `/tmp/jev-task10-typecheck-green-VEO9F9.log` |
| isolation after launcher wiring | 20 pass / 0 fail | `/tmp/jev-sandbox-evidence-5aCtRz`; full output `/tmp/jev-task10-isolation-green-YRmJEh.log` |
| expanded controller integration alone | 1 pass / 0 fail; eight cells, 45 assertions | `/tmp/jev-sandbox-evidence-miN6gP` |
| required combined native gate, eight controller cells | 5 pass / 0 fail; 4 files, 546 assertions | `/tmp/jev-sandbox-evidence-P2BtMX`; full output `/tmp/jev-task10-native-green-yCIXCk.log` |

The required combined native gate includes unchanged capability and public-pipeline probes plus the production observer and production controller integrations. No full-parity or independent-review acceptance is claimed.

### Task14 finalaudit sealed-authority correction (fb7c388b)

All three package safety/evidence slots are created only when their own descriptor is ABSENT. Creation installs a non-writable, non-configurable data descriptor containing a frozen, plain, versioned protocol facade. Existing slots must already have that descriptor, exact protocol/version, frozen facade and own data-method shape; inspection uses descriptors and never invokes a slot or facade-field accessor. Present undefined/null, legacy mutable registries, unsealed/malformed/incompatible facades, or first initialization failure never recreate/adopt a fresh registry. Controller control returns degraded/safety-authority-unavailable before binding/candidate/spend/configure callbacks; metadata is degraded. Imports do not throw or block native hooks.

Every loaded version must use the same canonical keys, **not a new v2 namespace** to bypass live quarantine. Compatible distinct module-cache copies reuse the exact authority; incompatible migration requires a process restart, not unsafe runtime upgrade/reset. This prevents registry replacement and injection bypass under trusted package/host contracts, not arbitrary hostile same-realm JavaScript: code could call the SDK directly or patch intrinsics. A well-shaped forged authority installed before first import cannot be cryptographically authenticated here. Unsealed/mismatched supplied state is refused; host/module provenance remains a trust boundary. Separate realms/processes do not share memory. See the [follow-up evidence](task14-finalaudit-followup.md); no acceptance claim follows.

### Task14 finalaudit lifetime/cache follow-up (68f5154b)

The shared safety rules and additional nonzero-priced native cache scenario above supersede controller-local quarantine and zero-price-only native cache coverage. See [targeted handoff](task14-finalaudit-followup.md) for actual factory policy/reload/cancelled-transition regressions, late unresolved operation ownership, RED/GREEN logs and fresh native measurements. History remains controller-local and empty after replacement; SDK safety does not reset. Module copies share package-owned weak state only within one JavaScript realm; no disk/private backend state or unsafe clear API is introduced. Independent Astra re-review and parent final acceptance are separate.
