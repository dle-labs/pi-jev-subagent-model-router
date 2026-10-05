import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedChild } from "../support/isolated-child";

test("two fresh startup agent directories isolate all resources and generated writes", async () => {
  const reports = [];
  for (let i = 0; i < 2; i++) {
    const child = isolatedChild("run", [fileURLToPath(new URL("../support/configuration-resources.ts", import.meta.url))]);
    const proc = Bun.spawn(child.argv, { env: child.env, stdout: "pipe", stderr: "pipe" });
    const [out, err, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ exit, err }).toEqual({ exit: 0, err: "" });
    reports.push(JSON.parse(out));
  }
  expect(reports[0].agentDir).not.toBe(reports[1].agentDir);
  for (const r of reports) {
    expect(r.agentDir).toBe(r.startupAgentDir);
    expect(r.agentDir).not.toBe(join(r.home, ".pi", "agent"));
    expect(r.paths).toEqual({ global: join(r.agentDir, "pi-jev-subagent-router.json"), generated: join(r.agentDir, "pi-jev-subagent-router.generated.json") });
    expect(r.scores).toBe(join(r.agentDir, "pi-jev-subagent-router.scores.json"));
    expect(r.state).toBe(join(r.agentDir, "pi-jev-subagent-router-state.json"));
    expect(r.writes).toEqual([true, true, true, true]);
    expect(r.generatedRoute).toEqual([{ provider: "fixture", model: "generated" }]);
    expect(r.timeoutMs).toBe(987);
    expect(r.legacyExists).toBe(false);
    expect(existsSync(dirname(r.agentDir))).toBe(false);
  }
}, 20_000);
