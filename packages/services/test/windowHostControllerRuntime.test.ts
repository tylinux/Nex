import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CONTROLLER_TASKS_INDEX_TOPIC } from "@nex/shared/nex-protocol-v4";
import type { NexTaskMeta, NexWorkspaceEvent } from "@nex/shared";
import { createWindowHostControllerRuntime } from "../src/window-controller/windowHostControllerService.js";
import type { INexTaskService } from "../src/session/nexTaskService.js";

const WORKSPACE = "/work/demo";
const SCOPE = { workspacePath: WORKSPACE };

function makeTask(taskId: string, patch: Partial<NexTaskMeta> = {}): NexTaskMeta {
  return {
    taskId,
    traceId: `trace-${taskId}`,
    title: `Task ${taskId}`,
    workspacePath: WORKSPACE,
    createdAt: 1_000,
    updatedAt: 1_000,
    mode: "yolo",
    ...patch,
  } as NexTaskMeta;
}

/** 内存版 task service：pin / archive 与真实实现一样会发 workspace_task_list_changed。 */
function createFakeTaskService(initial: Array<{ task: NexTaskMeta; pinned?: boolean }>) {
  const rows = new Map(
    initial.map(({ task, pinned }) => [
      task.taskId,
      { task, pinned: pinned ?? false, archived: false },
    ]),
  );
  const events = new EventEmitter();
  let listeners = 0;
  const fireChanged = (taskId: string, reason: string) =>
    events.emit("event", {
      type: "workspace_task_list_changed",
      workspacePath: WORKSPACE,
      taskId,
      reason,
    } as NexWorkspaceEvent);
  const service = {
    async listTasks() {
      return [...rows.values()].filter((r) => !r.pinned && !r.archived).map((r) => r.task);
    },
    async listPinnedTasks() {
      return [...rows.values()].filter((r) => r.pinned && !r.archived).map((r) => r.task);
    },
    async listArchivedTasks() {
      return [...rows.values()].filter((r) => r.archived).map((r) => r.task);
    },
    async setTaskPinned(params: { taskId: string; pinned: boolean }) {
      const row = rows.get(params.taskId)!;
      row.pinned = params.pinned;
      fireChanged(params.taskId, params.pinned ? "task_pinned" : "task_unpinned");
      return row.task;
    },
    onDynamicWorkspaceEvent() {
      return (listener: (event: NexWorkspaceEvent) => void) => {
        listeners += 1;
        events.on("event", listener);
        return {
          dispose() {
            listeners -= 1;
            events.off("event", listener);
          },
        };
      };
    },
  };
  return { service: service as unknown as INexTaskService, listenerCount: () => listeners };
}

function createRuntime(taskService: INexTaskService) {
  return createWindowHostControllerRuntime({
    createId: (() => {
      let next = 0;
      return () => `id-${++next}`;
    })(),
    resolveSource: (scope) =>
      scope.workspaceIdentity
        ? null
        : {
            scope: { kind: "local", workspacePath: scope.workspacePath },
            taskService,
            sourceAvailability: "online",
          },
  });
}

const query = (kind: "pinned" | "timeline" | "active" | "archived") => ({
  kind,
  workspaceScopes: [SCOPE],
  sortBy: "updated" as const,
});

const ids = (result: { items: Array<{ taskId: string }> }) =>
  result.items.map((i) => i.taskId).sort();
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("本机 source：置顶 / 普通 / 归档列表按 membership 分开返回", async () => {
  const { service } = createFakeTaskService([
    { task: makeTask("a"), pinned: true },
    { task: makeTask("b") },
    { task: makeTask("c", { updatedAt: 2_000 }), pinned: true },
  ]);
  const runtime = createRuntime(service);
  try {
    assert.deepEqual(ids(await runtime.service.listTaskList(query("pinned"))), ["a", "c"]);
    // timeline = 未置顶且未归档；active 的语义是「未归档」，会同时包含置顶任务。
    assert.deepEqual(ids(await runtime.service.listTaskList(query("timeline"))), ["b"]);
    assert.deepEqual(ids(await runtime.service.listTaskList(query("active"))), ["a", "b", "c"]);
    assert.deepEqual(ids(await runtime.service.listTaskList(query("archived"))), []);
  } finally {
    runtime.dispose();
  }
});

test("置顶写入触发 workspace 事件：不重新查询也能让置顶列表更新，并向订阅的连接推 delta 帧", async () => {
  const fake = createFakeTaskService([{ task: makeTask("a") }, { task: makeTask("b") }]);
  const runtime = createRuntime(fake.service);
  const attachment = runtime.createAttachmentService();
  try {
    const frames: Array<{ payload: { kind: string } }> = [];
    attachment.onDynamicControllerFrame()((frame) => frames.push(frame as never));
    await attachment.subscribeControllerV4({
      topic: CONTROLLER_TASKS_INDEX_TOPIC,
      visibility: "foreground",
    });
    // 首次查询注册 source、读取 tasks-index，并挂上 workspace 事件监听。
    assert.deepEqual(ids(await attachment.listTaskList(query("pinned"))), []);
    assert.equal(fake.listenerCount(), 1);

    const framesBefore = frames.length;
    await fake.service.setTaskPinned({ taskId: "a", workspacePath: WORKSPACE, pinned: true });
    await tick();

    assert.deepEqual(ids(await attachment.listTaskList(query("pinned"))), ["a"]);
    assert.deepEqual(ids(await attachment.listTaskList(query("timeline"))), ["b"]);
    assert.ok(frames.length > framesBefore, "pin 后应收到 delta 帧");
    assert.ok(frames.slice(framesBefore).every((frame) => frame.payload.kind !== "snapshot"));

    await fake.service.setTaskPinned({ taskId: "a", workspacePath: WORKSPACE, pinned: false });
    await tick();
    assert.deepEqual(ids(await attachment.listTaskList(query("pinned"))), []);
    assert.deepEqual(ids(await attachment.listTaskList(query("timeline"))), ["a", "b"]);
  } finally {
    attachment.dispose();
    runtime.dispose();
  }
});

test("attachment dispose 后不再收到帧，runtime dispose 释放 workspace 事件监听", async () => {
  const fake = createFakeTaskService([{ task: makeTask("a") }]);
  const runtime = createRuntime(fake.service);
  const attachment = runtime.createAttachmentService();
  const frames: unknown[] = [];
  attachment.onDynamicControllerFrame()((frame) => frames.push(frame));
  await attachment.subscribeControllerV4({
    topic: CONTROLLER_TASKS_INDEX_TOPIC,
    visibility: "foreground",
  });
  await attachment.listTaskList(query("pinned"));

  attachment.dispose();
  const framesAfterDispose = frames.length;
  await fake.service.setTaskPinned({ taskId: "a", workspacePath: WORKSPACE, pinned: true });
  await tick();
  assert.equal(frames.length, framesAfterDispose);

  assert.equal(fake.listenerCount(), 1);
  runtime.dispose();
  assert.equal(fake.listenerCount(), 0);
});

test("远程 workspace identity 的查询在本机 runtime 上 fail-closed，不会读到本机任务", async () => {
  const { service } = createFakeTaskService([{ task: makeTask("a"), pinned: true }]);
  const runtime = createRuntime(service);
  try {
    const result = await runtime.service.listTaskList({
      kind: "pinned",
      workspaceScopes: [{ workspacePath: WORKSPACE, workspaceIdentity: "ssh://host/work/demo" }],
      sortBy: "updated",
    });
    assert.deepEqual(result.items, []);
  } finally {
    runtime.dispose();
  }
});
