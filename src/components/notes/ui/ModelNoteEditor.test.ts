import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createPageLinkNode, createTextNode } from "../../../lib/notes";
import type { NoteDocument } from "../../../lib/types";
import ModelNoteEditor from "./ModelNoteEditor";

describe("ModelNoteEditor", () => {
  it("renders non-editable structural wrappers with one editable surface per block", () => {
    const note: NoteDocument = {
      id: "note",
      title: "Model editor",
      bookId: "book",
      createdAt: "2026-06-24T00:00:00.000Z",
      updatedAt: "2026-06-24T00:00:00.000Z",
      version: 1,
      blocks: [
        {
          id: "heading",
          type: "heading1",
          children: [createTextNode("Chapter")]
        },
        {
          id: "paragraph",
          type: "paragraph",
          children: [
            createTextNode("See "),
            createPageLinkNode({
              text: "(p. 27)",
              bookPageLabel: "27",
              documentId: "book",
              pdfPageIndex: 26
            })
          ]
        }
      ]
    };

    const markup = renderToStaticMarkup(
      createElement(ModelNoteEditor, {
        note,
        loading: false,
        ignoredSpellcheckWords: [],
        currentPage: 27,
        documentCapabilities: true,
        onChangeBlocks: vi.fn(),
        onBlur: vi.fn(),
        onOpenPageLink: vi.fn()
      })
    );

    expect(markup).toContain('data-block-type="heading1"');
    expect(markup).toContain('class="note-editor__block-content"');
    expect(markup).toMatch(/note-editor__body[^>]*contenteditable="true"/);
    expect(markup.match(/contenteditable="true"/g)).toHaveLength(1);
    expect(markup).not.toContain("<h1");
    expect(markup).not.toContain("font-size:");
    expect(markup).toContain('data-inline-type="page-link"');
  });
});
