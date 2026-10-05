# Local upstream synchronization work

**The local safe-control prerequisite is complete and verified.** The router itself and its full parity gates are not complete. Installed packages are unchanged; no remote fork, push, publication or commit occurred.

Durable deliverables, licenses, patch hashes and reproduction instructions are in [`upstream-patches/`](../upstream-patches/README.md). The full positive native report is [`evidence/patched-child-control.json`](evidence/patched-child-control.json).

## Pinned workspaces

| Package | Baseline | Local source workspace |
| --- | --- | --- |
| Pi coding agent 1.0.0 | `a13d35a742c6ef8462812a28fbe1d8c8b7431c32` | `/tmp/jev-native-sync.JqrUv0/pi` |
| Tintin subagents 0.19.0 | `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14` | `/tmp/jev-native-sync.JqrUv0/tintin` |

The installed Pi `dist/core/agent-session.js.map` embeds source identical to the pinned baseline `packages/coding-agent/src/core/agent-session.ts`. Baseline source SHA-256: `11ce7b78ee9d4235f2cdc80632332c93935ad23d7e5d68fe1aa5b155e1a297c0`.

The positive integration used `/tmp/jev-patched-runtime-uqtQjr`, an unchanged source copy of patched Tintin with explicit public dependency links to the selected Pi workspace. `scripts/prepare-patched-runtime.ts` recreates this assembly without changing installed packages or source dependencies. Test reports check resolved dependency paths and public method source equality; extension-loader module copies do not necessarily share constructor reference identity. The selected SDK entry comes from its declared package import export rather than a monorepo tsconfig source alias.

## Implemented contracts

Pi owns conditional idle model/thinking commit, native execution/admission revisions, target/auth validation, cancellation, bounded idempotent receipts and transcript publication. Authentication does not reserve the child. Intervening activity invalidates the operation even when the child is idle again before authentication returns.

The session manager stages both existing configuration entry types and, for persisted histories, an entire same-directory replacement file. It verifies manager-owned invariants before and after the final synchronous caller guard, then publishes disk and memory without an intervening await. Independent review caught and regression-tested reentrant transcript appends and completed bash/low-level queue activity. These fixes are included in the archived patch.

Tintin owns authoritative creation ownership, active context/registry identity, record/session association, native manager admission generations and current strict model scope. It exposes the three documented registry methods rather than a replacement launcher. Foreground/background resumes share reentry guards. Session switches invalidate pending control even if cancelled; stale root ownership cannot authorize a surviving record.

Scope uses the complete current public registry universe and Pi's newly public synchronous resolver. Unlike legacy Tintin launch helpers, it does not turn unresolved restrictions into unrestricted access, swallow malformed settings or use a scope cache detached from registry identity. Legacy launch scope behavior remains unchanged.

## Verification

- Pi initial implementation: 59 focused tests passed; independent review found two gaps. After fixes, foreground verification passed 71 configuration/scope tests plus four native activity-revision tests, full check, fresh offline build and diff check.
- Tintin: foreground-initiated full check passed 107 files / 2,180 tests, with seven skips; build and diff check passed. Independent read-only review found no actionable findings.
- Main repository: typecheck, nine unit tests (17 assertions), two unchanged negative-control integrations (50 assertions) and two patched-control tests (160 assertions) passed.
- Positive native report: three committed cases and twelve non-mutating refusals across 15 scenarios; zero intercepted fetch attempts, no paid calls, preserved parent/configuration/history, and registry cleanup.
- Both nine-file patches were applied and whitespace-checked on fresh local clones of their pinned bases. New test files are included, not omitted as untracked files.

The positive test began red before its script existed. Integration then exposed concrete fixture issues: the old dev peer was selected, the new API's auth barrier belongs in `resolve` rather than legacy `check`, and detached spawn acknowledgement can precede SDK creation. The fixture now binds dependencies explicitly and waits for actual background stream startup before requiring a retained SDK session. No production API was replaced and no race assertion was weakened.

## Limits and remaining project work

The report establishes the local conditional-control contract, not full router feature parity, all precedence/launch cases, or the full gates 3A/3B. Wrapper ownership/replacement and some SDK storage/queue failure combinations have focused test coverage rather than every native combination. Scope and receipt refusal must never be interpreted as an implicit rollback.

Receipt retention is bounded and process-local; arbitrary direct state writes, malicious in-process extensions and concurrent owners of a session file are excluded. Atomic replacement does not fsync the containing directory.

Dependency installation used `npm ci --ignore-scripts`. Baseline audit findings remain: Pi eight high; Tintin five moderate and two high. Existing npm configuration and Vite configuration warnings were recorded, not suppressed through source changes or automatic dependency upgrades.

Next project work is the reviewed full-router implementation and broader compatibility/parity gates. Maintained forks, upstream publication and installed-runtime changes still require separate approval.
