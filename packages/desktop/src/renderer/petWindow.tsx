/**
 * 宠物悬浮窗 renderer：订阅 main 推送的状态并渲染，上报点击与拖拽指针事件。
 *
 * 拖拽状态机归 main 所有（petWindow.ts）；这里只做手势识别：
 * pointer capture + 4px 死区区分点击与拖拽，上报屏幕坐标与松手速度，
 * 并在拖拽期间本地覆盖 running-left/right 动画、悬停时 jumping / 看向光标。
 */
import { createRoot } from "react-dom/client";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  PET_DRAG_DEAD_ZONE_PX,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  PET_VELOCITY_WINDOW_MS,
  computePetReleaseVelocity,
  resolvePetLookSector,
  type PetPointerSample,
  type PetWindowAction,
  type PetWindowState,
} from "@nex/shared";
import { PetSprite } from "@/pets/PetSprite.js";
import {
  appendPetPointerSample,
  resolvePetPresentation,
  updatePetDragDirection,
  type PetDragDirection,
} from "@/pets/petInteraction.js";

declare global {
  interface Window {
    nexPet?: {
      onState?(handler: (state: PetWindowState | null) => void): () => void;
      sendAction?(action: PetWindowAction): void;
    };
  }
}

const DRAG_SEND_INTERVAL_MS = 16;

interface GestureSession {
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  samples: PetPointerSample[];
  direction: { direction: PetDragDirection | null; anchorX: number };
  lastSentAt: number;
}

function sendAction(action: PetWindowAction) {
  window.nexPet?.sendAction?.(action);
}

function PetWindowApp() {
  const [state, setState] = useState<PetWindowState | null>(null);
  const [dragDirection, setDragDirection] = useState<PetDragDirection | null>(null);
  const [hovering, setHovering] = useState(false);
  const [lookSector, setLookSector] = useState<number | null>(null);
  const sessionRef = useRef<GestureSession | null>(null);

  useEffect(() => window.nexPet?.onState?.((next) => setState(next)) ?? (() => {}), []);

  const presentation = useMemo(
    () =>
      resolvePetPresentation({
        semantic: state?.animation ?? "idle",
        dragDirection,
        hovering,
        spriteRows: state?.spriteRows ?? 9,
        lookSector,
      }),
    [state?.animation, state?.spriteRows, dragDirection, hovering, lookSector],
  );

  if (!state) return null;

  const heightPx = Math.round((state.sizePx * PET_FRAME_HEIGHT) / PET_FRAME_WIDTH);

  const updateLook = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLookSector(
      resolvePetLookSector(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2),
      ),
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      dragging: false,
      samples: [{ x: event.screenX, y: event.screenY, timeMs: event.timeStamp }],
      direction: { direction: null, anchorX: event.screenX },
      lastSentAt: 0,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      updateLook(event);
      return;
    }
    session.samples = appendPetPointerSample(
      session.samples,
      { x: event.screenX, y: event.screenY, timeMs: event.timeStamp },
      PET_VELOCITY_WINDOW_MS,
    );
    if (!session.dragging) {
      const moved = Math.max(
        Math.abs(event.screenX - session.startX),
        Math.abs(event.screenY - session.startY),
      );
      if (moved < PET_DRAG_DEAD_ZONE_PX) return;
      session.dragging = true;
      sendAction({ kind: "drag-start", pointerX: session.startX, pointerY: session.startY });
    }
    const nextDirection = updatePetDragDirection(session.direction, event.screenX);
    if (nextDirection.direction !== session.direction.direction) {
      setDragDirection(nextDirection.direction);
    }
    session.direction = nextDirection;

    if (event.timeStamp - session.lastSentAt >= DRAG_SEND_INTERVAL_MS) {
      session.lastSentAt = event.timeStamp;
      sendAction({ kind: "drag-move", pointerX: event.screenX, pointerY: event.screenY });
    }
  };

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    sessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragDirection(null);
    // 捕获期间指针可能已移出窗口，此时不会再收到 pointerleave，需在松手时补判。
    const rect = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    if (!inside) {
      setHovering(false);
      setLookSector(null);
    }
    if (!session.dragging) {
      if (!cancelled) sendAction({ kind: "focus-main-window" });
      return;
    }
    const velocity = computePetReleaseVelocity([
      ...session.samples,
      { x: event.screenX, y: event.screenY, timeMs: event.timeStamp },
    ]);
    sendAction({
      kind: "drag-end",
      pointerX: event.screenX,
      pointerY: event.screenY,
      altKey: event.altKey,
      ...(velocity ? { velocity } : {}),
    });
  };

  return createElement(
    "div",
    {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => finishGesture(event, false),
      onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => finishGesture(event, true),
      onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
        setHovering(true);
        updateLook(event);
      },
      onPointerLeave: () => {
        if (sessionRef.current) return;
        setHovering(false);
        setLookSector(null);
      },
      "data-pet-state": state.animation,
      style: {
        width: "100%",
        height: "100%",
        touchAction: "none",
        cursor: dragDirection ? "grabbing" : "grab",
      },
    },
    createElement(PetSprite, {
      spriteUrl: state.spriteUrl,
      manifest: state.manifest,
      spriteRows: state.spriteRows,
      animationName: presentation.animationName,
      lookSector: presentation.lookSector,
      heightPx,
    }),
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(createElement(PetWindowApp));
}
