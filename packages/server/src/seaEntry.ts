/**
 * SEA (Node single executable) entry: one binary, two roles.
 *
 * - Default (HTTP server): boots entry-http, after releasing the embedded
 *   agent bundle and pointing the agent command back at this very binary
 *   (via the NEX_AGENT_SERVER_COMMAND env override chain).
 * - NEX_SEA_AGENT_ROLE=1: runs as the agent child process, spawned by this
 *   same binary (a single file has no standalone node executable to spawn).
 *   The released nex.cjs is loaded and enters the CLI app-server --stdio loop.
 *
 * The agent's runtime assets (playwright/koffi/official plugins/bundled
 * skills/runtime tools) are read by the stock CLI SEA asset mechanism
 * (node:sea getRawAsset -> released into the user cache directory); the
 * packaging script (scripts/build-sea.mjs) embeds them under the same asset
 * keys the CLI SEA uses.
 */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getRawAsset, isSea } from "node:sea";

const AGENT_BUNDLE_ASSET_KEY = "nex-sea-agent/nex.cjs";
const PTY_ASSET_PREFIX = "nex-sea-pty/";
// 释放后的入口固定是 <released>/lib/index.js（asset key 见 listPtyAssetKeys）。
const PTY_ENTRY_RELATIVE_PATH = "lib/index.js";

/** Release directory for the agent bundle: data dir first (server setups set NEX_DATA_BASE_DIR), else the user cache. */
function agentRuntimeDirectory(): string {
  const dataBase = process.env.NEX_DATA_BASE_DIR?.trim();
  if (dataBase) return join(dataBase, "sea-agent");
  const home = process.env.HOME?.trim() || process.cwd();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Caches", "nex", "sea-agent");
    case "win32":
      return join(
        process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"),
        "nex",
        "sea-agent",
      );
    default:
      return join(process.env.XDG_CACHE_HOME?.trim() || join(home, ".cache"), "nex", "sea-agent");
  }
}

/**
 * Release directory for the node-pty package: next to the released agent
 * bundle so both share the data-dir/cache resolution and fingerprinting.
 */
function ptyRuntimeDirectory(): string {
  return join(agentRuntimeDirectory(), "..", "pty");
}

function assetFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * Release the embedded nex.cjs to disk (idempotent: the fingerprint directory
 * is reused when present). Synchronous on purpose: server mode must have the
 * bundle in place before spawning the agent, agent mode before the CLI reads
 * any arguments.
 */
function releaseAgentBundle(sea: { getRawAsset: (key: string) => ArrayBuffer }): string {
  const bytes = Buffer.from(sea.getRawAsset(AGENT_BUNDLE_ASSET_KEY));
  const targetDirectory = join(agentRuntimeDirectory(), assetFingerprint(bytes));
  const targetPath = join(targetDirectory, "nex.cjs");

  if (existsSync(targetPath)) {
    return targetPath;
  }

  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(temporaryPath, bytes);
  chmodSync(temporaryPath, 0o755);
  renameSync(temporaryPath, targetPath);
  return targetPath;
}

/**
 * Release the embedded self-contained node-pty package (JS + native addon +
 * darwin spawn-helper, see scripts/sea-pty-assets.mjs) to disk and point
 * NEX_PTY_ENTRY at the released lib/index.js.
 *
 * Why a disk copy instead of a Module._load hook: the SEA loader takes over
 * require() for the main script — node-pty's inlined addon probes fail with
 * ERR_UNKNOWN_BUILTIN_MODULE and a hook on Module._load cannot intercept them
 * (verified: the SEA main-script require resolves embedded assets/built-ins
 * through its own channel). The @lydell variant package resolves its
 * prebuilds/ directory relative to its own module location, so the released
 * tree is fully self-contained and loads cleanly via createRequire.
 *
 * Idempotent via content fingerprinting; failures are non-fatal — the
 * terminal service falls back to the (broken) inlined import and reports the
 * error at terminal creation time, same as before this mechanism existed.
 */
function releasePtyRuntime(sea: { getRawAsset: (key: string) => ArrayBuffer }): void {
  if (process.env.NEX_PTY_ENTRY?.trim()) {
    // An explicit deployment wins (install.sh / service templates own this).
    return;
  }
  try {
    // Fingerprint on the platform-scoped addon key: the JS files move in
    // lockstep with the prebuilds in the variant package.
    const platformArch =
      process.platform === "win32"
        ? `win32-${process.arch}`
        : `${process.platform}-${process.arch}`;
    const addonBytes = Buffer.from(
      sea.getRawAsset(`${PTY_ASSET_PREFIX}prebuilds/${platformArch}/pty.node`),
    );
    const targetDirectory = join(ptyRuntimeDirectory(), assetFingerprint(addonBytes));
    const entryPath = join(targetDirectory, PTY_ENTRY_RELATIVE_PATH);
    if (!existsSync(entryPath)) {
      for (const key of listPtyAssetKeys(sea)) {
        const relative = key.slice(PTY_ASSET_PREFIX.length);
        const targetPath = join(targetDirectory, relative);
        if (existsSync(targetPath)) continue;
        const bytes = Buffer.from(sea.getRawAsset(key));
        const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(temporaryPath, bytes);
        // spawn-helper (and any native file) must keep the execute bit.
        chmodSync(
          temporaryPath,
          relative.endsWith(".node") || relative.includes("spawn-helper") ? 0o755 : 0o644,
        );
        renameSync(temporaryPath, targetPath);
      }
    }
    if (existsSync(entryPath)) {
      process.env.NEX_PTY_ENTRY = entryPath;
    }
  } catch {
    // Non-fatal: without a release the terminal service reports the broken
    // inlined load when a terminal is actually created.
  }
}

/** Enumerate the embedded nex-sea-pty/* asset keys. SEA has no list API, so probe the known layout. */
function listPtyAssetKeys(sea: { getRawAsset: (key: string) => ArrayBuffer }): string[] {
  const libFiles = [
    "eventEmitter2.js",
    "index.js",
    "interfaces.js",
    "terminal.js",
    "types.js",
    "unixTerminal.js",
    "utils.js",
  ];
  const keys = [`${PTY_ASSET_PREFIX}package.json`];
  for (const file of libFiles) {
    keys.push(`${PTY_ASSET_PREFIX}lib/${file}`);
  }
  keys.push(`${PTY_ASSET_PREFIX}prebuilds/pty.node`);
  const platformArch =
    process.platform === "win32" ? `win32-${process.arch}` : `${process.platform}-${process.arch}`;
  keys.push(`${PTY_ASSET_PREFIX}prebuilds/${platformArch}/pty.node`);
  if (process.platform === "darwin") {
    keys.push(`${PTY_ASSET_PREFIX}prebuilds/${platformArch}/spawn-helper`);
  }
  // Filter to what actually exists: getRawAsset throws on unknown keys.
  return keys.filter((key) => {
    try {
      sea.getRawAsset(key);
      return true;
    } catch {
      return false;
    }
  });
}

async function runAsAgent(): Promise<void> {
  // Note: dynamic import() is unusable in the SEA main script (the SEA ESM
  // loader is unavailable; import("node:sea") throws ERR_UNKNOWN_BUILTIN_MODULE),
  // so node:sea must be required statically.
  if (!isSea()) {
    throw new Error("NEX_SEA_AGENT_ROLE=1 is only supported inside the SEA binary");
  }
  const entry = releaseAgentBundle({ getRawAsset });
  // The CLI bundle expects user arguments at process.argv.slice(2). In a SEA
  // binary argv looks like [execPath, ...userArgs]; re-insert the script slot
  // so both conventions line up.
  const hasScriptPosition = process.argv[1] === join(dirname(process.execPath), "nex-server");
  const userArgs = hasScriptPosition ? process.argv.slice(2) : process.argv.slice(1);
  process.argv = [process.execPath, entry, ...userArgs];
  // The SEA embedder takes over require()/import() in the main script and
  // cannot resolve filesystem modules. createRequire builds a standard CJS
  // loader anchored at the released path: built-ins, .node native files and
  // relative resolution inside the release directory all work normally.
  return createRequire(entry)(entry);
}

function prepareAgentCommandForSea(sea: { getRawAsset: (key: string) => ArrayBuffer }): void {
  if (process.env.NEX_AGENT_SERVER_COMMAND?.trim()) {
    // Explicit env override wins; keep the existing resolver semantics.
    return;
  }
  const entry = releaseAgentBundle(sea);
  process.env.NEX_AGENT_SERVER_COMMAND = process.execPath;
  process.env.NEX_AGENT_SERVER_ARGS_JSON = JSON.stringify(["app-server", "--stdio"]);
  process.env.NEX_SEA_AGENT_ENTRY = entry;
  // The child process (the same SEA binary) enters the agent role based on this.
  process.env.NEX_SEA_AGENT_ROLE = "1";
}

export async function main(): Promise<void> {
  if (process.env.NEX_SEA_AGENT_ROLE === "1") {
    await runAsAgent();
    return;
  }

  if (isSea()) {
    prepareAgentCommandForSea({ getRawAsset });
    // Both roles need the pty runtime: the server creates terminals directly,
    // and the agent child (same binary) may spawn shells for tool use.
    releasePtyRuntime({ getRawAsset });
  }

  await import("./entry-http.js");
}

void main().catch((error: unknown) => {
  console.error("[nex-server:sea] startup failed", error);
  process.exitCode = 1;
});
