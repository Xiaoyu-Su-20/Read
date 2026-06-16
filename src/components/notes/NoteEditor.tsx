import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";

import {
  captureEditorSelection,
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
  isSelectionInsidePageLinkAnchor,
  isPointWithinBlockContent,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  moveCaretAroundPageLink,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  pasteSelection,
  removePageLink,
  restoreEditorSelection,
  renderNoteBlocksHtml,
  replaceBlockElementType,
  selectTextMatchInBlock,
  selectPageLinkToken,
  insertPageLinkAtRange,
  updateBlockSourceReference,
  updatePageLinkTarget
} from "../../lib/noteEditorDom";
import { logNoteDebugEvent } from "../../lib/api";
import { computeCenteredChildScrollTop } from "./noteEditorScroll";
import {
  commitNoteHistoryState,
  createNoteHistoryState,
  redoNoteHistoryState,
  replaceCurrentHistorySelection,
  undoNoteHistoryState,
  type NoteHistoryState
} from "../../lib/noteHistory";
import type {
  NoteBlockType,
  DocumentSourceReference,
  NoteDocument,
  NoteHistoryMergeKey,
  NotePageLinkNode
} from "../../lib/types";

export type NoteEditorContextTarget =
  | {
      target: "body";
      blockId: string;
      blockType: NoteBlockType;
      canAddPageLink: boolean;
      sourceReference: DocumentSourceReference | null;
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
  focus: () => void;
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
  setHeadingReference: (blockId: string, sourceReference: DocumentSourceReference | null) => boolean;
  resolveContextMenuTargetAtPoint: (x: number, y: number) => NoteEditorContextTarget | null;
  clearSelectedBlock: () => void;
  selectTextMatch: (blockId: string, query: string, occurrenceIndex: number) => boolean;
  undo: () => boolean;
  redo: () => boolean;
};

type NoteEditorProps = {
  note: NoteDocument | null;
  loading: boolean;
  currentPage: number | null;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onBlur: () => void | Promise<void>;
  onOpenPageLink: (node: NotePageLinkNode) => void;
  onOpenHeadingReference: (reference: DocumentSourceReference) => void;
};

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { note, loading, currentPage, onChangeBlocks, onBlur, onOpenPageLink, onOpenHeadingReference },
  ref
) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const appliedNoteIdRef = useRef<string | null>(null);
  const selectedBlockIdRef = useRef<string | null>(null);
  const selectedPageLinkIdRef = useRef<string | null>(null);
  const pendingPageLinkRangeRef = useRef<Range | null>(null);
  const historyRef = useRef<NoteHistoryState | null>(null);
  const applyingHistoryRef = useRef(false);

  function inferHistoryMergeKeyFromInputType(inputType: string): NoteHistoryMergeKey | null {
    if (inputType === "insertFromPaste" || inputType === "insertFromDrop") {
      return "paste";
    }

    if (
      inputType === "insertText" ||
      inputType === "insertCompositionText" ||
      inputType === "insertParagraph" ||
      inputType === "insertLineBreak"
    ) {
      return "typing";
    }

    if (inputType.startsWith("delete")) {
      return "delete";
    }

    return null;
  }

  function blocksEqual(
    left: NoteDocument["blocks"],
    right: NoteDocument["blocks"]
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function captureHistoryHtml() {
    if (!bodyRef.current) {
      return "";
    }

    const snapshotRoot = bodyRef.current.cloneNode(true) as HTMLDivElement;
    snapshotRoot.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((element) => {
      delete element.dataset.selected;
    });
    return snapshotRoot.innerHTML;
  }

  function applyHistoryState(nextHistoryState: NoteHistoryState) {
    if (!bodyRef.current) {
      historyRef.current = nextHistoryState;
      return false;
    }

    applyingHistoryRef.current = true;
    try {
      historyRef.current = nextHistoryState;
      updateSelectedBlock(null);
      updateSelectedPageLink(null);
      pendingPageLinkRangeRef.current = null;
      bodyRef.current.innerHTML =
        nextHistoryState.current.html ?? renderNoteBlocksHtml(nextHistoryState.current.blocks);
      normalizeNoteEditorDom(bodyRef.current);
      restoreEditorSelection(bodyRef.current, nextHistoryState.current.selection);
      onChangeBlocks(nextHistoryState.current.blocks);
    } finally {
      applyingHistoryRef.current = false;
    }
    return true;
  }

  function updateHistorySelectionFromDom() {
    if (!bodyRef.current || !historyRef.current || applyingHistoryRef.current) {
      return;
    }

    historyRef.current = replaceCurrentHistorySelection(
      historyRef.current,
      captureEditorSelection(bodyRef.current)
    );
  }

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

  function focusEditorBody() {
    if (!bodyRef.current) {
      return;
    }

    try {
      bodyRef.current.focus({ preventScroll: true });
    } catch {
      bodyRef.current.focus();
    }
  }

  function syncBlocksFromDom(mergeKey?: NoteHistoryMergeKey | null) {
    if (!bodyRef.current) {
      return;
    }
    normalizeNoteEditorDom(bodyRef.current);
    const nextBlocks = parseNoteBlocksFromEditor(bodyRef.current);
    const nextSelection = captureEditorSelection(bodyRef.current);
    const nextHtml = captureHistoryHtml();
    const currentHistoryState = historyRef.current;

    if (!currentHistoryState) {
      historyRef.current = createNoteHistoryState({
        blocks: nextBlocks,
        selection: nextSelection,
        html: nextHtml
      });
      onChangeBlocks(nextBlocks);
      return;
    }

    if (blocksEqual(currentHistoryState.current.blocks, nextBlocks)) {
      const updatedHistoryState = replaceCurrentHistorySelection(currentHistoryState, nextSelection);
      historyRef.current = {
        ...updatedHistoryState,
        current: {
          ...updatedHistoryState.current,
          html: nextHtml
        }
      };
      return;
    }

    historyRef.current = commitNoteHistoryState(
      currentHistoryState,
      {
        blocks: nextBlocks,
        selection: nextSelection,
        html: nextHtml
      },
      {
        mergeKey: mergeKey ?? null
      }
    );
    onChangeBlocks(nextBlocks);
  }

  function performUndo() {
    const currentHistoryState = historyRef.current;
    if (!currentHistoryState) {
      return false;
    }

    updateHistorySelectionFromDom();
    const nextHistoryState = undoNoteHistoryState(historyRef.current ?? currentHistoryState);
    if (!nextHistoryState) {
      return false;
    }

    return applyHistoryState(nextHistoryState);
  }

  function performRedo() {
    const currentHistoryState = historyRef.current;
    if (!currentHistoryState) {
      return false;
    }

    updateHistorySelectionFromDom();
    const nextHistoryState = redoNoteHistoryState(historyRef.current ?? currentHistoryState);
    if (!nextHistoryState) {
      return false;
    }

    return applyHistoryState(nextHistoryState);
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

  function readSourceReference(block: HTMLElement) {
    const encoded = block.dataset.sourceReference;
    if (!encoded) {
      return null;
    }

    try {
      return JSON.parse(decodeURIComponent(encoded)) as DocumentSourceReference;
    } catch {
      return null;
    }
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
    const blockType = (resolvedBlock.dataset.blockType ?? "paragraph") as NoteBlockType;

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
      blockType,
      canAddPageLink,
      sourceReference: readSourceReference(resolvedBlock)
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
      historyRef.current = null;
      return;
    }

    if (appliedNoteIdRef.current === note.id) {
      return;
    }

    bodyRef.current.innerHTML = renderNoteBlocksHtml(note.blocks);
    normalizeNoteEditorDom(bodyRef.current);
    historyRef.current = createNoteHistoryState({
      blocks: note.blocks,
      selection: captureEditorSelection(bodyRef.current),
      html: captureHistoryHtml()
    });
    appliedNoteIdRef.current = note.id;
    updateSelectedBlock(null);
    updateSelectedPageLink(null);
    pendingPageLinkRangeRef.current = null;
  }, [note]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        if (!bodyRef.current) {
          return;
        }
        bodyRef.current.focus({ preventScroll: true });
      },
      scrollToBlock(blockId) {
        if (!bodyRef.current) {
          return;
        }

        const blockElement = findBlockElement(bodyRef.current, blockId);
        const scrollSurface = bodyRef.current.closest(".notes-pane__scroll-surface");
        if (!blockElement) {
          return;
        }

        if (!(scrollSurface instanceof HTMLDivElement)) {
          blockElement.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
          return;
        }

        const scrollRect = scrollSurface.getBoundingClientRect();
        const blockRect = blockElement.getBoundingClientRect();
        const blockTopWithinScrollSurface =
          scrollSurface.scrollTop + (blockRect.top - scrollRect.top);
        const nextScrollTop = computeCenteredChildScrollTop({
          childHeight: blockRect.height,
          childTop: blockTopWithinScrollSurface,
          containerHeight: scrollSurface.clientHeight,
          scrollHeight: scrollSurface.scrollHeight
        });

        scrollSurface.scrollTo({
          top: nextScrollTop,
          behavior: "smooth"
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
        syncBlocksFromDom("delete");
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
        syncBlocksFromDom("paste");
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
        syncBlocksFromDom("turn-into");
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
        syncBlocksFromDom("insert-page-link");
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
        syncBlocksFromDom("edit-page-link");
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
        syncBlocksFromDom("remove-page-link");
        return true;
      },
      copyPageReference(pageLinkId) {
        if (!bodyRef.current) {
          return;
        }
        copyPageLinkReference(bodyRef.current, pageLinkId);
      },
      setHeadingReference(blockId, sourceReference) {
        if (!bodyRef.current || !note) {
          return false;
        }

        const updated = updateBlockSourceReference(bodyRef.current, blockId, sourceReference, note.bookId);
        if (!updated) {
          return false;
        }

        syncBlocksFromDom("heading-reference");
        return true;
      },
      clearSelectedBlock() {
        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        if (bodyRef.current) {
          clearSelectedPageLink(bodyRef.current);
        }
        pendingPageLinkRangeRef.current = null;
      },
      selectTextMatch(blockId, query, occurrenceIndex) {
        if (!bodyRef.current) {
          return false;
        }

        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        return selectTextMatchInBlock(bodyRef.current, blockId, query, occurrenceIndex);
      },
      undo() {
        return performUndo();
      },
      redo() {
        return performRedo();
      }
    }),
    [currentPage, note, onChangeBlocks, onOpenHeadingReference, onOpenPageLink]
  );

  useEffect(() => {
    function syncSelectionIntoHistory() {
      updateHistorySelectionFromDom();
    }

    document.addEventListener("selectionchange", syncSelectionIntoHistory);
    return () => {
      document.removeEventListener("selectionchange", syncSelectionIntoHistory);
    };
  }, []);

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
          window.requestAnimationFrame(() => {
            syncBlocksFromDom("delete");
          });
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
          window.requestAnimationFrame(() => {
            syncBlocksFromDom("paste");
          });
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
          updateHistorySelectionFromDom();
          void onBlur();
        }}
        onInput={(event) => {
          const inputEvent = event.nativeEvent as InputEvent;
          syncBlocksFromDom(inferHistoryMergeKeyFromInputType(inputEvent.inputType));
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

          const headingReferenceTarget =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-heading-reference-indicator='true']")
              : null;
          if (headingReferenceTarget) {
            event.preventDefault();
            event.stopPropagation();
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
            focusEditorBody();
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

          const headingReferenceTarget =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-heading-reference-indicator='true']")
              : null;
          if (headingReferenceTarget) {
            const block = headingReferenceTarget.closest<HTMLElement>("[data-block-id]");
            const reference = block ? readSourceReference(block) : null;
            if (reference) {
              event.preventDefault();
              event.stopPropagation();
              onOpenHeadingReference(reference);
            }
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
          const inputEvent = event.nativeEvent as InputEvent;

          if (inputEvent.inputType === "historyUndo") {
            event.preventDefault();
            performUndo();
            return;
          }

          if (inputEvent.inputType === "historyRedo") {
            event.preventDefault();
            performRedo();
            return;
          }

          if (!bodyRef.current || !selectedPageLinkIdRef.current) {
            return;
          }

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

            syncBlocksFromDom(
              inputEvent.inputType.startsWith("delete") ? "remove-page-link" : "typing"
            );
          }
        }}
        onKeyDown={(event) => {
          if (!bodyRef.current) {
            return;
          }

          if (event.metaKey || event.ctrlKey) {
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) {
              event.preventDefault();
              performUndo();
              return;
            }

            if ((key === "z" && event.shiftKey) || key === "y") {
              event.preventDefault();
              performRedo();
              return;
            }
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

              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveCaretAroundPageLink(bodyRef.current, selectedPageLinkIdRef.current, "before");
                updateSelectedPageLink(null);
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveCaretAroundPageLink(bodyRef.current, selectedPageLinkIdRef.current, "after");
                updateSelectedPageLink(null);
                return;
              }

              if (event.key === "Backspace" || event.key === "Delete") {
                event.preventDefault();
                removePageLink(bodyRef.current, selectedPageLinkIdRef.current);
                updateSelectedPageLink(null);
                syncBlocksFromDom("remove-page-link");
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
                if (isSelectionInsidePageLinkAnchor(bodyRef.current)) {
                  removePageLink(bodyRef.current, pageLinkId);
                  updateSelectedPageLink(null);
                  syncBlocksFromDom("remove-page-link");
                } else {
                  updateSelectedPageLink(pageLinkId);
                }
                return;
              }
            }

            return;
          }

          const key = event.key.toLowerCase();
          if (key === "b") {
            event.preventDefault();
            document.execCommand("bold");
            window.requestAnimationFrame(() => {
              syncBlocksFromDom("format");
            });
          }

          if (key === "i") {
            event.preventDefault();
            document.execCommand("italic");
            window.requestAnimationFrame(() => {
              syncBlocksFromDom("format");
            });
          }
        }}
      />
    </div>
  );
});

export default NoteEditor;
