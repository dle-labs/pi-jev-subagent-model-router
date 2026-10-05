import { fileURLToPath } from "node:url";
import { validateIsolation } from "./agent-dir-preload";

// Python is the first child; it allocates a distinct startup HOME before Bun.
export function isolatedChild(mode: "run" | "test", paths: string[]) {
  validateIsolation();
  const env = { ...process.env };
  delete env.PI_JEV_TEST_ISOLATED_ROOT;
  return {
    argv: ["/usr/bin/python3", "-I", fileURLToPath(new URL("../../scripts/isolated-runtime.py", import.meta.url)),
      "--bun", process.execPath, mode, ...paths],
    env,
  };
}
