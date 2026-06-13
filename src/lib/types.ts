export const ROOT_FOLDER_ID = "root";

export type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string | null;
};

export type DocumentAvailability = "available" | "missing";

export type DocumentRecord = {
  id: string;
  title: string;
  fileName: string;
  folderId: string;
  relativePath: string;
  fingerprint: string;
  importedAt: string;
  lastOpenedAt: string | null;
  availability: DocumentAvailability;
};

export type Bookmark = {
  id: string;
  page: number;
  label: string;
  createdAt: string;
};

export type ReaderPreferences = {
  fitMode: string;
};

export type DocumentState = {
  version: number;
  documentId: string;
  fingerprint: string;
  lastOpenedAt: string | null;
  lastPage: number;
  zoom: number;
  bookmarks: Bookmark[];
  preferences: ReaderPreferences;
};

export type DocumentPayload = {
  document: DocumentRecord;
  state: DocumentState;
  filePath: string;
  pageCount: number;
};

export type RenderedPagePayload = {
  imagePath: string;
  pageNumber: number;
  width: number;
  height: number;
  cacheKey: string;
};

export type PageTextLayerData = {
  pageNumber: number;
  textContent: import("pdfjs-dist/types/src/display/api").TextContent;
  viewportWidth: number;
  viewportHeight: number;
  viewportRawDims: {
    pageWidth: number;
    pageHeight: number;
    pageX: number;
    pageY: number;
  };
  viewportTransform: [number, number, number, number, number, number];
  rotation: 0;
};

export type FolderTreeNode = {
  folder: FolderRecord;
  folders: FolderTreeNode[];
  documents: DocumentRecord[];
};

export type OutlineItem = {
  id: string;
  title: string;
  page: number | null;
  items: OutlineItem[];
};

export type ViewerSnapshot = {
  currentPage: number;
  pageCount: number;
  zoom: number;
};

export type NoteBlockType = "paragraph" | "heading1" | "heading2" | "heading3";

export type NoteSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type NoteTextNode = {
  type: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type NotePageLinkNode = {
  type: "page-link";
  id: string;
  text: string;
  documentId: string | null;
  pdfPageIndex: number | null;
  bookPageLabel: string;
  createdAt: string;
};

export type NoteInlineNode = NoteTextNode | NotePageLinkNode;

export type NoteBlock = {
  id: string;
  type: NoteBlockType;
  children: NoteInlineNode[];
  spans?: NoteSpan[];
};

export type NoteDocument = {
  id: string;
  title: string;
  bookId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  blocks: NoteBlock[];
};

export type NoteIndexEntry = {
  id: string;
  title: string;
  bookId: string | null;
  createdAt: string;
  updatedAt: string;
  excerpt: string;
};

export type NoteNavigationItem = {
  id: string;
  blockId: string;
  title: string;
  level: 1 | 2 | 3;
};

export type ViewerApi = {
  nextPage: () => void;
  previousPage: () => void;
  goToPage: (page: number) => void;
  search: (query: string) => Promise<number>;
  jumpToOutline: (item: OutlineItem) => void;
  getCurrentPage: () => number;
  getPageCount: () => number;
  getReaderState: () => DocumentState | null;
  setBookmarks: (bookmarks: Bookmark[]) => void;
};

export type PaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  keywords?: string[];
  onSelect: () => void | Promise<void>;
};
