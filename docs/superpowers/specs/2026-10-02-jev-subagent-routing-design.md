# Jev subagent model router — v1 design

Date: 2026-10-02
Status: Approved design, revised to automatic interception of normal Tintin `Agent` calls following the user's confirmation.

## Goal

Build a distributable Pi extension inspired by `da-vinci-noob/pi-jev-model-router` that uses TypeSafe Jev to choose model and thinking defaults for each eligible subagent task at launch. Users continue invoking Tintin's ordinary `Agent` tool; no special routed tool or wording is required. Never route the parent session or implement a separate launcher.

Supported dependency: **`@tintinweb/pi-subagents` only**. The unscoped `pi-subagents` package (nicobailon) is not supported, as requested by the user.

Tintin must be loaded and expose a compatible native `Agent` tool. Installing the package without loading its extension is insufficient. If unavailable, warn with `pi install npm:@tintinweb/pi-subagents` and reload guidance; do not install anything automatically or interfere with unrelated tools.

## Approved decisions

- Automatically intercept eligible native `Agent` calls through Pi's public `tool_call` event.
- Launch-time routing only; never reassess or switch a running child.
- Preserve explicit caller and agent-definition model/thinking settings independently.
- Support ordinary foreground and background calls without changing their execution mode.
- No wrapper tool, standalone launcher, workflow rewriting, or spend-budget accounting in v1.
- Jev failures leave normal Tintin execution intact.
- Coverage is limited to eligible calls that pass through the loaded extension's Pi tool-event pipeline, not every launch inside Tintin.

## User interface and coverage

Keep Tintin's native `Agent` schema unchanged. Users ask Pi to delegate normally; the caller supplies `prompt`, `description`, `subagent_type`, and any ordinary Tintin options.

For an eligible new-task call, the extension assesses `prompt` and `subagent_type`, then fills only omitted `model` and `thinking` arguments. Preserve all other arguments, including task text, description, foreground/background mode, tools, context inheritance, and isolation. Native tool results, progress, notifications, identifiers, and control tools remain Tintin-owned.

Eligibility requires a compatible Tintin owner handshake, the expected native `Agent` schema, a nonempty prompt and agent type, and a new immediate task. Skip calls with `resume` or `schedule` set; resumption should retain its prior configuration and a scheduled task should not be assigned defaults prematurely. Do not repair invalid native inputs or classify unrelated tool calls.

Register `/jev-subagent-router` for status, routing `on`/`off`, dependency availability, Jev readiness, and the last bounded decision summary. Turning routing off makes the hook a no-op.

Internal workflow `agent()` calls, mentions, schedules, nested launches, direct RPC launches, and children without this extension loaded are not guaranteed coverage. A nested call that actually passes through this loaded hook may be eligible, but installation in the parent does not imply coverage in every child. Do not advertise universal interception or a child-runtime installation mechanism.

## Architecture

### 1. Extension coordinator and dependency detection

Own hook/command registration, session-local state, dependency detection, operation cancellation, audit entries, and lifecycle cleanup. Never call parent `setModel` or `setThinkingLevel`, register a replacement `Agent` tool, or call another launcher from the hook.

Detect Tintin after session startup and refresh an unavailable/stale detection on eligible calls. `subagents:rpc:ping` reports protocol version 2. Subscribe to its correlated reply before emitting a request, use a bounded timeout, and tolerate extension load order. A missed initial `subagents:ready` event must not permanently mark Tintin unavailable.

Require both the compatible owner handshake and the expected registered native-tool schema before mutating calls. A tool named `Agent` alone is not sufficient evidence. These checks are compatibility safeguards, not authentication against malicious loaded extensions. If identity or compatibility is uncertain, leave inputs unchanged and warn appropriately.

### 2. Native-call interception

Register `pi.on("tool_call", async (event, ctx) => ...)`. Pi's declared mutation contract is to modify `event.input` in place; returning an invented `input` result is not supported.

Snapshot the eligible task and the original caller model/thinking before classification. Compute changes locally and apply them only after validation and a cancellation check. Recheck field omission before assigning, so no field populated by another handler is overwritten. Never clear caller arguments, mutate the prompt, or change unrelated options.

Tintin resolves model and thinking independently as `agentConfig?.model ?? params.model` and `agentConfig?.thinking ?? params.thinking`. Injected Jev recommendations therefore remain defaults: Tintin itself preserves agent-definition choices without requiring a metadata inspection API.

Do not spawn through `subagents:rpc:spawn`; its options override agent definitions. Do not call `ctx.executeTool("Agent", ...)` from this hook; native execution follows automatically once the hook returns, avoiding recursion and duplicate launches.

Handler registration order can affect other extensions' edits. Preserve values visible at the time of assignment and document that a later handler can change arguments. Do not claim precedence over arbitrary third-party hooks.

### 3. Jev classifier

Adapt the upstream typed judgments:

- Task kind.
- Complexity.
- Capability deserved, ignoring price.
- Need for deep reasoning.

Send bounded task and agent-identity context, not the complete parent conversation, source files, credentials, or tool outputs. Cap the combined excerpt at 8,000 characters by default and record truncation. The actual native launch prompt remains unchanged.

Use `TYPESAFE_API_KEY`, a configurable Jev model/endpoint, a total request timeout, cancellation, and strict response validation. Reject unknown task kinds and malformed, out-of-range, or nonfinite scores. Any classification retries must fit inside the total timeout. The router never retries native execution.

If both model and thinking are already supplied by the caller, skip classification. Otherwise classify once and recommend only omitted fields. An explicit `thinking: "off"` is a supplied value, not an absent field. Invalid caller values remain intact for Tintin/Pi validation rather than being silently replaced.

### 4. Deterministic routing policy

Code maps judgments to configurable capability tiers (`quick`, `standard`, `high`, `premium`) and thinking defaults. Use ordered provider/model candidate chains and optional task-kind specialists, following the upstream separation of semantic judgment from policy.

Resolve candidates against Pi's available/authenticated models. Do not require a particular provider. Validate proposed model/thinking combinations when the proposed or caller-selected model is known. Tintin performs final thinking normalization against its resolved model, since an agent-defined model can supersede a recommendation. If no suitable candidate is available, omit the affected automatic field.

Restrictions such as model scope, agent permissions, tools, and trust remain backend-owned and must not be bypassed. Explicit caller fields are never silently changed to availability fallback candidates.

Daily/monthly budgets, model-score ranking, cache-stickiness, parent-session routing, and runtime escalation are not carried into v1.

### 5. Configuration and audit

Read optional user configuration at `~/.pi/agent/pi-jev-subagent-router.json` and trusted project configuration at `.pi/pi-jev-subagent-router.json`, with project values overriding user values. Respect the host's project-trust decision rather than introducing a new trust mechanism. Validate both layers; malformed configuration disables affected routing with a visible warning until corrected, while normal native calls continue unchanged.

Configuration covers enabled state, Jev endpoint/model/timeout, tier candidates, task specialists, and thinking mappings. There is no backend selector. Keep credentials in the environment rather than configuration examples.

Persist bounded non-context entries describing native tool-call correlation, agent, proposed/supplied defaults, tier, judgment summary, and skip/fallback reason. Do not store secrets or full task text. Label recommendations as proposed unless the backend explicitly reports effective values; the router cannot infer that a recommendation won over an agent definition.

Provide concise status/notifications where supported and keep routing functional without terminal UI. Native tool-result content and details are not replaced to add router output. Audit entries record routing decisions, not proof that a child was admitted or completed. Clear stale session-local references on reload/session replacement and release pending discovery listeners/controllers during shutdown.

## Field precedence

Treat model and thinking separately:

1. Explicit agent-definition setting, following Tintin's native semantics.
2. Explicit caller `Agent` argument.
3. Jev-selected default when the caller field is omitted.
4. Backend defaults/inheritance.

Caller arguments stay unchanged even when an agent definition takes precedence over them. Do not read agent files, invent metadata endpoints, or send definition values back as synthetic arguments. The backend owns identity resolution, settings, scope checks, and final thinking normalization.

## Routing flow

1. Ignore unrelated, invalid, resume, scheduled, or disabled-routing calls.
2. Verify compatible Tintin ownership and registered native schema.
3. Preserve caller model/thinking independently; skip if neither field is missing.
4. Classify the bounded task once.
5. Compute and validate proposed defaults locally.
6. Check cancellation and recheck which fields are still omitted.
7. Mutate only those eligible `event.input` fields and persist a bounded decision.
8. Return normally; Pi executes Tintin's original tool exactly once.

Concurrent tool calls retain separate signals, tool-call IDs, decisions, and classification operations. Never use shared parent model state to route children.

## Errors and cancellation

- Missing dependency: notify with the Tintin installation/reload guidance. Unrelated tools continue unchanged.
- Uncertain owner/schema/protocol: no input mutation; report routing unavailable, not a successful routing decision.
- Missing Jev key, timeout, transport failure, malformed judgment, or unavailable routing candidates: warn and leave affected missing fields untouched so normal Tintin defaults apply.
- Invalid routing configuration: warn, disable affected routing, and leave native calls unchanged.
- Catch expected classifier/discovery failures; an uncaught `tool_call` exception blocks execution in Pi and would violate fail-open behavior.
- Cancellation during classification: abort classification and apply no recommendation. Honor the host's operation cancellation; do not treat it as a reason to initiate execution. If the host is dispatching an already-cancelled call, use the supported blocking result rather than initiating a launch.
- Native execution failures, admission, child lifetime, stop controls, and uncertain launch outcomes remain Tintin/Pi-owned. The router neither retries the call nor independently stops a child.
- Cleanup is idempotent on success, error, cancellation, session replacement, and shutdown. Audit failures must not cause retries or duplicate native execution.

## Testing and acceptance criteria

Unit tests cover strict Jev parsing, request bounds, tier/specialist choices, per-field caller preservation, explicit thinking off, candidate authentication/availability, and proposed thinking validation.

Hook tests cover eligible `Agent` mutation, unchanged prompt/options, foreground/background preservation, resume/schedule skips, both fields explicit, one field explicit, disabled routing, unrelated `Agent`, dependency missing, protocol/schema mismatch, classification failure, timeout, cancellation, concurrent calls, and rechecking omission after asynchronous work. Assert the hook never invokes a launcher or changes the parent model/thinking.

Lifecycle tests cover subscribe-before-ping, reply correlation, discovery timeout, startup load order, noninteractive mode, and listener/controller cleanup on reload/shutdown.

Integration validation against published `@tintinweb/pi-subagents@0.19.0` and a host with argument-mutating `tool_call` support must demonstrate:

- A normal Pi-issued `Agent` call invokes Jev routing without special wording or a wrapper.
- Native foreground and background modes remain unchanged.
- Agent-definition model/thinking settings independently win over injected defaults.
- Caller fields remain unchanged and take precedence over Jev proposals.
- Thinking is normalized against an agent-defined model that supersedes a recommended model.
- Jev failure permits normal native execution with existing defaults.
- Native progress, results, notifications, and control receipts remain intact.
- Workflow/mention/schedule paths are not falsely claimed as covered.

Use injected classifier transport and event-bus fixtures; default tests must not require paid Jev/model calls. Optional live smoke tests require explicit credentials and operator opt-in. Fixture tests alone do not establish end-to-end backend compatibility.

## Distribution and attribution

Ship a TypeScript Pi package with an explicit extension entry in `package.json`, host-provided peer dependencies, configuration examples, and usage instructions. Tintin is installed and loaded separately, not bundled. Do not advertise unscoped `pi-subagents` compatibility.

Retain upstream MIT notices for copied code. Explain that this project routes eligible native subagent calls rather than parent prompts, and document all coverage limits prominently.

## Research references and limits

- Upstream router: https://github.com/da-vinci-noob/pi-jev-model-router — inspected v0.6.0 classifier and routing documentation.
- Pi extension API: locally installed Pi 1.0.0 `docs/extensions.md` and `extensions/types.d.ts`. `ToolCallEventResult` documents mutation of `event.input` in place; thrown hook errors fail closed.
- Tintin published artifact: https://registry.npmjs.org/@tintinweb/pi-subagents/0.19.0 — inspected tarball at git head `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`.
- Tintin native precedence: published `src/index.ts` and `src/invocation-config.ts`; RPC launch precedence in `src/agent-runner.ts` differs.
- Tintin discovery: published `src/cross-extension-rpc.ts` and `docs/rpc.md`; ping reports protocol version 2, with no definition-metadata RPC.

The implementation plan must test the native tool-event pipeline against published code before claiming compatibility. No private imports, replacement native tools, monkey-patching, or inferred universal launch hooks are permitted.
