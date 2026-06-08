import { memo, useEffect, useRef, useState } from "react";

import { logNoteDebugEvent } from "../../lib/api";
import type { NoteBlockType, NoteDocument, NoteNavigationItem, NotePageLinkNode } from "../../lib/types";
import NotesContextMenu from "./context-menu/NotesContextMenu";
import { toPanePoint } from "./context-menu/menuPlacement";
import {
  useContextMenuController,
  type NotesContextMenuState
} from "./context-menu/useContextMenuController";
import NoteEditor, { type NoteEditorHandle } from "./NoteEditor";
import NoteTitleField, { type NoteTitleFieldHandle } from "./NoteTitleField";

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

function NotesHeaderActions({
  navigationOpen,
  moreOpen,
  onToggleNavigation,
  onToggleMore
}: {
  navigationOpen: boolean;
  moreOpen: boolean;
  onToggleNavigation: () => void;
  onToggleMore: () => void;
}) {
  return (
    <div className="notes-header-actions">
      <NavigationButton open={navigationOpen} onToggle={onToggleNavigation} />
      <NotesMoreMenuButton open={moreOpen} onToggle={onToggleMore} />
    </div>
  );
}

function isContextMenuTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest(".note-editor, .notes-title-row__input"))
  );
}

function isMenuInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest(".editor-context-menu, .block-type-submenu, .notes-inline-dialog"))
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
  const titleFieldRef = useRef<NoteTitleFieldHandle | null>(null);
  const paneRef = useRef<HTMLElement | null>(null);
  const lastContextMenuPointerRef = useRef<{
    x: number;
    y: number;
    timestamp: number;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [editingPageLink, setEditingPageLink] = useState<{
    pageLinkId: string;
    text: string;
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
    setEditingPageLink(null);
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
      titleFieldRef.current?.focusAndSelect();
    });
  }, [renamingTitle]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (editingPageLink) {
          setEditingPageLink(null);
          return;
        }
        if (renamingTitle) {
          setRenamingTitle(false);
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
  }, [closeMenu, editingPageLink, renamingTitle]);

  useEffect(() => {
    function closeOnWindowPointerDown(event: PointerEvent) {
      if (contextMenuState && isMenuInteractiveTarget(event.target)) {
        return;
      }

      if (contextMenuState) {
        editorRef.current?.clearSelectedBlock();
        closeMenu();
      }

      if (editingPageLink && !isMenuInteractiveTarget(event.target)) {
        setEditingPageLink(null);
      }
    }

    window.addEventListener("pointerdown", closeOnWindowPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnWindowPointerDown, true);
    };
  }, [closeMenu, contextMenuState, editingPageLink]);

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
      const titleTarget =
        event.target instanceof HTMLElement
          ? event.target.closest(".notes-title-row__input")
          : null;
      const resolvedTarget = titleTarget
        ? ({ target: "title" } as const)
        : editorRef.current?.resolveContextMenuTargetAtPoint(
            anchorClientPoint.x,
            anchorClientPoint.y
          ) ?? null;

      if (!resolvedTarget) {
        editorRef.current?.clearSelectedBlock();
        closeMenu();
        return;
      }

      const anchor = toPanePoint(anchorClientPoint.x, anchorClientPoint.y, paneElement as HTMLElement);
      const nextState: NotesContextMenuState =
        resolvedTarget.target === "title"
          ? {
              target: "title",
              anchor
            }
          : resolvedTarget.target === "page-link"
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
                selectedText: resolvedTarget.selectedText,
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

  return (
    <aside
      ref={paneRef}
      className="notes-pane"
      aria-label="Notes"
      onKeyDownCapture={(event) => {
        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => {
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
      <header className="notes-pane__header">
        {renamingTitle ? (
          <NoteTitleField
            ref={titleFieldRef}
            note={note}
            loading={loading}
            onChangeTitle={onChangeTitle}
            onBlur={() => {
              setRenamingTitle(false);
              void onFlush();
            }}
            onEscape={() => {
              setRenamingTitle(false);
            }}
            onSubmit={() => {
              setRenamingTitle(false);
              void onFlush();
            }}
          />
        ) : (
          <div className="notes-title-row notes-title-row--hidden" aria-hidden="true" />
        )}
        <NotesHeaderActions
          navigationOpen={navigationOpen}
          moreOpen={moreOpen}
          onToggleNavigation={() => {
            closeMenu();
            setMoreOpen(false);
            setRenamingTitle(false);
            setEditingPageLink(null);
            setNavigationOpen((current) => !current);
          }}
          onToggleMore={() => {
            closeMenu();
            setNavigationOpen(false);
            setRenamingTitle(false);
            setEditingPageLink(null);
            setMoreOpen((current) => !current);
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

        {moreOpen ? (
          <div className="notes-popover notes-popover--menu">
            <button
              className="notes-popover__action"
              type="button"
              onClick={() => {
                setNavigationOpen(false);
                setMoreOpen(false);
                setEditingPageLink(null);
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

        {editingPageLink ? (
          <div className="notes-inline-dialog" role="dialog" aria-label="Edit PageLink">
            <input
              className="notes-inline-dialog__input"
              type="text"
              value={editingPageLink.text}
              spellCheck={false}
              onChange={(event) => {
                setEditingPageLink((current) =>
                  current
                    ? {
                        ...current,
                        text: event.target.value
                      }
                    : current
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setEditingPageLink(null);
                  return;
                }

                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                const current = editingPageLink;
                if (!current) {
                  return;
                }
                const result = editorRef.current?.editPageLink(current.pageLinkId, current.text);
                if (!result) {
                  return;
                }
                if (!result.ok) {
                  showToast(result.message);
                  return;
                }
                setEditingPageLink(null);
              }}
            />
            <div className="notes-inline-dialog__actions">
              <button
                className="notes-inline-dialog__button"
                type="button"
                onClick={() => {
                  const current = editingPageLink;
                  if (!current) {
                    return;
                  }
                  const result = editorRef.current?.editPageLink(current.pageLinkId, current.text);
                  if (!result) {
                    return;
                  }
                  if (!result.ok) {
                    showToast(result.message);
                    return;
                  }
                  setEditingPageLink(null);
                }}
              >
                Save
              </button>
              <button
                className="notes-inline-dialog__button notes-inline-dialog__button--ghost"
                type="button"
                onClick={() => {
                  setEditingPageLink(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </header>

      <div className="notes-pane__scroll-surface">
        <div className="notes-pane__content">
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
          const result = editorRef.current?.addPageLinkFromSelection();
          if (!result) {
            return;
          }
          if (!result.ok) {
            showToast(result.message);
            return;
          }
          editorRef.current?.clearSelectedBlock();
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
          const currentText = editorRef.current?.getPageLinkText(contextMenuState.pageLinkId) ?? "";
          setEditingPageLink({
            pageLinkId: contextMenuState.pageLinkId,
            text: currentText
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
