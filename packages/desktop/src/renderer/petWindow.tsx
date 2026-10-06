/**
 * 宠物悬浮窗 renderer：订阅 main 推送的状态并渲染，处理点击聚焦与拖拽移动。
 *
 * 拖拽设计：renderer 本地 mousemove 节流 16ms 发 drag-move 给 main，
 * main 用 win.setPosition 跟随；拖拽期间按水平位移方向本地覆盖动画为
 * running-left / running-right（Codex 拖拽动效），松手回落到语义状态。
 */
import { createRoot } from "react-dom/client";
import { createElement, useEffect, useRef, useState } from "react";
import type { PetWindowAction, PetWindowState } from "@nex/shared";
import { PetSprite } from "@/pets/PetSprite.js";

declare global {
  interface Window {
    nexPet?: {
      onState?(handler: (state: PetWindowState | null) => void): () => void;
      sendAction?(action: PetWindowAction): void;
    };
  }
}

const DRAG_THRESHOLD_PX = 4;
const DRAG_SEND_INTERVAL_MS = 16;

function PetWindowApp() {
  const [state, setState] = useState<PetWindowState | null>(null);
  const [dragOverride, setDragOverride] = useState<"running-left" | "running-right" | null>(null);

  // 拖拽会话状态（renderer 本地，不经 React state 以保性能）。
  const dragSessionRef = useRef<{
    pointerStartX: number;
    pointerStartY: number;
    /** 拖拽起点时窗口的屏幕左上角（main 侧坐标）。 */
    windowStartX: number;
    windowStartY: number;
    lastSentAt: number;
    lastPointerX: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    return window.nexPet?.onState?.((next) => setState(next)) ?? (() => {});
  }, []);

  // 拖拽期间把覆盖动画合成到状态里（本地覆盖优先于 main 推送的语义动画）。
  useEffect(() => {
    if (!dragOverride) return;
    setState((current) =>
      current ? { ...current, dragAnimationOverride: dragOverride } : current,
    );
  }, [dragOverride]);

  if (!state) return null;

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    dragSessionRef.current = {
      pointerStartX: event.screenX,
      pointerStartY: event.screenY,
      // 窗口当前位置由 main 侧 position 状态带入；缺省用屏幕坐标近似。
      windowStartX: state.position?.x ?? event.screenX - event.clientX,
      windowStartY: state.position?.y ?? event.screenY - event.clientY,
      lastSentAt: 0,
      lastPointerX: event.screenX,
      dragging: false,
    };
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    const session = dragSessionRef.current;
    if (!session) return;

    const dx = event.screenX - session.pointerStartX;
    const dy = event.screenY - session.pointerStartY;
    if (!session.dragging) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      session.dragging = true;
    }

    // 拖拽动效：按水平移动方向切 running-left / running-right。
    const horizontalDelta = event.screenX - session.lastPointerX;
    if (horizontalDelta < -0.5) setDragOverride("running-left");
    else if (horizontalDelta > 0.5) setDragOverride("running-right");
    session.lastPointerX = event.screenX;

    // 节流发 drag-move 给 main 跟手。
    const now = Date.now();
    if (now - session.lastSentAt >= DRAG_SEND_INTERVAL_MS) {
      session.lastSentAt = now;
      window.nexPet?.sendAction?.({
        kind: "drag-move",
        x: Math.round(session.windowStartX + dx),
        y: Math.round(session.windowStartY + dy),
      });
    }
  };

  const handleMouseUp = (event: React.MouseEvent) => {
    const session = dragSessionRef.current;
    dragSessionRef.current = null;
    setDragOverride(null);
    if (!session) return;
    if (!session.dragging) {
      window.nexPet?.sendAction?.({ kind: "focus-main-window" });
      return;
    }
    // 拖拽落定：回传最终位置持久化。
    window.nexPet?.sendAction?.({
      kind: "moved",
      x: Math.round(session.windowStartX + (event.screenX - session.pointerStartX)),
      y: Math.round(session.windowStartY + (event.screenY - session.pointerStartY)),
    });
  };

  const animationName = state.dragAnimationOverride ?? state.animation;

  return createElement(
    "div",
    {
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: () => {
        // 鼠标拖出窗口时结束拖拽（不触发点击）。
        if (dragSessionRef.current?.dragging) {
          dragSessionRef.current = null;
          setDragOverride(null);
        }
      },
      style: { cursor: dragOverride ? "grabbing" : "grab" },
    },
    createElement(PetSprite, {
      spriteUrl: state.spriteUrl,
      manifest: null,
      animationName,
      heightPx: 120,
    }),
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(createElement(PetWindowApp));
}
