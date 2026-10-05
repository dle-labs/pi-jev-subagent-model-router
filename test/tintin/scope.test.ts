import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveExactScope, filterExactScope, resolveSettingsScope, readRegistryUniverse } from "../../src/tintin/scope";
const A = { provider: "Permitted", id: "A" }; const B = { provider: "Excluded", id: "B" }; const universe = [A, B];
test("resolve full registry first: disjoint chain never reopens restricted scope", () => {
  const scope = resolveExactScope(universe, [" permitted/a "]); expect(scope.kind).toBe("restricted");
  if (scope.kind === "restricted") expect([...scope.allowed]).toEqual(["permitted/a"]);
  expect(filterExactScope([B], scope)).toEqual([]);
  expect(filterExactScope([{ provider: "PERMITTED", id: "a" }], scope)).toHaveLength(1);
});
for (const entries of [undefined, [], ["missing/model"], ["Permitted/*"], ["A"], ["Permitted/A:high"], [" "]]) {
  test(`legacy absent/zero exact matches is unrestricted: ${JSON.stringify(entries)}`, () => {
    const scope = resolveExactScope(universe, entries); expect(scope.kind).toBe("unrestricted");
    const result = filterExactScope(universe, scope); expect(result).toEqual(universe); expect(result).not.toBe(universe);
  });
}
test("unknown is closed and exact IDs containing colons are not parsed as thinking", () => {
  expect(filterExactScope(universe, { kind: "unknown", reason: "unknown" })).toEqual([]);
  expect(resolveExactScope([{ provider: "p", id: "id:high" }], ["p/id:high"]).kind).toBe("restricted");
});
test("registry uses available even empty; nullish result follows pinned fallback", () => {
  let all = 0; expect(readRegistryUniverse({ getAvailable: () => [], getAll: () => { all++; return universe; } })).toEqual({ kind: "known", models: [] }); expect(all).toBe(0);
  expect(readRegistryUniverse({ getAvailable: () => undefined, getAll: () => universe })).toEqual({ kind: "known", models: universe });
  expect(readRegistryUniverse({ getAll: () => universe })).toEqual({ kind: "known", models: universe });
});
for (const registry of [undefined, {}, { getAll: 1 }, { getAvailable: 1, getAll: () => universe }, { getAll: () => null }, { getAll: () => [null] }, { getAll: () => Array(1) }, { getAll: () => [{ provider: "p", id: 2 }] }, { getAll: () => Promise.resolve(universe) }, { getAll() { throw Error("private"); } }]) {
  test("malformed/unavailable synchronous registry is unknown", () => { expect(readRegistryUniverse(registry).kind).toBe("unknown"); });
}
test("unsupported async registry rejection is observed while scope remains unknown", async () => {
  expect(readRegistryUniverse({ getAll: async () => { throw Error("private"); } }).kind).toBe("unknown");
  await new Promise(resolve => setTimeout(resolve, 2));
});
async function fixture(run: (global: string, cwd: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "tintin-scope-")); const global = join(root, "agent"); const cwd = join(root, "project");
  await mkdir(global); await mkdir(join(cwd, ".pi"), { recursive: true });
  try { await run(global, cwd); } finally { await rm(root, { recursive: true, force: true }); }
}
const registry = { getAll: () => universe };
test("trusted project replaces global; absent field retains it; [] resets unrestricted", async () => fixture(async (agentDir, cwd) => {
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["Permitted/A"] }));
  const ctx = { cwd, isProjectTrusted: () => true };
  expect((await resolveSettingsScope(ctx, registry, { agentDir })).kind).toBe("restricted");
  await writeFile(join(cwd, ".pi/settings.json"), "{}");
  expect(filterExactScope(universe, await resolveSettingsScope(ctx, registry, { agentDir }))).toEqual([A]);
  await writeFile(join(cwd, ".pi/settings.json"), JSON.stringify({ enabledModels: ["Excluded/B"] }));
  expect(filterExactScope(universe, await resolveSettingsScope(ctx, registry, { agentDir }))).toEqual([B]);
  await writeFile(join(cwd, ".pi/settings.json"), '{"enabledModels":[]}'); expect((await resolveSettingsScope(ctx, registry, { agentDir })).kind).toBe("unrestricted");
}));
test("denied trust cannot establish native project scope; unavailable/throwing trust is unknown", async () => fixture(async (agentDir, cwd) => {
  await writeFile(join(agentDir, "settings.json"), '{"enabledModels":["Permitted/A"]}'); await writeFile(join(cwd, ".pi/settings.json"), '{"enabledModels":["Excluded/B"]}');
  const denied = await resolveSettingsScope({ cwd, isProjectTrusted: () => false }, registry, { agentDir });
  expect(denied).toEqual({ kind: "unknown", reason: "project-scope-untrusted" });
  expect(filterExactScope(universe, denied)).toEqual([]);
  for (const isProjectTrusted of [undefined, () => { throw Error("secret"); }]) expect((await resolveSettingsScope({ cwd, isProjectTrusted }, registry, { agentDir })).kind).toBe("unknown");
}));
for (const content of ["no json", "null", "[]", "true", '{"enabledModels":null}', '{"enabledModels":"p/a"}', '{"enabledModels":[1]}']) {
  test(`malformed settings fails closed: ${content}`, async () => fixture(async (agentDir, cwd) => {
    await writeFile(join(agentDir, "settings.json"), content);
    expect((await resolveSettingsScope({ cwd, isProjectTrusted: () => true }, registry, { agentDir })).kind).toBe("unknown");
    await writeFile(join(agentDir, "settings.json"), "{}"); await writeFile(join(cwd, ".pi/settings.json"), content);
    expect((await resolveSettingsScope({ cwd, isProjectTrusted: () => true }, registry, { agentDir })).kind).toBe("unknown");
  }));
}
test("trust changes during asynchronous reads fail closed", async () => fixture(async (agentDir, cwd) => {
  await writeFile(join(agentDir, "settings.json"), '{}'); await writeFile(join(cwd, ".pi/settings.json"), '{"enabledModels":[]}');
  let calls = 0;
  expect((await resolveSettingsScope({ cwd, isProjectTrusted: () => ++calls === 1 }, registry, { agentDir })).kind).toBe("unknown");
}));
test("missing settings okay; read failures unknown; settings and registry refresh each call", async () => fixture(async (agentDir, cwd) => {
  const ctx = { cwd, isProjectTrusted: () => true }; expect((await resolveSettingsScope(ctx, registry, { agentDir })).kind).toBe("unrestricted");
  await mkdir(join(agentDir, "settings.json")); expect((await resolveSettingsScope(ctx, registry, { agentDir })).kind).toBe("unknown"); await rm(join(agentDir, "settings.json"), { recursive: true });
  await writeFile(join(agentDir, "settings.json"), '{"enabledModels":["Permitted/A"]}'); let models = universe; const changing = { getAvailable: () => models, getAll: () => universe };
  expect((await resolveSettingsScope(ctx, changing, { agentDir })).kind).toBe("restricted"); models = [B]; expect((await resolveSettingsScope(ctx, changing, { agentDir })).kind).toBe("unrestricted");
  models = universe; await writeFile(join(agentDir, "settings.json"), '{"enabledModels":["Excluded/B"]}'); expect(filterExactScope(universe, await resolveSettingsScope(ctx, changing, { agentDir }))).toEqual([B]);
  expect((await resolveSettingsScope(ctx, {}, { agentDir })).kind).toBe("unknown");
}));
