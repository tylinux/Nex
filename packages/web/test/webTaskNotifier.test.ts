import assert from "node:assert/strict";
import test from "node:test";
import type { TaskNotificationPayload } from "@nex/shared";
import { createWebTaskNotifier, type BrowserNotificationApi } from "../src/webTaskNotifier.js";

const payload: TaskNotificationPayload = {
  taskId: "task-1",
  status: "completed",
  title: "Task completed",
  body: "Done",
};

function setup(options?: {
  permission?: NotificationPermission;
  hasFocus?: boolean;
  noApi?: boolean;
  throwOnConstruct?: boolean;
  requestResult?: NotificationPermission;
  requestThrows?: boolean;
}) {
  const created: Array<{
    title: string;
    options: { body?: string; silent?: boolean; tag?: string } | undefined;
    onclick: ((event: unknown) => void) | null;
    closed: boolean;
  }> = [];
  const events: string[] = [];
  const warnings: unknown[][] = [];

  class FakeNotification {
    static permission: NotificationPermission = options?.permission ?? "granted";
    static async requestPermission() {
      if (options?.requestThrows) {
        throw new Error("blocked");
      }
      FakeNotification.permission = options?.requestResult ?? "granted";
      return FakeNotification.permission;
    }
    onclick: ((event: unknown) => void) | null = null;
    closed = false;
    constructor(title: string, opts?: { body?: string; silent?: boolean; tag?: string }) {
      if (options?.throwOnConstruct) {
        throw new TypeError("Illegal constructor");
      }
      created.push(this as never);
      Object.assign(this, { title, options: opts });
    }
    close() {
      this.closed = true;
    }
  }

  const notifier = createWebTaskNotifier({
    getNotificationApi: () =>
      options?.noApi ? undefined : (FakeNotification as unknown as BrowserNotificationApi),
    hasFocus: () => options?.hasFocus ?? false,
    focusWindow: () => events.push("focus"),
    playSound: () => {
      events.push("sound");
    },
    logger: { warn: (...args) => warnings.push(args) },
  });
  return { notifier, created, events, warnings };
}

test("background page with granted permission shows a silent notification and plays the sound", () => {
  const { notifier, created, events } = setup();
  notifier.show(payload);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.title, "Task completed");
  assert.equal(created[0]!.options?.body, "Done");
  assert.equal(created[0]!.options?.silent, true);
  assert.deepEqual(events, ["sound"]);
});

test("focused page, missing permission and missing API never show a notification", () => {
  for (const options of [
    { hasFocus: true },
    { permission: "default" as const },
    { permission: "denied" as const },
    { noApi: true },
  ]) {
    const { notifier, created, events } = setup(options);
    notifier.show(payload);
    assert.equal(created.length, 0);
    assert.deepEqual(events, []);
  }
});

test("tag merges repeats of the same event and separates different tasks, statuses and requests", () => {
  const { notifier, created } = setup();
  notifier.show(payload);
  notifier.show(payload);
  notifier.show({ ...payload, taskId: "task-2" });
  notifier.show({ ...payload, status: "failed" });
  notifier.show({ ...payload, status: "permission_request", requestId: "r1" });
  const tags = created.map((item) => item.options?.tag);
  assert.equal(tags[0], tags[1]);
  assert.equal(new Set(tags).size, 4);
});

test("clicking closes the notification, focuses the window and delivers the task id", () => {
  const { notifier, created, events } = setup();
  const received: string[] = [];
  notifier.onClick((taskId) => received.push(taskId));
  notifier.show(payload);
  created[0]!.onclick?.({});
  assert.equal(created[0]!.closed, true);
  assert.deepEqual(events, ["sound", "focus"]);
  assert.deepEqual(received, ["task-1"]);
});

test("click handlers can be removed and a throwing handler does not block the others", () => {
  const { notifier, created, warnings } = setup();
  const received: string[] = [];
  notifier.onClick(() => {
    throw new Error("boom");
  });
  const dispose = notifier.onClick((taskId) => received.push(`a:${taskId}`));
  notifier.onClick((taskId) => received.push(`b:${taskId}`));
  dispose();
  notifier.show(payload);
  created[0]!.onclick?.({});
  assert.deepEqual(received, ["b:task-1"]);
  assert.equal(warnings.length, 1);
});

test("a constructor failure is logged and does not play the sound", () => {
  const { notifier, events, warnings } = setup({ throwOnConstruct: true });
  notifier.show(payload);
  assert.deepEqual(events, []);
  assert.equal(warnings.length, 1);
});

test("permission is read from the browser and requests map to its answer", async () => {
  assert.equal(setup({ permission: "default" }).notifier.getPermission(), "default");
  assert.equal(setup({ noApi: true }).notifier.getPermission(), "unsupported");
  assert.equal(
    await setup({ permission: "default", requestResult: "denied" }).notifier.requestPermission(),
    "denied",
  );
  assert.equal(await setup({ noApi: true }).notifier.requestPermission(), "unsupported");
});

test("a failing permission request falls back to the current permission instead of throwing", async () => {
  const { notifier, warnings } = setup({ permission: "default", requestThrows: true });
  assert.equal(await notifier.requestPermission(), "default");
  assert.equal(warnings.length, 1);
});
