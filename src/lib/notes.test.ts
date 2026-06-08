import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPageLinkNode,
  createSaveScheduler,
  createTextNode,
  deriveNoteNavigationItems,
  normalizeNoteBlocks,
  normalizeNoteDocument,
  normalizeNoteSpans,
  parsePageLinkText,
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
