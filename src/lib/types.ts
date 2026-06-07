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
