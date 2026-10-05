import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";

// Validator only: never mutate HOME, spawn/replay argv, or exit an importing program.
// The non-Bun outer launcher establishes this environment before runtime startup.
export function validateIsolation(): string {
  const root = process.env.PI_JEV_TEST_ISOLATED_ROOT;
  if (!root || !isAbsolute(root) || !basename(root).startsWith("jev-core-test-")) {
    throw new Error("Missing/invalid isolation marker; use the non-Bun outer launcher");
  }
  const expected: Record<string, string> = {
    HOME: join(root, "home"), USERPROFILE: join(root, "home"),
    PI_CODING_AGENT_DIR: join(root, "agent"), XDG_CONFIG_HOME: join(root, "config"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"),
  };
  if (homedir() !== expected.HOME || Object.entries(expected).some(([key, value]) => process.env[key] !== value) ||
      Object.values(expected).some(path => !statSync(path).isDirectory()) || process.env.PI_OFFLINE !== "1") {
    throw new Error("Invalid startup isolation/cached home; refusing imports");
  }
  return root;
}
validateIsolation();
if (import.meta.main) {
  throw new Error("Validator is not a launcher; explicit suites/scripts required");
}
