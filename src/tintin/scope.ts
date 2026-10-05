import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ConfigurationContext } from "../configuration";

export interface RegistryModel { provider: string; id: string }
export type ResolvedScope =
  | { kind: "unrestricted" }
  | { kind: "restricted"; allowed: ReadonlySet<string> }
  | { kind: "unknown"; reason: string };

export function modelKey(model: RegistryModel): string {
  return `${model.provider}/${model.id}`.toLowerCase();
}

/** Published Tintin 0.19.0 legacy scope, NOT the local explicit-control resolver.
 * Always pass the complete backend registry universe, never a routing subset.
 * Literal colons belong to IDs; no glob/bare-ID/thinking-suffix interpretation.
 */
export function resolveExactScope(universe: readonly RegistryModel[], entries: readonly string[] | undefined): ResolvedScope {
  const keys = new Set(universe.map(modelKey));
  const allowed = new Set<string>();
  for (const entry of entries ?? []) {
    const key = entry.trim().toLowerCase();
    if (key.includes("/") && keys.has(key)) allowed.add(key);
  }
  // Intentional legacy no-match behavior, not a strict allowlist fail-open.
  return allowed.size ? { kind: "restricted", allowed } : { kind: "unrestricted" };
}

export function filterExactScope<T extends RegistryModel>(candidates: readonly T[], scope: ResolvedScope): T[] {
  if (scope.kind === "unknown") return [];
  if (scope.kind === "unrestricted") return [...candidates];
  return candidates.filter(model => scope.allowed.has(modelKey(model)));
}

export type RegistryUniverse = { kind: "known"; models: readonly RegistryModel[] } | { kind: "unknown"; reason: string };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Public ModelRegistry methods are synchronous. Empty available is authoritative.
 * This is a scope universe, not an attestation of per-candidate authentication.
 */
export function readRegistryUniverse(registry: unknown): RegistryUniverse {
  try {
    if (!object(registry) || typeof registry.getAll !== "function" ||
        (registry.getAvailable !== undefined && typeof registry.getAvailable !== "function")) {
      return { kind: "unknown", reason: "registry-unavailable" };
    }
    const models: unknown = registry.getAvailable?.call(registry) ?? registry.getAll.call(registry);
    // Async results violate the public synchronous contract. Observe rejection
    // without awaiting/accepting them or leaking a source error into native work.
    if (models instanceof Promise) void models.catch(() => {});
    if (!Array.isArray(models) || !Array.from(models).every(model => object(model) &&
      typeof model.provider === "string" && model.provider.trim().length > 0 &&
      typeof model.id === "string" && model.id.trim().length > 0)) {
      return { kind: "unknown", reason: "registry-malformed" };
    }
    // Snapshot identities, so a mutable registry cannot change this resolution.
    return { kind: "known", models: models.map(({ provider, id }) => ({ provider, id })) };
  } catch {
    return { kind: "unknown", reason: "registry-read-failed" };
  }
}

async function enabledModels(path: string): Promise<readonly string[] | undefined> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (object(error) && error.code === "ENOENT") return undefined;
    throw new Error("settings-read-failed");
  }
  const settings: unknown = JSON.parse(text);
  if (!object(settings)) throw new Error("settings-malformed");
  if (!Object.hasOwn(settings, "enabledModels")) return undefined;
  const entries = settings.enabledModels;
  if (!Array.isArray(entries) || !entries.every(entry => typeof entry === "string")) throw new Error("settings-malformed");
  return entries;
}

/** Fresh trusted settings + full registry on every call. No backend private imports,
 * in-memory scope toggle, host scopedModels/glob resolver, or candidate auth claim.
 * Tintin reads project settings even when the host denies project trust. Neither
 * denied nor unavailable trust establishes native scope without a forbidden
 * project read, so both remain unknown rather than guessing global-only scope.
 */
export async function resolveSettingsScope(
  context: ConfigurationContext,
  registry: unknown,
  options: { agentDir?: string } = {},
): Promise<ResolvedScope> {
  try {
    const trusted: unknown = context.isProjectTrusted?.();
    if (trusted !== true && trusted !== false) return { kind: "unknown", reason: "trust-unavailable" };
    if (!trusted) return { kind: "unknown", reason: "project-scope-untrusted" };
    if (typeof context.cwd !== "string" || !context.cwd) return { kind: "unknown", reason: "project-path-unavailable" };
    const global = await enabledModels(join(options.agentDir ?? getAgentDir(), "settings.json"));
    if (context.isProjectTrusted?.() !== trusted) return { kind: "unknown", reason: "trust-changed" };
    const project = await enabledModels(join(context.cwd, ".pi", "settings.json"));
    if (context.isProjectTrusted?.() !== trusted) return { kind: "unknown", reason: "trust-changed" };
    const universe = readRegistryUniverse(registry);
    if (universe.kind === "unknown") return universe;
    return resolveExactScope(universe.models, project ?? global);
  } catch {
    return { kind: "unknown", reason: "scope-read-failed" };
  }
}
