import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { isolatedChild } from "../support/isolated-child";

test("actual Pi setter races with execution; idle and denied-auth controls do not", async () => {
  const hostRoot = process.env.PI_PROBE_HOST_ROOT;
  if (!hostRoot) throw new Error("Set PI_PROBE_HOST_ROOT to the Pi package root; integration is not skipped");
  const isolated = isolatedChild("run", [resolve("scripts/child-control-race.ts"), "--host-root", hostRoot]);
  const child = Bun.spawn(isolated.argv, {
    cwd: process.cwd(),
    env: isolated.env,
    stdout: "pipe", stderr: "pipe",
  });
  const watchdog = setTimeout(() => child.kill(), 20_000);
  let stdout: string, stderr: string, exit: number;
  try {
    [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
  } finally { clearTimeout(watchdog); }
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" });
  const report = JSON.parse(stdout);
  expect(report.executionPath).toBe("public-pi-sdk");
  expect(report.safeControlCapabilityVerified).toBe(false);
  expect(report.scenarios.map((s: { assessment: string }) => s.assessment)).toEqual([
    "mutated-during-execution", "mutated-after-intervening-execution", "no-race-observed", "no-race-observed",
  ]);
  expect(report.scenarios.every((s: { parentUnchanged: boolean; globalSettingsUnchanged: boolean; disposed: boolean }) =>
    s.parentUnchanged && s.globalSettingsUnchanged && s.disposed)).toBe(true);
  expect(report.scenarios.every((s: { childTranscriptPreserved: boolean; parentTranscriptUnchanged: boolean; continuationVerified: boolean }) =>
    s.childTranscriptPreserved && s.parentTranscriptUnchanged && s.continuationVerified)).toBe(true);
  expect(report.host.name).toBe("@earendil-works/pi-coding-agent");
  expect(report.host.entrySha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.networkFetchAttempts).toBe(0);
  expect(report.nativeTintinVerified).toBe(false);
}, 30_000);
