import assert from "node:assert/strict";
import test from "node:test";

// 复现 esbuild __commonJS 的半初始化缓存语义，验证 loadNodePtyModule 的
// fallback 重试路径对"第二次 import 返回空 exports"的处理。真实 bundle 里
// node-pty 主模块第一次执行在顶层 loadNativeModule("pty") 探测 addon 失败
// 时抛错，__commonJS 的 mod 缓存已被赋值；重试的第二次 __require() 命中
// 缓存直接返回空 exports（无 spawn）——SEA 实测报
// "nodePty.spawn is not a function"。

const __getOwnPropNames = Object.getOwnPropertyNames;
function makeCommonJS(block: (exports: Record<string, unknown>) => void) {
  let mod: { exports: Record<string, unknown> } | undefined;
  return () => {
    return (mod || (0, block)((mod = { exports: {} }).exports, mod), mod.exports);
  };
}

// 与 terminalService 的 isUsableNodePtyModule 同逻辑（该函数不导出，这里镜像
// 断言其判据：spawn 必须是 function）。
function isUsable(mod: unknown): boolean {
  return (
    typeof mod === "object" &&
    mod !== null &&
    typeof (mod as { spawn?: unknown }).spawn === "function"
  );
}

test("half-initialized __commonJS cache returns an object without spawn on retry", () => {
  let first = true;
  const requireNodePty = makeCommonJS((exports) => {
    if (first) {
      first = false;
      // 模拟 SEA 下 unixTerminal 顶层 loadNativeModule("pty") 探测失败
      throw new Error("MODULE_NOT_FOUND: build/Release/pty.node");
    }
    exports.spawn = () => "ok";
  });

  assert.throws(() => requireNodePty(), /MODULE_NOT_FOUND/);
  const retried = requireNodePty();
  assert.equal(isUsable(retried), false, "retry must be detected as unusable");
  assert.equal(typeof (retried as { spawn?: unknown }).spawn, "undefined");
});

test("a clean second load is usable and passes the usability check", () => {
  const requireNodePty = makeCommonJS((exports) => {
    exports.spawn = () => "ok";
  });
  assert.equal(isUsable(requireNodePty()), true);
});
