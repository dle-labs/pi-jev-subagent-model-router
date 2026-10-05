# Public SDK child-control race reproduction

## Scope

This is a diagnostic negative control against the actual installed Pi SDK, with an additional verified foreground native Tintin Agent spawn/resume path. It is not the complete Task 3A launch gate, the Task 3B safe-control capability gate, or a production controller.

The fixture first completes a child task, then uses a public `AgentSession.prompt()` continuation while `AgentSession.setModel()` is suspended in a fake provider's public `auth.apiKey.check` callback. It never monkey-patches the session, imports private SDK modules, calls a real model, or substitutes a fake session implementation.

## Tested baseline

- Host: `@earendil-works/pi-coding-agent@1.0.0` from the existing local installation.
- Runtime: Bun 1.4.2.
- Public entry SHA-256: `5482298b995db935f7b96f5d6056fa1c36ac6fc80456be594ef65b83c62b0d30`.
- Public `AgentSession.prototype.setModel.toString()` SHA-256 under this runtime: `2b3c1c388ebb91176420ee4a19f7d257d3df7d152082e06fabe629da6ff3454e`.
- Native backend: published `@tintinweb/pi-subagents@0.19.0`, pinned in the development lockfile and loaded unchanged through Pi's public DefaultResourceLoader.
- Tintin `src/index.ts` entry SHA-256: `622d44b11e615ec0509f13e858dcad4a40789e4613c03583930327f15d9ec6a9`.
- These hashes identify the tested entry/setter implementations, not every dependency; version equality alone does not establish identical behavior elsewhere.

## Commands and observed results (historical)

The bare Bun commands below are preserved historical evidence, **not authorized current reproduction instructions**. All current execution must use the outer sandbox described in [test-isolation.md](test-isolation.md) and the [compatibility reproduction instructions](compatibility-evidence.md#reproduction-and-execution-evidence); do not run these ambient commands.

```bash
bun run typecheck
bun run test
PI_PROBE_HOST_ROOT=/home/dle/.pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent \
  bun run test:integration
bun run probe:race --host-root \
  /home/dle/.pi/agent/install/releases/1.0.0/node_modules/@earendil-works/pi-coding-agent
```

After review corrections and native integration: typecheck passed; nine unit tests passed (17 assertions); two integration tests passed (50 assertions). Both integration paths observed all four scenarios:

1. **Active race:** idle snapshot → auth blocked → actual execution starts on `before` → auth released → model `after` observed while `isIdle === false` → execution ends.
2. **Idle ABA race:** idle snapshot → auth blocked → actual execution starts and ends on `before` → auth released → model becomes `after` while idle again. An idle check alone cannot detect this intervening run.
3. **Idle control:** no execution between snapshot and mutation; no race classified.
4. **Denied-auth control:** execution starts, auth fails, model remains `before`; no race classified.

Each case left parent model/thinking and the parent global-settings snapshot unchanged. Original child messages and session entries were preserved, and expected continuation messages were checked. SDK-only parent messages stayed unchanged; native parent messages legitimately gained a model-issued Agent call/result exchange while preserving the earlier transcript. Child file-backed settings live in the temporary directory but are not separately audited for byte-level invariance. Sessions were disposed and temporary state removed. Native shutdown released the public manager registry. Both reports recorded zero intercepted fetch attempts.

The tests were written before implementation: the trace tests initially failed on the unimplemented assessor, and the integration assertion initially failed against a `not-implemented` report. Actual dependency loading then exposed the SDK's ESM-only exports; resolving using import conditions fixed that setup failure without replacing host behavior.

## What this establishes—and does not

The real SDK's existing setter can cross an asynchronous auth boundary and mutate a child after execution has started or completed. This justifies a native conditional commit/revision API rather than pre/post idle checks or a router-local lock.

The native path now establishes the same race through actual foreground Tintin `Agent` spawn/resume. A fake parent provider emits valid tool calls; Pi performs validation and native tool execution, and the public registry supplies the exact child returned by the native receipt. Resume is never called directly on a manager. The test verifies one spawn, one resume (except the idle control), and the same retained SDK session.

Observed integration correction: foreground spawn/resume can leave `record.toolCallId` absent. Correlation therefore uses the exact native tool-result ID, receipt child ID, requested resume child, and retained SDK instance. A conflicting record.toolCallId is rejected when present. Requiring that optional field caused the earlier test failure; correcting the fixture did not remove any race assertions.

Historical direct native diagnostic invocation (superseded; use the required outer sandbox linked above):

```bash
bun run probe:race --host-root "$PI_PROBE_HOST_ROOT" \
  --tintin-root "$PWD/node_modules/@tintinweb/pi-subagents"
```

This evidence does **not** establish background native calls, the full routing/precedence matrix, complete transcript-effect coverage, compaction/queued-work synchronization, atomic model/thinking updates, or a usable safe-control operation. Those remain separate integration requirements. `nativeTintinVerified` distinguishes the two executable modes; `safeControlCapabilityVerified` is always false. A green reproduction is evidence of the existing race, not its repair.

Review corrections also added rejection of contradictory execution-state evidence, parent/child transcript assertions, protected temporary-directory setup, bounded runtime/session acquisition with late disposal, and failure termination for dependency setup that cannot be cancelled. Their regression tests were observed failing before the fixes.
