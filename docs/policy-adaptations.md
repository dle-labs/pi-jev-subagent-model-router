# Task 4 deliberate policy adaptations

The pinned Jev 0.6.0 vendor remains unchanged. Adapted core configuration retains
its parser, validation, model-chain merging, generated-route restrictions,
taxonomy, defaults, thinking pins, ranking cutoffs and `~/scores` expansion.
Routing retains upstream demand math and guard/candidate order. These tests do
not establish full router or native-control parity.

## Resource namespace and directory

`childConfigText` replaces only `pi-jev-model-router` resource text with
`pi-jev-subagent-router`. Original environment names, API key fields, free policy
and xpremium are not renamed. Global config, generated config, default scores and
default state use the public SDK `getAgentDir()` (including startup
`PI_CODING_AGENT_DIR`), not `HOME/.pi/agent`. Project config keeps the upstream
`.pi` directory with the child basename. Scores explicitly configured with `~`
still expand against HOME as upstream; explicit file paths remain user policy.

The copied configuration assertions are preserved except their deliberate child
resource namespace/public-directory correction. Tests validate startup HOME
rather than mocking `node:os` or the host. Two independently bootstrapped fresh
children report different startup agent directories and exercise synthetic
config/generated/scores/state writes there. Generated writes in this task are
fixture writes through `configPaths().generated`, not production command or
controller behavior. Each child cleans synthetic files; the bootstrap removes
its owned root after process completion.

## Project trust boundary

`loadConfiguration({ cwd, isProjectTrusted })` delegates to the upstream merger.
Only an explicit `true` trust result permits `cwd`; absent, denied or throwing
trust excludes the project layer. It never substitutes `process.cwd()`. The
low-level `loadConfig(cwd?)` still accepts an explicitly supplied project path;
callers at a host trust boundary must use the wrapper. No parent history,
parent config, controller or production hook is loaded by the wrapper.

## Environment precedence

Original `JEV_ROUTER_MODE` retains case-insensitive auto/confirm/notify semantics;
original `JEV_ROUTER_OFF` disables only for the exact strings `1` and `true`.
Valid child `JEV_SUBAGENT_ROUTER_MODE` has highest precedence; invalid values
fall back to the original env mode, then file/default policy. Child OFF accepts
exact `1`/`true` (disable) and `0`/`false` (ignore legacy OFF and retain merged
file/default enabled policy). Thus child OFF=0 overrides legacy OFF=1, but does
not force-enable an explicitly disabled config. Invalid or absent child OFF
retains original OFF semantics. The loader never assigns environment variables.
API key and endpoint behavior is unchanged; client security belongs to Task 5.

## Exact provider identity correction

Adapted `findModel` requires both provider and model ID. The upstream same-ID
cross-provider fallback is intentionally removed: a configured provider is not
a hint to use a different provider. The two copied assertions requiring that
fallback are replaced with exact-identity regressions. Missing configured
providers still trigger the existing same-tier/nearest-tier candidate search;
free pools, specialists and ordinary chains cannot escape to a same-ID
unconfigured provider. No other `decide` behavior changes.

## Differential scope

Only pure pinned vendor config/router modules are imported, never the extension
entry or vendor tests. Twelve tests compare complete decisions (including model,
target/pins, scores, guard flags, reason and notes): 135 configured edge cases
and 512 fixed-seed combinations using exact available providers. Coverage spans
kind floors/taxonomy, confidence, demand/reasoning thresholds, budget pressure,
specialist priority/minTier, xpremium eligibility, both free policies,
availability fallback and cache prices/context (including unknown prices).
Relevant default policy inputs are compared excluding mutable resource paths.
The intentional provider difference is checked separately, not suppressed in
normal equivalence comparisons. This is bounded policy evidence, not a complete
compatibility claim. Astra review and parent verification remain required.

## Isolated verification evidence

All runtime commands used the required `env -i` / `verify-sandbox.sh` outer
boundary, with no native mounts, installations or external calls.

- Test-first RED: `/tmp/jev-sandbox-evidence-Kl4zmi/process-tree.strace`;
  configuration + router: 50 pass / 8 fail / 2 files. Failures expose old
  resource paths, absent wrapper/helper, missing child-env precedence and
  cross-provider substitution. Missing new module errors are expected feature
  absence, not a successful test witness.
- Fresh-child resource RED: `/tmp/jev-sandbox-evidence-x9KafD/process-tree.strace`;
  0 pass / 1 fail / 1 file, demonstrating HOME-based parent-namespaced paths.
  RED test output is retained in the tool transcript; these directories contain
  traces, not separate stdout/stderr captures.
- Focused GREEN: `/tmp/jev-sandbox-evidence-TxYMsd/process-tree.strace`;
  configuration + copied config/router: 91 pass / 0 fail / 4 files.
- Differential GREEN: `/tmp/jev-sandbox-evidence-G9YXxI/process-tree.strace`;
  12 pass / 0 fail / 1 file (652 assertions).
- Initial full collection `/tmp/jev-sandbox-evidence-tEWs1j` passed runtime gates
  but exposed TypeScript literal widening in two new test fixtures. Narrowing
  test literals corrected it without changing production behavior.
- Final collection `/tmp/jev-sandbox-evidence-BK2PsT`: each mode exited 0;
  `configuration` 7 pass / 2 files; default `test` 184 pass / 12 files;
  `typecheck` no diagnostics; `baseline` 18 byte-identical vendor files;
  `reference` unchanged 31 + 13 + 52 + 12 + 20 + 12 = 140 pass in 6 separate
  processes; `isolation` 20 cases. Exact `<mode>.stdout`, `<mode>.stderr` and
  `process-tree.strace` are retained there.

# Task 5 deliberate Jev client adaptations

Only the adapted Jev client and its tests change; no routing, configuration,
budget, vendor, hooks or controller policy changes. The vendor remains pinned.

## Response validation and privacy

`finiteRange(value: unknown, min: number, max: number, label: string): number`
is exported from `src/core/jev.ts`. It rejects non-numeric, non-finite and
out-of-range values with a static `JevError`, never reflecting even the label.
The response root, present `answers`, individual answer objects and probability
maps must be objects (not null, arrays or primitives). Missing fields retain the
proven neutral defaults; malformed present fields no longer silently default.
Scores are 0..3, confidence/probabilities/reasoning are 0..1. Probability keys
must belong to configured taxonomy; partial and non-normalized maps remain
valid (no sum-to-one constraint). Custom task kinds remain supported.
`capability_deserved` and `needs_deep_reasoning.noul` retain their upstream
spelling, with `noul_score` as the missing-`noul` fallback. Both supplied
reasoning fields are validated. Supplied usage token fields must be finite and
nonnegative; input usage with missing output preserves output=0, while unknown
usage without input stays undefined, not fabricated.

Unknown-choice errors no longer interpolate response values. Non-OK bodies
are never read: HTTP status is sufficient, with no body detail, URL, key or task
payload in errors or causes. Transport and JSON exceptions are replaced by
bounded static errors; JSON/parsing failures are not retried. The two adapted
upstream assertions that expected unknown-choice/body disclosure now assert
absence of those values (and status=401 for the HTTP error). This is a deliberate
privacy correction, not an alteration of the vendor tests.

## Transport and request bounds

Non-empty trimmed `process.env[config.endpointEnv]` still overrides the
configured endpoint, otherwise that endpoint wins. The caller-supplied bearer
key, configured Jev model and four original questions remain unchanged. API-key
resolution policy is untouched; this client does not invent a missing-key rule.
`redirect: "error"` prevents automatic credential-bearing redirect requests.
Tests assert that option against fake fetch, without performing a redirect or
provider network call.

One validated integer deadline (1..2,147,483,647 milliseconds) covers fetch,
JSON body reading and retry backoff across at most three attempts. HTTP 429/529
and transport `Error` failures retry; all other HTTP failures and body/parser
errors terminate. Backoffs remain 200/400 ms, with no final 600 ms sleep.
Cancellation/deadline abort races cover transports ignoring their signal and
late body results; losing promise resolution/rejection remains observed.
Backoff timers and listeners are removed on cancellation, and deadline/external
listeners are cleaned up on every exit. External abort reasons are not exposed.

The supplied `input.prompt` (future combined task/agent-identity text) is capped
to its first 8000 UTF-16 characters without mutation. Only truncated results
carry `RouteAnalysis.requestTruncation?: { originalChars: number; sentChars:
number }`; the property is absent for unchanged requests. Explicit history
remains its last 4000 characters. A short new task is classified with no minimum
length skip and no added parent history. Existing environment and budget input
fields remain intact; no new task-identity protocol is introduced.

## Task 5 isolated verification evidence

Every runtime invocation used `/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash
--noprofile --norc scripts/verify-sandbox.sh ...`; repository read-only, private
temporary fixtures, no homes/network/native mounts, installs or commits.
All test transports are fake fetch restored after each test; no host module
mocking or provider calls. Default core discovery includes the new test without
script changes.

- Test-first RED: `/tmp/jev-sandbox-evidence-lMMSN4/{red.stdout,red.stderr,
  process-tree.strace}`; 16 pass / 99 fail / 115 tests / 2 files. Failures
  demonstrate malformed values accepted/defaulted, raw errors/disclosures,
  ignored cancellation/deadline, redirects and absent truncation/helper.
- Initial focused GREEN: `/tmp/jev-sandbox-evidence-aD5oT1/{focused.stdout,
  focused.stderr,process-tree.strace}`; 115 pass / 0 fail / 2 files.
- Intermediate collection: `/tmp/jev-sandbox-evidence-SGVkdW`; runtime gates
  passed but typecheck rejected a deliberately partial JSON-throwing Response
  fixture. Its cast now explicitly passes through `unknown`; production
  behavior did not change.
- Final collection: `/tmp/jev-sandbox-evidence-Z4SKBE`; all seven commands exit
  0. `focused` 102 pass / 1 file (439 assertions), `core` 243 pass / 7 files,
  default `test` 286 pass / 13 files; `typecheck` no diagnostics. `reference`
  retains 31 + 13 + 52 + 12 + 20 + 12 = 140 vendor passes in six processes;
  `baseline` retains 18 byte-identical files. `differential` retains 12 passes
  (652 assertions), including the existing 135 edge + 512 seeded = 647 bounded
  full-decision comparisons. Exact `<mode>.stdout`, `<mode>.stderr` and
  `process-tree.strace` are retained in that directory.

## Task 5 Astra deadline finding follow-up

The timer-only cancellation guard could start JSON reading or analysis after a
synchronous transport/microtask exhausted the request deadline, before the abort
timer could run. A thrown analysis error also bypassed the old final elapsed-time
check. A private request-budget helper now checks both cancellation and a single
monotonic `performance.now()` deadline. It aborts the shared controller on elapsed
expiry and reports only `JevError("aborted")`.

Checks guard each fetch/retry, body reader, analysis entry, backoff entry and
completion, and response/error resolution. The queued operation inside
`abortable` checks again before invoking transport/body work; both its success
and failure handlers recheck before settling. Catch paths let cancellation or
elapsed expiry dominate later transport, JSON or analysis errors without exposing
raw values. Analysis completion and final result publication remain guarded.
The public API, wall-clock `latencyMs` calculation, request/history truncation,
environment precedence, three-attempt policy and 200/400 ms backoffs are
unchanged. There is still no final sleep; listeners and timers retain cleanup.
No vendor, configuration or routing policy changes are part of this fix.

Eight added synthetic regressions use short 25 ms synchronous monotonic spins
against a 10 ms budget, including queued fetch/body starts and late malformed
payloads with observable analysis access. They do not await a timeout to create
expiry, patch clocks or mock host modules. The overload-boundary test observes
controller cancellation in the next microtask, before a backoff timer could run;
late transport/body/analysis exceptions remain secret-safe. Fake fetch is
restored by the existing after-each cleanup.

All execution used the same required clean-environment sandbox boundary and
isolated launcher, without installs, commits, personal resources or network:

- Test-first RED: `/tmp/jev-sandbox-evidence-7RwcZw/{red.stdout,red.stderr,
  process-tree.strace}`; 103 pass / 7 fail / 110 tests / 1 file. Failures show
  post-expiry JSON reads, queued new work, analysis of late malformed data,
  wrong error precedence and backoff entered before elapsed cancellation. The
  late-fetch error regression already passed and preserves that behavior.
- Focused GREEN: `/tmp/jev-sandbox-evidence-wYqIXO/{green.stdout,green.stderr,
  process-tree.strace}`; 110 pass / 0 fail / 1 file, 491 assertions.
- Final collection: `/tmp/jev-sandbox-evidence-tVziqB`; `test`, `reference`,
  `typecheck` and `baseline` each exited 0. Default tests: 294 pass / 0 fail /
  13 files; reference: unchanged 31 + 13 + 52 + 12 + 20 + 12 = 140 vendor
  passes in six processes; typecheck: no diagnostics; baseline: 18 byte-identical
  vendor files. Exact `<mode>.stdout`, `<mode>.stderr`, `exits.txt` and
  `process-tree.strace` are retained there.

This is client-security and bounded policy evidence, not full router parity or
native-control verification. Parent independent verification and Astra review
remain required.

# Task 6 public Tintin discovery and legacy scope adapter

Task 6 adds only `src/tintin/{discovery,scope}.ts`, their two isolated test
files, explicit `test/tintin` default discovery and the `tintin` launcher mode.
No ordinary Agent hook, launcher, input mutation, child control, authentication
filter, parent-runtime change or private backend import is introduced. Task 7
must consume these helpers and independently check authentication and captured
operation/configuration generation before proposing omitted defaults.

## Verified public contracts and readiness

Research used installed Tintin 0.19.0 `src/enabled-models.ts`,
`src/model-scope.ts`, relevant Agent registration and lifecycle code in
`src/index.ts`, `src/cross-extension-rpc.ts` and public `docs/rpc.md`.
Host declarations were `dist/core/event-bus.d.ts`, extension types and the
public synchronous `ModelRegistry` facade; host configuration/settings/security
references establish the project-trust boundary. Production imports only public
SDK types/functions plus Node APIs and the local configuration-context type.

The public bus is `on(channel, handler): () => void` and
`emit(channel, data): void`. `pingTintin(bus, signal?, timeoutMs = 250)` subscribes
to a fresh crypto-UUID reply channel before emitting `{ requestId }` on
`subagents:rpc:ping`. Only `{ success: true, data: { version: 2 } }` succeeds.
Malformed/error replies, source failures, already-aborted/in-flight cancellation
and deadline expiry return false, with listener/timer cleanup. A monotonic
reply deadline also rejects synchronous late replies. The public host's real
`createEventBus()` contract is exercised without loading a backend launcher.

`validateAgentSchema(tools: unknown): AgentSchemaStatus` validates the public
`getAllTools(): ToolInfo[]` shape's Agent parameters: an object with required
string `prompt`, `description`, `subagent_type`, optional string `model`,
`thinking`, `resume`, and optional string `schedule` when registered. Native
thinking is a string, not an enum; schedule is absent when scheduling was off
at registration. Missing/throwing catalogue access, ambiguity and malformed
schemas yield not-ready. The serialized schema/description/source metadata is
retained as a change fingerprint, never cryptographic authentication.

`TintinDiscovery.discover(owner, generation, signal?, timeoutMs?)` does no work
until called. One coordinator belongs to one router runtime. Only successful
readiness is cached for the same owner/generation/schema; misses retry on the
next eligible call. Every concurrent probe has independent cancellation.
Changes/reset cancel stale probes; stale replies cannot publish readiness.
`status` rechecks schema without starting a ping. Lifecycle/off/mode/reload
integration must supply changed generations or call `reset()`; this module does
not install lifecycle hooks or a background poller.

## Exact legacy scope, not strict explicit-control scope

`RegistryModel` is `{ provider: string; id: string }`. `ResolvedScope` is
`{ kind: 'unrestricted' } | { kind: 'restricted'; allowed: ReadonlySet<string> }
| { kind: 'unknown'; reason: string }`. Keys are lowercase `provider/id`.
`resolveExactScope(universe, entries)` trims/lowercases entries and matches
literal complete identities against the **full registry universe**. Missing,
empty or zero-resolved entries intentionally mean legacy unrestricted, matching
published Tintin. Globs, bare IDs and thinking-suffix guesses are not resolved;
a colon actually belonging to a registry ID stays literal. This is explicitly
NOT the stricter Pi resolver/glob behavior of the separately approved local
explicit-control patch. Neither resolver replaces the other.

`readRegistryUniverse(registry)` implements the pinned
`registry.getAvailable?.() ?? registry.getAll()` ordering. The public methods
are synchronous; an empty available array never falls back to all. Invalid
methods/results/model identities (including sparse arrays), throws or async
results yield unknown. Unsupported Promise rejections are observed, not accepted
or awaited, so they cannot leak an unhandled source failure into native work.
Model identity snapshots prevent mutable registry objects changing an in-progress
resolution. This universe is not a per-candidate authentication attestation.

`filterExactScope(candidates, scope)` copies unrestricted candidates, intersects
restricted identities, and returns no candidates for unknown. Resolving the
scope against router chains is forbidden: universe A+B, enabled A, chain B
must remain restricted `{A}` with an empty intersection, never unrestricted.
The discriminant/allowed set or unknown reason remains available to future
audit/omission code. No alternate-provider fallback is introduced.

`resolveSettingsScope(context, registry, { agentDir? })` freshly reads
`getAgentDir()/settings.json` and, only with explicit true trust,
`cwd/.pi/settings.json`. A present project enabledModels array wholly replaces
global (including `[]`); an absent field retains global. Denied, absent,
throwing or nonboolean trust is unknown and never permits a project read.
Important source distinction: the published backend's `readEnabledModels(cwd)`
reads project settings unconditionally, without consulting host trust. Therefore
host-denied trust does NOT prove the backend uses global settings alone. A
global A/project B counterexample could otherwise propose A and fail native
validation. Denied trust returns `project-scope-untrusted` rather than inventing
a global-only native scope; this conservatively omits automatic model defaults.
Trust is rechecked around async reads; changes fail closed. ENOENT is missing,
but malformed roots/arrays/JSON and other read errors are unknown, unlike the
backend's silent-error fallback. Tests pass synthetic agent/project directories
and never read personal files.

This is a conservative trusted-settings adaptation: automatic scope constraints
are honored without reading the backend's private in-memory `scopeModels`
toggle. Unknown means omit automatic model injection, not abort native Agent or
repair explicit/definition fields. These checks do not authenticate the backend,
prove a native launch or claim universal agreement with arbitrary host CLI/SDK
settings overrides. The upcoming hook and its native acceptance remain gates.

## Task 6 isolated verification evidence

All runtime commands used the required clean `env -i` /
`verify-sandbox.sh` boundary: read-only workspace, private temporary fixtures,
no personal homes/network/native mounts, installs or commits.

- Initial missing-module witness: `/tmp/jev-sandbox-evidence-egaOtw`; 0 pass,
  2 failures/errors. Not counted as the assertion-based RED witness.
- Assertion-based RED with deliberately inert API skeletons:
  `/tmp/jev-sandbox-evidence-zGMVtC/{red.stdout,red.stderr,process-tree.strace}`;
  23 pass / 19 fail / 42 tests / 2 files. Failures demonstrate absent discovery,
  schema/generation checks and exact scope/layer/registry semantics.
- Initial focused GREEN: `/tmp/jev-sandbox-evidence-zm3TaG`; 42 pass / 0 fail.
- Additional trust-change RED: `/tmp/jev-sandbox-evidence-XO1ush`; 45 pass /
  1 fail, proving a stale trusted read could report unrestricted before rechecks.
- Intermediate collection: `/tmp/jev-sandbox-evidence-nQosGm`; all six gates
  passed before the final denied-trust/native-scope correction.
- Denied-trust safety RED: `/tmp/jev-sandbox-evidence-jE2raY`; 45 pass / 1 fail,
  demonstrating that global-only restricted scope falsely claimed native scope
  when the backend may independently read an unreadable-by-policy project layer.
- Denied-trust correction collection: `/tmp/jev-sandbox-evidence-V1beAP`;
  all six gates passed (46 focused and 340 default tests).
- Sparse-registry RED: `/tmp/jev-sandbox-evidence-3tJuHV`; 46 pass / 1 fail,
  showing that array holes were incorrectly treated as validated model entries.
- Unsupported async-rejection RED: `/tmp/jev-sandbox-evidence-mUGAxn`;
  47 pass / 1 fail, demonstrating an unhandled registry source rejection.
- Final collection: `/tmp/jev-sandbox-evidence-mPfh2s`; `tintin`, default `test`,
  `typecheck`, `baseline`, `reference`, `isolation` all exit 0. Focused: 48 pass /
  2 files / 148 assertions. Default: 342 pass / 15 explicit files / 1794
  assertions; native opt-in tests remain excluded. Typecheck: no diagnostics.
  Baseline: 18 byte-identical vendor files. Reference: unchanged
  31 + 13 + 52 + 12 + 20 + 12 = 140 passes in six separate processes.
  Isolation: 20 cases. Exact `<mode>.stdout`, `<mode>.stderr`, `exits.txt` and
  `process-tree.strace` are retained in the collection directory.

No full-router parity or new native-control compatibility is claimed. Parent
independent rerun and Astra review are still required; all work remains dirty
and uncommitted.
