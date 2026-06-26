import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  filterPdfPaths,
  moveIdWithinOrder,
  resolveVerticalDropTarget,
  type DropPosition,
  type VerticalDropLayout
} from "../lib/collectionOrdering";
import {
  buildDocumentMenuEntries,
  resolveDocumentMenuAction,
  type DocumentMenuView
} from "../lib/collectionDocumentMenu";
import { debugAction, debugLocalAction } from "../lib/debugLog";
import type {
  DocumentDeleteState,
  DocumentRecord,
  FolderTreeNode,
  NoteDeleteState,
  NoteIndexEntry
} from "../lib/types";
import { usePointerReorder, type PointerReorderSnapshot } from "../lib/usePointerReorder";

function startupTrace(step: string, fields: Record<string, unknown> = {}) {
  const payload = {
    step,
    epochMs: Date.now(),
    navigationMs: Math.round(performance.now()),
    ...fields
  };
  console.info(`[CR-STARTUP][collection-view] ${step}`, payload);
  debugLocalAction(`frontend.startup.collection-view.${step}`, payload);
  debugAction(`frontend.startup.collection-view.${step}`, payload);
}

startupTrace("module-loaded");
const appWindow = getCurrentWindow();

type CollectionViewRefreshProps = {
  tree: FolderTreeNode | null;
  selectedLibrarySection: "collections" | "notes";
  selectedCollectionId: string | null;
  onSelectCollection: (collectionId: string) => void;
  standaloneNotes: NoteIndexEntry[];
  activeStandaloneNoteId: string | null;
  onSelectNotes: () => void;
  onCreateStandaloneNote: () => void | Promise<void>;
  onOpenStandaloneNote: (noteId: string) => void | Promise<void>;
  onRenameStandaloneNote: (noteId: string, nextTitle: string) => void | Promise<void>;
  onDeleteStandaloneNote: (noteId: string) => void | Promise<void>;
  onGetStandaloneNoteDeleteState: (noteId: string) => Promise<NoteDeleteState>;
  onCreateCollection: () => void | Promise<void>;
  onChangeLibraryRoot: () => void | Promise<void>;
  onRenameCollection: (collectionId: string, nextName: string) => void | Promise<void>;
  onDeleteCollection: (collectionId: string) => void | Promise<void>;
  onOpenDocument: (documentId: string, targetMode?: "reader" | "book") => void | Promise<void>;
  onRenameDocument: (documentId: string, nextName: string) => void | Promise<void>;
  onPromptImportCollection: (collectionId: string) => void | Promise<void>;
  onImportDocuments: (collectionId: string, sourcePaths: string[]) => void | Promise<void>;
  onMoveDocumentToCollection: (
    documentId: string,
    destinationCollectionId: string
  ) => void | Promise<void>;
  onDeleteDocument: (documentId: string) => void | Promise<void>;
  onShowDocumentInFolder: (documentId: string) => void | Promise<void>;
  onGetDocumentDeleteState: (documentId: string) => Promise<DocumentDeleteState>;
  onReorderCollections: (collectionIds: string[]) => void | Promise<void>;
  onReorderDocuments: (collectionId: string, documentIds: string[]) => void | Promise<void>;
  onShowStatus: (message: string) => void;
};

type CollectionMenuAnchor = {
  collectionId: string;
  source: "header" | "row";
} | null;

type FloatingMenuPosition = {
  left: number;
  placement: "above" | "below";
  top: number;
} | null;

type OpenDocumentMenuState = {
  documentId: string;
  view: DocumentMenuView;
} | null;

type OpenStandaloneNoteMenuState = {
  noteId: string;
} | null;

type InternalPointerDragPayload =
  | {
      kind: "collection";
      collectionId: string;
      label: string;
    }
  | {
      kind: "book";
      collectionId: string;
      documentId: string;
      label: string;
    };

type NativeDropTarget =
  | {
      kind: "collection-row";
      collectionId: string;
    }
  | {
      kind: "import-panel";
      collectionId: string;
    }
  | null;

type DropIndicator = {
  position: DropPosition;
  targetId: string;
} | null;

type DragPreview = {
  kind: "collection" | "book";
  label: string;
  x: number;
  y: number;
} | null;

type ScrollbarState = {
  thumbHeight: number;
  thumbTop: number;
  visible: boolean;
};

function documentBaseName(fileName: string) {
  return fileName.replace(/\.pdf$/i, "");
}

function nextDocumentName(value: string, originalFileName: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return originalFileName;
  }

  const baseName = trimmed.replace(/\.pdf$/i, "");
  return `${baseName}.pdf`;
}

function pointInsideRect(clientX: number, clientY: number, element: HTMLElement | null) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, button, textarea, select, [contenteditable='true']"))
  );
}

function isSelfKeyboardActivation(event: React.KeyboardEvent<HTMLElement>) {
  return event.target === event.currentTarget;
}

function ordersMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyOrder<T>(entries: T[], orderedIds: string[] | null, getId: (entry: T) => string) {
  if (!orderedIds) {
    return entries;
  }

  const entriesById = new Map(entries.map((entry) => [getId(entry), entry]));
  const orderedEntries: T[] = [];

  for (const id of orderedIds) {
    const entry = entriesById.get(id);
    if (!entry) {
      continue;
    }

    orderedEntries.push(entry);
    entriesById.delete(id);
  }

  return [...orderedEntries, ...entriesById.values()];
}

function getVerticalLayouts(ids: string[], refs: Map<string, HTMLDivElement>): VerticalDropLayout[] {
  return ids.flatMap((id) => {
    const element = refs.get(id);
    if (!element) {
      return [];
    }

    const rect = element.getBoundingClientRect();
    return [
      {
        id,
        top: rect.top,
        bottom: rect.bottom
      }
    ];
  });
}

function updateScrollbarStateIfChanged(
  setState: Dispatch<SetStateAction<ScrollbarState>>,
  nextState: ScrollbarState
) {
  setState((currentState) => {
    if (
      currentState.visible === nextState.visible &&
      Math.abs(currentState.thumbHeight - nextState.thumbHeight) < 0.5 &&
      Math.abs(currentState.thumbTop - nextState.thumbTop) < 0.5
    ) {
      return currentState;
    }

    return nextState;
  });
}

export default function CollectionViewRefresh({
  tree,
  selectedLibrarySection,
  selectedCollectionId,
  onSelectCollection,
  standaloneNotes,
  activeStandaloneNoteId,
  onSelectNotes,
  onCreateStandaloneNote,
  onOpenStandaloneNote,
  onRenameStandaloneNote,
  onDeleteStandaloneNote,
  onGetStandaloneNoteDeleteState,
  onCreateCollection,
  onChangeLibraryRoot,
  onRenameCollection,
  onDeleteCollection,
  onOpenDocument,
  onRenameDocument,
  onPromptImportCollection,
  onImportDocuments,
  onMoveDocumentToCollection,
  onDeleteDocument,
  onShowDocumentInFolder,
  onGetDocumentDeleteState,
  onReorderCollections,
  onReorderDocuments,
  onShowStatus
}: CollectionViewRefreshProps) {
  const collections = tree?.folders ?? [];
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingCollectionValue, setEditingCollectionValue] = useState("");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [editingDocumentValue, setEditingDocumentValue] = useState("");
  const [editingStandaloneNoteId, setEditingStandaloneNoteId] = useState<string | null>(null);
  const [editingStandaloneNoteValue, setEditingStandaloneNoteValue] = useState("");
  const [openCollectionMenu, setOpenCollectionMenu] = useState<CollectionMenuAnchor>(null);
  const [openDocumentMenu, setOpenDocumentMenu] = useState<OpenDocumentMenuState>(null);
  const [openNotesSectionMenu, setOpenNotesSectionMenu] = useState(false);
  const [openStandaloneNoteMenu, setOpenStandaloneNoteMenu] =
    useState<OpenStandaloneNoteMenuState>(null);
  const [documentDeleteState, setDocumentDeleteState] = useState<DocumentDeleteState | null>(null);
  const [standaloneNoteDeleteState, setStandaloneNoteDeleteState] =
    useState<NoteDeleteState | null>(null);
  const [optimisticCollectionOrder, setOptimisticCollectionOrder] = useState<string[] | null>(
    null
  );
  const [optimisticBookOrder, setOptimisticBookOrder] = useState<{
    collectionId: string;
    ids: string[];
  } | null>(null);
  const [collectionDropIndicator, setCollectionDropIndicator] = useState<DropIndicator>(null);
  const [bookDropIndicator, setBookDropIndicator] = useState<DropIndicator>(null);
  const [collectionTransferTargetId, setCollectionTransferTargetId] = useState<string | null>(
    null
  );
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);
  const [nativeDropTarget, setNativeDropTarget] = useState<NativeDropTarget>(null);
  const suppressCollectionActivationUntilRef = useRef(0);
  const suppressBookActivationUntilRef = useRef(0);
  const skipNextCollectionSelectionRef = useRef(false);
  const skipNextDocumentActivationRef = useRef(false);
  const skipNextStandaloneNoteActivationRef = useRef(false);
  const collectionReorderVersionRef = useRef(0);
  const bookReorderVersionRef = useRef(0);
  const collectionMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const documentMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const standaloneNoteMenuButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const collectionRowRefs = useRef(new Map<string, HTMLDivElement>());
  const bookRowRefs = useRef(new Map<string, HTMLDivElement>());
  const collectionRowsContainerRef = useRef<HTMLDivElement | null>(null);
  const notesSectionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const collectionSidebarScrollbarRef = useRef<HTMLDivElement | null>(null);
  const collectionSidebarScrollbarMetricsRef = useRef({
    thumbHeight: 0,
    maxScroll: 0,
    maxThumbTop: 0
  });
  const collectionSidebarScrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const collectionMainRef = useRef<HTMLElement | null>(null);
  const collectionMainScrollbarRef = useRef<HTMLDivElement | null>(null);
  const collectionMainScrollbarMetricsRef = useRef({
    thumbHeight: 0,
    maxScroll: 0,
    maxThumbTop: 0
  });
  const collectionMainScrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const collectionViewRef = useRef<HTMLElement | null>(null);
  const floatingCollectionMenuRef = useRef<HTMLDivElement | null>(null);
  const floatingDocumentMenuRef = useRef<HTMLDivElement | null>(null);
  const floatingNotesSectionMenuRef = useRef<HTMLDivElement | null>(null);
  const floatingStandaloneNoteMenuRef = useRef<HTMLDivElement | null>(null);
  const headerCollectionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const bookListRef = useRef<HTMLDivElement | null>(null);
  const importPanelRef = useRef<HTMLDivElement | null>(null);
  const [collectionSidebarScrollbarState, setCollectionSidebarScrollbarState] = useState<ScrollbarState>({
    thumbHeight: 0,
    thumbTop: 0,
    visible: false
  });
  const [collectionMainScrollbarState, setCollectionMainScrollbarState] = useState<ScrollbarState>({
    thumbHeight: 0,
    thumbTop: 0,
    visible: false
  });
  const [floatingCollectionMenuPosition, setFloatingCollectionMenuPosition] =
    useState<FloatingMenuPosition>(null);
  const [floatingDocumentMenuPosition, setFloatingDocumentMenuPosition] =
    useState<FloatingMenuPosition>(null);
  const [floatingNotesSectionMenuPosition, setFloatingNotesSectionMenuPosition] =
    useState<FloatingMenuPosition>(null);
  const [floatingStandaloneNoteMenuPosition, setFloatingStandaloneNoteMenuPosition] =
    useState<FloatingMenuPosition>(null);

  const displayedCollections = applyOrder(
    collections,
    optimisticCollectionOrder,
    (collection) => collection.folder.id
  );
  const selectedCollection =
    displayedCollections.find((collection) => collection.folder.id === selectedCollectionId) ??
    displayedCollections[0] ??
    null;
  const notesSectionSelected = selectedLibrarySection === "notes";
  const activeStandaloneNote =
    standaloneNotes.find((note) => note.id === activeStandaloneNoteId) ?? null;
  const optimisticSelectedBookOrderIds =
    optimisticBookOrder &&
    optimisticBookOrder.collectionId === selectedCollection?.folder.id
      ? optimisticBookOrder.ids
      : null;
  const books = applyOrder(
    selectedCollection?.documents ?? [],
    optimisticSelectedBookOrderIds,
    (document) => document.id
  );
  const openMenuDocument =
    openDocumentMenu ? books.find((document) => document.id === openDocumentMenu.documentId) ?? null : null;
  const openMenuStandaloneNote =
    openStandaloneNoteMenu
      ? standaloneNotes.find((note) => note.id === openStandaloneNoteMenu.noteId) ?? null
      : null;
  const documentMenuEntries =
    openDocumentMenu && openMenuDocument
      ? buildDocumentMenuEntries({
          view: openDocumentMenu.view,
          currentCollectionId: openMenuDocument.folderId,
          collections: displayedCollections.map((collection) => ({
            id: collection.folder.id,
            name: collection.folder.name
          })),
          deleteState: documentDeleteState
        })
      : [];
  const displayedCollectionsRef = useRef(displayedCollections);
  const selectedCollectionRef = useRef(selectedCollection);
  const onImportDocumentsRef = useRef(onImportDocuments);
  const onShowStatusRef = useRef(onShowStatus);

  displayedCollectionsRef.current = displayedCollections;
  selectedCollectionRef.current = selectedCollection;
  onImportDocumentsRef.current = onImportDocuments;
  onShowStatusRef.current = onShowStatus;

  function suppressCollectionActivation() {
    suppressCollectionActivationUntilRef.current = window.performance.now() + 250;
  }

  function shouldSuppressCollectionActivation() {
    return window.performance.now() < suppressCollectionActivationUntilRef.current;
  }

  function suppressBookActivation() {
    suppressBookActivationUntilRef.current = window.performance.now() + 250;
  }

  function shouldSuppressBookActivation() {
    return window.performance.now() < suppressBookActivationUntilRef.current;
  }

  function getCollectionMenuAnchorElement() {
    if (!openCollectionMenu) {
      return null;
    }

    if (openCollectionMenu.source === "header") {
      return headerCollectionMenuButtonRef.current;
    }

    return collectionMenuButtonRefs.current.get(openCollectionMenu.collectionId) ?? null;
  }

  function getDocumentMenuAnchorElement() {
    if (!openDocumentMenu) {
      return null;
    }

    return documentMenuButtonRefs.current.get(openDocumentMenu.documentId) ?? null;
  }

  function getNotesSectionMenuAnchorElement() {
    return notesSectionMenuButtonRef.current;
  }

  function getStandaloneNoteMenuAnchorElement() {
    if (!openStandaloneNoteMenu) {
      return null;
    }

    return standaloneNoteMenuButtonRefs.current.get(openStandaloneNoteMenu.noteId) ?? null;
  }

  function closeCollectionMenu() {
    setOpenCollectionMenu(null);
    setFloatingCollectionMenuPosition(null);
  }

  function closeDocumentMenu() {
    setOpenDocumentMenu(null);
    setDocumentDeleteState(null);
    setFloatingDocumentMenuPosition(null);
  }

  function closeNotesSectionMenu() {
    setOpenNotesSectionMenu(false);
    setFloatingNotesSectionMenuPosition(null);
  }

  function closeStandaloneNoteMenu() {
    setOpenStandaloneNoteMenu(null);
    setStandaloneNoteDeleteState(null);
    setFloatingStandaloneNoteMenuPosition(null);
  }

  function resolveFloatingMenuPosition(
    anchorElement: HTMLElement | null,
    menuElement: HTMLDivElement | null
  ): FloatingMenuPosition {
    const overlayRoot = collectionViewRef.current;
    if (!anchorElement) {
      return null;
    }
    if (!overlayRoot) {
      return null;
    }

    const anchorRect = anchorElement.getBoundingClientRect();
    const overlayRootRect = overlayRoot.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 8;
    const menuWidth = menuElement?.offsetWidth ?? 232;
    const menuHeight = menuElement?.offsetHeight ?? 176;
    const left = Math.max(
      viewportPadding,
      Math.min(
        anchorRect.right - overlayRootRect.left - menuWidth,
        overlayRootRect.width - menuWidth - viewportPadding
      )
    );
    const availableBelow =
      overlayRootRect.bottom - anchorRect.bottom - gap - viewportPadding;
    const availableAbove = anchorRect.top - overlayRootRect.top - gap - viewportPadding;
    const fitsBelow = availableBelow >= menuHeight;
    const fitsAbove = availableAbove >= menuHeight;
    const placeAbove = !fitsBelow && (fitsAbove || availableAbove > availableBelow);
    const top = placeAbove
      ? Math.max(
          viewportPadding,
          anchorRect.top - overlayRootRect.top - menuHeight - gap
        )
      : Math.min(
          anchorRect.bottom - overlayRootRect.top + gap,
          overlayRootRect.height - menuHeight - viewportPadding
        );

    return {
      left,
      placement: placeAbove ? "above" : "below",
      top
    };
  }

  function updateFloatingCollectionMenuPosition(anchorOverride?: HTMLElement | null) {
    setFloatingCollectionMenuPosition(
      resolveFloatingMenuPosition(
        anchorOverride ?? getCollectionMenuAnchorElement(),
        floatingCollectionMenuRef.current
      )
    );
  }

  function updateFloatingDocumentMenuPosition(anchorOverride?: HTMLElement | null) {
    setFloatingDocumentMenuPosition(
      resolveFloatingMenuPosition(
        anchorOverride ?? getDocumentMenuAnchorElement(),
        floatingDocumentMenuRef.current
      )
    );
  }

  function updateFloatingNotesSectionMenuPosition(anchorOverride?: HTMLElement | null) {
    setFloatingNotesSectionMenuPosition(
      resolveFloatingMenuPosition(
        anchorOverride ?? getNotesSectionMenuAnchorElement(),
        floatingNotesSectionMenuRef.current
      )
    );
  }

  function updateFloatingStandaloneNoteMenuPosition(anchorOverride?: HTMLElement | null) {
    setFloatingStandaloneNoteMenuPosition(
      resolveFloatingMenuPosition(
        anchorOverride ?? getStandaloneNoteMenuAnchorElement(),
        floatingStandaloneNoteMenuRef.current
      )
    );
  }

  function updateCollectionSidebarScrollbar() {
    const rowsElement = collectionRowsContainerRef.current;
    const scrollbarElement = collectionSidebarScrollbarRef.current;
    if (!rowsElement || !scrollbarElement) {
      return;
    }

    const trackHeight = Math.max(scrollbarElement.clientHeight, 0);
    const maxScroll = Math.max(rowsElement.scrollHeight - rowsElement.clientHeight, 0);

    if (trackHeight <= 0 || maxScroll <= 0) {
      collectionSidebarScrollbarMetricsRef.current = {
        thumbHeight: 0,
        maxScroll: 0,
        maxThumbTop: 0
      };
      updateScrollbarStateIfChanged(setCollectionSidebarScrollbarState, {
        thumbHeight: 0,
        thumbTop: 0,
        visible: false
      });
      return;
    }

    const thumbHeight = Math.max(
      36,
      trackHeight * (rowsElement.clientHeight / rowsElement.scrollHeight)
    );
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop =
      maxScroll === 0 ? 0 : (rowsElement.scrollTop / maxScroll) * maxThumbTop;

    collectionSidebarScrollbarMetricsRef.current = {
      thumbHeight,
      maxScroll,
      maxThumbTop
    };
    updateScrollbarStateIfChanged(setCollectionSidebarScrollbarState, {
      thumbHeight,
      thumbTop,
      visible: true
    });
  }

  function scrollCollectionSidebarToThumbTop(nextThumbTop: number) {
    const rowsElement = collectionRowsContainerRef.current;
    const { maxScroll, maxThumbTop } = collectionSidebarScrollbarMetricsRef.current;
    if (!rowsElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    rowsElement.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
  }

  function updateCollectionMainScrollbar() {
    const mainElement = collectionMainRef.current;
    const scrollbarElement = collectionMainScrollbarRef.current;
    if (!mainElement || !scrollbarElement) {
      return;
    }

    const trackHeight = Math.max(scrollbarElement.clientHeight, 0);
    const maxScroll = Math.max(mainElement.scrollHeight - mainElement.clientHeight, 0);

    if (trackHeight <= 0 || maxScroll <= 0) {
      collectionMainScrollbarMetricsRef.current = {
        thumbHeight: 0,
        maxScroll: 0,
        maxThumbTop: 0
      };
      updateScrollbarStateIfChanged(setCollectionMainScrollbarState, {
        thumbHeight: 0,
        thumbTop: 0,
        visible: false
      });
      return;
    }

    const thumbHeight = Math.max(
      36,
      trackHeight * (mainElement.clientHeight / mainElement.scrollHeight)
    );
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop =
      maxScroll === 0 ? 0 : (mainElement.scrollTop / maxScroll) * maxThumbTop;

    collectionMainScrollbarMetricsRef.current = {
      thumbHeight,
      maxScroll,
      maxThumbTop
    };
    updateScrollbarStateIfChanged(setCollectionMainScrollbarState, {
      thumbHeight,
      thumbTop,
      visible: true
    });
  }

  function scrollCollectionMainToThumbTop(nextThumbTop: number) {
    const mainElement = collectionMainRef.current;
    const { maxScroll, maxThumbTop } = collectionMainScrollbarMetricsRef.current;
    if (!mainElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    mainElement.scrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateCollectionSidebarScrollbar();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    displayedCollections.length,
    editingCollectionId,
    openCollectionMenu,
    openDocumentMenu,
    openNotesSectionMenu,
    openStandaloneNoteMenu,
    standaloneNotes.length
  ]);

  useEffect(() => {
    const rowsElement = collectionRowsContainerRef.current;
    if (!rowsElement) {
      return;
    }

    const handleResize = () => {
      updateCollectionSidebarScrollbar();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateCollectionSidebarScrollbar();
          });

    resizeObserver?.observe(rowsElement);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateCollectionMainScrollbar();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    selectedLibrarySection,
    selectedCollection?.folder.id,
    books.length,
    standaloneNotes.length,
    editingDocumentId,
    editingStandaloneNoteId,
    openCollectionMenu,
    openDocumentMenu,
    openStandaloneNoteMenu,
    nativeDropTarget
  ]);

  useEffect(() => {
    const mainElement = collectionMainRef.current;
    if (!mainElement) {
      return;
    }

    const handleResize = () => {
      updateCollectionMainScrollbar();
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateCollectionMainScrollbar();
          });

    resizeObserver?.observe(mainElement);
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeDrag = collectionSidebarScrollbarDragRef.current;
      const rowsElement = collectionRowsContainerRef.current;
      const { maxScroll, maxThumbTop } = collectionSidebarScrollbarMetricsRef.current;
      if (!activeDrag || !rowsElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      rowsElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
      updateCollectionSidebarScrollbar();
    }

    function handlePointerUp(event: PointerEvent) {
      if (collectionSidebarScrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }

      collectionSidebarScrollbarDragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const activeDrag = collectionMainScrollbarDragRef.current;
      const mainElement = collectionMainRef.current;
      const { maxScroll, maxThumbTop } = collectionMainScrollbarMetricsRef.current;
      if (!activeDrag || !mainElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      mainElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
      updateCollectionMainScrollbar();
    }

    function handlePointerUp(event: PointerEvent) {
      if (collectionMainScrollbarDragRef.current?.pointerId !== event.pointerId) {
        return;
      }

      collectionMainScrollbarDragRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, []);

  async function commitCollectionRename(options?: { skipNextSelection?: boolean }) {
    if (!editingCollectionId) {
      return;
    }

    const currentCollection =
      collections.find((collection) => collection.folder.id === editingCollectionId) ?? null;
    const nextName = editingCollectionValue.trim();
    const targetId = editingCollectionId;
    setEditingCollectionId(null);
    if (options?.skipNextSelection) {
      skipNextCollectionSelectionRef.current = true;
    }
    if (!nextName) {
      return;
    }
    if (currentCollection && nextName === currentCollection.folder.name) {
      return;
    }
    try {
      await onRenameCollection(targetId, nextName);
    } catch {
      setEditingCollectionId(targetId);
      setEditingCollectionValue(nextName);
      onShowStatus("Could not rename the collection.");
    }
  }

  async function commitDocumentRename(
    document: DocumentRecord,
    options?: { skipNextActivation?: boolean }
  ) {
    if (editingDocumentId !== document.id) {
      return;
    }

    const nextName = nextDocumentName(editingDocumentValue, document.fileName);
    suppressBookActivation();
    if (options?.skipNextActivation) {
      skipNextDocumentActivationRef.current = true;
    }
    setEditingDocumentId(null);
    if (nextName === document.fileName) {
      return;
    }
    try {
      await onRenameDocument(document.id, nextName);
    } catch {
      setEditingDocumentId(document.id);
      setEditingDocumentValue(documentBaseName(document.fileName));
      onShowStatus("Could not rename the PDF.");
    }
  }

  async function commitStandaloneNoteRename(
    note: NoteIndexEntry,
    options?: { skipNextActivation?: boolean }
  ) {
    if (editingStandaloneNoteId !== note.id) {
      return;
    }

    const nextTitle = editingStandaloneNoteValue.trim();
    suppressBookActivation();
    if (options?.skipNextActivation) {
      skipNextStandaloneNoteActivationRef.current = true;
    }
    setEditingStandaloneNoteId(null);
    if (!nextTitle || nextTitle === note.title) {
      return;
    }
    try {
      await onRenameStandaloneNote(note.id, nextTitle);
    } catch {
      setEditingStandaloneNoteId(note.id);
      setEditingStandaloneNoteValue(nextTitle);
      onShowStatus("Could not rename the note.");
    }
  }

  function resetPointerFeedback() {
    setCollectionDropIndicator(null);
    setBookDropIndicator(null);
    setCollectionTransferTargetId(null);
    setDragPreview(null);
  }

  function resolveCollectionReorderTarget(clientX: number, clientY: number) {
    if (!pointInsideRect(clientX, clientY, collectionRowsContainerRef.current)) {
      return null;
    }

    return resolveVerticalDropTarget(
      getVerticalLayouts(
        displayedCollections.map((collection) => collection.folder.id),
        collectionRowRefs.current
      ),
      clientY
    );
  }

  function resolveBookReorderTarget(clientX: number, clientY: number) {
    if (
      !selectedCollection ||
      !pointInsideRect(clientX, clientY, bookListRef.current)
    ) {
      return null;
    }

    return resolveVerticalDropTarget(
      getVerticalLayouts(
        books.map((document) => document.id),
        bookRowRefs.current
      ),
      clientY
    );
  }

  function resolveCollectionRowTargetAtPosition(clientX: number, clientY: number) {
    for (const collection of displayedCollections) {
      const element = collectionRowRefs.current.get(collection.folder.id) ?? null;
      if (!pointInsideRect(clientX, clientY, element)) {
        continue;
      }

      return collection.folder.id;
    }

    return null;
  }

  function resolveNativeDropTargetAtPosition(clientX: number, clientY: number): NativeDropTarget {
    const collectionId = resolveCollectionRowTargetAtPosition(clientX, clientY);
    if (collectionId) {
      return {
        kind: "collection-row",
        collectionId
      };
    }

    if (selectedCollection && pointInsideRect(clientX, clientY, importPanelRef.current)) {
      return {
        kind: "import-panel",
        collectionId: selectedCollection.folder.id
      };
    }

    return null;
  }

  function updatePointerFeedback(snapshot: PointerReorderSnapshot<InternalPointerDragPayload>) {
    setDragPreview({
      kind: snapshot.payload.kind,
      label: snapshot.payload.label,
      x: snapshot.clientX,
      y: snapshot.clientY
    });

    if (snapshot.payload.kind === "collection") {
      setBookDropIndicator(null);
      setCollectionTransferTargetId(null);
      setCollectionDropIndicator(
        resolveCollectionReorderTarget(snapshot.clientX, snapshot.clientY)
      );
      return;
    }

    if (snapshot.payload.collectionId === selectedCollection?.folder.id) {
      setBookDropIndicator(resolveBookReorderTarget(snapshot.clientX, snapshot.clientY));
    } else {
      setBookDropIndicator(null);
    }
    setCollectionDropIndicator(null);

    const hoveredCollectionId = resolveCollectionRowTargetAtPosition(
      snapshot.clientX,
      snapshot.clientY
    );
    setCollectionTransferTargetId(
      hoveredCollectionId && hoveredCollectionId !== snapshot.payload.collectionId
        ? hoveredCollectionId
        : null
    );
  }

  async function persistCollectionOrder(nextOrder: string[], previousOrder: string[]) {
    const operationVersion = collectionReorderVersionRef.current + 1;
    collectionReorderVersionRef.current = operationVersion;
    setOptimisticCollectionOrder(nextOrder);
    try {
      await onReorderCollections(nextOrder);
    } catch {
      if (collectionReorderVersionRef.current === operationVersion) {
        setOptimisticCollectionOrder(previousOrder);
        onShowStatus("Could not reorder collections.");
      }
    }
  }

  async function persistBookOrder(
    collectionId: string,
    nextOrder: string[],
    previousOrder: string[]
  ) {
    const operationVersion = bookReorderVersionRef.current + 1;
    bookReorderVersionRef.current = operationVersion;
    setOptimisticBookOrder({
      collectionId,
      ids: nextOrder
    });
    try {
      await onReorderDocuments(collectionId, nextOrder);
    } catch {
      if (bookReorderVersionRef.current === operationVersion) {
        setOptimisticBookOrder({
          collectionId,
          ids: previousOrder
        });
        onShowStatus("Could not reorder books.");
      }
    }
  }

  async function persistBookMove(
    documentId: string,
    destinationCollectionId: string,
    sourceCollectionId: string,
    previousOrder: string[]
  ) {
    const operationVersion = bookReorderVersionRef.current + 1;
    bookReorderVersionRef.current = operationVersion;
    setOptimisticBookOrder({
      collectionId: sourceCollectionId,
      ids: previousOrder.filter((id) => id !== documentId)
    });
    try {
      await onMoveDocumentToCollection(documentId, destinationCollectionId);
    } catch {
      if (bookReorderVersionRef.current === operationVersion) {
        setOptimisticBookOrder({
          collectionId: sourceCollectionId,
          ids: previousOrder
        });
        onShowStatus("Could not move the PDF.");
      }
    }
  }

  const { activeSessionRef, cancelDrag, createHandleProps } =
    usePointerReorder<InternalPointerDragPayload>({
    thresholdPx: 8,
    onDragStart(snapshot) {
      closeCollectionMenu();
      closeDocumentMenu();
      suppressCollectionActivation();
      suppressBookActivation();
      updatePointerFeedback(snapshot);
    },
    onDragMove(snapshot) {
      updatePointerFeedback(snapshot);
    },
    onDragEnd(snapshot, reason) {
      suppressCollectionActivation();
      suppressBookActivation();
      resetPointerFeedback();
      if (reason !== "drop") {
        return;
      }

      if (snapshot.payload.kind === "collection") {
        const currentOrder = displayedCollections.map((collection) => collection.folder.id);
        const target = resolveCollectionReorderTarget(snapshot.clientX, snapshot.clientY);
        if (!target) {
          return;
        }

        const nextOrder = moveIdWithinOrder(
          currentOrder,
          snapshot.payload.collectionId,
          target.targetId,
          target.position
        );
        if (ordersMatch(nextOrder, currentOrder)) {
          return;
        }

        void persistCollectionOrder(nextOrder, currentOrder);
        return;
      }

      const currentOrder = books.map((document) => document.id);
      const reorderTarget =
        snapshot.payload.collectionId === selectedCollection?.folder.id
          ? resolveBookReorderTarget(snapshot.clientX, snapshot.clientY)
          : null;
      if (reorderTarget) {
        const nextOrder = moveIdWithinOrder(
          currentOrder,
          snapshot.payload.documentId,
          reorderTarget.targetId,
          reorderTarget.position
        );
        if (!ordersMatch(nextOrder, currentOrder)) {
          void persistBookOrder(snapshot.payload.collectionId, nextOrder, currentOrder);
        }
        return;
      }

      const destinationCollectionId = resolveCollectionRowTargetAtPosition(
        snapshot.clientX,
        snapshot.clientY
      );
      if (
        !destinationCollectionId ||
        destinationCollectionId === snapshot.payload.collectionId
      ) {
        return;
      }

      void persistBookMove(
        snapshot.payload.documentId,
        destinationCollectionId,
        snapshot.payload.collectionId,
        currentOrder
      );
    }
    });

  useEffect(() => {
    startupTrace("component-mounted", {
      collectionCount: collections.length,
      selectedCollectionId
    });
    return () => {
      startupTrace("component-unmounted");
    };
  }, []);

  useEffect(() => {
    startupTrace("derived-state", {
      bookCount: books.length,
      collectionCount: displayedCollections.length,
      hasSelectedCollection: selectedCollection !== null,
      selectedCollectionId: selectedCollection?.folder.id ?? null
    });
  }, [books.length, displayedCollections.length, selectedCollection?.folder.id]);

  async function importDroppedPdfPaths(
    target: Exclude<NativeDropTarget, null>,
    paths: string[]
  ) {
    const pdfPaths = filterPdfPaths(paths);
    if (pdfPaths.length === 0) {
      if (paths.length > 0) {
        onShowStatus("Only PDF files can be imported.");
      }
      return;
    }

    await onImportDocuments(target.collectionId, pdfPaths);
  }

  function resolveNativeDropTargetAtPositionWithRefs(
    clientX: number,
    clientY: number
  ): NativeDropTarget {
    for (const collection of displayedCollectionsRef.current) {
      const element = collectionRowRefs.current.get(collection.folder.id) ?? null;
      if (!pointInsideRect(clientX, clientY, element)) {
        continue;
      }

      return {
        kind: "collection-row",
        collectionId: collection.folder.id
      };
    }

    const selectedCollectionSnapshot = selectedCollectionRef.current;
    if (selectedCollectionSnapshot && pointInsideRect(clientX, clientY, importPanelRef.current)) {
      return {
        kind: "import-panel",
        collectionId: selectedCollectionSnapshot.folder.id
      };
    }

    return null;
  }

  async function importDroppedPdfPathsWithRefs(
    target: Exclude<NativeDropTarget, null>,
    paths: string[]
  ) {
    const pdfPaths = filterPdfPaths(paths);
    if (pdfPaths.length === 0) {
      if (paths.length > 0) {
        onShowStatusRef.current("Only PDF files can be imported.");
      }
      return;
    }

    await onImportDocumentsRef.current(target.collectionId, pdfPaths);
  }

  useEffect(() => {
    if (
      optimisticCollectionOrder &&
      ordersMatch(
        optimisticCollectionOrder,
        collections.map((collection) => collection.folder.id)
      )
    ) {
      setOptimisticCollectionOrder(null);
    }
  }, [collections, optimisticCollectionOrder]);

  useEffect(() => {
    if (!optimisticBookOrder) {
      return;
    }

    const actualBooks =
      collections.find((collection) => collection.folder.id === optimisticBookOrder.collectionId)
        ?.documents ?? [];
    if (
      ordersMatch(
        optimisticBookOrder.ids,
        actualBooks.map((document) => document.id)
      )
    ) {
      setOptimisticBookOrder(null);
    }
  }, [collections, optimisticBookOrder]);

  useEffect(() => {
    document.body.classList.toggle("app-body--internal-pointer-drag", dragPreview !== null);
    return () => {
      document.body.classList.remove("app-body--internal-pointer-drag");
    };
  }, [dragPreview]);

  useEffect(() => {
    if (!openDocumentMenu) {
      return;
    }

    let cancelled = false;
    setDocumentDeleteState(null);
    void onGetDocumentDeleteState(openDocumentMenu.documentId)
      .then((state) => {
        if (!cancelled) {
          setDocumentDeleteState(state);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDocumentDeleteState({
            canDelete: false,
            reason: error instanceof Error ? error.message : "Unable to check note status."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onGetDocumentDeleteState, openDocumentMenu?.documentId]);

  useEffect(() => {
    if (!openStandaloneNoteMenu) {
      return;
    }

    let cancelled = false;
    setStandaloneNoteDeleteState(null);
    void onGetStandaloneNoteDeleteState(openStandaloneNoteMenu.noteId)
      .then((state) => {
        if (!cancelled) {
          setStandaloneNoteDeleteState(state);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStandaloneNoteDeleteState({
            canDelete: false,
            reason: error instanceof Error ? error.message : "Unable to check note status."
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onGetStandaloneNoteDeleteState, openStandaloneNoteMenu]);

  useEffect(() => {
    function handleWindowPointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".collection-row__actions, .collection-row__menu, .collection-header__actions, .book-row__actions, .book-row__menu, .notes-row__actions, .notes-row__menu, .collection-sidebar__section-header"
        )
      ) {
        return;
      }

      closeCollectionMenu();
      closeDocumentMenu();
      closeNotesSectionMenu();
      closeStandaloneNoteMenu();
    }

    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeCollectionMenu();
        closeDocumentMenu();
        closeNotesSectionMenu();
        closeStandaloneNoteMenu();
      }
    }

    window.addEventListener("pointerdown", handleWindowPointerDown, true);
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handleWindowPointerDown, true);
      window.removeEventListener("keydown", handleWindowKeyDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!openCollectionMenu) {
      setFloatingCollectionMenuPosition(null);
      return;
    }

    updateFloatingCollectionMenuPosition();

    function handleViewportChange(event?: Event) {
      if (
        event?.target instanceof Node &&
        floatingCollectionMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      updateFloatingCollectionMenuPosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [openCollectionMenu, displayedCollections.length]);

  useLayoutEffect(() => {
    if (!openDocumentMenu) {
      setFloatingDocumentMenuPosition(null);
      return;
    }

    updateFloatingDocumentMenuPosition();

    function handleViewportChange(event?: Event) {
      if (
        event?.target instanceof Node &&
        floatingDocumentMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      updateFloatingDocumentMenuPosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [documentDeleteState, documentMenuEntries.length, openDocumentMenu]);

  useLayoutEffect(() => {
    if (!openNotesSectionMenu) {
      setFloatingNotesSectionMenuPosition(null);
      return;
    }

    updateFloatingNotesSectionMenuPosition();

    function handleViewportChange(event?: Event) {
      if (
        event?.target instanceof Node &&
        floatingNotesSectionMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      updateFloatingNotesSectionMenuPosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [openNotesSectionMenu]);

  useLayoutEffect(() => {
    if (!openStandaloneNoteMenu) {
      setFloatingStandaloneNoteMenuPosition(null);
      return;
    }

    updateFloatingStandaloneNoteMenuPosition();

    function handleViewportChange(event?: Event) {
      if (
        event?.target instanceof Node &&
        floatingStandaloneNoteMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      updateFloatingStandaloneNoteMenuPosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [openStandaloneNoteMenu, standaloneNoteDeleteState]);

  useEffect(() => {
    closeCollectionMenu();
    closeDocumentMenu();
    closeNotesSectionMenu();
    closeStandaloneNoteMenu();
    cancelDrag();
    resetPointerFeedback();
    startupTrace("selected-collection-effect", {
      selectedCollectionId
    });
  }, [cancelDrag, selectedCollectionId, selectedLibrarySection]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    startupTrace("native-drop-listener-register-start", {
      selectedCollectionId: selectedCollection?.folder.id ?? null
    });

    void appWindow.onDragDropEvent(async (event) => {
      if (disposed) {
        return;
      }

      if (activeSessionRef.current) {
        return;
      }

      if (event.payload.type === "leave") {
        setNativeDropTarget(null);
        return;
      }

      if (event.payload.type === "over" || event.payload.type === "enter") {
        const scale = window.devicePixelRatio || 1;
        setNativeDropTarget(
          resolveNativeDropTargetAtPositionWithRefs(
            event.payload.position.x / scale,
            event.payload.position.y / scale
          )
        );
        return;
      }

      if (event.payload.type === "drop") {
        const scale = window.devicePixelRatio || 1;
        const target = resolveNativeDropTargetAtPositionWithRefs(
          event.payload.position.x / scale,
          event.payload.position.y / scale
        );
        setNativeDropTarget(null);
        if (!target) {
          return;
        }
        await importDroppedPdfPathsWithRefs(target, event.payload.paths);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
      startupTrace("native-drop-listener-register-finish");
    });

    return () => {
      disposed = true;
      unlisten?.();
      startupTrace("native-drop-listener-cleanup");
    };
  }, [activeSessionRef]);

  function renderCollectionMenu(
    collection: FolderTreeNode,
    position: FloatingMenuPosition
  ) {
    const collectionHasDocuments = collection.documents.length > 0;
    const placement = position?.placement ?? "below";

    return (
      <div
        ref={floatingCollectionMenuRef}
        className={`notes-popover collection-row__menu collection-row__menu--overlay collection-row__menu--${placement}`}
        role="menu"
        data-positioned={position !== null}
        style={{
          left: `${position?.left ?? 0}px`,
          top: `${position?.top ?? 0}px`
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="notes-popover__action collection-row__menu-action"
          type="button"
          onClick={() => {
            closeCollectionMenu();
            setEditingDocumentId(null);
            setEditingCollectionId(collection.folder.id);
            setEditingCollectionValue(collection.folder.name);
            onSelectCollection(collection.folder.id);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 20h4l10-10-4-4L4 16v4Z" />
            <path d="m12.5 7.5 4 4" />
          </svg>
          <span>Rename</span>
        </button>
        {collectionHasDocuments ? (
          <div className="collection-row__menu-disabled">
            <button
              className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
              type="button"
              disabled
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 7h12" />
                <path d="M9 7V5.5h6V7" />
                <path d="M8.2 7l.6 11h6.4l.6-11" />
              </svg>
              <span>Delete</span>
            </button>
            <div className="collection-row__menu-tooltip" role="note">
              Collections with PDFs inside cannot be deleted.
            </div>
          </div>
        ) : (
          <button
            className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
            type="button"
            onClick={() => {
              closeCollectionMenu();
              void Promise.resolve(onDeleteCollection(collection.folder.id)).catch(() => {
                onShowStatus("Could not delete the collection.");
              });
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 7h12" />
              <path d="M9 7V5.5h6V7" />
              <path d="M8.2 7l.6 11h6.4l.6-11" />
            </svg>
            <span>Delete</span>
          </button>
        )}
      </div>
    );
  }

  function renderDocumentMenuAction(
    document: DocumentRecord,
    entry: ReturnType<typeof buildDocumentMenuEntries>[number]
  ) {
    if (entry.kind === "divider") {
      return <div key={entry.id} className="collection-row__menu-divider" aria-hidden="true" />;
    }

    const actionButton = (
      <button
        className={`notes-popover__action collection-row__menu-action${
          entry.danger ? " collection-row__menu-action--danger" : ""
        }`}
        type="button"
        disabled={entry.disabled}
        onClick={() => {
          const resolution = resolveDocumentMenuAction({
            view: openDocumentMenu?.view ?? "actions",
            actionId: entry.id,
            deleteState: documentDeleteState,
            destinationCollectionId: entry.collectionId
          });

          if (resolution.nextView) {
            const nextView = resolution.nextView;
            setOpenDocumentMenu((current) =>
              current
                ? {
                    ...current,
                    view: nextView
                  }
                : current
            );
            return;
          }

          closeDocumentMenu();
          switch (resolution.effect) {
            case "open-reader":
              void onOpenDocument(document.id, "reader");
              return;
            case "open-book":
              void onOpenDocument(document.id, "book");
              return;
            case "rename":
              suppressBookActivation();
              setEditingCollectionId(null);
              setEditingDocumentId(document.id);
              setEditingDocumentValue(documentBaseName(document.fileName));
              return;
            case "show-in-folder":
              void Promise.resolve(onShowDocumentInFolder(document.id)).catch(() => {
                onShowStatus("Could not show the PDF in Explorer.");
              });
              return;
            case "move":
              if (resolution.destinationCollectionId) {
                void Promise.resolve(
                  onMoveDocumentToCollection(document.id, resolution.destinationCollectionId)
                ).catch(() => {
                  onShowStatus("Could not move the PDF.");
                });
              }
              return;
            case "delete":
              void Promise.resolve(onDeleteDocument(document.id)).catch(() => {
                onShowStatus("Could not delete the PDF.");
              });
              return;
            default:
              return;
          }
        }}
      >
        <span>{entry.label}</span>
      </button>
    );

    if (!entry.disabled || !entry.tooltip) {
      return <div key={`${entry.id}-${entry.collectionId ?? "action"}`}>{actionButton}</div>;
    }

    return (
      <div key={`${entry.id}-${entry.collectionId ?? "action"}`} className="collection-row__menu-disabled">
        {actionButton}
        <div className="collection-row__menu-tooltip" role="note">
          {entry.tooltip}
        </div>
      </div>
    );
  }

  function renderDocumentMenu(
    document: DocumentRecord,
    position: FloatingMenuPosition
  ) {
    const currentView = openDocumentMenu?.view ?? "actions";
    const placement = position?.placement ?? "below";

    return (
      <div
        ref={floatingDocumentMenuRef}
        className={`notes-popover collection-row__menu book-row__menu collection-row__menu--overlay collection-row__menu--${placement}`}
        role="menu"
        data-positioned={position !== null}
        style={{
          left: `${position?.left ?? 0}px`,
          top: `${position?.top ?? 0}px`
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {currentView === "confirm-delete" ? (
          <>
            <strong className="collection-row__menu-title">Delete PDF?</strong>
            <p className="collection-row__menu-help">{`This will permanently delete "${document.title}".`}</p>
            <div className="collection-row__menu-footer">
              <button
                className="collection-row__menu-button collection-row__menu-button--ghost"
                type="button"
                onClick={() => {
                  const resolution = resolveDocumentMenuAction({
                    view: "confirm-delete",
                    actionId: "cancel-delete",
                    deleteState: documentDeleteState
                  });
                  const nextView = resolution.nextView ?? "actions";
                  setOpenDocumentMenu((current) =>
                    current
                      ? {
                          ...current,
                          view: nextView
                        }
                      : current
                  );
                }}
              >
                Cancel
              </button>
              <button
                className="collection-row__menu-button collection-row__menu-button--danger"
                type="button"
                onClick={() => {
                  const resolution = resolveDocumentMenuAction({
                    view: "confirm-delete",
                    actionId: "confirm-delete",
                    deleteState: documentDeleteState
                  });
                  closeDocumentMenu();
                  if (resolution.effect === "delete") {
                    void Promise.resolve(onDeleteDocument(document.id)).catch(() => {
                      onShowStatus("Could not delete the PDF.");
                    });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </>
        ) : (
          <>
            {currentView === "move" ? (
              <strong className="collection-row__menu-title">Move to collection</strong>
            ) : null}
            {documentMenuEntries.map((entry) => renderDocumentMenuAction(document, entry))}
          </>
        )}
      </div>
    );
  }

  function renderNotesSectionMenu(position: FloatingMenuPosition) {
    const canOpenNotes = standaloneNotes.length > 0;
    const placement = position?.placement ?? "below";

    return (
      <div
        ref={floatingNotesSectionMenuRef}
        className={`notes-popover collection-row__menu collection-row__menu--overlay collection-row__menu--${placement} notes-row__menu`}
        role="menu"
        data-positioned={position !== null}
        style={{
          left: `${position?.left ?? 0}px`,
          top: `${position?.top ?? 0}px`
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="notes-popover__action collection-row__menu-action"
          type="button"
          disabled={!canOpenNotes}
          onClick={() => {
            closeNotesSectionMenu();
            if (!canOpenNotes) {
              return;
            }

            void Promise.resolve(
              onOpenStandaloneNote(activeStandaloneNoteId ?? standaloneNotes[0]!.id)
            ).catch(() => {
              onShowStatus("Could not open the note.");
            });
          }}
        >
          <span>Open</span>
        </button>
        <button
          className="notes-popover__action collection-row__menu-action"
          type="button"
          onClick={() => {
            closeNotesSectionMenu();
            void Promise.resolve(onCreateStandaloneNote()).catch(() => {
              onShowStatus("Could not create the note.");
            });
          }}
        >
          <span>Create note</span>
        </button>
      </div>
    );
  }

  function renderStandaloneNoteMenu(
    note: NoteIndexEntry,
    position: FloatingMenuPosition
  ) {
    const deleteDisabled = standaloneNoteDeleteState ? !standaloneNoteDeleteState.canDelete : true;
    const placement = position?.placement ?? "below";
    const deleteTooltip =
      standaloneNoteDeleteState?.canDelete === false
        ? standaloneNoteDeleteState.reason ?? "This note cannot be deleted."
        : standaloneNoteDeleteState
          ? undefined
          : "Checking note status...";

    return (
      <div
        ref={floatingStandaloneNoteMenuRef}
        className={`notes-popover collection-row__menu collection-row__menu--overlay collection-row__menu--${placement} notes-row__menu`}
        role="menu"
        data-positioned={position !== null}
        style={{
          left: `${position?.left ?? 0}px`,
          top: `${position?.top ?? 0}px`
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="notes-popover__action collection-row__menu-action"
          type="button"
          onClick={() => {
            closeStandaloneNoteMenu();
            void Promise.resolve(onOpenStandaloneNote(note.id)).catch(() => {
              onShowStatus("Could not open the note.");
            });
          }}
        >
          <span>Open</span>
        </button>
        <button
          className="notes-popover__action collection-row__menu-action"
          type="button"
          onClick={() => {
            suppressBookActivation();
            closeStandaloneNoteMenu();
            setEditingStandaloneNoteId(note.id);
            setEditingStandaloneNoteValue(note.title);
          }}
        >
          <span>Rename</span>
        </button>
        {!deleteDisabled || !deleteTooltip ? (
          <button
            className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
            type="button"
            disabled={deleteDisabled}
            onClick={() => {
              closeStandaloneNoteMenu();
              if (deleteDisabled) {
                return;
              }

              void onDeleteStandaloneNote(note.id);
            }}
          >
            <span>Delete</span>
          </button>
        ) : (
          <div className="collection-row__menu-disabled">
            <button
              className="notes-popover__action collection-row__menu-action collection-row__menu-action--danger"
              type="button"
              disabled
            >
              <span>Delete</span>
            </button>
            <div className="collection-row__menu-tooltip" role="note">
              {deleteTooltip}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section
      ref={collectionViewRef}
      className={`collection-view${dragPreview ? " collection-view--internal-dragging" : ""}`}
    >
      <aside className="collection-sidebar">
        <header className="collection-sidebar__header">
          <h2>Library</h2>
          <button
            className="collection-sidebar__add"
            type="button"
            aria-label="Change library folder"
            title="Change library folder"
            onClick={() => {
              void onChangeLibraryRoot();
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
              <path d="M16.5 7.75v5.5" />
              <path d="M13.75 10.5h5.5" />
            </svg>
          </button>
        </header>

        <div className="collection-sidebar__rows-shell">
          <div
            ref={collectionRowsContainerRef}
            className="collection-sidebar__rows"
            onScroll={() => {
              updateCollectionSidebarScrollbar();
            }}
          >
            <div className="collection-sidebar__section">
              <div className="collection-sidebar__section-header">
                <div className="collection-sidebar__section-label">
                  <span className="collection-sidebar__section-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
                    </svg>
                  </span>
                  <span>Collections</span>
                </div>
                <button
                  className="collection-sidebar__add"
                  type="button"
                  aria-label="Add collection"
                  onClick={() => {
                    void onCreateCollection();
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>
            {displayedCollections.map((collection) => {
              const isActive =
                !notesSectionSelected && collection.folder.id === selectedCollection?.folder.id;
              const isEditing = collection.folder.id === editingCollectionId;
              const isNativeDropTarget =
                nativeDropTarget?.kind === "collection-row" &&
                nativeDropTarget.collectionId === collection.folder.id;
              const isPointerTransferTarget =
                collectionTransferTargetId === collection.folder.id;
              const collectionDropClass =
                collectionDropIndicator?.targetId === collection.folder.id
                  ? collectionDropIndicator.position === "before"
                    ? " collection-row--drop-before"
                    : " collection-row--drop-after"
                  : "";
              const collectionNativeDropClass = isNativeDropTarget || isPointerTransferTarget
                ? " collection-row--native-drop-target"
                : "";

              return (
                <div
                  key={collection.folder.id}
                  ref={(element) => {
                    if (element) {
                      collectionRowRefs.current.set(collection.folder.id, element);
                    } else {
                      collectionRowRefs.current.delete(collection.folder.id);
                    }
                  }}
                  className={`collection-row${isActive ? " collection-row--active" : ""}${collectionDropClass}${collectionNativeDropClass}`}
                  role="button"
                  tabIndex={isEditing ? -1 : 0}
                  onClick={(event) => {
                    if (
                      isEditing ||
                      isInteractiveTarget(event.target) ||
                      shouldSuppressCollectionActivation()
                    ) {
                      return;
                    }
                    if (skipNextCollectionSelectionRef.current) {
                      skipNextCollectionSelectionRef.current = false;
                      return;
                    }
                    onSelectCollection(collection.folder.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      isEditing ||
                      isInteractiveTarget(event.target) ||
                      shouldSuppressCollectionActivation()
                    ) {
                      return;
                    }

                    if (skipNextCollectionSelectionRef.current) {
                      skipNextCollectionSelectionRef.current = false;
                      return;
                    }

                    if (event.key === "Enter" || event.key === " ") {
                      if (!isSelfKeyboardActivation(event)) {
                        return;
                      }
                      event.preventDefault();
                      onSelectCollection(collection.folder.id);
                    }
                  }}
                >
                  {isEditing ? (
                    <input
                      className="collection-row__input"
                      autoFocus
                      value={editingCollectionValue}
                      onChange={(event) => setEditingCollectionValue(event.target.value)}
                      onBlur={() => {
                        void commitCollectionRename({ skipNextSelection: true });
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation();

                        if (event.key !== "Enter" && event.key !== "Escape") {
                          return;
                        }

                        event.preventDefault();
                        event.nativeEvent.stopImmediatePropagation();

                        if (event.key === "Escape") {
                          setEditingCollectionId(null);
                          setEditingCollectionValue("");
                          return;
                        }

                        void commitCollectionRename({ skipNextSelection: true });
                      }}
                    />
                  ) : (
                    <>
                      <span
                        className="collection-row__drag-handle"
                        role="button"
                        tabIndex={-1}
                        aria-label={`Reorder ${collection.folder.name}`}
                        {...createHandleProps({
                          kind: "collection",
                          collectionId: collection.folder.id,
                          label: collection.folder.name
                        })}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="9" cy="7" r="1.2" />
                          <circle cx="15" cy="7" r="1.2" />
                          <circle cx="9" cy="12" r="1.2" />
                          <circle cx="15" cy="12" r="1.2" />
                          <circle cx="9" cy="17" r="1.2" />
                          <circle cx="15" cy="17" r="1.2" />
                        </svg>
                      </span>
                      <span className="collection-row__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
                        </svg>
                      </span>
                      <span className="collection-row__name">{collection.folder.name}</span>
                      <span className="collection-row__actions">
                        <span className="collection-row__count" aria-label={`${collection.documents.length} documents`}>
                          {collection.documents.length}
                        </span>
                        <button
                          className="row-action-button"
                          type="button"
                          ref={(element) => {
                            if (element) {
                              collectionMenuButtonRefs.current.set(collection.folder.id, element);
                            } else {
                              collectionMenuButtonRefs.current.delete(collection.folder.id);
                            }
                          }}
                          aria-label={`Open actions for ${collection.folder.name}`}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            closeNotesSectionMenu();
                            closeStandaloneNoteMenu();
                            const isClosing =
                              openCollectionMenu?.collectionId === collection.folder.id &&
                              openCollectionMenu.source === "row";
                            setOpenCollectionMenu(
                              isClosing
                                ? null
                                : {
                                    collectionId: collection.folder.id,
                                    source: "row"
                                  }
                            );
                            if (isClosing) {
                              setFloatingCollectionMenuPosition(null);
                              return;
                            }

                            const button = event.currentTarget;
                            window.requestAnimationFrame(() => {
                              updateFloatingCollectionMenuPosition(button);
                            });
                          }}
                        >
                          <svg
                            className="row-action-button__icon"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <circle cx="6.5" cy="12" r="1.8" />
                            <circle cx="12" cy="12" r="1.8" />
                            <circle cx="17.5" cy="12" r="1.8" />
                          </svg>
                        </button>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
            </div>

            <div className="collection-sidebar__section collection-sidebar__section--notes">
              <div className="collection-sidebar__section-header">
                <div className="collection-sidebar__section-label">
                  <span className="collection-sidebar__section-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
                    </svg>
                  </span>
                  <span>Notes</span>
                </div>
                <button
                  className="collection-sidebar__add"
                  type="button"
                  aria-label="Create note"
                  onClick={() => {
                    void Promise.resolve(onCreateStandaloneNote()).catch(() => {
                      onShowStatus("Could not create the note.");
                    });
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>

              <div
                className={`collection-row${notesSectionSelected ? " collection-row--active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectNotes();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNotes();
                  }
                }}
              >
                <span className="collection-row__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3.75 7.25A2.25 2.25 0 0 1 6 5h3.1c.6 0 1.18.24 1.6.66l1.15 1.14c.42.42 1 .66 1.6.66H18A2.25 2.25 0 0 1 20.25 9.7v7.05A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.25Z" />
                  </svg>
                </span>
                <span className="collection-row__name">Notes</span>
                <span className="collection-row__actions notes-row__actions">
                  <span className="collection-row__count" aria-label={`${standaloneNotes.length} notes`}>
                    {standaloneNotes.length}
                  </span>
                  <button
                    className="row-action-button"
                    type="button"
                    ref={notesSectionMenuButtonRef}
                    aria-label="Open notes actions"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeCollectionMenu();
                      closeDocumentMenu();
                      closeStandaloneNoteMenu();
                      const isClosing = openNotesSectionMenu;
                      setOpenNotesSectionMenu(!isClosing);
                      if (isClosing) {
                        setFloatingNotesSectionMenuPosition(null);
                        return;
                      }

                      window.requestAnimationFrame(() => {
                        updateFloatingNotesSectionMenuPosition(event.currentTarget);
                      });
                    }}
                  >
                    <svg
                      className="row-action-button__icon"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="6.5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="17.5" cy="12" r="1.8" />
                    </svg>
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div
            ref={collectionSidebarScrollbarRef}
            className={
              collectionSidebarScrollbarState.visible
                ? "collection-sidebar__scrollbar collection-sidebar__scrollbar--visible"
                : "collection-sidebar__scrollbar"
            }
            aria-hidden="true"
            onPointerDown={(event) => {
              const scrollbarElement = collectionSidebarScrollbarRef.current;
              if (!scrollbarElement || event.target !== event.currentTarget) {
                return;
              }

              event.preventDefault();
              const trackRect = scrollbarElement.getBoundingClientRect();
              scrollCollectionSidebarToThumbTop(
                event.clientY -
                  trackRect.top -
                  collectionSidebarScrollbarState.thumbHeight / 2
              );
              updateCollectionSidebarScrollbar();
            }}
          >
            <div
              className="collection-sidebar__scrollbar-thumb"
              style={{
                height: `${collectionSidebarScrollbarState.thumbHeight}px`,
                transform: `translateY(${collectionSidebarScrollbarState.thumbTop}px)`
              }}
              onPointerDown={(event) => {
                const rowsElement = collectionRowsContainerRef.current;
                if (!rowsElement) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                collectionSidebarScrollbarDragRef.current = {
                  pointerId: event.pointerId,
                  startClientY: event.clientY,
                  startScrollTop: rowsElement.scrollTop
                };
              }}
            />
          </div>
        </div>
      </aside>

      <section
        ref={collectionMainRef}
        className="collection-main"
        onScroll={() => {
          updateCollectionMainScrollbar();
        }}
      >
        {notesSectionSelected ? (
          <div className="collection-main__body">
            <header className="collection-header">
              <div className="collection-header__details">
                <h1>Notes</h1>
              </div>
              <div className="collection-header__actions">
                <button
                  className="collection-header__import-button"
                  type="button"
                  onClick={() => {
                    void Promise.resolve(onCreateStandaloneNote()).catch(() => {
                      onShowStatus("Could not create the note.");
                    });
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                  <span>Create note</span>
                </button>
              </div>
            </header>

            <div className="collection-note-list">
              {standaloneNotes.map((note) => {
                const isEditing = editingStandaloneNoteId === note.id;
                const isActive = activeStandaloneNote?.id === note.id;

                return (
                  <div
                    key={note.id}
                    className={`book-row standalone-note-row${isActive ? " standalone-note-row--active" : ""}`}
                    role="button"
                    tabIndex={isEditing ? -1 : 0}
                    onClick={(event) => {
                      if (
                        isEditing ||
                        isInteractiveTarget(event.target) ||
                        shouldSuppressBookActivation()
                      ) {
                        return;
                      }
                      if (skipNextStandaloneNoteActivationRef.current) {
                        skipNextStandaloneNoteActivationRef.current = false;
                        return;
                      }
                      void Promise.resolve(onOpenStandaloneNote(note.id)).catch(() => {
                        onShowStatus("Could not open the note.");
                      });
                    }}
                    onKeyDown={(event) => {
                      if (
                        isEditing ||
                        isInteractiveTarget(event.target) ||
                        shouldSuppressBookActivation()
                      ) {
                        return;
                      }
                      if (skipNextStandaloneNoteActivationRef.current) {
                        skipNextStandaloneNoteActivationRef.current = false;
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void Promise.resolve(onOpenStandaloneNote(note.id)).catch(() => {
                          onShowStatus("Could not open the note.");
                        });
                      }
                    }}
                  >
                    {isEditing ? (
                      <div className="book-row__rename">
                        <input
                          className="book-row__input"
                          autoFocus
                          value={editingStandaloneNoteValue}
                          onChange={(event) => setEditingStandaloneNoteValue(event.target.value)}
                          onBlur={() => {
                            void commitStandaloneNoteRename(note, {
                              skipNextActivation: true
                            });
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation();

                            if (event.key !== "Enter" && event.key !== "Escape") {
                              return;
                            }

                            event.preventDefault();
                            event.nativeEvent.stopImmediatePropagation();

                            if (event.key === "Escape") {
                              suppressBookActivation();
                              setEditingStandaloneNoteId(null);
                              setEditingStandaloneNoteValue("");
                              return;
                            }

                            void commitStandaloneNoteRename(note, {
                              skipNextActivation: true
                            });
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <span className="book-row__name">
                          {note.title.trim() || "Untitled note"}
                        </span>
                        <span className="book-row__actions notes-row__actions">
                          <button
                            className="row-action-button"
                            type="button"
                            aria-label={`Open actions for ${note.title || "Untitled note"}`}
                            ref={(element) => {
                              if (element) {
                                standaloneNoteMenuButtonRefs.current.set(note.id, element);
                              } else {
                                standaloneNoteMenuButtonRefs.current.delete(note.id);
                              }
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              suppressBookActivation();
                              closeCollectionMenu();
                              closeDocumentMenu();
                              closeNotesSectionMenu();
                              const isClosing = openStandaloneNoteMenu?.noteId === note.id;
                              setOpenStandaloneNoteMenu(isClosing ? null : { noteId: note.id });
                              setStandaloneNoteDeleteState(null);
                              if (isClosing) {
                                setFloatingStandaloneNoteMenuPosition(null);
                                return;
                              }

                              window.requestAnimationFrame(() => {
                                updateFloatingStandaloneNoteMenuPosition(event.currentTarget);
                              });
                            }}
                          >
                            <svg
                              className="row-action-button__icon"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <circle cx="6.5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="17.5" cy="12" r="1.8" />
                            </svg>
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : selectedCollection ? (
          <div className="collection-main__body">
            <header className="collection-header">
              <div className="collection-header__details">
                <h1>{selectedCollection.folder.name}</h1>
              </div>
              <div className="collection-header__actions">
                <button
                  className="collection-header__import-button"
                  type="button"
                  onClick={() => {
                    void onPromptImportCollection(selectedCollection.folder.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M12 16V6" />
                    <path d="m8.5 9.5 3.5-3.5 3.5 3.5" />
                    <path d="M5 18.5A2.5 2.5 0 0 0 7.5 21h9A2.5 2.5 0 0 0 19 18.5" />
                  </svg>
                  <span>Import files</span>
                </button>
                <span className="collection-header__divider" aria-hidden="true" />
                <div className="collection-header__menu-slot">
                  <button
                    className="row-action-button"
                    type="button"
                    ref={headerCollectionMenuButtonRef}
                    aria-label={`Open actions for ${selectedCollection.folder.name}`}
                    onClick={(event) => {
                      closeNotesSectionMenu();
                      closeStandaloneNoteMenu();
                      const isClosing =
                        openCollectionMenu?.collectionId === selectedCollection.folder.id &&
                        openCollectionMenu.source === "header";
                      setOpenCollectionMenu(
                        isClosing
                          ? null
                          : {
                              collectionId: selectedCollection.folder.id,
                              source: "header"
                            }
                      );
                      if (isClosing) {
                        setFloatingCollectionMenuPosition(null);
                        return;
                      }

                      const button = event.currentTarget;
                      window.requestAnimationFrame(() => {
                        updateFloatingCollectionMenuPosition(button);
                      });
                    }}
                  >
                    <svg
                      className="row-action-button__icon"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <circle cx="6.5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="17.5" cy="12" r="1.8" />
                    </svg>
                  </button>
                </div>
              </div>
            </header>

            <div
              ref={importPanelRef}
              className={`collection-import-panel${
                nativeDropTarget?.kind === "import-panel" &&
                nativeDropTarget.collectionId === selectedCollection.folder.id
                  ? " collection-import-panel--drop-target"
                  : ""
              }`}
            >
              <div className="collection-import-panel__content">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 16V6" />
                  <path d="m8.5 9.5 3.5-3.5 3.5 3.5" />
                  <path d="M5 18.5A2.5 2.5 0 0 0 7.5 21h9A2.5 2.5 0 0 0 19 18.5" />
                </svg>
                <span>Drop files here or</span>
                <button
                  className="collection-import-panel__link"
                  type="button"
                  onClick={() => {
                    void onPromptImportCollection(selectedCollection.folder.id);
                  }}
                >
                  import files
                </button>
              </div>
            </div>

            <div ref={bookListRef} className="collection-book-list">
              {books.map((document) => {
                const isEditing = editingDocumentId === document.id;
                const bookDropClass =
                  bookDropIndicator?.targetId === document.id
                    ? bookDropIndicator.position === "before"
                      ? " book-row--drop-before"
                      : " book-row--drop-after"
                    : "";

                return (
                  <div
                    key={document.id}
                    ref={(element) => {
                      if (element) {
                        bookRowRefs.current.set(document.id, element);
                      } else {
                        bookRowRefs.current.delete(document.id);
                      }
                    }}
                    className={`book-row${bookDropClass}`}
                    role="button"
                    tabIndex={isEditing ? -1 : 0}
                    onClick={(event) => {
                      if (
                        isEditing ||
                        isInteractiveTarget(event.target) ||
                        shouldSuppressBookActivation()
                      ) {
                        return;
                      }
                      if (skipNextDocumentActivationRef.current) {
                        skipNextDocumentActivationRef.current = false;
                        return;
                      }
                      void onOpenDocument(document.id, "reader");
                    }}
                    onKeyDown={(event) => {
                      if (
                        isEditing ||
                        isInteractiveTarget(event.target) ||
                        shouldSuppressBookActivation()
                      ) {
                        return;
                      }
                      if (skipNextDocumentActivationRef.current) {
                        skipNextDocumentActivationRef.current = false;
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        if (!isSelfKeyboardActivation(event)) {
                          return;
                        }
                        event.preventDefault();
                        void onOpenDocument(document.id, "reader");
                      }
                    }}
                  >
                    {isEditing ? (
                      <div className="book-row__rename">
                        <input
                          className="book-row__input"
                          autoFocus
                          value={editingDocumentValue}
                          onChange={(event) => setEditingDocumentValue(event.target.value)}
                          onBlur={() => {
                            void commitDocumentRename(document, { skipNextActivation: true });
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onMouseDown={(event) => event.stopPropagation()}
                          onKeyUp={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation();

                            if (event.key !== "Enter" && event.key !== "Escape") {
                              return;
                            }

                            event.preventDefault();
                            event.nativeEvent.stopImmediatePropagation();

                            if (event.key === "Escape") {
                              suppressBookActivation();
                              setEditingDocumentId(null);
                              setEditingDocumentValue("");
                              return;
                            }

                            void commitDocumentRename(document, { skipNextActivation: true });
                          }}
                        />
                        <span className="book-row__extension">.pdf</span>
                      </div>
                    ) : (
                      <>
                        <span
                          className="book-row__drag-handle"
                          role="button"
                          tabIndex={-1}
                          aria-label={`Reorder ${document.title}`}
                          {...createHandleProps({
                            kind: "book",
                            collectionId: selectedCollection.folder.id,
                            documentId: document.id,
                            label: document.title
                          })}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <path d="M7 4.75h6l4.25 4.5V19A1.25 1.25 0 0 1 16 20.25H7A1.25 1.25 0 0 1 5.75 19V6A1.25 1.25 0 0 1 7 4.75Z" />
                            <path d="M13 4.75V9.5h4.25" />
                          </svg>
                        </span>
                        <span className="book-row__name">{document.title}</span>
                        <span className="book-row__actions">
                          <button
                            className="row-action-button"
                            type="button"
                            aria-label={`Open actions for ${document.title}`}
                            ref={(element) => {
                              if (element) {
                                documentMenuButtonRefs.current.set(document.id, element);
                              } else {
                                documentMenuButtonRefs.current.delete(document.id);
                              }
                            }}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              suppressBookActivation();
                              closeCollectionMenu();
                              closeNotesSectionMenu();
                              closeStandaloneNoteMenu();
                              setOpenDocumentMenu((current) =>
                                current?.documentId === document.id
                                  ? null
                                  : {
                                      documentId: document.id,
                                      view: "actions"
                                    }
                              );
                              setDocumentDeleteState(null);
                              window.requestAnimationFrame(() => {
                                updateFloatingDocumentMenuPosition(event.currentTarget);
                              });
                            }}
                          >
                            <svg
                              className="row-action-button__icon"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <circle cx="6.5" cy="12" r="1.8" />
                              <circle cx="12" cy="12" r="1.8" />
                              <circle cx="17.5" cy="12" r="1.8" />
                            </svg>
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div
          ref={collectionMainScrollbarRef}
          className={
            collectionMainScrollbarState.visible
              ? "collection-main__scrollbar collection-main__scrollbar--visible"
              : "collection-main__scrollbar"
          }
          aria-hidden="true"
          onPointerDown={(event) => {
            const scrollbarElement = collectionMainScrollbarRef.current;
            if (!scrollbarElement || event.target !== event.currentTarget) {
              return;
            }

            event.preventDefault();
            const trackRect = scrollbarElement.getBoundingClientRect();
            scrollCollectionMainToThumbTop(
              event.clientY - trackRect.top - collectionMainScrollbarState.thumbHeight / 2
            );
            updateCollectionMainScrollbar();
          }}
        >
          <div
            className="collection-main__scrollbar-thumb"
            style={{
              height: `${collectionMainScrollbarState.thumbHeight}px`,
              transform: `translateY(${collectionMainScrollbarState.thumbTop}px)`
            }}
            onPointerDown={(event) => {
              const mainElement = collectionMainRef.current;
              if (!mainElement) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              collectionMainScrollbarDragRef.current = {
                pointerId: event.pointerId,
                startClientY: event.clientY,
                startScrollTop: mainElement.scrollTop
              };
            }}
          />
        </div>
      </section>
      {openCollectionMenu ? (
        (() => {
          const menuCollection =
            displayedCollections.find(
              (collection) => collection.folder.id === openCollectionMenu.collectionId
            ) ?? null;

          return menuCollection
            ? renderCollectionMenu(menuCollection, floatingCollectionMenuPosition)
            : null;
        })()
      ) : null}
      {openDocumentMenu && openMenuDocument
        ? renderDocumentMenu(openMenuDocument, floatingDocumentMenuPosition)
        : null}
      {openNotesSectionMenu
        ? renderNotesSectionMenu(floatingNotesSectionMenuPosition)
        : null}
      {openStandaloneNoteMenu && openMenuStandaloneNote
        ? renderStandaloneNoteMenu(
            openMenuStandaloneNote,
            floatingStandaloneNoteMenuPosition
          )
        : null}
      {dragPreview ? (
        <div
          className="collection-drag-preview"
          style={{
            left: `${dragPreview.x + 16}px`,
            top: `${dragPreview.y + 16}px`
          }}
        >
          <span className="collection-drag-preview__label">{dragPreview.label}</span>
        </div>
      ) : null}
    </section>
  );
}
