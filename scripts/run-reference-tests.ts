import { fileURLToPath } from "node:url";
import { isolatedChild } from "../test/support/isolated-child";

// Byte-identical vendor files, each in a separate runtime and fresh startup HOME.
const suites = ["config", "jev", "router", "budget", "ranking", "extension"] as const;
let status = 0;
for (const suite of suites) {
  const file = fileURLToPath(new URL(`../vendor/pi-jev-model-router/test/${suite}.test.ts`, import.meta.url));
  const isolated = isolatedChild("test", [file]);
  console.log(`\nReference: test/${suite}.test.ts`);
  const child = Bun.spawnSync(isolated.argv, {
    cwd: process.cwd(), env: isolated.env, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  });
  if (child.exitCode !== 0 || child.signalCode) {
    status ||= child.exitCode || 1;
    console.error(`Reference ${suite} failed: exit=${child.exitCode}, signal=${child.signalCode ?? "none"}`);
  }
}
process.exitCode = status;
