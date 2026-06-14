import type {
  NoteBlock,
  NoteEditorSelectionSnapshot,
  NoteHistoryMergeKey
} from "./types";

export const NOTE_HISTORY_MERGE_WINDOW_MS = 1000;

export type NoteHistoryEntry = {
  blocks: NoteBlock[];
  selection: NoteEditorSelectionSnapshot | null;
  html?: string;
};

type NoteHistoryCommitMeta = {
  mergeKey: NoteHistoryMergeKey;
  timestamp: number;
};

export type NoteHistoryState = {
  undoStack: NoteHistoryEntry[];
  current: NoteHistoryEntry;
  redoStack: NoteHistoryEntry[];
  lastCommit: NoteHistoryCommitMeta | null;
};

type CommitOptions = {
  mergeKey?: NoteHistoryMergeKey | null;
  timestamp?: number;
};

function cloneEntry(entry: NoteHistoryEntry): NoteHistoryEntry {
  return {
    blocks: JSON.parse(JSON.stringify(entry.blocks)) as NoteBlock[],
    selection: entry.selection
      ? (JSON.parse(JSON.stringify(entry.selection)) as NoteEditorSelectionSnapshot)
      : null,
    html: entry.html ?? undefined
  };
}

export function createNoteHistoryState(initial: NoteHistoryEntry): NoteHistoryState {
  return {
    undoStack: [],
    current: cloneEntry(initial),
    redoStack: [],
    lastCommit: null
  };
}

export function replaceCurrentHistorySelection(
  state: NoteHistoryState,
  selection: NoteEditorSelectionSnapshot | null
): NoteHistoryState {
  return {
    ...state,
    current: {
      ...state.current,
      selection: selection
        ? (JSON.parse(JSON.stringify(selection)) as NoteEditorSelectionSnapshot)
        : null
    }
  };
}

export function commitNoteHistoryState(
  state: NoteHistoryState,
  next: NoteHistoryEntry,
  options: CommitOptions = {}
): NoteHistoryState {
  const timestamp = options.timestamp ?? Date.now();
  const mergeKey = options.mergeKey ?? null;
  const canMerge =
    mergeKey !== null &&
    state.lastCommit?.mergeKey === mergeKey &&
    timestamp - state.lastCommit.timestamp <= NOTE_HISTORY_MERGE_WINDOW_MS;

  const undoStack = canMerge
    ? state.undoStack.map(cloneEntry)
    : [...state.undoStack.map(cloneEntry), cloneEntry(state.current)];

  return {
    undoStack,
    current: cloneEntry(next),
    redoStack: [],
    lastCommit: mergeKey
      ? {
          mergeKey,
          timestamp
        }
      : null
  };
}

export function undoNoteHistoryState(state: NoteHistoryState): NoteHistoryState | null {
  if (state.undoStack.length === 0) {
    return null;
  }

  const nextUndoStack = state.undoStack.map(cloneEntry);
  const previous = nextUndoStack.pop();
  if (!previous) {
    return null;
  }

  return {
    undoStack: nextUndoStack,
    current: cloneEntry(previous),
    redoStack: [...state.redoStack.map(cloneEntry), cloneEntry(state.current)],
    lastCommit: null
  };
}

export function redoNoteHistoryState(state: NoteHistoryState): NoteHistoryState | null {
  if (state.redoStack.length === 0) {
    return null;
  }

  const nextRedoStack = state.redoStack.map(cloneEntry);
  const next = nextRedoStack.pop();
  if (!next) {
    return null;
  }

  return {
    undoStack: [...state.undoStack.map(cloneEntry), cloneEntry(state.current)],
    current: cloneEntry(next),
    redoStack: nextRedoStack,
    lastCommit: null
  };
}
