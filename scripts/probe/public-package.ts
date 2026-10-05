import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Read the declared import export rather than accepting monorepo tsconfig aliases
// (Bun's import.meta.resolve can map a package's own name to src/index.ts).
export async function declaredPublicEntry(root: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const exported = pkg.exports?.["."];
  const entry = typeof exported === "string" ? exported : exported?.import;
  if (typeof entry !== "string" || !entry.startsWith("./")) throw new Error(`No public import export: ${pkg.name}`);
  return resolve(root, entry);
}

export async function dependencyPackageRoot(name: string, fromRoot: string): Promise<string> {
  const entry = fileURLToPath(import.meta.resolve(name, pathToFileURL(join(fromRoot, "package.json")).href));
  let root = dirname(entry);
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      if (pkg.name === name) return root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(root) === root) throw new Error(`No package root for ${name}`);
    root = dirname(root);
  }
}
