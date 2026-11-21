import type { Bookmark, DocumentState } from "../types";

export function updatePageReaderState(
  state: DocumentState,
  lastPage: number,
  bookmarks: Bookmark[] = state.bookmarks
): DocumentState {
  return {
    ...state,
    lastPage,
    bookmarks
  };
}

export function updateScrollReaderState(
  state: DocumentState,
  lastPage: number,
  scrollZoom: number,
  bookmarks: Bookmark[] = state.bookmarks
): DocumentState {
  return {
    ...state,
    lastPage,
    scrollZoom,
    bookmarks
  };
}
