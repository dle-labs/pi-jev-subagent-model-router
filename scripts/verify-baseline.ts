import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../vendor/pi-jev-model-router/", import.meta.url));
const commit = "f1a6f0381ef10899319542525f4d53c76c368396";
// Git blob identities from the pinned upstream tree, not from the working copy.
const blobs: Record<string, string> = {
  "LICENSE": "2670264d74f22a3ef3e1701b7b5af23115926a34",
  "README.md": "8127de1f3b405e6464b2d08a6368e3f9d8617c21",
  "extensions/pi-jev-model-router/README.md": "689ffb8e59d22ec392581857f155ffd7a9802841",
  "extensions/pi-jev-model-router/budget.ts": "6aecb9cc388ca2d22ca07ac2a78c92f4b1353cd7",
  "extensions/pi-jev-model-router/config.ts": "1e5a276a4ab9d17be550c70d7f210e5708a52963",
  "extensions/pi-jev-model-router/index.ts": "f599e5e0ee2c86491839df8c5ce54377b468591c",
  "extensions/pi-jev-model-router/jev.ts": "532dc34175b667471940622ef55bd738c34b67a9",
  "extensions/pi-jev-model-router/pi-jev-model-router.example.json": "84a7a1e8c6673bb111a2ee518331e8740af68f82",
  "extensions/pi-jev-model-router/ranking.ts": "7d1525b5dbff26f8374ee8619748072ebd6969ef",
  "extensions/pi-jev-model-router/router.ts": "e2bd1cb835cc3f0deb18bd92824ca77ea57a1164",
  "package.json": "61f4e820db99fbc65ba64c12498a2195a9f731be",
  "test/budget.test.ts": "15cc03cece51108c22402196347026aba32f7755",
  "test/config.test.ts": "a1d8202b78ec0dbd980e3854478929c8aa85ddc4",
  "test/extension.test.ts": "9e92e78d3d174b07c2edeb963b58b2dd2cee5cb3",
  "test/jev.test.ts": "7f4abbb6100eb6b6def4eafac4daf121fbb31c04",
  "test/ranking.test.ts": "8bc85b491b123dfbb5d9f7086273971a791dcf45",
  "test/router.test.ts": "a40ded2b0f332f3e45ad7ca0901b392098f93712",
  "tsconfig.json": "ebe6b2435e94011a2051f3005478997a861d8061",
};
assert(existsSync(join(root, "UPSTREAM_COMMIT")), "Missing pinned Jev baseline (UPSTREAM_COMMIT)");
assert.equal(readFileSync(join(root, "UPSTREAM_COMMIT"), "utf8"), `${commit}\n`);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(manifest.name, "pi-jev-model-router");
assert.equal(manifest.version, "0.6.0");
function files(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), `Unexpected symlink: ${prefix}${entry.name}`);
    const relative = `${prefix}${entry.name}`;
    return entry.isDirectory() ? files(join(directory, entry.name), `${relative}/`) : [relative];
  });
}
assert.deepEqual(files(root).sort(), [...Object.keys(blobs), "UPSTREAM_COMMIT"].sort());
for (const [path, expected] of Object.entries(blobs)) {
  const bytes = readFileSync(join(root, path));
  const actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(actual, expected, `Vendored baseline changed: ${path}`);
}
console.log(`Verified pi-jev-model-router 0.6.0 at ${commit}: ${Object.keys(blobs).length} byte-identical files.`);
