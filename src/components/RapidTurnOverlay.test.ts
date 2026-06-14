import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import RapidTurnOverlay from "./RapidTurnOverlay";

describe("RapidTurnOverlay", () => {
  it("renders the target page and progress track without extra status copy", () => {
    const markup = renderToStaticMarkup(
      createElement(RapidTurnOverlay, {
        overlay: {
          visible: true,
          targetPage: 150,
          pageCount: 160,
          isFinalizing: true,
          progress: 0.9375
        }
      })
    );

    expect(markup).toContain("Page 150 of 160");
    expect(markup).toContain("rapid-turn-overlay__track");
    expect(markup).toContain("scaleX(0.9375)");
  });

  it("keeps the same compact markup while sampling intermediate pages", () => {
    const markup = renderToStaticMarkup(
      createElement(RapidTurnOverlay, {
        overlay: {
          visible: true,
          targetPage: 42,
          pageCount: 160,
          isFinalizing: false,
          progress: 0.2625
        }
      })
    );

    expect(markup).toContain("Page 42 of 160");
    expect(markup).not.toContain("rapid-turn-overlay__meta");
  });
});
