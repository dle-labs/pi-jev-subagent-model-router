import { validateIsolation } from "./agent-dir-preload";
validateIsolation();
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
const { configPaths, DEFAULT_CONFIG } = await import("../../src/core/config");
const { loadConfiguration } = await import("../../src/configuration");
const { writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } = await import("node:fs");
const { join, dirname } = await import("node:path");
const { homedir, tmpdir } = await import("node:os");
const agentDir = getAgentDir();
const paths = configPaths();
const expected = {
  global: join(agentDir, "pi-jev-subagent-router.json"),
  generated: join(agentDir, "pi-jev-subagent-router.generated.json"),
  scores: join(agentDir, "pi-jev-subagent-router.scores.json"),
  state: join(agentDir, "pi-jev-subagent-router-state.json"),
};
// Write only synthetic resources through returned paths, not production commands.
const cwd = mkdtempSync(join(tmpdir(), "resource-project-"));
try {
  mkdirSync(dirname(paths.global), { recursive: true });
  writeFileSync(paths.generated, JSON.stringify({ routes: { standard: [{ provider: "fixture", model: "generated" }] } }));
  writeFileSync(paths.global, JSON.stringify({ timeoutMs: 987 }));
  writeFileSync(DEFAULT_CONFIG.ranking.scoresFile, JSON.stringify({ models: {} }));
  writeFileSync(DEFAULT_CONFIG.stateFile, JSON.stringify({ synthetic: true }));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(join(cwd, ".pi", "pi-jev-subagent-router.json"), JSON.stringify({ timeoutMs: 123 }));
  const config = loadConfiguration({ cwd, isProjectTrusted: () => false });
  console.log(JSON.stringify({ agentDir, startupAgentDir: process.env.PI_CODING_AGENT_DIR, home: homedir(), paths, scores: DEFAULT_CONFIG.ranking.scoresFile, state: DEFAULT_CONFIG.stateFile, writes: Object.values(expected).map(existsSync), generatedRoute: config.routes.standard, timeoutMs: config.timeoutMs, legacyExists: existsSync(join(homedir(), ".pi", "agent", "pi-jev-model-router.json")) }));
} finally {
  for (const path of [paths.global, paths.generated, DEFAULT_CONFIG.ranking.scoresFile, DEFAULT_CONFIG.stateFile]) rmSync(path, { force: true });
  rmSync(cwd, { recursive: true, force: true });
}
