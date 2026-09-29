import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { basename, dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Fallback resolution for node-pty's native addons in embedded runtimes.
 *
 * node-pty's `loadNativeModule` probes `build/Release`, `build/Debug` and
 * `prebuilds/<platform>-<arch>` via relative `require()` calls. In a Node
 * single-executable (SEA) bundle node-pty's JS is inlined while those probes
 * go through the SEA loader, which only resolves embedded assets — every
 * probe fails with ERR_UNKNOWN_BUILTIN_MODULE and the terminal becomes
 * unavailable even though a perfectly good pty.node sits on disk next to the
 * binary.
 *
 * An embedding runtime (the SEA server) releases the prebuilt addons into a
 * real directory and points NEX_PTY_MODULE_DIR at it; the terminal service
 * then redirects the addon `require()` calls there through a one-shot
 * Module._load hook. Node's SEA main-script require still funnels through
 * Module._load, so the hook is effective even when node-pty's JS is inlined.
 */

export const NEX_PTY_MODULE_DIR_ENV = "NEX_PTY_MODULE_DIR";

export function resolveFallbackPtyModuleDir(
  env: Record<string, string | undefined> = process.env,
  isDirectory: (path: string) => boolean = defaultIsDirectory,
): string | null {
  const dir = env[NEX_PTY_MODULE_DIR_ENV]?.trim();
  return dir && isDirectory(dir) ? dir : null;
}

function defaultIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function isNativePtyAddonRequest(request: string): boolean {
  // Match node-pty's loadNativeModule probes ("./build/Release/pty.node",
  // "../prebuilds/darwin-arm64/pty.node", Windows conpty.node) without
  // touching unrelated native addons.
  return /(^|[/\\])(pty|conpty)\.node$/.test(request);
}

/**
 * Install a Module._load hook redirecting node-pty's native addon requires
 * into `moduleDir`. Returns a restore function; restoring is safe even if
 * another hook was chained on top (it only unwinds its own patch).
 */
export function installNativePtyAddonRedirect(
  moduleDir: string,
  exists: (path: string) => boolean = existsSync,
): () => void {
  const moduleApi = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const previousLoad = moduleApi._load;
  const patchedLoad = function patchedLoad(
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (isNativePtyAddonRequest(request)) {
      // Probes arrive as platform-flavored relative paths; only the file name
      // matters because the fallback dir is already platform-scoped by the
      // embedding runtime that released it.
      const addonPath = join(moduleDir, basename(request.replace(/\\/g, "/")));
      if (exists(addonPath)) {
        return previousLoad.call(Module, addonPath, parent, isMain);
      }
    }
    return previousLoad.call(Module, request, parent, isMain);
  };
  moduleApi._load = patchedLoad;
  return () => {
    if (moduleApi._load === patchedLoad) {
      moduleApi._load = previousLoad;
    }
  };
}

/**
 * Best-effort: place the darwin spawn-helper where node-pty's UnixTerminal
 * will look for it.
 *
 * node-pty computes `helperPath = resolve(__dirname, native.dir + "/spawn-helper")`
 * at module load. The redirect hook makes the addon require succeed on the
 * FIRST candidate ("../build/Release/"), so `native.dir` is that candidate —
 * the helper must therefore sit in `<node-pty dir>/build/Release/`. In a
 * normal checkout we copy it there from the fallback dir; in an SEA bundle
 * `__dirname` is the binary's own directory, so the landing spot is derived
 * from the same first-candidate shape next to the binary. Failures are
 * non-fatal: the addon still loads and a missing helper surfaces later as
 * node-pty's own posix_spawnp error, same as without the fallback.
 */
export function ensureFallbackSpawnHelperInstalled(
  fallbackDir: string,
  landingDirOverride?: string,
): void {
  if (process.platform !== "darwin") return;
  const helperSource = join(fallbackDir, "spawn-helper");
  if (!existsSync(helperSource)) return;

  const landingDir = landingDirOverride ?? resolveUnixTerminalHelperLandingDir();
  if (!landingDir) return;
  const helperTarget = join(landingDir, "spawn-helper");
  if (existsSync(helperTarget)) return;

  try {
    mkdirSync(landingDir, { recursive: true });
    copyFileSync(helperSource, helperTarget);
    // copyFileSync drops the execute bit; node-pty execs this helper directly
    // (posix_spawnp) so it must land as 0755. The source in prebuilds is
    // regularly 0644 — same repair as ensureNodePtySpawnHelperExecutable.
    chmodSync(helperTarget, 0o755);
  } catch {
    // Read-only landing dir (e.g. system locations): leave it; the helper
    // will be missing and node-pty reports it at spawn time.
  }
}

function resolveUnixTerminalHelperLandingDir(): string | null {
  // node-pty's loadNativeModule tries build/Release first, and the redirect
  // hook makes that first probe succeed, so native.dir is "../build/Release/"
  // resolved against node-pty's module dir (or the embedding binary's dir).
  let nodePtyModuleDir: string | null = null;
  try {
    nodePtyModuleDir = dirname(dirname(require.resolve("node-pty/lib/unixTerminal.js")));
  } catch {
    // Bundled runtimes (SEA) cannot resolve node-pty from disk; __dirname of
    // the inlined unixTerminal is the binary's own directory.
    nodePtyModuleDir = process.cwd();
  }
  return join(nodePtyModuleDir, "build", "Release");
}
