import { describe, expect, it } from "vitest";

import { blockOffsetToPoint, collapsedModelSelection } from "./noteBlockModel";
import {
  commitNoteModelHistory,
  createNoteModelHistory,
  redoNoteModelHistory,
  undoNoteModelHistory
} from "./noteModelHistory";
import { createTextNode } from "./notes";
import type { NoteBlock } from "./types";

function entry(text: string) {
  const block: NoteBlock = {
    id: "block",
    type: "paragraph",
    children: [createTextNode(text)]
  };
  return {
    blocks: [block],
    selection: collapsedModelSelection(blockOffsetToPoint(block, text.length))
  };
}

describe("note model history", () => {
  it("restores logical block selection through undo and redo", () => {
    const initial = createNoteModelHistory(entry("A"));
    const changed = commitNoteModelHistory(initial, entry("AB"), "typing", 100);
    const undone = undoNoteModelHistory(changed);
    const redone = undone ? redoNoteModelHistory(undone) : null;

    expect(undone?.current.blocks[0].children[0].text).toBe("A");
    expect(undone?.current.selection?.focus).toMatchObject({
      blockId: "block",
      textOffset: 1
    });
    expect(redone?.current.blocks[0].children[0].text).toBe("AB");
    expect(redone?.current.selection?.focus).toMatchObject({
      blockId: "block",
      textOffset: 2
    });
  });

  it("merges consecutive typing commits but separates structural edits", () => {
    const initial = createNoteModelHistory(entry(""));
    const first = commitNoteModelHistory(initial, entry("A"), "typing", 100);
    const second = commitNoteModelHistory(first, entry("AB"), "typing", 200);
    const split = commitNoteModelHistory(second, entry("AB\n"), null, 250);

    expect(second.undoStack).toHaveLength(1);
    expect(split.undoStack).toHaveLength(2);
  });
});
