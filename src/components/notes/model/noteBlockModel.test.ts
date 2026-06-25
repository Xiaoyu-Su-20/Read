import { describe, expect, it } from "vitest";

import {
  blockOffsetToPoint,
  convertBlockType,
  deleteBackward,
  deleteForward,
  insertBlocksAtSelection,
  insertTextAtSelection,
  mergeBlockBackward,
  mergeBlockForward,
  removeInlineNode,
  removeModelBlock,
  replaceModelRange,
  textMarksAtPoint,
  splitBlockAtSelection
} from "./noteBlockModel";
import { toggleTextMarkInSelection } from "./noteBlockModel";
import { createPageLinkNode, createTopicCardNode, createTextNode } from "../../../lib/notes";
import type { NoteBlock, NoteModelSelection } from "../../../lib/types";

function block(id: string, type: NoteBlock["type"], text: string): NoteBlock {
  return {
    id,
    type,
    children: [createTextNode(text)]
  };
}

function selection(
  blocks: NoteBlock[],
  startBlock: string,
  startOffset: number,
  endBlock = startBlock,
  endOffset = startOffset
): NoteModelSelection {
  const start = blocks.find((item) => item.id === startBlock)!;
  const end = blocks.find((item) => item.id === endBlock)!;
  return {
    anchor: blockOffsetToPoint(start, startOffset),
    focus: blockOffsetToPoint(end, endOffset)
  };
}

describe("note block model", () => {
  it.each(["paragraph", "heading1", "heading2", "heading3"] as const)(
    "splits %s into a paragraph on Enter",
    (type) => {
      const blocks = [block("a", type, "Chapter body")];
      const result = splitBlockAtSelection(blocks, selection(blocks, "a", 7), () => "b");

      expect(result.blocks).toMatchObject([
        { id: "a", type, children: [{ type: "text", text: "Chapter" }] },
        { id: "b", type: "paragraph", children: [{ type: "text", text: " body" }] }
      ]);
      expect(result.selection.focus.blockId).toBe("b");
    }
  );

  it("inserts empty paragraphs at block boundaries", () => {
    const blocks = [block("a", "heading1", "Heading")];
    const atStart = splitBlockAtSelection(blocks, selection(blocks, "a", 0), () => "before");
    const atEnd = splitBlockAtSelection(blocks, selection(blocks, "a", 7), () => "after");

    expect(atStart.blocks[0]).toMatchObject({ id: "before", type: "paragraph" });
    expect(atStart.blocks[1]).toMatchObject({ id: "a", type: "heading1" });
    expect(atStart.blocks[0].children[0].text).toBe("");
    expect(atEnd.blocks[0].children[0].text).toBe("Heading");
    expect(atEnd.blocks[1]).toMatchObject({ id: "after", type: "paragraph" });
  });

  it("deletes a cross-block range while preserving the starting block", () => {
    const blocks = [
      block("a", "heading2", "Alpha"),
      block("b", "paragraph", "Middle"),
      block("c", "paragraph", "Omega")
    ];
    const result = replaceModelRange(blocks, selection(blocks, "a", 2, "c", 3));

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      id: "a",
      type: "heading2",
      children: [{ type: "text", text: "Alga" }]
    });
  });

  it("inserts text at a collapsed caret with explicit marks", () => {
    const blocks = [block("a", "paragraph", "Hello")];
    const result = insertTextAtSelection(
      blocks,
      selection(blocks, "a", 5),
      "!",
      { bold: true }
    );

    expect(result.blocks[0].children).toEqual([
      createTextNode("Hello"),
      createTextNode("!", { bold: true })
    ]);
  });

  it("replaces a selected range with inserted text", () => {
    const blocks = [block("a", "paragraph", "Hello world")];
    const result = insertTextAtSelection(blocks, selection(blocks, "a", 6, "a", 11), "reader");

    expect(result.blocks[0].children).toEqual([createTextNode("Hello reader")]);
  });

  it("normalizes reversed cross-block selections before replacement", () => {
    const blocks = [
      block("a", "paragraph", "Alpha"),
      block("b", "paragraph", "Omega")
    ];
    const forward = selection(blocks, "a", 2, "b", 3);
    const reversed = {
      anchor: forward.focus,
      focus: forward.anchor
    };
    const result = replaceModelRange(blocks, reversed, [createTextNode("X")]);

    expect(result.blocks).toMatchObject([
      {
        id: "a",
        children: [{ type: "text", text: "AlXga" }]
      }
    ]);
  });

  it("merges backward and forward with the surviving block identity and type", () => {
    const blocks = [block("a", "heading1", "Head"), block("b", "paragraph", "Body")];
    const backward = mergeBlockBackward(blocks, "b");
    const forward = mergeBlockForward(blocks, "a");

    expect(backward?.blocks).toMatchObject([
      { id: "a", type: "heading1", children: [{ type: "text", text: "HeadBody" }] }
    ]);
    expect(forward?.blocks).toMatchObject([
      { id: "a", type: "heading1", children: [{ type: "text", text: "HeadBody" }] }
    ]);
  });

  it("deletes backward and forward within one block without reparsing structure", () => {
    const blocks = [block("a", "paragraph", "Hello")];
    const backward = deleteBackward(blocks, selection(blocks, "a", 5));
    const forward = deleteForward(blocks, selection(blocks, "a", 0));

    expect(backward?.blocks[0].children).toEqual([createTextNode("Hell")]);
    expect(forward?.blocks[0].children).toEqual([createTextNode("ello")]);
  });

  it("keeps atomic nodes on the correct side of a split", () => {
    const pageLink = createPageLinkNode({
      text: "(p. 27)",
      bookPageLabel: "27",
      documentId: "doc",
      pdfPageIndex: 26
    });
    const topic = createTopicCardNode({ id: "topic", text: "Truth", color: "accent" })!;
    const blocks: NoteBlock[] = [
      {
        id: "a",
        type: "paragraph",
        children: [topic, createTextNode("Report"), pageLink]
      }
    ];
    const result = splitBlockAtSelection(blocks, selection(blocks, "a", 4), () => "b");

    expect(result.blocks[0].children.map((node) => node.type)).toEqual(["topic-card", "text"]);
    expect(result.blocks[1].children.map((node) => node.type)).toEqual(["text", "page-link"]);
  });

  it("removes an atomic node without making it unique within the paragraph", () => {
    const first = createPageLinkNode({
      text: "(p. 12)",
      bookPageLabel: "12",
      documentId: "doc",
      pdfPageIndex: 11
    });
    const second = createPageLinkNode({
      text: "(p. 27)",
      bookPageLabel: "27",
      documentId: "doc",
      pdfPageIndex: 26
    });
    const blocks: NoteBlock[] = [
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("See "), first, createTextNode(" and "), second]
      }
    ];
    const result = removeInlineNode(blocks, first.id);

    expect(result?.blocks[0].children.map((node) => node.type)).toEqual([
      "text",
      "page-link"
    ]);
    expect(result?.blocks[0].children[1]).toMatchObject({ id: second.id });
  });

  it("inserts multi-block paste content while preserving the starting block", () => {
    const blocks = [block("a", "heading2", "BeforeAfter")];
    const pasted = [block("x", "paragraph", "One"), block("y", "paragraph", "Two")];
    const result = insertBlocksAtSelection(
      blocks,
      selection(blocks, "a", 6),
      pasted
    );

    expect(result.blocks).toMatchObject([
      {
        id: "a",
        type: "heading2",
        children: [{ type: "text", text: "BeforeOne" }]
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "TwoAfter" }]
      }
    ]);
  });

  it("removes empty blocks without merging adjacent content", () => {
    const blocks = [
      block("a", "paragraph", "Before"),
      block("b", "paragraph", ""),
      block("c", "heading1", "After")
    ];
    const backward = mergeBlockBackward(blocks, "b");
    const forward = mergeBlockForward(blocks, "b");

    expect(backward?.blocks.map((item) => item.id)).toEqual(["a", "c"]);
    expect(backward?.blocks[1]).toMatchObject({ id: "c", type: "heading1" });
    expect(forward?.blocks.map((item) => item.id)).toEqual(["a", "c"]);
    expect(forward?.blocks[1]).toMatchObject({ id: "c", type: "heading1" });
  });

  it("converts a first heading to a paragraph on backward merge", () => {
    const result = mergeBlockBackward([block("a", "heading1", "Chapter")], "a");

    expect(result?.blocks[0]).toMatchObject({
      id: "a",
      type: "paragraph",
      children: [{ type: "text", text: "Chapter" }]
    });
  });

  it("keeps a valid caret target when the final block is removed", () => {
    const result = removeModelBlock([block("a", "paragraph", "Only")], "a");

    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0]).toMatchObject({ type: "paragraph" });
    expect(result?.selection.focus.blockId).toBe(result?.blocks[0].id);
  });

  it("converts block type without carrying presentation markup", () => {
    const blocks = [block("a", "heading1", "Chapter")];
    expect(convertBlockType(blocks, "a", "paragraph")).toEqual([
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Chapter")],
        sourceReference: null
      }
    ]);
  });

  it("replaces a whole-document deletion with one empty paragraph", () => {
    const blocks = [
      block("a", "heading1", "Chapter"),
      block("b", "paragraph", "Body")
    ];

    const result = replaceModelRange(
      blocks,
      selection(blocks, "a", 0, "b", 4)
    );

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", text: "" }]
    });
  });

  it("toggles bold across the selected text range without changing text offsets", () => {
    const blocks: NoteBlock[] = [
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello world")]
      }
    ];

    const result = toggleTextMarkInSelection(blocks, selection(blocks, "a", 6, "a", 11), "bold");

    expect(result?.blocks[0].children).toEqual([
      createTextNode("Hello "),
      createTextNode("world", { bold: true })
    ]);
    expect(result?.selection.anchor).toMatchObject({ blockId: "a" });
    expect(result?.selection.focus).toMatchObject({ blockId: "a" });
  });

  it("removes bold when the full selected text range already has it", () => {
    const blocks: NoteBlock[] = [
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello ", { bold: true }), createTextNode("world", { bold: true })]
      }
    ];

    const result = toggleTextMarkInSelection(blocks, selection(blocks, "a", 0, "a", 11), "bold");

    expect(result?.blocks[0].children).toEqual([createTextNode("Hello world")]);
  });

  it("derives active marks at a collapsed caret from nearby text", () => {
    const blocks: NoteBlock[] = [
      {
        id: "a",
        type: "paragraph",
        children: [createTextNode("Hello"), createTextNode(" world", { italic: true })]
      }
    ];

    expect(textMarksAtPoint(blocks, blockOffsetToPoint(blocks[0], 2))).toEqual({
      bold: false,
      italic: false
    });
    expect(textMarksAtPoint(blocks, blockOffsetToPoint(blocks[0], 8))).toEqual({
      bold: false,
      italic: true
    });
  });
});
