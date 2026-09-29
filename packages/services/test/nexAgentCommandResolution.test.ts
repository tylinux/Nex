import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
 */

const resolverContext = {
  workspacePath: "/tmp/nex-agent-resolver-test",
  workspaceKey: "/tmp/nex-agent-resolver-test",
};

/**
 * `findUpward` walks up from process.cwd() to locate the monorepo agent bundle.
 * Tests run from packages/services, which already sits inside the real
 * monorepo, so the dist bundle resolves naturally. The fake-monorepo case uses
 * a temp cwd where the marker path does not exist.
 */
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
  const fakeRoot = await mkdtemp(join(tmpdir(), "nex-resolver-prod-"));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));
  await writeFile(join(fakeRoot, "fake-agent"), "#!/bin/sh\nexit 0\n");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: join(fakeRoot, "fake-agent"),
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: undefined,
    },
    async () => {
      await withCwd(fakeRoot, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the env override to resolve");
        assert.equal(command.command, join(fakeRoot, "fake-agent"));
        assert.deepEqual(command.args, ["app-server", "--stdio"]);
        assert.equal(command.supportsStorageStartup, undefined);
      });
    },
  );
});

test("env override also wins in development runtime without a monorepo bundle", async (t) => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "nex-resolver-nobundle-"));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));
  await writeFile(join(fakeRoot, "fake-agent"), "#!/bin/sh\nexit 0\n");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: join(fakeRoot, "fake-agent"),
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      await withCwd(fakeRoot, async () => {
        const command = resolveDefaultNexAgentCommand(resolverContext);
        assert.ok(command, "expected the env override to resolve");
        assert.equal(command.command, join(fakeRoot, "fake-agent"));
        assert.equal(command.supportsStorageStartup, undefined);
      });
    },
  );
});

test("development runtime prefers the monorepo bundle over a leaked env override", async (t) => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "nex-resolver-dev-"));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));
  await writeFile(join(fakeRoot, "fake-agent"), "#!/bin/sh\nexit 0\n");

  // cwd stays inside the real monorepo (packages/services), where the dist
  // bundle marker apps/nex-cli/packages/cli/dist/nex.cjs exists.
  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: join(fakeRoot, "fake-agent"),
      NEX_AGENT_SERVER_ARGS_JSON: JSON.stringify([
        join(fakeRoot, "fake-agent"),
        "app-server",
        "--stdio",
      ]),
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      const command = resolveDefaultNexAgentCommand(resolverContext);
      assert.ok(command, "expected the monorepo bundle to resolve");
      assert.notEqual(command.command, join(fakeRoot, "fake-agent"));
      assert.equal(command.supportsStorageStartup, true);
      assert.ok(
        command.storagePreparationEntry,
        "monorepo bundle must carry storagePreparationEntry",
      );
    },
  );
});

test("development runtime keeps the env override when it already points at the same monorepo entry", async (t) => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "nex-resolver-devsame-"));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));

  // cwd stays inside the real monorepo. First resolve without the override to
  // learn the monorepo command, then set the override to that exact command
  // and confirm resolution does not reinterpret it.
  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: undefined,
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "development",
    },
    async () => {
      const monorepo = resolveDefaultNexAgentCommand(resolverContext);
      assert.ok(monorepo?.storagePreparationEntry, "monorepo bundle must resolve in repo cwd");
      assert.equal(monorepo.supportsStorageStartup, true);

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
    },
  );
});

test("production runtime inside the monorepo still honors the env override", async (t) => {
  const fakeRoot = await mkdtemp(join(tmpdir(), "nex-resolver-prodrepo-"));
  t.after(() => rm(fakeRoot, { recursive: true, force: true }));
  await writeFile(join(fakeRoot, "fake-agent"), "#!/bin/sh\nexit 0\n");

  await withEnv(
    {
      NEX_AGENT_SERVER_COMMAND: join(fakeRoot, "fake-agent"),
      NEX_AGENT_SERVER_ARGS_JSON: undefined,
      NEX_RUNTIME_ENV: "production",
    },
    async () => {
      // cwd stays inside the real monorepo; the override must still win.
      const command = resolveDefaultNexAgentCommand(resolverContext);
      assert.ok(command, "expected the env override to resolve");
      assert.equal(command.command, join(fakeRoot, "fake-agent"));
      assert.equal(command.supportsStorageStartup, undefined);
    },
  );
});
