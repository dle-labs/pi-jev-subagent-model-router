# Task 9 observer implementation handoff

This adds accounting observation services only. It does **not** wire a production extension entry, controller, commands, routing decisions, or child configuration setters. Tasks 1–8 and their existing dirty work were left untouched. All work remains uncommitted. Parent reruns and independent Astra specification/quality reviews are still required; this is not Task 9 acceptance or full-parity acceptance.

## Files and APIs

Six new files:

- `src/tintin/registry.ts`
- `src/tintin/observer.ts`
- `test/tintin/registry.test.ts`
- `test/tintin/observer.test.ts`
- `test/integration/child-observer.test.ts`
- this document

No changes to the accepted AccountingStore, existing accounting tests, probes, launcher/discovery/count guards, vendor, installed packages, patches, or production entry. Observer tests exercise real AccountingStore transactions themselves rather than requiring more state-only cases.

`registry.ts` exports:

- `managerKey = Symbol.for('pi-subagents:manager')`.
- `getOwnedRecord(owner, childId, knownOwnership, registry?)`: `{kind:'owned', record, session?}` or `{kind:'unknown', reason}`. The default manager comes only from that public registry symbol, using its synchronous `getRecord` method.
- `KnownOwnership = {owner, childId, toolCallId}`; caller must already have established the current native association, not copied an arbitrary persisted association.
- `PublicRecord` and `ObservedSession`: narrow structural projections of public record/session fields; SDK event/session imports are **public type-only imports**.
- `readLifetimeCost(usage)` accepts a finite nonnegative flattened `usage.cost`.
- `readTerminalCost(usage)` separately accepts a finite nonnegative `usage.cost.total`.

Registry/record/session shapes are checked before returning an owned record. Token components, record counters, status, type, ID, and a present session's public `sessionId`/`subscribe` must match the pinned shape. Money may be missing/invalid without destroying an otherwise valid record: the observer must retain the previous watermark and persist incompleteness. A present `parentAgentId` or `workflowId` excludes the record **before the store**. A present `record.toolCallId` must equal the exact correlated native call ID; absence is allowed for foreground spawn/resume and pending background acknowledgement. `rootSessionId` is lineage, not authorization; display name/type is not a money identity. Missing, throwing, malformed and asynchronous registry reads fail open without escaping into native execution.

`observer.ts` exports `ChildObserver(options)`, `ObserverOptions`, `ObserverEntry`, and `observerEntryType = 'jev:child-observer'`.

Required options are `{owner, store, eventBus, appendEntry}`. `owner` must be supplied by trusted public context as `rootOwnerId(canonicalProjectRoot, publicParentSessionId)`; neither canonicalization nor parent identity is guessed here. `store` supplies real `registerOrigin`/`observe` and its public ledger `file` for durable generation/reload validation. Optional seams are `getOwner`, `getRegistry`, `warn`, and `now`; synthetic tests substitute record/session delivery, not backend functions.

Public methods:

- `observeToolCall({toolName, toolCallId, input, parentToolCallId?})`: use the host's current native schema-validated `tool_call` event. It retains only call ID and a nonempty resume ID. Model/thinking are irrelevant to accounting admission: even both-explicit/unclassified calls are observed. Schema-valid empty resume/schedule strings remain immediate new spawns, matching native truthiness; actual schedules are excluded. Calls scoped under another parent tool are excluded.
- `observeToolUpdate({toolName, toolCallId, partialResult})`: correlate exact call ID with `partialResult.details.agentId`.
- `observeToolResult({toolName, toolCallId, details, isError?})`: correlate exact call ID with `details.agentId`; never inspect pooled `.usage`.
- `observeHostEvent(event)`: optional public parent `AgentSession.subscribe` adapter for execution updates and ends. **It deliberately ignores `tool_execution_start`**, which the pinned host emits before validation and which cannot establish native ownership. The extension `tool_call` seam must have been observed first.
- `restore(entry, publicParentMessages)`: revalidate persisted origin and current correlation; see below.
- `ownerChanged(owner)`: dispose immediately if the public runtime owner changes, even if no child event occurs. Host session-switch/shutdown wiring must call this or `dispose`; a new runtime owner needs a new observer instance.
- `dispose()`: idempotent synchronous teardown/invalidation, never waits on accounting.
- `flush()`: drains only already event-enqueued promises, for tests/explicit shutdown coordination. It does not scan/poll registry records or generate observations.
- `status`: `observing`, `unknown-attribution`, `degraded`, or `disposed`; diagnostics are conservative/sticky, not a completeness or zero-spend report. `pendingCount` exposes bounded unresolved lifecycle hints.

## Ownership, origin and activity

Only a current immediate **new native Agent call plus an exact receipt/update child ID and current validated top-level record** creates an origin:

```
{backend: '@tintinweb/pi-subagents',
 rootOwnerId: supplied canonical project/root-parent identity,
 spawnToolCallId: original new native call ID,
 childId: native receipt child ID}
```

Register that immutable origin in the locked store before any money. The durable accounting ID is independent of transient SDK identity, activity generation, and current resume call ID. Repeated correlations/receipts of the same binding do not resubscribe or allocate a new lifetime. Same-mode resume changes current correlation and activity generation, **not** origin/highwater. A resume `tool_call` immediately suspends/detaches old callbacks; an exact resumed receipt/update must revalidate the same public record **and original bound SDK object** before reattachment. Same-record identity alone does not attest SDK continuity. The higher-generation store registration adds `activity-uncovered` before observing any subsequent delta, including a zero-delta resume.

An explicitly verified distinct new native spawn that reuses a child ID with a **different public record object** gets a different origin. A replacement record observed without that fresh call/receipt proof is ambiguous: refuse charging and detach. Replaying the old call's receipt cannot attest continuity of a replacement. A declining total never invents another origin.

Schedules, workflows, nested children, mentions and cross-extension RPC spawns are not discovered as owned by scanning the manager or following lifecycle starts. Parent tools with unknown scopes cannot establish global ownership. An explicitly supplied `getRegistry` returning null/undefined stays unknown rather than reopening the global manager; an unavailable supplied `getOwner` disposes rather than silently retaining the prior owner. Pre-extension records with no original spawn proof are not reconstructed from `startedAt`, current tool call, model, display name, lineage or totals.

Published cross-mode background-to-foreground resume can retain the old optional `record.toolCallId`. That conflict is still refused; no weakened fallback check was added.

## Event lifecycle and ordering

The observer subscribes to the supplied public bus's four channels: `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:compacted`. A started hint need not contain session/correlation. Unresolved hints retain **only IDs**, bounded to 128; pending native call identifiers are also bounded to 128. No raw prompt/task/result/key is retained in those pending structures. An exact later update/receipt establishes association; a later actual lifecycle event can attach a newly available SDK session. There are no timers, registry scans, background polling loops or invented SDK readiness notifications. If a pending background child produces no further public event, observation waits rather than guessing readiness.

Each actual binding has at most one SDK subscription, and replacement/resume/disposal attempts its unsubscriber once. Duplicate lifecycle delivery does not multiply subscriptions. SDK assistant `message_end`, `agent_end` and public `compaction_end` events enqueue **record lifetime reconciliation**, not per-message money. Pinned `agent-runner.ts` synchronously calls its assistant-usage callback on `message_end`; `agent-manager.ts` adds that delta into `record.lifetimeUsage`. Our accounting queue crosses a microtask boundary and then rereads the same authorized public record, so a later synchronous backend subscriber has had its opportunity to update the final accumulator. Terminal bus events also trigger reconciliation, including foreground cases whose correlation arrives only in the eventual native receipt.

Queues serialize by immutable origin/lifetime. Before work and after **each** register, append and observe await, including rejection, the observer checks disposal, runtime owner, current binding epoch, same public record and same SDK binding. Rejection revalidation disposes on changed/unavailable/throwing owner without requiring another event. A throwing public registry seam invalidates/detaches only the still-current binding/epoch; it cannot invalidate a replacement binding. A public owner read may synchronously dispose even when it returns the original owner: disposal is rechecked immediately after that callback. After the public registry/record read returns, validation rechecks disposal, suspension, epoch and binding-map identity using only local predicates, before accepting the returned record or marking it unknown. Returning valid old data cannot authorize append/observe after invalidation; returning unknown old data cannot detach a replacement or overwrite disposed status. No recursive or repeated external validation is needed. Reentrant reads and throwing/reentrant warning handlers remain contained, and rejection cleanup does not reject the queue tail. Old callbacks cannot enter a new binding. An already-observed SDK changing to a different object (even with the same sessionId) or becoming undefined is unknown attribution: detach the old subscription, retain the watermark, and admit no new subscription, registration, entry, cost or control binding. Compact, old receipts, resume and restore cannot launder this association. Reattachment requires actual public revalidation of the original SDK object. Only a never-bound undefined→ready transition is readiness, not replacement. Package-owned weak record→SDK evidence survives service/entry/module copies in one JavaScript realm. Ledger-path + immutable-origin evidence additionally remembers weak references to the original record and SDK: neither a current nor a replacement observer may restore a forged replacement record reusing the old SDK identifier. Passive FinalizationRegistry cleanup can remove origin metadata only after its original SDK is collected, with evidence-identity checks protecting later registrations; it cannot clear retained live-SDK control safety. There are no timers; origin references are weak. The weak record-keyed map retains the original SDK identity while that public record is reachable, and neither map keeps the public record alive. Evidence is not persisted across processes/realms and does not invent attestation of an evicted lifetime.

Owner/session switch or explicit disposal invalidates all queued callbacks, clears pending hints/calls/bindings, and independently attempts every SDK and bus unsubscriber. A throwing cleanup does not skip remaining cleanup. A public unsubscriber that itself fails cannot be guaranteed to have removed its underlying listener, but disposed callbacks are inert. Registry, callback, accounting, persistence and cleanup failures expose static sanitized warnings/statuses; synchronous and asynchronous warning-handler failures are contained. Native tool hooks return synchronously and do not await accounting. No routing mutation or backend/SDK monkeypatch/setter fallback is used.

An accounting transaction already admitted while authorized may commit while the observer is awaiting it; disposal does not claim rollback of that store commit. After its return, no further stale persistence/observation is admitted. This is distinct from canceling a store transaction with its own AtomicOptions signal.

## Cost-source boundary

The pinned backend `usage.ts` was read completely, including accumulator operators, `toReportedUsage`, and `PendingUsagePool`. Public record types and `index.ts` lifecycle construction confirm the following distinct sources:

1. `record.lifetimeUsage.cost`: finite nonnegative **per-child cumulative lifetime money**, authoritative. This includes descendants in the top-level ancestor aggregate.
2. `subagents:completed` / `subagents:failed` `.usage.cost.total`: constructed from that child's lifetime accumulator via `toReportedUsage`, but lifecycle envelopes contain only a reusable child ID, **not an immutable origin or exact call/SDK correlation**.
3. Native Agent/tool-result `.usage`: `PendingUsagePool.drain()`, potentially pooling several different children. **Never charge it.** Native result details serve correlation only.

Terminal usage is normalized independently but is **not used as a fallback dollar baseline** in this pinned implementation. A valid record always wins, including when the terminal envelope disagrees. Without a live authoritative record, or when that record's cost is missing/invalid, the public terminal envelope alone cannot rule out stale replay/reused child identity. Do not charge it, fabricate zero, switch baselines or create an origin. Supporting an evicted-record terminal fallback requires a future public immutable-lifetime attestation; current payloads have none. Lifecycle events merely wake reconciliation of the already-origin-bound current record; their child IDs never infer a lifetime for payload money.

The exact highwater/delta remains exclusively owned by Task 8's locked AccountingStore. NaN/infinity/negative/missing costs preserve the watermark and persist gaps; a valid decline yields zero delta, not reset. A known .2 subtotal plus an unpriced contribution remains .2 through replay/reload. Newly observed gaps persist even if cumulative dollars do not change. No raw-message price stream is added, no tokens become money, and rejecting descendants before the store makes ancestor .3 (including descendant .1) charge .3, not .4.

Every supported Tintin observation is incomplete. Baseline reasons are `aggregate-loses-missing-cost`, `descendant-coverage-unknown`, `observation-gap`, in addition to store `native-coverage-unverified`. Assistant messages with missing or zero cost add `unpriced-contribution` without creating money. Unavailable aggregate cost adds `usage-unavailable`; the store also adds `cost-unavailable`, `cost-invalid` or `zero-unproven` where appropriate. Positive totals, terminal success, tokens, explicit/serialized zero, free configuration and finite rates do not prove complete/free coverage. There is no fixture-only complete branch.

An aggregate residual cannot prove which component model produced it: always use `unknown-child-model`, not the current SDK model, launch request or parent model. Observation time is UTC via `now`/Date, and aggregate residuals are `late: true`; do not redistribute by unsupported historical timestamps/startedAt. The known reported subtotal, pricing completeness, model attribution and temporal attribution remain separate.

## Persistence and reload

`appendEntry('jev:child-observer', entry)` receives only version, owner, projected four-field origin, accounting ID, current correlation tool-call ID, monotonic activity generation and optional ready SDK session ID. Unknown origin fields are stripped, including when restoring a malformed/extra-field serializable entry. No prompt/result/key/model guess is persisted. The hook is the public host appendEntry seam, not private runtime access.

Durable registration and public entry persistence are separate, binding-specific states. A successful authorized `registerOrigin` retains its accounting ID and registration even if append throws/rejects; append failure does not allocate a new generation, namespace or origin. No observation is admitted until that binding's correlation entry append resolves **and** post-await validation succeeds. A later authorized event retries the pending append before observation, without re-registering; `flush()` alone and elapsed time never initiate retries. Each resumed binding must persist its new correlation entry before charging. Until retry succeeds, a superseded old entry cannot restore against the latest resumed receipt. Permanent append failure stays sanitized/degraded and admits no observations; explicit disposal still removes listeners.

Append may write a custom entry and then lose its acknowledgement. Retrying may duplicate the same binding identity/correlation/generation, which is acceptable; restore validates the latest persisted entry against public history and the durable association. This is not an exactly-once external-persistence guarantee without a receipt. Disposal or owner/epoch invalidation after an append (successful or rejected) does not mark that obsolete binding's entry persisted or permit further charging. Neither append rejection nor observer disposal claims rollback of any already committed store operation.

The public restore caller reads custom entries and current parent messages from its public session manager. Restore then requires:

- matching version, owner and origin root/backend/child/spawn fields;
- public parent assistant **new spawn** Agent call and successful exact tool receipt for that origin child;
- public assistant current spawn/resume call and successful exact receipt for the same child;
- that current receipt is the **latest** successful native Agent receipt for the child in the supplied public message history;
- present current public record, strict optional toolCallId match, top-level schema and same persisted ready SDK session ID; if this realm has already observed that record, its original SDK **object** must also match;
- durable namespace-derived accounting ID matching the registered immutable origin;
- entry generation not ahead of the validated durable association.

A persisted association alone is never authorization. Missing original history, pre-extension origin, changed SDK identity at reload, forged origin/ID/generation, old/superseded receipt or strict call conflict refuses attachment. Same-ID unknown replacement cannot be resolved from a serialized entry. The read-only ledger snapshot supplies the previous generation, and locked registerOrigin validates the higher association again: generation is `max(validated durable, current binding) + 1`, never restarted at zero. Stale cooperating concurrent registration fails closed rather than silently replacing the association; a later explicit revalidation/rebind is needed, not an automatic polling retry. Revalidated reload retains the old accounting ID/highwater and persists a coverage gap.

## Test evidence and limits

All commands used only the required clean-environment, read-only, network-blocked outer launcher, fresh private HOME before Bun, and existing isolated inner runtime. No install/network/paid provider/personal-file reads/commits or package edits were performed. Evidence directories below retain `process-tree.strace`; stdout/stderr summaries were inspected in tool output, not separately saved as log files.

Initial RED `/tmp/jev-sandbox-evidence-6pTRhO`: 50 existing tests passed, two new files failed loading the deliberately absent modules (two import errors). Subsequent **behavior assertion** RED evidence:

| RED evidence directory | Result / exposed defect |
| --- | --- |
| `/tmp/jev-sandbox-evidence-ODYH3W` | 89 pass / 2 fail: old receipt charged ambiguous replacement; explicit runtime-owner invalidation missing |
| `/tmp/jev-sandbox-evidence-uLaX8K` | 93 pass / 2 fail: parent-tool scoped calls and pre-validation execution starts claimed ownership |
| `/tmp/jev-sandbox-evidence-HN6QwS` | 95 pass / 2 fail: restored extra origin prompt/key fields forwarded; async warning rejection escaped |
| `/tmp/jev-sandbox-evidence-hOWkAD` | 97 pass / 2 fail: superseded receipt and forged future generation accepted at restore |
| `/tmp/jev-sandbox-evidence-mFsHBU` | 99 pass / 1 fail: schema-valid empty native resume/schedule fields incorrectly excluded new spawn |
| `/tmp/jev-sandbox-evidence-4FSgL7` | 100 pass / 3 fail: explicit unknown registry source reopened global scope; unavailable runtime owner silently retained previous ownership |

Final inspected verification, all exit 0:

| Gate | Result | Evidence directory |
| --- | --- | --- |
| tintin | 103 pass / 0 fail, 4 explicit files: prior 50 + 43 observer + 10 registry | `/tmp/jev-sandbox-evidence-yrf1nE` |
| state | unchanged 39 pass / 0 fail, 3 explicit files | `/tmp/jev-sandbox-evidence-v7tI6T` |
| default | 520 pass / 0 fail, 23 explicit files: prior 467 + 53 | `/tmp/jev-sandbox-evidence-yEISEU` |
| reference | 140 pass / 0 fail in six separate processes (31+13+52+12+20+12) | `/tmp/jev-sandbox-evidence-j4Occ0` |
| typecheck | exit 0, no diagnostics | `/tmp/jev-sandbox-evidence-EzmbmE` |
| baseline | 18 byte-identical pinned vendor files | `/tmp/jev-sandbox-evidence-FKZBBT` |
| native-gates + explicit new native file | 4 pass / 0 fail, 3 explicit files (one new observer test plus three existing tests) | `/tmp/jev-sandbox-evidence-5NStNK` |

No launcher wiring was changed, so no new isolation-20 claim is made. Default/tintin discovery adds only the two new unit test files; native remains excluded by directory boundaries. Explicit native reproduction:

```
/usr/bin/env -i PATH=/usr/bin:/bin JEV_SANDBOX_NATIVE=1 \
 /bin/bash --noprofile --norc scripts/verify-sandbox.sh \
 /bin/sh /workspace/scripts/isolated.sh native-gates \
 /workspace/test/integration/child-observer.test.ts
```

### Actual native proof versus supplemental cases

`child-observer.test.ts` loads the unchanged **published** Tintin package with the selected SDK's declared public exports, checks matching dependency resolution, uses `prepareNativeFiles`, `createNativeParent`, and `nativeCall`, and supplies the existing fixture's public `eventBus`/`extensionFactories` API. Its small authored provider returns deterministic local usage, including .2 per child assistant message. Nothing replaces backend functions, record methods, SDK subscription or control APIs. Network/fetch are denied and tracked at zero.

Actual model-issued native foreground/background spawn and same-mode resume produce two retained real SDK children. The production ChildObserver registers/updates **real locked AccountingStore** origins, correlates native host events/receipts, stores public appendEntry data, reconciles .4 per child (.8 total), and records a background-resume gap while the local continuation stream is still held, before its .2 increase. Reload reconstructs a **new service and store instance** from actual public custom entries/parent message history while the native records/SDK children remain live; it retains the .8 watermark. Shutdown removes all tracked bus listeners and releases the global native registry. This is observer/service reload, not a claim that evicted children survive a parent-process restart.

The fixture additionally injects replayed receipts/lifecycle events through public seams (including bogus pooled/terminal 99 totals) to verify no additional charge and unchanged native result content; those delivery replays are supplemental injections around actual native records. The unit suite separately provides synthetic ordering, malformed records, missing/zero/unpriced money, stale callbacks, await invalidation, record reuse/replacement and cleanup-failure coverage, largely with the real store. SDK session replacement on a same public record is explicitly **rejected synthetic supplemental guard coverage**, not permission to preserve a binding. Currently unavailable native same-record replacement/ownership transfer remain N/A. AccountingStore's same-ID reassociation fixtures exercise its separate trust boundary and do not authorize observer SDK replacement. No native nested execution or native free/complete pricing proof is claimed.

Actionable remaining limits: host entry must wire validated tool_call plus updates/results, public owner lifecycle/disposal and restoration inputs; unknown/evicted-origin terminal payloads cannot independently charge; pending session readiness waits for actual public events; cross-mode stale-call conflict remains unsupported; complete pricing/component model/date attribution require future public evidence. Controller, commands, production entry, control capability expansion and full parity are outside Task 9.

### Two-gap follow-up (0186638b)

Only `src/tintin/observer.ts`, `test/tintin/observer.test.ts`, and this contract were edited in this follow-up; all prior dirty work remains uncommitted. No Task 9 acceptance is claimed. Supplemental synthetic regressions cover rejected register/append/observe with changed, unavailable or throwing owner; throwing/reentrant registry and warning seams; stale rejected append across resume; initial/resume transient synchronous/asynchronous append failure and real-store reload from successfully persisted entries/public history; permanent rejection; and write-with-lost-acknowledgement duplication. The prior unsubscribe-failure regression is retained.

All runtime commands used the clean-environment outer sandbox and mandatory private-HOME child bootstrap. Logs were explicitly captured under `/evidence` (mapped to the following retained directories):

| Gate | Result | Retained log |
| --- | --- | --- |
| Focused behavioral RED | 43 pass / 14 expected assertion failures, 141 assertions, 1 file | `/tmp/jev-sandbox-evidence-AlNgMG/red-focused.log` |
| Focused first GREEN | 57 pass / 0 fail, 253 assertions, 1 file | `/tmp/jev-sandbox-evidence-RDtaWd/green-focused.log` |
| Final tintin | 123 pass / 0 fail, 484 assertions, 4 files (63 observer tests) | `/tmp/jev-sandbox-evidence-NYUV5b/green-tintin.log` |
| Final default | 540 pass / 0 fail, 2779 assertions, 23 files | `/tmp/jev-sandbox-evidence-NYUV5b/green-test.log` |
| Final reference | 140 pass / 0 fail in six processes (31+13+52+12+20+12) | `/tmp/jev-sandbox-evidence-NYUV5b/green-reference.log` |
| Final typecheck | exit 0, no diagnostics | `/tmp/jev-sandbox-evidence-NYUV5b/green-typecheck.log` |
| Final baseline | 18 byte-identical pinned files | `/tmp/jev-sandbox-evidence-NYUV5b/green-baseline.log` |
| Explicit native-gates + child-observer file | 4 pass / 0 fail, 501 assertions, 3 files | `/tmp/jev-sandbox-evidence-agp6s6/green-native.log` |

An initial focused invocation attempted a test-name filter, rejected by the bootstrap's explicit-path guard before Bun started; `/tmp/jev-sandbox-evidence-jjQxD5/red-focused.log` records that invocation error, not behavioral RED evidence. No launcher or discovery guard was weakened. Each directory also retains `process-tree.strace`. The explicit native reproduction above is unchanged and includes the child-observer file; no new native failure-injection or broader Task 9/native parity claim is made.

### Single-guard follow-up (guardfinding3ce8c6b5)

Only `src/tintin/observer.ts`, `test/tintin/observer.test.ts`, and this contract were edited. Prior dirty work remains uncommitted. The narrow fix adds a post-owner-callback disposed check and a pure current-binding predicate after external registry/record validation. Seven deterministic supplemental tests retain all prior 63 observer tests, including the 20 recovery regressions: four getRegistry/getRecord dispose-but-return-valid cases, two reentrant replacement cases returning valid/unknown old data, and owner dispose-but-return-original. Real AccountingStore registration and append queue barriers gate the post-registration append admission and post-append observe admission; counters distinguish newly admitted writes from already committed registration. Replacement tests verify only the new binding appends/charges, its SDK subscription stays live and stale callbacks remain inert. These are synthetic reentrant-seam cases, not native callback-failure injections or rollback of previously admitted transactions.

All runtime execution used the approved clean-environment OS sandbox with the unchanged isolated bootstrap; no installs, network, ambient runtime imports, personal files, host/backend/entry changes or commits. Captured logs and `process-tree.strace` are retained:

| Gate | Observed result | Retained log |
| --- | --- | --- |
| Initial exploratory RED (tintin directory plus deduplicated observer path) | 125 pass / 5 assertion failures, 506 assertions, 4 files; post-append cases were then tightened to target pre-observe admission | `/tmp/jev-sandbox-evidence-rJlPWR/red-focused.log` |
| Final focused behavioral RED, before production fix | 63 pass / 7 assertion failures, 302 assertions, 1 file | `/tmp/jev-sandbox-evidence-tR23Dh/red-focused.log` |
| Focused GREEN | 70 pass / 0 fail, 340 assertions, 1 file | `/tmp/jev-sandbox-evidence-fMpkdN/green-focused.log` |
| Tintin | 130 pass / 0 fail, 534 assertions, 4 files | `/tmp/jev-sandbox-evidence-NZOFM3/green-tintin.log` |
| Default | 547 pass / 0 fail, 2829 assertions, 23 files | `/tmp/jev-sandbox-evidence-NZOFM3/green-test.log` |
| Reference | 140 pass / 0 fail across six processes (31+13+52+12+20+12) | `/tmp/jev-sandbox-evidence-NZOFM3/green-reference.log` |
| Typecheck | exit 0, no diagnostics | `/tmp/jev-sandbox-evidence-NZOFM3/green-typecheck.log` |
| Baseline | 18 byte-identical pinned files | `/tmp/jev-sandbox-evidence-NZOFM3/green-baseline.log` |
| Explicit native-gates plus child-observer file | 4 pass / 0 fail, 501 assertions, 3 files | `/tmp/jev-sandbox-evidence-801uPS/green-native.log` |

Compared with the supplied parent evidence (tintin 123/default 540/reference 140/native 4), only seven supplemental observer regressions were added; native proof is unchanged. Independent Astra review and parent integration remain separate. This is not Task 9 acceptance.

### Callback-admission follow-up (finalquality cd33ec7e)

Only `src/tintin/observer.ts`, `test/tintin/observer.test.ts`, and this contract are owned by this follow-up. Prior dirty work and the native fixture remain intact; no commits, installs, network, personal-file access, host runtime/backend/private API or production-entry changes were made.

Initial correlation, lifecycle refresh and restore now capture the expected call/binding/epoch **before** external registry/record reads and check that snapshot using local state after return. Unknown stale reads cannot invalidate a replacement or overwrite disposed status. Binding installation additionally rechecks disposal, call identity, map identity and the expected detached epoch after old SDK cleanup, so a cleanup callback that binds a replacement cannot be clobbered. Existing queued post-read guards are retained.

SDK and constructor bus subscriptions acquire the returned cleanup first, then check runtime-owner/local liveness before retaining it. If acquisition synchronously disposes or replaces the binding, the newly returned cleanup is immediately attempted independently, including when cleanup throws. Bus acquisition stops after invalidation. A throwing cleanup cannot guarantee that an external resource was actually removed; callbacks remain invalidated and failures are sanitized. No proxies, arbitrary field-access defenses, timer retries or recursive external validation loops were added.

Observation payload preparation, including the public clock callback and Date serialization, now precedes final binding/owner validation and store.observe admission. A clock that disposes or changes owner but returns a normal Date cannot admit a new monetary operation. Already-admitted store commits are still not rolled back or claimed canceled.

Twenty-four supplemental regressions use real AccountingStore services where money is exercised: initial valid/unknown read disposal, receipt/refresh/restore dispose-but-return-valid, clock disposal/owner change, SDK acquisition disposal/owner/replacement with ordinary or throwing returned cleanup, old-unsubscriber reentrant disposal/replacement, initial valid/unknown replacement reads, and constructor bus acquisition invalidation. The prior queued-read, rejected-await and entry-persistence retry regressions remain unchanged. These typed external-callback seam tests are synthetic supplemental coverage, not new native fault-injection proof or Task 9 acceptance.

Captured evidence from the unchanged approved clean-environment launcher and isolated bootstrap:

| Gate | Observed result | Retained log |
| --- | --- | --- |
| Behavioral RED before implementation | 132 pass / 22 assertion failures, 610 assertions, 4 files; two added owner-acquisition cases already passed existing queue validation | `/tmp/jev-sandbox-evidence-uvmjUR/red-tintin.log` |
| First GREEN | 154 pass / 0 fail, 681 assertions, 4 files | `/tmp/jev-sandbox-evidence-DhX2BE/green-tintin.log` |
| Final tintin | 154 pass / 0 fail, 681 assertions, 4 files (94 observer tests) | `/tmp/jev-sandbox-evidence-PEEtA0/green-tintin.log` |
| Final default | 571 pass / 0 fail, 2976 assertions, 23 files | `/tmp/jev-sandbox-evidence-PEEtA0/green-test.log` |
| Final reference | 140 pass / 0 fail across six processes (31+13+52+12+20+12) | `/tmp/jev-sandbox-evidence-PEEtA0/green-reference.log` |
| Final typecheck | exit 0, no diagnostics | `/tmp/jev-sandbox-evidence-PEEtA0/green-typecheck.log` |
| Final baseline | 18 byte-identical pinned files | `/tmp/jev-sandbox-evidence-PEEtA0/green-baseline.log` |
| Explicit native-gates plus unchanged child-observer fixture | 4 pass / 0 fail, 501 assertions, 3 files | `/tmp/jev-sandbox-evidence-AA0lJq/green-native.log` |

Every evidence directory also retains `process-tree.strace`. Relative to supplied parent green tintin 130/default 547/reference 140/native 4, only 24 observer tests were added. Native coverage and the existing host-wiring, readiness, terminal-attestation, pricing and attribution limits are unchanged. Parent integration and independent Astra review remain separate; no acceptance claim is made.

### Task14 finalaudit sealed-evidence correction (fb7c388b)

SDK and origin evidence use the unchanged canonical symbols `pi-jev-subagent-router:observer-sdk-lifetimes:v1` and `pi-jev-subagent-router:observer-origin-lifetimes:v1`. Each non-writable/non-configurable global data slot holds a frozen protocol/version facade with only `matches` and `remember` boolean operations. Collections, weak references, mutable evidence and finalizer handles stay in closures; no raw WeakMap/Map, reset or overwrite API escapes. Remember refuses contradictory existing evidence. SDK evidence is weak-keyed by the public record; origin evidence retains only weak record/SDK references and identity-checked passive finalization. No strong SDK history is added.

Only ABSENT own slots initialize. A present undefined/null, accessor, mutable descriptor, legacy/unsealed/malformed/wrong-version authority, or initialization failure makes the observer unknown-attribution, without subscription, registration, entry, cost or control binding. Descriptors are inspected without invoking slot or facade-field getters; import still succeeds and native hooks remain fail-open. Compatible distinct module-cache copies share the canonical closures. Incompatible versions must refuse under these **same keys**, not invent a v2 namespace; migration requires a process restart. Original-object continuity, never-bound undefined→ready and distinct new-spawn/new-record origins remain supported.

This is trusted-host package-contract safety against replacement/reset/version/injection mistakes, **not hostile same-realm JS isolation**. A host can call the SDK directly or patch intrinsics. Well-shaped forged state preinstalled before first import cannot be cryptographically authenticated by a structural protocol validator. Unsealed/mismatched state is refused; host/module provenance stays trusted. Cross-realm/process persistence and evicted-lifetime attestation remain unsupported. See [follow-up evidence](task14-finalaudit-followup.md); this is not independent Astra review or Task14 acceptance.

### Task14 finalaudit identity follow-up (68f5154b)

The prior same-record SDK continuity permission is superseded by the defensive rules above. Replacement/removal (including identical serialized sessionId), compact/receipt/resume/restore laundering and cleanup-time replacement are rejected; original-object revalidation and never-bound readiness remain supported. The same-realm weak record/origin identity memory also prevents a fresh service from forgetting an already-observed retained origin's original record/SDK, including a forged replacement record reusing the serialized SDK identifier. See [targeted handoff](task14-finalaudit-followup.md) for real assertion RED/GREEN logs, full native reruns and limits. These synthetic guards are not evidence of possible unauthorized native mutation or new native replacement support. Independent Astra re-review and parent acceptance remain pending.
