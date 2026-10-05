import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ensureFallbackSpawnHelperInstalled,
  installNativePtyAddonRedirect,
  resolveFallbackPtyModuleDir,
} from "./terminalPtyFallback.js";

/**
 * node-pty 模块加载：延迟、单例、失败可重试。
 *
 * 从 terminalService 拆出，一是控制那个文件的行数（业务代码 400 行上限），
 * 二是把两条加载路径的差异集中在一处：
 *
 * 1. SEA/embedding 运行时（首选）：seaEntry 释放自包含 node-pty 包并设置
 *    NEX_PTY_ENTRY。SEA 主脚本的 require 被 loader 接管，内联的 node-pty
 *    无法完成 addon 探测（ERR_UNKNOWN_BUILTIN_MODULE）；createRequire 锚定
 *    磁盘路径后的 require 走标准解析，能加载完整包。
 * 2. 常规/内联兜底：直接用内联的 import("node-pty")，配合 addon 重定向 hook。
 *
 * 顺序很关键：hook 必须在第一次 import 之前装好。node-pty 主模块在顶层探测
 * build/Release/pty.node，esbuild 的 __commonJS helper 即使探测抛错也会写入
 * （半初始化的）缓存，导致"catch 后重试"拿到空 exports
 *（"nodePty.spawn is not a function"）而不是重跑探测。
 */

export type NodePtyModule = typeof import("node-pty");

let nodePtyModulePromise: Promise<NodePtyModule> | null = null;

export function isUsableNodePtyModule(mod: unknown): mod is NodePtyModule {
  return (
    typeof mod === "object" && mod !== null && typeof (mod as NodePtyModule).spawn === "function"
  );
}

/** SEA/embedding 释放目录的确定性加载路径（见文件头说明）。 */
export function loadNodePtyFromReleasedEntry(): NodePtyModule | null {
  const entry = process.env.NEX_PTY_ENTRY?.trim();
  if (!entry || !existsSync(entry)) {
    return null;
  }
  try {
    const loaded = createRequire(entry)(entry) as NodePtyModule;
    if (!isUsableNodePtyModule(loaded)) {
      throw new Error(`released node-pty at '${entry}' has no spawn function`);
    }
    return loaded;
  } catch (error: unknown) {
    // 释放副本损坏（版本切换中断等）时回退到内联 import 路径并如实报告。
    console.warn(
      `[terminal] released node-pty entry '${entry}' failed to load: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

export async function loadNodePtyModule(): Promise<NodePtyModule> {
  if (!nodePtyModulePromise) {
    const released = loadNodePtyFromReleasedEntry();
    if (released) {
      nodePtyModulePromise = Promise.resolve(released);
      return nodePtyModulePromise;
    }
    nodePtyModulePromise = (async () => {
      const fallbackDir = resolveFallbackPtyModuleDir();
      const restore = fallbackDir ? installNativePtyAddonRedirect(fallbackDir) : null;
      try {
        if (fallbackDir) {
          // The addon require probes build/Release first, so node-pty will
          // look for the darwin spawn-helper there as well; stage it from the
          // fallback dir before the first load reads it.
          ensureFallbackSpawnHelperInstalled(fallbackDir);
        }
        const loaded = (await import("node-pty")) as NodePtyModule;
        if (!isUsableNodePtyModule(loaded)) {
          throw new Error(
            "node-pty namespace has no spawn function (module loaded but addon initialization failed)",
          );
        }
        return loaded;
      } catch (error: unknown) {
        nodePtyModulePromise = null;
        if (fallbackDir) {
          throw new Error(
            `node-pty is unavailable in this runtime (fallback dir '${fallbackDir}' did not resolve it either): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        throw error;
      } finally {
        restore?.();
      }
    })();
  }

  return nodePtyModulePromise;
}
