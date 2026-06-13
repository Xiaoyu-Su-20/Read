import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createFolder,
  deleteFolder,
  getLibraryRoot,
  importPdf,
  listLibrary,
  listRecentDocuments,
  moveDocument,
  openDocument,
  removeFromLibrary,
  renameDocument,
  renameFolder,
  rescanLibrary
} from "../api";
import { sortRecentDocuments } from "../commands";
import { debugAction, runDebugProcess } from "../debugLog";
import { ROOT_FOLDER_ID, type DocumentPayload, type DocumentRecord, type DocumentState, type FolderTreeNode, type OutlineItem, type ViewerApi, type ViewerSnapshot } from "../types";
import { toCollectionOptions } from "./helpers";

type OpenDocumentOptions = {
  refreshLibrary?: boolean;
};

export function useWorkspaceController() {
  const [libraryTree, setLibraryTree] = useState<FolderTreeNode | null>(null);
  const [libraryRoot, setLibraryRootPath] = useState("");
  const [recentDocuments, setRecentDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocument, setActiveDocument] = useState<DocumentPayload | null>(null);
  const [readerState, setReaderState] = useState<DocumentState | null>(null);
  const [viewerSnapshot, setViewerSnapshot] = useState<ViewerSnapshot>({
    currentPage: 1,
    pageCount: 0,
    zoom: 1
  });
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [workspaceMode, setWorkspaceMode] = useState<"reader" | "collection">("reader");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  const viewerApiRef = useRef<ViewerApi | null>(null);

  const collections = libraryTree?.folders ?? [];
  const selectedCollection = useMemo(
    () =>
      collections.find((collection) => collection.folder.id === selectedCollectionId) ??
      collections[0] ??
      null,
    [collections, selectedCollectionId]
  );
  const collectionOptions = useMemo(() => toCollectionOptions(collections), [collections]);
  const activeDocumentId = activeDocument?.document.id ?? null;

  const refreshRecentDocuments = useCallback(async () => {
    return runDebugProcess("app.refresh-recent-documents", {}, async () => {
      const recents = await listRecentDocuments();
      setRecentDocuments(sortRecentDocuments(recents));
    });
  }, []);

  const refreshLibraryState = useCallback(async (options?: { rescan?: boolean }) => {
    return runDebugProcess(
      "app.refresh-library-state",
      {
        rescan: Boolean(options?.rescan)
        },
        async () => {
          const tree = await (options?.rescan ? rescanLibrary() : listLibrary());
          const [recents, root] = await Promise.all([listRecentDocuments(), getLibraryRoot()]);
          setLibraryTree(tree);
          setRecentDocuments(sortRecentDocuments(recents));
          setLibraryRootPath(root);
        }
      );
  }, []);

  const resetOpenDocument = useCallback(() => {
    debugAction("app.reset-open-document");
    setActiveDocument(null);
    setReaderState(null);
    setOutlineItems([]);
    setViewerSnapshot({
      currentPage: 1,
      pageCount: 0,
      zoom: 1
    });
  }, []);

  useEffect(() => {
    void refreshLibraryState().catch((error) => {
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
  }, []);

  const handleOpenDocument = useCallback(
    async (documentId: string, options?: OpenDocumentOptions) => {
      await runDebugProcess(
        "app.open-document",
        {
          documentId,
          refreshLibrary: Boolean(options?.refreshLibrary)
        },
        async () => {
          const payload = await openDocument(documentId);
          setActiveDocument(payload);
          setReaderState(payload.state);
          setSelectedCollectionId(payload.document.folderId);
          setStatusMessage(`Opened ${payload.document.title}.`);
          setWorkspaceMode("reader");
          if (options?.refreshLibrary) {
            await refreshLibraryState();
          } else {
            await refreshRecentDocuments();
          }
        }
      );
    },
    [refreshLibraryState, refreshRecentDocuments]
  );

  const syncActiveDocument = useCallback(async () => {
    if (!activeDocument) {
      return;
    }

    try {
      await runDebugProcess(
        "app.sync-active-document",
        {
          documentId: activeDocument.document.id
        },
        async () => {
          const payload = await openDocument(activeDocument.document.id);
          setActiveDocument(payload);
          setReaderState(payload.state);
          setSelectedCollectionId(payload.document.folderId);
          await refreshRecentDocuments();
        }
      );
    } catch {
      resetOpenDocument();
    }
  }, [activeDocument, refreshRecentDocuments, resetOpenDocument]);

  const createCollection = useCallback(
    async (name: string) => {
      debugAction("library.create-collection-flow", {
        name
      });
      const folder = await createFolder(name, ROOT_FOLDER_ID);
      await refreshLibraryState();
      setSelectedCollectionId(folder.id);
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
      await handleOpenDocument(moved.id, { refreshLibrary: true });
      return moved;
    },
    [activeDocument, handleOpenDocument]
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
      await handleOpenDocument(renamed.id, { refreshLibrary: true });
      setStatusMessage(`Renamed to ${renamed.fileName}.`);
      return renamed;
    },
    [activeDocument, handleOpenDocument]
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
        await handleOpenDocument(renamed.id, { refreshLibrary: false });
      }
      return renamed;
    },
    [activeDocumentId, handleOpenDocument, refreshLibraryState]
  );

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
    activeDocument,
    readerState,
    viewerSnapshot,
    outlineItems,
    statusMessage,
    workspaceMode,
    selectedCollectionId,
    selectedCollection,
    collectionOptions,
    activeDocumentId,
    viewerApiRef,
    setWorkspaceMode,
    setSelectedCollectionId,
    setStatusMessage,
    handleViewerSnapshotChange,
    handleViewerOutlineChange,
    handleViewerStateChange,
    handleViewerStatusChange,
    registerViewerApi,
    refreshLibraryState,
    refreshRecentDocuments,
    resetOpenDocument,
    handleOpenDocument,
    syncActiveDocument,
    createCollection,
    importDocumentToCollection,
    moveActiveDocument,
    renameActiveDocument,
    renameCollection,
    deleteCollection,
    renameDocumentInLibrary,
    removeActiveDocument,
    rescanLibraryState,
    viewerOrStatus,
    goToReaderPage
  };
}
