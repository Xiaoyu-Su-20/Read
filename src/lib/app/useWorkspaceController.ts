import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createFolder,
  createStandaloneNote,
  deleteDocument,
  deleteFolder,
  deleteStandaloneNote,
  getDocumentDeleteState,
  getStandaloneNoteDeleteState,
  getLibraryRoot,
  importPdf,
  listLibrary,
  listRecentDocuments,
  listStandaloneNotes,
  moveDocument,
  openDocument,
  openStandaloneNote,
  reorderCollectionDocuments,
  reorderCollections,
  removeFromLibrary,
  renameDocument,
  renameFolder,
  renameStandaloneNote,
  rescanLibrary,
  setLibraryRoot,
  showDocumentInExplorer
} from "../api";
import { sortRecentDocuments } from "../commands";
import { debugAction, runDebugProcess } from "../debugLog";
import {
  ROOT_FOLDER_ID,
  type DocumentPayload,
  type DocumentRecord,
  type DocumentState,
  type FolderTreeNode,
  type NoteIndexEntry,
  type OutlineItem,
  type ReaderSession,
  type ViewerApi,
  type ViewerSnapshot
} from "../types";
import { toCollectionOptions } from "./helpers";

type WorkspaceMode = "reader" | "collection" | "notes" | "book";
type LibrarySelection = "collections" | "notes";

type PersistedWorkspaceSession = {
  activeStandaloneNoteId: string | null;
  librarySelection: LibrarySelection;
  workspaceMode: WorkspaceMode;
};

const WORKSPACE_SESSION_STORAGE_KEY = "calm-reader.workspace-session";

function readPersistedWorkspaceSession(): PersistedWorkspaceSession {
  const defaultSession: PersistedWorkspaceSession = {
    activeStandaloneNoteId: null,
    librarySelection: "collections",
    workspaceMode: "collection"
  };

  if (typeof window === "undefined") {
    return defaultSession;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_SESSION_STORAGE_KEY);
    if (!raw) {
      return defaultSession;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedWorkspaceSession>;
    return {
      // Always boot into the library entry point instead of restoring the last workspace.
      activeStandaloneNoteId: null,
      librarySelection: "collections",
      workspaceMode: "collection"
    };
  } catch {
    return defaultSession;
  }
}

type OpenDocumentOptions = {
  refreshLibrary?: boolean;
  source?: ReaderSession["source"];
  targetMode?: "reader" | "book";
};

type ReaderOpenSession = {
  clickStartedAtMs: number;
  documentId: string;
  openSessionId: string;
  source: ReaderSession["source"];
};

function createReaderOpenSession(
  documentId: string,
  source: ReaderSession["source"]
): ReaderOpenSession {
  return {
    clickStartedAtMs: performance.now(),
    documentId,
    openSessionId: `open-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source
  };
}

export function useWorkspaceController() {
  const initialWorkspaceSessionRef = useRef<PersistedWorkspaceSession | null>(null);
  if (initialWorkspaceSessionRef.current === null) {
    initialWorkspaceSessionRef.current = readPersistedWorkspaceSession();
  }

  const initialWorkspaceSession = initialWorkspaceSessionRef.current;
  const [libraryTree, setLibraryTree] = useState<FolderTreeNode | null>(null);
  const [libraryRoot, setLibraryRootPath] = useState("");
  const [recentDocuments, setRecentDocuments] = useState<DocumentRecord[]>([]);
  const [standaloneNotes, setStandaloneNotes] = useState<NoteIndexEntry[]>([]);
  const [activeReaderSession, setActiveReaderSession] = useState<ReaderSession | null>(null);
  const [pendingReaderOpenSessionId, setPendingReaderOpenSessionId] = useState<string | null>(null);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);
  const [viewerSnapshot, setViewerSnapshot] = useState<ViewerSnapshot>({
    currentPage: 1,
    pageCount: 0,
    zoom: 1
  });
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [workspaceMode, setWorkspaceModeState] = useState<WorkspaceMode>(
    initialWorkspaceSession.workspaceMode
  );
  const [selectedLibrarySection, setSelectedLibrarySection] = useState<LibrarySelection>(
    initialWorkspaceSession.librarySelection
  );
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [activeStandaloneNoteId, setActiveStandaloneNoteIdState] = useState<string | null>(
    initialWorkspaceSession.activeStandaloneNoteId
  );
  const viewerApiRef = useRef<ViewerApi | null>(null);
  const [viewerApi, setViewerApi] = useState<ViewerApi | null>(null);
  const initialBootstrapStartedRef = useRef(false);
  const pendingReaderOpenSessionRef = useRef<ReaderOpenSession | null>(null);

  const activeDocument = activeReaderSession?.document ?? null;
  const collections = libraryTree?.folders ?? [];
  const selectedCollection = useMemo(
    () =>
      collections.find((collection) => collection.folder.id === selectedCollectionId) ??
      collections[0] ??
      null,
    [collections, selectedCollectionId]
  );
  const collectionOptions = useMemo(() => toCollectionOptions(collections), [collections]);
  const activeDocumentId = activeReaderSession?.documentId ?? null;
  const activeStandaloneNote =
    standaloneNotes.find((note) => note.id === activeStandaloneNoteId) ?? null;

  const persistWorkspaceSession = useCallback(
    (
      nextWorkspaceMode: WorkspaceMode,
      nextLibrarySelection: LibrarySelection,
      nextActiveStandaloneNoteId: string | null
    ) => {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.setItem(
        WORKSPACE_SESSION_STORAGE_KEY,
        JSON.stringify({
          activeStandaloneNoteId: nextActiveStandaloneNoteId,
          librarySelection: nextLibrarySelection,
          workspaceMode: nextWorkspaceMode
        } satisfies PersistedWorkspaceSession)
      );
    },
    []
  );

  useEffect(() => {
    persistWorkspaceSession(workspaceMode, selectedLibrarySection, activeStandaloneNoteId);
  }, [activeStandaloneNoteId, persistWorkspaceSession, selectedLibrarySection, workspaceMode]);

  const refreshRecentDocuments = useCallback(async () => {
    return runDebugProcess("app.refresh-recent-documents", {}, async () => {
      const recents = await listRecentDocuments();
      setRecentDocuments(sortRecentDocuments(recents));
    });
  }, []);

  const refreshStandaloneNotes = useCallback(async () => {
    return runDebugProcess("app.refresh-standalone-notes", {}, async () => {
      const notes = await listStandaloneNotes();
      setStandaloneNotes(notes);
      setActiveStandaloneNoteIdState((current) =>
        current && notes.some((note) => note.id === current) ? current : current ? null : current
      );
      return notes;
    });
  }, []);

  const refreshLibraryState = useCallback(async (options?: { rescan?: boolean }) => {
    return runDebugProcess(
      "app.refresh-library-state",
      {
        rescan: Boolean(options?.rescan)
        },
        async () => {
          const [tree, recents, root, notes] = await Promise.all([
            options?.rescan ? rescanLibrary() : listLibrary(),
            listRecentDocuments(),
            getLibraryRoot(),
            listStandaloneNotes()
          ]);
          setLibraryTree(tree);
          setRecentDocuments(sortRecentDocuments(recents));
          setLibraryRootPath(root);
          setStandaloneNotes(notes);
          setActiveStandaloneNoteIdState((current) =>
            current && notes.some((note) => note.id === current) ? current : current ? null : current
          );
        }
      );
  }, []);

  const resetOpenDocument = useCallback(() => {
    debugAction("app.reset-open-document");
    setActiveReaderSession(null);
    setPendingReaderOpenSessionId(null);
    setReaderState(null);
    setOutlineItems([]);
    setSelectedLibrarySection("collections");
    setWorkspaceModeState("collection");
    setViewerSnapshot({
      currentPage: 1,
      pageCount: 0,
      zoom: 1
    });
  }, []);

  useEffect(() => {
    if (initialBootstrapStartedRef.current) {
      debugAction("app.initial-library-bootstrap:skip-duplicate");
      return;
    }

    initialBootstrapStartedRef.current = true;
    debugAction("app.initial-library-bootstrap:start");

    void runDebugProcess("app.initial-library-bootstrap", {}, async () => {
      await refreshLibraryState();
    }).catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : "Unable to load library.");
    });
  }, [refreshLibraryState]);

  useEffect(() => {
    if (collections.length === 0) {
      setSelectedCollectionId(null);
      return;
    }

    if (!selectedCollectionId || !collections.some((folder) => folder.folder.id === selectedCollectionId)) {
      setSelectedCollectionId(collections[0].folder.id);
    }
  }, [collections, selectedCollectionId]);

  const handleViewerSnapshotChange = useCallback((snapshot: ViewerSnapshot) => {
    setViewerSnapshot(snapshot);
  }, []);

  const handleViewerOutlineChange = useCallback((items: OutlineItem[]) => {
    setOutlineItems(items);
  }, []);

  const handleViewerStateChange = useCallback((state: DocumentState | null) => {
    setReaderState(state);
  }, []);

  const handleViewerStatusChange = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const registerViewerApi = useCallback((api: ViewerApi | null) => {
    viewerApiRef.current = api;
    setViewerApi(api);
  }, []);

  const handleOpenDocument = useCallback(
    async (documentId: string, options?: OpenDocumentOptions) => {
      const openSession = createReaderOpenSession(documentId, options?.source ?? "unknown");
      pendingReaderOpenSessionRef.current = openSession;
      setPendingReaderOpenSessionId(openSession.openSessionId);
      debugAction("reader.open:click", {
        documentId,
        openSessionId: openSession.openSessionId,
        refreshLibrary: Boolean(options?.refreshLibrary),
        source: openSession.source
      });
      await runDebugProcess(
        "app.open-document",
        {
            documentId,
            openSessionId: openSession.openSessionId,
            refreshLibrary: Boolean(options?.refreshLibrary),
            source: openSession.source
        },
        async () => {
          debugAction("reader.open:command-start", {
            documentId,
            openSessionId: openSession.openSessionId,
            elapsedMs: Math.round(performance.now() - openSession.clickStartedAtMs),
            source: openSession.source
          });
          const payload = await openDocument(documentId, {
            openSessionId: openSession.openSessionId
          });
          if (pendingReaderOpenSessionRef.current?.openSessionId !== openSession.openSessionId) {
            debugAction("reader.open:stale-payload-ignored", {
              documentId,
              openSessionId: openSession.openSessionId
            });
            return;
          }
          debugAction("reader.open:document-ready", {
            documentId,
            openSessionId: openSession.openSessionId,
            elapsedMs: Math.round(performance.now() - openSession.clickStartedAtMs),
            source: openSession.source
          });
          setActiveReaderSession({
            document: payload,
            documentId: payload.document.id,
            page: payload.state.lastPage,
            zoom: payload.state.zoom,
            openSessionId: openSession.openSessionId,
            clickStartedAtMs: openSession.clickStartedAtMs,
            source: openSession.source
          });
          setReaderState(payload.state);
          setSelectedCollectionId(payload.document.folderId);
          setSelectedLibrarySection("collections");
          setStatusMessage(`Opened ${payload.document.title}.`);
          setWorkspaceModeState(options?.targetMode ?? "reader");
          debugAction("reader.open:active-document-committed", {
            documentId: payload.document.id,
            openSessionId: openSession.openSessionId,
            elapsedMs: Math.round(performance.now() - openSession.clickStartedAtMs),
            source: openSession.source
          });
          setPendingReaderOpenSessionId((currentOpenSessionId) =>
            currentOpenSessionId === openSession.openSessionId ? null : currentOpenSessionId
          );
          if (options?.refreshLibrary) {
            await refreshLibraryState();
          } else {
            await refreshRecentDocuments();
          }
        }
      ).finally(() => {
        if (pendingReaderOpenSessionRef.current?.openSessionId === openSession.openSessionId) {
          pendingReaderOpenSessionRef.current = null;
        }
        setPendingReaderOpenSessionId((currentOpenSessionId) =>
          currentOpenSessionId === openSession.openSessionId ? null : currentOpenSessionId
        );
      });
    },
    [refreshLibraryState, refreshRecentDocuments]
  );

  const syncActiveDocument = useCallback(async (options?: { preserveSelectedCollectionId?: boolean }) => {
    if (!activeDocument) {
      return;
    }

    try {
      await runDebugProcess(
        "app.sync-active-document",
        {
          documentId: activeDocument.document.id,
          openSessionId: activeReaderSession?.openSessionId ?? null
        },
        async () => {
          const payload = await openDocument(activeDocument.document.id, {
            openSessionId: activeReaderSession?.openSessionId
          });
          setActiveReaderSession((currentSession) =>
            currentSession
              ? {
                  ...currentSession,
                  document: payload,
                  documentId: payload.document.id,
                  page: payload.state.lastPage,
                  zoom: payload.state.zoom,
                  source: currentSession.source
                }
              : null
          );
          setReaderState(payload.state);
          if (!options?.preserveSelectedCollectionId) {
            setSelectedCollectionId(payload.document.folderId);
          }
          await refreshRecentDocuments();
        }
      );
    } catch {
      resetOpenDocument();
    }
  }, [activeDocument, activeReaderSession?.openSessionId, refreshRecentDocuments, resetOpenDocument]);

  const setWorkspaceMode = useCallback((nextMode: WorkspaceMode) => {
    setWorkspaceModeState(nextMode);
  }, []);

  const enterBookMode = useCallback(() => {
    setSelectedLibrarySection("collections");
    setWorkspaceModeState("book");
  }, []);

  const showCollectionsWorkspace = useCallback(() => {
    setSelectedLibrarySection("collections");
    setWorkspaceModeState("collection");
  }, []);

  const selectCollectionInLibrary = useCallback((collectionId: string) => {
    setSelectedLibrarySection("collections");
    setSelectedCollectionId(collectionId);
    setWorkspaceModeState("collection");
  }, []);

  const selectNotesLibrary = useCallback(() => {
    setSelectedLibrarySection("notes");
    if (standaloneNotes.length === 0) {
      setWorkspaceModeState("notes");
      return;
    }

    setWorkspaceModeState("collection");
  }, [standaloneNotes.length]);

  const enterNotesMode = useCallback(() => {
    setSelectedLibrarySection("notes");
    if (standaloneNotes.length === 0) {
      setActiveStandaloneNoteIdState(null);
      setWorkspaceModeState("notes");
      return null;
    }

    const nextStandaloneNoteId =
      activeStandaloneNoteId && standaloneNotes.some((note) => note.id === activeStandaloneNoteId)
        ? activeStandaloneNoteId
        : standaloneNotes[0]?.id ?? null;
    setActiveStandaloneNoteIdState(nextStandaloneNoteId);
    setWorkspaceModeState("notes");
    return nextStandaloneNoteId;
  }, [activeStandaloneNoteId, standaloneNotes]);

  const openStandaloneNoteInWorkspace = useCallback(
    async (
      noteId: string,
      options?: {
        workspaceMode?: "collection" | "notes";
      }
    ) => {
      setSelectedLibrarySection("notes");
      setActiveStandaloneNoteIdState(noteId);
      setWorkspaceModeState(options?.workspaceMode ?? "notes");
      return noteId;
    },
    []
  );

  const createCollection = useCallback(
    async (name: string) => {
      debugAction("library.create-collection-flow", {
        name
      });
      const folder = await createFolder(name, ROOT_FOLDER_ID);
      await refreshLibraryState();
      setSelectedCollectionId(folder.id);
      setSelectedLibrarySection("collections");
      setWorkspaceMode("collection");
      setStatusMessage(`Created ${folder.name}.`);
      return folder;
    },
    [refreshLibraryState]
  );

  const importDocumentToCollection = useCallback(
    async (sourcePath: string, destinationFolderId: string) => {
      const record = await importPdf(sourcePath, destinationFolderId);
      await handleOpenDocument(record.id, { refreshLibrary: true });
      return record;
    },
    [handleOpenDocument]
  );

  const moveActiveDocument = useCallback(
    async (destinationFolderId: string) => {
      if (!activeDocument) {
        setStatusMessage("Open a document before moving it.");
        return null;
      }

      debugAction("library.move-document-flow", {
        documentId: activeDocument.document.id
      });

      const moved = await moveDocument(activeDocument.document.id, destinationFolderId);
      await handleOpenDocument(moved.id, {
        refreshLibrary: true,
        targetMode: workspaceMode === "book" ? "book" : "reader"
      });
      return moved;
    },
    [activeDocument, handleOpenDocument, workspaceMode]
  );

  const moveDocumentInLibrary = useCallback(
    async (documentId: string, destinationFolderId: string) => {
      const moved = await moveDocument(documentId, destinationFolderId);
      await refreshLibraryState();
      if (activeDocumentId === documentId) {
        await syncActiveDocument({ preserveSelectedCollectionId: true });
      }
      setStatusMessage(`Moved ${moved.title}.`);
      return moved;
    },
    [activeDocumentId, refreshLibraryState, syncActiveDocument]
  );

  const importDocumentsToCollection = useCallback(
    async (sourcePaths: string[], destinationFolderId: string) => {
      const uniqueSourcePaths = Array.from(new Set(sourcePaths));
      const imported = [] as DocumentRecord[];
      for (const sourcePath of uniqueSourcePaths) {
        imported.push(await importPdf(sourcePath, destinationFolderId));
      }
      await refreshLibraryState();
      setSelectedCollectionId(destinationFolderId);
      setSelectedLibrarySection("collections");
      setWorkspaceMode("collection");
      if (imported.length === 1) {
        setStatusMessage(`Imported ${imported[0].title}.`);
      } else if (imported.length > 1) {
        setStatusMessage(`Imported ${imported.length} PDFs.`);
      }
      return imported;
    },
    [refreshLibraryState]
  );

  const reorderLibraryCollections = useCallback(async (collectionIds: string[]) => {
    const tree = await reorderCollections(collectionIds);
    setLibraryTree(tree);
    return tree;
  }, []);

  const reorderDocumentsInCollection = useCallback(
    async (collectionId: string, documentIds: string[]) => {
      const tree = await reorderCollectionDocuments(collectionId, documentIds);
      setLibraryTree(tree);
      return tree;
    },
    []
  );

  const renameActiveDocument = useCallback(
    async (newName: string) => {
      if (!activeDocument) {
        setStatusMessage("Open a document before renaming it.");
        return null;
      }

      debugAction("library.rename-document-flow", {
        documentId: activeDocument.document.id
      });

      const renamed = await renameDocument(activeDocument.document.id, newName);
      await handleOpenDocument(renamed.id, {
        refreshLibrary: true,
        targetMode: workspaceMode === "book" ? "book" : "reader"
      });
      setStatusMessage(`Renamed to ${renamed.fileName}.`);
      return renamed;
    },
    [activeDocument, handleOpenDocument, workspaceMode]
  );

  const renameCollection = useCallback(
    async (collectionId: string, newName: string) => {
      const renamed = await renameFolder(collectionId, newName);
      await refreshLibraryState({ rescan: true });
      setSelectedCollectionId(renamed.id);
      await syncActiveDocument();
      setStatusMessage(`Renamed collection to ${renamed.name}.`);
      return renamed;
    },
    [refreshLibraryState, syncActiveDocument]
  );

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      const deletedIndex = collections.findIndex((collection) => collection.folder.id === collectionId);
      const nextSelectedCollectionId =
        deletedIndex === -1
          ? selectedCollectionId
          : selectedCollectionId === collectionId
            ? collections[deletedIndex + 1]?.folder.id ??
              collections[deletedIndex - 1]?.folder.id ??
              null
            : selectedCollectionId;

      const deleted = await deleteFolder(collectionId);
      await refreshLibraryState({ rescan: true });
      setSelectedCollectionId(nextSelectedCollectionId);
      setSelectedLibrarySection("collections");
      setWorkspaceMode("collection");
      setStatusMessage(`Deleted collection ${deleted.name}.`);
      return deleted;
    },
    [collections, refreshLibraryState, selectedCollectionId]
  );

  const renameDocumentInLibrary = useCallback(
    async (documentId: string, newName: string) => {
      const renamed = await renameDocument(documentId, newName);
      await refreshLibraryState({ rescan: true });
      setSelectedCollectionId(renamed.folderId);
      if (activeDocumentId === documentId) {
        await handleOpenDocument(renamed.id, {
          refreshLibrary: false,
          targetMode: workspaceMode === "book" ? "book" : "reader"
        });
      }
      return renamed;
    },
    [activeDocumentId, handleOpenDocument, refreshLibraryState, workspaceMode]
  );

  const deleteDocumentInLibrary = useCallback(
    async (documentId: string) => {
      const deletingActiveDocument = activeDocumentId === documentId;
      if (deletingActiveDocument) {
        resetOpenDocument();
      }
      const deleted = await deleteDocument(documentId);
      await refreshLibraryState({ rescan: true });
      if (deletingActiveDocument) {
        setSelectedLibrarySection("collections");
        setWorkspaceMode("collection");
      }
      setStatusMessage(`Deleted ${deleted.title}.`);
      return deleted;
    },
    [activeDocumentId, refreshLibraryState, resetOpenDocument]
  );

  const showDocumentInFolder = useCallback(async (documentId: string) => {
    await showDocumentInExplorer(documentId);
  }, []);

  const getLibraryDocumentDeleteState = useCallback(async (documentId: string) => {
    return getDocumentDeleteState(documentId);
  }, []);

  const createStandaloneNoteInWorkspace = useCallback(async () => {
    const note = await createStandaloneNote();
    await refreshStandaloneNotes();
    setSelectedLibrarySection("notes");
    setActiveStandaloneNoteIdState(note.id);
    setWorkspaceModeState("notes");
    setStatusMessage(`Created ${note.title}.`);
    return note;
  }, [refreshStandaloneNotes]);

  const renameStandaloneNoteInLibrary = useCallback(
    async (noteId: string, title: string) => {
      const renamed = await renameStandaloneNote(noteId, title);
      await refreshStandaloneNotes();
      setStatusMessage(`Renamed note to ${renamed.title}.`);
      return renamed;
    },
    [refreshStandaloneNotes]
  );

  const deleteStandaloneNoteInLibrary = useCallback(
    async (noteId: string) => {
      const deletingActiveStandaloneNote = activeStandaloneNoteId === noteId;
      const deleted = await deleteStandaloneNote(noteId);
      const nextNotes = await refreshStandaloneNotes();
      const nextActiveStandaloneNoteId =
        deletingActiveStandaloneNote && nextNotes.length > 0
          ? nextNotes[0]?.id ?? null
          : deletingActiveStandaloneNote
            ? null
            : activeStandaloneNoteId;

      setActiveStandaloneNoteIdState(nextActiveStandaloneNoteId);
      if (selectedLibrarySection === "notes" && nextNotes.length === 0) {
        setWorkspaceModeState("notes");
      }
      setStatusMessage(`Deleted ${deleted.title}.`);
      return deleted;
    },
    [activeStandaloneNoteId, refreshStandaloneNotes, selectedLibrarySection]
  );

  const getStandaloneLibraryNoteDeleteState = useCallback(async (noteId: string) => {
    return getStandaloneNoteDeleteState(noteId);
  }, []);

  const removeActiveDocument = useCallback(
    async (destinationDirectory: string) => {
      if (!activeDocument) {
        setStatusMessage("Open a document before removing it from the library.");
        return null;
      }

      await removeFromLibrary(activeDocument.document.id, destinationDirectory);
      resetOpenDocument();
      await refreshLibraryState({ rescan: true });
      setStatusMessage("Moved the PDF out of the library without deleting it.");
      return activeDocument.document.id;
    },
    [activeDocument, refreshLibraryState, resetOpenDocument]
  );

  const rescanLibraryState = useCallback(async () => {
    await runDebugProcess("library.rescan-flow", {}, async () => {
      await refreshLibraryState({ rescan: true });
      await syncActiveDocument();
      setStatusMessage("Rescanned the library.");
    });
  }, [refreshLibraryState, syncActiveDocument]);

  const changeLibraryRootState = useCallback(
    async (newRoot: string, options?: { moveExisting?: boolean }) => {
      const moveExisting = Boolean(options?.moveExisting);
      return runDebugProcess(
        "library.change-root-flow",
        {
          moveExisting,
          newRoot
        },
        async () => {
          const resolvedRoot = await setLibraryRoot(newRoot, moveExisting);
          await refreshLibraryState({ rescan: true });
          await syncActiveDocument({ preserveSelectedCollectionId: true });
          setStatusMessage(
            moveExisting
              ? "Moved the library to the new folder."
              : "Changed the library folder."
          );
          return resolvedRoot;
        }
      );
    },
    [refreshLibraryState, setStatusMessage, syncActiveDocument]
  );

  const viewerOrStatus = useCallback(() => {
    if (!viewerApiRef.current) {
      setStatusMessage("Open a document to use reader commands.");
      return null;
    }
    return viewerApiRef.current;
  }, []);

  const goToReaderPage = useCallback(
    (page: number) => {
      if (!viewerApiRef.current) {
        setStatusMessage("Open a document to use reader commands.");
        return;
      }

      viewerApiRef.current.goToPage(page);
    },
    []
  );

  return {
    libraryTree,
    libraryRoot,
    recentDocuments,
    standaloneNotes,
    activeDocument,
    activeStandaloneNote,
    activeStandaloneNoteId,
    readerState,
    viewerSnapshot,
    outlineItems,
    statusMessage,
    workspaceMode,
    selectedLibrarySection,
    activeReaderSession,
    pendingReaderOpenSessionId,
    selectedCollectionId,
    selectedCollection,
    collectionOptions,
    activeDocumentId,
    viewerApiRef,
    viewerApi,
    setWorkspaceMode,
    enterBookMode,
    showCollectionsWorkspace,
    setSelectedCollectionId: selectCollectionInLibrary,
    setStatusMessage,
    handleViewerSnapshotChange,
    handleViewerOutlineChange,
    handleViewerStateChange,
    handleViewerStatusChange,
    registerViewerApi,
    refreshLibraryState,
    refreshRecentDocuments,
    refreshStandaloneNotes,
    resetOpenDocument,
    handleOpenDocument,
    syncActiveDocument,
    createCollection,
    createStandaloneNoteInWorkspace,
    deleteStandaloneNoteInLibrary,
    enterNotesMode,
    getStandaloneLibraryNoteDeleteState,
    importDocumentToCollection,
    importDocumentsToCollection,
    moveActiveDocument,
    moveDocumentInLibrary,
    openStandaloneNoteInWorkspace,
    renameActiveDocument,
    renameCollection,
    renameStandaloneNoteInLibrary,
    reorderLibraryCollections,
    reorderDocumentsInCollection,
    deleteCollection,
    renameDocumentInLibrary,
    deleteDocumentInLibrary,
    selectNotesLibrary,
    showDocumentInFolder,
    getLibraryDocumentDeleteState,
    removeActiveDocument,
    rescanLibraryState,
    changeLibraryRootState,
    viewerOrStatus,
    goToReaderPage
  };
}
