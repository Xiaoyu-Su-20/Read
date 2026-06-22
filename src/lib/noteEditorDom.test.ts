import { describe, expect, it } from "vitest";

import {
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  renderNoteBlocksHtml,
  turnSelectionIntoTopicCard
} from "./noteEditorDom";
import {
  createSectionBreakBlock,
  createPageLinkNode,
  createTextNode
} from "./notes";

describe("noteEditorDom accessibility behavior", () => {
  it("renders pagelinks outside the natural tab order in both paragraphs and headings", () => {
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
        children: [
          createTextNode("Chapter 1"),
          createPageLinkNode({
            text: "(p. 13)",
            bookPageLabel: "13",
            documentId: "doc-1",
            pdfPageIndex: 12
          })
        ]
      }
    ]);

    expect(markup).not.toContain('tabindex="0"');
    expect(markup).toContain('data-inline-type="page-link"');
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(markup).toContain("page-link__icon");
  });

  it("does not render any inline note token as naturally tabbable", () => {
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
        children: [
          createTextNode("Heading"),
          createPageLinkNode({
            text: "(p. 14)",
            bookPageLabel: "14",
            documentId: "doc-2",
            pdfPageIndex: 9
          })
        ]
      }
    ]);

    const nonNegativeTabStops = markup.match(/tabindex="(0|[1-9]\d*)"/g);

    expect(nonNegativeTabStops).toBeNull();
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
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

  it("renders paragraph topic cards with topic metadata and no natural tab stop", () => {
    const markup = renderNoteBlocksHtml([
      {
        id: "paragraph-topics",
        type: "paragraph",
        topics: [
          {
            id: "topic-1",
            text: "Program signals",
            color: "amber"
          }
        ],
        children: [createTextNode("Particular signals are needed.")]
      }
    ]);

    expect(markup).toContain('data-inline-type="topic-card"');
    expect(markup).toContain('data-topic-color="amber"');
    expect(markup).toContain('tabindex="-1"');
  });

  it.skip("parses rendered topic cards back into paragraph topic metadata", () => {
    document.body.innerHTML = `<div id="root">${renderNoteBlocksHtml([
      {
        id: "paragraph-topics",
        type: "paragraph",
        topics: [
          {
            id: "topic-1",
            text: "Program signals",
            color: "amber"
          },
          {
            id: "topic-2",
            text: "Observation",
            color: "blue"
          }
        ],
        children: [createTextNode("Particular signals are needed.")]
      }
    ])}</div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const blocks = parseNoteBlocksFromEditor(root);

    expect(blocks[0]?.topics).toEqual([
      {
        id: "topic-1",
        text: "Program signals",
        color: "amber"
      },
      {
        id: "topic-2",
        text: "Observation",
        color: "blue"
      }
    ]);
    expect(blocks[0]?.children).toEqual([createTextNode("Particular signals are needed.")]);
  });

  it.skip("turns a paragraph selection into a topic card and removes the selected text", () => {
    document.body.innerHTML = `<div id="root">${renderNoteBlocksHtml([
      {
        id: "paragraph-selection",
        type: "paragraph",
        children: [createTextNode("(Program signals) Particular signals are needed.")]
      }
    ])}</div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const textNode = root.querySelector("[data-block-id]")?.firstChild as Text;
    const selection = window.getSelection();
    const range = document.createRange();
    const start = textNode.textContent?.indexOf("Program signals") ?? -1;
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "Program signals".length);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const result = turnSelectionIntoTopicCard(root, "rose");

    expect(result.ok).toBe(true);
    const blocks = parseNoteBlocksFromEditor(root);
    expect(blocks[0]?.topics).toEqual([
      expect.objectContaining({
        text: "Program signals",
        color: "rose"
      })
    ]);
    expect(blocks[0]?.children).toEqual([createTextNode("Particular signals are needed.")]);
  });
});
