# Upstream feature-parity inventory

Status: Accepted full-parity requirements inventory and source evidence. The replacement hybrid design is in `2026-10-02-jev-subagent-routing-design.md`; implementation parity evidence is pending.

The user now requires full feature parity with `pi-jev-model-router`. This supersedes the reduced-feature exclusions in `2026-10-02-jev-subagent-routing-design.md`. Preserve Tintin-only support, ordinary `Agent` interception, explicit-setting precedence, and an unchanged parent model unless the user approves a different integration model to resolve a parity constraint.

## Source baseline

- Repository: https://github.com/da-vinci-noob/pi-jev-model-router
- Inspected source: `f1a6f0381ef10899319542525f4d53c76c368396`, package version 0.6.0.
- Gallery: https://pi.dev/packages/pi-jev-model-router
- Source modules: `extensions/pi-jev-model-router/{config,jev,router,budget,ranking,index}.ts`.
- Upstream tests: `test/{config,jev,router,budget,ranking,extension}.test.ts`.

Recommended development basis: adapt this pinned source and retain its license/attribution and test suite, adding Tintin-specific integration rather than independently rewriting the policy. This is a recommendation, not evidence that code has been imported. No GitHub fork has been created. The existing repository origin remains unchanged.

## Required parity checklist

| Feature | Source/reference | Required subagent outcome |
| --- | --- | --- |
| Typed Jev judgments | `jev.ts` | Preserve task kind, complexity, capability deserved, deep-reasoning probability, confidence, and transport usage. |
| Task taxonomy/custom kinds | `config.ts` | Preserve all ten built-in kinds and description-based custom kinds. |
| Exact demand composition | `router.ts:decide` | Preserve `0.55 * complexity + 0.45 * capability`; reasoning >= 0.65 adds 0.75, <= 0.2 subtracts 0.25; clamp 0..3 and preserve round-to-tier behavior. |
| Kind floors/confidence guards | `router.ts:decide` | Preserve per-kind floors and confidence fallback semantics; test against upstream fixtures. |
| Capability tiers | `config.ts`, `router.ts` | Preserve quick/standard/high/premium and opt-in xpremium eligibility, not just four tiers. |
| Candidate fallback | `router.ts:firstAvailable`, `decide` | Preserve ordered candidates and nearest-tier fallback, while preventing an automatic recommendation from violating Tintin model scope. |
| Task specialists | `kindCandidates` | Preserve minTier gating, descending priority, and highest eligible minTier ordering. |
| Thinking defaults | Route targets and native application | Preserve pinned thinkingLevel and model normalization, without overwriting explicit caller or agent-definition values. |
| Provider independence/default chains | `config.ts` | Preserve mixed-provider routing, current default chains, and useDefaultModels=false behavior. |
| Free pools | `config.ts`, `router.ts` | Preserve enabled/prefer/fallback-only, exact pool matching, and free-pool decision notes. |
| Spend ledger | `budget.ts`, native event integration | Track attributable child cost without substituting parent cost or claiming unobserved child spend is zero. Deduplicate repeated cumulative observations. |
| Daily/monthly budget policy | `budget.ts`, `router.ts` | Preserve UTC buckets, pressure calculation, soft downgrade, hard cap, and architectural-task exception. |
| Jev counters | `budget.ts`, `index.ts` | Preserve request/token counters supported by upstream bookkeeping. |
| Cache penalty estimation | `estimateCachePenaltyUsd` | Preserve pricing formula, unknown-price behavior, and true child-context scope; never price the unrelated parent transcript as a warm child cache. |
| Cache deadband/bypass | `router.ts:decide` | Preserve deadband, same-tier swap gating, big-upgrade bypass, and held decision explanations when applicable to a real child context. |
| Stickiness | `index.ts:applyDecision` | Preserve same-model behavior against the appropriate child baseline, not the parent or an unrelated child. |
| Auto/confirm/notify modes | `index.ts:applyDecision` | Preserve apply/ask/recommend-only behavior and documented noninteractive degradation, acting on child defaults only. |
| Status/on/off | `index.ts` commands | Preserve status, enabled toggles, route availability display, and budget pressure visibility. Use a noncolliding command namespace. |
| Budget commands | `index.ts` commands | Preserve daily/monthly session-local policy changes. |
| Why | `index.ts` commands | Reclassify the last eligible child task and show complete analysis/trace without launching another child. |
| Revert | `index.ts` commands | Needs an explicitly approved child-scoped equivalent. Reverting a parent model or merely changing future defaults is not automatically equivalent to reverting an already-running child. |
| Arbitrary-text recommendation | `/jev-route`, `jev_route` | Preserve command and callable recommendation tool without launching or modifying parent models. |
| Ranking | `ranking.ts` | Preserve score cutoffs, kind scores, effective cost overrides, unknown costs, and provider spreading. |
| Suggest/write | `index.ts`, `config.ts` | Preserve printed/generated routes and specialists, no-match protection, and manual-config precedence. |
| Layered configuration | `config.ts` | Preserve defaults/generated/user/trusted-project/environment ordering, empty-list clearing rules, environment endpoint override, and API-key configuration capability with secret-safe handling. |
| Transcript entries | `index.ts` renderer | Preserve durable non-context decision cards, expandable raw analysis, action glyphs, and visible skipped/held decisions; label proposals versus effective child settings honestly. |
| UI and host degradation | `index.ts` | Preserve optional renderer/TUI, status, notifications, unavailable API handling, and noninteractive operation. |
| Failure behavior | `jev.ts`, `index.ts` | Preserve bounded timeout/retry behavior and fail-open routing; cancellation remains cancellation. |
| Short tasks/history | `index.ts` | Define a task-local equivalent to minPromptChars/historyTurns. Do not skip a new short child task just because its parent has conversation history. |
| Licensing/distribution | package manifest, LICENSE | Preserve upstream notices; ship a Pi package with host-provided peer dependencies and explicit entry point. |

## Verified integration constraints

The independent reviewer checked the inspected public Pi/Tintin code and confirmed:

1. Pi passes mutable `event.input` into native tool execution.
2. Tintin's native model and thinking fields independently use definition-first precedence.
3. Public ping replies use `subagents:rpc:ping:reply:<requestId>` with `{ success: true, data: { version: 2 } }`.
4. Project trust is available through `ctx.isProjectTrusted()`.

The same review identified required corrections:

- Authenticated-but-out-of-scope automatic candidates can fail a call that would otherwise launch successfully. Scope-aware filtering is required; normal backend validation is not itself fail-open behavior.
- The hook exposes a session-operation signal, not exact independent per-call host signals. Use independent classifier controllers without claiming stronger cancellation fidelity.
- Final mutation must check enabled state and a session/config generation token, including off/on and reload races.
- Match native truthy resume/schedule semantics for valid empty-string placeholders; distinguish those from model/thinking omission rules.

## Design decisions still requiring evidence

Launch-only interception operates before a child exists. Do not silently classify existing-child cache switching, real child spend accounting, or revert as implemented because their upstream pure functions were copied. Verify the public Tintin lifecycle/record APIs and state the integration needed for each behavior.

The API investigation is complete and found:

- Tintin top-level completed/failed lifecycle events report cumulative usage, including cost. Usage may be absent; missing observations are not proof of zero spend.
- Its documented `globalThis[Symbol.for("pi-subagents:manager")]` registry exposes `getRecord(id)` for top-level records. Records include cumulative lifetime usage and an optional public SDK `AgentSession`.
- Track per-record accounted totals and charge only positive increments. Resume observations are cumulative. Ancestor totals can include descendant usage, so separately charging nested records would double-count.
- Created/started/terminal events are not a universal nested/workflow discovery mechanism. Spawn invocation snapshots are not reliable live model readings.
- Installed Pi 1.0.0 SDK declarations expose `session.model`, `session.thinkingLevel`, `session.isStreaming`, `session.subscribe()`, `session.getContextUsage()`, `session.setModel()`, and `session.setThinkingLevel()`. Source confirms setModel validates auth and records the change; this alone does not establish safe active-stream switching or Tintin policy enforcement.
- Launch-only input mutation cannot faithfully revert an admitted child's model or price a real same-child warm-cache switch. Child-session observation/control is an additional integration layer, not a feature provided by the launch hook.
- Observed-spend budget pressure can govern subsequent launches, but outstanding concurrent spend can overshoot soft caps, as can upstream advisory budgets. Do not advertise hard live dollar caps.

The user approved hybrid integration: automatic classification stays launch-only, while explicit child-scoped controls and observation support cache/revert/accounting semantics. The replacement specification defines cold-child cache and actual-switch-only revert adaptations. Public ownership, scope, retained-session, and safe idle-mutation contracts still require executable compatibility gates; do not claim unsupported model switching.

## Parity validation strategy

Retain upstream policy/config/ranking/budget tests and run differential fixtures against the pinned baseline. Add tests for scope filtering, concurrent child accounting, explicit field precedence, mode behavior, skipped tasks, stale generations, cancellation, user/project configuration trust, command collisions, and accurate action labels. Live paid smoke tests are opt-in; mocked tests alone are not proof of full end-to-end compatibility.

Every row above must have either passing acceptance evidence or a user-approved documented semantic adaptation before claiming full feature parity. Merely listing an unsupported feature or exposing a no-op configuration key does not satisfy parity.
