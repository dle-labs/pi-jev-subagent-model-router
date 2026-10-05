# Local atomic child-control patches

These are reviewed local patches, not published Pi/Tintin releases. They do not install or replace any user package. The router itself is not implemented by these patches.

| Patch | Exact base | License |
| --- | --- | --- |
| `pi-atomic-configuration.patch` | `a13d35a742c6ef8462812a28fbe1d8c8b7431c32` | `LICENSE.pi` |
| `tintin-atomic-configuration.patch` | `4f572eaa04c09d3dbc16e4a5f13a16b295e84e14` | `LICENSE.tintin` |

The `*-source.json` manifests record origin URLs, SHA-256 patch hashes and all changed files, including tests. Both patches were successfully applied and whitespace-checked on fresh local clones of these exact bases. No remote fork, push, release or commit was performed.

## Apply and build in disposable source checkouts

Set `REPO` to this repository and `PI`/`TINTIN` to clean checkouts at the exact commits above. Do not point these at installed packages.

```bash
git -C "$PI" apply --check "$REPO/upstream-patches/pi-atomic-configuration.patch"
git -C "$PI" apply "$REPO/upstream-patches/pi-atomic-configuration.patch"
git -C "$TINTIN" apply --check "$REPO/upstream-patches/tintin-atomic-configuration.patch"
git -C "$TINTIN" apply "$REPO/upstream-patches/tintin-atomic-configuration.patch"

(cd "$PI" && npm ci --ignore-scripts && npm run check && npm run build:offline)
(cd "$TINTIN" && npm ci --ignore-scripts && env -u PI_E2E_LIVE npm run check && npm run build)
```

Pi's focused tests (from `"$PI/packages/coding-agent"`):

```bash
node ../../node_modules/vitest/dist/cli.js --run \
  test/suite/agent-session-configuration.test.ts \
  test/session-manager-configuration.test.ts \
  test/model-scope-public.test.ts
```

And from `"$PI/packages/agent"`:

```bash
node ../../node_modules/vitest/dist/cli.js --run test/activity-revision.test.ts
```

## Bind the tested dependencies explicitly

Tintin's development lockfile pins Pi 0.84.2. Loading that checkout directly can select its old peer instead of the patched host. Do not interpret that as patched-capability evidence, override methods, or import private APIs.

From this repository:

```bash
bun install --frozen-lockfile --ignore-scripts
bun scripts/prepare-patched-runtime.ts \
  --host-root "$PI/packages/coding-agent" --tintin-root "$TINTIN"
```

The command prints a new `tintinRuntimeRoot`. It copies unchanged Tintin source into a temporary directory and links public Pi packages to the selected built checkout. Other dependencies link to the isolated Tintin checkout. It modifies neither source checkout nor installed packages. The source/dependency directories must remain available while this temporary runtime is used.

```bash
export PI_PATCHED_HOST_ROOT="$PI/packages/coding-agent"
export PI_PATCHED_TINTIN_ROOT=/the/printed/tintinRuntimeRoot
bun run test:patched
bun run probe:safe --host-root "$PI_PATCHED_HOST_ROOT" \
  --tintin-root "$PI_PATCHED_TINTIN_ROOT"
```

The probe reads the package's declared public import export, avoiding Bun's monorepo source aliases for the selected entry. It checks actual dependency paths and public method sources; reference identity is not reliable when an extension loader evaluates the same module separately. No private SDK imports or session method replacement are used.

## Verified results

- Pi: 71 focused configuration/scope tests and four native activity-revision tests independently passed after review fixes; full `npm run check`, offline build and diff check passed.
- Tintin: 107 test files, 2,180 passing tests and seven skipped; lint, typecheck, build and diff check passed. Independent review found no actionable issues in the wrapper scope.
- Router repository: nine unit tests, two published-baseline integration tests, two patched-control tests (160 assertions), typecheck and diff check passed.
- Positive native probe: 15 scenarios, zero intercepted fetch attempts, no paid provider calls, parent model/thinking and global settings preserved, prior transcript entries retained, registry released.

See [the full report](../docs/evidence/patched-child-control.json). Its native commits include in-memory, persisted and glob-scoped changes, receipt replay/conflicting-ID refusal, and native resume on the new model with high thinking. Refusals cover active and completed intervening runs, background resume, manager queue admission, actual compaction, preexisting busy state, cancellation, denied auth, changed/malformed scope, session-switch notification/disposal and stale revision.

## Boundaries

- This verifies local conditional-control contracts, not all router compatibility gates or upstream Jev feature parity.
- Some ownership, replacement, low-level queue/bash and storage-failure cases are covered by focused SDK/wrapper tests rather than every native end-to-end combination.
- Receipts are bounded and process-local. Cooperative APIs do not isolate hostile extensions, arbitrary direct state writes or multiple owners of the same session file. Atomic file replacement does not fsync the containing directory.
- Baseline dependency audits reported eight high findings for Pi; five moderate and two high for Tintin. No automatic upgrades were made. npm configuration and a Vite configuration warning remain baseline tooling warnings.
- Maintained remote forks, upstream contribution and installation require separate approval. Neither published baseline currently supplies this complete contract.
