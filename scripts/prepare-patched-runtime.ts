// Assemble a disposable integration dependency graph. No installed package or source is modified.
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--host-root" || args[2] !== "--tintin-root") {
  throw new Error("Usage: bun scripts/prepare-patched-runtime.ts --host-root PATCHED_PI_PACKAGE --tintin-root PATCHED_TINTIN_CHECKOUT");
}
const hostRoot = resolve(args[1]), tintinRoot = resolve(args[3]);
const base = pathToFileURL(join(hostRoot, "package.json")).href;
const sdkPackages = ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"];
const overrides = new Map<string, string>();
for (const name of sdkPackages) {
  const specifier = `@earendil-works/${name}`;
  const entry = fileURLToPath(import.meta.resolve(specifier, base));
  let current = dirname(entry);
  while (true) {
    let pkg: { name?: string } | undefined;
    try { pkg = JSON.parse(await readFile(join(current, "package.json"), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (pkg?.name === specifier) break;
    if (dirname(current) === current) throw new Error(`Cannot locate public package root: ${specifier}`);
    current = dirname(current);
  }
  overrides.set(specifier, current);
}
if (overrides.get("@earendil-works/pi-coding-agent") !== hostRoot) throw new Error("Host resolution differs from requested package root");
const tintinPackage = JSON.parse(await readFile(join(tintinRoot, "package.json"), "utf8"));
if (tintinPackage.name !== "@tintinweb/pi-subagents") throw new Error("Unexpected Tintin source package");
// Dependencies must have been installed explicitly with scripts disabled before assembly.
const modules = await readdir(join(tintinRoot, "node_modules"));
const runtimeRoot = await mkdtemp(join(tmpdir(), "jev-patched-runtime-"));
await cp(join(tintinRoot, "src"), join(runtimeRoot, "src"), { recursive: true });
for (const file of ["package.json", "README.md", "LICENSE"]) await cp(join(tintinRoot, file), join(runtimeRoot, file));
await mkdir(join(runtimeRoot, "node_modules"));
const linked = new Set<string>();
for (const entry of modules) {
  if (entry.startsWith("@")) {
    await mkdir(join(runtimeRoot, "node_modules", entry));
    for (const name of await readdir(join(tintinRoot, "node_modules", entry))) {
      const specifier = `${entry}/${name}`;
      await symlink(overrides.get(specifier) ?? join(tintinRoot, "node_modules", specifier), join(runtimeRoot, "node_modules", specifier), "dir");
      linked.add(specifier);
    }
  } else {
    await symlink(join(tintinRoot, "node_modules", entry), join(runtimeRoot, "node_modules", entry));
  }
}
for (const [specifier, target] of overrides) {
  if (!linked.has(specifier)) {
    await mkdir(join(runtimeRoot, "node_modules", dirname(specifier)), { recursive: true });
    await symlink(target, join(runtimeRoot, "node_modules", specifier), "dir");
  }
}
const manifest = { hostRoot, tintinSource: tintinRoot, tintinRuntimeRoot: runtimeRoot, sdkPackages: Object.fromEntries(overrides),
  note: "Unchanged copied Tintin source with explicit public package links; dependency assembly only, no API replacement." };
await writeFile(join(runtimeRoot, "integration-runtime.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
