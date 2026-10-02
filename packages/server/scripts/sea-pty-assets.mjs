// Collect a self-contained node-pty package (JS + native addon + darwin
// spawn-helper) from the @lydell/node-pty-<platform-arch> variant package
// into the SEA asset staging directory.
//
// Why a full package copy instead of just the addon: the SEA loader takes
// over require() for the main script (inlined node-pty probes fail with
// ERR_UNKNOWN_BUILTIN_MODULE, and a Module._load hook cannot intercept them),
// so the terminal service loads node-pty from this released copy on disk via
// createRequire. The @lydell variant resolves its own prebuilds/ directory
// relative to its module location, which makes the released tree
// self-contained.
//
// Released layout (asset key prefix nex-sea-pty/):
//   lib/*.js                 node-pty JS
//   package.json             variant manifest
//   prebuilds/<platform>-<arch>/pty.node + spawn-helper
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { targetParts } from "../../../apps/nex-cli/packages/cli/scripts/sea-targets.mjs";

export const SEA_PTY_ASSET_PREFIX = "nex-sea-pty";

/**
 * Resolve the @lydell variant package directory for the SEA target.
 * pnpm hoists the platform variants to the workspace root node_modules.
 */
function variantPackageDir(repositoryRoot, target) {
  const { releasePlatform, arch } = targetParts(target);
  return resolve(repositoryRoot, "node_modules", "@lydell", `node-pty-${releasePlatform}-${arch}`);
}

function copyDirInto(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirInto(source, target);
    } else {
      copyFileSync(source, target);
    }
  }
}

export const collectSeaPtyAssets = async ({ root: repositoryRoot, stagingDirectory, target }) => {
  const variantDir = variantPackageDir(repositoryRoot, target);
  if (!existsSync(variantDir)) {
    throw new Error(
      `Missing node-pty platform variant package for ${target}: ${variantDir}. Run \`pnpm install\` first.`,
    );
  }
  const prebuildDir = join(variantDir, "prebuilds");
  const platformArch = `${targetParts(target).releasePlatform}-${targetParts(target).arch}`;
  if (!existsSync(join(prebuildDir, platformArch, "pty.node"))) {
    throw new Error(`Missing pty.node in ${join(prebuildDir, platformArch)}`);
  }

  // Stage the package files under nex-sea-pty/... asset keys.
  const stagingRoot = resolve(stagingDirectory);
  mkdirSync(stagingRoot, { recursive: true });
  copyDirInto(join(variantDir, "lib"), join(stagingRoot, "lib"));
  copyFileSync(join(variantDir, "package.json"), join(stagingRoot, "package.json"));
  copyDirInto(prebuildDir, join(stagingRoot, "prebuilds"));

  const assets = {};
  const collect = (relativePath) => {
    const staged = join(stagingRoot, relativePath);
    if (!existsSync(staged)) {
      throw new Error(`Missing staged pty asset: ${staged}`);
    }
    assets[`${SEA_PTY_ASSET_PREFIX}/${relativePath}`] = staged;
  };
  for (const jsFile of readdirSync(join(stagingRoot, "lib"))) {
    collect(join("lib", jsFile));
  }
  collect("package.json");
  for (const entry of readdirSync(join(stagingRoot, "prebuilds"), { withFileTypes: true })) {
    for (const file of readdirSync(join(stagingRoot, "prebuilds", entry.name))) {
      collect(join("prebuilds", entry.name, file));
    }
  }
  return assets;
};
