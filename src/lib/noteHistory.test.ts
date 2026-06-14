import { describe, expect, it } from "vitest";

import {
  commitNoteHistoryState,
  createNoteHistoryState,
  redoNoteHistoryState,
  replaceCurrentHistorySelection,
  undoNoteHistoryState
} from "./noteHistory";
import { createTextNode } from "./notes";
import type { NoteEditorSelectionSnapshot } from "./types";

function createEntry(text: string, selectionOffset = text.length) {
  const selection: NoteEditorSelectionSnapshot = {
    anchor: {
      path: [0, 0],
      offset: selectionOffset
    },
    focus: {
      path: [0, 0],
      offset: selectionOffset
    },
    isCollapsed: true
  };

  return {
    blocks: [
      {
        id: "block-1",
        type: "paragraph" as const,
        children: [createTextNode(text)]
      }
    ],
    selection
  };
}

describe("noteHistory", () => {
  it("pushes the previous state onto undo when committing a non-merged change", () => {
    const initial = createEntry("A");
    const state = createNoteHistoryState(initial);

    const next = commitNoteHistoryState(state, createEntry("AB"), {
      mergeKey: "typing",
      timestamp: 100
    });

    expect(next.undoStack).toHaveLength(1);
    expect(next.undoStack[0]?.blocks[0]?.children[0]).toEqual(createTextNode("A"));
    expect(next.current.blocks[0]?.children[0]).toEqual(createTextNode("AB"));
    expect(next.redoStack).toHaveLength(0);
  });

  it("merges repeated typing within the merge window into a single undo step", () => {
    const initial = createEntry("A");
    const first = commitNoteHistoryState(createNoteHistoryState(initial), createEntry("AB"), {
      mergeKey: "typing",
      timestamp: 100
    });
    const second = commitNoteHistoryState(first, createEntry("ABC"), {
      mergeKey: "typing",
      timestamp: 600
    });

    expect(second.undoStack).toHaveLength(1);
    expect(second.undoStack[0]?.blocks[0]?.children[0]).toEqual(createTextNode("A"));
    expect(second.current.blocks[0]?.children[0]).toEqual(createTextNode("ABC"));
  });

  it("breaks merge groups across different merge keys", () => {
    const initial = createEntry("A");
    const typed = commitNoteHistoryState(createNoteHistoryState(initial), createEntry("AB"), {
      mergeKey: "typing",
      timestamp: 100
    });
    const removed = commitNoteHistoryState(typed, createEntry("A"), {
      mergeKey: "remove-page-link",
      timestamp: 300
    });

    expect(removed.undoStack).toHaveLength(2);
    expect(removed.undoStack[1]?.blocks[0]?.children[0]).toEqual(createTextNode("AB"));
  });

  it("undoes and redoes through committed states", () => {
    const initial = createEntry("A");
    const typed = commitNoteHistoryState(createNoteHistoryState(initial), createEntry("AB"), {
      mergeKey: "typing",
      timestamp: 100
    });
    const inserted = commitNoteHistoryState(typed, createEntry("AB(p. 47)"), {
      mergeKey: "insert-page-link",
      timestamp: 1200
    });

    const undone = undoNoteHistoryState(inserted);
    expect(undone?.current.blocks[0]?.children[0]).toEqual(createTextNode("AB"));
    expect(undone?.redoStack).toHaveLength(1);

    const redone = undone ? redoNoteHistoryState(undone) : null;
    expect(redone?.current.blocks[0]?.children[0]).toEqual(createTextNode("AB(p. 47)"));
  });

  it("clears redo history on a new commit", () => {
    const initial = createEntry("A");
    const typed = commitNoteHistoryState(createNoteHistoryState(initial), createEntry("AB"), {
      mergeKey: "typing",
      timestamp: 100
    });
    const undone = undoNoteHistoryState(typed);
    expect(undone?.redoStack).toHaveLength(1);

    const next = undone
      ? commitNoteHistoryState(undone, createEntry("AX"), {
          mergeKey: "typing",
          timestamp: 300
        })
      : null;

    expect(next?.redoStack).toHaveLength(0);
  });

  it("updates the current selection without pushing history", () => {
    const initial = createEntry("A", 1);
    const state = createNoteHistoryState(initial);
    const nextSelection = createEntry("A", 0).selection;

    const updated = replaceCurrentHistorySelection(state, nextSelection);
    expect(updated.undoStack).toHaveLength(0);
    expect(updated.current.selection?.anchor.offset).toBe(0);
  });
});
