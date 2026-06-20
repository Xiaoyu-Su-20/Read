import { useEffect, useRef, useState, type HTMLAttributes } from "react";

type PaneResizeHandleProps = {
  active: boolean;
  autoHide: boolean;
  hidden: boolean;
  separatorProps: HTMLAttributes<HTMLElement>;
};

export default function PaneResizeHandle({
  active,
  autoHide,
  hidden,
  separatorProps
}: PaneResizeHandleProps) {
  const hideTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(() => !autoHide);

  function clearHideTimer() {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  function scheduleHide(delayMs = 180) {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, delayMs);
  }

  useEffect(() => {
    if (!autoHide) {
      clearHideTimer();
      setVisible(true);
      return;
    }

    if (active) {
      clearHideTimer();
      setVisible(true);
      return;
    }

    scheduleHide();
  }, [active, autoHide]);

  useEffect(() => {
    if (hidden) {
      clearHideTimer();
      setVisible(false);
      return;
    }

    if (!autoHide) {
      setVisible(true);
    }
  }, [autoHide, hidden]);

  useEffect(() => {
    return () => {
      clearHideTimer();
    };
  }, []);

  const handleVisible = !hidden && (!autoHide || active || visible);

  return (
    <div
      className={`pane-resize-handle${active ? " pane-resize-handle--active" : ""}${hidden ? " pane-resize-handle--hidden" : ""}${autoHide ? " pane-resize-handle--auto-hide" : ""}${handleVisible ? " pane-resize-handle--visible" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
      data-no-window-drag
    >
      {autoHide ? (
        <span
          className="pane-resize-handle__zone"
          aria-hidden="true"
          onPointerEnter={() => {
            clearHideTimer();
            setVisible(true);
          }}
          onPointerLeave={() => {
            if (!active) {
              scheduleHide();
            }
          }}
        />
      ) : null}
      <span className="pane-resize-handle__line" aria-hidden="true" />
      <span
        {...separatorProps}
        className="pane-resize-handle__grip"
        aria-hidden={hidden ? "true" : undefined}
        onPointerEnter={() => {
          clearHideTimer();
          setVisible(true);
        }}
        onPointerLeave={() => {
          if (!active) {
            scheduleHide();
          }
        }}
        onFocus={() => {
          clearHideTimer();
          setVisible(true);
        }}
        onBlur={() => {
          if (!active) {
            scheduleHide();
          }
        }}
        onPointerDown={(event) => {
          clearHideTimer();
          setVisible(true);
          separatorProps.onPointerDown?.(event);
        }}
      >
        <span className="pane-resize-handle__dots">
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}
