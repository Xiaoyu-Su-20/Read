import { describe, expect, it } from "vitest";

import {
  createHeadingReferenceDecoration,
  resolveHeadingReferenceAnchorRect
} from "./headingReferenceDecorations";
import type { DocumentSourceReference } from "../../lib/types";

const reference: DocumentSourceReference = {
  id: "ref-1",
  documentId: "doc-1",
  kind: "direct",
  outlineItemId: null,
  outlineSource: null,
  title: "Chapter 1",
  target: {
    documentId: "doc-1",
    pageIndex: 12
  },
  createdAt: "2026-06-20T00:00:00Z"
};

describe("headingReferenceDecorations", () => {
  it("chooses the last non-empty line rect", () => {
    const anchor = resolveHeadingReferenceAnchorRect(
      [
        {
          left: 12,
          top: 18,
          right: 72,
          bottom: 34,
          width: 60,
          height: 16
        },
        {
          left: 12,
          top: 34,
          right: 12,
          bottom: 34,
          width: 0,
          height: 0
        },
        {
          left: 12,
          top: 36,
          right: 84,
          bottom: 52,
          width: 72,
          height: 16
        }
      ],
      {
        left: 8,
        top: 16,
        right: 96,
        bottom: 56,
        width: 88,
        height: 40
      }
    );

    expect(anchor.left).toBe(12);
    expect(anchor.top).toBe(36);
    expect(anchor.right).toBe(84);
    expect(anchor.bottom).toBe(52);
  });

  it("falls back to the block rect when line rects are empty", () => {
    const anchor = resolveHeadingReferenceAnchorRect(
      [
        {
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          width: 0,
          height: 0
        }
      ],
      {
        left: 10,
        top: 20,
        right: 90,
        bottom: 60,
        width: 80,
        height: 40
      }
    );

    expect(anchor.left).toBe(10);
    expect(anchor.top).toBe(20);
    expect(anchor.right).toBe(90);
    expect(anchor.bottom).toBe(60);
  });

  it("positions the decoration relative to the editor container", () => {
    const decoration = createHeadingReferenceDecoration({
      blockId: "heading-1",
      blockType: "heading2",
      reference,
      anchorRect: {
        left: 124,
        top: 210,
        right: 196,
        bottom: 228,
        width: 72,
        height: 18
      },
      containerRect: {
        left: 100,
        top: 160
      },
      gapPx: 6
    });

    expect(decoration.blockId).toBe("heading-1");
    expect(decoration.blockType).toBe("heading2");
    expect(decoration.reference.title).toBe("Chapter 1");
    expect(decoration.left).toBe(102);
    expect(decoration.top).toBe(68);
  });
});
