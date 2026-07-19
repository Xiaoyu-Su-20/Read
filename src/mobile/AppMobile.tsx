import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import CollectionLibraryGlyph from "../components/icons/CollectionLibraryGlyph";
import {
  importOwnedPdfs,
  listLibrary,
  openDocument,
  renameDocument,
  renameFolder,
  saveDocumentState
} from "../lib/api";
import { useAppSettings } from "../lib/app/useAppSettings";
import type { ThemeDefinition } from "../lib/app/themeProfile";
import { sortCollectionDocumentsByRecent, type CollectionDocumentSortMode } from "../lib/collectionSorting";
import type { DocumentPayload, DocumentRecord, FolderTreeNode, ReaderViewMode } from "../lib/types";
import MobilePdfPage from "./MobilePdfPage";
import {
  makeMobileMockLibrary,
  mobileCollectionsFromTree,
  mostRecentDocuments,
  type MobileCollection
} from "./mobileLibrary";
import "./mobile.css";

type MobileRoute =
  | { name: "library" }
  | { name: "settings" }
  | { name: "collection"; collectionId: string }
  | { name: "reader"; documentId: string; collectionId: string | null };

const MOBILE_PAGE_ZOOM = 1.45;
const MOBILE_SCROLL_ZOOM = 1.25;
const MOBILE_MIN_ZOOM = 0.8;
const MOBILE_MAX_ZOOM = 3;
const MOBILE_DEFAULT_COLLECTION_ID = "Collection 1";

function Icon({
  name
}: {
  name:
    | "bookmark"
    | "book"
    | "check"
    | "chevron"
    | "document"
    | "filter"
    | "folder"
    | "list"
    | "more"
    | "page"
    | "search"
    | "settings"
    | "upload"
    | "back";
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "book") {
    return (
      <svg {...common}>
        <path d="M5 5.5h5.2A3.8 3.8 0 0 1 14 9.3v9.2a3.8 3.8 0 0 0-3.8-3.8H5z" />
        <path d="M19 5.5h-5.2A3.8 3.8 0 0 0 10 9.3v9.2a3.8 3.8 0 0 1 3.8-3.8H19z" />
      </svg>
    );
  }
  if (name === "document") {
    return (
      <svg {...common}>
        <path d="M7 4.5h6l4 4v11H7z" />
        <path d="M13 4.5v4h4" />
      </svg>
    );
  }
  if (name === "folder") {
    return (
      <svg {...common}>
        <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
      </svg>
    );
  }
  if (name === "page") {
    return (
      <svg {...common}>
        <path d="M8 4.5h8v15H8z" />
        <path d="M10.5 8h3M10.5 11h3M10.5 14h3" />
      </svg>
    );
  }
  if (name === "list") {
    return (
      <svg {...common}>
        <path d="M8 7h10M8 12h10M8 17h10" />
        <path d="M5 7h.01M5 12h.01M5 17h.01" />
      </svg>
    );
  }
  if (name === "bookmark") {
    return (
      <svg {...common}>
        <path d="M7 4.75h10v15l-5-3.25-5 3.25z" />
      </svg>
    );
  }
  if (name === "filter") {
    return (
      <svg {...common}>
        <path d="M5 7h14" />
        <path d="M8 12h8" />
        <path d="M10.5 17h3" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="5.5" />
        <path d="m16 16 3.5 3.5" />
      </svg>
    );
  }
  if (name === "upload") {
    return (
      <svg {...common}>
        <path d="M12 16V5" />
        <path d="m8 9 4-4 4 4" />
        <path d="M5 19h14" />
      </svg>
    );
  }
  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3h-4.8l-.3 3.1a7 7 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.3 3.1h4.8l.3-3.1a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
      </svg>
    );
  }
  if (name === "more") {
    return (
      <svg {...common}>
        <path d="M7 12h.01M12 12h.01M17 12h.01" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  }
  if (name === "back") {
    return (
      <svg {...common}>
        <path d="m15 18-6-6 6-6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function MobilePreviewStatusBar() {
  return (
    <div className="mobile-preview-status-bar" aria-hidden="true">
      <span>9:41</span>
      <span className="mobile-preview-status-bar__island" />
      <span className="mobile-preview-status-bar__system">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function DocumentsWorkspaceGlyph() {
  return (
    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
      <path d="M12 7.45C10.35 5.9 8.42 5.23 6.1 5.23H4.45A1.16 1.16 0 0 0 3.29 6.39v10.26a1.16 1.16 0 0 0 1.16 1.16H6.1c2.32 0 4.25.68 5.9 2.23" />
      <path d="M12 7.45c1.65-1.55 3.58-2.22 5.9-2.22h1.65a1.16 1.16 0 0 1 1.16 1.16v10.26a1.16 1.16 0 0 1-1.16 1.16H17.9c-2.32 0-4.25.68-5.9 2.23" />
      <path d="M12 7.45v12.58" />
    </g>
  );
}

function MinimalCollectionGlyph() {
  return (
    <path
      d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  );
}

function MobileRootTabBar({
  active,
  onNavigate
}: {
  active: "collections" | "book" | "settings";
  onNavigate: (route: "collections" | "book" | "settings") => void;
}) {
  return (
    <nav className="mobile-tab-bar" aria-label="Mobile sections">
      <button
        className={active === "collections" ? "is-active" : ""}
        type="button"
        onClick={() => onNavigate("collections")}
        aria-label="Collections"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <CollectionLibraryGlyph />
        </svg>
      </button>
      <button
        className={active === "book" ? "is-active" : ""}
        type="button"
        onClick={() => onNavigate("book")}
        aria-label="Book"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <DocumentsWorkspaceGlyph />
        </svg>
      </button>
      <button
        className={active === "settings" ? "is-active" : ""}
        type="button"
        onClick={() => onNavigate("settings")}
        aria-label="Settings"
      >
        <Icon name="settings" />
      </button>
    </nav>
  );
}

function formatOpenedAt(value: string | null) {
  if (!value) {
    return "Not opened yet";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Recently opened";
  }
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) {
    return `Opened ${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `Opened ${hours}h ago`;
  }
  return `Opened ${Math.round(hours / 24)}d ago`;
}

function findCollection(collections: MobileCollection[], collectionId: string | null) {
  return collections.find((collection) => collection.id === collectionId) ?? collections[0] ?? null;
}

function createFallbackPayload(document: DocumentRecord): DocumentPayload {
  return {
    document,
    filePath: "",
    pageCount: 1,
    state: {
      version: 1,
      documentId: document.id,
      fingerprint: document.fingerprint,
      lastOpenedAt: document.lastOpenedAt,
      lastPage: 1,
      zoom: MOBILE_PAGE_ZOOM,
      bookmarks: [],
      preferences: {
        fitMode: "free"
      }
    }
  };
}

function normalizeDialogSelection(selection: string | string[] | null) {
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

function clampMobilePage(page: number, pageCount: number) {
  return Math.min(Math.max(Math.round(page), 1), Math.max(pageCount, 1));
}

function createMobileScrollRange(page: number, pageCount: number) {
  const clampedPage = clampMobilePage(page, pageCount);
  return {
    start: Math.max(1, clampedPage - 2),
    end: Math.min(pageCount, clampedPage + 6)
  };
}

function clampMobileZoom(zoom: number) {
  return Math.min(Math.max(zoom, MOBILE_MIN_ZOOM), MOBILE_MAX_ZOOM);
}

function touchDistance(touches: React.TouchList) {
  if (touches.length < 2) {
    return null;
  }
  const [first, second] = [touches[0], touches[1]];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function LibraryScreen({
  collections,
  onOpenDocument,
  onOpenCollection,
  onImport,
  onNavigate,
  loading,
  status
}: {
  collections: MobileCollection[];
  onOpenDocument: (documentId: string, collectionId: string) => void;
  onOpenCollection: (collectionId: string) => void;
  onImport: () => void;
  onNavigate: (route: "collections" | "book" | "settings") => void;
  loading: boolean;
  status: string | null;
}) {
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const bookSearchResults = useMemo(() => {
    if (!normalizedSearchQuery) {
      return [];
    }
    return collections.flatMap((collection) =>
      collection.documents
        .filter((document) =>
          document.title.toLocaleLowerCase().includes(normalizedSearchQuery)
        )
        .map((document) => ({
          collectionId: collection.id,
          collectionName: collection.name,
          document
        }))
    );
  }, [collections, normalizedSearchQuery]);
  const showingBookSearch = normalizedSearchQuery.length > 0;
  useEffect(() => {
    if (searchActive) {
      searchInputRef.current?.focus();
    }
  }, [searchActive]);

  return (
    <main className={`mobile-screen mobile-screen--library${searchActive ? " mobile-screen--keyboard-open" : ""}`}>
      <MobilePreviewStatusBar />
      <div className="mobile-library-header">
        <header className="mobile-large-header">
          <div>
            <h1>Library</h1>
          </div>
        </header>

        {searchActive ? (
          <form
            className="mobile-search-pill mobile-search-pill--active mobile-search-field"
            role="search"
            onSubmit={(event) => event.preventDefault()}
          >
            <Icon name="search" />
            <input
              ref={searchInputRef}
              aria-label="Search books"
              autoCapitalize="none"
              autoComplete="off"
              enterKeyHint="search"
              inputMode="search"
              placeholder="Search books"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchActive(false);
                  setSearchQuery("");
                }
              }}
            />
            <button
              className="mobile-search-field__cancel"
              type="button"
              onClick={() => {
                setSearchActive(false);
                setSearchQuery("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button className="mobile-search-pill" type="button" onClick={() => setSearchActive(true)}>
            <Icon name="search" />
            <span>Search books</span>
          </button>
        )}
      </div>

      {status ? <p className="mobile-status">{status}</p> : null}

      <div className="mobile-card-list mobile-card-list--library">
        {showingBookSearch
          ? bookSearchResults.map(({ collectionId, collectionName, document }) => (
              <div className="mobile-book-row mobile-book-row--search" key={document.id}>
                <button
                  className="mobile-book-row__main"
                  type="button"
                  onClick={() => onOpenDocument(document.id, collectionId)}
                >
                  <span className="mobile-book-row__icon">
                    <Icon name="document" />
                  </span>
                  <span className="mobile-book-row__text">
                    <strong>{document.title}</strong>
                    <small>{collectionName}</small>
                  </span>
                </button>
              </div>
            ))
          : collections.map((collection) => (
              <button
                className="mobile-collection-card"
                key={collection.id}
                type="button"
                onClick={() => onOpenCollection(collection.id)}
              >
                <span className="mobile-collection-card__icon">
                  <Icon name="folder" />
                </span>
                <span className="mobile-collection-card__body">
                  <strong>{collection.name}</strong>
                  <small>{collection.documents.length} PDFs</small>
                </span>
                <Icon name="chevron" />
              </button>
            ))}
      </div>
      {showingBookSearch && bookSearchResults.length === 0 ? (
        <p className="mobile-empty-state">No books match this search.</p>
      ) : null}
      {searchActive ? <MobileKeyboardPreview /> : null}
      <MobileRootTabBar active="collections" onNavigate={onNavigate} />
    </main>
  );
}

function MobileKeyboardPreview() {
  const rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  return (
    <div className="mobile-keyboard-preview" aria-hidden="true">
      {rows.map((row) => (
        <div className="mobile-keyboard-preview__row" key={row}>
          {Array.from(row).map((key) => (
            <span key={key}>{key}</span>
          ))}
        </div>
      ))}
      <div className="mobile-keyboard-preview__row mobile-keyboard-preview__row--actions">
        <span>123</span>
        <span className="mobile-keyboard-preview__space">space</span>
        <span>search</span>
      </div>
    </div>
  );
}

function SettingsScreen({
  activeThemeId,
  onImport,
  onNavigate,
  onSelectTheme,
  status,
  themeList
}: {
  activeThemeId: string;
  onImport: () => void;
  onNavigate: (route: "collections" | "book" | "settings") => void;
  onSelectTheme: (themeId: string) => void;
  status: string | null;
  themeList: ThemeDefinition[];
}) {
  return (
    <main className="mobile-screen">
      <MobilePreviewStatusBar />
      <header className="mobile-large-header">
        <div>
          <h1>Settings</h1>
        </div>
      </header>
      {status ? <p className="mobile-status">{status}</p> : null}

      <section className="mobile-settings-group">
        <div className="mobile-section__header">
          <h2>Theme</h2>
          <span>Synced</span>
        </div>
        <div className="mobile-theme-list">
          {themeList.map((theme) => (
            <button
              className={`mobile-theme-card${theme.id === activeThemeId ? " is-active" : ""}`}
              key={theme.id}
              type="button"
              onClick={() => onSelectTheme(theme.id)}
            >
              <span
                className="mobile-theme-card__preview"
                style={
                  {
                    "--mobile-theme-preview-chrome": theme.source.chrome,
                    "--mobile-theme-preview-paper": theme.source.documentPaper,
                    "--mobile-theme-preview-ink": theme.source.documentInk,
                    "--mobile-theme-preview-accent": theme.source.interactive
                  } as CSSProperties
                }
              />
              <span className="mobile-theme-card__body">
                <strong>{theme.name}</strong>
                <small>{theme.kind === "custom" ? "Custom theme" : "Built-in theme"}</small>
              </span>
              {theme.id === activeThemeId ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="mobile-settings-card">
        <div>
          <h2>Library imports</h2>
          <p>Selected PDFs are copied into Readr’s managed library before they appear in collections.</p>
        </div>
        <button className="mobile-primary-button" type="button" onClick={onImport}>
          <Icon name="upload" />
          <span>Import PDFs</span>
        </button>
      </section>
      <section className="mobile-settings-card">
        <div>
          <h2>Reading</h2>
          <p>Mobile keeps a simple book-only reader with Page and Scroll modes. Notes stay on desktop.</p>
        </div>
      </section>
      <section className="mobile-settings-card mobile-settings-card--quiet">
        <span>Readr iOS companion</span>
        <small>First-pass mobile shell</small>
      </section>
      <MobileRootTabBar active="settings" onNavigate={onNavigate} />
    </main>
  );
}

function MobileCollectionSortMenu({
  sortMode,
  onChange
}: {
  sortMode: CollectionDocumentSortMode;
  onChange: (sortMode: CollectionDocumentSortMode) => void;
}) {
  const [open, setOpen] = useState(false);

  const selectSortMode = (nextSortMode: CollectionDocumentSortMode) => {
    onChange(nextSortMode);
    setOpen(false);
  };

  return (
    <div className="mobile-collection-sort-menu">
      <button
        className="mobile-filter-button"
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Sort books"
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter" />
      </button>
      {open ? (
        <div className="mobile-collection-sort-menu__popover" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sortMode === "manual"}
            onClick={() => selectSortMode("manual")}
          >
            <span>Manual</span>
            {sortMode === "manual" ? <Icon name="check" /> : null}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sortMode === "recent"}
            onClick={() => selectSortMode("recent")}
          >
            <span>Recent</span>
            {sortMode === "recent" ? <Icon name="check" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type MobileRenameTarget =
  | { kind: "collection"; id: string; currentName: string }
  | { kind: "document"; id: string; currentName: string };

function CollectionScreen({
  collection,
  onBack,
  onImport,
  onNavigate,
  onOpenDocument,
  onRenameCollection,
  onRenameDocument,
  status
}: {
  collection: MobileCollection;
  onBack: () => void;
  onImport: () => void;
  onNavigate: (route: "collections" | "book" | "settings") => void;
  onOpenDocument: (documentId: string, collectionId: string) => void;
  onRenameCollection: (collectionId: string, currentName: string, nextName: string) => void;
  onRenameDocument: (documentId: string, currentName: string, nextName: string) => void;
  status: string | null;
}) {
  const [renameTarget, setRenameTarget] = useState<MobileRenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState(collection.name);
  const [sortMode, setSortMode] = useState<CollectionDocumentSortMode>("recent");
  const displayedDocuments = useMemo(
    () =>
      sortMode === "recent"
        ? sortCollectionDocumentsByRecent(collection.documents)
        : collection.documents,
    [collection.documents, sortMode]
  );
  const trimmedRenameValue = renameValue.trim();

  useEffect(() => {
    if (!renameTarget) {
      setRenameValue(collection.name);
    }
  }, [collection.name, renameTarget]);

  const closeRenameSheet = () => {
    setRenameTarget(null);
    setRenameValue(collection.name);
  };

  const submitRename = () => {
    if (!renameTarget || !trimmedRenameValue || trimmedRenameValue === renameTarget.currentName) {
      closeRenameSheet();
      return;
    }
    if (renameTarget.kind === "collection") {
      onRenameCollection(renameTarget.id, renameTarget.currentName, trimmedRenameValue);
    } else {
      onRenameDocument(renameTarget.id, renameTarget.currentName, trimmedRenameValue);
    }
    setRenameTarget(null);
  };

  const openRenameSheet = (target: MobileRenameTarget) => {
    setRenameTarget(target);
    setRenameValue(target.currentName);
  };

  return (
    <main className="mobile-screen">
      <MobilePreviewStatusBar />
      <header className="mobile-nav-header">
        <button className="mobile-icon-button" type="button" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <button className="mobile-primary-button" type="button" onClick={onImport}>
          <Icon name="upload" />
          <span>Import</span>
        </button>
      </header>
      <section className="mobile-title-block">
        <div className="mobile-collection-title-row">
          <div>
            <button
              className="mobile-title-edit-button"
              type="button"
              onClick={() =>
                openRenameSheet({
                  kind: "collection",
                  id: collection.id,
                  currentName: collection.name
                })
              }
            >
              <h1>{collection.name}</h1>
            </button>
            <p>{collection.documents.length} PDFs</p>
          </div>
          <MobileCollectionSortMenu sortMode={sortMode} onChange={setSortMode} />
        </div>
      </section>
      {status ? <p className="mobile-status">{status}</p> : null}
      <div className="mobile-book-list mobile-book-list--cards">
        {displayedDocuments.map((document) => (
          <div className="mobile-book-row" key={document.id}>
            <button
              className="mobile-book-row__main"
              type="button"
              onClick={() => onOpenDocument(document.id, collection.id)}
            >
              <span className="mobile-book-row__icon">
                <Icon name="document" />
              </span>
              <span className="mobile-book-row__text">
                <strong>{document.title}</strong>
              </span>
            </button>
            <button
              className="mobile-row-action-button"
              type="button"
              aria-label={`Rename ${document.title}`}
              onClick={() =>
                openRenameSheet({
                  kind: "document",
                  id: document.id,
                  currentName: document.title
                })
              }
            >
              <Icon name="more" />
            </button>
          </div>
        ))}
      </div>
      {renameTarget ? (
        <div className="mobile-rename-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-rename-title">
          <div className="mobile-rename-sheet__card">
            <h2 id="mobile-rename-title">
              {renameTarget.kind === "collection" ? "Rename collection" : "Rename PDF"}
            </h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeRenameSheet();
                }
                if (event.key === "Enter") {
                  submitRename();
                }
              }}
            />
            <div className="mobile-rename-sheet__actions">
              <button type="button" onClick={closeRenameSheet}>
                Cancel
              </button>
              <button
                type="button"
                disabled={!trimmedRenameValue || trimmedRenameValue === renameTarget.currentName}
                onClick={submitRename}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <MobileRootTabBar active="collections" onNavigate={onNavigate} />
    </main>
  );
}

function ReaderScreen({
  document,
  mode,
  currentPage,
  onBack,
  onModeChange,
  onPageChange
}: {
  document: DocumentPayload;
  mode: ReaderViewMode;
  currentPage: number;
  onBack: () => void;
  onModeChange: (mode: ReaderViewMode) => void;
  onPageChange: (page: number) => void;
}) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollPageRef = useRef<number | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [pageZoom, setPageZoom] = useState(MOBILE_PAGE_ZOOM);
  const [scrollZoom, setScrollZoom] = useState(MOBILE_SCROLL_ZOOM);
  const [scrollRange, setScrollRange] = useState(() =>
    createMobileScrollRange(currentPage, document.pageCount)
  );
  const scrollPages = useMemo(
    () =>
      Array.from(
        { length: scrollRange.end - scrollRange.start + 1 },
        (_, index) => scrollRange.start + index
      ),
    [scrollRange]
  );

  useEffect(() => {
    if (mode !== "scroll") {
      return;
    }
    setScrollRange(createMobileScrollRange(currentPage, document.pageCount));
    pendingScrollPageRef.current = currentPage;
  }, [document.document.id, document.pageCount, mode]);

  useEffect(() => {
    if (mode !== "scroll" || !scrollRootRef.current || pendingScrollPageRef.current === null) {
      return;
    }

    const targetPage = pendingScrollPageRef.current;
    const frameId = window.requestAnimationFrame(() => {
      const target = scrollRootRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${targetPage}"]`
      );
      target?.scrollIntoView({ block: "start", behavior: "auto" });
      pendingScrollPageRef.current = null;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [currentPage, mode, scrollPages]);

  useEffect(() => {
    if (mode !== "scroll" || !scrollRootRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const nextPage = Number(visible?.target.getAttribute("data-page-number"));
        if (pendingScrollPageRef.current !== null) {
          return;
        }
        if (Number.isFinite(nextPage) && nextPage !== currentPage) {
          onPageChange(nextPage);
        }
        if (Number.isFinite(nextPage)) {
          setScrollRange((currentRange) => {
            const nextRange = { ...currentRange };
            if (nextPage >= currentRange.end - 1 && currentRange.end < document.pageCount) {
              nextRange.end = Math.min(document.pageCount, currentRange.end + 6);
            }
            if (nextPage <= currentRange.start + 1 && currentRange.start > 1) {
              nextRange.start = Math.max(1, currentRange.start - 6);
            }
            return nextRange.start === currentRange.start && nextRange.end === currentRange.end
              ? currentRange
              : nextRange;
          });
        }
      },
      {
        root: scrollRootRef.current,
        threshold: [0.45, 0.7]
      }
    );

    scrollRootRef.current
      .querySelectorAll<HTMLElement>("[data-page-number]")
      .forEach((page) => observer.observe(page));

    return () => observer.disconnect();
  }, [currentPage, document.pageCount, mode, onPageChange, scrollPages]);

  const requestPageChange = (page: number) => {
    const nextPage = clampMobilePage(page, document.pageCount);
    if (mode === "scroll") {
      pendingScrollPageRef.current = nextPage;
      setScrollRange(createMobileScrollRange(nextPage, document.pageCount));
    }
    onPageChange(nextPage);
  };
  const activeZoom = mode === "scroll" ? scrollZoom : pageZoom;

  const updateActiveZoom = (zoom: number) => {
    const nextZoom = clampMobileZoom(zoom);
    if (mode === "scroll") {
      setScrollZoom(nextZoom);
    } else {
      setPageZoom(nextZoom);
    }
  };

  const handleReaderTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const distance = touchDistance(event.touches);
    if (distance === null) {
      return;
    }
    pinchRef.current = {
      distance,
      zoom: activeZoom
    };
    setChromeVisible(false);
    event.preventDefault();
  };

  const handleReaderTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    const distance = touchDistance(event.touches);
    if (distance === null || !pinchRef.current) {
      return;
    }
    updateActiveZoom(pinchRef.current.zoom * (distance / pinchRef.current.distance));
    event.preventDefault();
  };

  const handleReaderTouchEnd = () => {
    if (pinchRef.current && scrollRootRef.current && mode === "scroll") {
      pendingScrollPageRef.current = currentPage;
    }
    window.setTimeout(() => {
      pinchRef.current = null;
    }, 0);
  };

  const handleReaderTap = () => {
    if (pinchRef.current) {
      return;
    }
    setChromeVisible((visible) => !visible);
  };

  return (
    <main className={`mobile-reader${chromeVisible ? "" : " mobile-reader--chrome-hidden"}`}>
      <MobilePreviewStatusBar />
      <header className="mobile-reader-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        <button className="mobile-icon-button" type="button" onClick={onBack} aria-label="Back">
          <Icon name="back" />
        </button>
        <span className="mobile-reader-toolbar__page">
          {currentPage} / {document.pageCount}
        </span>
        <div className="mobile-segmented" role="group" aria-label="Reader mode">
          <button
            className={mode === "page" ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("page")}
            aria-label="Page mode"
          >
            <Icon name="page" />
          </button>
          <button
            className={mode === "scroll" ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("scroll")}
            aria-label="Scroll mode"
          >
            <Icon name="list" />
          </button>
        </div>
        <button className="mobile-icon-button" type="button" aria-label="Bookmark placeholder">
          <Icon name="bookmark" />
        </button>
      </header>

      {mode === "page" ? (
        <section
          className="mobile-reader-page-mode"
          onClick={handleReaderTap}
          onTouchEnd={handleReaderTouchEnd}
          onTouchMove={handleReaderTouchMove}
          onTouchStart={handleReaderTouchStart}
        >
          <MobilePdfPage
            documentId={document.document.id}
            openSessionId={null}
            pageNumber={currentPage}
            zoom={pageZoom}
          />
        </section>
      ) : (
        <section
          className="mobile-reader-scroll-mode"
          ref={scrollRootRef}
          onClick={handleReaderTap}
          onScroll={() => setChromeVisible(false)}
          onTouchEnd={handleReaderTouchEnd}
          onTouchMove={handleReaderTouchMove}
          onTouchStart={handleReaderTouchStart}
        >
          {scrollPages.map((page) => (
            <MobilePdfPage
              className="mobile-pdf-page--scroll"
              documentId={document.document.id}
              key={page}
              openSessionId={null}
              pageNumber={page}
              zoom={scrollZoom}
            />
          ))}
        </section>
      )}

      <footer className="mobile-reader-scrubber" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={() => requestPageChange(currentPage - 1)}
          aria-label="Previous page"
        >
          <Icon name="back" />
        </button>
        <input
          aria-label="Page"
          type="range"
          min={1}
          max={Math.max(document.pageCount, 1)}
          value={currentPage}
          onChange={(event) => requestPageChange(Number(event.currentTarget.value))}
        />
        <button
          type="button"
          onClick={() => requestPageChange(currentPage + 1)}
          aria-label="Next page"
        >
          <Icon name="chevron" />
        </button>
      </footer>
    </main>
  );
}

export default function AppMobile() {
  const appSettings = useAppSettings();
  const [tree, setTree] = useState<FolderTreeNode | null>(null);
  const [route, setRoute] = useState<MobileRoute>({ name: "library" });
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [readerDocument, setReaderDocument] = useState<DocumentPayload | null>(null);
  const [readerMode, setReaderMode] = useState<ReaderViewMode>("scroll");
  const [currentPage, setCurrentPage] = useState(1);
  const viewerDisplayConfig = useMemo(
    () => appSettings.selectors.viewerDisplayConfig(appSettings.settings),
    [appSettings.selectors, appSettings.settings]
  );

  useEffect(() => {
    const { classList, style } = document.body;
    classList.add("readr-mobile-shell");
    style.setProperty("--viewer-paper-color", viewerDisplayConfig.paperColor);
    style.setProperty("--viewer-ink-color", viewerDisplayConfig.inkColor);
    style.setProperty("--viewer-image-filter", viewerDisplayConfig.imageFilter);
    style.setProperty("--viewer-image-blend-mode", viewerDisplayConfig.blendMode);

    return () => {
      classList.remove("readr-mobile-shell");
      style.removeProperty("--viewer-paper-color");
      style.removeProperty("--viewer-ink-color");
      style.removeProperty("--viewer-image-filter");
      style.removeProperty("--viewer-image-blend-mode");
    };
  }, [viewerDisplayConfig]);

  const refreshLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const library = await listLibrary();
      setTree(library);
      setStatus(null);
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingLibrary(true);
    listLibrary()
      .then((library) => {
        if (!cancelled) {
          setTree(library);
          setStatus(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTree(makeMobileMockLibrary());
          setStatus("Preview data shown. Run inside Tauri to load your library.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingLibrary(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const collections = useMemo(() => mobileCollectionsFromTree(tree), [tree]);
  const recentDocuments = useMemo(() => mostRecentDocuments(collections), [collections]);
  const themeList = useMemo(
    () => appSettings.selectors.themeList(appSettings.settings),
    [appSettings.selectors, appSettings.settings]
  );

  const promptImport = async (destinationCollectionId: string) => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        pickerMode: "document",
        fileAccessMode: "copy",
        filters: [{ name: "PDF", extensions: ["pdf"] }]
      });
      const sourcePaths = normalizeDialogSelection(selected);
      if (sourcePaths.length === 0) {
        return;
      }

      const plural = sourcePaths.length === 1 ? "" : "s";
      setStatus(`Importing ${sourcePaths.length} PDF${plural}...`);
      const result = await importOwnedPdfs(sourcePaths, destinationCollectionId, {
        cleanupOwnedSources: true
      });
      await refreshLibrary();

      if (result.failed.length > 0) {
        setStatus(`${result.imported.length} imported, ${result.failed.length} failed.`);
      } else {
        setStatus(`${result.imported.length} PDF${result.imported.length === 1 ? "" : "s"} imported.`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Import is available when this mobile shell is running inside Tauri."
      );
    } finally {
      setLoadingLibrary(false);
    }
  };

  const openReader = async (documentId: string, collectionId: string | null) => {
    const documentRecord =
      collections.flatMap((collection) => collection.documents).find((document) => document.id === documentId) ??
      recentDocuments.find((document) => document.id === documentId);
    if (!documentRecord) {
      return;
    }

    setStatus("Opening book...");
    try {
      const payload = await openDocument(documentId);
      setReaderDocument(payload);
      setCurrentPage(Math.min(Math.max(payload.state.lastPage || 1, 1), payload.pageCount));
      setStatus(null);
    } catch {
      const payload = createFallbackPayload(documentRecord);
      setReaderDocument(payload);
      setCurrentPage(1);
      setStatus("Reader preview only. Run inside Tauri to render PDF pages.");
    }
    setRoute({ name: "reader", documentId, collectionId });
  };

  const renameCollection = async (collectionId: string, currentName: string, nextName: string) => {
    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === currentName) {
      return;
    }

    try {
      const renamedCollection = await renameFolder(collectionId, trimmedName);
      await refreshLibrary();
      setRoute((currentRoute) =>
        currentRoute.name === "collection" && currentRoute.collectionId === collectionId
          ? { name: "collection", collectionId: renamedCollection.id }
          : currentRoute
      );
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename this collection.");
    }
  };

  const renamePdf = async (documentId: string, currentName: string, nextName: string) => {
    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === currentName) {
      return;
    }

    try {
      const renamedDocument = await renameDocument(documentId, trimmedName);
      await refreshLibrary();
      setReaderDocument((currentDocument) =>
        currentDocument?.document.id === documentId
          ? {
              ...currentDocument,
              document: renamedDocument
            }
          : currentDocument
      );
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to rename this PDF.");
    }
  };

  useEffect(() => {
    if (!readerDocument || route.name !== "reader") {
      return;
    }
    const timeout = window.setTimeout(() => {
      void saveDocumentState(readerDocument.document.id, {
        ...readerDocument.state,
        lastOpenedAt: new Date().toISOString(),
        lastPage: currentPage,
        zoom: readerMode === "scroll" ? MOBILE_SCROLL_ZOOM : MOBILE_PAGE_ZOOM
      }).catch(() => {
        setStatus("Page position is local until the app is running inside Tauri.");
      });
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [currentPage, readerDocument, readerMode, route.name]);

  const selectedCollection =
    route.name === "collection"
      ? findCollection(collections, route.collectionId)
      : route.name === "reader"
        ? findCollection(collections, route.collectionId)
        : null;

  const navigateRoot = (nextRoute: "collections" | "book" | "settings") => {
    if (nextRoute === "collections") {
      setRoute({ name: "library" });
    } else if (nextRoute === "settings") {
      setRoute({ name: "settings" });
    } else if (readerDocument) {
      setRoute({
        name: "reader",
        documentId: readerDocument.document.id,
        collectionId: selectedCollection?.id ?? null
      });
    } else if (recentDocuments[0]) {
      void openReader(recentDocuments[0].id, null);
    } else {
      setStatus("Import or open a PDF before entering Book view.");
    }
  };

  if (route.name === "reader" && readerDocument) {
    return (
      <ReaderScreen
        document={readerDocument}
        mode={readerMode}
        currentPage={currentPage}
        onBack={() =>
          setRoute(
            route.collectionId
              ? { name: "collection", collectionId: route.collectionId }
              : { name: "library" }
          )
        }
        onModeChange={setReaderMode}
        onPageChange={(page) =>
          setCurrentPage(Math.min(Math.max(Math.round(page), 1), readerDocument.pageCount))
        }
      />
    );
  }

  if (route.name === "settings") {
    return (
      <SettingsScreen
        activeThemeId={appSettings.settings.activeThemeId}
        status={status}
        onImport={() => void promptImport(MOBILE_DEFAULT_COLLECTION_ID)}
        onNavigate={navigateRoot}
        onSelectTheme={(themeId) => appSettings.setSetting("activeThemeId", themeId)}
        themeList={themeList}
      />
    );
  }

  if (route.name === "collection" && selectedCollection) {
    return (
      <CollectionScreen
        collection={selectedCollection}
        onBack={() => setRoute({ name: "library" })}
        onImport={() => void promptImport(selectedCollection.id)}
        onNavigate={navigateRoot}
        onOpenDocument={openReader}
        onRenameCollection={(collectionId, currentName, nextName) =>
          void renameCollection(collectionId, currentName, nextName)
        }
        onRenameDocument={(documentId, currentName, nextName) =>
          void renamePdf(documentId, currentName, nextName)
        }
        status={status}
      />
    );
  }

  return (
      <LibraryScreen
        collections={collections}
        loading={loadingLibrary}
        status={status}
        onImport={() => void promptImport(MOBILE_DEFAULT_COLLECTION_ID)}
        onNavigate={navigateRoot}
        onOpenDocument={openReader}
        onOpenCollection={(collectionId) => setRoute({ name: "collection", collectionId })}
      />
  );
}
