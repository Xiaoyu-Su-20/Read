import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";

import {
  captureBlockEndRange,
  clearSelectedPageLink,
  copyPageLinkReference,
  copySelection,
  cutSelection,
  findBlockElement,
  findClosestBlockElement,
  findPageLinkElement,
  getAdjacentPageLink,
  getBlockAtPoint,
  getBlockFromSelection,
  getPageLinkAtPoint,
  getSelectedText,
  handleCopy,
  handleCut,
  handlePaste,
  insertTextAtSelection,
  isPointWithinBlockContent,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  moveCaretAroundPageLink,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  pasteSelection,
  removePageLink,
  renderNoteBlocksHtml,
  replaceBlockElementType,
  selectPageLinkToken,
  insertPageLinkAtRange,
  updatePageLinkTarget
} from "../../lib/noteEditorDom";
import { logNoteDebugEvent } from "../../lib/api";
import type { NoteBlockType, NoteDocument, NotePageLinkNode } from "../../lib/types";

export type NoteEditorContextTarget =
  | {
      target: "body";
      blockId: string;
      canAddPageLink: boolean;
    }
  | {
      target: "page-link";
      blockId: string;
      pageLinkId: string;
    };

type PageLinkCommandResult =
  | { ok: true; node?: NotePageLinkNode }
  | { ok: false; message: string };

export type NoteEditorHandle = {
  scrollToBlock: (blockId: string) => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteSelection: () => Promise<void>;
  turnInto: (blockId: string, type: NoteBlockType) => void;
  insertPageLink: (pageNumber: number) => PageLinkCommandResult;
  openPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  getPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  editPageLink: (pageLinkId: string, pageNumber: number) => PageLinkCommandResult;
  removePageLink: (pageLinkId: string) => boolean;
  copyPageReference: (pageLinkId: string) => void;
  resolveContextMenuTargetAtPoint: (x: number, y: number) => NoteEditorContextTarget | null;
  clearSelectedBlock: () => void;
};

type NoteEditorProps = {
  note: NoteDocument | null;
  loading: boolean;
  currentPage: number | null;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onBlur: () => void | Promise<void>;
  onOpenPageLink: (node: NotePageLinkNode) => void;
};

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, loading, currentPage, onChangeBlocks, onBlur, onOpenPageLink },
  ref
) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const appliedNoteIdRef = useRef<string | null>(null);
  const selectedBlockIdRef = useRef<string | null>(null);
  const selectedPageLinkIdRef = useRef<string | null>(null);
  const pendingPageLinkRangeRef = useRef<Range | null>(null);

  function updateSelectedBlock(blockId: string | null) {
    selectedBlockIdRef.current = blockId;
  }

  function updateSelectedPageLink(pageLinkId: string | null) {
    selectedPageLinkIdRef.current = pageLinkId;
    if (!bodyRef.current) {
      return;
    }
    selectPageLinkToken(bodyRef.current, pageLinkId);
  }

  function syncBlocksFromDom() {
    if (!bodyRef.current) {
      return;
    }
    normalizeNoteEditorDom(bodyRef.current);
    onChangeBlocks(parseNoteBlocksFromEditor(bodyRef.current));
  }

  function readPageLinkNode(pageLinkId: string) {
    if (!bodyRef.current) {
      return null;
    }

    const pageLink = findPageLinkElement(bodyRef.current, pageLinkId);
    if (!pageLink) {
      return null;
    }

    const pdfPageIndex =
      pageLink.dataset.pdfPageIndex && pageLink.dataset.pdfPageIndex.length > 0
        ? Number.parseInt(pageLink.dataset.pdfPageIndex, 10)
        : NaN;

    return {
      type: "page-link" as const,
      id: pageLink.dataset.pageLinkId || pageLinkId,
      text: pageLink.textContent ?? "",
      documentId: pageLink.dataset.documentId?.trim() || null,
      pdfPageIndex: Number.isFinite(pdfPageIndex) ? pdfPageIndex : null,
      bookPageLabel: pageLink.dataset.bookPageLabel?.trim() || "",
      createdAt: pageLink.dataset.createdAt || new Date().toISOString()
    };
  }

  function resolveContextMenuTargetAtPoint(x: number, y: number) {
    if (!bodyRef.current) {
      return null;
    }

    normalizeNoteEditorDom(bodyRef.current);

    const pointPageLink = getPageLinkAtPoint(bodyRef.current, x, y);
    if (pointPageLink && isPointWithinPageLinkContent(bodyRef.current, pointPageLink, x, y)) {
      pendingPageLinkRangeRef.current = null;
      const block = findClosestBlockElement(bodyRef.current, pointPageLink);
      const pageLinkId = pointPageLink.dataset.pageLinkId ?? null;
      const blockId = block?.dataset.blockId ?? null;
      if (pageLinkId && blockId) {
        updateSelectedBlock(blockId);
        updateSelectedPageLink(pageLinkId);
        return {
          target: "page-link",
          blockId,
          pageLinkId
        } satisfies NoteEditorContextTarget;
      }
    }

    updateSelectedPageLink(null);

    const selectionResolvedBlock = getBlockFromSelection(bodyRef.current);
    const selectionContainsPoint = isPointWithinSelectionContent(bodyRef.current, x, y);
    const pointResolvedBlock = getBlockAtPoint(bodyRef.current, x, y);
    const pointResolvedContentBlock = pointResolvedBlock;

    let resolvedBlock = selectionContainsPoint ? selectionResolvedBlock : pointResolvedContentBlock;
    if (!resolvedBlock && pointResolvedContentBlock) {
      resolvedBlock = pointResolvedContentBlock;
    }

    if (!resolvedBlock || !pointResolvedContentBlock) {
      pendingPageLinkRangeRef.current = null;
      updateSelectedBlock(null);
      return null;
    }

    const blockId = resolvedBlock.dataset.blockId ?? null;
    if (!blockId) {
      pendingPageLinkRangeRef.current = null;
      updateSelectedBlock(null);
      return null;
    }

    const selectedText = getSelectedText(bodyRef.current).trim();
    const pointBlockText = pointResolvedContentBlock.textContent?.trim() ?? "";
    if (pointResolvedContentBlock.dataset.blockType === "paragraph" && pointBlockText.length === 0) {
      pendingPageLinkRangeRef.current = null;
      updateSelectedBlock(null);
      return null;
    }
    const canAddPageLink = pointResolvedContentBlock.dataset.blockType === "paragraph";

    pendingPageLinkRangeRef.current = canAddPageLink
      ? captureBlockEndRange(bodyRef.current, pointResolvedContentBlock)
      : null;

    updateSelectedBlock(blockId);
    void logNoteDebugEvent("notes.turn_into.context_menu_opened", {
      blockId,
      fallbackBlockId: selectionResolvedBlock?.dataset.blockId ?? null,
      noteId: note?.id ?? null,
      pointBlockId: pointResolvedContentBlock?.dataset.blockId ?? null,
      selectedText,
      target: "body",
      x,
      y
    });

    return {
      target: "body",
      blockId,
      canAddPageLink
    } satisfies NoteEditorContextTarget;
  }

  useEffect(() => {
    if (!bodyRef.current) {
      return;
    }

    if (!note) {
      bodyRef.current.innerHTML = "";
      appliedNoteIdRef.current = null;
      selectedBlockIdRef.current = null;
      selectedPageLinkIdRef.current = null;
      pendingPageLinkRangeRef.current = null;
      return;
    }

    if (appliedNoteIdRef.current === note.id) {
      return;
    }

    bodyRef.current.innerHTML = renderNoteBlocksHtml(note.blocks);
    appliedNoteIdRef.current = note.id;
    updateSelectedBlock(null);
    updateSelectedPageLink(null);
    pendingPageLinkRangeRef.current = null;
  }, [note]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBlock(blockId) {
        if (!bodyRef.current) {
          return;
        }
        findBlockElement(bodyRef.current, blockId)?.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });
      },
      copySelection() {
        if (!bodyRef.current) {
          return;
        }
        copySelection(bodyRef.current);
      },
      cutSelection() {
        if (!bodyRef.current) {
          return;
        }
        cutSelection(bodyRef.current);
        updateSelectedPageLink(null);
        syncBlocksFromDom();
      },
      async pasteSelection() {
        if (!bodyRef.current) {
          return;
        }
        if (selectedPageLinkIdRef.current) {
          removePageLink(bodyRef.current, selectedPageLinkIdRef.current);
          updateSelectedPageLink(null);
        }
        await pasteSelection(bodyRef.current);
        syncBlocksFromDom();
      },
      resolveContextMenuTargetAtPoint,
      turnInto(blockId, type) {
        if (!bodyRef.current) {
          void logNoteDebugEvent("notes.turn_into.skipped", {
            blockId,
            noteId: note?.id ?? null,
            reason: "missing-body-root",
            requestedType: type
          });
          return;
        }
        const beforeBlockType = findBlockElement(bodyRef.current, blockId)?.dataset.blockType ?? null;
        void logNoteDebugEvent("notes.turn_into.requested", {
          beforeBlockType,
          blockId,
          currentSelectedBlockId: selectedBlockIdRef.current,
          noteId: note?.id ?? null,
          requestedType: type
        });
        const replaced = replaceBlockElementType(bodyRef.current, blockId, type);
        const afterBlockType = findBlockElement(bodyRef.current, blockId)?.dataset.blockType ?? null;
        void logNoteDebugEvent("notes.turn_into.resolved", {
          afterBlockType,
          blockId,
          noteId: note?.id ?? null,
          replaced,
          requestedType: type
        });
        if (!replaced) {
          return;
        }
        syncBlocksFromDom();
      },
      insertPageLink(pageNumber) {
        if (!bodyRef.current || !note) {
          return {
            ok: false,
            message: "Unable to insert PageLink."
          };
        }

        if (currentPage == null || !Number.isInteger(currentPage) || currentPage <= 0) {
          return {
            ok: false,
            message: "Unable to determine the current PDF page for this PageLink."
          };
        }

        const insertionRange = pendingPageLinkRangeRef.current;
        if (!insertionRange) {
          return {
            ok: false,
            message: "Click inside a paragraph before adding a PageLink."
          };
        }

        const result = insertPageLinkAtRange(bodyRef.current, insertionRange, note, pageNumber, currentPage);
        if (!result.ok) {
          return result;
        }

        pendingPageLinkRangeRef.current = null;
        updateSelectedPageLink(result.node.id);
        syncBlocksFromDom();
        return result;
      },
      openPageLink(pageLinkId) {
        const node = readPageLinkNode(pageLinkId);
        if (!node) {
          return null;
        }
        onOpenPageLink(node);
        return node;
      },
      getPageLink(pageLinkId) {
        return readPageLinkNode(pageLinkId);
      },
      editPageLink(pageLinkId, pageNumber) {
        if (!bodyRef.current || !note) {
          return {
            ok: false,
            message: "Unable to update PageLink."
          };
        }

        const result = updatePageLinkTarget(bodyRef.current, pageLinkId, pageNumber);
        if (!result.ok) {
          return result;
        }

        updateSelectedPageLink(result.node.id);
        syncBlocksFromDom();
        return result;
      },
      removePageLink(pageLinkId) {
        if (!bodyRef.current) {
          return false;
        }

        const removed = removePageLink(bodyRef.current, pageLinkId);
        if (!removed) {
          return false;
        }
        updateSelectedPageLink(null);
        syncBlocksFromDom();
        return true;
      },
      copyPageReference(pageLinkId) {
        if (!bodyRef.current) {
          return;
        }
        copyPageLinkReference(bodyRef.current, pageLinkId);
      },
      clearSelectedBlock() {
        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        if (bodyRef.current) {
          clearSelectedPageLink(bodyRef.current);
        }
        pendingPageLinkRangeRef.current = null;
      }
    }),
    [currentPage, note, onChangeBlocks, onOpenPageLink]
  );

  return (
    <div className="note-editor">
      <div
        ref={bodyRef}
        className="note-editor__body"
        contentEditable={!loading}
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-label="Note body"
        onCopy={(event) => {
          if (!bodyRef.current) {
            return;
          }
          handleCopy(bodyRef.current, event.nativeEvent);
        }}
        onCut={(event) => {
          if (!bodyRef.current) {
            return;
          }
          handleCut(bodyRef.current, event.nativeEvent);
          updateSelectedPageLink(null);
          window.requestAnimationFrame(syncBlocksFromDom);
        }}
        onPaste={(event) => {
          if (!bodyRef.current) {
            return;
          }
          if (selectedPageLinkIdRef.current) {
            removePageLink(bodyRef.current, selectedPageLinkIdRef.current);
            updateSelectedPageLink(null);
          }
          handlePaste(bodyRef.current, event.nativeEvent);
          window.requestAnimationFrame(syncBlocksFromDom);
        }}
        onKeyDownCapture={(event) => {
          event.stopPropagation();
        }}
        onPointerDownCapture={(event) => {
          event.stopPropagation();
        }}
        onWheelCapture={(event) => {
          event.stopPropagation();
        }}
        onBlur={() => {
          void onBlur();
        }}
        onInput={() => {
          syncBlocksFromDom();
        }}
        onDoubleClick={(event) => {
          if (!bodyRef.current) {
            return;
          }

          const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-inline-type='page-link']") : null;
          const pageLinkId = target?.dataset.pageLinkId ?? null;
          if (!pageLinkId) {
            return;
          }

          event.preventDefault();
          updateSelectedPageLink(pageLinkId);
        }}
        onMouseDown={(event) => {
          if (!bodyRef.current) {
            return;
          }

          const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-inline-type='page-link']") : null;
          if (!target) {
            if (selectedPageLinkIdRef.current) {
              updateSelectedPageLink(null);
            }
            return;
          }

          if (event.button === 0) {
            event.preventDefault();
            const pageLinkId = target.dataset.pageLinkId ?? null;
            if (pageLinkId) {
              updateSelectedPageLink(pageLinkId);
            }
          }
        }}
        onClick={(event) => {
          if (!bodyRef.current) {
            return;
          }

          const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-inline-type='page-link']") : null;
          const pageLinkId = target?.dataset.pageLinkId ?? null;
          if (!pageLinkId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          updateSelectedPageLink(pageLinkId);
          const pageLink = findPageLinkElement(bodyRef.current, pageLinkId);
          if (!pageLink) {
            return;
          }
          const pdfPageIndex =
            pageLink.dataset.pdfPageIndex && pageLink.dataset.pdfPageIndex.length > 0
              ? Number.parseInt(pageLink.dataset.pdfPageIndex, 10)
              : NaN;
          const node: NotePageLinkNode = {
            type: "page-link",
            id: pageLink.dataset.pageLinkId || pageLinkId,
            text: pageLink.textContent ?? "",
            documentId: pageLink.dataset.documentId?.trim() || null,
            pdfPageIndex: Number.isFinite(pdfPageIndex) ? pdfPageIndex : null,
            bookPageLabel: pageLink.dataset.bookPageLabel?.trim() || "",
            createdAt: pageLink.dataset.createdAt || new Date().toISOString()
          };
          onOpenPageLink(node);
        }}
        onBeforeInput={(event) => {
          if (!bodyRef.current || !selectedPageLinkIdRef.current) {
            return;
          }

          const inputEvent = event.nativeEvent as InputEvent;
          const selectedPageLinkId = selectedPageLinkIdRef.current;

          if (
            inputEvent.inputType.startsWith("delete") ||
            inputEvent.inputType === "insertText" ||
            inputEvent.inputType === "insertParagraph" ||
            inputEvent.inputType === "insertLineBreak"
          ) {
            event.preventDefault();
            removePageLink(bodyRef.current, selectedPageLinkId);
            updateSelectedPageLink(null);

            if (inputEvent.inputType === "insertText" && typeof inputEvent.data === "string") {
              insertTextAtSelection(inputEvent.data);
            }

            if (
              inputEvent.inputType === "insertParagraph" ||
              inputEvent.inputType === "insertLineBreak"
            ) {
              insertTextAtSelection("\n");
            }

            syncBlocksFromDom();
          }
        }}
        onKeyDown={(event) => {
          if (!bodyRef.current) {
            return;
          }

          if (!(event.metaKey || event.ctrlKey)) {
            if (selectedPageLinkIdRef.current) {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveCaretAroundPageLink(bodyRef.current, selectedPageLinkIdRef.current, "before");
                updateSelectedPageLink(null);
                return;
              }

              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveCaretAroundPageLink(bodyRef.current, selectedPageLinkIdRef.current, "after");
                updateSelectedPageLink(null);
                return;
              }

              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                removePageLink(bodyRef.current, selectedPageLinkIdRef.current);
                updateSelectedPageLink(null);
                syncBlocksFromDom();
                return;
              }
            }

            if (event.key === "Backspace" || event.key === "Delete") {
              const adjacentPageLink = getAdjacentPageLink(
                bodyRef.current,
                event.key === "Backspace" ? "backward" : "forward"
              );
              const pageLinkId = adjacentPageLink?.dataset.pageLinkId ?? null;
              if (pageLinkId) {
                event.preventDefault();
                updateSelectedPageLink(pageLinkId);
                return;
              }
            }

            return;
          }

          const key = event.key.toLowerCase();
          if (key === "b") {
            event.preventDefault();
            document.execCommand("bold");
            window.requestAnimationFrame(syncBlocksFromDom);
          }

          if (key === "i") {
            event.preventDefault();
            document.execCommand("italic");
            window.requestAnimationFrame(syncBlocksFromDom);
          }
        }}
      />
    </div>
  );
});

export default NoteEditor;
