import { memo, useEffect, useRef, useState } from "react";

import { logNoteDebugEvent } from "../../lib/api";
import { parsePageLinkTargetInput } from "../../lib/notes";
import type { NoteBlockType, NoteDocument, NoteNavigationItem, NotePageLinkNode } from "../../lib/types";
import NotesContextMenu from "./context-menu/NotesContextMenu";
import { toPanePoint } from "./context-menu/menuPlacement";
import {
  useContextMenuController,
  type NotesContextMenuState
} from "./context-menu/useContextMenuController";
import NoteEditor, { type NoteEditorHandle } from "./NoteEditor";

type NotesPaneProps = {
  note: NoteDocument | null;
  loading: boolean;
  navigationItems: NoteNavigationItem[];
  onChangeTitle: (title: string) => void;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onFlush: () => void | Promise<void>;
  onCopyAllText: () => Promise<void>;
  onGoToPage: (page: number) => void;
  currentPage: number | null;
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

function NotesMoreMenuButton({
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
      aria-label="Open more note actions"
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="6.5" cy="12" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="17.5" cy="12" r="1.4" />
      </svg>
    </button>
  );
}

function isContextMenuTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(".note-editor"));
}

function isMenuInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        ".editor-context-menu, .block-type-submenu, .notes-inline-dialog, .notes-popover, .notes-rail, .notes-pane__scrollbar"
      )
    )
  );
}

const TOAST_DURATION_MS = 2400;

const NotesPane = memo(function NotesPane({
  note,
  loading,
  navigationItems,
  onChangeTitle,
  onChangeBlocks,
  onFlush,
  onCopyAllText,
  onGoToPage,
  currentPage
}: NotesPaneProps) {
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
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
  const lastContextMenuPointerRef = useRef<{
    x: number;
    y: number;
    timestamp: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pageLinkDialog, setPageLinkDialog] = useState<{
    mode: "insert" | "edit";
    pageLinkId: string | null;
    value: string;
    error: string | null;
  } | null>(null);
  const {
    state: contextMenuState,
    position: contextMenuPosition,
    submenuOpen,
    submenuDirection,
    menuRef,
    submenuRef,
    openMenu,
    closeMenu,
    openSubmenu,
    scheduleCloseSubmenu
  } = useContextMenuController({ paneRef });

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
      paneElement.style.setProperty("--notes-scrollbar-opacity", "0");
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
    paneElement.style.setProperty("--notes-scrollbar-opacity", "1");
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
    setMoreOpen(false);
    setRenamingTitle(false);
    setRenameDraft("");
    setPageLinkDialog(null);
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

  function submitRenameDialog() {
    if (!note) {
      setRenamingTitle(false);
      setRenameDraft("");
      return;
    }

    onChangeTitle(renameDraft);
    setRenamingTitle(false);
    setRenameDraft("");
    void onFlush();
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
  }

  function handlePageLinkOpen(node: NotePageLinkNode) {
    if (node.pdfPageIndex == null) {
      showToast("PageLink has no saved page.");
      return;
    }

    onGoToPage(node.pdfPageIndex);
  }

  useEffect(() => {
    closeMenu();
    closeInlineOverlays();
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
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!renamingTitle) {
      return;
    }

    window.requestAnimationFrame(() => {
      const input = renameInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    });
  }, [renamingTitle]);

  useEffect(() => {
    if (!pageLinkDialog) {
      return;
    }

    window.requestAnimationFrame(() => {
      pageLinkInputRef.current?.focus();
    });
  }, [pageLinkDialog]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pageLinkDialog) {
          setPageLinkDialog(null);
          return;
        }
        if (renamingTitle) {
          setRenamingTitle(false);
          setRenameDraft("");
          setMoreOpen(false);
          return;
        }
        closeMenu();
      }
    }

    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeMenu, pageLinkDialog, renamingTitle]);

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

      if (renamingTitle && !isMenuInteractiveTarget(event.target)) {
        setRenamingTitle(false);
        setRenameDraft("");
      }

      if ((navigationOpen || moreOpen) && !isMenuInteractiveTarget(event.target)) {
        closeInlineOverlays();
      }
    }

    window.addEventListener("pointerdown", closeOnWindowPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnWindowPointerDown, true);
    };
  }, [closeMenu, contextMenuState, moreOpen, navigationOpen, pageLinkDialog, renamingTitle]);

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
              canAddPageLink: resolvedTarget.canAddPageLink,
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

  return (
    <aside
      ref={paneRef}
      className="notes-pane"
      aria-label="Notes"
      onKeyDownCapture={(event) => {
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
      <div ref={scrollRef} className="notes-pane__scroll-surface">
        <div ref={contentRef} className="notes-pane__content">
          {note ? (
            <NoteEditor
              ref={editorRef}
              note={note}
              loading={loading}
              currentPage={currentPage}
              onChangeBlocks={onChangeBlocks}
              onBlur={() => {
                void onFlush();
              }}
              onOpenPageLink={handlePageLinkOpen}
            />
          ) : (
            <div className="notes-pane__empty">
              {loading ? "Loading note..." : "Open a document to start taking notes."}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollbarRef}
        className="notes-pane__scrollbar"
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.target === thumbRef.current) {
            return;
          }

          event.preventDefault();
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

      <div className="notes-rail" aria-label="Note tools">
        <div className="notes-rail__stack">
          <div className="notes-rail__item">
            <NavigationButton
              open={navigationOpen}
              onToggle={() => {
                closeMenu();
                setMoreOpen(false);
                setRenamingTitle(false);
                setRenameDraft("");
                setPageLinkDialog(null);
                setNavigationOpen((current) => !current);
              }}
            />
            {navigationOpen ? (
              <div className="notes-popover notes-popover--navigation">
                <span className="eyebrow">Navigation</span>
                {navigationItems.length === 0 ? (
                  <p className="notes-popover__empty">Add a heading to build note navigation.</p>
                ) : (
                  <div className="notes-navigation">
                    {navigationItems.map((item) => (
                      <button
                        key={item.id}
                        className={`notes-navigation__item notes-navigation__item--level-${item.level}`}
                        type="button"
                        onClick={() => {
                          editorRef.current?.scrollToBlock(item.blockId);
                          setNavigationOpen(false);
                        }}
                      >
                        {item.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="notes-rail__item">
            <NotesMoreMenuButton
              open={moreOpen}
              onToggle={() => {
                closeMenu();
                setNavigationOpen(false);
                setRenamingTitle(false);
                setRenameDraft("");
                setPageLinkDialog(null);
                setMoreOpen((current) => !current);
              }}
            />
            {moreOpen ? (
              <div className="notes-popover notes-popover--menu">
                <button
                  className="notes-popover__action"
                  type="button"
                  onClick={() => {
                    setNavigationOpen(false);
                    setMoreOpen(false);
                    setPageLinkDialog(null);
                    setRenameDraft(note?.title ?? "");
                    setRenamingTitle(true);
                  }}
                >
                  Rename note
                </button>
                <button
                  className="notes-popover__action"
                  type="button"
                  onClick={() => {
                    void onCopyAllText();
                    setMoreOpen(false);
                  }}
                >
                  Copy all text
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {renamingTitle ? (
        <div className="notes-inline-dialog notes-inline-dialog--rename" role="dialog" aria-label="Rename note">
          <div className="notes-inline-dialog__header">
            <strong className="notes-inline-dialog__title">Rename Note</strong>
            <button
              className="notes-inline-dialog__close"
              type="button"
              aria-label="Close rename dialog"
              onClick={() => {
                setRenamingTitle(false);
                setRenameDraft("");
              }}
            >
              x
            </button>
          </div>
          <p className="notes-inline-dialog__help">Enter a new note title.</p>
          <input
            ref={renameInputRef}
            className="notes-inline-dialog__input"
            type="text"
            value={renameDraft}
            spellCheck={false}
            placeholder="Untitled note"
            onChange={(event) => {
              setRenameDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setRenamingTitle(false);
                setRenameDraft("");
                return;
              }

              if (event.key !== "Enter") {
                return;
              }

              event.preventDefault();
              submitRenameDialog();
            }}
          />
          <div className="notes-inline-dialog__actions">
            <button
              className="notes-inline-dialog__button"
              type="button"
              onClick={() => {
                submitRenameDialog();
              }}
            >
              Save
            </button>
            <button
              className="notes-inline-dialog__button notes-inline-dialog__button--ghost"
              type="button"
              onClick={() => {
                setRenamingTitle(false);
                setRenameDraft("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pageLinkDialog ? (
        <div
          className="notes-inline-dialog"
          role="dialog"
          aria-label={pageLinkDialog.mode === "insert" ? "Insert PageLink" : "Edit PageLink"}
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
                setPageLinkDialog(null);
                return;
              }

              if (event.key !== "Enter") {
                return;
              }

              event.preventDefault();
              submitPageLinkDialog();
            }}
          />
          {pageLinkDialog.error ? (
            <p className="notes-inline-dialog__error">{pageLinkDialog.error}</p>
          ) : null}
          <div className="notes-inline-dialog__actions">
            <button
              className="notes-inline-dialog__button"
              type="button"
              onClick={() => {
                submitPageLinkDialog();
              }}
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
        </div>
      ) : null}

      {toastMessage ? <div className="notes-pane__toast">{toastMessage}</div> : null}

      <NotesContextMenu
        state={contextMenuState}
        position={contextMenuPosition}
        submenuOpen={submenuOpen}
        submenuDirection={submenuDirection}
        menuRef={menuRef}
        submenuRef={submenuRef}
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
