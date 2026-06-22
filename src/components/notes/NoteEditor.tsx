import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  useRef
} from "react";

import {
  captureEditorSelection,
  captureBlockEndRange,
  copySelectedBlock,
  clearSelectedPageLink,
  copyPageLinkReference,
  copySelection,
  cutSelection,
  findBlockElement,
  findClosestBlockElement,
  findPageLinkElement,
  findTopicCardElement,
  getSectionBreakAfterCaret,
  getSectionBreakBeforeCaret,
  getAdjacentPageLink,
  getBlockAtPoint,
  getBlockFromSelection,
  getPageLinkAtPoint,
  getTopicCardAtPoint,
  getSelectedText,
  handleCopy,
  handleCut,
  handlePaste,
  insertSectionBreak as insertSectionBreakBlock,
  insertTextAtSelection,
  isPointWithinTopicCardContent,
  isSelectionInsidePageLinkAnchor,
  isPointWithinBlockContent,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  moveCaretAroundPageLink,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  pasteSelection,
  removeBlock,
  removePageLink,
  restoreEditorSelection,
  renderNoteBlocksHtml,
  replaceBlockElementType,
  canTurnSelectionIntoTopicCard,
  selectBlockElement,
  selectTextMatchInBlock,
  selectPageLinkToken,
  selectTopicCardToken,
  turnSelectionIntoTopicCard,
  insertPageLinkAtRange,
  updatePageLinkTarget,
  updateTopicCard,
  removeTopicCard,
  readTopicCardFromElement
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
import { isSectionBreakBlockType } from "../../lib/notes";
import {
  DEFAULT_TOPIC_COLOR,
  MAX_TOPIC_LENGTH,
  normalizeTopicText,
  resolveTopicAppearance
} from "../../lib/paragraphTopics";
import type {
  InteractiveColorKey,
  NoteBlockType,
  NoteDocument,
  NoteHistoryMergeKey,
  NotePageLinkNode,
  ParagraphTopic
} from "../../lib/types";

export type NoteEditorContextTarget =
  | {
      target: "body";
      blockId: string;
      blockType: NoteBlockType;
      canAddPageLink: boolean;
      canTurnIntoTopicCard: boolean;
    }
  | {
      target: "page-link";
      blockId: string;
      pageLinkId: string;
    }
  | {
      target: "topic-card";
      blockId: string;
      topicId: string;
      topicColor: InteractiveColorKey;
    };

type PageLinkCommandResult =
  | { ok: true; node?: NotePageLinkNode }
  | { ok: false; message: string };

type TopicCommandResult =
  | { ok: true; topic: ParagraphTopic }
  | { ok: false; message: string };

export type NoteEditorHandle = {
  focus: () => void;
  scrollToBlock: (blockId: string) => void;
  copySelection: () => void;
  cutSelection: () => void;
  pasteSelection: () => Promise<void>;
  turnInto: (blockId: string, type: NoteBlockType) => void;
  insertSectionBreak: (args: { referenceBlockId: string; position: "before" | "after" }) => boolean;
  removeBlock: (blockId: string) => boolean;
  insertPageLink: (pageNumber: number) => PageLinkCommandResult;
  openPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  getPageLink: (pageLinkId: string) => NotePageLinkNode | null;
  editPageLink: (pageLinkId: string, pageNumber: number) => PageLinkCommandResult;
  removePageLink: (pageLinkId: string) => boolean;
  copyPageReference: (pageLinkId: string) => void;
  createTopicFromSelection: (color?: InteractiveColorKey) => TopicCommandResult;
  getTopic: (topicId: string) => ParagraphTopic | null;
  editTopic: (
    topicId: string,
    updates: Partial<Pick<ParagraphTopic, "text" | "color">>
  ) => TopicCommandResult;
  removeTopic: (topicId: string) => boolean;
  startTopicEdit: (topicId: string) => boolean;
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
  documentCapabilities: boolean;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onBlur: () => void | Promise<void>;
  onOpenPageLink: (node: NotePageLinkNode) => void;
};

function isHeadingBlockType(
  blockType: string | undefined
): blockType is Exclude<NoteBlockType, "paragraph" | "sectionBreak"> {
  return blockType === "heading1" || blockType === "heading2" || blockType === "heading3";
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  {
    note,
    loading,
    currentPage,
    documentCapabilities,
    onChangeBlocks,
    onBlur,
    onOpenPageLink
  },
  ref
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const appliedNoteIdRef = useRef<string | null>(null);
  const selectedBlockIdRef = useRef<string | null>(null);
  const selectedPageLinkIdRef = useRef<string | null>(null);
  const selectedTopicIdRef = useRef<string | null>(null);
  const pendingPageLinkRangeRef = useRef<Range | null>(null);
  const historyRef = useRef<NoteHistoryState | null>(null);
  const applyingHistoryRef = useRef(false);
  const topicEditorInputRef = useRef<HTMLInputElement | null>(null);
  const [topicEditor, setTopicEditor] = useState<{
    topicId: string;
    color: InteractiveColorKey;
    originalText: string;
    value: string;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);

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
      updateSelectedTopic(null);
      pendingPageLinkRangeRef.current = null;
      setTopicEditor(null);
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
    if (bodyRef.current) {
      selectBlockElement(bodyRef.current, blockId);
    }
  }

  function updateSelectedPageLink(pageLinkId: string | null) {
    selectedPageLinkIdRef.current = pageLinkId;
    if (!bodyRef.current) {
      return;
    }
    selectPageLinkToken(bodyRef.current, pageLinkId);
  }

  function updateSelectedTopic(topicId: string | null) {
    selectedTopicIdRef.current = topicId;
    if (!bodyRef.current) {
      return;
    }
    selectTopicCardToken(bodyRef.current, topicId);
  }

  function readTopic(topicId: string) {
    if (!bodyRef.current) {
      return null;
    }

    const element = findTopicCardElement(bodyRef.current, topicId);
    return element ? readTopicCardFromElement(element) : null;
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

  function measureTopicEditorRect(topicId: string) {
    if (!editorRef.current || !bodyRef.current) {
      return null;
    }

    const topicElement = findTopicCardElement(bodyRef.current, topicId);
    if (!topicElement) {
      return null;
    }

    const editorRect = editorRef.current.getBoundingClientRect();
    const topicRect = topicElement.getBoundingClientRect();

    return {
      left: topicRect.left - editorRect.left,
      top: topicRect.top - editorRect.top,
      width: Math.max(topicRect.width, 60),
      height: Math.max(topicRect.height, 28)
    };
  }

  function closeTopicEditor(options?: { restoreFocus?: boolean }) {
    setTopicEditor(null);
    if (options?.restoreFocus) {
      window.requestAnimationFrame(() => {
        focusEditorBody();
      });
    }
  }

  function beginTopicEdit(topicId: string) {
    const topic = readTopic(topicId);
    const rect = measureTopicEditorRect(topicId);
    if (!topic || !rect) {
      return false;
    }

    updateSelectedBlock(null);
    updateSelectedPageLink(null);
    updateSelectedTopic(topicId);
    setTopicEditor({
      topicId,
      color: topic.color,
      originalText: topic.text,
      value: topic.text,
      rect
    });
    return true;
  }

  function commitTopicMutation(
    topicId: string,
    updates: Partial<Pick<ParagraphTopic, "text" | "color">>,
    mergeKey: NoteHistoryMergeKey
  ): TopicCommandResult {
    if (!bodyRef.current) {
      return {
        ok: false,
        message: "Unable to update Topic card."
      };
    }

    const normalizedUpdates = {
      ...(typeof updates.text === "string" ? { text: normalizeTopicText(updates.text) } : {}),
      ...(updates.color ? { color: updates.color } : {})
    };
    const result = updateTopicCard(bodyRef.current, topicId, normalizedUpdates);
    if (!result.ok) {
      return result;
    }

    updateSelectedTopic(topicId);
    syncBlocksFromDom(mergeKey);
    return {
      ok: true,
      topic: result.topic
    };
  }

  function commitTopicEdit() {
    if (!topicEditor) {
      return;
    }

    const nextText = normalizeTopicText(topicEditor.value);
    if (!nextText || nextText.length > MAX_TOPIC_LENGTH) {
      closeTopicEditor({ restoreFocus: true });
      return;
    }

    const unchanged = nextText === topicEditor.originalText;
    if (unchanged) {
      closeTopicEditor({ restoreFocus: true });
      return;
    }

    commitTopicMutation(topicEditor.topicId, { text: nextText }, "edit-topic");
    closeTopicEditor({ restoreFocus: true });
  }

  function placeCaretAtBlockBoundary(blockId: string, boundary: "start" | "end") {
    if (!bodyRef.current) {
      return;
    }

    const block = findBlockElement(bodyRef.current, blockId);
    const selection = window.getSelection();
    if (!block || !selection) {
      return;
    }

    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(boundary === "start");
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function deleteSectionBreak(block: HTMLElement, direction: "backward" | "forward") {
    if (!bodyRef.current) {
      return false;
    }

    const blockId = block.dataset.blockId ?? null;
    if (!blockId) {
      return false;
    }

    const previousBlock = block.previousElementSibling instanceof HTMLElement ? block.previousElementSibling : null;
    const nextBlock = block.nextElementSibling instanceof HTMLElement ? block.nextElementSibling : null;
    const caretTarget = direction === "backward" ? nextBlock ?? previousBlock : previousBlock ?? nextBlock;
    const caretTargetId = caretTarget?.dataset.blockId ?? null;
    const caretBoundary = caretTarget === nextBlock ? "start" : "end";

    const removed = removeBlock(bodyRef.current, blockId);
    if (!removed) {
      return false;
    }

    updateSelectedBlock(null);
    updateSelectedPageLink(null);

    syncBlocksFromDom("delete");

    if (caretTargetId) {
      placeCaretAtBlockBoundary(caretTargetId, caretBoundary);
      updateHistorySelectionFromDom();
    }

    return true;
  }

  function preventHeadingBackwardMerge() {
    const editor = bodyRef.current;
    if (!editor) {
      return false;
    }

    function getHeadingAtCaretStart(currentEditor: HTMLElement) {
      const selection = window.getSelection();
      if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
        return null;
      }

      const range = selection.getRangeAt(0);

      if (range.startContainer === currentEditor) {
        for (let index = range.startOffset; index < currentEditor.childNodes.length; index += 1) {
          const node = currentEditor.childNodes[index];

          if (node?.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()) {
            continue;
          }

          if (
            node instanceof HTMLElement &&
            node.parentElement === currentEditor &&
            isHeadingBlockType(node.dataset.blockType)
          ) {
            return node;
          }

          return null;
        }

        return null;
      }

      const block = findClosestBlockElement(currentEditor, range.startContainer);
      if (!block || !isHeadingBlockType(block.dataset.blockType)) {
        return null;
      }

      const prefixRange = currentEditor.ownerDocument.createRange();
      prefixRange.selectNodeContents(block);

      try {
        prefixRange.setEnd(range.startContainer, range.startOffset);
      } catch {
        return null;
      }

      const textBeforeCaret = prefixRange.toString().replace(/[\u200B-\u200D\uFEFF]/g, "");
      return textBeforeCaret.length === 0 ? block : null;
    }

    const heading = getHeadingAtCaretStart(editor);
    if (!heading) {
      return false;
    }

    const previousBlock =
      heading.previousElementSibling instanceof HTMLElement
        ? heading.previousElementSibling
        : null;

    if (previousBlock) {
      const previousText = (previousBlock.textContent ?? "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();

      if (
        previousBlock.dataset.blockType === "paragraph" &&
        previousText.length === 0
      ) {
        const previousBlockId = previousBlock.dataset.blockId;
        const headingId = heading.dataset.blockId;

        if (previousBlockId && headingId) {
          removeBlock(editor, previousBlockId);
          placeCaretAtBlockBoundary(headingId, "start");
          syncBlocksFromDom("delete");
          updateHistorySelectionFromDom();
        }
      }
    }

    return true;
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

  function resolveContextMenuTargetAtPoint(x: number, y: number) {
    if (!bodyRef.current) {
      return null;
    }

    normalizeNoteEditorDom(bodyRef.current);

    const pointElement = bodyRef.current.ownerDocument.elementFromPoint(x, y);
    const pointSectionBreak =
      pointElement?.closest<HTMLElement>("[data-block-type='sectionBreak']") ?? null;
    if (pointSectionBreak && bodyRef.current.contains(pointSectionBreak)) {
      pendingPageLinkRangeRef.current = null;
      updateSelectedPageLink(null);
      const blockId = pointSectionBreak.dataset.blockId ?? null;
      if (!blockId) {
        updateSelectedBlock(null);
        return null;
      }

      updateSelectedBlock(blockId);
      return {
        target: "body",
        blockId,
        blockType: "sectionBreak",
        canAddPageLink: false,
        canTurnIntoTopicCard: false
      } satisfies NoteEditorContextTarget;
    }

    const pointTopicCard = getTopicCardAtPoint(bodyRef.current, x, y);
    if (pointTopicCard && isPointWithinTopicCardContent(bodyRef.current, pointTopicCard, x, y)) {
      pendingPageLinkRangeRef.current = null;
      const block = findClosestBlockElement(bodyRef.current, pointTopicCard);
      const topicId = pointTopicCard.dataset.topicId ?? null;
      const blockId = block?.dataset.blockId ?? null;
      const topicColor = pointTopicCard.dataset.topicColor as InteractiveColorKey | undefined;
      if (topicId && blockId && topicColor) {
        updateSelectedBlock(blockId);
        updateSelectedPageLink(null);
        updateSelectedTopic(topicId);
        return {
          target: "topic-card",
          blockId,
          topicId,
          topicColor
        } satisfies NoteEditorContextTarget;
      }
    }

    const pointPageLink = getPageLinkAtPoint(bodyRef.current, x, y);
    if (pointPageLink && isPointWithinPageLinkContent(bodyRef.current, pointPageLink, x, y)) {
      pendingPageLinkRangeRef.current = null;
      const block = findClosestBlockElement(bodyRef.current, pointPageLink);
      const pageLinkId = pointPageLink.dataset.pageLinkId ?? null;
      const blockId = block?.dataset.blockId ?? null;
      if (pageLinkId && blockId) {
        updateSelectedBlock(blockId);
        updateSelectedTopic(null);
        updateSelectedPageLink(pageLinkId);
        return {
          target: "page-link",
          blockId,
          pageLinkId
        } satisfies NoteEditorContextTarget;
      }
    }

    updateSelectedPageLink(null);
    updateSelectedTopic(null);

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
    const blockType = (resolvedBlock.dataset.blockType ?? "paragraph") as NoteBlockType;
    const blockHasPageLink = Boolean(
      pointResolvedContentBlock.querySelector("[data-inline-type='page-link']")
    );
    const canAddPageLink =
      !blockHasPageLink &&
      ((blockType === "paragraph" && pointBlockText.length > 0) ||
        blockType === "heading1" ||
        blockType === "heading2" ||
        blockType === "heading3");
    const canTurnIntoTopicCard = canTurnSelectionIntoTopicCard(bodyRef.current);

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
      canTurnIntoTopicCard
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
      selectedTopicIdRef.current = null;
      pendingPageLinkRangeRef.current = null;
      historyRef.current = null;
      setTopicEditor(null);
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
    updateSelectedTopic(null);
    pendingPageLinkRangeRef.current = null;
    setTopicEditor(null);
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
        if (selectedBlockIdRef.current) {
          const payload = copySelectedBlock(bodyRef.current, selectedBlockIdRef.current);
          if (payload) {
            document.execCommand("copy");
            return;
          }
        }
        copySelection(bodyRef.current);
      },
      cutSelection() {
        if (!bodyRef.current) {
          return;
        }
        if (selectedBlockIdRef.current) {
          const payload = copySelectedBlock(bodyRef.current, selectedBlockIdRef.current);
          if (payload) {
            document.execCommand("copy");
            removeBlock(bodyRef.current, selectedBlockIdRef.current);
            updateSelectedBlock(null);
            updateSelectedPageLink(null);
            syncBlocksFromDom("delete");
            return;
          }
        }
        cutSelection(bodyRef.current);
        updateSelectedPageLink(null);
        syncBlocksFromDom("delete");
      },
      async pasteSelection() {
        if (!bodyRef.current) {
          return;
        }
        if (selectedBlockIdRef.current) {
          const selectedBlock = findBlockElement(bodyRef.current, selectedBlockIdRef.current);
          const selectedBlockType = selectedBlock?.dataset.blockType as NoteBlockType | undefined;
          if (selectedBlockType && isSectionBreakBlockType(selectedBlockType)) {
            return;
          }
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
      insertSectionBreak(args) {
        if (!bodyRef.current) {
          return false;
        }

        const inserted = insertSectionBreakBlock(bodyRef.current, args);
        if (!inserted) {
          return false;
        }

        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        updateSelectedTopic(null);
        syncBlocksFromDom("turn-into");
        return true;
      },
      removeBlock(blockId) {
        if (!bodyRef.current) {
          return false;
        }

        const removed = removeBlock(bodyRef.current, blockId);
        if (!removed) {
          return false;
        }

        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        updateSelectedTopic(null);
        syncBlocksFromDom("delete");
        return true;
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
        updateSelectedTopic(null);
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
        updateSelectedTopic(null);
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
        updateSelectedTopic(null);
        syncBlocksFromDom("remove-page-link");
        return true;
      },
      copyPageReference(pageLinkId) {
        if (!bodyRef.current) {
          return;
        }
        copyPageLinkReference(bodyRef.current, pageLinkId);
      },
      createTopicFromSelection(color = DEFAULT_TOPIC_COLOR) {
        if (!bodyRef.current) {
          return {
            ok: false,
            message: "Unable to create Topic card."
          };
        }

        const result = turnSelectionIntoTopicCard(bodyRef.current, color);
        if (!result.ok) {
          return result;
        }

        updateSelectedBlock(result.blockId);
        updateSelectedPageLink(null);
        updateSelectedTopic(result.topicId);
        syncBlocksFromDom("insert-topic");
        return {
          ok: true,
          topic: result.topic
        };
      },
      getTopic(topicId) {
        return readTopic(topicId);
      },
      editTopic(topicId, updates) {
        const mergeKey = updates.color && !updates.text ? "recolor-topic" : "edit-topic";
        return commitTopicMutation(topicId, updates, mergeKey);
      },
      removeTopic(topicId) {
        if (!bodyRef.current) {
          return false;
        }

        const removed = removeTopicCard(bodyRef.current, topicId);
        if (!removed) {
          return false;
        }

        updateSelectedTopic(null);
        syncBlocksFromDom("remove-topic");
        return true;
      },
      startTopicEdit(topicId) {
        return beginTopicEdit(topicId);
      },
      clearSelectedBlock() {
        updateSelectedBlock(null);
        updateSelectedPageLink(null);
        updateSelectedTopic(null);
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
        updateSelectedTopic(null);
        return selectTextMatchInBlock(bodyRef.current, blockId, query, occurrenceIndex);
      },
      undo() {
        return performUndo();
      },
      redo() {
        return performRedo();
      }
    }),
    [currentPage, documentCapabilities, note, onChangeBlocks, onOpenPageLink]
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

  useLayoutEffect(() => {
    if (!bodyRef.current) {
      return;
    }

    bodyRef.current.querySelectorAll<HTMLElement>("[data-inline-type='topic-card']").forEach((element) => {
      if (topicEditor && element.dataset.topicId === topicEditor.topicId) {
        element.dataset.editing = "true";
      } else {
        delete element.dataset.editing;
      }
    });
  }, [topicEditor]);

  useLayoutEffect(() => {
    if (!topicEditor) {
      return;
    }

    const updateRect = () => {
      const nextRect = measureTopicEditorRect(topicEditor.topicId);
      if (!nextRect) {
        return;
      }

      setTopicEditor((current) =>
        current
          ? {
              ...current,
              rect: nextRect
            }
          : current
      );
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    return () => {
      window.removeEventListener("resize", updateRect);
    };
  }, [topicEditor?.topicId]);

  useEffect(() => {
    if (!topicEditor) {
      return;
    }

    window.requestAnimationFrame(() => {
      topicEditorInputRef.current?.focus();
      topicEditorInputRef.current?.select();
    });
  }, [topicEditor?.topicId]);

  return (
    <div ref={editorRef} className="note-editor">
      {topicEditor ? (
        <input
          ref={topicEditorInputRef}
          className="paragraph-topic-editor"
          type="text"
          value={topicEditor.value}
          maxLength={MAX_TOPIC_LENGTH}
          spellCheck={false}
          style={{
            ...resolveTopicAppearance(topicEditor.color),
            left: topicEditor.rect.left,
            top: topicEditor.rect.top,
            width: topicEditor.rect.width,
            minHeight: topicEditor.rect.height
          }}
          onChange={(event) => {
            setTopicEditor((current) =>
              current
                ? {
                    ...current,
                    value: event.target.value
                  }
                : current
            );
          }}
          onBlur={() => {
            commitTopicEdit();
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            const input = event.currentTarget;
            const selectionStart = input.selectionStart ?? input.value.length;
            const selectionEnd = input.selectionEnd ?? input.value.length;
            const nextValue =
              input.value.slice(0, selectionStart) + text + input.value.slice(selectionEnd);
            setTopicEditor((current) =>
              current
                ? {
                    ...current,
                    value: nextValue
                  }
                : current
            );
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeTopicEditor({ restoreFocus: true });
              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();
              commitTopicEdit();
            }
          }}
        />
      ) : null}
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
          if (selectedBlockIdRef.current) {
            const payload = copySelectedBlock(bodyRef.current, selectedBlockIdRef.current);
            if (payload && event.nativeEvent.clipboardData) {
              event.preventDefault();
              event.nativeEvent.clipboardData.setData("text/plain", payload.text);
              event.nativeEvent.clipboardData.setData("text/html", payload.html);
              event.nativeEvent.clipboardData.setData("application/x-calmreader-note-fragment", payload.internalHtml);
              return;
            }
          }
          handleCopy(bodyRef.current, event.nativeEvent);
        }}
        onCut={(event) => {
          if (!bodyRef.current) {
            return;
          }
          if (selectedBlockIdRef.current) {
            const payload = copySelectedBlock(bodyRef.current, selectedBlockIdRef.current);
            if (payload && event.nativeEvent.clipboardData) {
              event.preventDefault();
              event.nativeEvent.clipboardData.setData("text/plain", payload.text);
              event.nativeEvent.clipboardData.setData("text/html", payload.html);
              event.nativeEvent.clipboardData.setData("application/x-calmreader-note-fragment", payload.internalHtml);
              removeBlock(bodyRef.current, selectedBlockIdRef.current);
              updateSelectedBlock(null);
              updateSelectedPageLink(null);
              window.requestAnimationFrame(() => {
                syncBlocksFromDom("delete");
              });
              return;
            }
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
          updateSelectedTopic(null);
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
          if (!documentCapabilities || !bodyRef.current) {
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

          const breakBlock =
            event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>("[data-block-type='sectionBreak']")
              : null;
          if (breakBlock) {
            event.preventDefault();
            window.getSelection()?.removeAllRanges();
            focusEditorBody();
            updateSelectedPageLink(null);
            updateSelectedTopic(null);
            updateSelectedBlock(breakBlock.dataset.blockId ?? null);
            return;
          }

          const topicTarget =
            event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>("[data-inline-type='topic-card']")
              : null;
          if (topicTarget) {
            event.preventDefault();
            focusEditorBody();
            updateSelectedPageLink(null);
            updateSelectedBlock(findClosestBlockElement(bodyRef.current, topicTarget)?.dataset.blockId ?? null);
            updateSelectedTopic(topicTarget.dataset.topicId ?? null);
            return;
          }

          if (!documentCapabilities) {
            if (selectedTopicIdRef.current) {
              updateSelectedTopic(null);
            }
            if (selectedBlockIdRef.current) {
              updateSelectedBlock(null);
            }
            return;
          }

          const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-inline-type='page-link']") : null;
          if (!target) {
            if (selectedPageLinkIdRef.current) {
              updateSelectedPageLink(null);
            }
            if (selectedTopicIdRef.current) {
              updateSelectedTopic(null);
            }
            if (selectedBlockIdRef.current) {
              updateSelectedBlock(null);
            }
            return;
          }

          if (event.button === 0) {
            event.preventDefault();
            focusEditorBody();
            updateSelectedTopic(null);
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

          const topicTarget =
            event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>("[data-inline-type='topic-card']")
              : null;
          if (topicTarget) {
            event.preventDefault();
            event.stopPropagation();
            updateSelectedTopic(topicTarget.dataset.topicId ?? null);
            return;
          }

          if (!documentCapabilities) {
            return;
          }

          const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-inline-type='page-link']") : null;
          const pageLinkId = target?.dataset.pageLinkId ?? null;
          if (!pageLinkId) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          updateSelectedTopic(null);
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

          if (
            inputEvent.inputType === "deleteContentBackward" &&
            preventHeadingBackwardMerge()
          ) {
            event.preventDefault();
            return;
          }

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

          if (
            !(event.metaKey || event.ctrlKey) &&
            event.key === "Backspace" &&
            preventHeadingBackwardMerge()
          ) {
            event.preventDefault();
            event.stopPropagation();
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
            if (event.key === "Tab") {
              event.preventDefault();
              insertTextAtSelection("\t");
              syncBlocksFromDom("typing");
              return;
            }

            if (selectedBlockIdRef.current) {
              const selectedBlock = findBlockElement(bodyRef.current, selectedBlockIdRef.current);
              const selectedBlockType = selectedBlock?.dataset.blockType as NoteBlockType | undefined;
              if (selectedBlock && selectedBlockType && isSectionBreakBlockType(selectedBlockType)) {
                if (event.key === "Backspace" || event.key === "Delete") {
                  event.preventDefault();
                  deleteSectionBreak(
                    selectedBlock,
                    event.key === "Backspace" ? "backward" : "forward"
                  );
                  return;
                }

                if (
                  event.key === "ArrowLeft" ||
                  event.key === "ArrowRight" ||
                  event.key === "ArrowUp" ||
                  event.key === "ArrowDown"
                ) {
                  updateSelectedBlock(null);
                }
              }
            }

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

            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              const adjacentSectionBreak = getSectionBreakBeforeCaret(bodyRef.current);
              if (adjacentSectionBreak) {
                event.preventDefault();
                return;
              }
            }

            if (event.key === "Backspace" || event.key === "Delete") {
              const selection = window.getSelection();
              if (!selection || !selection.isCollapsed) {
                return;
              }

              const adjacentSectionBreak =
                event.key === "Backspace"
                  ? getSectionBreakBeforeCaret(bodyRef.current)
                  : getSectionBreakAfterCaret(bodyRef.current);
              if (adjacentSectionBreak) {
                event.preventDefault();
                deleteSectionBreak(
                  adjacentSectionBreak,
                  event.key === "Backspace" ? "backward" : "forward"
                );
                return;
              }

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
