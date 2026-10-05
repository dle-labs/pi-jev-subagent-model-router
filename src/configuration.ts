import { loadConfig, type JevRouterConfig } from "./core/config";

/** Adapt resource names only; never rewrite policy or environment names. */
export function childConfigText(text: string): string {
  return text.replaceAll("pi-jev-model-router", "pi-jev-subagent-router");
}

export interface ConfigurationContext {
  cwd?: string;
  isProjectTrusted?: () => boolean;
}

/** The upstream merger receives a project path only with explicit trust. */
export function loadConfiguration(context: ConfigurationContext): JevRouterConfig {
  let trusted = false;
  try {
    trusted = context.isProjectTrusted?.() === true;
  } catch {
    // Missing or unavailable trust must not expose the project layer.
  }
  return loadConfig(trusted ? context.cwd : undefined);
}
