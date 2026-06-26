import { describe, expect, it } from "vitest";

import { createTextNode } from "../../../lib/notes";
import type { NoteBlock } from "../../../lib/types";
import { blockOffsetToPoint, collapsedModelSelection } from "../model/noteBlockModel";
import {
  commitNoteEditorBlocks,
  createNoteEditorRuntimeState,
  redoNoteEditorRuntime,
  undoNoteEditorRuntime
} from "./noteEditorState";

function block(id: string, text: string): NoteBlock {
  return {
    id,
    type: "paragraph",
    children: [createTextNode(text)]
  };
}

function selection(blocks: NoteBlock[], blockId: string, offset: number) {
  const target = blocks.find((blockItem) => blockItem.id === blockId);
  if (!target) {
    throw new Error(`Missing block ${blockId}`);
  }
  return collapsedModelSelection(blockOffsetToPoint(target, offset));
}

describe("note editor state", () => {
  it("treats same blocks plus same selection as a no-op", () => {
    const initialBlocks = [block("a", "Hello")];
    const initialSelection = selection(initialBlocks, "a", 5);
    const runtime = createNoteEditorRuntimeState(initialBlocks, null, initialSelection);

    const result = commitNoteEditorBlocks({
      currentBlocks: runtime.blocks,
      history: runtime.history,
      nextBlocks: runtime.blocks,
      selection: runtime.history?.current.selection ?? null,
      mergeKey: "typing",
      bookId: null,
      render: true
    });

    expect(result.blocks).toBe(runtime.blocks);
    expect(result.history).toBe(runtime.history);
    expect(result.pendingSelectionRestore).toBeNull();
    expect(result.changed).toBe(false);
  });

  it("updates selection without pushing a document history entry", () => {
    const initialBlocks = [block("a", "Hello")];
    const runtime = createNoteEditorRuntimeState(initialBlocks, null, selection(initialBlocks, "a", 0));
    const nextSelection = selection(runtime.blocks, "a", 5);

    const result = commitNoteEditorBlocks({
      currentBlocks: runtime.blocks,
      history: runtime.history,
      nextBlocks: runtime.blocks,
      selection: nextSelection,
      mergeKey: "typing",
      bookId: null,
      render: true
    });

    expect(result.blocks).toBe(runtime.blocks);
    expect(result.changed).toBe(false);
    expect(result.history).not.toBe(runtime.history);
    expect(result.history?.undoStack).toHaveLength(0);
    expect(result.history?.current.selection).toEqual(nextSelection);
  });

  it("uses block-array identity for document changes and preserves it through undo/redo", () => {
    const initialBlocks = [block("a", "Hello")];
    const runtime = createNoteEditorRuntimeState(initialBlocks, null, selection(initialBlocks, "a", 5));
    const nextBlocks = [block("a", "Hello!")] as NoteBlock[];
    const nextSelection = selection(nextBlocks, "a", 6);

    const committed = commitNoteEditorBlocks({
      currentBlocks: runtime.blocks,
      history: runtime.history,
      nextBlocks,
      selection: nextSelection,
      mergeKey: "typing",
      bookId: null,
      render: true
    });

    expect(committed.blocks).toBe(nextBlocks);
    expect(committed.changed).toBe(true);
    expect(committed.history?.current.blocks).toBe(nextBlocks);
    expect(committed.history?.undoStack[0]?.blocks).toBe(runtime.blocks);

    const undone = undoNoteEditorRuntime({
      history: committed.history,
      bookId: null
    });
    expect(undone?.blocks).toBe(runtime.blocks);

    const redone = redoNoteEditorRuntime({
      history: undone?.history ?? null,
      bookId: null
    });
    expect(redone?.blocks).toBe(nextBlocks);
  });
});
