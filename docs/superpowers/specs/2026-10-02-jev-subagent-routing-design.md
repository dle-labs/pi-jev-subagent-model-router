# Jev subagent model router — v1 design

Date: 2026-10-02
Status: Design approved in conversation; written specification awaiting user review.

## Goal

Build a distributable Pi extension inspired by `da-vinci-noob/pi-jev-model-router` that uses TypeSafe Jev to choose a subagent's model and thinking level at launch. It must not route the parent session or implement its own subagent launcher.

Supported backends:

- `pi-subagents` (nicobailon).
- `@tintinweb/pi-subagents`.

At least one backend must be loaded and expose a compatible launch protocol. Installing a package without loading its extension is not sufficient. If neither is available, explain the missing dependency and show both installation options; do not install anything automatically.

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
- `backend`: optional `pi-subagents` or `tintinweb`.
- `model`: optional explicit provider/model selection.
- `thinking`: optional explicit Pi thinking level.

The child uses the parent working directory. Additional launch options, scheduling, fork/inherited context, and workflow scripts are not exposed in v1. Use fresh child context where supported.

Successful results return the backend's launch identifier, a routing summary, and guidance for using that backend's existing status/result/control tools. A launch receipt means admission, not completed work. The wrapper does not own child monitoring or completion notification.

Register `/jev-subagent-router` for status: detected backends, configured backend preference, Jev readiness, routing enabled/disabled state, and last bounded decision summary. Allow `on` and `off` for session-local routing toggles. Turning routing off still delegates through the selected backend without Jev overrides.

Existing `Agent`, `subagent`, workflow, nested, mention-triggered, and scheduled launch paths are unchanged. They are not automatically routed by this extension. Documentation must state this limitation prominently.

## Architecture

### 1. Extension coordinator

Own tool/command registration, current-session state, backend selection, operation cancellation, audit entries, and lifecycle cleanup. Never call parent `setModel` or `setThinkingLevel`.

Detect capabilities after session startup and refresh detection on wrapper calls. Subscribe before sending protocol requests. Use bounded discovery timeouts and tolerate extension load order; a missed initial ready event must not permanently mark a backend unavailable.

Backend selection order:

1. Explicit tool argument.
2. Configured backend preference.
3. The sole compatible loaded backend.
4. If both are available without a preference, fail with instructions to choose one.

An explicitly selected unavailable backend is an error, even if another backend is available. Distinguish unavailable/disabled from incompatible protocol where the backend supplies enough information.

### 2. Backend adapters

Each adapter owns detection, backend-native agent inspection when supported, detached launch translation, and cancellation/receipt translation. Common contracts expose:

- Backend availability and protocol capabilities.
- Per-field agent setting state: explicit, absent, or unknown.
- Launch request with only the selected overrides.
- Backend launch receipt, failure, or uncertain outcome.

Use public in-process event-bus RPC rather than importing unexported modules or assuming independently installed packages share Node module resolution. Do not register tools under either backend's existing names.

`pi-subagents` exposes versioned `subagents:rpc:v1:*` discovery/request/reply channels. Its spawn method supports an asynchronous structured single-child request through the package-owned executor.

`@tintinweb/pi-subagents` exposes `subagents:ready`, `subagents:rpc:ping`, and `subagents:rpc:spawn` with per-request replies. RPC launch options use `model`, `thinkingLevel`, and `isBackground`, not the `Agent` tool's parameter spelling. RPC option precedence differs from the package's direct `Agent` tool, so the adapter must not rely on the backend to preserve agent frontmatter against injected defaults.

Inspect definitions through supported discovery/metadata surfaces when available. No supported metadata route is assumed to exist merely because a launch API exists. If a setting cannot be reliably established, mark it unknown and omit a Jev override for that field. Report this limitation. Do not guess from the parent model or parse an unrelated agent directory as authoritative backend configuration.

Before claiming compatibility with a published version, verify that version's protocol and metadata behavior with fixtures or an integration probe. Research into a repository's main branch is not evidence for every published release.

### 3. Jev classifier

Adapt the upstream typed judgments:

- Task kind.
- Complexity.
- Capability deserved, ignoring price.
- Need for deep reasoning.

Provide bounded task and available agent-description context, not the complete parent conversation, source files, credentials, or tool outputs. The default combined task/description excerpt is capped at 8,000 characters; record truncation in the decision. Keep the actual launch task unchanged.

Use `TYPESAFE_API_KEY`, a configurable Jev model/endpoint, a total request timeout, cancellation, and strict response validation. Do not silently accept unknown task kinds or malformed/nonfinite scores. Any retries must fit within the total timeout and apply only to classification, never child launch.

If both model and thinking are already authoritative or unknown, skip classification: there are no safe fields to fill.

### 4. Deterministic routing policy

Code maps judgments to configurable capability tiers (`quick`, `standard`, `high`, `premium`) and thinking levels. Use ordered provider/model candidate chains and optional task-kind specialists, following the upstream separation of semantic judgment from policy.

Resolve candidates against Pi's available/authenticated models. Do not hardcode one provider as a requirement. Validate automatically selected thinking against the selected/effective model's capabilities. If a safe model or thinking combination cannot be established, omit the affected automatic override and retain backend defaults.

Explicit caller settings are not silently replaced by fallback candidates; the backend remains responsible for their normal validation and policy enforcement. Restrictions such as model scope, capability ceilings, tools, trust, or agent restrictions must never be bypassed by the wrapper.

Daily/monthly budgets, model-score ranking, cache-stickiness, parent-session routing, and automatic runtime escalation from the upstream extension are not carried into v1.

### 5. Configuration and audit

Read optional user configuration at `~/.pi/agent/pi-jev-subagent-router.json` and trusted project configuration at `.pi/pi-jev-subagent-router.json`, with project values overriding user values. Validate both layers and report malformed configuration without preventing the extension from loading. Reject affected routed calls until the configuration is corrected; do not silently ignore invalid routing policy.

Configuration covers enabled state, backend preference, Jev endpoint/model/timeout, tier candidates, task specialists, and thinking mappings. Keep API credentials in the environment rather than config examples. Configuration must not introduce a new mechanism to trust project files.

Persist bounded non-context session entries describing backend, agent, model/thinking overrides or preserved settings, selected tier, judgment summary, fallback reason, and launch outcome. Show a concise tool result; do not store secrets or full task text in audit entries. Store the same decision structure in tool-result details for noninteractive clients. Clear stale session-local references on reload/session replacement and unsubscribe pending protocol listeners during shutdown.

## Field precedence

Treat model and thinking separately:

1. Explicit wrapper argument.
2. Explicit agent-definition setting, including a backend's explicit inheritance sentinel.
3. Jev-selected value, only when the adapter proves the agent field absent.
4. Backend defaults/inheritance.

An unknown agent field is not equivalent to absent: omit its automatic override. Backend-wide defaults remain fallback values rather than explicit agent-definition settings unless the backend exposes them only as indistinguishable effective settings; in that case preserve them conservatively.

Do not send agent-definition values back as synthetic launch overrides unnecessarily. The backend should apply its own configuration. An adapter must normalize caller explicit overrides to the backend's documented semantics; if the backend cannot honor the requested precedence, return an actionable error rather than silently changing intent.

## Launch flow

1. Validate arguments and trusted configuration.
2. Detect/select the backend.
3. Resolve available agent metadata and per-field precedence.
4. If routing is enabled and at least one field is safely fillable, classify the bounded task.
5. Compute and validate automatic choices; otherwise retain ordinary defaults.
6. Check cancellation before issuing a spawn request.
7. Send exactly one correlated detached spawn request.
8. Return the backend launch identifier and routing receipt; persist the bounded outcome.

Concurrent wrapper calls have separate correlation IDs, signals, decisions, and listeners. No shared mutable parent model state is involved.

## Errors and cancellation

- Missing dependency: actionable error showing `pi install npm:pi-subagents` and `pi install npm:@tintinweb/pi-subagents`; instruct the user to load/reload the chosen extension.
- Both dependencies without a preference: selection error, no launch.
- Missing Jev key, timeout, transport failure, malformed judgment, or unavailable routing candidates: visible warning and one ordinary backend launch without affected automatic overrides.
- Unknown agent or backend rejection: preserve the backend error, no alternate-backend retry.
- Cancellation before spawn: do not launch; cancellation is not a classifier failure that should fail open.
- Cancellation after confirmed admission: use the backend's supported stop control with the exact returned identifier. The wrapper owns cancellation only while its call remains active; after returning, normal backend tools own child control.
- Timeout or cancellation after sending spawn but before receiving an identifier: report an uncertain outcome, not a confirmed failure or confirmed stop. Never automatically resend. Supply the request correlation ID so the user can inspect backend activity.
- Listener/timer cleanup must be idempotent on success, error, cancellation, session replacement, and shutdown.

## Testing and acceptance criteria

Unit tests cover strict Jev parsing, request/context bounds, tier and specialist choices, per-field precedence, unknown metadata, explicit inheritance, model authentication/availability, and supported thinking validation.

Adapter protocol tests cover each backend's parameter spelling, subscribe-before-send ordering, readiness/ping, reply correlation, rejected/unsupported versions, launch receipts, stop requests, timeout uncertainty, and cleanup. Exercise concurrent calls with replies delivered out of order.

Coordinator tests cover one/both/neither backend, explicit backend preference, routing off, missing Jev key, classifier timeout/error, cancellation before launch, no duplicate launch, reload cleanup, and preservation of parent model/thinking.

Integration validation against identified published backend versions must demonstrate:

- A detached single-child launch with an automatically chosen model/thinking when agent fields are provably absent.
- Preservation of caller and agent-definition settings independently.
- Successful ordinary-default launch after simulated Jev failure.
- Actionable behavior when metadata inspection is unavailable.
- A receipt that can be used with the backend's normal status/result controls.

No compatibility claim should hide unsupported metadata or launch paths. Tests must not require live paid Jev calls by default; use injected classifier transport and backend bus fixtures. Optional live smoke tests require explicit credentials and operator opt-in.

## Distribution and attribution

Ship a TypeScript Pi package with an explicit extension entry in `package.json`, peer dependencies for host-provided packages, configuration examples, and usage instructions. Neither backend is a mandatory bundled dependency: the user installs and loads their choice separately.

Retain upstream MIT copyright/license notices for any copied code. Explain that this project is inspired by the upstream router and differs by routing only wrapper-launched subagents.

## Research references and limits

- Upstream router: https://github.com/da-vinci-noob/pi-jev-model-router — inspected v0.6.0 source, including `jev.ts`, package metadata, and README.
- Pi extension contracts: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md — locally installed Pi 1.0.0 documentation inspected.
- `pi-subagents`: https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md — public RPC, structured delegation, preflight, and process-local API boundaries inspected. Registry reported 0.75.0 during research; main-branch inspection is not a tarball compatibility audit.
- Tintin RPC: https://github.com/tintinweb/pi-subagents/blob/e955e29/docs/rpc.md — inspected source revision `e955e29`; registry reported 0.19.0 with a different published git head.
- Tintin precedence: https://github.com/tintinweb/pi-subagents/blob/e955e29/src/invocation-config.ts and https://github.com/tintinweb/pi-subagents/blob/e955e29/src/agent-runner.ts.

The implementation plan must verify supported published-version contracts before committing to adapter details, especially agent-metadata inspection. The conservative unknown-field rule is the defined behavior when a public inspection seam is absent; private imports or monkey-patching are not substitutes.
