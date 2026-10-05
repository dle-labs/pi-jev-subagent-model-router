# Task14 finalaudit follow-up: sealed authority remediation

## Latest correction: P1 fb7c388b (Sol implementation; Astra review remains independent)

**Not Task14 acceptance, independent Astra review, or full-parity acceptance.** Prior dirty work remains uncommitted. No installs/network/personal files/ambient runtime/vendor/backend/native-harness/upstream patches/commits were touched. The older handoff below is retained as history; its mutable registry and optional injection descriptions are superseded here.

### Owned files and exact authority API

- `src/children/control-safety.ts`: private SDK-keyed WeakMap behind frozen `ControlSafetyAuthority`; exports canonical `controlSafety | undefined`, not records/collections. `status(session)` returns `ready | pending | unresolved`; `acquire(session, symbolToken)` returns the previous refusal state or `ready` after obtaining the lease; `finish(session, symbolToken, known | unresolved)` returns a boolean. Exact token ownership is mandatory; known completion clears only its own pending lease, unresolved is irreversible. No reset, collection, state object or token is returned.
- `src/children/controller.ts`: `ControllerOptions.safety` removed; JavaScript extra `safety` fields are ignored. Every controller uses the canonical authority. Attempts carry private lease tokens, including late degradation, and finally releases only verified known/pre-admission outcomes. Unavailable authority returns `degraded / safety-authority-unavailable` before binding/candidate/spend/configure; metadata is degraded. Existing committed/noop/rejection release and sticky late-unresolved regressions remain.
- `src/tintin/observer.ts`: two frozen protocol facades expose only boolean `matches` / `remember`, preserving first record→SDK identity and ledger-path+origin→weak record/SDK proof. Contradictions refuse, never overwrite. Maps, evidence WeakRefs and FinalizationRegistry stay closure-private. Origin cleanup retains identity-checking passive finalization; SDK evidence stays weak-keyed by record, without adding a strong SDK history.
- New small shared `src/realm-authority.ts`: descriptor-only canonical initialization and frozen facade protocol validation.
- `src/extension/coordinator.ts`: only removed the obsolete import and `safety:` composition field to compile against the non-injectable API. No lifecycle/native behavior or test harness changes.
- New `test/children/realm-authority.test.ts` + `test/support/realm-authority-child.ts`: the additional fixture is required because immutable global slots cannot be reset between tests. Existing `isolated-child`/launcher/isolation harness is unchanged. Observer and extension-contract scenarios are grouped in these fresh child-process regressions, not ambient test globals.
- Controller/observer contracts, `docs/feature-parity.md`, and this handoff corrected.

### Descriptor, first initialization and duplicate-copy scope

Canonical symbols are unchanged: `pi-jev-subagent-router:control-safety:v1`, `observer-sdk-lifetimes:v1`, and `observer-origin-lifetimes:v1` (each observer name has the same `pi-jev-subagent-router:` prefix). Only an **ABSENT own property descriptor** permits creation. `Object.defineProperty` installs a data value with `writable:false`, `configurable:false`, `enumerable:false`. The value is a frozen plain facade, with exact own data fields/method names and protocol/version (`pi-jev-control-safety`, `pi-jev-observer-sdk`, `pi-jev-observer-origin`; version 1). Existing descriptor, frozen facade, protocol/version and function-method shape are validated without unchecked registry casts and without invoking slot or field getters.

Present undefined/null, wrong shape, old mutable raw registry, unsealed facade, compatible frozen facade in a mutable slot, wrong protocol/version/method, accessor slot/facade field, or inability to install an absent slot all fail closed. Existing descriptors remain untouched, with no recreation/adoption or import throw. Observer is unknown-attribution with no subscriptions/registration/entry/cost/control binding; control is degraded. Native entry import and synthetic native tool_call hooks still return normally and preserve explicit input. Native public integrations remain separate proof, not injected backend faults.

Tests copy the actual source tree into private temporary storage and import both original and copied controller/observer modules via distinct module-cache paths; constructors are demonstrably distinct and exported safety authority identity is identical. Pending and then unresolved SDK state remains in-flight/degraded despite global Reflect.set/deleteProperty/defineProperty and frozen facade method/protocol replacement attempts. Fresh JavaScript safety injection cannot bypass it. Old tokens cannot release newer leases or sticky unresolved state. Observer evidence replacement attempts fail; the second module copy cannot restore an old origin using a different record/SDK with reused identifiers, nor accept same-record replacement. Never-bound undefined→ready and a distinct verified new spawn/new record still work.

All loaded protocol versions must consume these **same canonical keys**. No alternate v2 namespace may bypass live v1 quarantine/evidence. Incompatible or legacy state requires a **process restart**, not unsafe in-place migration. Separate realms/processes do not share authority; no disk/private-backend safety persistence is introduced.

### Threat-model boundary

This prevents accidental/explicit registry replacement, incompatible module-version adoption and fresh injected-registry bypass under documented trusted-host/package contracts. It is **not a sandbox against arbitrary hostile same-realm JavaScript**: such code could call the SDK directly, rewrite unrelated controller internals, or monkeypatch intrinsics. A fully well-shaped forged sealed authority installed before first import cannot be cryptographically authenticated by structural validation; trusted host/module provenance remains necessary. Unsealed/mismatched supplied state is refused, not hidden behind obfuscation. Existing unsupported pricing/frontier/evicted-origin/native replacement/ownership-transfer limits remain.

### RED/GREEN and fresh gate evidence

All runtime used `/usr/bin/env -i PATH=/usr/bin:/bin [JEV_SANDBOX_NATIVE=1] /bin/bash --noprofile --norc scripts/verify-sandbox.sh ...`. Every evidence directory has `process-tree.strace`; full stdout/stderr logs are retained, not only tails. Child fixtures use the unchanged private-HOME `test/support/isolated-child` bootstrap before Bun/router imports. No test discovery or isolation guard was weakened.

- Corrected pre-fix RED: `/tmp/jev-sandbox-evidence-3GwB5Z/red-children.log`: **90 pass / 23 expected failures / 270 Bun assertions / 2 files**. Failures expose writable descriptors, nullish recreation, unsafe mutable adoption or accessor import failures. The initial `/tmp/jev-sandbox-evidence-5n6WBR/red-children.log` also recorded three dangling blocked-call timeout errors; the test gate is now explicitly released before assertions, producing the corrected RED above. No production fix preceded that RED.
- Initial GREEN: `/tmp/jev-sandbox-evidence-6TkgnQ/green-children.log`: **113/0, 293 assertions**; Tintin **169/0, 792**, extension **92/0, 1612**, typecheck clean. Five additional malformed-slot/initialization variants per canonical key (15 tests) and identity/method-shape checks are supplemental green-first additions, **not falsely claimed RED-first**. `/tmp/jev-sandbox-evidence-NVzxpA/green-children.log`: **128/0, 323 assertions**; clean typecheck.

Final source evidence: `/tmp/jev-sandbox-evidence-VUrCJC/` (named full logs below, supersedes `/tmp/jev-sandbox-evidence-mz5iQe/` and `/tmp/jev-sandbox-evidence-awT1l8/` after tightening exact authority identity/method-shape assertions and using the actual old raw WeakMap/Map legacy shapes); final native evidence: `/tmp/jev-sandbox-evidence-nvIasa/`. No production/native code changed between those source runs.

| Gate / full log | Observed result |
| --- | --- |
| `final-children.log` | 128 pass / 0 fail; 323 assertions; 2 files |
| `final-tintin.log` | 169 pass / 0 fail; 792 assertions; 4 files |
| `final-extension.log` | 92 pass / 0 fail; 1612 assertions; 5 files; actual offline pack |
| `final-test.log` | 964 pass / 0 fail; 8225 assertions; 34 explicit files |
| `final-reference.log` | 140 pass / 0 fail in six processes: 31+13+52+12+20+12; 346 assertions |
| `final-typecheck.log` | exit 0; no diagnostics |
| `final-baseline.log` | 18 byte-identical immutable vendor files |
| `final-isolation.log` | 20 tests; OK |
| Native `final-native.log` | 9 pass / 0 fail; 569 assertions; 6 files |
| Native `final-integration.log` | 13 pass / 0 fail; 3076 assertions; 9 files |
| Native `final-patched.log` | 2 pass / 0 fail; 160 assertions; 2 files |

The explicit native-gates invocation includes production observer/controller/extension/parity-native alongside existing standalone public/capability files. Cache proof is intact: **2 public context tokens**, authored penalty **3.999998 USD** vs **0.01**, three holds, two-tier bypass+exact revert, **4 configuration entries**, history 0, **0 controller provider executions / 1 test resume execution**, preserved parent/settings, **0 shutdown listeners/network attempts**. No native/backend monkeypatch or patched-package edit was made.

Relative to supplied parent 926/children90/Tintin169/extension92, only **38 fresh isolated supplemental tests** are added: default964/children128; Tintin/extension test counts and native/integration/patched counts are unchanged. Pack assertions increase by 3 for the new runtime helper. Counts overlap; integration still includes structural and unsafe-baseline negative controls, not 13 independent safe-native proofs. Independent Astra read-only harness/patch review and parent integration remain separate.

## Historical handoff: 68f5154b (mutable-registry descriptions superseded above)

Not Task14 acceptance, independent Astra review, or full-parity acceptance. All prior dirty work remains uncommitted; no commit/install/network/paid provider/personal-settings/host-runtime/private-backend/vendor/upstream-patch/installed-package changes. Approved verification-only CI is unchanged. Requested developer delegation could not launch: the human-enforced sandbox rejected the CLI mismatch, and refused an attempted sandbox:false launch; no settings were changed. Work therefore stayed in the foreground. Independent Astra re-review and parent final gates remain separate.

## Owned changes

- `src/children/controller.ts`, new `src/children/control-safety.ts`; `src/extension/coordinator.ts` only injects that shared safety registry. `src/extension/install.ts` is unchanged.
- `src/tintin/observer.ts`.
- `test/children/controller.test.ts`, new `test/extension/control-safety.test.ts`, `test/tintin/observer.test.ts`, `test/integration/child-control.test.ts`.
- `scripts/compatibility-probe.ts`: optional authored catalogue `modelCosts`, zero-cost defaults unchanged.
- `NOTICE`, observer/controller contracts, feature-parity evidence, this handoff. MIT license/copyright attribution retained exactly; production core is described as adapted, vendor-only baseline as immutable.

Full edited source/test/fixture files were read; this is not a claim that every other unit/isolation/negative-race/patch test body was audited. The earlier auditor read production/native fixtures and representative tests, not all test bodies.

## P1: safety owner and release rules

The typed `ControlSafetyRegistry` owns a WeakMap keyed by the actual retained SDK object. Its package-owned global symbol `pi-jev-subagent-router:control-safety:v1` shares that registry across controller/coordinator/entry/module copies in one JavaScript realm. The production coordinator explicitly injects it; standalone controllers default to it. Disposal/policy/new generation/cancelled same-owner transition does not replace/reset it. Weak keys do not keep SDK objects alive; no unsafe clear/recovery API was added. Separate processes/realms do not share these records.

Each SDK record retains `unresolved` and a unique pending attempt token. Acquire before service callbacks/awaits; competing replacement services return `in-flight` even if the old controller has been disposed. A pre-native refusal releases only its own token. After admission, verified committed/noop/direct configure rejection releases the token truthfully; an unknown outcome retains quarantine and its lease. Old-operation late unresolved outcomes update the same record used by the replacement service. The finally block cannot clear that quarantine/unknown lease. Lookup `not-found`/scope/ownership denial is not an attestation of a configure rejection. Native recovery remains committed-receipt-only, with same-ID retry only after authorized not-found; no fabricated rollback or new ID retry.

Safety retention does not reconstruct history: new controllers have empty revert stacks. A genuinely new SDK is allowed only through the observer's authoritative distinct-record/new-origin correlation; record/session tampering is not verification of a new lifetime.

Five supplemental public-3B unit regressions cover new-controller quarantine, pending→late unresolved and pending→committed/noop/rejected release. Known outcomes are tested by a subsequent real fixture configure/noop, not merely absence of degradation. Two actual entry-factory/coordinator tests restore the same child from public branch history through mode notify/confirm, budget change, off/on, generated reload, cancelled-compaction same-owner recovery, and a factory session_start replacement. Both already-unresolved and admitted-then-late-unresolved variants prohibit additional requests, preserve the exact SDK identity, and distinguish empty new history from retained safety. Faults are synthetic public-contract injection, not native-backend mutation.

## P2: SDK identity and readiness

A package-owned weak public-record→first-bound-SDK-object map retains same-realm evidence across service/entry/module copies. Ledger-path + immutable-origin evidence also holds weak references to the original record/SDK, preventing a current **or replacement observer** from restoring a forged different record with the old serialized SDK identifier. Passive FinalizationRegistry cleanup removes origin metadata only after the original SDK is collected and only if its evidence token still matches; there are no timers, and origin references are weak. The weak record-keyed map retains original SDK identity while that public record is reachable; it does not keep the record alive. An admitted pending native attempt/retained SDK keeps its original lifetime alive, so collection cleanup is not policy reset or a way to clear live control quarantine. Refresh, exact receipt, resume and restore refuse any already-bound SDK changing object (including reuse of the same sessionId) or becoming undefined. Unknown attribution detaches old subscription, retains the persisted watermark and exposes no new subscription, registration, entry, cost or control binding. Later compact/old receipt/resume cannot launder that association. Binding installation repeats the identity guard after old cleanup, so a synthetic cleanup callback cannot swap in a replacement after correlation's public read.

Never-bound undefined→ready is still legitimate public readiness; verified same-object resume/reload remain supported. Actual public revalidation of the original SDK object may reattach it. A distinct verified native spawn on a distinct record establishes a new origin. No persisted string/record identity alone attests an unexpected replacement. AccountingStore same-ID reassociation fixtures test a separate service trust boundary, not native observer continuity. Native association tampering was already refused independently; this fix does not claim unauthorized native mutation was possible. Replacement/ownership transfer remain native N/A, not new supported transitions.

Fifteen net added observer cases replace the old continuity permission: 12 replacement/removal × compact/receipt/resume/restore variants, original-object recovery, cleanup-time replacement guard, and two old-origin/reused-identifier restore guards (current/replacement service). Existing readiness, native same-mode resume/reload, stale callbacks, cleanup and distinct new-origin tests remain.

## Native cache hold measurement

`modelCosts` configures only authored fake-provider catalogue definitions. No SDK methods/model-runtime/backend functions are replaced; fixture streams report authored usage normally. Standalone 3B and old zero-priced scenarios remain unchanged.

The real retained completed child's public `getContextUsage()` reports **2 tokens**. Current catalogue rates: input/output/cacheRead/cacheWrite = **1/1/1/0** per million tokens; target = **1,000,000/1/0/1,000,000**. Actual formula gives **3.999998 USD** penalty, versus **0.01 USD** threshold. These deliberately extreme fake rates exercise policy on a short real context; they are not real-provider prices or an invoice claim.

- Same-tier, demand-1.55 deadband, and outside-band expensive-switch cases each return **held/cache-held**, with corresponding cache explanations independently computed from the same observed context/catalogue.
- All three preserve exact model/thinking, transcript, native state, every entry (no apply trace), history depth 0, parent/global/project settings, and provider execution count.
- Same-price **two-tier premium bypass** commits **allowed/high** with a verified receipt/history depth 1; exact revert commits **parent/off**, consumes history to 0, and appends exactly **four configuration entries**.
- Controller provider executions: **0**. Only the test then invokes native Agent resume: **1** execution observes restored **parent/off** on the same SDK. Shutdown listeners and network attempts: **0**.

This coverage passed green-first, honestly; no cache RED is claimed. The eight prior controller native lifecycle cells, public observer/factory/native-parity scenarios, published unsupported 3B and local patched standalone 3B still pass separately.

## RED/GREEN evidence

All runtime commands used `/usr/bin/env -i PATH=/usr/bin:/bin [JEV_SANDBOX_NATIVE=1] /bin/bash --noprofile --norc scripts/verify-sandbox.sh ...`, with the existing isolated inner bootstrap. Each evidence directory retains `process-tree.strace`.

| Gate | Result | Log / trace directory |
| --- | --- | --- |
| P1 assertion RED before production fix | 85 pass / 5 expected assertion fail, 232 assertions | `/tmp/task14-children-red-assertions.log`; `/tmp/jev-sandbox-evidence-sm7Jw2` |
| P2 assertion RED before production fix | 153 pass / 13 expected assertion fail, 692 assertions | `/tmp/task14-observer-red.log`; `/tmp/jev-sandbox-evidence-XivMsU` |
| P2 cleanup-time assertion RED before closing late-bind path | 166 pass / 1 expected assertion fail, 778 assertions | `/tmp/task14-observer-cleanup-red.log`; `/tmp/jev-sandbox-evidence-lXAqvs` |
| P2 old-origin restore assertion RED | 167 pass / 1 expected assertion fail, 784 assertions | `/tmp/task14-observer-restore-red.log`; `/tmp/jev-sandbox-evidence-2miHOC` |
| P2 replacement-service old-origin restore assertion RED | 168 pass / 1 expected assertion fail, 789 assertions | `/tmp/task14-observer-service-restore-red.log`; `/tmp/jev-sandbox-evidence-8ywRaf` |
| P2 final origin-memory GREEN | 169 pass / 0 fail, 792 assertions, 4 files; extension 92/0 and typecheck exit 0 | `/tmp/jev-sandbox-evidence-g7dPSI/green-tintin.log`, `green-extension.log`, `green-typecheck.log` |
| Fresh children GREEN | 90 pass / 0 fail, 247 assertions, 1 file | `/tmp/jev-sandbox-evidence-pW7Pbs/green-children.log` |
| Fresh tintin GREEN | 167 pass / 0 fail, 782 assertions, 4 files | `/tmp/jev-sandbox-evidence-pW7Pbs/green-tintin.log` |
| Fresh actual extension + real offline pack GREEN | 92 pass / 0 fail, 1,609 assertions, 5 files | `/tmp/jev-sandbox-evidence-pW7Pbs/green-extension.log` |
| Fresh typecheck | exit 0, no diagnostics | `/tmp/jev-sandbox-evidence-pW7Pbs/green-typecheck.log` |
| Required native-gates + all four explicit production files | 9 pass / 0 fail, 569 assertions, 6 files | `/tmp/jev-sandbox-evidence-Ab6N0L/final-native.log` |
| Full integration | 13 pass / 0 fail, 3,076 assertions, 9 files | `/tmp/jev-sandbox-evidence-Ab6N0L/final-integration.log` |
| Full patched | 2 pass / 0 fail, 160 assertions, 2 files | `/tmp/jev-sandbox-evidence-Ab6N0L/final-patched.log` |

Counts overlap; do not sum them as independent tests. Integration includes two structural inventory tests and preserved unsafe-baseline negative race controls, not 13 safe-control proofs. Native count remains 9; cache is extra measured cells within the existing controller declaration, not a fabricated extra test. JSON cache measurements are printed in both fresh native/integration logs.

Intermediate evidence is not hidden: `/tmp/task14-children-red.log` initially had four deadlocked pending-test timeouts; gates were released before awaiting the replacement result and rerun to obtain the real pre-fix assertion RED above. `/tmp/task14-extension-green.log` initially exposed the synthetic fixture's default same-model stickiness (two wait timeouts); fixture configuration now explicitly disables stickiness. `/tmp/task14-typecheck-first.log` exposed two test-only metadata/history type projections and one stale literal narrowing, fixed before fresh gates. No production assertion was weakened to permit stale mutation. Earlier native GREEN `/tmp/task14-native-first.log` and `/tmp/jev-sandbox-evidence-pbNYLc` were superseded by fresh final native gates after the cleanup guard.

Fresh complete source gates after the strengthened old-origin restore guard all exited 0 in `/tmp/jev-sandbox-evidence-D5LVrb` (each named log plus `process-tree.strace`). This supersedes the earlier 924-test snapshot in `/tmp/jev-sandbox-evidence-ZIb3wY`:

| Final gate/log | Observed result |
| --- | --- |
| `final-children.log` | 90 pass / 0 fail, 247 assertions, 1 file |
| `final-tintin.log` | 169 pass / 0 fail, 792 assertions, 4 files |
| `final-extension.log` | 92 pass / 0 fail, 1,609 assertions, 5 files; includes real offline pack |
| `final-test.log` | 926 pass / 0 fail, 8,146 assertions, 33 explicit files |
| `final-reference.log` | unchanged 140 pass / 0 fail across six processes: 31+13+52+12+20+12 |
| `final-typecheck.log` | exit 0, no diagnostics |
| `final-baseline.log` | 18 byte-identical immutable vendor files, unchanged upstream commit |
| `final-isolation.log` | 20 tests, OK |

Relative to supplied parent default 904/extension 90, the final 22 net additional synthetic regressions are five controller, fifteen observer and two actual-factory lifecycle cases. The final table includes both old-origin observer restore regressions. The native test count is unchanged, with the extra cache measurement increasing native assertions from 559 to 569. Full integration assertions are 3,076 (includes the expanded structural receipt assertions), patched remains 160. These are local gate receipts only; independent Astra re-review and parent acceptance are not substituted by green output.

## Remaining limits

Independent Astra re-review and parent final integration/acceptance follow; neither is claimed here. SDK safety/identity registries are same-realm memory only, not process-restart persistence or universal lifetime attestation. Quarantined unknown outcomes remain blocked with no unsafe recovery API. Published retained control stays unsupported without the reviewed local public-contract patch. Complete child pricing/descendant attribution, evicted-record terminal authority, native ownership transfer/replacement and cross-mode stale tool-call correlation remain outside supported evidence. CI configuration is verification-only and hosted runner execution remains unverified.
