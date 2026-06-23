import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPageLinkNode,
  createSaveScheduler,
  createTextNode,
  createTopicCardNode,
  deriveNoteNavigationItems,
  formatPageLinkText,
  normalizeDocumentSourceReference,
  normalizeNoteBlocks,
  normalizeNoteDocument,
  normalizeNoteSpans,
  noteToPlainText,
  parsePageLinkText,
  parsePageLinkTargetInput,
  replaceBlockSourceReference,
  replaceBlockType
} from "./notes";
import type { NoteBlock, NoteDocument } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

describe("notes helpers", () => {
  it("derives navigation entries from heading blocks only", () => {
    const items = deriveNoteNavigationItems([
      {
        id: "paragraph-1",
        type: "paragraph",
        children: [createTextNode("Body")]
      },
      {
        id: "heading-1",
        type: "heading1",
        children: [createTextNode("Chapter")]
      },
      {
        id: "heading-2",
        type: "heading2",
        children: [createTextNode("Section")]
      }
    ]);

    expect(items).toEqual([
      {
        id: "navigation-heading-1",
        blockId: "heading-1",
        title: "Chapter",
        level: 1
      },
      {
        id: "navigation-heading-2",
        blockId: "heading-2",
        title: "Section",
        level: 2
      }
    ]);
  });

  it("ignores empty headings when deriving navigation entries", () => {
    const items = deriveNoteNavigationItems([
      {
        id: "heading-empty",
        type: "heading1",
        children: [createTextNode("")]
      },
      {
        id: "heading-topic-only",
        type: "heading2",
        children: [
          createTopicCardNode({
            id: "topic-1",
            text: "Inline topic",
            color: "accent"
          })!
        ]
      },
      {
        id: "heading-real",
        type: "heading2",
        children: [createTextNode("Section")]
      }
    ]);

    expect(items).toEqual([
      {
        id: "navigation-heading-topic-only",
        blockId: "heading-topic-only",
        title: "[Inline topic]",
        level: 2
      },
      {
        id: "navigation-heading-real",
        blockId: "heading-real",
        title: "Section",
        level: 2
      }
    ]);
  });

  it("replaces only the targeted block type", () => {
    const blocks: NoteBlock[] = [
      {
        id: "one",
        type: "paragraph",
        children: [createTextNode("First")]
      },
      {
        id: "two",
        type: "paragraph",
        children: [createTextNode("Second")]
      }
    ];

    const updated = replaceBlockType(blocks, "two", "heading3");

    expect(updated[0]?.type).toBe("paragraph");
    expect(updated[1]?.type).toBe("heading3");
  });

  it("normalizes inline topic cards and migrates legacy paragraph topics into children", () => {
    const blocks = normalizeNoteBlocks([
      {
        id: "paragraph-with-topics",
        type: "paragraph",
        topics: [
          {
            id: "topic-1",
            text: "  Program   signals  ",
            color: "accent"
          },
          {
            id: "topic-2",
            text: "   ",
            color: "interactive"
          }
        ],
        children: [createTextNode("Body")]
      },
      {
        id: "heading-with-inline-topic",
        type: "heading2",
        children: [
          createTopicCardNode({
            id: "topic-3",
            text: "  Heading topic  ",
            color: "emphasis"
          })!,
          createTextNode("Heading")
        ]
      }
    ] as NoteBlock[]);

    expect(blocks[0]?.children.slice(0, 2)).toEqual([
      {
        type: "topic-card",
        id: "topic-1",
        text: "Program signals",
        color: "accent"
      },
      createTextNode("Body")
    ]);
    expect(blocks[1]?.children[0]).toEqual({
      type: "topic-card",
      id: "topic-3",
      text: "Heading topic",
      color: "emphasis"
    });
  });

  it("includes inline topic cards in plain text export", () => {
    const note = normalizeNoteDocument({
      id: "note-topic-export",
      title: "Topics",
      bookId: null,
      createdAt: "2026-06-22T00:00:00Z",
      updatedAt: "2026-06-22T00:00:00Z",
      version: 1,
      blocks: [
        {
          id: "paragraph-topics",
          type: "paragraph",
          children: [
            createTopicCardNode({
              id: "topic-1",
              text: "Program signals",
              color: "accent"
            })!,
            createTopicCardNode({
              id: "topic-2",
              text: "Observation",
              color: "neutral"
            })!,
            createTextNode("Particular signals are needed.")
          ]
        }
      ]
    });

    expect(noteToPlainText(note)).toContain(
      "[Program signals] [Observation] Particular signals are needed."
    );
  });

  it("drops legacy section-break blocks during normalization", () => {
    const blocks = normalizeNoteBlocks([
      {
        id: "legacy-break-1",
        type: "sectionBreak" as NoteBlock["type"],
        children: []
      },
      {
        id: "legacy-break-2",
        type: "sectionBreak" as NoteBlock["type"],
        children: []
      },
      {
        id: "body",
        type: "paragraph",
        children: [createTextNode("After break")]
      }
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(blocks[0]?.children).toEqual([createTextNode("After break")]);

    const note = normalizeNoteDocument({
      id: "note-1",
      title: "Breaks",
      bookId: null,
      createdAt: "2026-06-22T00:00:00Z",
      updatedAt: "2026-06-22T00:00:00Z",
      version: 1,
      blocks
    });

    expect(noteToPlainText(note)).not.toContain("---");
  });

  it("merges adjacent spans that share the same inline marks", () => {
    const spans = normalizeNoteSpans([
      { text: "Hello ", bold: true },
      { text: "world", bold: true },
      { text: "!", italic: true }
    ]);

    expect(spans).toEqual([
      { text: "Hello world", bold: true },
      { text: "!", italic: true }
    ]);
  });

  it("reassigns duplicate block ids during normalization", () => {
    const blocks = normalizeNoteBlocks([
      {
        id: "duplicate",
        type: "paragraph",
        children: [createTextNode("First")]
      },
      {
        id: "duplicate",
        type: "paragraph",
        children: [createTextNode("Second")]
      }
    ]);

    expect(blocks[0]?.id).toBe("duplicate");
    expect(blocks[1]?.id).toBeTruthy();
    expect(blocks[1]?.id).not.toBe("duplicate");
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });

  it("migrates legacy spans into inline text children", () => {
    const note = normalizeNoteDocument({
      id: "note-1",
      title: "Legacy",
      bookId: "doc-1",
      createdAt: "2026-06-07T00:00:00Z",
      updatedAt: "2026-06-07T00:00:00Z",
      version: 1,
      blocks: [
        {
          id: "legacy-block",
          type: "paragraph",
          spans: [{ text: "Legacy text", bold: true }],
          children: []
        }
      ]
    } as NoteDocument);

    expect(note.blocks[0]?.children).toEqual([
      {
        type: "text",
        text: "Legacy text",
        bold: true
      }
    ]);
  });

  it("converts valid heading references into heading page-links and removes them from paragraphs", () => {
    const reference = normalizeDocumentSourceReference({
      id: "ref-1",
      documentId: "doc-1",
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title: "Chapter",
      target: {
        documentId: "doc-1",
        pageIndex: 4
      },
      createdAt: "2026-06-14T00:00:00Z"
    });

    const blocks = normalizeNoteBlocks([
      {
        id: "heading",
        type: "heading1",
        children: [createTextNode("Chapter")],
        sourceReference: reference
      },
      {
        id: "paragraph",
        type: "paragraph",
        children: [createTextNode("Body")],
        sourceReference: reference
      }
    ]);

    expect(blocks[0]?.sourceReference).toBeNull();
    expect(blocks[0]?.children[blocks[0].children.length - 1]).toMatchObject({
      type: "page-link",
      bookPageLabel: "5",
      pdfPageIndex: 4
    });
    expect(blocks[1]?.sourceReference).toBeNull();
  });

  it("replaces heading references without changing the heading text prefix", () => {
    const blocks = replaceBlockSourceReference(
      [
        {
          id: "heading",
          type: "heading2",
          children: [createTextNode("Section")]
        }
      ],
      "heading",
      {
        id: "ref-1",
        documentId: "doc-1",
        kind: "direct",
        outlineItemId: null,
        outlineSource: null,
        title: "Section",
        target: {
          documentId: "doc-1",
          pageIndex: 8
        },
        createdAt: "2026-06-14T00:00:00Z"
      }
    );

    expect(blocks[0]?.children[0]).toEqual(createTextNode("Section"));
    expect(blocks[0]?.children[1]).toMatchObject({
      type: "page-link",
      bookPageLabel: "9",
      pdfPageIndex: 8
    });
    expect(blocks[0]?.sourceReference).toBeNull();
  });

  it("converts duplicated adjacent heading references into a single visible heading page-link", () => {
    const reference = normalizeDocumentSourceReference({
      id: "ref-1",
      documentId: "doc-1",
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title: "Chapter",
      target: {
        documentId: "doc-1",
        pageIndex: 12
      },
      createdAt: "2026-06-22T00:00:00Z"
    });

    const blocks = normalizeNoteBlocks([
      {
        id: "heading-1",
        type: "heading1",
        children: [createTextNode("Chapter 2")],
        sourceReference: reference
      },
      {
        id: "heading-2",
        type: "heading1",
        children: [createTextNode("")],
        sourceReference: reference
      }
    ]);

    expect(blocks[0]?.sourceReference).toBeNull();
    expect(blocks[0]?.children[blocks[0].children.length - 1]).toMatchObject({
      type: "page-link",
      bookPageLabel: "13",
      pdfPageIndex: 12
    });
    expect(blocks[1]?.sourceReference).toBeNull();
  });

  it("clears heading references from empty headings", () => {
    const reference = normalizeDocumentSourceReference({
      id: "ref-empty",
      documentId: "doc-1",
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title: "Chapter",
      target: {
        documentId: "doc-1",
        pageIndex: 12
      },
      createdAt: "2026-06-22T00:00:00Z"
    });

    const blocks = normalizeNoteBlocks([
      {
        id: "heading-empty",
        type: "heading1",
        children: [createTextNode("")],
        sourceReference: reference
      }
    ]);

    expect(blocks[0]?.sourceReference).toBeNull();
  });

  it("creates pagelinks with a saved pdf page index", () => {
    const node = createPageLinkNode({
      text: "(p. 45)",
      bookPageLabel: "45",
      documentId: "doc-1",
      pdfPageIndex: 27
    });

    expect(node.pdfPageIndex).toBe(27);
    expect(node.text).toBe("(p. 45)");
  });

  it("validates numeric pagelink text", () => {
    expect(parsePageLinkText("(p.45)")).toEqual({
      rawText: "(p.45)",
      bookPageLabel: "45"
    });
    expect(parsePageLinkText("(p. 45)")).toEqual({
      rawText: "(p. 45)",
      bookPageLabel: "45"
    });
    expect(parsePageLinkText("page 45")).toBeNull();
  });

  it("parses positive integer page-link targets and formats them consistently", () => {
    expect(parsePageLinkTargetInput("40")).toEqual({
      pageNumber: 40,
      bookPageLabel: "40",
      text: "(p. 40)"
    });
    expect(parsePageLinkTargetInput(" 007 ")).toEqual({
      pageNumber: 7,
      bookPageLabel: "007",
      text: "(p. 7)"
    });
    expect(parsePageLinkTargetInput("0")).toBeNull();
    expect(parsePageLinkTargetInput("-4")).toBeNull();
    expect(parsePageLinkTargetInput("4.5")).toBeNull();
    expect(parsePageLinkTargetInput("page 40")).toBeNull();
    expect(formatPageLinkText(88)).toBe("(p. 88)");
  });

  it("debounces saves and flushes immediately when requested", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const scheduler = createSaveScheduler(flush, 1000);

    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(999);
    expect(flush).not.toHaveBeenCalled();

    scheduler.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(scheduler.isScheduled()).toBe(false);
  });
});
