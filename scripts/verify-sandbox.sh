#!/usr/bin/env bash
# Linux verification only. No package installation, network, or personal HOME.
# Invoke with: env -i PATH=/usr/bin:/bin bash scripts/verify-sandbox.sh <command> [args...]
set -euo pipefail
if [[ $# -eq 0 ]]; then
  printf 'Usage: verify-sandbox.sh <command> [args...]\n' >&2
  exit 64
fi
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
# These are executables, not directories containing personal configuration.
bun=${JEV_SANDBOX_BUN:-/home/dle/.bun/bin/bun}
node=${JEV_SANDBOX_NODE:-/home/dle/.nvm/versions/node/v24.11.1/bin/node}
for file in /usr/bin/bwrap /usr/bin/python3 /usr/bin/strace "$bun" "$node"; do
  [[ -x "$file" ]] || { printf 'Missing sandbox executable: %s\n' "$file" >&2; exit 69; }
done
native_args=()
case ${JEV_SANDBOX_NATIVE:-0} in
  0) ;;
  1)
    # Exact reviewed disposable package roots, never their enclosing /tmp or HOME.
    pi=/tmp/jev-native-sync.JqrUv0/pi
    tintin=/tmp/jev-native-sync.JqrUv0/tintin
    runtime=/tmp/jev-patched-runtime-uqtQjr
    roots=("$pi/node_modules" "$tintin/node_modules" "$runtime")
    for package in agent ai coding-agent tui telemetry chord codemode mcp; do
      roots+=("$pi/packages/$package")
    done
    for root in "${roots[@]}"; do
      [[ -d "$root" && ! -L "$root" ]] || { printf 'Missing/indirect native package root: %s\n' "$root" >&2; exit 69; }
      native_args+=(--ro-bind "$root" "$root")
    done
    native_args+=(--setenv JEV_SANDBOX_NATIVE 1
      --setenv PI_PROBE_HOST_ROOT /workspace/node_modules/@earendil-works/pi-coding-agent
      --setenv PI_PATCHED_HOST_ROOT "$pi/packages/coding-agent"
      --setenv PI_PATCHED_TINTIN_ROOT "$runtime")
    ;;
  *) printf 'JEV_SANDBOX_NATIVE must be 0 or 1\n' >&2; exit 64 ;;
esac
evidence=$(mktemp -d /tmp/jev-sandbox-evidence-XXXXXX)
printf 'Sandbox evidence: %s\n' "$evidence"
exec /usr/bin/bwrap --unshare-all --die-with-parent --new-session --clearenv \
  --ro-bind /usr /usr --ro-bind /lib /lib --ro-bind /lib64 /lib64 \
  --symlink usr/bin /bin --symlink usr/sbin /sbin \
  --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /opt \
  --ro-bind "$bun" /opt/bun --ro-bind "$node" /opt/node \
  --ro-bind "$repo" /workspace --tmpfs /workspace/.git \
  --bind "$evidence" /evidence \
  "${native_args[@]}" \
  --setenv PATH /opt:/usr/bin:/bin \
  --setenv HOME /tmp/jev-sandbox/home --setenv USERPROFILE /tmp/jev-sandbox/home \
  --setenv PI_CODING_AGENT_DIR /tmp/jev-sandbox/agent \
  --setenv XDG_CONFIG_HOME /tmp/jev-sandbox/config \
  --setenv XDG_CACHE_HOME /tmp/jev-sandbox/cache \
  --setenv XDG_DATA_HOME /tmp/jev-sandbox/data --setenv PI_OFFLINE 1 \
  --chdir /workspace -- /usr/bin/python3 -I -c '
import errno, os, pathlib, socket, sys
root = pathlib.Path("/tmp/jev-sandbox")
for name in ("home", "agent", "config", "cache", "data"):
    (root / name).mkdir(parents=True)
(root / "bunfig.toml").write_text("[test]\npreload = []\n")
assert not pathlib.Path("/home/dle").exists(), "Personal home exposed"
assert not pathlib.Path("/run/user").exists(), "User services exposed"
assert not pathlib.Path("/workspace/.git/config").exists(), "Git metadata exposed"
if os.environ.get("JEV_SANDBOX_NATIVE") == "1":
    assert not pathlib.Path("/tmp/jev-native-sync.JqrUv0/pi/.git").exists()
    assert not pathlib.Path("/tmp/jev-native-sync.JqrUv0/tintin/.git").exists()
    for key in ("PI_PROBE_HOST_ROOT", "PI_PATCHED_HOST_ROOT", "PI_PATCHED_TINTIN_ROOT"):
        package = pathlib.Path(os.environ[key])
        assert (package / "package.json").is_file(), f"Missing {key} package"
        try:
            fd = os.open(package / ".sandbox-write-check", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
            raise AssertionError(f"Native package writable: {key}")
        except OSError as error:
            assert error.errno == errno.EROFS, error
try:
    pathlib.Path("/workspace/.sandbox-write-check").write_text("forbidden")
    raise AssertionError("Workspace must be read-only")
except OSError as error:
    assert error.errno == errno.EROFS, error
with socket.socket() as connection:
    connection.settimeout(1)
    try:
        connection.connect(("192.0.2.1", 80))
        raise AssertionError("External network reachable")
    except OSError as error:
        assert error.errno == errno.ENETUNREACH, error
print("Sandbox guard passed: home absent, workspace read-only, network unreachable", flush=True)
args = ["/usr/bin/strace", "-f", "-qq", "-s", "256", "-e", "trace=%file,%network,%process", "-o", "/evidence/process-tree.strace", "--", *sys.argv[1:]]
os.execv(args[0], args)
' "$@"
