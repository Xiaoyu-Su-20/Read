import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { logNoteDebugEvent } from "../../lib/api";
import {
  createDirectHeadingReference,
  headingLevel,
  headingTitle,
  resolveSourceReferenceTarget
} from "../../lib/documentReferences";
import { makeBookmark } from "../../lib/app/helpers";
import { findBookmarkAtPage } from "../../lib/commands";
import { noteBlockText, parsePageLinkTargetInput } from "../../lib/notes";
import type {
  Bookmark,
  NoteBlockType,
  NoteDocument,
  NoteNavigationItem,
  NotePageLinkNode,
  NoteRevealRequest,
  OutlineItem,
  PdfNavigationTarget
} from "../../lib/types";
import NotesContextMenu from "./context-menu/NotesContextMenu";
import { toPanePoint } from "./context-menu/menuPlacement";
import {
  useContextMenuController,
  type NotesContextMenuState
} from "./context-menu/useContextMenuController";
import NoteEditor, { type NoteEditorHandle } from "./NoteEditor";
import NoteTitleField from "./NoteTitleField";
import WorkspaceHeaderTools from "../WorkspaceHeaderTools";

type NotesPaneProps = {
  note: NoteDocument | null;
  loading: boolean;
  capabilityMode: "document" | "standalone";
  fullscreen: boolean;
  onToggleFullscreen: () => void | Promise<void>;
  headerActionsContainerId: string | null;
  titleMode?: "hidden" | "standalone";
  navigationItems: NoteNavigationItem[];
  onChangeTitle: (title: string) => void;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlush: () => void | Promise<void>;
  onCopyAllText: () => Promise<void>;
  onGoToPage: (page: number) => void;
  documentId: string | null;
  outlineItems: OutlineItem[];
  bookmarks: Bookmark[];
  onNavigateToTarget: (target: PdfNavigationTarget) => void;
  onSetBookmarks: (bookmarks: Bookmark[]) => void;
  currentPage: number | null;
  revealRequest: NoteRevealRequest | null;
  navigationOpenRequest: number;
  commandPaletteOpen: boolean;
  onToggleCommandPalette: () => void;
  registerCommandPaletteAnchor: (node: HTMLButtonElement | null) => void;
};

function NavigationButton({
  open,
  onToggle
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={`notes-header-action${open ? " notes-header-action--active" : ""}`}
      type="button"
      aria-label="Open note navigation"
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M5 7h14" />
        <path d="M5 12h10" />
        <path d="M5 17h14" />
      </svg>
    </button>
  );
}

function isContextMenuTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(".note-editor"));
}

function isMenuInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".editor-context-menu, .block-type-submenu, .notes-find-panel, .notes-inline-dialog, .notes-popover, .notes-header-tools, .notes-pane__scrollbar"
      )
    )
  );
}

const TOAST_DURATION_MS = 2400;

type NoteFindMatch = {
  blockId: string;
  occurrenceIndex: number;
};

type NoteNavigationTreeNode = {
  item: NoteNavigationItem;
  children: NoteNavigationTreeNode[];
};

function collectNoteFindMatches(note: NoteDocument | null, query: string): NoteFindMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!note || normalizedQuery.length === 0) {
    return [];
  }

  const matches: NoteFindMatch[] = [];
  for (const block of note.blocks) {
    const text = noteBlockText(block).toLocaleLowerCase();
    let cursor = 0;
    let occurrenceIndex = 0;

    while (cursor <= text.length) {
      const matchIndex = text.indexOf(normalizedQuery, cursor);
      if (matchIndex < 0) {
        break;
      }

      matches.push({ blockId: block.id, occurrenceIndex });
      occurrenceIndex += 1;
      cursor = matchIndex + Math.max(normalizedQuery.length, 1);
    }
  }

  return matches;
}

function buildNoteNavigationTree(items: NoteNavigationItem[]): NoteNavigationTreeNode[] {
  const roots: NoteNavigationTreeNode[] = [];
  let currentLevel1: NoteNavigationTreeNode | null = null;
  let currentLevel2: NoteNavigationTreeNode | null = null;

  for (const item of items) {
    const node: NoteNavigationTreeNode = {
      item,
      children: []
    };

    if (item.level === 1) {
      roots.push(node);
      currentLevel1 = node;
      currentLevel2 = null;
      continue;
    }

    if (item.level === 2) {
      if (currentLevel1) {
        currentLevel1.children.push(node);
      } else {
        roots.push(node);
      }
      currentLevel2 = node;
      continue;
    }

    if (currentLevel2) {
      currentLevel2.children.push(node);
      continue;
    }

    if (currentLevel1) {
      currentLevel1.children.push(node);
      continue;
    }

    roots.push(node);
  }

  return roots;
}

const NotesPane = memo(function NotesPane({
  note,
  loading,
  capabilityMode,
  fullscreen,
  onToggleFullscreen,
  headerActionsContainerId,
  titleMode = "hidden",
  navigationItems,
  onChangeTitle,
  onChangeBlocks,
  onFlush,
  onCopyAllText,
  onGoToPage,
  documentId,
  outlineItems,
  bookmarks,
  onNavigateToTarget,
  onSetBookmarks,
  currentPage,
  revealRequest,
  navigationOpenRequest,
  commandPaletteOpen,
  onToggleCommandPalette,
  registerCommandPaletteAnchor
}: NotesPaneProps) {
  const documentCapabilities = capabilityMode === "document";
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const pageLinkInputRef = useRef<HTMLInputElement | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollbarRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const scrollbarMetricsRef = useRef({
    trackHeight: 0,
    thumbHeight: 0,
    maxThumbTop: 0,
    maxScroll: 0
  });
  const scrollbarDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startScrollTop: number;
  } | null>(null);
  const scrollbarHideTimerRef = useRef<number | null>(null);
  const lastContextMenuPointerRef = useRef<{
    x: number;
    y: number;
    timestamp: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [scrollbarVisible, setScrollbarVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeFindIndex, setActiveFindIndex] = useState(0);
  const [expandedNavigationIds, setExpandedNavigationIds] = useState<Set<string>>(() => new Set());
  const [pageLinkDialog, setPageLinkDialog] = useState<{
    mode: "insert" | "edit";
    pageLinkId: string | null;
    value: string;
    error: string | null;
  } | null>(null);
  const headerActionsContainer =
    typeof document !== "undefined" && headerActionsContainerId
      ? document.getElementById(headerActionsContainerId)
      : null;
  const findMatches = useMemo(
    () => collectNoteFindMatches(note, findQuery),
    [findQuery, note]
  );
  const navigationTree = useMemo(
    () => buildNoteNavigationTree(navigationItems),
    [navigationItems]
  );

  function toggleNavigationNode(nodeId: string) {
    setExpandedNavigationIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function renderNavigationBranch(
    nodes: NoteNavigationTreeNode[],
    depth: number
  ): ReactNode {
    if (nodes.length === 0) {
      return null;
    }

    return (
      <div className="notes-navigation__tree" role="group">
        {nodes.map((node) => {
          const isExpanded = expandedNavigationIds.has(node.item.id);
          const hasChildren = node.children.length > 0;

          return (
            <div
              key={node.item.id}
              className={`notes-navigation__tree-node notes-navigation__tree-node--depth-${depth}`}
              style={{ ["--notes-nav-depth" as string]: String(depth) }}
            >
              <div className="notes-navigation__tree-header">
                <button
                  className={`notes-navigation__tree-row${hasChildren ? " notes-navigation__tree-row--branch" : ""}`}
                  type="button"
                  onClick={() => {
                    editorRef.current?.scrollToBlock(node.item.blockId);
                    setNavigationOpen(false);
                  }}
                >
                  <span className="notes-navigation__tree-marker" aria-hidden="true">
                    <span className="notes-navigation__tree-dot" />
                  </span>
                  <span className="notes-navigation__tree-title">{node.item.title}</span>
                </button>
                {hasChildren ? (
                  <button
                    className={`notes-navigation__tree-toggle${isExpanded ? " notes-navigation__tree-toggle--expanded" : ""}`}
                    type="button"
                    aria-label={isExpanded ? "Collapse subsection" : "Expand subsection"}
                    aria-expanded={isExpanded}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleNavigationNode(node.item.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d={isExpanded ? "m8 10 4 4 4-4" : "m10 8 4 4-4 4"} />
                    </svg>
                  </button>
                ) : null}
              </div>
              {hasChildren && isExpanded ? renderNavigationBranch(node.children, depth + 1) : null}
            </div>
          );
        })}
      </div>
    );
  }

  useEffect(() => {
    if (revealRequest) editorRef.current?.scrollToBlock(revealRequest.blockId);
  }, [note?.id, revealRequest]);

  useEffect(() => {
    if (navigationOpenRequest > 0) {
      setNavigationOpen(true);
    }
  }, [navigationOpenRequest]);

  useEffect(() => {
    if (!navigationOpen) {
      return;
    }

    const expandableIds = navigationTree
      .filter((node) => node.children.length > 0)
      .map((node) => node.item.id);

    setExpandedNavigationIds((current) => {
      const next = new Set(
        [...current].filter((id) => expandableIds.includes(id))
      );

      if (next.size === 0 && expandableIds.length > 0) {
        next.add(expandableIds[0]!);
      }

      if (next.size === current.size && [...next].every((id) => current.has(id))) {
        return current;
      }

      return next;
    });
  }, [navigationOpen, navigationTree]);
  const {
    state: contextMenuState,
    position: contextMenuPosition,
    submenuOpen,
    submenuPlacement,
    menuRef,
    submenuRef,
    submenuAnchorRef,
    openMenu,
    closeMenu,
    openSubmenu,
    scheduleCloseSubmenu
  } = useContextMenuController({ paneRef });

  function openFindPanel() {
    closeMenu();
    setNavigationOpen(false);
    setPageLinkDialog(null);
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }

  function closeFindPanel() {
    setFindOpen(false);
    setActiveFindIndex(0);
    editorRef.current?.focus();
  }

  function moveFindSelection(delta: number) {
    if (findMatches.length === 0) {
      setActiveFindIndex(0);
      return;
    }

    setActiveFindIndex((current) => {
      const nextIndex = (current + delta + findMatches.length) % findMatches.length;
      return nextIndex;
    });
  }

  function clearScrollbarHideTimer() {
    if (scrollbarHideTimerRef.current !== null) {
      window.clearTimeout(scrollbarHideTimerRef.current);
      scrollbarHideTimerRef.current = null;
    }
  }

  function scheduleScrollbarHide(delayMs = 900) {
    clearScrollbarHideTimer();
    scrollbarHideTimerRef.current = window.setTimeout(() => {
      setScrollbarVisible(false);
      scrollbarHideTimerRef.current = null;
    }, delayMs);
  }

  function revealScrollbar(delayMs = 900) {
    setScrollbarVisible(true);
    scheduleScrollbarHide(delayMs);
  }

  function updateNotesScrollbar() {
    const paneElement = paneRef.current;
    const scrollElement = scrollRef.current;
    if (!paneElement || !scrollElement) {
      return;
    }

    const trackPadding = 14;
    const trackHeight = Math.max(scrollElement.clientHeight - trackPadding, 0);
    const maxScroll = Math.max(scrollElement.scrollHeight - scrollElement.clientHeight, 0);

    if (trackHeight <= 0 || scrollElement.scrollHeight <= scrollElement.clientHeight) {
      scrollbarMetricsRef.current = {
        trackHeight: 0,
        thumbHeight: 0,
        maxThumbTop: 0,
        maxScroll: 0
      };
      paneElement.style.setProperty("--notes-scroll-thumb-height", "0px");
      paneElement.style.setProperty("--notes-scroll-thumb-top", "0px");
      return;
    }

    const scrollRatio = scrollElement.clientHeight / scrollElement.scrollHeight;
    const thumbHeight = Math.max(32, trackHeight * scrollRatio);
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const thumbTop = maxScroll === 0 ? 0 : (scrollElement.scrollTop / maxScroll) * maxThumbTop;

    scrollbarMetricsRef.current = {
      trackHeight,
      thumbHeight,
      maxThumbTop,
      maxScroll
    };
    paneElement.style.setProperty("--notes-scroll-thumb-height", `${thumbHeight}px`);
    paneElement.style.setProperty("--notes-scroll-thumb-top", `${thumbTop}px`);
  }

  function scrollNotesToThumbTop(nextThumbTop: number) {
    const scrollElement = scrollRef.current;
    const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
    if (!scrollElement || maxScroll <= 0 || maxThumbTop <= 0) {
      return;
    }

    const clampedThumbTop = Math.max(0, Math.min(nextThumbTop, maxThumbTop));
    const nextScrollTop = (clampedThumbTop / maxThumbTop) * maxScroll;
    scrollElement.scrollTop = nextScrollTop;
  }

  function showToast(message: string) {
    setToastMessage(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION_MS);
  }

  function closeInlineOverlays() {
    setNavigationOpen(false);
    setPageLinkDialog(null);
    setFindOpen(false);
  }

  function validatePageLinkInput(value: string) {
    const parsed = parsePageLinkTargetInput(value);
    if (!parsed) {
      return {
        ok: false as const,
        message: "Enter a whole page number greater than 0."
      };
    }

    return {
      ok: true as const,
      pageNumber: parsed.pageNumber
    };
  }

  function submitPageLinkDialog() {
    const current = pageLinkDialog;
    if (!current) {
      return;
    }

    const parsed = validatePageLinkInput(current.value);
    if (!parsed.ok) {
      setPageLinkDialog((dialog) =>
        dialog
          ? {
              ...dialog,
              error: parsed.message
            }
          : dialog
      );
      return;
    }

    const result =
      current.mode === "insert"
        ? editorRef.current?.insertPageLink(parsed.pageNumber)
        : current.pageLinkId
          ? editorRef.current?.editPageLink(current.pageLinkId, parsed.pageNumber)
          : null;

    if (!result) {
      return;
    }

    if (!result.ok) {
      setPageLinkDialog((dialog) =>
        dialog
          ? {
              ...dialog,
              error: result.message
            }
          : dialog
      );
      return;
    }

    editorRef.current?.clearSelectedBlock();
    setPageLinkDialog(null);
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
    });
  }

  function handlePageLinkOpen(node: NotePageLinkNode) {
    if (!documentCapabilities) {
      return;
    }

    if (node.pdfPageIndex == null) {
      showToast("PageLink has no saved page.");
      return;
    }

    onGoToPage(node.pdfPageIndex);
  }

  function findHeadingBlock(blockId: string | null | undefined) {
    const block = note?.blocks.find((candidate) => candidate.id === blockId) ?? null;
    return block && headingLevel(block) ? block : null;
  }

  function setHeadingReference(
    blockId: string,
    reference: Parameters<NoteEditorHandle["setHeadingReference"]>[1]
  ) {
    const updated = editorRef.current?.setHeadingReference(blockId, reference);
    if (!updated) {
      showToast("Unable to update heading reference.");
      return false;
    }

    return true;
  }

  function addHeadingPagemark() {
    if (!documentCapabilities) {
      closeMenu();
      return;
    }

    if (contextMenuState?.target !== "body" || !documentId || !currentPage) {
      showToast("Open a document page before adding a pagemark.");
      closeMenu();
      return;
    }

    const block = findHeadingBlock(contextMenuState.blockId);
    if (!block) {
      closeMenu();
      return;
    }

    setHeadingReference(
      block.id,
      createDirectHeadingReference({
        documentId,
        title: headingTitle(block),
        pageNumber: currentPage
      })
    );

    const existingBookmark = findBookmarkAtPage(bookmarks, currentPage);
    if (!existingBookmark) {
      onSetBookmarks([
        ...bookmarks,
        makeBookmark(currentPage, headingTitle(block))
      ]);
    }

    editorRef.current?.clearSelectedBlock();
    closeMenu();
  }

  function removeHeadingReference() {
    if (!documentCapabilities) {
      closeMenu();
      return;
    }

    if (contextMenuState?.target !== "body" && contextMenuState?.target !== "heading-reference") {
      return;
    }

    setHeadingReference(contextMenuState.blockId, null);
    editorRef.current?.clearSelectedBlock();
    closeMenu();
  }

  function handleHeadingReferenceOpen(
    reference: NonNullable<NoteDocument["blocks"][number]["sourceReference"]>
  ) {
    if (!documentCapabilities) {
      return;
    }

    const target = resolveSourceReferenceTarget(reference, outlineItems);
    if (!target) {
      showToast("This heading reference no longer has a page target.");
      return;
    }

    onNavigateToTarget(target);
  }

  function handleHeadingReferenceContextMenu(args: {
    blockId: string;
    blockType: Exclude<NoteBlockType, "paragraph">;
    clientX: number;
    clientY: number;
    reference: NonNullable<NoteDocument["blocks"][number]["sourceReference"]>;
  }) {
    if (!documentCapabilities) {
      return;
    }

    const paneElement = paneRef.current;
    if (!paneElement) {
      return;
    }

    closeInlineOverlays();
    openMenu({
      target: "heading-reference",
      blockId: args.blockId,
      blockType: args.blockType,
      sourceReference: args.reference,
      anchor: toPanePoint(args.clientX, args.clientY, paneElement)
    });
  }

  useEffect(() => {
    closeMenu();
    setPageLinkDialog(null);
    setNavigationOpen(false);
  }, [closeMenu, note?.id]);

  useEffect(() => {
    updateNotesScrollbar();
  }, [note?.id, loading]);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      return;
    }

    const handleScroll = () => {
      updateNotesScrollbar();
      revealScrollbar();
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const paneElement = paneRef.current;
    const scrollElement = scrollRef.current;
    const contentElement = contentRef.current;
    if (!paneElement || !scrollElement) {
      return;
    }

    const update = () => {
      updateNotesScrollbar();
    };

    update();
    window.addEventListener("resize", update);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateNotesScrollbar();
          });

    resizeObserver?.observe(scrollElement);
    if (contentElement) {
      resizeObserver?.observe(contentElement);
    }

    return () => {
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
    };
  }, [note?.id]);

  useEffect(() => {
    return () => {
      clearScrollbarHideTimer();
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pageLinkDialog) {
      return;
    }

    window.requestAnimationFrame(() => {
      pageLinkInputRef.current?.focus();
    });
  }, [pageLinkDialog]);

  useEffect(() => {
    setActiveFindIndex(0);
  }, [findQuery, note?.id]);

  useEffect(() => {
    if (!findOpen || findMatches.length === 0) {
      return;
    }

    if (activeFindIndex >= findMatches.length) {
      setActiveFindIndex(0);
      return;
    }

    const match = findMatches[activeFindIndex];
    if (!match) {
      return;
    }

    editorRef.current?.selectTextMatch(match.blockId, findQuery, match.occurrenceIndex);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
    });
  }, [activeFindIndex, findMatches, findOpen, findQuery]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (findOpen) {
          closeFindPanel();
          return;
        }
        if (pageLinkDialog) {
          setPageLinkDialog(null);
          return;
        }
        closeMenu();
      }
    }

    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeMenu, findOpen, pageLinkDialog]);

  useEffect(() => {
    function closeOnWindowPointerDown(event: PointerEvent) {
      if (contextMenuState && isMenuInteractiveTarget(event.target)) {
        return;
      }

      if (contextMenuState) {
        editorRef.current?.clearSelectedBlock();
        closeMenu();
      }

      if (pageLinkDialog && !isMenuInteractiveTarget(event.target)) {
        setPageLinkDialog(null);
      }

      if (navigationOpen && !isMenuInteractiveTarget(event.target)) {
        closeInlineOverlays();
      }
    }

    window.addEventListener("pointerdown", closeOnWindowPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnWindowPointerDown, true);
    };
  }, [closeMenu, contextMenuState, navigationOpen, pageLinkDialog]);

  useEffect(() => {
    const paneElement = paneRef.current;
    if (!paneElement) {
      return;
    }

    function rememberContextMenuPointerPosition(event: MouseEvent) {
      if (event.button !== 2 || !isContextMenuTarget(event.target)) {
        return;
      }

      lastContextMenuPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        timestamp: Date.now()
      };
    }

    function resolveAnchorClientPoint(event: MouseEvent) {
      const lastPointer = lastContextMenuPointerRef.current;
      const useLastPointer =
        Boolean(lastPointer) &&
        Date.now() - (lastPointer?.timestamp ?? 0) < 500;

      return useLastPointer
        ? { x: lastPointer!.x, y: lastPointer!.y }
        : { x: event.clientX, y: event.clientY };
    }

    function handlePaneContextMenu(event: MouseEvent) {
      if (!isContextMenuTarget(event.target)) {
        closeMenu();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      closeInlineOverlays();

      const anchorClientPoint = resolveAnchorClientPoint(event);
      const resolvedTarget =
        editorRef.current?.resolveContextMenuTargetAtPoint(anchorClientPoint.x, anchorClientPoint.y) ??
        null;

      if (!resolvedTarget) {
        editorRef.current?.clearSelectedBlock();
        closeMenu();
        return;
      }

      if (!documentCapabilities && resolvedTarget.target === "page-link") {
        editorRef.current?.clearSelectedBlock();
        closeMenu();
        return;
      }

      const anchor = toPanePoint(anchorClientPoint.x, anchorClientPoint.y, paneElement as HTMLElement);
      const nextState: NotesContextMenuState =
        resolvedTarget.target === "page-link"
          ? {
              target: "page-link",
              blockId: resolvedTarget.blockId,
              pageLinkId: resolvedTarget.pageLinkId,
              anchor
            }
          : {
              target: "body",
              blockId: resolvedTarget.blockId,
              blockType: resolvedTarget.blockType,
              canAddPageLink: resolvedTarget.canAddPageLink,
              sourceReference: resolvedTarget.sourceReference,
              anchor
            };

      openMenu(nextState);
    }

    paneElement.addEventListener("mousedown", rememberContextMenuPointerPosition, true);
    paneElement.addEventListener("contextmenu", handlePaneContextMenu, true);
    return () => {
      paneElement.removeEventListener("mousedown", rememberContextMenuPointerPosition, true);
      paneElement.removeEventListener("contextmenu", handlePaneContextMenu, true);
    };
  }, [closeMenu, openMenu]);

  useEffect(() => {
    function endScrollbarDrag(pointerId?: number) {
      const activeDrag = scrollbarDragRef.current;
      if (!activeDrag) {
        return;
      }

      if (typeof pointerId === "number" && activeDrag.pointerId !== pointerId) {
        return;
      }

      const thumbElement = thumbRef.current;
      if (thumbElement?.hasPointerCapture(activeDrag.pointerId)) {
        thumbElement.releasePointerCapture(activeDrag.pointerId);
      }
      scrollbarDragRef.current = null;
    }

    function handlePointerMove(event: PointerEvent) {
      const activeDrag = scrollbarDragRef.current;
      const scrollElement = scrollRef.current;
      const { maxScroll, maxThumbTop } = scrollbarMetricsRef.current;
      if (!activeDrag || !scrollElement || maxScroll <= 0 || maxThumbTop <= 0) {
        return;
      }

      if (event.pointerId !== activeDrag.pointerId) {
        return;
      }

      event.preventDefault();
      const deltaY = event.clientY - activeDrag.startClientY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      scrollElement.scrollTop = activeDrag.startScrollTop + scrollDelta;
    }

    function handlePointerUp(event: PointerEvent) {
      endScrollbarDrag(event.pointerId);
    }

    function handlePointerCancel(event: PointerEvent) {
      endScrollbarDrag(event.pointerId);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      endScrollbarDrag();
    };
  }, []);

  const notesHeaderTools = (
    <WorkspaceHeaderTools
      commandPaletteOpen={commandPaletteOpen}
      registerCommandPaletteAnchor={registerCommandPaletteAnchor}
      onToggleCommandPalette={() => {
        closeMenu();
        setNavigationOpen(false);
        setPageLinkDialog(null);
        onToggleCommandPalette();
      }}
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
      leading={
        <>
          <NavigationButton
            open={navigationOpen}
            onToggle={() => {
              closeMenu();
              setPageLinkDialog(null);
              setNavigationOpen((current) => !current);
            }}
          />
          {navigationOpen ? (
          <div className="notes-popover notes-popover--navigation">
            <div className="notes-popover__header notes-popover__header--navigation">
              <span className="notes-popover__header-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M7.2 4.75h6.6L18.25 9v10.05A1.2 1.2 0 0 1 17.05 20H7.2A1.2 1.2 0 0 1 6 18.8V5.95A1.2 1.2 0 0 1 7.2 4.75Z" />
                  <path d="M13.8 4.95V9h4.05" />
                  <path d="M9 12.2h6" />
                  <path d="M9 15.2h4.1" />
                </svg>
              </span>
              <p className="notes-popover__header-title">Navigation</p>
            </div>
            {navigationItems.length === 0 ? (
              <p className="notes-popover__empty">Add a heading to build note navigation.</p>
            ) : (
              <div className="notes-navigation">
                {navigationTree.map((node) => {
                  const isExpanded = expandedNavigationIds.has(node.item.id);
                  const hasChildren = node.children.length > 0;

                  return (
                    <div
                      key={node.item.id}
                      className={`notes-navigation__chapter${isExpanded ? " notes-navigation__chapter--expanded" : ""}`}
                    >
                      <div className="notes-navigation__chapter-header">
                        <button
                          className={`notes-navigation__chapter-row${isExpanded ? " notes-navigation__chapter-row--active" : ""}`}
                          type="button"
                          onClick={() => {
                            editorRef.current?.scrollToBlock(node.item.blockId);
                            setNavigationOpen(false);
                          }}
                        >
                          <span className="notes-navigation__chapter-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M7.2 4.75h6.6L18.25 9v10.05A1.2 1.2 0 0 1 17.05 20H7.2A1.2 1.2 0 0 1 6 18.8V5.95A1.2 1.2 0 0 1 7.2 4.75Z" />
                              <path d="M13.8 4.95V9h4.05" />
                              <path d="M9 12.2h6" />
                              <path d="M9 15.2h4.1" />
                            </svg>
                          </span>
                          <span className="notes-navigation__chapter-title">{node.item.title}</span>
                        </button>
                        {hasChildren ? (
                          <button
                            className={`notes-navigation__chapter-toggle${isExpanded ? " notes-navigation__chapter-toggle--expanded" : ""}`}
                            type="button"
                            aria-label={isExpanded ? "Collapse section" : "Expand section"}
                            aria-expanded={isExpanded}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleNavigationNode(node.item.id);
                            }}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d={isExpanded ? "m8 10 4 4 4-4" : "m10 8 4 4-4 4"} />
                            </svg>
                          </button>
                        ) : (
                          <span className="notes-navigation__chapter-spacer" aria-hidden="true" />
                        )}
                      </div>
                      {hasChildren && isExpanded ? renderNavigationBranch(node.children, 1) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          ) : null}
        </>
      }
    />
  );

  return (
    <aside
      ref={paneRef}
      className={`notes-pane${fullscreen ? " notes-pane--fullscreen" : ""}${
        scrollbarVisible ? " notes-pane--scrollbar-visible" : ""
      }`}
      aria-label="Notes"
      onKeyDownCapture={(event) => {
        const key = event.key.toLowerCase();
        const isFind = (event.metaKey || event.ctrlKey) && key === "f" && event.shiftKey;
        const isUndo = (event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey;
        const isRedo =
          (event.metaKey || event.ctrlKey) && ((key === "z" && event.shiftKey) || key === "y");

        if (isFind) {
          event.preventDefault();
          event.stopPropagation();
          openFindPanel();
          return;
        }

        if ((isUndo || isRedo) && !pageLinkDialog) {
          const handled = isUndo ? editorRef.current?.undo() : editorRef.current?.redo();
          if (handled) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        }

        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement | null)?.closest(".notes-pane__scrollbar")) {
          return;
        }
        if (contextMenuState && !isMenuInteractiveTarget(event.target)) {
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }
        event.stopPropagation();
      }}
      onWheelCapture={(event) => {
        event.stopPropagation();
      }}
    >
      {findOpen ? (
        <div className="notes-find-panel" role="dialog" aria-label="Find in note">
          <input
            ref={findInputRef}
            className="notes-find-panel__input"
            type="text"
            value={findQuery}
            placeholder="Find in note"
            spellCheck={false}
            onChange={(event) => {
              setFindQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeFindPanel();
                return;
              }

              if (event.key === "Enter") {
                event.preventDefault();
                moveFindSelection(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="notes-find-panel__count" aria-live="polite">
            {findQuery.trim()
              ? findMatches.length > 0
                ? `${activeFindIndex + 1} / ${findMatches.length}`
                : "0 / 0"
              : "0 / 0"}
          </span>
          <button
            className="notes-find-panel__button"
            type="button"
            aria-label="Previous match"
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(-1)}
          >
            ^
          </button>
          <button
            className="notes-find-panel__button"
            type="button"
            aria-label="Next match"
            disabled={findMatches.length === 0}
            onClick={() => moveFindSelection(1)}
          >
            v
          </button>
          <button
            className="notes-find-panel__button notes-find-panel__button--close"
            type="button"
            aria-label="Close find"
            onClick={closeFindPanel}
          >
            x
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="notes-pane__scroll-surface"
        onWheel={() => {
          revealScrollbar();
        }}
      >
        <div ref={contentRef} className="notes-pane__content">
          {note ? (
            <>
              {titleMode === "standalone" ? (
                <NoteTitleField
                  note={note}
                  loading={loading}
                  variant="standalone"
                  onChangeTitle={onChangeTitle}
                  onBlur={() => {
                    void onFlush();
                  }}
                  onEscape={() => {
                    editorRef.current?.focus();
                  }}
                  onSubmit={() => {
                    void onFlush();
                    editorRef.current?.focus();
                  }}
                />
              ) : null}
              <NoteEditor
                ref={editorRef}
                note={note}
                loading={loading}
                currentPage={currentPage}
                documentCapabilities={documentCapabilities}
                onChangeBlocks={onChangeBlocks}
                onBlur={() => {
                  void onFlush();
                }}
                onOpenPageLink={handlePageLinkOpen}
                onOpenHeadingReference={handleHeadingReferenceOpen}
                onOpenHeadingReferenceContextMenu={handleHeadingReferenceContextMenu}
              />
            </>
          ) : (
            <div className="notes-pane__empty">
            </div>
          )}
        </div>
      </div>

      <div
        className="notes-pane__scrollbar-zone"
        aria-hidden="true"
        onPointerEnter={() => {
          clearScrollbarHideTimer();
          setScrollbarVisible(true);
        }}
        onPointerLeave={() => {
          scheduleScrollbarHide(180);
        }}
      />

      <div
        ref={scrollbarRef}
        className="notes-pane__scrollbar"
        aria-hidden="true"
        onPointerEnter={() => {
          clearScrollbarHideTimer();
          setScrollbarVisible(true);
        }}
        onPointerLeave={() => {
          scheduleScrollbarHide(180);
        }}
        onPointerDown={(event) => {
          if (event.target === thumbRef.current) {
            return;
          }

          event.preventDefault();
          clearScrollbarHideTimer();
          setScrollbarVisible(true);
          const scrollbarElement = scrollbarRef.current;
          const { thumbHeight } = scrollbarMetricsRef.current;
          if (!scrollbarElement) {
            return;
          }

          const trackRect = scrollbarElement.getBoundingClientRect();
          const nextThumbTop = event.clientY - trackRect.top - thumbHeight / 2;
          scrollNotesToThumbTop(nextThumbTop);
        }}
      >
        <div
          ref={thumbRef}
          className="notes-pane__scrollbar-thumb"
          onPointerDown={(event) => {
            const scrollElement = scrollRef.current;
            if (!scrollElement) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            scrollbarDragRef.current = {
              pointerId: event.pointerId,
              startClientY: event.clientY,
              startScrollTop: scrollElement.scrollTop
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
        />
      </div>
      {headerActionsContainer ? createPortal(notesHeaderTools, headerActionsContainer) : null}

      {pageLinkDialog ? (
        <form
          className="notes-inline-dialog"
          role="dialog"
          aria-label={pageLinkDialog.mode === "insert" ? "Insert PageLink" : "Edit PageLink"}
          onSubmit={(event) => {
            event.preventDefault();
            submitPageLinkDialog();
          }}
        >
          <div className="notes-inline-dialog__header">
            <strong className="notes-inline-dialog__title">
              {pageLinkDialog.mode === "insert" ? "Add PageLink" : "Edit PageLink"}
            </strong>
            <button
              className="notes-inline-dialog__close"
              type="button"
              aria-label="Close PageLink dialog"
              onClick={() => {
                setPageLinkDialog(null);
              }}
            >
              x
            </button>
          </div>
          <p className="notes-inline-dialog__help">Enter the page number shown in the book.</p>
          <input
            ref={pageLinkInputRef}
            className="notes-inline-dialog__input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="40"
            value={pageLinkDialog.value}
            spellCheck={false}
            onChange={(event) => {
              setPageLinkDialog((current) =>
                current
                  ? {
                      ...current,
                      value: event.target.value,
                      error: null
                    }
                  : current
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setPageLinkDialog(null);
              }
            }}
          />
          {pageLinkDialog.error ? (
            <p className="notes-inline-dialog__error">{pageLinkDialog.error}</p>
          ) : null}
          <div className="notes-inline-dialog__actions">
            <button
              className="notes-inline-dialog__button"
              type="submit"
            >
              {pageLinkDialog.mode === "insert" ? "Insert" : "Save"}
            </button>
            <button
              className="notes-inline-dialog__button notes-inline-dialog__button--ghost"
              type="button"
              onClick={() => {
                setPageLinkDialog(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {toastMessage ? <div className="notes-pane__toast">{toastMessage}</div> : null}

      <NotesContextMenu
        documentCapabilities={documentCapabilities}
        state={contextMenuState}
        position={contextMenuPosition}
        submenuOpen={submenuOpen}
        submenuPlacement={submenuPlacement}
        menuRef={menuRef}
        submenuRef={submenuRef}
        submenuAnchorRef={submenuAnchorRef}
        onOpenSubmenu={openSubmenu}
        onScheduleCloseSubmenu={scheduleCloseSubmenu}
        onCopy={() => {
          editorRef.current?.copySelection();
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onCut={() => {
          editorRef.current?.cutSelection();
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onPaste={async () => {
          await editorRef.current?.pasteSelection();
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onAddPageLink={() => {
          setPageLinkDialog({
            mode: "insert",
            pageLinkId: null,
            value: "",
            error: null
          });
          closeMenu();
        }}
        onInsertSectionBreak={() => {
          if (contextMenuState?.target === "body") {
            editorRef.current?.insertSectionBreak({
              referenceBlockId: contextMenuState.blockId,
              position: "after"
            });
          }
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onAddHeadingPagemark={addHeadingPagemark}
        onRemoveHeadingReference={removeHeadingReference}
        onOpenPage={() => {
          if (contextMenuState?.target !== "page-link") {
            return;
          }
          const node = editorRef.current?.openPageLink(contextMenuState.pageLinkId);
          if (!node) {
            return;
          }
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onOpenHeadingReferencePage={() => {
          if (contextMenuState?.target !== "heading-reference") {
            return;
          }
          handleHeadingReferenceOpen(contextMenuState.sourceReference);
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onEditPageLink={() => {
          if (contextMenuState?.target !== "page-link") {
            return;
          }
          const node = editorRef.current?.getPageLink(contextMenuState.pageLinkId);
          if (!node) {
            showToast("Unable to edit PageLink.");
            return;
          }
          setPageLinkDialog({
            mode: "edit",
            pageLinkId: contextMenuState.pageLinkId,
            value:
              node.bookPageLabel.trim() ||
              (typeof node.pdfPageIndex === "number" ? String(node.pdfPageIndex) : ""),
            error: null
          });
          closeMenu();
        }}
        onCopyPageReference={() => {
          if (contextMenuState?.target !== "page-link") {
            return;
          }
          editorRef.current?.copyPageReference(contextMenuState.pageLinkId);
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onRemovePageLink={() => {
          if (contextMenuState?.target !== "page-link") {
            return;
          }
          editorRef.current?.removePageLink(contextMenuState.pageLinkId);
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
        onTurnInto={(type: NoteBlockType) => {
          void logNoteDebugEvent("notes.turn_into.menu_clicked", {
            blockId:
              contextMenuState?.target === "body" || contextMenuState?.target === "page-link"
                ? contextMenuState.blockId
                : null,
            noteId: note?.id ?? null,
            requestedType: type,
            target: contextMenuState?.target ?? null
          });
          if (contextMenuState?.target === "body") {
            editorRef.current?.turnInto(contextMenuState.blockId, type);
          }
          editorRef.current?.clearSelectedBlock();
          closeMenu();
        }}
      />
    </aside>
  );
});

export default NotesPane;
