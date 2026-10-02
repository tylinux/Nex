// Server SEA build script: packs the HTTP server (with the embedded agent
// bundle) into a Node single binary.
//
// Artifacts: dist/sea/nex-server-<target> (darwin-arm64 / linux-x64 / linux-arm64).
// Two roles in one binary (see src/seaEntry.ts):
//   ./nex-server           -> HTTP server (default)
//   NEX_SEA_AGENT_ROLE=1   -> agent (app-server --stdio, spawned by the server itself)
//
// Reuses the CLI SEA pipeline's asset collectors and injection mechanism
// (apps/nex-cli/packages/cli/scripts/build-sea.mjs): when the agent runs inside
// this binary isSea() is true, so CLI code reads the assets by the same keys
// and releases them into the user cache directory.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSpawnRuntimeOptions } from "../../../scripts/spawn-command.mjs";
import { resolveDownloadedNodeBinary } from "../../../apps/nex-cli/packages/cli/scripts/sea-node-download.mjs";
import {
  adHocCodesignArgs,
  isHostTarget,
  postjectArgsForTarget,
  shouldAdHocSignMacTarget,
  targetParts,
} from "../../../apps/nex-cli/packages/cli/scripts/sea-targets.mjs";
import { removeWindowsAuthenticodeSignature } from "../../../apps/nex-cli/packages/cli/scripts/windows-authenticode.mjs";
import { collectSeaTuiAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-tui-assets.mjs";
import { collectSeaOfficialPluginAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-official-plugin-assets.mjs";
import { collectSeaBundledSkillAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-bundled-skill-assets.mjs";
import { collectSeaRuntimeToolAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-runtime-tool-assets.mjs";
import { prepareSeaRuntimeToolAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-runtime-tool-prepare.mjs";
import { collectSeaPlaywrightAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-playwright-assets.mjs";
import { collectSeaProviderConfigAssets } from "../../../apps/nex-cli/packages/cli/scripts/sea-provider-config-assets.mjs";
import { collectSeaPtyAssets } from "./sea-pty-assets.mjs";
import { stageNodeNotices } from "../../../scripts/third-party-notices.mjs";
import { buildHttpBundle } from "../build-http-bundle.ts";

const serverRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(serverRoot, "../..");
const cliRoot = resolve(repositoryRoot, "apps/nex-cli/packages/cli");
const cliWorkspaceRoot = resolve(repositoryRoot, "apps/nex-cli");
const dist = resolve(serverRoot, "dist");
const seaDist = resolve(dist, "sea");
const agentBundle = resolve(cliRoot, "dist/nex.cjs");
const seaBlobForTarget = (target) => resolve(seaDist, `nex-server-${target}.sea.blob`);
const seaConfigForTarget = (target) => resolve(seaDist, `sea-config-${target}.json`);
const seaAssetStagingForTarget = (target) => resolve(seaDist, "sea-assets", target);
const nodeCache = resolve(seaDist, "sea-node-cache");
const defaultTargets = ["darwin-arm64", "linux-x64", "linux-arm64"];
const sentinelFusePrefix = "NODE_SEA_FUSE_";

const usage = `Usage:
  node scripts/build-sea.mjs [--target <t> ...] [--all] [--node-binary <t>=<path>]

Targets: darwin-arm64, linux-x64, linux-arm64 (default: all three)
Prerequisites: pnpm -r --filter "@nex/cli..." build (agent bundle must exist)
`;

const text = (command, args) => [command, ...args].join(" ");

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: serverRoot,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
    ...resolveSpawnRuntimeOptions(command),
  });
  if (result.error) {
    throw new Error(`${text(command, args)} failed: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(`${text(command, args)} failed`);
  }
};

const parseArgs = (argv) => {
  const targets = [];
  const nodeBinaries = {};
  let all = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") all = true;
    else if (arg === "--target") targets.push(argv[++i]);
    else if (arg === "--node-binary") {
      const [target, path] = argv[++i].split("=");
      nodeBinaries[target] = path;
    } else if (arg === "--help") {
      console.log(usage);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return {
    targets: all ? defaultTargets : targets.length > 0 ? targets : defaultTargets,
    nodeBinaries,
  };
};

const findSeaFuse = async (binary) => {
  const contents = await readFile(binary, "latin1");
  const match = contents.match(/NODE_SEA_FUSE_[a-z0-9]+:0/i);
  if (!match) {
    throw new Error(
      `Could not find a NODE_SEA_FUSE marker in ${binary}. Use an official Node.js binary with SEA support.`,
    );
  }
  return match[0].replace(/:0$/, "");
};

const prepareSeaBlob = async (target, nodeVersion) => {
  await prepareSeaRuntimeToolAssets({ root: repositoryRoot, target });
  const { assets: tuiAssets } = await collectSeaTuiAssets({
    root: cliWorkspaceRoot,
    stagingDirectory: seaAssetStagingForTarget(target),
    target,
  });
  const { assets: pluginAssets } = await collectSeaOfficialPluginAssets({
    requireRuntime: true,
    root: cliWorkspaceRoot,
    stagingDirectory: seaAssetStagingForTarget(`${target}-official-plugins`),
  });
  const { assets: bundledSkillAssets } = await collectSeaBundledSkillAssets({
    root: cliWorkspaceRoot,
    stagingDirectory: seaAssetStagingForTarget(`${target}-bundled-skills`),
  });
  const { assets: runtimeToolAssets } = await collectSeaRuntimeToolAssets({
    root: repositoryRoot,
    stagingDirectory: seaAssetStagingForTarget(`${target}-runtime-tools`),
    target,
  });
  const { assets: playwrightAssets } = await collectSeaPlaywrightAssets({
    root: cliWorkspaceRoot,
    stagingDirectory: seaAssetStagingForTarget(`${target}-playwright`),
    target,
  });
  const providerConfigAssets = await collectSeaProviderConfigAssets({ root: repositoryRoot });
  const nodeLicensePath = await stageNodeNotices(
    seaAssetStagingForTarget(`${target}-node`),
    nodeVersion,
    repositoryRoot,
  );
  const agentStagingDirectory = seaAssetStagingForTarget(`${target}-agent`);
  const agentBundleStaged = resolve(agentStagingDirectory, "nex.cjs");
  await mkdir(agentStagingDirectory, { recursive: true });
  await copyFile(agentBundle, agentBundleStaged);

  const ptyAssets = await collectSeaPtyAssets({
    root: repositoryRoot,
    stagingDirectory: seaAssetStagingForTarget(`${target}-pty`),
    target,
  });

  const seaConfig = seaConfigForTarget(target);
  await writeFile(
    seaConfig,
    JSON.stringify(
      {
        assets: {
          ...tuiAssets,
          ...pluginAssets,
          ...bundledSkillAssets,
          ...runtimeToolAssets,
          ...playwrightAssets,
          ...providerConfigAssets,
          ...ptyAssets,
          "nex-sea-agent/nex.cjs": agentBundleStaged,
          "nex-node-license": nodeLicensePath,
        },
        disableExperimentalSEAWarning: true,
        main: "dist/sea/nex-server-sea.cjs",
        output: `dist/sea/nex-server-${target}.sea.blob`,
        useCodeCache: false,
        useSnapshot: false,
      },
      null,
      2,
    ),
  );

  run(process.execPath, ["--experimental-sea-config", seaConfig]);
  return seaBlobForTarget(target);
};

const removeMacSignatureForInjection = (target, binaryPath) => {
  if (!shouldAdHocSignMacTarget(target)) return;
  run("codesign", ["--remove-signature", binaryPath]);
};

const removeWindowsSignatureForInjection = async (target, binaryPath) => {
  const { releasePlatform } = targetParts(target);
  if (releasePlatform !== "win") return;
  await removeWindowsAuthenticodeSignature(binaryPath);
};

const pollHttp = (url, attempts = 40) =>
  new Promise((resolvePromise) => {
    let attempt = 0;
    const timer = setInterval(() => {
      attempt += 1;
      const result = spawnSync("curl", ["-sf", url], { encoding: "utf8", timeout: 3000 });
      if (result.status === 0) {
        clearInterval(timer);
        resolvePromise(true);
      } else if (attempt >= attempts) {
        clearInterval(timer);
        resolvePromise(false);
      }
    }, 250);
  });

const smokeTestHostTarget = async (target, binaryPath) => {
  if (!isHostTarget(target)) {
    console.log(`[sea] skipping smoke test for foreign target ${target}`);
    return;
  }
  const storageRoot = await mkdtemp(join(tmpdir(), "nex-server-sea-smoke-"));
  const port = 3977 + Math.floor(Math.random() * 100);
  const token = `smoke-${Date.now()}`;
  const child = spawn(
    binaryPath,
    [],
    {
      env: {
        ...process.env,
        NEX_SERVER_AUTH_TOKEN: token,
        PORT: String(port),
        NEX_SERVER_HOST: "127.0.0.1",
        NEX_DATA_BASE_DIR: join(storageRoot, "data"),
      },
      stdio: "ignore",
    },
  );
  try {
    const ready = await pollHttp(`http://127.0.0.1:${port}/api/server-info?token=${token}`);
    if (!ready) {
      throw new Error("SEA server smoke test failed: /api/server-info never returned 200");
    }
    console.log("[sea] smoke: http server role ok");
    const agent = spawnSync(
      binaryPath,
      ["--version"],
      {
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          NEX_SEA_AGENT_ROLE: "1",
          NEX_DATA_BASE_DIR: join(storageRoot, "data"),
        },
      },
    );
    if (agent.status !== 0 || !/\d+\.\d+\.\d+/.test(agent.stdout ?? "")) {
      throw new Error(`SEA agent smoke test failed: ${agent.stderr || agent.stdout}`);
    }
    console.log("[sea] smoke: agent role ok");
  } finally {
    child.kill("SIGTERM");
    await rm(storageRoot, { force: true, recursive: true });
  }
};

const buildTarget = async ({ nodeBinaries, nodeVersion, postjectBin, target }) => {
  const binaryPath = resolve(seaDist, `nex-server-${target}`);
  const seaBlob = await prepareSeaBlob(target, nodeVersion);
  const targetNodeBinary = await resolveDownloadedNodeBinary({ nodeCache, nodeVersion, target });

  console.log(`[sea] building ${target} -> ${binaryPath}`);
  await copyFile(targetNodeBinary, binaryPath);
  await chmod(binaryPath, 0o755);

  const sentinelFuse = await findSeaFuse(binaryPath);
  if (!sentinelFuse.startsWith(sentinelFusePrefix)) {
    throw new Error(`Unexpected SEA fuse marker in ${binaryPath}: ${sentinelFuse}`);
  }
  removeMacSignatureForInjection(target, binaryPath);
  await removeWindowsSignatureForInjection(target, binaryPath);
  run(postjectBin, postjectArgsForTarget({ binaryPath, seaBlob, sentinelFuse, target }));
  if (shouldAdHocSignMacTarget(target)) {
    run("codesign", adHocCodesignArgs(binaryPath));
  }
  await smokeTestHostTarget(target, binaryPath);
  console.log(`[sea] binary written to ${binaryPath}`);
};

const main = async (argv = process.argv.slice(2)) => {
  const options = parseArgs(argv);
  if (!existsSync(agentBundle)) {
    throw new Error(
      `Missing agent bundle ${agentBundle}. Run \`pnpm -r --filter "@nex/cli..." build\` first.`,
    );
  }
  const postjectBin = (() => {
    let directory = cliRoot;
    while (true) {
      const candidate = join(directory, "node_modules", ".bin", "postject");
      if (existsSync(candidate)) return candidate;
      const parent = resolve(directory, "..");
      if (parent === directory) throw new Error("Missing postject. Run `pnpm install` first.");
      directory = parent;
    }
  })();

  await mkdir(seaDist, { recursive: true });
  const { bundledInputs, version } = await buildHttpBundle({
    entryPoint: "src/seaEntry.ts",
    outfile: "dist/sea/nex-server-sea.cjs",
  });
  console.log(
    `[sea] server bundle: dist/sea/nex-server-sea.cjs (${bundledInputs.length} modules, v${version})`,
  );

  const nodeVersion = process.versions.node;
  for (const target of options.targets) {
    await buildTarget({ nodeBinaries: options.nodeBinaries, nodeVersion, postjectBin, target });
  }
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
