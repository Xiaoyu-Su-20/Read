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

export type DocumentDeleteState = {
  canDelete: boolean;
  reason: string | null;
};

export type NoteDeleteState = {
  canDelete: boolean;
  reason: string | null;
};

export type TopicColorRole =
  | "accent"
  | "interactive"
  | "accentSoft"
  | "interactiveSoft"
  | "neutral"
  | "emphasis";

export type InteractiveColorKey = TopicColorRole;

export type Bookmark = {
  id: string;
  page: number;
  label: string;
  createdAt: string;
};

export type ReaderFitMode = "free" | "auto-maximize" | "width";

export type ReaderViewMode = "page" | "scroll";

export type PdfNavigationFit = "xyz" | "fit" | "fitH" | "fitV" | "fitR" | "unknown";

export type PdfNavigationTarget = {
  documentId: string;
  pageIndex: number;
  x?: number | null;
  y?: number | null;
  zoom?: number | null;
  fit?: PdfNavigationFit | null;
};

export type PdfOutlineSource = "embedded" | "user";

export type PdfOutlineItem = {
  id: string;
  title: string;
  source: PdfOutlineSource;
  sourceId?: string | null;
  target: PdfNavigationTarget | null;
  page: number | null;
  externalUrl?: string | null;
  bold?: boolean;
  italic?: boolean;
  color?: [number, number, number] | null;
  items: PdfOutlineItem[];
  createdAt?: string | null;
};

export type DocumentSourceReference = {
  id: string;
  documentId: string | null;
  kind: "direct" | "outline";
  outlineItemId: string | null;
  outlineSource: PdfOutlineSource | null;
  title: string;
  target: PdfNavigationTarget | null;
  createdAt: string;
};

export type DocumentState = {
  version: number;
  documentId: string;
  fingerprint: string;
  lastOpenedAt: string | null;
  lastPage: number;
  scrollZoom: number;
  bookmarks: Bookmark[];
};

export type DocumentPayload = {
  document: DocumentRecord;
  state: DocumentState;
  filePath: string;
  pageCount: number;
};

export type EffectivePageGeometry = {
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  rotation: number;
  normalizationToken: string | null;
  source: "normalized" | "raw";
};

export type ReaderSession = {
  document: DocumentPayload;
  documentId: string;
  page: number;
  scrollZoom: number;
  openSessionId: string;
  clickStartedAtMs: number;
  source:
    | "collection"
    | "search-result"
    | "sidebar-search"
    | "command"
    | "library-flow"
    | "sync"
    | "unknown";
};

export type RenderedPagePayload = {
  imageBytes: number[];
  pageNumber: number;
  width: number;
  height: number;
  pageBaseWidth: number;
  pageBaseHeight: number;
  cacheKey: string;
  renderVariant: "raw" | "normalized";
  normalizationToken: string | null;
  textLayerTransform: TextLayerTransform;
};

export type TextLayerTransform = {
  sourceWidth: number;
  sourceHeight: number;
  matrix: [number, number, number, number, number, number];
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

export type NativeTextPoint = {
  x: number;
  y: number;
};

export type NativeTextQuad = {
  ul: NativeTextPoint;
  ur: NativeTextPoint;
  ll: NativeTextPoint;
  lr: NativeTextPoint;
};

export type NativeTextRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type NativeTextChar = {
  index: number;
  lineIndex: number;
  text: string;
  quad: NativeTextQuad;
  origin: NativeTextPoint;
  size: number;
  flags: number;
};

export type NativeTextLine = {
  index: number;
  charStart: number;
  charEnd: number;
  bounds: NativeTextRect;
  text: string;
};

export type NativeTextPagePayload = {
  pageNumber: number;
  sourceWidth: number;
  sourceHeight: number;
  bounds: NativeTextRect;
  lines: NativeTextLine[];
  chars: NativeTextChar[];
};

export type FolderTreeNode = {
  folder: FolderRecord;
  folders: FolderTreeNode[];
  documents: DocumentRecord[];
};

export type OutlineItem = PdfOutlineItem;

export type ViewerSnapshot = {
  currentPage: number;
  pageCount: number;
  zoom: number;
};

export type NoteBlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3";

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
  origin?:
    | {
        kind: "inline";
      }
    | {
        kind: "heading-reference";
        ownerBlockId: string;
      }
    | null;
};

export type ParagraphTopic = {
  id: string;
  text: string;
  color: TopicColorRole;
};

export type NoteTopicCardNode = ParagraphTopic & {
  type: "topic-card";
};

export type NoteInlineNode = NoteTextNode | NotePageLinkNode | NoteTopicCardNode;

export type NoteBlock = {
  id: string;
  type: NoteBlockType;
  children: NoteInlineNode[];
  topics?: ParagraphTopic[];
  sourceReference?: DocumentSourceReference | null;
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
  lastOpenedAt: string | null;
  excerpt: string;
};

export type StandaloneNoteSearchHit = {
  noteId: string;
  blockId: string;
  title: string;
  text: string;
  matchIndex: number;
};

export type NoteNavigationItem = {
  id: string;
  blockId: string;
  title: string;
  level: 1 | 2 | 3;
};

export type NoteEditorSelectionPoint = {
  path: number[];
  offset: number;
};

export type NoteEditorLogicalCaret = {
  blockId: string;
  visibleOffset: number;
};

export type NoteModelPoint = {
  blockId: string;
  inlineIndex: number;
  textOffset: number;
  affinity: "before" | "after";
};

export type NoteModelSelection = {
  anchor: NoteModelPoint;
  focus: NoteModelPoint;
};

export type NoteEditorSelectionSnapshot = {
  anchor: NoteEditorSelectionPoint;
  focus: NoteEditorSelectionPoint;
  isCollapsed: boolean;
  logicalCaret?: NoteEditorLogicalCaret | null;
};

export type NoteHistoryMergeKey =
  | "typing"
  | "delete"
  | "paste"
  | "insert-page-link"
  | "edit-page-link"
  | "remove-page-link"
  | "insert-topic"
  | "edit-topic"
  | "remove-topic"
  | "recolor-topic"
  | "format"
  | "turn-into";

export type ViewerApi = {
  nextPage: () => void;
  previousPage: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getAutoMaximizeZoom: () => number | null;
  getAutoMaximizeMinDocumentWidth: () => number | null;
  getFitMode: () => ReaderFitMode;
  setFitMode: (fitMode: ReaderFitMode) => void;
    goToPage: (
      page: number,
      options?: { alignment?: "page" | "reading-line" | "top" }
    ) => void;
  navigateToTarget: (target: PdfNavigationTarget) => void;
  searchPort: import("../search/model/SearchRequest").PdfSearchPort;
  jumpToOutline: (item: OutlineItem) => void;
  getCurrentPage: () => number;
  getPageCount: () => number;
  getReaderState: () => DocumentState | null;
  setBookmarks: (bookmarks: Bookmark[]) => void;
  };

export type ReaderLocationHandoff = {
  documentId: string;
  pageNumber: number;
  sourceMode: ReaderViewMode;
};

export type NoteRevealRequest = {
  blockId: string;
  sequence: number;
};

export type PaletteGlyph =
  | "bookmark"
  | "book"
  | "file-plus"
  | "folder"
  | "folder-open"
  | "history"
  | "move"
  | "page"
  | "panel"
  | "refresh"
  | "search"
  | "spark"
  | "trash";

export type PaletteGroup = "navigation" | "bookmarks" | "library" | "view";

export type PaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  glyph?: PaletteGlyph;
  group?: PaletteGroup;
  keywords?: string[];
  onSelect: () => void | Promise<void>;
};
