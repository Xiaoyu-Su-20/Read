import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";

import {
  captureEditorSelection,
  copySelectedBlock,
  clearSelectedPageLink,
  copyPageLinkReference,
  copySelection,
  cutSelection,
  findBlockElement,
  findClosestBlockElement,
  findPageLinkElement,
  findTopicCardElement,
  getAdjacentPageLink,
  getBlockAtPoint,
  getBlockFromSelection,
  getPageLinkAtPoint,
  getTopicCardAtPoint,
  getSelectedText,
  handleCopy,
  handleCut,
  handlePaste,
  insertTextAtSelection,
  isPointWithinTopicCardContent,
  isSelectionInsidePageLinkAnchor,
  isPointWithinBlockContent,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  moveCaretAroundPageLink,
  normalizeCollapsedSelectionNearPageLink,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  pasteSelection,
  removeBlock,
  removePageLink,
  restoreEditorSelection,
  renderNoteBlocksHtml,
  replaceBlockElementType,
  resolveCollapsedRangeAtPoint,
  resolvePageLinkBoundarySelection,
  resolvePageLinkBoundarySelectionAtPoint,
  projectPageLinkBoundarySelection,
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
import { debugAction } from "../../lib/debugLog";
import { computeCenteredChildScrollTop } from "./noteEditorScroll";
import {
  commitNoteHistoryState,
  createNoteHistoryState,
  redoNoteHistoryState,
  replaceCurrentHistorySelection,
  undoNoteHistoryState,
  type NoteHistoryState
} from "../../lib/noteHistory";
import {
  DEFAULT_TOPIC_COLOR,
  normalizeTopicText
} from "../../lib/paragraphTopics";
import {
  canonicalSpellcheckWord,
  extractStandaloneSpellcheckWord
} from "../../lib/spellcheck";
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
      canInsertPageLinkAtPoint: boolean;
      canCreateTopicCardFromSelection: boolean;
      spellcheckWord: string | null;
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
  resolveContextMenuTargetAtPoint: (x: number, y: number) => NoteEditorContextTarget | null;
  clearSelectedBlock: () => void;
  selectTextMatch: (blockId: string, query: string, occurrenceIndex: number) => boolean;
  undo: () => boolean;
  redo: () => boolean;
};

type NoteEditorProps = {
  note: NoteDocument | null;
  loading: boolean;
  ignoredSpellcheckWords: string[];
  currentPage: number | null;
  documentCapabilities: boolean;
  onChangeBlocks: (blocks: NoteDocument["blocks"]) => void;
  onBlur: () => void | Promise<void>;
  onOpenPageLink: (node: NotePageLinkNode) => void;
};

const IGNORED_SPELLCHECK_SELECTOR = "[data-ignored-spellcheck-word='true']";

function isHeadingBlockType(
  blockType: string | undefined
): blockType is Exclude<NoteBlockType, "paragraph"> {
  return blockType === "heading1" || blockType === "heading2" || blockType === "heading3";
}

function unwrapIgnoredSpellcheckWords(root: ParentNode) {
  if (!(root instanceof Element || root instanceof DocumentFragment)) {
    return;
  }

  root.querySelectorAll<HTMLElement>(IGNORED_SPELLCHECK_SELECTOR).forEach((element) => {
    element.replaceWith(...Array.from(element.childNodes));
  });
}

function applyIgnoredSpellcheckWords(root: HTMLElement, ignoredWords: ReadonlySet<string>) {
  unwrapIgnoredSpellcheckWords(root);
  if (ignoredWords.size === 0) {
    return;
  }

  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!(node instanceof Text) || !(node.parentElement instanceof HTMLElement)) {
      continue;
    }

    const text = node.textContent ?? "";
    if (!text.trim().length) {
      continue;
    }

    if (
      node.parentElement.closest("[data-inline-type='page-link'], [data-inline-type='topic-card']") ||
      node.parentElement.closest(IGNORED_SPELLCHECK_SELECTOR)
    ) {
      continue;
    }

    textNodes.push(node);
  }

  const wordPattern = /[\p{L}\p{N}](?:[\p{L}\p{N}'’_-]*[\p{L}\p{N}])?|[\p{L}\p{N}]/gu;
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const matches = Array.from(text.matchAll(wordPattern)).filter((match) =>
      ignoredWords.has(canonicalSpellcheckWord(match[0]))
    );
    if (matches.length === 0) {
      continue;
    }

    const fragment = ownerDocument.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      const word = match[0];
      const start = match.index ?? 0;
      const end = start + word.length;
      if (start > cursor) {
        fragment.append(text.slice(cursor, start));
      }

      const wrapper = ownerDocument.createElement("span");
      wrapper.dataset.ignoredSpellcheckWord = "true";
      wrapper.setAttribute("spellcheck", "false");
      wrapper.textContent = word;
      fragment.append(wrapper);
      cursor = end;
    }

    if (cursor < text.length) {
      fragment.append(text.slice(cursor));
    }

    textNode.replaceWith(fragment);
  }
}

const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  {
    note,
    loading,
    ignoredSpellcheckWords,
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
  const suppressedPageLinkClickIdRef = useRef<string | null>(null);
  const pendingPageLinkRangeRef = useRef<Range | null>(null);
  const historyRef = useRef<NoteHistoryState | null>(null);
  const applyingHistoryRef = useRef(false);
  const ignoredSpellcheckWordSet = useMemo(
    () => new Set(ignoredSpellcheckWords.map((word) => canonicalSpellcheckWord(word))),
    [ignoredSpellcheckWords]
  );

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
    unwrapIgnoredSpellcheckWords(snapshotRoot);
    snapshotRoot.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((element) => {
      delete element.dataset.selected;
    });
    return snapshotRoot.innerHTML;
  }

  function decorateIgnoredSpellcheckWords() {
    if (!bodyRef.current) {
      return;
    }

    applyIgnoredSpellcheckWords(bodyRef.current, ignoredSpellcheckWordSet);
  }

  function prepareBodyForStructuredOperations() {
    if (!bodyRef.current) {
      return;
    }

    unwrapIgnoredSpellcheckWords(bodyRef.current);
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
      bodyRef.current.innerHTML =
        nextHistoryState.current.html ?? renderNoteBlocksHtml(nextHistoryState.current.blocks);
      normalizeNoteEditorDom(bodyRef.current);
      restoreEditorSelection(bodyRef.current, nextHistoryState.current.selection);
      onChangeBlocks(nextHistoryState.current.blocks);
      decorateIgnoredSpellcheckWords();
    } finally {
      applyingHistoryRef.current = false;
    }
    return true;
  }

  function updateHistorySelectionFromDom() {
    if (!bodyRef.current || !historyRef.current || applyingHistoryRef.current) {
      return;
    }

    prepareBodyForStructuredOperations();
    historyRef.current = replaceCurrentHistorySelection(
      historyRef.current,
      captureEditorSelection(bodyRef.current)
    );
    decorateIgnoredSpellcheckWords();
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

  function resolveCurrentPageLinkBoundary() {
    if (!bodyRef.current) {
      return null;
    }

    return resolvePageLinkBoundarySelection(bodyRef.current);
  }

  function handlePageLinkBoundaryTextInsertion(inputEvent: InputEvent) {
    if (!bodyRef.current || selectedPageLinkIdRef.current) {
      return false;
    }

    if (
      inputEvent.inputType !== "insertText" &&
      inputEvent.inputType !== "insertParagraph" &&
      inputEvent.inputType !== "insertLineBreak"
    ) {
      return false;
    }

    const boundary = resolveCurrentPageLinkBoundary();
    if (!boundary) {
      return false;
    }

    projectPageLinkBoundarySelection(bodyRef.current, boundary);
    updateSelectedBlock(null);
    updateSelectedTopic(null);
    updateSelectedPageLink(null);

    if (inputEvent.inputType === "insertText" && typeof inputEvent.data === "string") {
      insertTextAtSelection(inputEvent.data);
    } else {
      insertTextAtSelection("\n");
    }

    syncBlocksFromDom("typing");
    return true;
  }

  function handlePageLinkBoundaryDeleteIntent(direction: "backward" | "forward") {
    if (!bodyRef.current || selectedPageLinkIdRef.current) {
      return false;
    }

    const boundary = resolveCurrentPageLinkBoundary();
    if (!boundary) {
      return false;
    }

    const targetsPageLink =
      (direction === "backward" && boundary.edge === "after") ||
      (direction === "forward" && boundary.edge === "before");
    if (!targetsPageLink) {
      return false;
    }

    updateSelectedBlock(null);
    updateSelectedTopic(null);
    updateSelectedPageLink(boundary.pageLinkId);
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

  function getHeadingAtCaretStart(currentEditor: HTMLElement) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const block = findClosestBlockElement(currentEditor, range.startContainer);
    if (!block || !isHeadingBlockType(block.dataset.blockType)) {
      return null;
    }

    const prefixRange = currentEditor.ownerDocument.createRange();
    try {
      prefixRange.setStart(block, 0);
      prefixRange.setEnd(range.startContainer, range.startOffset);
    } catch {
      return null;
    }

    const textBeforeCaret = prefixRange.toString().replace(/[\u200B-\u200D\uFEFF\s]/g, "");
    return textBeforeCaret.length === 0 ? block : null;
  }

  function handleHeadingStartBackspace() {
    const editor = bodyRef.current;
    if (!editor) {
      return false;
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
      const previousBlockType = previousBlock.dataset.blockType as NoteBlockType | undefined;
      const previousText = (previousBlock.textContent ?? "")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();

      if (previousBlockType === "paragraph" && previousText.length === 0) {
        const previousBlockId = previousBlock.dataset.blockId;
        const headingId = heading.dataset.blockId;

        if (previousBlockId && headingId) {
          removeBlock(editor, previousBlockId);
          placeCaretAtBlockBoundary(headingId, "start");
          syncBlocksFromDom("delete");
          updateHistorySelectionFromDom();
          return true;
        }
      }

      return true;
    }

    return false;
  }

  function syncBlocksFromDom(mergeKey?: NoteHistoryMergeKey | null) {
    if (!bodyRef.current) {
      return;
    }
    prepareBodyForStructuredOperations();
    const selectionBeforeNormalization = captureEditorSelection(bodyRef.current);
    normalizeNoteEditorDom(bodyRef.current);
    if (selectionBeforeNormalization) {
      restoreEditorSelection(bodyRef.current, selectionBeforeNormalization);
    }
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
      decorateIgnoredSpellcheckWords();
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
      decorateIgnoredSpellcheckWords();
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
    decorateIgnoredSpellcheckWords();
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
    const selectedText = getSelectedText(bodyRef.current).trim();
    const hasSelectedText = selectedText.length > 0;
    const selectionContainsPoint = isPointWithinSelectionContent(bodyRef.current, x, y);
    const pointResolvedBlock = getBlockAtPoint(bodyRef.current, x, y);
    const pointResolvedContentBlock = pointResolvedBlock;
    const selectionMatchesPointBlock =
      Boolean(selectionResolvedBlock) &&
      Boolean(pointResolvedContentBlock) &&
      selectionResolvedBlock?.dataset.blockId === pointResolvedContentBlock?.dataset.blockId;
    const preserveTextSelection =
      hasSelectedText && (selectionContainsPoint || selectionMatchesPointBlock);

    let resolvedBlock = preserveTextSelection ? selectionResolvedBlock : pointResolvedContentBlock;
    if (!resolvedBlock && pointResolvedContentBlock) {
      resolvedBlock = pointResolvedContentBlock;
    }
    if (!resolvedBlock && hasSelectedText && selectionResolvedBlock) {
      resolvedBlock = selectionResolvedBlock;
    }

    const contentBlock = pointResolvedContentBlock ?? selectionResolvedBlock;
    if (!resolvedBlock || !contentBlock) {
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

    const pointBlockText = contentBlock.textContent?.trim() ?? "";
    const blockType = (resolvedBlock.dataset.blockType ?? "paragraph") as NoteBlockType;
    const canInsertPageLinkAtPoint =
      (blockType === "paragraph" && pointBlockText.length > 0) ||
      blockType === "heading1" ||
      blockType === "heading2" ||
      blockType === "heading3";
    const canCreateTopicCardFromSelection =
      preserveTextSelection && canTurnSelectionIntoTopicCard(bodyRef.current);
    const spellcheckWord = preserveTextSelection ? extractStandaloneSpellcheckWord(selectedText) : null;
    const pageLinkRangeResolution =
      canInsertPageLinkAtPoint && !preserveTextSelection
        ? resolveCollapsedRangeAtPoint(bodyRef.current, x, y)
        : {
            range: null,
            source: "none" as const,
            blockId: null
          };
    pendingPageLinkRangeRef.current = pageLinkRangeResolution.range;

    updateSelectedBlock(preserveTextSelection ? null : blockId);
    debugAction("notes.context-menu.range-resolution", {
      blockId,
      canCreateTopicCardFromSelection,
      canInsertPageLinkAtPoint,
      noteId: note?.id ?? null,
      pointBlockId: pointResolvedContentBlock?.dataset.blockId ?? null,
      preserveTextSelection,
      rangeBlockId: pageLinkRangeResolution.blockId,
      rangeSource: pageLinkRangeResolution.source,
      selectionBlockId: selectionResolvedBlock?.dataset.blockId ?? null,
      selectionContainsPoint,
      selectionMatchesPointBlock,
      x,
      y
    });
    void logNoteDebugEvent("notes.turn_into.context_menu_opened", {
      blockId,
      fallbackBlockId: selectionResolvedBlock?.dataset.blockId ?? null,
      noteId: note?.id ?? null,
      pointBlockId: pointResolvedContentBlock?.dataset.blockId ?? null,
      preserveTextSelection,
      rangeBlockId: pageLinkRangeResolution.blockId,
      rangeSource: pageLinkRangeResolution.source,
      selectedText,
      target: "body",
      x,
      y
    });

      return {
        target: "body",
        blockId,
        blockType,
        canInsertPageLinkAtPoint: canInsertPageLinkAtPoint && !preserveTextSelection,
        canCreateTopicCardFromSelection,
        spellcheckWord
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
      return;
    }

    if (appliedNoteIdRef.current === note.id) {
      decorateIgnoredSpellcheckWords();
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
    decorateIgnoredSpellcheckWords();
  }, [note]);

  useEffect(() => {
    decorateIgnoredSpellcheckWords();
  }, [ignoredSpellcheckWordSet]);

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

  return (
    <div ref={editorRef} className="note-editor">
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
        onPointerDown={(event) => {
          if (!documentCapabilities || !bodyRef.current || event.button !== 0) {
            return;
          }

          const boundary = resolvePageLinkBoundarySelectionAtPoint(
            bodyRef.current,
            event.clientX,
            event.clientY
          );
          if (!boundary) {
            suppressedPageLinkClickIdRef.current = null;
            return;
          }

          event.preventDefault();
          focusEditorBody();
          updateSelectedBlock(null);
          updateSelectedTopic(null);
          updateSelectedPageLink(null);
          projectPageLinkBoundarySelection(bodyRef.current, boundary);
          suppressedPageLinkClickIdRef.current = boundary.pageLinkId;
        }}
        onMouseDown={(event) => {
          if (!bodyRef.current) {
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
            const pageLinkId = target.dataset.pageLinkId ?? null;
            if (
              pageLinkId &&
              suppressedPageLinkClickIdRef.current === pageLinkId
            ) {
              return;
            }

            event.preventDefault();
            focusEditorBody();
            updateSelectedTopic(null);
            if (pageLinkId) {
              updateSelectedPageLink(pageLinkId);
            }
          }
        }}
        onMouseUp={() => {
          if (!bodyRef.current || !documentCapabilities) {
            return;
          }

          normalizeCollapsedSelectionNearPageLink(bodyRef.current);
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
            suppressedPageLinkClickIdRef.current = null;
            return;
          }

          if (suppressedPageLinkClickIdRef.current === pageLinkId) {
            suppressedPageLinkClickIdRef.current = null;
            event.preventDefault();
            event.stopPropagation();
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

          if (inputEvent.inputType === "deleteContentBackward" && handleHeadingStartBackspace()) {
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

          if (handlePageLinkBoundaryTextInsertion(inputEvent)) {
            event.preventDefault();
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

          event.stopPropagation();

          if (!(event.metaKey || event.ctrlKey) && event.key === "Backspace" && handleHeadingStartBackspace()) {
            event.preventDefault();
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
              const selection = window.getSelection();
              if (!selection || !selection.isCollapsed) {
                return;
              }

              if (
                handlePageLinkBoundaryDeleteIntent(
                  event.key === "Backspace" ? "backward" : "forward"
                )
              ) {
                event.preventDefault();
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
