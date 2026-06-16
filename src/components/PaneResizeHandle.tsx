import type { HTMLAttributes } from "react";

type PaneResizeHandleProps = {
  active: boolean;
  hidden: boolean;
  separatorProps: HTMLAttributes<HTMLElement>;
};

export default function PaneResizeHandle({
  active,
  hidden,
  separatorProps
}: PaneResizeHandleProps) {
  return (
    <div
      {...separatorProps}
      className={`pane-resize-handle${active ? " pane-resize-handle--active" : ""}${hidden ? " pane-resize-handle--hidden" : ""}`}
      aria-hidden={hidden ? "true" : undefined}
      data-no-window-drag
    >
      <span className="pane-resize-handle__line" aria-hidden="true" />
      <span className="pane-resize-handle__grip" aria-hidden="true">
        <span className="pane-resize-handle__dots">
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}
