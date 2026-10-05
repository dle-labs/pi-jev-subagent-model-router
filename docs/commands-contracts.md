# Task11: child command and decision UI contracts

This is a module handoff for Task12 composition, not a production extension entry, Task11 acceptance, or full upstream-parity claim. Tasks1–10 remain untouched and uncommitted. No controller, observer, core policy, shared contract, package manifest, vendor, installed package or patch was rewritten. The only existing-file edit is `scripts/isolated.sh`: add `commands`/`ui` modes and those explicit directories to default discovery; native suites remain excluded.

## Exported composition APIs

`src/commands.ts` exports `CommandRouter`, `registerCommands`, `CommandServices`, `CommandAPI`, `CommandResult`, `SessionChange`, and `Admission`.

```ts
const commands = new CommandRouter(services);
registerCommands(pi, commands); // optional command/tool APIs guarded independently
await registerRenderer(pi);    // separate optional/lazy TUI helper

await commands.command("status");
await commands.route("specified task", publicExecuteSignal, toolCallId);
commands.remember(validatedDecisionEntry, capturedAdmission, observedPair);
commands.rememberTask(currentValidatedBinding, nativeTaskText, capturedAdmission);
// Task13: ONLY from eligible immediate native Agent admission, before receipt:
commands.rememberEligibleTask(boundedPrefix, capturedAdmission, originalChars, originalAgent);
// Already bounded extension prefixes may carry the exact original length:
commands.rememberTask(currentValidatedBinding, boundedPrefix, capturedAdmission, originalChars);
commands.invalidate(); // or clear(): abort pending work and clear bounded memory
commands.dispose();   // idempotent cleanup; permanently inactive
commands.entries;     // detached projected display entries, never raw tasks
commands.memory;      // frozen entry/task counts and character totals
```

Here `capturedAdmission` is `{owner,generation}` captured **when the work was admitted**, not a fresh token obtained after stale asynchronous work completes. Old owner/generation tokens cannot repopulate cleared memory. `observedPair` is optional `{model: "provider/id", thinking: "off"}` from a verified actual child observation or acknowledged controller receipt, not a launch request/default or classifier target.

`src/ui/entries.ts` exports `decisionEntryType = 'jev-subagent-router-decision'`, `DecisionDisplay`, `EffectiveSettings`, `projectEntry`, `prepareDecision`, `registerRenderer`, `RendererAPI`, and `RendererPrimitives`. `DecisionDisplay` deliberately extends the existing `DecisionEntry` only with an optional observed effective pair; the shared contract is unchanged. `projectEntry(entry, effective?)` strips extra payload fields, model pricing/native data, options, prompts and credentials. Existing analysis/decision fields are projected and text/probability/note collections bounded. Nonfinite stored numbers reject with static `invalid-decision-number`; `prepareDecision` produces only “decision data unavailable”, never a fabricated zero/confidence or rerun. The host may persist **only this projected entry**, using guarded public `appendEntry`; these modules never append raw tasks or alter native content/results. No old parent-router entry name or observer namespace is reused.

`src/ui/status.ts` exports pure `prepareStatus`, `pricingText`, `actionGlyph`, bounded terminal `label`, and the narrow `StatusView`/`ChildStatus` projections. Neither UI module controls models or owns native state.

### Required services and their authority

| Service | Contract / Task12 wiring |
| --- | --- |
| `getRuntime()` | Current detached, Task6-validated `RoutingSnapshot`. Owner/generation/config are captured before awaits and checked after service callbacks/awaits. Never substitute parent history/model/default settings. |
| `updateRuntime(change, expected)` | **Synchronous CAS** of expected owner/generation. Invalidate pending launch, controller and command work, merge the session-only patch and advance the runtime generation; return actual CAS success. It must not persist manual/global settings. |
| `getLedger()` | Current validated ledger snapshot, normally `loadLedger(store.file)`. Reads may be async. Status treats failures as unavailable, not zero. Classification uses existing `spendSnapshot` reported-dollar math. |
| `getCandidates(binding?)` | `ScopedCandidates`: already authenticated and strictly scope-resolved policy projections. Use the full current public registry to resolve settings scope before intersection/shortlisting; unavailable/unknown/denied scope is not permission to reopen the universe. A binding means this exact child's scope. Without it, use the current owner’s permitted recommendation/launch scope. Exact provider/id remains part of identity. No online catalogue/ranking calls here. |
| `getBinding(childId)` | The **current Task9-validated association**, with exact owner, SDK object/session ID, tool correlation, positive activity generation and disposal state. Never scan/guess from a global child name, lineage, persisted entry or totals. Commands recheck association identity after callbacks/awaits. |
| `controller` | Existing Task10 `ChildController` `apply`/`revert` methods only. No launcher, raw model setter, prompt/resume, native RPC or `executeTool` dependency is accepted. |
| `engine` | Optional existing `Engine`; omitted means real `propose`. Production should supply `createEngine({recordUsage:createUsageRecorder(store)})` so classifier evaluations use existing atomic accounting, not local counters or `saveLedger`. |
| `getGeneratedPath(runtime)` | Validated, absolute child generated resource from `configPaths().generated`, **not** a user-supplied filename. Guarded basename is `pi-jev-subagent-router.generated.json`; manual, scores and ledger resources refuse. Legitimate configured agent directories can be outside the project; tests use private sandbox paths only. |
| `reloadGenerated(expected)` | Called only after committed rename and still-current admission. Reload through existing `loadConfiguration`, retain manual-layer precedence and current session overrides. **The service must CAS expected owner/generation after its own awaits before applying state**, not return a stale config that overwrites a new runtime. Failures/late changes cannot undo the acknowledged file commit. |
| `getView()` | Sanitized plain discovery/control capabilities and known-child `{id,status,model?,thinking?}` projections. Do not pass native records, credentials, raw warning strings or unverified child associations. |
| `onInvalidate(callback)` | Synchronous invalidation subscription, returning synchronous cleanup. Required for mutable hosts unless Task12 directly calls `commands.invalidate()` on every owner/config/off/context/scope/auth/catalogue invalidation. Acquisition-time invalidation disposes the command coordinator instead of leaving an active unsubscribed instance. |

One central Task12 policy/lifecycle service should coordinate generation advancement and cancellation. Existing `LaunchRouter.update` aborts its pending classifiers/discovery; existing `ChildController.invalidate` aborts native admission and permanently refuses future mutation on that controller. Consequently Task12 must provide a freshly validated controller instance when appropriate, **not promise that a new instance reconstructs an old revert stack**. Known old receipts remain readable on the old controller; restart/reload recovery is not introduced here. The command layer reads `services.controller` at each control admission so composition can replace it deliberately.

All service arguments crossing awaits are detached except the required exact SDK identity in a child binding. Pending callback promises are raced against cancellation and both eventual loser outcomes observed. Synchronous reentrant disposal is checked after return, including runtime/binding/candidate/ledger/generated-path reads. Controller acknowledgement and atomic rename remain truth even if later callbacks throw or invalidate. Unknown exceptions, filesystem JSON exceptions, warnings and native diagnostic strings never become UI text. Notification callback synchronous throws **and asynchronous rejections** are contained.

## Public commands and grammar

Registered names are exactly `/jev-subagent-router`, `/jev-subagent-route`, and tool `jev_subagent_route`.

| Input | Behavior |
| --- | --- |
| `/jev-subagent-router` or `status` | Child configuration/mode, reported accounting and gaps, ordered chains including xpremium, cache/free preferences, kind specialist spans, availability, capability limits, validated known children and last retained decision. No classification. |
| `on` / `off` | CAS session-only enable change through invalidation service. No parent/default setter or manual write. |
| `mode auto\|confirm\|notify` | CAS session-only mode change; accepted controller/launch mode semantics remain in existing modules. |
| `budget` | Current status, no mutation. |
| `budget daily\|monthly USD` | Exactly two arguments; finite nonnegative decimal/exponent literal, including `0`. No negative, NaN/Infinity, hex, partial `1junk`, or extra arguments. Existing pressure math treats nonpositive caps as inactive, not as a blocking hard allowance. |
| `why` | **Task13 upstream correction:** rerun the existing engine on the most recent classifier-eligible immediate native child launch task, cold, without control/execution. Show fresh complete projected judgment/trace and truncation. No arbitrary recommendation/apply or parent fallback; both-explicit/resume/schedule/nested calls do not replace the task. Off is inactive; missing/reloaded task is stated honestly. |
| `suggest` | Existing `loadScores`/`suggestRoutes` preview JSON, counts and unmatched-scope count. No write, extra online calls or classification. Missing/malformed score files report static `scores-unavailable`, not the raw path/JSON exception. |
| `suggest --write` | Same ranking with real locked child-generated transaction and configuration refresh; see below. |
| `apply CHILD_ID -- TASK_TEXT` | Classify exactly the text after `--`, with actual child context/pricing, then delegate explicit control. The delimiter removes ambiguous extra-argument handling and preserves task whitespace. **The text is not submitted to the child.** |
| `apply CHILD_ID` | Use only this current binding’s bounded remembered task. Missing/evicted task returns usage. Never reuse a standalone recommendation or parent prompt. |
| `revert CHILD_ID` | Delegate exact historical pair restoration to the existing controller; no reclassification or native execution. |
| `/jev-subagent-route TASK_TEXT` | Recommendation only, exactly specified text. Empty text is usage; no “last prompt” fallback and no parent history. |

IDs are bounded ASCII native-style tokens (`[A-Za-z0-9][A-Za-z0-9._:-]*`, at most 256 characters), excluding reserved prototype names. Missing/invalid/unknown IDs return usage and do not classify/control. Unknown commands, mode casing/values and extra tokens leave state unchanged. Suggest/control/recommendation operations refuse while off/disposed; status/why and policy updates remain available while off. Successful changes explicitly say **session only — persist manually in pi-jev-subagent-router.json**.

Control uses existing engine/context and controller, not an alternate classifier/policy/launcher. Actual child model is matched to current scoped catalogue pricing; only that child's public context-token getter is read. No parent history is read, even for apply. Controller recomputes authoritative cache, mode, scope/auth, idle/receipt/revision checks. `CommandResult.control` returns the **exact controller object**, including published-runtime `unsupported`, busy, held, notify, keep, rejected, degraded, noop, committed and exact revert receipts. Native diagnostic strings remain confined to that programmatic receipt; plaintext and display entries contain sanitized reason codes and an optional projected acknowledged `after` pair. No success pair is fabricated from a proposal. Late invalidation cannot turn a known commit into a refusal/rollback claim.

The tool uses public TypeBox from the already declared host dependencies, schema `{request:string}` with `additionalProperties:false` and public `execute` signal linked to the command attempt. Native result is plaintext `content` with recommendation-only `details` (`kind:'recommendation'`, projected analysis/decision/static reason/degradation); failed classification is warning/skipped and `isError`, not a synthetic successful proposal. No native options, task text, parent configuration or raw error are in details. Evaluation identity captures current owner and public tool-call ID, not parent message history. Real-engine tests use fake fetch plus the real atomic usage consumer.

## Bounded context and rendering

Entry history: maximum 32 entries and 32,768 JSON UTF-16 characters in total. Task memo: maximum 16 binding-specific tasks and 16,384 task characters in total, at most 4,096 per task. Oldest entries/tasks are evicted first. Task memo keys include owner, routing generation, child ID, current correlation, SDK session ID, binding activity generation and weak SDK identity; no strong native session/options/config object is retained in the memo. Oversized cached tasks retain only the prefix and original character count; apply/why explicitly include a `cached task truncated` note. Explicit long task classification still uses the existing engine’s 8,000-character classifier bound and truncation metadata. Native prompt/options/results are never changed.

`invalidate`, `clear`, owner/generation detection and `dispose` clear both caches. Recommendation publication retains its actual captured attempt (local epoch, abort signal and runtime), not merely an owner/generation token: it revalidates after the evaluation await and carries that attempt through retention. Retention's runtime callback is followed by an epoch/signal fence, and publication is fenced again without another external runtime read. A normal-return callback that clears/disposes cannot repopulate history or produce stale recommendation success. Public `remember` remains unchanged. `rememberTask(binding, text, admission, originalChars = text.length)` adds only an optional numeric count for already bounded prefixes, preserving all existing three-argument callers. Counts must be nonnegative safe integers at least as large as the retained prefix; invalid metadata is refused before memory mutation. Neither padding nor original raw text is reconstructed. Both methods enforce captured owner/generation and refuse reentrant clear/disposal during the call. Those public admission tokens do not encode a prior same-generation clear: Task12 must still cancel/discard independently delayed external callbacks on lifecycle invalidation. There is no disk task/history reconstruction, and `/why` after reload reports no retained eligible child task. Task13 adds a separate one-task cold-launch memo (4,096 characters plus exact original count), cleared by the same invalidation fences. Binding reads never populate that global memo. Each why evaluation uses the existing durable counter consumer exactly once; failed classification is not a synthetic success. Earlier historical no-reclassification claims are superseded by the upstream correction.

Glyphs: proposed →, applied →, held =, notified •, skipped ×, preserved =. Compact cards show the action, tier/child, **proposed** target, **effective observed pair or unobserved**, reason and notes. Expansion adds raw kind probabilities/confidence, complexity and capability/deserved confidence, required-reasoning probability, demand/desired versus proposed tier, reported budget pressure, latency, Jev token-usage/truncation status and free/specialist/cache notes. Jev’s reasoning `noul` probability is its reported judgment; no independent reasoning-confidence field is invented. A proposed launch target is never advertised as actual/effective.

`registerRenderer` detects the optional public registration API before importing TUI. It lazily loads the public `Box`/`Text` primitives and uses active theme colors; primitives handle terminal layout. The optional typed loader seam tests absence without backend monkeypatching. Missing API/TUI/registration or malformed-card rendering degrades without runtime failure; command/tool plaintext and pure prepared text remain usable headlessly. Factory/owner-specific UI lifecycle, optional footer/status-bar placement and guarded public appendEntry are Task12 responsibilities, not timers/processes started by these helpers.

## Accounting display: reported money is not completeness

Examples: **Reported $0.0000 — pricing incomplete**, **Reported $0.200 — pricing incomplete**, or **Reported USD unavailable — pricing incomplete**. No observations, legacy buckets, explicit zero, unknown/unpriced mixed contributions and valid positive subtotals all remain incomplete. `normalizeLedger` rejects unsupported complete envelopes; the renderer has no fixture-only “complete” branch and shows no invented last-proven frontier.

Separate lines surface retained static incompleteness reasons, unknown component-model attribution, number of late observations and unknown historical activity time. An observed child settings pair is not model attribution for aggregate dollars. Request and reported input/output token counters are displayed separately from persisted unavailable-usage evaluations and legacy/untracked request usage. Missing usage/cost does not become estimated dollars, measured tokens, parent spend or a “free” label.

Caps, pressure and displayed remaining differences reuse **existing reported-spend math** and explicitly say “based on reported spend; advisory, not guaranteed remaining allowance”; concurrent children may overshoot. A configured free pool is a routing preference, not complete/free accounting evidence.

## Atomic generated suggestions

Only the validated child generated pathname is writable; never a manual child file, parent settings, scores file or ledger. Preview and no-match leave bytes untouched. Matching is exact provider/id in the current authenticated scoped candidate set, including an authoritative empty set. Ranking preserves existing custom scale/cutoffs, inclusive tier grouping, all quick/standard/high/premium chains, per-kind min-tier/descending priorities, price overrides/unknown-price ordering and provider spreading. Xpremium is never filled by ranking.

`withAtomicJson` acquires the existing cooperating-writer path lock and rereads latest JSON. Admission and generated-path identity are checked both before transaction and **inside the update callback after lock wait**. Existing root/routes/kindModels/target shapes, thinking pins, min tiers and finite priorities must validate; malformed JSON/schema never becomes an empty overwrite. The transaction merges the suggested per-tier/per-kind chains into the latest generated dictionaries, preserving unrelated latest generated keys/chains and concurrent counters. A retained generated xpremium field is preserved as data but remains ignored by existing `loadConfiguration`; xpremium must be set in a manual layer. This is a scoped atomic adaptation of upstream’s generated-layer writer, not a change to core ranking or layer precedence.

Rename is the commit point. Only after committed rename does `reloadGenerated(expected)` run, and manual config layers still win per tier/kind. Late cancellation, postcommit runtime-read failure or reload rejection returns `written:true` with committed/refresh-deferred/refresh-failed wording; no fake rollback or second unsafe whole-state save occurs. Lock/temporary durability and no-stealing limitations remain the existing [accounting/atomic contract](accounting-contracts.md).

## Complete supported example and alternatives

`examples/pi-jev-subagent-router.example.json` contains every supported `JevRouterConfig` key, all default ordered model/specialist chains and thinking pins, all ten default taxonomy descriptions/floors, disabled xpremium, upstream sample caps/free models, custom `data`/`infra` taxonomy/floor and specialist priority, full cache/ranking/deadline controls and child resource names. `apiKey` is an **empty sentinel, not a literal credential**; the configured environment variable supplies authentication. Do not put real keys in the example/config. The example’s state path is project-relative; deployment should choose the intended canonical child ledger resource. Public `getAgentDir()` determines actual user/generated resources; no personal path is hard-coded by the command writer.

Primary environment names are `JEV_SUBAGENT_ROUTER_MODE` and `JEV_SUBAGENT_ROUTER_OFF`; accepted core compatibility also reads `JEV_ROUTER_MODE/OFF`, with valid child overrides taking precedence. Credentials/endpoint retain `TYPESAFE_API_KEY` / `TYPESAFE_API_URL` by default. Deadline is `timeoutMs`; existing client retry policy is up to three attempts for transient transport/429/529 within that deadline. There is **no unsupported configurable retry or global default-thinking key**. Thinking pins include `off`; absent pins leave child/native defaults (or retained child's existing thinking) to accepted launch/controller logic, never rewrite parent defaults.

The upstream README offers mutually alternative samples; they are not all enabled at once in the safe main example. Valid manual-layer alternatives:

```json
{"useDefaultModels":false,"routes":{"quick":[{"provider":"openrouter","model":"~z-ai/glm-flash-latest","thinkingLevel":"off"}],"high":[{"provider":"anthropic","model":"claude-sonnet-4-5","thinkingLevel":"medium"}]},"kindModels":{"implement":[{"provider":"openrouter","model":"moonshotai/kimi-k2.7-code","minTier":"standard"}]}}
```

```json
{"routes":{"xpremium":[{"provider":"openrouter","model":"~openai/gpt-astra-latest","thinkingLevel":"high"}]},"free":{"enabled":true,"policy":"fallback-only","pool":[{"provider":"opencode-go","model":"space-bunny-free","thinkingLevel":"medium"}]}}
```

The normal layer order remains defaults → generated routes/kinds (not generated xpremium) → manual user → explicitly trusted project → valid environment overrides. Hand-edited empty chains clear a tier/kind. The example regression compares every supported key/nested key, primitive defaults, all default chains/taxonomies/floors and sample overrides, then calls actual `loadConfiguration` in a private sandbox, rather than testing JSON parse alone.

## Evidence and remaining integration

All runtime/testing/typechecking/import execution used only clean-environment `verify-sandbox.sh`, read-only workspace, private HOME/tmp and blocked networking. No install, paid provider, personal file, commit or vendor/package/patch modification occurred. Fake fetch is the only classifier transport in new tests. Full owned files were read after implementation.

Behavioral RED logs (before the corresponding fixes):

| Evidence | Observed result |
| --- | --- |
| `/tmp/jev-sandbox-evidence-uYtyuh/red.log` | Initial absent command/status modules: 0 pass, 2 import errors; not a behavioral assertion RED. |
| `/tmp/jev-sandbox-evidence-sIA2Vu/red-truth-display.log` | 105 pass, 2 assertion failures: post-controller acknowledgement lost on callback throw; registered renderer omitted observed pair. |
| `/tmp/jev-sandbox-evidence-IxC0P5/red-admission-resource.log` | 85 pass, 6 failures: stale task admission, three wrong-resource writes and two retention API transition assertions. |
| `/tmp/jev-sandbox-evidence-4Qr4Ef/red-cache-notify.log` | 114 pass, 2 failures: cached truncation invisible; async notification rejection escaped. |
| `/tmp/jev-sandbox-evidence-njSzmM/red-status-last.log` | 97 pass, 1 assertion failure: missing last retained decision in status. |
| `/tmp/jev-sandbox-evidence-kh4Ij8/red-generated-shape.log` | 121 pass, 3 assertions: invalid generated thinking/minTier/priority overwrote existing bytes. |
| `/tmp/jev-sandbox-evidence-6Vg4h6/red-failure-acquisition.log` | 103 pass, 4 assertions: failed recommendations looked proposed/successful; acquisition-time invalidation left an unsubscribed active instance. |
| `/tmp/jev-sandbox-evidence-KBdMWW/red-example.log` | 1 pass, 1 assertion: explicit supported credential override key absent; fixed with empty sentinel, no secret. |
| `/tmp/jev-sandbox-evidence-DNTiyK/red-tool-schema.log` | 106 pass, 1 assertion: missing strict extra-property rejection in the public recommendation schema. |
| `/tmp/jev-sandbox-evidence-JUysIP/red-raw-numbers.log` | 21 pass, 1 assertion: malformed numeric judgment was fabricated as zero; now refused/unavailable. |

The first comprehensive gate `/tmp/jev-sandbox-evidence-fuVhJv/green-typecheck.log` exposed only a new test fake-fetch cast missing Bun's `preconnect` shape. The test shim was aligned with existing typed fake-fetch patterns (`unknown` bridge); no production type or runtime API was weakened.

Final rerun after **all source/test/example changes**: `/tmp/jev-sandbox-evidence-bHCpjH`.

| Gate log in that directory | Result |
| --- | --- |
| `green-commands.log` | **107 pass, 0 fail, 513 assertions**, two files. |
| `green-ui.log` | **22 pass, 0 fail, 81 assertions**, one file. |
| `green-test.log` | **785 pass, 0 fail, 3,796 assertions**, 27 explicitly discovered files; 129 new command/UI/example tests included, native suites excluded. |
| `green-reference.log` | **140 pass, 0 fail**, across the six separately isolated upstream files (31+13+52+12+20+12); unchanged. |
| `green-typecheck.log` | Exit **0**, no diagnostics. |
| `green-baseline.log` | **18 byte-identical vendor files**, upstream 0.6.0 commit `f1a6f0381ef10899319542525f4d53c76c368396`. |
| `green-isolation.log` | **20 tests, OK**, unchanged sandbox checks. |

Final native preservation: `/tmp/jev-sandbox-evidence-VmNz6g/green-native.log` — **5 pass, 0 fail, 546 assertions**, four explicit published/patched native files, using the approved `JEV_SANDBOX_NATIVE=1` wrapper. No source, test or example changed after these final gates; only this handoff documentation was updated.

Each evidence directory also has `process-tree.strace`. The final gates used:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh -c 'for mode in commands ui test reference typecheck baseline isolation; do /bin/sh /workspace/scripts/isolated.sh "$mode" > "/evidence/green-$mode.log" 2>&1; code=$?; printf "%s exit %s\\n" "$mode" "$code"; [ "$code" = 0 ] || exit "$code"; done'
```

Native preservation used the same clean wrapper with `JEV_SANDBOX_NATIVE=1`, `isolated.sh native-gates` plus explicitly named `test/integration/child-observer.test.ts` and `test/integration/child-control.test.ts`. No bare ambient Bun/Node/tsc execution or direct-import shortcut was used.

### Scoped follow-up: Task11 finding `001fea65`

Only `src/commands.ts`, `test/commands/commands.test.ts`, and this contract were changed for this finding. `route()` now checks the full captured attempt after `await evaluate()`; recommendation retention also checks that original epoch/signal/runtime, reports refusal rather than silently treating failed retention as success, and uses a callback-free final publication fence. Public retention keeps its existing API and gains explicit local-epoch fences before memory mutation. No raw task/error persistence, controller receipt semantics, policy/UI redesign or Task12 API expansion was introduced.

Fifteen deterministic tests use public service callbacks and microtask scheduling, not private runtime/backend replacement: five final-evaluation-check/route-continuation gaps (clear/invalidate with unchanged owner/generation, runtime off, generation change, dispose), four public retention reentrancy controls, four normal-return publication/retention callback invalidations, and command/tool output checks. Existing valid recommendations and bounded-history/cache tests remain in the gates.

| Follow-up evidence | Observed result |
| --- | --- |
| `/tmp/jev-sandbox-evidence-78jEDA/red-publication.log` | **109 pass, 11 fail**, one focused file before production changes. Five gaps and both registered surfaces returned stale success; callback cases exposed missing publication/retention fences (the read-3 cases also witnessed that the old path had no intervening publication check). Public retention reentrancy controls already passed. |
| `/tmp/jev-sandbox-evidence-8m7AJT/green-publication.log` | **120 pass, 0 fail, 554 assertions**, focused file after the fix. |
| `/tmp/jev-sandbox-evidence-BBiP1t/green-typecheck.log` | Initial comprehensive gate caught a test-only generic tool capture cast; corrected with an explicit `unknown` bridge, no production API weakening. |
| `/tmp/jev-sandbox-evidence-chvb41/green-commands.log` | **122 pass, 0 fail, 619 assertions**, two files. |
| `/tmp/jev-sandbox-evidence-chvb41/green-ui.log` | **22 pass, 0 fail, 81 assertions**, one file. |
| `/tmp/jev-sandbox-evidence-chvb41/green-test.log` | **800 pass, 0 fail, 3,902 assertions**, 27 explicitly discovered files. |
| `/tmp/jev-sandbox-evidence-chvb41/green-reference.log` | **140 pass, 0 fail**, six separately isolated upstream suites. |
| `/tmp/jev-sandbox-evidence-chvb41/green-typecheck.log` | Exit **0**, no diagnostics. |
| `/tmp/jev-sandbox-evidence-chvb41/green-baseline.log` | **18 byte-identical vendor files**, unchanged upstream revision. |
| `/tmp/jev-sandbox-evidence-chvb41/green-isolation.log` | **20 tests, OK**. |

All follow-up execution used the same approved clean-environment sandbox wrapper and Python bootstrap; evidence directories include `process-tree.strace`. The focused run used `isolated-runtime.py --bun /opt/bun test /workspace/test/commands/commands.test.ts`; the final gate used the commands/ui/test/reference/typecheck/baseline/isolation loop above. Native gates were not rerun for this narrow follow-up; earlier native evidence is preservation evidence only, not newly wired command integration. All prior dirty work remains uncommitted. This addresses only the finding family, not Task11 acceptance; parent verification and Astra review remain required.

Task12 finding `1da9be26` subsequently adds only the optional `rememberTask` original-count argument documented above; all bounds and existing callers remain unchanged. Extension-level regressions prove full-length metadata survives actual native correlation and repeated `getBinding` calls without retaining/classifying the missing suffix. Fresh command verification is `/tmp/jev-sandbox-evidence-1fEAL0/final-commands.log` (122 pass, 0 fail, 619 assertions); the complete source/pack/native evidence and narrow scope are recorded in [extension-contracts.md](extension-contracts.md#scoped-follow-up-task12-findings-1da9be26). No Task12 acceptance is implied.

### Task13 narrow WHY follow-up: Astra finding `a977136f`

The full native admission boundary (`eligible` in `src/routing/intercept.ts`, called by the unchanged production coordinator before `rememberEligibleTask`) validates the original task, not its bounded prefix. A valid task consisting of 4,096 leading spaces plus `actualnewtask` previously left the old eligible task remembered because `rememberEligibleTask` rejected the blank prefix. WHY then silently reclassified the previous launch.

The scoped correction in `src/commands.ts` accepts a blank **exactly 4,096-character** prefix only when its safe original count is strictly larger than that prefix. It preserves the new original agent/count and reclassifies precisely the retained blank prefix, honestly labeling truncation; no suffix is searched for, retained, reconstructed, padded or fabricated. Empty/blank whole tasks and empty/short prefixes with invented larger counts remain refused. Existing safe-count/agent bounds and owner/generation/off/reload/epoch fences remain unchanged. This trusted memory helper does not admit native calls: original full-input eligibility stays at the native boundary.

RED: `/tmp/jev-sandbox-evidence-fWgZ8M/red-why-prefix.log` — **133 pass, 1 fail**, 661 assertions; the two-launch regression actually received `old-agent` / `valid old task` instead of the new bounded task. Source fix followed that assertion failure. Commands now pass **134/134**, including invalid whole-task controls and exact original-length/agent/no-suffix checks. Source/native final evidence is in [feature-parity.md](feature-parity.md).

`test/integration/parity-native.test.ts` adds a separate real default-entry/native-provider two-launch witness: WHY first proves the old task exists; without rebinding or resetting the coordinator, the leading-space new launch replaces it. WHY then sends `Agent: omitted\nTask:\n` plus exactly 4,096 spaces, reports the exact original count/truncation, and makes no child call. This native follow-up passed green-first after the correction; it is **not** falsely labeled red-first. An intermediate test rebind mistakenly emitted a fresh `session_start` before WHY; its honest failure at `/tmp/jev-sandbox-evidence-uRQcUw/final-native.log` was corrected by preserving the public binding across the two admissions, not by changing source or weakening assertions.

This is a narrow finding-family correction and local evidence handoff, **not acceptance or completed independent review**. Parent reruns and Astra re-review of the changed command method/tests remain required. No coordinator, core policy, installed package, vendor or public-control patch was changed for this fix.

Task12 still owns production factory registration; public owner/lifecycle wiring; native tool correlation and restoration; centralized session-policy CAS/cancellation and controller replacement; fresh registry scope/auth projection; generated reloader CAS/session overrides; guarded appendEntry and optional UI placement. New command/UI tests are supplemental unit/service tests, including real core engine/fake fetch, AccountingStore, loadConfiguration and atomic transactions. Existing five native tests exercise the unchanged accepted public pipeline/observer/controller, **not** a newly wired Task11 entry. Published retained-child mutation remains unsupported without reviewed atomic capability. No complete pricing, evicted-child recovery, ownership transfer or native factory integration is claimed. Parent reruns and fresh Astra specification/quality review remain required.
