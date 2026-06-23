import { describe, expect, it } from "vitest";

import {
  captureBlockEndRange,
  getAdjacentPageLink,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  renderNoteBlocksHtml,
  turnSelectionIntoTopicCard
} from "./noteEditorDom";
import {
  createPageLinkNode,
  createTopicCardNode,
  createTextNode
} from "./notes";

const hasDom = typeof document !== "undefined";

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

  it("renders inline topic cards with topic metadata and no natural tab stop", () => {
    const topicCard = createTopicCardNode({
      id: "topic-1",
      text: "Program signals",
      color: "accent"
    });

    const markup = renderNoteBlocksHtml([
      {
        id: "paragraph-topics",
        type: "paragraph",
        children: [topicCard!, createTextNode("Particular signals are needed.")]
      }
    ]);

    expect(markup).toContain('data-inline-type="topic-card"');
    expect(markup).toContain('data-topic-color="accent"');
    expect(markup).toContain('tabindex="-1"');
  });

  it.skip("parses rendered topic cards back into inline note content", () => {
    const topicOne = createTopicCardNode({
      id: "topic-1",
      text: "Program signals",
      color: "accent"
    });
    const topicTwo = createTopicCardNode({
      id: "topic-2",
      text: "Observation",
      color: "interactive"
    });

    document.body.innerHTML = `<div id="root">${renderNoteBlocksHtml([
      {
        id: "paragraph-topics",
        type: "paragraph",
        children: [topicOne!, createTextNode("Particular "), topicTwo!, createTextNode("signals are needed.")]
      }
    ])}</div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const blocks = parseNoteBlocksFromEditor(root);

    expect(blocks[0]?.children).toEqual([
      topicOne,
      createTextNode("Particular "),
      topicTwo,
      createTextNode("signals are needed.")
    ]);
  });

  it.skip("turns a paragraph selection into an inline topic card and removes the selected text", () => {
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

    const result = turnSelectionIntoTopicCard(root, "emphasis");

    expect(result.ok).toBe(true);
    const blocks = parseNoteBlocksFromEditor(root);
    expect(blocks[0]?.children).toEqual([
      createTextNode("("),
      expect.objectContaining({
        type: "topic-card",
        text: "Program signals",
        color: "emphasis"
      }),
      createTextNode(") Particular signals are needed.")
    ]);
  });

  it.skipIf(!hasDom)("does not collapse the active selection when capturing a block-end range", () => {
    document.body.innerHTML = `<div id="root">${renderNoteBlocksHtml([
      {
        id: "paragraph-selection",
        type: "paragraph",
        children: [createTextNode("Selected text stays selected")]
      }
    ])}</div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const textNode = root.querySelector("[data-block-id]")?.firstChild as Text;
    const block = root.querySelector("[data-block-id]") as HTMLDivElement;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const capturedRange = captureBlockEndRange(root, block);

    expect(capturedRange?.collapsed).toBe(true);
    expect(selection?.toString()).toBe("Selected");
  });

  it.skipIf(!hasDom)("keeps adjacent pagelink deletion within the current block", () => {
    document.body.innerHTML = `<div id="root">${renderNoteBlocksHtml([
      {
        id: "paragraph-1",
        type: "paragraph",
        children: [
          createTextNode("Before "),
          createPageLinkNode({
            text: "(p. 12)",
            bookPageLabel: "12",
            documentId: "doc-1",
            pdfPageIndex: 11
          })
        ]
      },
      {
        id: "heading-1",
        type: "heading1",
        children: [createTextNode("Heading")]
      }
    ])}</div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const headingText = root.querySelector("h1")?.firstChild as Text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(headingText, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(getAdjacentPageLink(root, "backward")).toBeNull();
  });

  it.skipIf(!hasDom)("normalizes empty headings into editable paragraphs", () => {
    document.body.innerHTML = `<div id="root"><h2 data-block-id="heading-empty" data-block-type="heading2"></h2></div>`;

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const block = root.firstElementChild as HTMLElement | null;

    expect(block?.tagName).toBe("DIV");
    expect(block?.dataset.blockType).toBe("paragraph");
    expect(block?.querySelector("br")).not.toBeNull();
  });

  it.skipIf(!hasDom)("rebuilds heading tags from authoritative data-block-type", () => {
    document.body.innerHTML =
      '<div id="root"><div data-block-id="heading-tag-drift" data-block-type="heading1">Recovered heading</div></div>';

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const block = root.firstElementChild as HTMLElement | null;

    expect(block?.tagName).toBe("H1");
    expect(block?.dataset.blockType).toBe("heading1");
    expect(block?.textContent).toBe("Recovered heading");
  });

  it.skipIf(!hasDom)("rebuilds canonical pagelink markup during normalization", () => {
    document.body.innerHTML =
      '<div id="root"><div data-block-id="paragraph-1" data-block-type="paragraph">Before <span data-inline-type="page-link" data-page-link-id="link-1" data-document-id="doc-1" data-pdf-page-index="12" data-book-page-label="13" data-created-at="2026-01-01T00:00:00.000Z">broken</span> After</div></div>';

    const root = document.getElementById("root") as HTMLDivElement;
    normalizeNoteEditorDom(root);
    const pageLink = root.querySelector("[data-inline-type='page-link']") as HTMLElement | null;

    expect(pageLink?.classList.contains("page-link")).toBe(true);
    expect(pageLink?.getAttribute("contenteditable")).toBe("false");
    expect(pageLink?.querySelector(".page-link__icon")).not.toBeNull();
    expect(pageLink?.querySelector(".page-link__label")?.textContent).toBe("13");
    expect(pageLink?.textContent).toBe("(13)");
  });

});
