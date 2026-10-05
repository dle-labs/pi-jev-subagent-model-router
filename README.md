# Jev subagent model router

Private/local Pi extension adapting [pi-jev-model-router](https://github.com/da-vinci-noob/pi-jev-model-router) **0.6.0**, commit `f1a6f0381ef10899319542525f4d53c76c368396`, copyright Shah Rukh, MIT. [LICENSE](LICENSE) and [NOTICE](NOTICE) preserve source attribution; `vendor/` contains 18 immutable baseline files plus provenance. The original repository origin/history are preserved; no hosted fork/distribution has been created.

**Implementation and final review are complete within the approved local-patched scope.** See [final acceptance and verification](docs/final-acceptance.md) and the [30-row reconciliation](docs/feature-parity.md). Published retained-child atomic control remains unsupported; hosted CI execution remains unverified. The support boundaries below still apply.

## Support and loading

Only **`@tintinweb/pi-subagents@0.19.0` with Pi 1.0.0** is measured. The unscoped package and other versions/backends are not supported by this evidence.

- Published pins: actual immediate native Agent launches/observation verified within documented limits. Strict retained-child scope resolver and atomic controls are **unsupported**. Published capability gate 3B intentionally exits **2**.
- Explicitly assembled archived local patched runtime: real supported-lifecycle atomic control gates, controller and extension-factory tests. [Prerequisite patches/provenance](upstream-patches/README.md) are **not** published or installed replacements. No automatic patching/upgrading of installed packages.
- Same-record SDK replacement/ownership transfer are user-approved N/A, not passing native transitions. Background→foreground resume with conflicting old tool-call correlation remains unsupported.

The only entry is `extensions/pi-jev-subagent-router/index.ts`, importing local modules, never the vendored parent factory. This private repository can later be loaded using Pi's local extension entry option:

```sh
pi -e /absolute/path/to/pi-jev-subagent-model-router/extensions/pi-jev-subagent-router/index.ts
```

If Tintin is missing, the extension warns and leaves native input intact. A user may later choose installation separately:

```sh
pi install npm:@tintinweb/pi-subagents
```

That command is guidance, **not executed here**, and the unversioned install does not establish the pinned compatibility above. Retained apply/revert require the separately reviewed local patched public runtime, not merely installing the published package. Exact dependency pins, private packaging and host-provided peers remain unchanged.

## Automatic routing

Ordinary immediate top-level native `Agent` calls are intercepted once through the public tool-call hook. Only independently omitted model/thinking fields receive proposed defaults. Explicit caller values (including thinking `off`) remain untouched; Tintin's authored definition fields independently take precedence over caller defaults. Both explicit caller fields skip classification. Empty resume/schedule placeholders remain new tasks; actual resume/schedule operations are not classified.

No parent model/thinking setter, second child launch or prompt injection is used. Native fake-provider tests measure actual child execution counts, parent pair/settings invariance and native receipts; these are bounded verification, not a guarantee against arbitrary other extensions. Automatic internal workflows, schedules, mentions, RPC/nested launches and child runtimes without this extension are **not guaranteed** coverage.

Policy retains typed task judgments, confidence guards and kind floors; demand is `0.55×complexity + 0.45×capability`, reasoning nudges/clamping, quick/standard/high/premium and opt-in xpremium; ordered nearest-tier fallback; minTier/priority specialists; mixed-provider defaults and thinking pins; free prefer/fallback-only exact pools; ranking cutoffs, effective price/unknown-price ordering and provider spreading. Exact provider matching deliberately prevents upstream same-ID provider substitution. See [policy corrections/differential evidence](docs/policy-adaptations.md).

Fresh launches and `why` evaluate **cold original-launch context**, never the parent's warm cache. Explicit `apply` uses the verified retained child's actual model/context, cache penalty/deadband/big-upgrade rules and stickiness. A proposed initial default is not an actual model switch and creates no revert history.

## Commands and recommendation tool

- `/jev-subagent-router [status]`: availability, modes, complete chains/specialists/free pool, observed children, reported spend/gaps and last decision.
- `on`, `off`, `mode auto|confirm|notify`: session-only changes; off cancels old work. Auto fills defaults, notify recommends only; confirm offers selected/cheaper/keep. Without interactive selection confirm explicitly degrades to auto; failed interactive UI does not silently authorize a switch.
- `budget [daily|monthly USD]`: show/change session-local advisory caps. Nonpositive caps are inactive.
- `why`: **reclassify** the most recent eligible immediate native child task, without launching, submitting text or switching. Complete new projected judgment/trace and durable Jev counters use the existing engine. Both-explicit/resume/schedule/nested calls, standalone recommendations and retained apply do not replace that task. No child ID or parent fallback. Bounded 4,096-character prefix plus exact original length, visible truncation. Off is inactive; reload/owner/generation/context invalidation clears raw task memory honestly.
- `suggest [--write]`: rank local scores; preview or atomically update the child generated layer. No-match protects existing bytes; manual layers still win. Xpremium remains manual.
- `apply CHILD_ID [-- TASK]`: explicit idle-child recommendation/control, never submit TASK. Without text use only that exact binding's bounded task prefix. Published unsupported contracts refuse, never raw setters.
- `revert CHILD_ID`: atomically restore a verified prior pair on that same retained idle child after an actual controller switch. No prior snapshot means refusal, not guessed parent defaults.
- `/jev-subagent-route TASK` and read-only tool `jev_subagent_route({request:TASK})`: arbitrary-text recommendation only, no launch/switch.

[Exact grammar, errors, bounded UI and persistence contracts](docs/commands-contracts.md). Expandable non-context cards distinguish proposed from observed/applied settings and expose raw judgment/confidence/probabilities, latency, usage, free/cache/specialist notes. Parent/native results remain native.

## Configuration and disclosure

See the [complete example](examples/pi-jev-subagent-router.example.json). Child filenames are `pi-jev-subagent-router.json`, `.generated.json`, child state/scores resources. Layer order: defaults → generated routes/kinds → manual user → **explicitly trusted** project → valid environment. Empty manual chains clear generated defaults; `useDefaultModels:false` removes built-in chains. Custom taxonomy descriptions/kind floors and pinned thinking are supported.

`JEV_SUBAGENT_ROUTER_MODE/OFF` override compatible `JEV_ROUTER_MODE/OFF`; credentials and endpoint default to `TYPESAFE_API_KEY` / `TYPESAFE_API_URL`, with configured `apiKey`, `apiKeyEnv`, `endpoint`, `endpointEnv` support. Use environment credentials, not example literals. The original parent router uses separate mutable resources; compatibility environment values can affect both unless child overrides are supplied.

**Task text is sent to the configured TypeSafe/Jev endpoint when classification runs.** The client bounds request text to 8,000 characters, reports truncation and rejects redirects. Parent conversation is not sent by default. Raw task memory is bounded and not persisted in branch audit/ledger; sanitized analysis/decision entries may persist. Secrets/raw transport errors are not logged by the routing layer. This is not a guarantee that task content itself contains no secrets: choose tasks/endpoint accordingly. Tests use fake transports, never paid providers.

## Accounting and limitations

Exact decimal persisted buckets/watermarks deduplicate immutable native origins and positive cumulative deltas through replay/reload/concurrent writes. Top-level aggregates include descendants; independently charging them would double-count. **Reported dollars are always pricing-incomplete** on the pinned evidence source: missing costs can become zero, positive subtotals can mix unpriced activity, and no validated full-lifetime/frontier proof exists. Unknown is not zero/free. Component model and late aggregate activity time remain unknown; attribution is visibly incomplete. Budget pressure uses reported totals only; advisory caps can overshoot during concurrent outstanding spend and are not hard live limits/invoice evidence.

No raw-task/why history or controller revert-stack reconstruction after reload. Unknown/evicted origins and strict stale/foreign associations refuse rather than guess. External settings/auth/catalogue changes are rechecked at operation boundaries, not continuously watched. No native complete-pricing fixture or invented unsupported lifecycle is used.

## Confined local verification and CI

Only the approved clean-environment OS sandbox is authorized for this workspace:

```sh
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh test /workspace/test/integration/parity.test.ts
/usr/bin/env -i PATH=/usr/bin:/bin JEV_SANDBOX_NATIVE=1 /bin/bash --noprofile --norc scripts/verify-sandbox.sh /bin/sh /workspace/scripts/isolated.sh native-gates /workspace/test/integration/child-observer.test.ts /workspace/test/integration/child-control.test.ts /workspace/test/integration/extension.test.ts /workspace/test/integration/parity-native.test.ts
```

Reference/baseline/typecheck/isolation/extension (including real offline npm pack dry-run in a disposable copy) use the same wrapper and inner modes. The native command includes the nine native declarations, including `parity-native.test.ts`, and excludes the static `parity.test.ts`; counts are execution receipts, not a universal coverage claim. Do not run ambient Bun/Node/build imports.

### Verification-only CI: manual operator policy, hosted execution UNVERIFIED

Human-approved deviation from in-workflow frozen-lock provisioning: the parent structured decision was **“Verification-only CI (Recommended)”** ([decision and boundary](docs/feature-parity.md#ci-deployment-boundary)). CI verifies trusted preprovisioned frozen-lock inputs; **provisioning is not performed**, and no frozen-lock install execution or full dependency integrity is claimed. `.github/workflows/ci.yml` is manual `workflow_dispatch` only on `self-hosted/linux/jev-reviewed-offline-runtime`. Hosted execution has **not run**; this is not full CI green or Task13 acceptance.

Before any separately authorized dispatch, a trusted operator must offline-prestage an exclusively reserved, reviewed checkout at exactly the intended dispatch `GITHUB_SHA`, with its root/cwd equal to `GITHUB_WORKSPACE`, no tracked changes, untracked files or ignored inputs outside `node_modules`. Stage the pinned lock-resolved dependencies (Pi 1.0.0, Tintin 0.19.0, TypeScript 5.9.3, Bun types 1.3.0), reviewed executables and exact read-only native roots already selected by `scripts/verify-sandbox.sh`: `/tmp/jev-native-sync.JqrUv0/pi` (its dependency directory and eight selected package roots), `/tmp/jev-native-sync.JqrUv0/tintin/node_modules`, and `/tmp/jev-patched-runtime-uqtQjr`. Bun remains `/home/dle/.bun/bin/bun`, Node `/home/dle/.nvm/versions/node/v24.11.1/bin/node`; only those executable files are exposed, never personal HOME. The npm CLI, bwrap, Python, strace and supported Linux kernel/user-namespace/pidfd prerequisites must already exist. No concurrent writer may mutate these inputs during verification.

An external trusted, nonsymlink directory `/tmp/jev-reviewed-ci-inputs` must contain `checkout.sha` (that exact SHA plus newline) and `inputs.sha256` (the exact ordered `sha256sum` output for the workflow preflight's `inputs` array, including its appended package manifests and binaries, generated from the reviewed frozen-lock provisioning result, **not regenerated from an unreviewed runner tree**). This operator attestation binds the lock, checkout, launcher, selected manifests, native method sources and binaries; it is a selected-file freshness check, **not a complete transitive dependency/build integrity proof**. Trust and complete dependency provisioning review remain external prerequisites. Existing baseline and native public-package resolution/capability tests supply their separate measured checks.

Preflight fails on missing/stale attestation or selected inputs, wrong SHA/root, dirty checkout, missing/indirect native roots or missing executables. Native capability/test failures are job failures, never skipped or `continue-on-error`; the published 3B exit **2** remains asserted **unsupported**, not caught as support. All baseline/reference/default/typecheck/isolation/extension/parity and opt-in native/integration/patched runtimes execute through the unchanged clean-environment OS sandbox, read-only mounts and denied networking. No checkout/download/upload actions, installs, keys, writable caches, network artifacts or host runtime fallback. The sandbox prints retained local `/tmp/jev-sandbox-evidence-*` paths with `ci-*.log` and `process-tree.strace`; failing logs stay there for operator inspection. No installs/network/remote CI/publish/commit are authorized here.

[Compatibility execution evidence](docs/compatibility-evidence.md), [isolation boundary](docs/test-isolation.md), and [historical isolation incident](docs/test-isolation-incident.md). Historical personal-file damage remains unknown; do not infer historically zero damage from current passing guards. Existing upstream audit findings remain: Pi **8 high**, Tintin **5 moderate / 2 high**. No automatic dependency upgrade was performed; audit remediation/distribution require separate review.
