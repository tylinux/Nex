import assert from "node:assert/strict";
import test from "node:test";
import { shouldPromptTaskNotificationPermission } from "../src/lib/taskNotificationPermissionPrompt.js";

test("prompts only when enabled, permission is still default and never prompted before", () => {
  assert.equal(
    shouldPromptTaskNotificationPermission({
      notificationEnabled: true,
      permission: "default",
      alreadyPrompted: false,
    }),
    true,
  );
});

test("does not prompt for other permissions, a disabled switch, desktop or a past prompt", () => {
  const base = {
    notificationEnabled: true,
    permission: "default" as const,
    alreadyPrompted: false,
  };
  for (const override of [
    { permission: "granted" as const },
    { permission: "denied" as const },
    { permission: "unsupported" as const },
    { permission: null },
    { notificationEnabled: false },
    { alreadyPrompted: true },
  ]) {
    assert.equal(shouldPromptTaskNotificationPermission({ ...base, ...override }), false);
  }
});
