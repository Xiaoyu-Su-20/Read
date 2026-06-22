import { describe, expect, it } from "vitest";

import { renderNoteBlocksHtml } from "./noteEditorDom";
import {
  createSectionBreakBlock,
  createPageLinkNode,
  createTextNode
} from "./notes";
import type { DocumentSourceReference } from "./types";

describe("noteEditorDom accessibility behavior", () => {
  it("renders pagelinks outside the natural tab order and keeps heading references in data only", () => {
    const sourceReference: DocumentSourceReference = {
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
      createdAt: "2026-06-18T00:00:00Z"
    };

    const markup = renderNoteBlocksHtml([
      {
        id: "paragraph-1",
        type: "paragraph",
        children: [
          createTextNode("See "),
          createPageLinkNode({
            text: "(p. 40)",
            bookPageLabel: "40",
            documentId: "doc-1",
            pdfPageIndex: 22
          })
        ]
      },
      {
        id: "heading-1",
        type: "heading2",
        children: [createTextNode("Chapter 1")],
        sourceReference
      }
    ]);

    expect(markup).not.toContain('tabindex="0"');
    expect(markup).toContain('data-inline-type="page-link"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('data-source-reference=');
    expect(markup).not.toContain('data-heading-reference-indicator="true"');
  });

  it("does not render any inline note token as naturally tabbable", () => {
    const sourceReference: DocumentSourceReference = {
      id: "ref-2",
      documentId: "doc-2",
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title: "Chapter 2",
      target: {
        documentId: "doc-2",
        pageIndex: 8
      },
      createdAt: "2026-06-18T00:00:00Z"
    };

    const markup = renderNoteBlocksHtml([
      {
        id: "paragraph-2",
        type: "paragraph",
        children: [
          createTextNode("Before "),
          createPageLinkNode({
            text: "(p. 14)",
            bookPageLabel: "14",
            documentId: "doc-2",
            pdfPageIndex: 9
          })
        ]
      },
      {
        id: "heading-2",
        type: "heading1",
        children: [createTextNode("Heading")],
        sourceReference
      }
    ]);

    const nonNegativeTabStops = markup.match(/tabindex="(0|[1-9]\d*)"/g);

    expect(nonNegativeTabStops).toBeNull();
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(1);
    expect(markup).toContain('data-source-reference=');
    expect(markup).not.toContain('data-heading-reference-indicator="true"');
  });

  it("renders section breaks as non-editable separator blocks", () => {
    const markup = renderNoteBlocksHtml([
      createSectionBreakBlock(),
      {
        id: "body-between",
        type: "paragraph",
        children: [createTextNode("Between")]
      },
      createSectionBreakBlock()
    ]);

    expect(markup).toContain('data-block-type="sectionBreak"');
    expect(markup).toContain('class="note-section-break note-section-break--short"');
    expect(markup).toContain('contenteditable="false"');
    expect(markup).toContain('role="separator"');
  });
});
