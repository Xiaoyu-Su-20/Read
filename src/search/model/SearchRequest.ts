import type { DocumentRecord, NoteDocument, StandaloneNoteSearchHit } from "../../lib/types";

export type SearchSourceId = "notes" | "pdf-text" | "document-name";

export type PdfSearchPort = {
  getExtractedPageNumbers: () => ReadonlySet<number>;
  getPageSearchText: (pageNumber: number, signal: AbortSignal) => Promise<string>;
};

type SearchRequestBase = {
  query: string;
  normalizedQuery: string;
  stageId: string;
};

export type NotesSearchRequest =
  | (SearchRequestBase & {
      sourceId: "notes";
      mode: "current-note";
      note: NoteDocument;
    })
  | (SearchRequestBase & {
      sourceId: "notes";
      mode: "standalone";
      searchStandaloneNotes: (
        query: string,
        signal: AbortSignal
      ) => Promise<StandaloneNoteSearchHit[]>;
    });

export type DocumentNameSearchRequest = SearchRequestBase & {
  sourceId: "document-name";
  documents: readonly DocumentRecord[];
};

export type PdfTextSearchRequest = SearchRequestBase & {
  sourceId: "pdf-text";
  pageNumbers: readonly number[];
  currentPage: number;
  nearbyPages: ReadonlySet<number>;
  port: PdfSearchPort;
  concurrency: number;
};

export type SearchRequest =
  | NotesSearchRequest
  | DocumentNameSearchRequest
  | PdfTextSearchRequest;
