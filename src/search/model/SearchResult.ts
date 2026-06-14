import type { SearchSourceId } from "./SearchRequest";

export type SearchHighlightRange = {
  start: number;
  end: number;
};

type SearchResultBase = {
  id: string;
  sourceId: SearchSourceId;
  title: string;
  snippet: string;
  highlights: SearchHighlightRange[];
};

export type NoteSearchResult = SearchResultBase & {
  kind: "note";
  noteId: string;
  blockId: string;
};

export type PdfSearchResult = SearchResultBase & {
  kind: "pdf";
  pageNumber: number;
  matchIndex: number;
  location: "current" | "nearby" | "across";
};

export type DocumentNameSearchResult = SearchResultBase & {
  kind: "document";
  documentId: string;
  available: boolean;
};

export type SearchResult =
  | NoteSearchResult
  | PdfSearchResult
  | DocumentNameSearchResult;

export type SearchResultBatch = {
  sourceId: SearchSourceId;
  stageId: string;
  results: SearchResult[];
  completed: boolean;
  progress?: {
    completedPages: number;
    totalPages: number;
  };
};

export interface SearchSource {
  id: SearchSourceId;
  search(
    request: import("./SearchRequest").SearchRequest,
    signal: AbortSignal
  ): AsyncIterable<SearchResultBatch>;
}

export type SearchGroupId =
  | "notes"
  | "current-page"
  | "nearby-pages"
  | "across-document"
  | "documents";

export type SearchResultGroup = {
  id: SearchGroupId;
  label: string;
  results: SearchResult[];
  total: number;
  truncated: boolean;
};

