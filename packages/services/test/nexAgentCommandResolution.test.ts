import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveDefaultNexAgentCommand } from "../src/nex-agent/nexAgentProcessManager.js";

/**
 * Command-resolution precedence for the agent process.
 *
 * The env override (NEX_AGENT_SERVER_COMMAND) must stay the highest priority in
 * production runtimes so operator configuration is always honored. In an
 * app-injected development runtime (NEX_RUNTIME_ENV=development) the monorepo
 * bundle wins over the env override: self-contained release binaries export the
 * override for every child process, and that leaked value used to shadow the
 * monorepo bundle when a desktop dev app was spawned from inside such a
 * session, breaking storage preparation with "unsupported_runtime".
 *
 * Tests must not depend on the real monorepo layout: CI runs the services suite
 * without building the CLI bundle, so the dist marker
 * (apps/nex-cli/packages/cli/dist/nex.cjs) does not exist there. Each test
 * builds its own fake monorepo root in a temp dir and chdirs into it so
 * `findUpward` resolves deterministically.
 */

const resolverContext = {
  workspacePath: "/tmp/nex-agent-resolver-test",
  workspaceKey: "/tmp/nex-agent-resolver-test",
};

/** Marker path `resolveBundledWorkspaceNexAgentCommand` looks up via findUpward. */
const MONOREPO_BUNDLE_MARKER = join("apps", "nex-cli", "packages", "cli", "dist", "nex.cjs");

interface FakeMonorepo {
  root: string;
  bundlePath: string;
}

/**
 * Creates a temp dir with the monorepo bundle marker and an executable fake
 * agent binary next to it, mirroring a freshly built dev workspace.
 */
async function createFakeMonorepo(prefix: string): Promise<FakeMonorepo> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const bundlePath = join(root, MONOREPO_BUNDLE_MARKER);
  await mkdir(join(root, MONOREPO_BUNDLE_MARKER, ".."), { recursive: true });
  await writeFile(bundlePath, "// fake agent bundle\n");
  await writeFile(join(root, "fake-agent"), "#!/bin/sh\nexit 0\n");
  // macOS resolves tmpdir through the /var -> /private/var symlink: after chdir,
  // findUpward rebuilds paths from process.cwd() (the realpath), so hand the
  // realpath back to keep assertions path-equal.
  return { root: await realpath(root), bundlePath: await realpath(bundlePath) };
}

async function withCwd<T>(cwd: string, run: () => Promise<T> | T): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await run();
  } finally {
    process.chdir(previous);
  }
}

async function withEnv(
  env: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("env override wins in production runtime", async (t) => {
  const { root } = await createFakeMonorepo("nex-resolver-prod-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeAgent = join(root, "fake-agent");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: fakeAgent,
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: undefined,
    },
    async () => {
      await withCwd(root, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the env override to resolve");
        assert.equal(command.command, fakeAgent);
        assert.deepEqual(command.args, ["app-server", "--stdio"]);
        assert.equal(command.supportsStorageStartup, undefined);
      });
    },
  );
});

test("env override also wins in development runtime without a monorepo bundle", async (t) => {
  // No bundle marker in this temp root: findUpward walks up and finds nothing
  // (tmpdir is outside any real monorepo checkout).
  const root = await mkdtemp(join(tmpdir(), "nex-resolver-nobundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeAgent = join(root, "fake-agent");
  await writeFile(fakeAgent, "#!/bin/sh\nexit 0\n");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: fakeAgent,
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      await withCwd(root, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the env override to resolve");
        assert.equal(command.command, fakeAgent);
        assert.equal(command.supportsStorageStartup, undefined);
      });
    },
  );
});

test("development runtime prefers the monorepo bundle over a leaked env override", async (t) => {
  const { root, bundlePath } = await createFakeMonorepo("nex-resolver-dev-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeAgent = join(root, "fake-agent");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: fakeAgent,
      NEX_AGENT_SERVER_ARGS_JSON: JSON.stringify([fakeAgent, "app-server", "--stdio"]),
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      await withCwd(root, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the monorepo bundle to resolve");
        assert.notEqual(command.command, fakeAgent);
        assert.equal(command.supportsStorageStartup, true);
        assert.equal(command.storagePreparationEntry, bundlePath);
      });
    },
  );
});

test("development runtime keeps the env override when it already points at the same monorepo entry", async (t) => {
  const { root } = await createFakeMonorepo("nex-resolver-devsame-");
  t.after(() => rm(root, { recursive: true, force: true }));

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: undefined,
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      await withCwd(root, async () => {
        const monorepo = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(monorepo?.storagePreparationEntry, "monorepo bundle must resolve in fake root");
        assert.equal(monorepo.supportsStorageStartup, true);

        // Point the override at the exact same command/args and confirm the
        // resolver still returns the capability-carrying monorepo command.
        await withEnv(
          {
            NEX_AGENT_SERVER_COMMAND: monorepo.command,
            NEX_AGENT_SERVER_ARGS_JSON: JSON.stringify(monorepo.args),
          },
          async () => {
            const command = resolveDefaultNexAgentCommand(resolverContext);
            assert.ok(command);
            assert.equal(command.command, monorepo.command);
            assert.deepEqual(command.args, monorepo.args);
            assert.equal(command.supportsStorageStartup, true);
            assert.ok(command.storagePreparationEntry);
          },
        );
      });
    },
  );
});

test("production runtime inside the monorepo still honors the env override", async (t) => {
  const { root } = await createFakeMonorepo("nex-resolver-prodrepo-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const fakeAgent = join(root, "fake-agent");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: fakeAgent,
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "production",
    },
    async () => {
      await withCwd(root, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the env override to resolve");
        assert.equal(command.command, fakeAgent);
        assert.equal(command.supportsStorageStartup, undefined);
      });
    },
  );
});
