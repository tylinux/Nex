import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  installNativePtyAddonRedirect,
  isNativePtyAddonRequest,
  resolveFallbackPtyModuleDir,
} from "../src/terminal/terminalPtyFallback.js";

/**
 * Fallback resolution for node-pty native addons in embedded runtimes (SEA
 * bundles inline node-pty's JS but cannot satisfy its relative addon
 * requires; see terminalPtyFallback.ts for the full rationale).
 */

const require = createRequire(import.meta.url);

test("isNativePtyAddonRequest matches node-pty's loadNativeModule probes", () => {
  // Probes as issued by node-pty's utils.js: "../build/Release/", "./build/Debug/",
  // "./prebuilds/<platform>-<arch>/" (dir already ends with "/", producing the
  // double slash seen in production logs), plus the Windows conpty addon.
  assert.equal(isNativePtyAddonRequest("../build/Release/pty.node"), true);
  assert.equal(isNativePtyAddonRequest("./build/Debug/pty.node"), true);
  assert.equal(isNativePtyAddonRequest("./prebuilds/darwin-arm64//pty.node"), true);
  assert.equal(isNativePtyAddonRequest("build/Release/conpty.node"), true);
  assert.equal(isNativePtyAddonRequest(".\\prebuilds\\win32-x64\\pty.node"), true);

  // Unrelated native addons must not be redirected.
  assert.equal(isNativePtyAddonRequest("../build/Release/sharp.node"), false);
  assert.equal(isNativePtyAddonRequest("pty.node.js"), false);
  assert.equal(isNativePtyAddonRequest("node:path"), false);
});

test("resolveFallbackPtyModuleDir requires a set, existing directory", () => {
  assert.equal(
    resolveFallbackPtyModuleDir({}, () => true),
    null,
  );
  assert.equal(
    resolveFallbackPtyModuleDir({ NEX_PTY_MODULE_DIR: "  " }, () => true),
    null,
  );
  assert.equal(
    resolveFallbackPtyModuleDir({ NEX_PTY_MODULE_DIR: "/opt/pty" }, () => false),
    null,
  );
  assert.equal(
    resolveFallbackPtyModuleDir({ NEX_PTY_MODULE_DIR: " /opt/pty " }, () => true),
    "/opt/pty",
  );
});

test("redirect hook loads pty.node from the fallback dir and restores cleanly", async (t) => {
  const fallbackDir = await mkdtemp(join(tmpdir(), "nex-pty-fallback-"));
  t.after(() => rm(fallbackDir, { recursive: true, force: true }));

  // Copy the real node-pty addon for this platform into the fallback dir.
  // CI runs on linux where the darwin prebuild is absent; the build/Release
  // fallback covers source checkouts that compiled it locally. Skip the
  // load assertion when neither exists on this machine.
  // resolve from the package root (pnpm hoists node-pty to the workspace root,
  // not into packages/services/node_modules).
  const nodePtyDir = dirname(dirname(require.resolve("node-pty")));
  const platformDir = `${process.platform}-${process.arch}`;
  const addonCandidate = [
    join(nodePtyDir, "prebuilds", platformDir, "pty.node"),
    join(nodePtyDir, "build", "Release", "pty.node"),
  ].find((candidate) => existsSync(candidate));
  if (!addonCandidate) {
    t.skip(`no local pty.node for ${platformDir}`);
    return;
  }
  await copyFile(addonCandidate, join(fallbackDir, "pty.node"));

  const restore = installNativePtyAddonRedirect(fallbackDir);
  try {
    // A node-pty-style probe must now resolve to the fallback copy.
    const loaded = require("./prebuilds/darwin-arm64//pty.node") as Record<string, unknown>;
    assert.ok(loaded, "expected the probe require to resolve through the hook");
    assert.equal(typeof loaded.fork, "function", "pty.node exports fork()");
  } finally {
    restore();
  }

  // After restore, the same probe must fail again (proves the hook unwinds
  // and did not poison Module._load for the rest of the process).
  assert.throws(() => require("./prebuilds/darwin-arm64//pty.node"));
});

test("redirect hook leaves unrelated requires untouched", () => {
  const restore = installNativePtyAddonRedirect("/nonexistent", () => true);
  try {
    // Non-addon require goes through the original loader.
    assert.equal(typeof require.resolve("node:path"), "string");
  } finally {
    restore();
  }
});

test("ensureFallbackSpawnHelperInstalled stages an executable helper on darwin", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("darwin-only helper staging");
    return;
  }
  const { accessSync, chmodSync, constants, rmSync, writeFileSync } = await import("node:fs");
  const { ensureFallbackSpawnHelperInstalled } =
    await import("../src/terminal/terminalPtyFallback.js");

  // An isolated landing dir keeps the test independent of the real checkout
  // state (the local node-pty may already carry a compiled spawn-helper).
  const landingDir = await mkdtemp(join(tmpdir(), "nex-pty-landing-"));
  const fallbackDir = await mkdtemp(join(tmpdir(), "nex-pty-helper-"));
  const helperTarget = join(landingDir, "spawn-helper");
  t.after(() => {
    rmSync(landingDir, { recursive: true, force: true });
    rmSync(fallbackDir, { recursive: true, force: true });
  });

  // No helper in the fallback dir: nothing is staged.
  ensureFallbackSpawnHelperInstalled(fallbackDir, landingDir);
  assert.equal(existsSync(helperTarget), false);

  // Helper present: staged and executable (copyFileSync drops +x, the
  // prebuilds source is regularly 0644).
  writeFileSync(join(fallbackDir, "spawn-helper"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(fallbackDir, "spawn-helper"), 0o644);
  ensureFallbackSpawnHelperInstalled(fallbackDir, landingDir);
  assert.equal(existsSync(helperTarget), true);
  accessSync(helperTarget, constants.X_OK);
});
