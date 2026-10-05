import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { configPaths, DEFAULT_CONFIG, loadConfig } from "../../src/core/config";

const keys = ["JEV_ROUTER_MODE", "JEV_ROUTER_OFF", "JEV_SUBAGENT_ROUTER_MODE", "JEV_SUBAGENT_ROUTER_OFF"];
let saved: Record<string, string | undefined>;
let cwd: string;
const target = { provider: "fixture", model: "synthetic", thinkingLevel: "high" as const };
function project(patch: unknown) {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "pi-jev-subagent-router.json"), JSON.stringify(patch));
}
function resource(path: string, patch: unknown) { writeFileSync(path, JSON.stringify(patch)); }
beforeEach(() => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  cwd = mkdtempSync(join(tmpdir(), "child-config-"));
});
afterEach(() => {
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  for (const file of ["pi-jev-subagent-router.json", "pi-jev-subagent-router.generated.json"]) rmSync(join(getAgentDir(), file), { force: true });
  rmSync(cwd, { force: true, recursive: true });
});

test("mutable resources use the public agent directory and child namespace", () => {
  expect(configPaths(cwd)).toEqual({ global: join(getAgentDir(), "pi-jev-subagent-router.json"), generated: join(getAgentDir(), "pi-jev-subagent-router.generated.json"), project: join(cwd, ".pi", "pi-jev-subagent-router.json") });
  expect(DEFAULT_CONFIG.stateFile).toBe(join(getAgentDir(), "pi-jev-subagent-router-state.json"));
  expect(DEFAULT_CONFIG.ranking.scoresFile).toBe(join(getAgentDir(), "pi-jev-subagent-router.scores.json"));
});

test("defaults, generated, user, trusted project, env retain upstream merge ordering", async () => {
  const { loadConfiguration } = await import("../../src/configuration");
  const paths = { global: join(getAgentDir(), "pi-jev-subagent-router.json"), generated: join(getAgentDir(), "pi-jev-subagent-router.generated.json") };
  resource(paths.generated, { routes: { high: [target], standard: [target], xpremium: [target] }, kindModels: { custom: [target] }, mode: "confirm" });
  resource(paths.global, { useDefaultModels: false, routes: { high: [] }, mode: "notify", taskKinds: { custom: "Custom work" }, ranking: { cutoffs: { premium: 0.9 } } });
  project({ routes: { premium: [target], xpremium: [target] }, kindModels: { custom: [] }, free: { enabled: true, policy: "fallback-only", pool: [target] } });
  process.env.JEV_ROUTER_MODE = "CONFIRM";
  const c = loadConfiguration({ cwd, isProjectTrusted: () => true });
  expect(c.routes).toEqual({ quick: [], standard: [target], high: [], premium: [target], xpremium: [target] });
  expect(c.kindModels).toEqual({ custom: [] });
  expect(c.taskKinds.custom).toBe("Custom work");
  expect(c.ranking.cutoffs).toEqual({ standard: 0.5, high: 0.7, premium: 0.9 });
  expect(c.free).toEqual({ enabled: true, policy: "fallback-only", pool: [target] });
  expect(c.mode).toBe("confirm");
  expect(c.endpoint).toBe(DEFAULT_CONFIG.endpoint);
  expect(c.apiKeyEnv).toBe(DEFAULT_CONFIG.apiKeyEnv);
});

test("trust denied, absent, or throwing never loads the project, including process.cwd", async () => {
  const { loadConfiguration } = await import("../../src/configuration");
  project({ timeoutMs: 123, apiKey: "project-only", enabled: false });
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    for (const context of [{ cwd }, { cwd, isProjectTrusted: () => false }, { cwd, isProjectTrusted: () => { throw new Error("no trust"); } }, {}]) {
      const c = loadConfiguration(context);
      expect(c.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
      expect(c.apiKey).toBeUndefined();
      expect(c.enabled).toBe(true);
    }
    expect(loadConfiguration({ cwd, isProjectTrusted: () => true }).timeoutMs).toBe(123);
  } finally { process.chdir(originalCwd); }
});

test("childConfigText renames only resource strings, leaving policy and legacy env words", async () => {
  const { childConfigText } = await import("../../src/configuration");
  const text = 'pi-jev-model-router.json pi-jev-model-router-state.json JEV_ROUTER_OFF apiKey free xpremium';
  expect(childConfigText(text)).toBe('pi-jev-subagent-router.json pi-jev-subagent-router-state.json JEV_ROUTER_OFF apiKey free xpremium');
});

test("valid child modes outrank legacy modes; invalid child values fall back", () => {
  project({ mode: "notify" });
  process.env.JEV_ROUTER_MODE = "CONFIRM";
  for (const [value, expected] of [["AUTO", "auto"], ["confirm", "confirm"], ["Notify", "notify"]] as const) {
    process.env.JEV_SUBAGENT_ROUTER_MODE = value;
    expect(loadConfig(cwd).mode).toBe(expected);
  }
  process.env.JEV_SUBAGENT_ROUTER_MODE = "invalid";
  expect(loadConfig(cwd).mode).toBe("confirm");
  process.env.JEV_ROUTER_MODE = "invalid";
  expect(loadConfig(cwd).mode).toBe("notify");
});

test("child OFF false/0 cancels legacy OFF but preserves file enabled, with no env writes", () => {
  process.env.JEV_ROUTER_OFF = "1";
  for (const off of ["0", "false"]) {
    process.env.JEV_SUBAGENT_ROUTER_OFF = off;
    expect(loadConfig(cwd).enabled).toBe(true);
    project({ enabled: false });
    expect(loadConfig(cwd).enabled).toBe(false);
    project({ enabled: true });
  }
  for (const off of ["1", "true"]) {
    process.env.JEV_ROUTER_OFF = "0";
    process.env.JEV_SUBAGENT_ROUTER_OFF = off;
    expect(loadConfig(cwd).enabled).toBe(false);
  }
  process.env.JEV_ROUTER_OFF = "true";
  process.env.JEV_SUBAGENT_ROUTER_OFF = "invalid";
  const before = { ...process.env };
  expect(loadConfig(cwd).enabled).toBe(false);
  expect(process.env).toEqual(before);
});
