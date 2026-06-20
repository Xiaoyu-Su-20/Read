import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

function startupTrace(step: string, fields: Record<string, unknown> = {}) {
  const payload = {
    step,
    epochMs: Date.now(),
    navigationMs: Math.round(performance.now()),
    ...fields
  };
  console.info(`[CR-STARTUP][pointer-reorder] ${step}`, payload);
}

startupTrace("module-loaded");
export type PointerReorderEndReason = "drop" | "cancel";

export type PointerReorderSnapshot<T> = {
  payload: T;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
};

type PointerReorderSession<T> = PointerReorderSnapshot<T> & {
  dragging: boolean;
  handle: HTMLElement;
};

type UsePointerReorderOptions<T> = {
  thresholdPx?: number;
  onDragStart?: (snapshot: PointerReorderSnapshot<T>) => void;
  onDragMove?: (snapshot: PointerReorderSnapshot<T>) => void;
  onDragEnd?: (
    snapshot: PointerReorderSnapshot<T>,
    reason: PointerReorderEndReason
  ) => void;
};

function toSnapshot<T>(session: PointerReorderSession<T>): PointerReorderSnapshot<T> {
  return {
    payload: session.payload,
    pointerId: session.pointerId,
    startX: session.startX,
    startY: session.startY,
    clientX: session.clientX,
    clientY: session.clientY
  };
}

export function usePointerReorder<T>({
  thresholdPx = 6,
  onDragStart,
  onDragMove,
  onDragEnd
}: UsePointerReorderOptions<T>) {
  startupTrace("hook-init", {
    thresholdPx
  });
  const sessionRef = useRef<PointerReorderSession<T> | null>(null);
  const callbacksRef = useRef({
    onDragEnd,
    onDragMove,
    onDragStart
  });

  callbacksRef.current = {
    onDragEnd,
    onDragMove,
    onDragStart
  };

  const detachWindowListeners = useCallback(() => {
    window.removeEventListener("pointermove", handleWindowPointerMove, true);
    window.removeEventListener("pointerup", handleWindowPointerUp, true);
    window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
  }, []);

  const finishSession = useCallback(
    (reason: PointerReorderEndReason) => {
      const session = sessionRef.current;
      if (!session) {
        return;
      }

      sessionRef.current = null;
      detachWindowListeners();
      if (!session.dragging) {
        return;
      }

      callbacksRef.current.onDragEnd?.(toSnapshot(session), reason);
    },
    [detachWindowListeners]
  );

  const handleWindowPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }

      session.clientX = event.clientX;
      session.clientY = event.clientY;

      if (!session.dragging) {
        const movedEnough =
          Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >=
          thresholdPx;
        if (!movedEnough) {
          return;
        }

        session.dragging = true;
        callbacksRef.current.onDragStart?.(toSnapshot(session));
      }

      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onDragMove?.(toSnapshot(session));
    },
    [thresholdPx]
  );

  const handleWindowPointerUp = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }

      session.clientX = event.clientX;
      session.clientY = event.clientY;
      event.preventDefault();
      event.stopPropagation();
      finishSession("drop");
    },
    [finishSession]
  );

  const handleWindowPointerCancel = useCallback(
    (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      finishSession("cancel");
    },
    [finishSession]
  );

  const attachWindowListeners = useCallback(() => {
    window.addEventListener("pointermove", handleWindowPointerMove, true);
    window.addEventListener("pointerup", handleWindowPointerUp, true);
    window.addEventListener("pointercancel", handleWindowPointerCancel, true);
  }, [handleWindowPointerCancel, handleWindowPointerMove, handleWindowPointerUp]);

  useEffect(() => {
    startupTrace("hook-mounted");
    return () => {
      startupTrace("hook-unmounted");
      finishSession("cancel");
    };
  }, [finishSession]);

  const createHandleProps = useCallback(
    (payload: T) => ({
      "data-no-window-drag": true as const,
      onClick(event: ReactPointerEvent<HTMLElement>) {
        event.stopPropagation();
      },
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        detachWindowListeners();

        sessionRef.current = {
          payload,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
          dragging: false,
          handle: event.currentTarget
        };
        attachWindowListeners();
      }
    }),
    [attachWindowListeners, detachWindowListeners]
  );

  const cancelDrag = useCallback(() => {
    finishSession("cancel");
  }, [finishSession]);

  return {
    activeSessionRef: sessionRef,
    cancelDrag,
    createHandleProps
  };
}
