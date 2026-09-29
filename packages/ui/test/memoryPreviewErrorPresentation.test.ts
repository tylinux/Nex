import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE,
  PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE,
} from "../../services/src/memory/memory.js";
import { resolveMemoryPreviewErrorPresentation } from "../src/settings/memoryPreviewErrorPresentation.js";

function makeError(code?: string, message = "boom"): unknown {
  const error = new Error(message);
  if (code) {
    Object.assign(error, { code });
  }
  return error;
}

test("oversized memory preview error disables retry", () => {
  const result = resolveMemoryPreviewErrorPresentation(
    makeError(PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE),
  );
  assert.equal(result.oversized, true);
  assert.match(result.messageKey, /tooLarge$/);
});

test("oversized error is matched by code, not message text", () => {
  // 错误文案由服务端抛出时可能变化；UI 必须按 code 而不是 message 匹配。
  const result = resolveMemoryPreviewErrorPresentation(
    makeError(PROJECT_MEMORY_PREVIEW_LIMIT_EXCEEDED_ERROR_CODE, "some other wording"),
  );
  assert.equal(result.oversized, true);
});

test("other errors keep retry available and surface the original message", () => {
  const fileChanged = resolveMemoryPreviewErrorPresentation(
    makeError(PROJECT_MEMORY_FILE_CHANGED_ERROR_CODE, "changed during preview"),
  );
  assert.equal(fileChanged.oversized, false);
  assert.equal(fileChanged.rawMessage, "changed during preview");

  const enoent = resolveMemoryPreviewErrorPresentation(makeError(undefined, "ENOENT"));
  assert.equal(enoent.oversized, false);
  assert.equal(enoent.rawMessage, "ENOENT");

  const nonError = resolveMemoryPreviewErrorPresentation("plain failure");
  assert.equal(nonError.oversized, false);
  assert.equal(nonError.rawMessage, "plain failure");
});
