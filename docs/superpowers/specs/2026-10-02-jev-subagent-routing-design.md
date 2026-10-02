# Jev subagent model router — full-parity design

Date: 2026-10-02
Status: Written full-parity/hybrid design approved by the user's instruction to continue. Implementation compatibility claims remain gated on the tests below.

## Goal and source baseline

Adapt `da-vinci-noob/pi-jev-model-router` so ordinary Tintin `Agent` calls receive task-specific model/thinking defaults without changing the parent's model. Retain every upstream feature family rather than shipping a reduced rewrite.

Baseline: upstream version 0.6.0, commit `f1a6f0381ef10899319542525f4d53c76c368396`. Adapt its classifier, deterministic policy, defaults/configuration, budget ledger, ranking, command behaviors, renderer, and tests. Preserve MIT notices. Reuse source in this repository; creating a remote GitHub fork is optional and has not occurred. Do not change the existing origin or overwrite existing documentation/history.

Supported backend: **`@tintinweb/pi-subagents` only**, initially published version 0.19.0 at git head `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`. The unscoped `pi-subagents` package is not supported.

The parity inventory in `2026-10-02-upstream-feature-parity-inventory.md` is the acceptance checklist. Every row requires tests and either equivalent behavior or the explicit child-scoped adaptation defined here. Copied but unreachable functions, no-op controls, or unobserved zero-cost assumptions do not satisfy parity.

## Approved operating model

- Automatic Jev classification happens at eligible new-task launches, not every turn of a running child.
- Intercept ordinary native Tintin `Agent` calls through Pi's public `tool_call` hook. No wrapper tool or special invocation is required.
- Preserve explicit caller fields independently; Tintin preserves definition-first model/thinking precedence.
- Observe publicly exposed top-level child sessions for usage/context and support explicit, safe child-scoped controls.
- Never change the parent model/thinking, replace Tintin's native tool, inject a second launch, monkey-patch the backend, or import its private modules.
- Internal workflows, mentions, schedules, nested launches, RPC launches, and child runtimes without this extension are not guaranteed automatic coverage.
- The extension requires Tintin loaded. If missing, warn with `pi install npm:@tintinweb/pi-subagents` and reload guidance, without installing it or interfering with unrelated tools.

## Full upstream policy parity

Preserve the pinned upstream `decide()` behavior and verify it with upstream/differential fixtures:

1. Four typed Jev judgments: task kind, complexity, capability deserved, and deep-reasoning probability, with confidence/usage.
2. Demand `0.55 * complexity + 0.45 * capability`; reasoning >= 0.65 adds 0.75, <= 0.2 subtracts 0.25; clamp 0..3 and round into capability tiers.
3. Per-kind floors, confidence fallback, budget guards, availability fallback, and cache guards in upstream order.
4. Quick/standard/high/premium and opt-in xpremium, including promotion eligibility and restricted fallback.
5. Specialist minTier gates, descending priority, and highest eligible minTier ordering.
6. Built-in mixed-provider model chains, exact configured thinkingLevel pins, useDefaultModels=false, empty-chain behavior, and nearest-tier fallback.
7. Free pools with enabled/prefer/fallback-only semantics and exact provider/model matching.
8. Score-file ranking, tier cutoffs, per-kind scores, effective cost overrides, unknown-price ordering, and provider spreading.
9. Full config schema, generated configuration, environment overrides, modes, skip explanations, and optional-host degradation.

Integration safety checks may narrow available candidates but must not silently change demand math. Record any deliberate bug/safety corrections separately and add regression tests. In particular, do not permit an automatic candidate to resolve to the same model ID under an unintended provider merely to find authentication or evade scope.

## Architecture

### 1. Upstream-derived routing core

Keep classifier, policy, configuration, budget, and ranking as independently testable modules. Their inputs contain task analysis, authenticated/permitted candidates, a spend snapshot, and an optional real child context/model baseline. They do not mutate any Pi session or launch children.

The classifier uses upstream endpoint/model, total timeout and bounded retries, configurable API key/environment, taxonomy, history limits, and structured response contract. Validate malformed/nonfinite/out-of-range responses rather than letting them produce unsafe defaults. Errors warn and leave native execution intact. Credentials never appear in entries, exceptions, or debug output. Keep custom endpoint support, but do not follow redirects that could leak authorization to a different host.

### 2. Tintin detection and normal launch interception

Require Tintin's correlated `subagents:rpc:ping` reply `{ success: true, data: { version: 2 } }` and the expected registered `Agent` schema. Subscribe before emitting discovery requests. Refresh unavailable detection after load-order changes and on eligible calls. Owner/schema checks are compatibility safeguards, not authentication against malicious extensions.

For a valid new immediate task, snapshot `prompt`, `subagent_type`, caller fields, routing mode, and session/config generation. Skip actual resume/schedule operations according to Tintin's truthy semantics: empty-string placeholders are ordinary new-task calls, while nonempty resume/schedule values are skipped. Do not repair invalid native inputs.

Classify once when at least one caller model/thinking field is omitted. Omission uses `undefined`, not truthiness: `thinking: "off"` remains explicit. Preserve foreground/background mode, prompt, description, tools, isolation, and context inheritance. Treat a new short child task as a first task, not a parent-conversation continuation. Do not use unrelated parent history for classification. A bounded recent child-routing history can be supplied only for an explicitly correlated continuing child operation.

Compute defaults locally, apply mode behavior, then check the captured session-operation signal, per-request controller, enabled state, mode/config generation, session identity, and field omission again. Mutate only still-omitted `event.input.model` and/or `event.input.thinking` in place. Pi executes Tintin's original tool once after the hook returns. Do not call `ctx.executeTool("Agent", ...)` or RPC spawn from inside the hook.

Tintin independently resolves `agentConfig?.model ?? params.model` and `agentConfig?.thinking ?? params.thinking`; recommendations cannot override definitions. Audit injected values as proposed defaults, not confirmed effective settings. Both explicit fields skip Jev entirely. One explicit field remains untouched while the other can receive a recommendation.

### 3. Scope-aware candidate filtering

Filter automatic candidates before passing them to native `Agent`: authentication alone is insufficient because Tintin hard-rejects caller-supplied out-of-scope models.

For the pinned backend, its scope is based on exact, case-insensitive provider/model entries in Pi global/project `enabledModels`, with project replacing global. Its resolver ignores unmatched patterns and becomes unrestricted when no entries resolve. Use host settings/agent-directory APIs and documented settings files, not private backend imports. Respect project trust. Conservatively constrain automatic selections to a resolvable operator allowlist; do not depend on an inaccessible in-memory scope toggle to permit a broader automatic selection. Record this conservative safety adaptation when applicable.

If scope cannot be established safely, omit the automatic model field rather than risk preventing an otherwise valid inherited-model launch. Never modify explicit caller/definition settings or weaken native validation. Child-scoped explicit changes must also validate applicable scope and child authorization before using SDK setters; the SDK's auth check alone is not sufficient.

### 4. Child-session observer/controller

Use Tintin's documented `globalThis[Symbol.for("pi-subagents:manager")]` registry and public `getRecord(id)` to access top-level records, including `session`, `toolCallId`, ownership, status, and cumulative lifetime usage. Do not mutate records or rely on invocation model snapshots as live state.

Correlate native tool-call IDs with child records through public lifecycle events and record fields. Do not invent identities from descriptions. Subscribe to the exposed public Pi `AgentSession` when available. Observe `model`, `thinkingLevel`, `isStreaming`, messages/events, and `getContextUsage()`. Rebind when a revived record exposes a replacement session; a record ID alone does not identify one immutable execution/session instance.

Track subscriptions by exact owner session, child ID, and SDK session instance. Top-level lifecycle events are not universal nested/workflow discovery. A started event can precede SDK-session readiness: attempt attachment again at correlated native tool updates/results and terminal lifecycle events, and reconcile cumulative usage rather than assuming startup attachment succeeded. If a session is absent, mark observation unavailable and keep native execution untouched. Restore bookkeeping idempotently on reload when records remain accessible; persisted totals prevent replay charges.

Automatic routing remains launch-only. Explicit commands may recommend/apply a different model to an existing child at a verified idle boundary. Use public SDK `setModel()` / `setThinkingLevel()` with no global-default persistence only after auth, scope, ownership, generation, and idle checks. Never interrupt an active stream to make a model change, queue an unbounded operation, or switch another session by mistake. If a safe change cannot be made now, report it and do not apply it.

### 5. Accurate spend and budget policy

Retain upstream UTC daily/calendar-month buckets, Jev counters, pressure calculation, soft downgrade, hard downgrade, and architectural-task exception. Caps are advisory routing policy, not hard live dollar limits.

Observe cumulative child usage from terminal events and public records, supplemented by SDK message subscriptions where supported. Account only positive deltas against persisted per-owner/per-record totals; reconcile subscription and terminal observations rather than charging both. Resume uses cumulative totals. Ancestor records can aggregate descendants: do not also add nested record costs to that same ledger.

Do not count ordinary parent model usage as child spend. Never call an unobserved child free: show unknown/incomplete attribution and last-observed state. Zero usage and unavailable usage are distinct. Use supported message timestamps where available for day/month attribution; late aggregate-only deltas are recorded at observation time and visibly labeled as late reconciliation, not falsely precise historical spend.

Serialize ledger read-modify-write and use atomic replacement so parallel calls/sessions do not lose deltas. Persist an accounting identity independent from the current transient extension runtime. Concurrent outstanding spend can exceed soft policy before observation; status must state this limitation. No reservations or hard dollar enforcement are claimed.

### 6. Real-child cache behavior, stickiness, and revert

Preserve upstream cache-price calculation, deadband, big-upgrade bypass, same-tier gating, and held explanations. Evaluate only against the targeted child's observed current model and context. Never treat the parent or last unrelated child as a warm cache baseline.

For a fresh child at launch there is no existing warm child cache/model switch to protect; use the upstream no-current-context path. This is a cold-context case, not a fake estimate or removed cache feature. Use real observed context for explicit child-scoped apply/recommendation operations. Unknown pricing retains upstream nonblocking behavior and is labeled appropriately.

Maintain actual per-child prior model/thinking snapshots immediately before successful controller-mediated switches. `/revert` restores that child's prior snapshot at a safe idle boundary, with auth/scope validation. A proposal passed into initial native creation is not an observed model switch: if no actual prior snapshot exists, say so rather than guessing a parent/definition baseline. A completed record is an explicit-control target only if Tintin still retains its live SDK session; these commands change the configuration for a later native resume and do not themselves resume it. Disposed sessions and streaming children cannot be controlled.

An explicit apply command is necessary to exercise real-child cache behavior without adding automatic mid-run classification. It evaluates the requested task against the child's observed state, honors auto/confirm/notify modes, and switches only when allowed and idle. Revert and cache tests must exercise these actual controlled transitions, not merely pure copied functions.

## Commands, helper tool, and UI

Use child-specific names to coexist with the original parent router:

- `/jev-subagent-router`: availability, mode, tiers, specialists, configured free pool, spend/pressure/attribution, observed children, and last decision.
- `on` / `off`: session toggles; off cancels pending classifications and increments a generation token so off/on cannot revive stale decisions.
- `mode auto|confirm|notify`: same user-visible semantics as upstream, applied to missing child defaults or explicit child-scoped operations.
- `budget daily <usd>` / `budget monthly <usd>`: session-local cap changes.
- `why [child-id]`: re-evaluate the retained last task/decision for that target without launching or switching. Report when no bounded retained task exists after reload.
- `suggest` / `suggest --write`: rank supplied model scores, print proposed chains, optionally atomically write generated routes/kindModels before manual layers; preserve no-match protection.
- `apply <child-id> <task>`: explicit recommendation/application against the observed idle child, including cache guards. It never submits the task as a prompt or starts another agent.
- `revert <child-id>`: restore a verified prior model/thinking snapshot. Require explicit target identity for child mutation; no ambiguous last-child selection during parallel work.
- `/jev-subagent-route <text>` and `jev_subagent_route`: arbitrary-text recommendation without launching/changing a session.

Auto fills eligible fields; notify only records/shows the recommendation. Confirm offers permitted selected/cheaper/keep choices without changing explicit fields. Use upstream documented fallback to auto when interactive confirmation APIs are unavailable, and state that behavior in docs/status. Recheck mode/generation after any dialog.

Retain durable non-context cards, expandable analysis/trace, action glyphs, status and notifications, visible skips/fallback/held decisions, and optional lazy TUI rendering. Label launch decisions as proposed, child-controlled changes as applied/held, and explicit-setting skips as preserved. Native tool content/progress/results and completion notices remain unchanged. Decision records do not prove task completion.

## Configuration, persistence, and privacy

Preserve upstream configuration keys, default model chains, custom taxonomy/floors, free/ranking/budget/cache settings, key/endpoint environment support, generated/manual merge behavior, and trusted-project rules. Use separate `pi-jev-subagent-router` user/project/generated/state/scores filenames so the parent router and this package do not share mutable ledgers or overwrite each other's config.

Preserve existing upstream environment overrides as compatibility inputs; child-specific overrides take precedence where supplied. Document interactions when both routers are installed. Manual config remains authoritative over generated ranking. Explicit empty routes clear chains; scores cannot automatically fill xpremium. Invalid fields follow documented validation/degradation and never cause secret-bearing exceptions in a tool hook.

Support upstream apiKey configuration capability, but recommend environment credentials and never echo configured secrets. Retain only bounded last-task/history data in memory for why; durable decision entries omit raw task text and secrets. Bound analysis/context sent to Jev and tell users that task content is sent to the configured endpoint. Do not upload parent conversation by default. Endpoint redirects must not carry credentials across origins.

Restore branch-sensitive entries appropriately and isolate owner sessions. Reload/shutdown must cancel pending classifications, unsubscribe bus/session listeners, and invalidate controller generations. Observers/controllers perform no long-lived startup work in the extension factory; initialize in lifecycle callbacks.

## Failure, cancellation, and concurrency

Expected classifier/discovery/audit/notification failures are caught so normal native execution can proceed unchanged. Native validation failures are not retried. No alternative backend or second launcher is used.

The hook captures a session-operation signal; Pi does not expose exact independent per-call execution signals there. Give each classifier its own controller, but do not claim precise nested-call cancellation fidelity. Core execution retains its own signal and checks it after the hook. On cancellation or stale generations, apply no defaults. Do not interpret an aborted operation as a request to initiate native execution.

Per-call snapshots and tool-call correlation prevent concurrent decisions from sharing current-child state. Per-child idle/ownership checks prevent command races. Ledger mutations are serialized; dialogs and child model mutation are scoped to their exact target. Other extensions may later mutate inputs, so the router cannot claim precedence over arbitrary subsequent handlers.

## Acceptance and implementation gates

Retain/adapt upstream tests and differential fixtures for all features in the parity inventory. Add integration tests for:

- Real input mutation reaching Tintin native execution exactly once, foreground/background preserved.
- Independent definition-first/caller-first-to-Jev precedence and explicit thinking off.
- Authenticated but excluded candidate filtering under Tintin scopeModels, including no-permitted-candidate fail-open behavior.
- True/empty-string resume/schedule eligibility and short first child tasks.
- Mode/dialog outcomes, off/on races, config/session replacement, and session-operation cancellation limitations.
- Registry correlation, session-instance replacement, SDK subscriptions, actual effective model/context, and listener cleanup.
- Message/terminal duplicate usage, resumed cumulative totals, ancestry double-count prevention, UTC buckets, late attribution, concurrent atomic ledger writes, and unknown spend reporting.
- Real idle-child apply/cache hold/revert, missing prior snapshot, scope/auth rejection, no persistent global changes, and refusal while streaming.
- Config layering, generated writes, ranking/free/xpremium behavior, secret handling, and parent-router coexistence.
- UI degradation, preserved native progress/results, no parent switching, and honest uncovered internal paths.

Before claiming compatibility, test published Tintin code against a supported Pi host. Confirm SDK signatures, record/session readiness and ownership, scope adapters, streaming/idle safety, and cleanup on real foreground/background calls. Mocked tests alone do not establish these integration claims. Default tests use fake Jev/provider transports; live paid smoke tests require explicit operator opt-in.

If a required safe public child-session operation cannot be established, stop at that integration gate and report the specific missing contract; do not silently downgrade a required feature or use a private monkey-patch.

## Review findings incorporated

The review verified Pi input mutation, Tintin independent definition-first fields, protocol-v2 discovery, and public project-trust checks. Its four corrections are explicit here: scope filtering, honest session-signal semantics, final generation/enabled checks, and native-compatible empty resume/schedule placeholders.

Child API research verified cumulative lifecycle usage and the documented top-level registry/session reference. Installed Pi SDK exposes model/thinking/context/subscription/setter APIs; safe integration and backend restrictions remain test gates, not assumed from method existence.
