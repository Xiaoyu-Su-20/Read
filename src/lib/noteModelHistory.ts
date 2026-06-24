import type {
  NoteBlock,
  NoteHistoryMergeKey,
  NoteModelSelection
} from "./types";

export const NOTE_MODEL_HISTORY_MERGE_WINDOW_MS = 1000;

export type NoteModelHistoryEntry = {
  blocks: NoteBlock[];
  selection: NoteModelSelection | null;
};

export type NoteModelHistoryState = {
  undoStack: NoteModelHistoryEntry[];
  current: NoteModelHistoryEntry;
  redoStack: NoteModelHistoryEntry[];
  lastCommit: {
    mergeKey: NoteHistoryMergeKey;
    timestamp: number;
  } | null;
};

function cloneEntry(entry: NoteModelHistoryEntry): NoteModelHistoryEntry {
  return JSON.parse(JSON.stringify(entry)) as NoteModelHistoryEntry;
}

export function createNoteModelHistory(initial: NoteModelHistoryEntry): NoteModelHistoryState {
  return {
    undoStack: [],
    current: cloneEntry(initial),
    redoStack: [],
    lastCommit: null
  };
}

export function replaceNoteModelHistorySelection(
  state: NoteModelHistoryState,
  selection: NoteModelSelection | null
): NoteModelHistoryState {
  return {
    ...state,
    current: {
      ...state.current,
      selection: selection ? cloneEntry({ blocks: [], selection }).selection : null
    }
  };
}

export function commitNoteModelHistory(
  state: NoteModelHistoryState,
  next: NoteModelHistoryEntry,
  mergeKey: NoteHistoryMergeKey | null,
  timestamp = Date.now()
): NoteModelHistoryState {
  const canMerge =
    mergeKey !== null &&
    state.lastCommit?.mergeKey === mergeKey &&
    timestamp - state.lastCommit.timestamp <= NOTE_MODEL_HISTORY_MERGE_WINDOW_MS;
  return {
    undoStack: canMerge
      ? state.undoStack.map(cloneEntry)
      : [...state.undoStack.map(cloneEntry), cloneEntry(state.current)],
    current: cloneEntry(next),
    redoStack: [],
    lastCommit: mergeKey ? { mergeKey, timestamp } : null
  };
}

export function undoNoteModelHistory(state: NoteModelHistoryState) {
  if (state.undoStack.length === 0) {
    return null;
  }
  const undoStack = state.undoStack.map(cloneEntry);
  const previous = undoStack.pop();
  if (!previous) {
    return null;
  }
  return {
    undoStack,
    current: cloneEntry(previous),
    redoStack: [...state.redoStack.map(cloneEntry), cloneEntry(state.current)],
    lastCommit: null
  } satisfies NoteModelHistoryState;
}

export function redoNoteModelHistory(state: NoteModelHistoryState) {
  if (state.redoStack.length === 0) {
    return null;
  }
  const redoStack = state.redoStack.map(cloneEntry);
  const next = redoStack.pop();
  if (!next) {
    return null;
  }
  return {
    undoStack: [...state.undoStack.map(cloneEntry), cloneEntry(state.current)],
    current: cloneEntry(next),
    redoStack,
    lastCommit: null
  } satisfies NoteModelHistoryState;
}
