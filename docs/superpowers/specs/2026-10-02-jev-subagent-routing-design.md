# Jev subagent model router — v1 design

Date: 2026-10-02
Status: Written specification approved; revised to Tintin-only scope following published-API verification and the user's compatibility decision.

## Goal

Build a distributable Pi extension inspired by `da-vinci-noob/pi-jev-model-router` that uses TypeSafe Jev to choose a subagent's model and thinking level at launch. It must not route the parent session or implement its own subagent launcher.

Supported dependency: **`@tintinweb/pi-subagents` only**.

The unscoped `pi-subagents` package (nicobailon) is not supported. It was removed from scope at the user's request after verification found no suitable public RPC agent-setting inspection seam.

Tintin's extension must be loaded and its native `Agent` tool must be callable through Pi's public nested-tool API. Installing the package without loading its extension is not sufficient. If unavailable, explain the missing dependency and show `pi install npm:@tintinweb/pi-subagents`; do not install anything automatically.

## Approved decisions

- Launch-time routing only; never reassess or switch a running child.
- A routed wrapper tool, not interception of existing tools or package internals.
- Explicit caller and agent-definition model/thinking settings remain authoritative, independently for each field.
- One detached child per wrapper call; independent calls can run concurrently.
- No standalone launcher, workflow rewriting, or spend-budget accounting in v1.
- Jev failures fail open to the backend's ordinary launch behavior.

## User interface

Register `jev_subagent` with:

- `agent`: required backend-native agent identity.
- `task`: required nonempty task text.
- `model`: optional caller-selected provider/model default, used ahead of Jev when the agent definition does not set a model.
- `thinking`: optional caller-selected Pi thinking default, used ahead of Jev when the agent definition does not set thinking.

There is no backend selector: this tool only delegates to Tintin. Agent-definition settings win over supplied defaults, matching Tintin's native `Agent` contract.

The child uses the parent working directory. Additional launch options, scheduling, fork/inherited context, and workflow scripts are not exposed in v1. Use fresh child context where supported.

Successful results return the backend's launch identifier, a routing summary, and guidance for using that backend's existing status/result/control tools. A launch receipt means admission, not completed work. The wrapper does not own child monitoring or completion notification.

Register `/jev-subagent-router` for status: Tintin availability and native-tool callability, Jev readiness, routing enabled/disabled state, and last bounded decision summary. Allow `on` and `off` for session-local routing toggles. Turning routing off still delegates through the selected backend without Jev overrides.

Existing direct `Agent`, workflow, nested, mention-triggered, and scheduled launch paths are unchanged. They are not automatically routed by this extension. Documentation must state this limitation prominently.

## Architecture

### 1. Extension coordinator

Own tool/command registration, current-session state, dependency detection, operation cancellation, audit entries, and lifecycle cleanup. Never call parent `setModel` or `setThinkingLevel`.

Detect Tintin after session startup and refresh detection on wrapper calls. Its public RPC ping identifies protocol version 2; separately verify the native `Agent` tool is present in the tool context's callable tools. Subscribe before sending discovery requests. Use bounded discovery timeouts and tolerate extension load order; a missed initial ready event must not permanently mark the dependency unavailable.

Do not assume that any tool named `Agent` belongs to Tintin. Require both the compatible owner handshake and the expected callable native-tool schema. If the host forbids nested `Agent` calls, return an actionable compatibility error; do not fall back to RPC spawning, which has different precedence.

### 2. Tintin adapter

The adapter owns detection, translation into a native `Agent` call, and cancellation/receipt translation. Use Pi's public `ctx.executeTool()` rather than importing Tintin's internal modules or assuming independently installed packages share Node module resolution. Do not register tools under Tintin's existing names.

Call `Agent` with `prompt: task`, a bounded `description`, `subagent_type: agent`, `run_in_background: true`, `inherit_context: false`, and only the supplied or recommended `model`/`thinking` defaults. Do not expose resume, scheduling, isolation, or workflow parameters in the wrapper.

Tintin's native tool resolves each field as `agentConfig?.model ?? params.model` and `agentConfig?.thinking ?? params.thinking`. Consequently, the wrapper can supply Jev recommendations without knowing the agent definition: the backend itself preserves configured settings. No independent metadata inspection is needed for precedence. Do not use `subagents:rpc:spawn`: its options override definitions instead.

Use `subagents:ready` / `subagents:rpc:ping` only for owner discovery, and supported stop control if cancellation requires an admitted child's identifier. Propagate the native result and distinguish a launch receipt from completed child work. If the result does not expose a structured launch identifier, preserve its backend-native receipt/control instructions without inventing an ID or claiming admission from an arbitrary success-looking string.

Validate actual nested native-tool execution on the chosen host and published Tintin version before claiming compatibility. The initial target is `@tintinweb/pi-subagents@0.19.0` with a Pi host supporting `ctx.executeTool()`. Test published code, not only a main-branch snapshot.

### 3. Jev classifier

Adapt the upstream typed judgments:

- Task kind.
- Complexity.
- Capability deserved, ignoring price.
- Need for deep reasoning.

Provide bounded task and agent-identity context, not the complete parent conversation, source files, credentials, or tool outputs. The default combined task/identity excerpt is capped at 8,000 characters; record truncation in the decision. Keep the actual launch task unchanged.

Use `TYPESAFE_API_KEY`, a configurable Jev model/endpoint, a total request timeout, cancellation, and strict response validation. Do not silently accept unknown task kinds or malformed/nonfinite scores. Any retries must fit within the total timeout and apply only to classification, never child launch.

If both model and thinking were supplied by the wrapper caller, skip classification. Otherwise classify once and supply only missing caller defaults. The native tool decides whether each recommendation is used or superseded by an agent-definition setting.

### 4. Deterministic routing policy

Code maps judgments to configurable capability tiers (`quick`, `standard`, `high`, `premium`) and thinking levels. Use ordered provider/model candidate chains and optional task-kind specialists, following the upstream separation of semantic judgment from policy.

Resolve candidates against Pi's available/authenticated models. Do not hardcode one provider as a requirement. Validate proposed model/thinking combinations where the model is known. Tintin must perform final model-capability normalization against its resolved model, since an agent-definition model can supersede a recommendation. If no suitable candidate is available, omit the affected automatic default and retain backend behavior.

Explicit caller settings are not silently replaced by fallback candidates; the backend remains responsible for their normal validation and policy enforcement. Restrictions such as model scope, capability ceilings, tools, trust, or agent restrictions must never be bypassed by the wrapper.

Daily/monthly budgets, model-score ranking, cache-stickiness, parent-session routing, and automatic runtime escalation from the upstream extension are not carried into v1.

### 5. Configuration and audit

Read optional user configuration at `~/.pi/agent/pi-jev-subagent-router.json` and trusted project configuration at `.pi/pi-jev-subagent-router.json`, with project values overriding user values. Validate both layers and report malformed configuration without preventing the extension from loading. Reject affected routed calls until the configuration is corrected; do not silently ignore invalid routing policy.

Configuration covers enabled state, Jev endpoint/model/timeout, tier candidates, task specialists, and thinking mappings. There is no backend preference setting. Keep API credentials in the environment rather than config examples. Configuration must not introduce a new mechanism to trust project files.

Persist bounded non-context session entries describing agent, supplied model/thinking defaults, selected tier, judgment summary, fallback reason, and native launch outcome. Label recommendations as proposed rather than effective settings unless the backend explicitly reports the child's effective values. Show a concise tool result; do not store secrets or full task text in audit entries. Store the same decision structure in tool-result details for noninteractive clients. Clear stale session-local references on reload/session replacement and unsubscribe pending protocol listeners during shutdown.

## Field precedence

Treat model and thinking separately:

1. Explicit agent-definition setting, following Tintin's native semantics.
2. Explicit wrapper caller default.
3. Jev-selected default when that caller field is omitted.
4. Backend defaults/inheritance.

This refines the earlier caller-first ordering to match the sole supported dependency. Neither caller defaults nor Jev may override configured agent fields. Document caller arguments as defaults, not forced overrides. The backend retains responsibility for agent identity resolution, settings, scope checks, and final supported thinking normalization.

Do not read agent files, invent metadata endpoints, or send agent-definition values back as synthetic launch overrides. Unknown effective values remain unknown in the wrapper's audit output; lack of metadata does not prevent supplying definition-preserving native-tool defaults.

## Launch flow

1. Validate arguments and trusted configuration.
2. Verify Tintin ownership, compatible protocol, and native `Agent` callability.
3. Preserve caller-provided defaults independently for model and thinking.
4. If routing is enabled and at least one caller field is omitted, classify the bounded task.
5. Compute and validate recommended defaults; otherwise retain ordinary backend behavior.
6. Check cancellation before calling the native tool.
7. Execute exactly one detached native `Agent` call, forwarding the operation signal.
8. Return the backend-native receipt and routing summary; persist the bounded outcome.

Concurrent wrapper calls have separate correlation IDs, signals, decisions, and listeners. No shared mutable parent model state is involved.

## Errors and cancellation

- Missing dependency: actionable error showing `pi install npm:@tintinweb/pi-subagents`; instruct the user to load/reload its extension.
- Tintin detected but native tool unavailable or noncallable: compatibility error, no launch and no RPC-spawn fallback.
- Missing Jev key, timeout, transport failure, malformed judgment, or unavailable routing candidates: visible warning and one ordinary backend launch without affected automatic overrides.
- Unknown agent or backend rejection: preserve the backend error, no alternate-backend retry.
- Cancellation before spawn: do not launch; cancellation is not a classifier failure that should fail open.
- Cancellation after confirmed admission: use the backend's supported stop control with the exact returned identifier. The wrapper owns cancellation only while its call remains active; after returning, normal backend tools own child control.
- Interrupted/uncertain native execution before a receipt: report an uncertain outcome, not a confirmed failure or confirmed stop. Never automatically repeat the call. Preserve any available native tool-call correlation or receipt so the user can inspect backend activity.
- Listener/timer cleanup must be idempotent on success, error, cancellation, session replacement, and shutdown.

## Testing and acceptance criteria

Unit tests cover strict Jev parsing, request/context bounds, tier and specialist choices, per-field caller-default preservation, model authentication/availability, and proposed thinking validation.

Adapter tests cover native `Agent` parameter spelling, dependency owner detection, subscribe-before-ping ordering, reply correlation, unsupported versions, tool callability, native error and receipt propagation, cancellation, uncertainty, and cleanup. Exercise concurrent calls with out-of-order results.

Coordinator tests cover dependency present/missing, an unrelated `Agent` tool, native tool noncallability, routing off, missing Jev key, classifier timeout/error, cancellation before launch, no duplicate launch, reload cleanup, and preservation of parent model/thinking.

Integration validation against the identified published Tintin version must demonstrate:

- Actual public nested-tool invocation of its native `Agent` tool.
- A detached single-child launch using Jev-supplied defaults when agent fields are absent.
- Native definition-first model/thinking precedence, including independently configured fields and conflicting supplied defaults.
- Preservation of caller defaults ahead of Jev recommendations.
- Successful ordinary-default launch after simulated Jev failure.
- Effective thinking normalization against an agent-defined model that supersedes the recommended model.
- Native receipts usable with Tintin's normal status/result controls, and visible uncertainty when effective values are not reported.

No compatibility claim should hide unsupported native-tool or launch paths. Tests must not require live paid Jev calls by default; use injected classifier transport and backend bus fixtures. Optional live smoke tests require explicit credentials and operator opt-in.

## Distribution and attribution

Ship a TypeScript Pi package with an explicit extension entry in `package.json`, peer dependencies for host-provided packages, configuration examples, and usage instructions. Tintin is not bundled: the user installs and loads `@tintinweb/pi-subagents` separately. Do not advertise support for the unscoped `pi-subagents` package.

Retain upstream MIT copyright/license notices for any copied code. Explain that this project is inspired by the upstream router and differs by routing only wrapper-launched subagents.

## Research references and limits

- Upstream router: https://github.com/da-vinci-noob/pi-jev-model-router — inspected v0.6.0 source, including `jev.ts`, package metadata, and README.
- Pi extension contracts: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md — locally installed Pi 1.0.0 documentation inspected.
- Tintin published artifact: https://registry.npmjs.org/@tintinweb/pi-subagents/0.19.0 — inspected tarball, published git head `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14`.
- Tintin native precedence: `src/index.ts` and `src/invocation-config.ts` in that published artifact; RPC precedence in `src/agent-runner.ts` differs.
- Tintin discovery/stop protocol: `src/cross-extension-rpc.ts` and `docs/rpc.md` in the published artifact. Ping reports protocol version 2; no definition-metadata RPC is exposed.

The implementation plan must verify native-tool callability and receipt/error behavior on the supported Pi host before committing to launch-adapter details. Private imports and monkey-patching are not substitutes. Removing unscoped `pi-subagents` compatibility avoids needing an independent provenance-aware metadata adapter.
