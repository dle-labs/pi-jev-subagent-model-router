#!/bin/sh
# Supported only inside the verified Linux sandbox for now. No Bun starts here.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
[ "$#" -gt 0 ] || { printf '%s\n' 'Explicit verification mode required' >&2; exit 64; }
mode=$1
shift
case "$mode" in
  test) set -- test "$repo/test/unit" "$repo/test/core" "$repo/test/configuration" "$repo/test/tintin" "$repo/test/routing" "$repo/test/state" "$repo/test/children" "$repo/test/commands" "$repo/test/ui" "$repo/test/extension" "$repo/test/contracts.test.ts" "$repo/test/integration/parity.test.ts" "$@" ;;
  parity) set -- test "$repo/test/integration/parity.test.ts" "$@" ;;
  contracts) set -- test "$repo/test/contracts.test.ts" "$@" ;;
  core) set -- test "$repo/test/core" "$@" ;;
  configuration) set -- test "$repo/test/configuration" "$@" ;;
  tintin) set -- test "$repo/test/tintin" "$@" ;;
  routing) set -- test "$repo/test/routing" "$@" ;;
  state) set -- test "$repo/test/state" "$@" ;;
  children) set -- test "$repo/test/children" "$@" ;;
  commands) set -- test "$repo/test/commands" "$@" ;;
  ui) set -- test "$repo/test/ui" "$@" ;;
  extension) set -- test "$repo/test/extension" "$@" ;;
  integration) set -- test "$repo/test/integration" "$@" ;;
  patched) set -- test "$repo/test/patched" "$@" ;;
  native-gates) set -- test "$repo/test/integration/tintin-public-api.test.ts" "$repo/test/integration/child-control-capability.test.ts" "$@" ;;
  compatibility) set -- run "$repo/scripts/compatibility-probe.ts" "$@" ;;
  capability) set -- run "$repo/scripts/child-control-capability-probe.ts" "$@" ;;
  reference) set -- run "$repo/scripts/run-reference-tests.ts" "$@" ;;
  baseline) set -- run "$repo/scripts/verify-baseline.ts" "$@" ;;
  race) set -- run "$repo/scripts/child-control-race.ts" "$@" ;;
  safe) set -- run "$repo/scripts/child-control-safe.ts" "$@" ;;
  typecheck) set -- typecheck "$@" ;;
  isolation) exec /usr/bin/python3 -I "$repo/test/isolation/launcher_test.py" "$@" ;;
  *) printf '%s\n' 'Unsupported verification mode' >&2; exit 64 ;;
esac
exec /usr/bin/python3 -I "$repo/scripts/isolated-runtime.py" --bun /opt/bun "$@"
