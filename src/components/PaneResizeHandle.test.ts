import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import PaneResizeHandle from "./PaneResizeHandle";

describe("PaneResizeHandle", () => {
  it("renders a separator with the centered grip affordance", () => {
    const markup = renderToStaticMarkup(
      createElement(PaneResizeHandle, {
        active: true,
        hidden: false,
        separatorProps: {
          role: "separator",
          "aria-label": "Resize document and notes panes",
          "aria-orientation": "vertical",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": 46,
          tabIndex: 0,
          onKeyDown: vi.fn(),
          onPointerDown: vi.fn(),
          onPointerMove: vi.fn(),
          onPointerUp: vi.fn(),
          onPointerCancel: vi.fn(),
          onLostPointerCapture: vi.fn()
        }
      })
    );

    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-valuenow="46"');
    expect(markup).toContain('class="pane-resize-handle pane-resize-handle--active"');
    expect(markup).toContain('class="pane-resize-handle__grip"');
    expect(markup.match(/pane-resize-handle__dots/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("marks the handle hidden when it should be suppressed behind overlays", () => {
    const markup = renderToStaticMarkup(
      createElement(PaneResizeHandle, {
        active: false,
        hidden: true,
        separatorProps: {
          role: "separator",
          "aria-label": "Resize document and notes panes",
          "aria-orientation": "vertical",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": 46,
          tabIndex: -1,
          onKeyDown: vi.fn(),
          onPointerDown: vi.fn(),
          onPointerMove: vi.fn(),
          onPointerUp: vi.fn(),
          onPointerCancel: vi.fn(),
          onLostPointerCapture: vi.fn()
        }
      })
    );

    expect(markup).toContain('class="pane-resize-handle pane-resize-handle--hidden"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
