import {
  memo,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useMemo,
  useState
} from "react";

import { logNoteDebugEvent } from "../../../lib/api";
import { debugAction, debugLocalAction } from "../../../lib/debugLog";
import { markNoteBlocksUpdate } from "../../../lib/noteEditorPerformance";
import {
  blockLogicalLength,
  blockOffsetToPoint,
  collapsedModelSelection,
  convertBlockType,
  deleteBackward,
  deleteForward,
  findInlineNode,
  insertBlocksAtSelection,
  insertTextAtSelection,
  isCollapsedModelSelection,
  pointToBlockOffset,
  removeInlineNode,
  removeModelBlock,
  replaceModelRange,
  selectedPlainText,
  splitBlockAtSelection,
  textMarksAtPoint,
  toggleTextMarkInSelection,
  updateInlineNode,
  type NoteModelEdit
} from "../model/noteBlockModel";
import {
  captureModelSelection,
  modelPointFromDomPoint,
  restoreModelSelection
} from "../dom/noteBlockSelection";
import {
  clearSelectedPageLink,
  copyPageLinkReference,
  copySelectedBlock,
  findBlockElement,
  findClosestBlockElement,
  getBlockAtPoint,
  getBlockFromSelection,
  getPageLinkAtPoint,
  getSelectedText,
  getTopicCardAtPoint,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  isPointWithinTopicCardContent,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  renderNoteInlineNodesHtml,
  resolveCollapsedRangeAtPoint,
  selectBlockElement,
  selectPageLinkToken,
  selectTextMatchInBlock,
  selectTopicCardToken
} from "../dom/noteEditorDom";
import {
  applyNoteEditorEdit,
  commitNoteEditorBlocks,
  createNoteEditorRuntimeState,
  redoNoteEditorRuntime,
  replaceNoteEditorSelection,
  undoNoteEditorRuntime,
  type NoteModelHistoryState
} from "../state/noteEditorState";
import {
  createEmptyNoteBlock,
  createPageLinkNode,
  createTextNode,
  createTopicCardNode,
  formatPageLinkText
} from "../../../lib/notes";
import { DEFAULT_TOPIC_COLOR, normalizeTopicText } from "../../../lib/paragraphTopics";
import { extractStandaloneSpellcheckWord } from "../../../lib/spellcheck";
import type {
  NoteEditorContextTarget,
  NoteEditorHandle
} from "./noteEditorTypes";
import type {
  InteractiveColorKey,
  NoteBlock,
  NoteBlockType,
  NoteDocument,
  NoteHistoryMergeKey,
  NoteInlineNode,
  NoteModelPoint,
  NoteModelSelection,
  NotePageLinkNode,
  ParagraphTopic
} from "../../../lib/types";
import { computeCenteredChildScrollTop } from "./noteEditorScroll";

const NOTE_CLIPBOARD_MIME = "application/x-calmreader-note-fragment";
const SHOULD_VERIFY_SELECTION_RESTORE = import.meta.env.DEV;
const SHOULD_LOG_HIGH_FREQUENCY_INTERACTIONS = import.meta.env.DEV;
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function escapeCssIdentifier(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

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

type PageLinkCommandResult =
  | { ok: true; node?: NotePageLinkNode }
  | { ok: false; message: string };

type TopicCommandResult =
  | { ok: true; topic: ParagraphTopic }
  | { ok: false; message: string };

type PendingTextMarks = {
  bold: boolean;
  italic: boolean;
};

type ClipboardPayload = {
  internalHtml: string;
  html: string;
  text: string;
};

type AtomicInlineSelection = {
  id: string;
  type: "page-link" | "topic-card";
};

type CompositionSession = {
  blockId: string;
  host: HTMLElement | null;
  marks: PendingTextMarks | null;
  selection: NoteModelSelection;
};

const NoteBlockView = memo(function NoteBlockView({ block }: { block: NoteBlock }) {
  const html = useMemo(
    () => renderNoteInlineNodesHtml(block.children) || "<br>",
    [block.children]
  );

  return (
    <div
      className="note-editor__block"
      data-block-id={block.id}
      data-block-type={block.type}
    >
      <div
        className="note-editor__block-content"
        spellCheck={false}
        dangerouslySetInnerHTML={{
          __html: html
        }}
      />
    </div>
  );
});

function blockContentElement(node: EventTarget | null) {
  return node instanceof HTMLElement
    ? node.closest<HTMLElement>(".note-editor__block-content")
    : null;
}

function closestTargetElement(target: EventTarget | null) {
  return target instanceof Element ? target : null;
}

function inlineNodeLength(node: NoteInlineNode) {
  return node.type === "text" ? node.text.length : 1;
}

function inlineNodeStartOffset(block: NoteBlock, inlineIndex: number) {
  return block.children
    .slice(0, inlineIndex)
    .reduce((length, node) => length + inlineNodeLength(node), 0);
}

function clipboardBlocksFromHtml(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  normalizeNoteEditorDom(root);
  return parseNoteBlocksFromEditor(root);
}

function clipboardBlocksFromText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({
      ...createEmptyNoteBlock(),
      children: [createTextNode(line)]
    }));
}

function sanitizeClipboardText(text: string) {
  return text.replace(/\u200b/g, "");
}

function atomicBoundaryAtPoint(
  block: NoteBlock,
  point: NoteModelPoint,
  direction: "backward" | "forward"
) {
  const offset = pointToBlockOffset(block, point);
  let cursor = 0;
  for (const node of block.children) {
    const length = inlineNodeLength(node);
    if (
      node.type !== "text" &&
      ((direction === "backward" && offset === cursor + 1) ||
        (direction === "forward" && offset === cursor))
    ) {
      return node;
    }
    cursor += length;
  }
  return null;
}

function shouldLogBeforeInput(inputType: string | undefined) {
  return (
    SHOULD_LOG_HIGH_FREQUENCY_INTERACTIONS ||
    (inputType !== "insertText" &&
      inputType !== "insertReplacementText" &&
      inputType !== "deleteContentBackward" &&
      inputType !== "deleteContentForward")
  );
}

function shouldLogKeyDown(event: KeyboardEvent) {
  return (
    SHOULD_LOG_HIGH_FREQUENCY_INTERACTIONS ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  );
}

const ModelNoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  function ModelNoteEditor(
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
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const appliedNoteIdRef = useRef<string | null>(null);
    const initialRuntimeRef = useRef<ReturnType<typeof createNoteEditorRuntimeState> | null>(null);
    if (!initialRuntimeRef.current) {
      initialRuntimeRef.current = createNoteEditorRuntimeState(
        note?.blocks ?? [createEmptyNoteBlock()],
        note?.bookId,
        null
      );
    }
    const initialRuntime = initialRuntimeRef.current;
    const blocksRef = useRef<NoteBlock[]>(initialRuntime.blocks);
    const [renderedBlocks, setRenderedBlocks] = useState(() => blocksRef.current);
    const [renderTick, setRenderTick] = useState(0);
    const selectedBlockIdRef = useRef<string | null>(null);
    const selectedPageLinkIdRef = useRef<string | null>(null);
    const selectedTopicIdRef = useRef<string | null>(null);
    const pendingPageLinkPointRef = useRef<NoteModelPoint | null>(null);
    const pendingTopicSelectionRef = useRef<NoteModelSelection | null>(null);
    const pendingSelectionRestoreRef = useRef<NoteModelSelection | null>(null);
    const pendingTextMarksRef = useRef<PendingTextMarks | null>(null);
    const compositionSessionRef = useRef<CompositionSession | null>(null);
    const historyRef = useRef<NoteModelHistoryState | null>(initialRuntime.history);
    const applyingHistoryRef = useRef(false);
    void ignoredSpellcheckWords;

    function logInteraction(event: string, fields: Record<string, unknown> = {}) {
      debugLocalAction(`notes.interaction.${event}`, {
        noteId: note?.id ?? null,
        ...fields
      });
    }

    function currentSelection() {
      return bodyRef.current
        ? captureModelSelection(bodyRef.current, blocksRef.current)
        : null;
    }

    function updateSelectedBlock(blockId: string | null) {
      if (selectedBlockIdRef.current === blockId) {
        return;
      }
      selectedBlockIdRef.current = blockId;
      if (bodyRef.current) {
        selectBlockElement(bodyRef.current, blockId);
      }
    }

    function updateSelectedPageLink(pageLinkId: string | null) {
      if (selectedPageLinkIdRef.current === pageLinkId) {
        return;
      }
      selectedPageLinkIdRef.current = pageLinkId;
      if (bodyRef.current) {
        selectPageLinkToken(bodyRef.current, pageLinkId);
      }
    }

    function updateSelectedTopic(topicId: string | null) {
      if (selectedTopicIdRef.current === topicId) {
        return;
      }
      selectedTopicIdRef.current = topicId;
      if (bodyRef.current) {
        selectTopicCardToken(bodyRef.current, topicId);
      }
    }

    function clearTokenSelection() {
      updateSelectedPageLink(null);
      updateSelectedTopic(null);
    }

    function resolvePageLink(pageLinkId: string): NotePageLinkNode | null {
      const found = findInlineNode(blocksRef.current, pageLinkId);
      return found?.node.type === "page-link" ? found.node : null;
    }

    function selectedAtomicInline(): AtomicInlineSelection | null {
      if (selectedPageLinkIdRef.current) {
        return { id: selectedPageLinkIdRef.current, type: "page-link" };
      }
      if (selectedTopicIdRef.current) {
        return { id: selectedTopicIdRef.current, type: "topic-card" };
      }
      return null;
    }

    function setSelectedAtomicInline(atomic: AtomicInlineSelection | null) {
      if (!atomic) {
        clearTokenSelection();
        return;
      }
      if (atomic.type === "page-link") {
        updateSelectedTopic(null);
        updateSelectedPageLink(atomic.id);
        return;
      }
      updateSelectedPageLink(null);
      updateSelectedTopic(atomic.id);
    }

    function normalizePendingTextMarks(marks: PendingTextMarks | null) {
      if (!marks) {
        return null;
      }
      return marks.bold || marks.italic ? marks : null;
    }

    function clearPendingTextMarks() {
      pendingTextMarksRef.current = null;
    }

    function effectiveTextMarks(selection: NoteModelSelection) {
      return (
        normalizePendingTextMarks(
        pendingTextMarksRef.current ?? textMarksAtPoint(blocksRef.current, selection.focus)
        ) ?? undefined
      );
    }

    function serializeSelectionFragmentPayload(
      fragment: DocumentFragment,
      text: string
    ): ClipboardPayload {
      const wrapper = document.createElement("div");
      wrapper.appendChild(fragment.cloneNode(true));
      const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
      const emptyNodes: Text[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const sanitized = sanitizeClipboardText(node.textContent ?? "");
        if (sanitized.length === 0) {
          emptyNodes.push(node);
          continue;
        }
        node.textContent = sanitized;
      }
      for (const node of emptyNodes) {
        node.remove();
      }
      return {
        internalHtml: wrapper.innerHTML,
        html: wrapper.innerHTML,
        text: sanitizeClipboardText(text)
      };
    }

    function serializeElementPayload(element: HTMLElement): ClipboardPayload {
      return {
        internalHtml: element.outerHTML,
        html: element.outerHTML,
        text: sanitizeClipboardText(element.textContent ?? "")
      };
    }

    function serializeCurrentRangePayload(root: HTMLElement): ClipboardPayload | null {
      const selection = root.ownerDocument.defaultView?.getSelection();
      if (
        !selection ||
        selection.rangeCount === 0 ||
        !root.contains(selection.anchorNode) ||
        !root.contains(selection.focusNode)
      ) {
        return null;
      }
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        return null;
      }
      return serializeSelectionFragmentPayload(range.cloneContents(), selection.toString());
    }

    function currentClipboardPayload() {
      if (!bodyRef.current) {
        return null;
      }
      if (selectedBlockIdRef.current) {
        const block = findBlockElement(bodyRef.current, selectedBlockIdRef.current);
        return block ? serializeElementPayload(block) : null;
      }
      const atomic = selectedAtomicInline();
      if (atomic) {
        const selector =
          atomic.type === "page-link"
            ? `[data-inline-type='page-link'][data-page-link-id="${escapeCssIdentifier(atomic.id)}"]`
            : `[data-inline-type='topic-card'][data-topic-id="${escapeCssIdentifier(atomic.id)}"]`;
        const element = bodyRef.current.querySelector<HTMLElement>(selector);
        return element ? serializeElementPayload(element) : null;
      }
      return serializeCurrentRangePayload(bodyRef.current);
    }

    function writeClipboardDataTransfer(clipboardData: DataTransfer, payload: ClipboardPayload) {
      try {
        clipboardData.setData("text/plain", payload.text);
        clipboardData.setData("text/html", payload.html);
        clipboardData.setData(NOTE_CLIPBOARD_MIME, payload.internalHtml);
        return true;
      } catch {
        return false;
      }
    }

    async function writeClipboardPayload(payload: ClipboardPayload) {
      const clipboard = navigator.clipboard;
      if (!clipboard) {
        return false;
      }
      try {
        if (typeof clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
          await clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([payload.text], { type: "text/plain" }),
              "text/html": new Blob([payload.html], { type: "text/html" }),
              [NOTE_CLIPBOARD_MIME]: new Blob([payload.internalHtml], {
                type: NOTE_CLIPBOARD_MIME
              })
            })
          ]);
          return true;
        }
        if (typeof clipboard.writeText === "function") {
          await clipboard.writeText(payload.text);
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }

    function commitBlocks(
      nextBlocks: NoteBlock[],
      selection: NoteModelSelection | null,
      mergeKey: NoteHistoryMergeKey | null,
      render: boolean
    ) {
      const nextState = commitNoteEditorBlocks({
        currentBlocks: blocksRef.current,
        history: historyRef.current,
        nextBlocks,
        selection,
        mergeKey,
        bookId: note?.bookId,
        render
      });
      blocksRef.current = nextState.blocks;
      historyRef.current = nextState.history;
      if (render) {
        pendingSelectionRestoreRef.current = nextState.pendingSelectionRestore;
        setRenderedBlocks(nextState.blocks);
      }
      if (nextState.changed) {
        const updateProfile = markNoteBlocksUpdate(nextState.blocks, {
          source: "ModelNoteEditor.commitBlocks",
          noteId: note?.id ?? null,
          blockCount: nextState.blocks.length
        });
        const callbackStartedAt = performance.now();
        onChangeBlocks(nextState.blocks);
        debugLocalAction("notes.performance.blocks-propagation-dispatched", {
          noteId: note?.id ?? null,
          updateId: updateProfile.id,
          source: updateProfile.source,
          blockCount: updateProfile.blockCount,
          callbackElapsedMs: Math.round(performance.now() - callbackStartedAt)
        });
      }
    }

    function applyModelEdit(edit: NoteModelEdit, mergeKey: NoteHistoryMergeKey | null) {
      clearTokenSelection();
      updateSelectedBlock(null);
      clearPendingTextMarks();
      const nextState = applyNoteEditorEdit({
        currentBlocks: blocksRef.current,
        history: historyRef.current,
        edit,
        mergeKey,
        bookId: note?.bookId
      });
      blocksRef.current = nextState.blocks;
      historyRef.current = nextState.history;
      pendingSelectionRestoreRef.current = nextState.pendingSelectionRestore;
      setRenderedBlocks(nextState.blocks);
      if (nextState.changed) {
        const updateProfile = markNoteBlocksUpdate(nextState.blocks, {
          source: "ModelNoteEditor.applyModelEdit",
          noteId: note?.id ?? null,
          blockCount: nextState.blocks.length
        });
        const callbackStartedAt = performance.now();
        onChangeBlocks(nextState.blocks);
        debugLocalAction("notes.performance.blocks-propagation-dispatched", {
          noteId: note?.id ?? null,
          updateId: updateProfile.id,
          source: updateProfile.source,
          blockCount: updateProfile.blockCount,
          callbackElapsedMs: Math.round(performance.now() - callbackStartedAt)
        });
      }
    }

    function updateHistorySelectionFromDom() {
      if (!historyRef.current || applyingHistoryRef.current) {
        return;
      }
      historyRef.current = replaceNoteEditorSelection({
        history: historyRef.current,
        selection: currentSelection()
      });
    }

    function applyHistoryState(nextHistory: NoteModelHistoryState) {
      applyingHistoryRef.current = true;
      const blocks = nextHistory.current.blocks;
      historyRef.current = nextHistory;
      blocksRef.current = blocks;
      pendingSelectionRestoreRef.current = nextHistory.current.selection;
      setRenderedBlocks(blocksRef.current);
      const updateProfile = markNoteBlocksUpdate(blocksRef.current, {
        source: "ModelNoteEditor.applyHistoryState",
        noteId: note?.id ?? null,
        blockCount: blocksRef.current.length
      });
      const callbackStartedAt = performance.now();
      onChangeBlocks(blocksRef.current);
      debugLocalAction("notes.performance.blocks-propagation-dispatched", {
        noteId: note?.id ?? null,
        updateId: updateProfile.id,
        source: updateProfile.source,
        blockCount: updateProfile.blockCount,
        callbackElapsedMs: Math.round(performance.now() - callbackStartedAt)
      });
      clearTokenSelection();
      updateSelectedBlock(null);
      clearPendingTextMarks();
      applyingHistoryRef.current = false;
      return true;
    }

    function performUndo() {
      updateHistorySelectionFromDom();
      const next = undoNoteEditorRuntime({
        history: historyRef.current,
        bookId: note?.bookId
      });
      if (!next?.history) {
        return false;
      }
      return applyHistoryState(next.history);
    }

    function performRedo() {
      updateHistorySelectionFromDom();
      const next = redoNoteEditorRuntime({
        history: historyRef.current,
        bookId: note?.bookId
      });
      if (!next?.history) {
        return false;
      }
      return applyHistoryState(next.history);
    }

    function rerenderFromModel(selection: NoteModelSelection | null) {
      pendingSelectionRestoreRef.current = selection;
      setRenderTick((value) => value + 1);
    }

    function applyTextInsertion(
      selection: NoteModelSelection,
      text: string,
      mergeKey: NoteHistoryMergeKey = "typing"
    ) {
      let nextBlocks = blocksRef.current;
      let nextSelection = selection;
      const atomic = selectedAtomicInline();
      if (atomic) {
        const removal = removeInlineNode(nextBlocks, atomic.id);
        if (removal) {
          nextBlocks = removal.blocks;
          nextSelection = removal.selection;
        }
      }
      applyModelEdit(
        insertTextAtSelection(nextBlocks, nextSelection, text, effectiveTextMarks(nextSelection)),
        mergeKey
      );
      return true;
    }

    function handleBeforeInputEvent(inputEvent: InputEvent) {
      if (shouldLogBeforeInput(inputEvent.inputType)) {
        logInteraction("beforeinput", {
          inputType: inputEvent.inputType,
          data: inputEvent.data
        });
      }
      if (compositionSessionRef.current) {
        return false;
      }
      if (inputEvent.inputType === "historyUndo") {
        performUndo();
        return true;
      }
      if (inputEvent.inputType === "historyRedo") {
        performRedo();
        return true;
      }
      if (
        inputEvent.inputType === "insertParagraph" ||
        inputEvent.inputType === "insertLineBreak"
      ) {
        const selection = currentSelection();
        if (selection) {
          applyModelEdit(splitBlockAtSelection(blocksRef.current, selection), null);
        }
        return true;
      }

      const selection = currentSelection();
      if (
        selection &&
        (inputEvent.inputType === "insertText" ||
          inputEvent.inputType === "insertReplacementText") &&
        typeof inputEvent.data === "string"
      ) {
        applyTextInsertion(selection, inputEvent.data);
        return true;
      }
      if (
        inputEvent.inputType === "deleteContentBackward" ||
        inputEvent.inputType === "deleteContentForward"
      ) {
        return handleBoundaryDelete(
          inputEvent.inputType === "deleteContentBackward" ? "backward" : "forward"
        );
      }

      const selectedAtomic = selectedAtomicInline();
      if (
        selectedAtomic &&
        (inputEvent.inputType === "insertText" ||
          inputEvent.inputType === "insertReplacementText")
      ) {
        const removal = removeInlineNode(blocksRef.current, selectedAtomic.id);
        if (!removal) {
          return false;
        }
        return typeof inputEvent.data === "string"
          ? applyTextInsertion(removal.selection, inputEvent.data)
          : false;
      }

      if (
        selection &&
        (inputEvent.inputType === "insertFromPaste" ||
          inputEvent.inputType === "insertFromDrop")
      ) {
        const transfer = inputEvent.dataTransfer;
        const internalHtml = transfer?.getData(NOTE_CLIPBOARD_MIME) ?? "";
        const richHtml = transfer?.getData("text/html") ?? "";
        if (
          internalHtml ||
          richHtml.includes("data-inline-type=\"page-link\"") ||
          richHtml.includes("data-inline-type=\"topic-card\"")
        ) {
          return false;
        }
        const text = transfer?.getData("text/plain") ?? inputEvent.data ?? "";
        pasteBlocks(clipboardBlocksFromText(text));
        return true;
      }

      if (selection && inputEvent.inputType === "deleteByDrag") {
        applyModelEdit(replaceModelRange(blocksRef.current, selection), "delete");
        return true;
      }

      if (selection && inputEvent.inputType === "deleteByCut") {
        const edit = pendingCutEdit();
        if (edit) {
          applyModelEdit(edit, "delete");
          return true;
        }
      }

      return false;
    }

    function focusEditor() {
      const root = bodyRef.current;
      if (!root) {
        return;
      }
      root.focus({ preventScroll: true });
    }

    function moveSelectionTo(point: NoteModelPoint, extend = false) {
      if (!bodyRef.current) {
        return;
      }
      if (!extend) {
        clearPendingTextMarks();
      }
      const existing = currentSelection();
      const selection =
        extend && existing
          ? { anchor: existing.anchor, focus: point }
          : collapsedModelSelection(point);
      restoreModelSelection(bodyRef.current, blocksRef.current, selection);
      updateHistorySelectionFromDom();
    }

    function selectAllBlocks() {
      if (!bodyRef.current || blocksRef.current.length === 0) {
        return false;
      }
      clearPendingTextMarks();
      clearTokenSelection();
      updateSelectedBlock(null);
      const firstBlock = blocksRef.current[0];
      const lastBlock = blocksRef.current[blocksRef.current.length - 1];
      const selection = {
        anchor: blockOffsetToPoint(firstBlock, 0, "after"),
        focus: blockOffsetToPoint(lastBlock, blockLogicalLength(lastBlock), "after")
      };
      restoreModelSelection(bodyRef.current, blocksRef.current, selection);
      updateHistorySelectionFromDom();
      return true;
    }

    function handleBoundaryDelete(direction: "backward" | "forward") {
      const selection = currentSelection();
      if (!selection) {
        return false;
      }
      if (!isCollapsedModelSelection(selection)) {
        applyModelEdit(
          direction === "backward"
            ? deleteBackward(blocksRef.current, selection) ?? replaceModelRange(blocksRef.current, selection)
            : deleteForward(blocksRef.current, selection) ?? replaceModelRange(blocksRef.current, selection),
          "delete"
        );
        return true;
      }

      const point = selection.focus;
      const block = blocksRef.current.find((candidate) => candidate.id === point.blockId);
      if (!block) {
        return false;
      }
      const offset = pointToBlockOffset(block, point);
      const atomic = atomicBoundaryAtPoint(block, point, direction);
      if (atomic) {
        const selected = selectedAtomicInline()?.id === atomic.id;
        if (selected) {
          const edit = removeInlineNode(blocksRef.current, atomic.id);
          if (edit) {
            applyModelEdit(
              edit,
              atomic.type === "page-link" ? "remove-page-link" : "remove-topic"
            );
          }
        } else {
          setSelectedAtomicInline({
            id: atomic.id,
            type: atomic.type
          });
        }
        return true;
      }

      const edit =
        direction === "backward"
          ? deleteBackward(blocksRef.current, selection)
          : deleteForward(blocksRef.current, selection);
      if (!edit) {
        return false;
      }
      applyModelEdit(edit, "delete");
      return true;
    }

    function handleCrossBlockArrow(key: string, extend: boolean) {
      const selection = currentSelection();
      if (!selection || (!extend && !isCollapsedModelSelection(selection))) {
        return false;
      }
      const point = selection.focus;
      const index = blocksRef.current.findIndex((block) => block.id === point.blockId);
      const block = blocksRef.current[index];
      if (!block) {
        return false;
      }
      const offset = pointToBlockOffset(block, point);
      const backward = key === "ArrowLeft" || key === "ArrowUp";
      const forward = key === "ArrowRight" || key === "ArrowDown";
      if (backward && offset === 0 && index > 0) {
        const previous = blocksRef.current[index - 1];
        moveSelectionTo(blockOffsetToPoint(previous, blockLogicalLength(previous)), extend);
        return true;
      }
      if (
        forward &&
        offset === blockLogicalLength(block) &&
        index < blocksRef.current.length - 1
      ) {
        moveSelectionTo(blockOffsetToPoint(blocksRef.current[index + 1], 0), extend);
        return true;
      }
      return false;
    }

    function pasteBlocks(blocks: NoteBlock[]) {
      const selection = currentSelection();
      if (!selection) {
        return false;
      }
      applyModelEdit(insertBlocksAtSelection(blocksRef.current, selection, blocks), "paste");
      return true;
    }

    function pendingCutEdit() {
      if (selectedBlockIdRef.current) {
        return removeModelBlock(blocksRef.current, selectedBlockIdRef.current);
      }
      const atomic = selectedAtomicInline();
      if (atomic) {
        return removeInlineNode(blocksRef.current, atomic.id);
      }
      const selection = currentSelection();
      if (!selection || isCollapsedModelSelection(selection)) {
        return null;
      }
      return replaceModelRange(blocksRef.current, selection);
    }

    function performCutToDataTransfer(clipboardData: DataTransfer | null | undefined) {
      const payload = currentClipboardPayload();
      const edit = pendingCutEdit();
      if (!payload || !edit || !clipboardData) {
        return false;
      }
      const wrote = writeClipboardDataTransfer(clipboardData, payload);
      if (!wrote) {
        return false;
      }
      applyModelEdit(edit, "delete");
      return true;
    }

    async function performCut() {
      const payload = currentClipboardPayload();
      const edit = pendingCutEdit();
      if (!payload || !edit) {
        return false;
      }
      const wrote = await writeClipboardPayload(payload);
      if (!wrote) {
        return false;
      }
      applyModelEdit(edit, "delete");
      return true;
    }

    function toggleSelectionMark(mark: "bold" | "italic") {
      const selection = currentSelection();
      if (!selection) {
        return false;
      }
      if (isCollapsedModelSelection(selection)) {
        const currentMarks = pendingTextMarksRef.current ?? textMarksAtPoint(blocksRef.current, selection.focus);
        pendingTextMarksRef.current = normalizePendingTextMarks({
          ...currentMarks,
          [mark]: !currentMarks[mark]
        });
        return true;
      }
      const edit = toggleTextMarkInSelection(blocksRef.current, selection, mark);
      if (!edit) {
        return false;
      }
      applyModelEdit(edit, "format");
      return true;
    }

    function resolveContextMenuTargetAtPoint(x: number, y: number) {
      const root = bodyRef.current;
      if (!root) {
        return null;
      }
      const pointTopic = getTopicCardAtPoint(root, x, y);
      if (pointTopic && isPointWithinTopicCardContent(root, pointTopic, x, y)) {
        const block = findClosestBlockElement(root, pointTopic);
        const topicId = pointTopic.dataset.topicId;
        const blockId = block?.dataset.blockId;
        const topicColor = pointTopic.dataset.topicColor as InteractiveColorKey | undefined;
        if (topicId && blockId && topicColor) {
          pendingPageLinkPointRef.current = null;
          pendingTopicSelectionRef.current = null;
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

      const pointPageLink = getPageLinkAtPoint(root, x, y);
      if (pointPageLink && isPointWithinPageLinkContent(root, pointPageLink, x, y)) {
        const block = findClosestBlockElement(root, pointPageLink);
        const pageLinkId = pointPageLink.dataset.pageLinkId;
        const blockId = block?.dataset.blockId;
        if (pageLinkId && blockId) {
          pendingPageLinkPointRef.current = null;
          pendingTopicSelectionRef.current = null;
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

      clearTokenSelection();
      const liveSelection = currentSelection();
      const selectionBlock = getBlockFromSelection(root);
      const pointBlock = getBlockAtPoint(root, x, y);
      const selectedText = getSelectedText(root).trim();
      const sameBlock =
        selectionBlock?.dataset.blockId &&
        selectionBlock.dataset.blockId === pointBlock?.dataset.blockId;
      const preserveSelection =
        selectedText.length > 0 &&
        (isPointWithinSelectionContent(root, x, y) || Boolean(sameBlock));
      const blockElement = preserveSelection ? selectionBlock : pointBlock;
      const blockId = blockElement?.dataset.blockId;
      const block = blocksRef.current.find((candidate) => candidate.id === blockId);
      if (!block || !blockId) {
        pendingPageLinkPointRef.current = null;
        pendingTopicSelectionRef.current = null;
        updateSelectedBlock(null);
        return null;
      }

      const selected =
        preserveSelection && liveSelection
          ? selectedPlainText(blocksRef.current, liveSelection)
          : null;
      const canCreateTopicCardFromSelection =
        Boolean(selected?.text.trim()) && selected?.block.type === "paragraph";
      pendingTopicSelectionRef.current =
        canCreateTopicCardFromSelection && liveSelection ? liveSelection : null;

      let insertionPoint: NoteModelPoint | null = null;
      if (!preserveSelection) {
        const rangeResult = resolveCollapsedRangeAtPoint(root, x, y);
        if (rangeResult.range) {
          insertionPoint = modelPointFromDomPoint(
            root,
            blocksRef.current,
            rangeResult.range.startContainer,
            rangeResult.range.startOffset,
            "after"
          );
        }
      }
      const canInsertPageLinkAtPoint =
        Boolean(insertionPoint) &&
        (block.type !== "paragraph" || blockLogicalLength(block) > 0);
      pendingPageLinkPointRef.current = canInsertPageLinkAtPoint
        ? insertionPoint
        : null;
      updateSelectedBlock(preserveSelection ? null : blockId);
      debugAction("notes.context-menu.range-resolution", {
        blockId,
        canCreateTopicCardFromSelection,
        canInsertPageLinkAtPoint,
        noteId: note?.id ?? null,
        preserveSelection,
        x,
        y
      });
      void logNoteDebugEvent("notes.turn_into.context_menu_opened", {
        blockId,
        noteId: note?.id ?? null,
        preserveTextSelection: preserveSelection,
        selectedText,
        target: "body",
        x,
        y
      });
      return {
        target: "body",
        blockId,
        blockType: block.type,
        canInsertPageLinkAtPoint,
        canCreateTopicCardFromSelection,
        spellcheckWord: preserveSelection
          ? extractStandaloneSpellcheckWord(selectedText)
          : null
      } satisfies NoteEditorContextTarget;
    }

    useEffect(() => {
      if (!note) {
        const runtime = createNoteEditorRuntimeState([createEmptyNoteBlock()], null, null);
        blocksRef.current = runtime.blocks;
        setRenderedBlocks(runtime.blocks);
        appliedNoteIdRef.current = null;
        historyRef.current = runtime.history;
        clearPendingTextMarks();
        compositionSessionRef.current = null;
        return;
      }
      if (appliedNoteIdRef.current === note.id) {
        return;
      }
      const runtime = createNoteEditorRuntimeState(note.blocks, note.bookId, null);
      blocksRef.current = runtime.blocks;
      setRenderedBlocks(runtime.blocks);
      historyRef.current = runtime.history;
      appliedNoteIdRef.current = note.id;
      clearTokenSelection();
      updateSelectedBlock(null);
      pendingPageLinkPointRef.current = null;
      pendingTopicSelectionRef.current = null;
      clearPendingTextMarks();
      compositionSessionRef.current = null;
    }, [note]);

    useClientLayoutEffect(() => {
      if (!bodyRef.current) {
        return;
      }
      selectBlockElement(bodyRef.current, selectedBlockIdRef.current);
      selectPageLinkToken(bodyRef.current, selectedPageLinkIdRef.current);
      selectTopicCardToken(bodyRef.current, selectedTopicIdRef.current);
      const pendingSelection = pendingSelectionRestoreRef.current;
      if (pendingSelection) {
        const restored = restoreModelSelection(
          bodyRef.current,
          blocksRef.current,
          pendingSelection
        );
        if (!SHOULD_VERIFY_SELECTION_RESTORE && restored) {
          pendingSelectionRestoreRef.current = null;
          return;
        }
        const actualSelection =
          restored && SHOULD_VERIFY_SELECTION_RESTORE
            ? captureModelSelection(bodyRef.current, blocksRef.current)
            : null;
        if (
          actualSelection &&
          actualSelection.focus.blockId === pendingSelection.focus.blockId &&
          actualSelection.anchor.blockId === pendingSelection.anchor.blockId
        ) {
          pendingSelectionRestoreRef.current = null;
        }
      }
    }, [renderTick, renderedBlocks]);

    useEffect(() => {
      function handleSelectionChange() {
        updateHistorySelectionFromDom();
      }
      document.addEventListener("selectionchange", handleSelectionChange);
      return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, []);

    useEffect(() => {
      const root = bodyRef.current;
      if (!root) {
        return;
      }

      function handleNativeBeforeInput(event: InputEvent) {
        if (event.defaultPrevented) {
          return;
        }
        if (handleBeforeInputEvent(event)) {
          event.preventDefault();
        }
      }

      root.addEventListener("beforeinput", handleNativeBeforeInput, true);
      return () => {
        root.removeEventListener("beforeinput", handleNativeBeforeInput, true);
      };
    });

    useImperativeHandle(
      ref,
      () => ({
        focus: focusEditor,
        scrollToBlock(blockId) {
          const blockElement = bodyRef.current
            ? findBlockElement(bodyRef.current, blockId)
            : null;
          const scrollSurface = blockElement?.closest(".notes-pane__scroll-surface");
          if (!blockElement) {
            return;
          }
          if (!(scrollSurface instanceof HTMLDivElement)) {
            blockElement.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          const scrollRect = scrollSurface.getBoundingClientRect();
          const blockRect = blockElement.getBoundingClientRect();
          const nextScrollTop = computeCenteredChildScrollTop({
            childHeight: blockRect.height,
            childTop: scrollSurface.scrollTop + (blockRect.top - scrollRect.top),
            containerHeight: scrollSurface.clientHeight,
            scrollHeight: scrollSurface.scrollHeight
          });
          scrollSurface.scrollTo({ top: nextScrollTop, behavior: "smooth" });
        },
        copySelection() {
          const payload = currentClipboardPayload();
          if (payload) {
            void writeClipboardPayload(payload);
          }
        },
        async cutSelection() {
          return performCut();
        },
        async pasteSelection() {
          const text = await navigator.clipboard?.readText?.();
          if (typeof text === "string") {
            pasteBlocks(clipboardBlocksFromText(text));
          }
        },
        resolveContextMenuTargetAtPoint,
        turnInto(blockId, type) {
          commitBlocks(
            convertBlockType(blocksRef.current, blockId, type),
            currentSelection(),
            "turn-into",
            true
          );
        },
        removeBlock(blockId) {
          const edit = removeModelBlock(blocksRef.current, blockId);
          if (!edit) {
            return false;
          }
          applyModelEdit(edit, "delete");
          return true;
        },
        insertPageLink(pageNumber): PageLinkCommandResult {
          const point = pendingPageLinkPointRef.current;
          if (!point || !note || currentPage == null || currentPage <= 0) {
            return {
              ok: false,
              message: point
                ? "Unable to determine the current PDF page for this PageLink."
                : "Click inside a paragraph before adding a PageLink."
            };
          }
          const node = createPageLinkNode({
            text: formatPageLinkText(pageNumber),
            bookPageLabel: String(pageNumber),
            documentId: note.bookId,
            pdfPageIndex: currentPage
          });
          pendingPageLinkPointRef.current = null;
          applyModelEdit(
            replaceModelRange(
              blocksRef.current,
              collapsedModelSelection(point),
              [node]
            ),
            "insert-page-link"
          );
          updateSelectedPageLink(node.id);
          return { ok: true, node };
        },
        openPageLink(pageLinkId) {
          const node = resolvePageLink(pageLinkId);
          if (!node) {
            return null;
          }
          onOpenPageLink(node);
          return node;
        },
        getPageLink(pageLinkId) {
          return resolvePageLink(pageLinkId);
        },
        editPageLink(pageLinkId, pageNumber): PageLinkCommandResult {
          const found = findInlineNode(blocksRef.current, pageLinkId);
          if (!found || found.node.type !== "page-link") {
            return { ok: false, message: "Unable to update PageLink." };
          }
          const node: NotePageLinkNode = {
            ...found.node,
            text: formatPageLinkText(pageNumber),
            bookPageLabel: String(pageNumber)
          };
          commitBlocks(
            updateInlineNode(blocksRef.current, pageLinkId, () => node),
            currentSelection(),
            "edit-page-link",
            true
          );
          updateSelectedPageLink(pageLinkId);
          return { ok: true, node };
        },
        removePageLink(pageLinkId) {
          const edit = removeInlineNode(blocksRef.current, pageLinkId);
          if (!edit) {
            return false;
          }
          applyModelEdit(edit, "remove-page-link");
          return true;
        },
        copyPageReference(pageLinkId) {
          if (bodyRef.current) {
            copyPageLinkReference(bodyRef.current, pageLinkId);
          }
        },
        createTopicFromSelection(color = DEFAULT_TOPIC_COLOR): TopicCommandResult {
          const selection = pendingTopicSelectionRef.current;
          const selected = selection
            ? selectedPlainText(blocksRef.current, selection)
            : null;
          const text = normalizeTopicText(selected?.text ?? "");
          if (!selection || !selected || selected.block.type !== "paragraph" || !text) {
            return {
              ok: false,
              message: "Select text inside one paragraph before creating a Topic card."
            };
          }
          const topic = createTopicCardNode({ text, color });
          if (!topic) {
            return { ok: false, message: "Unable to create Topic card." };
          }
          pendingTopicSelectionRef.current = null;
          applyModelEdit(
            replaceModelRange(blocksRef.current, selection, [topic]),
            "insert-topic"
          );
          updateSelectedTopic(topic.id);
          return { ok: true, topic };
        },
        getTopic(topicId) {
          const found = findInlineNode(blocksRef.current, topicId);
          return found?.node.type === "topic-card" ? found.node : null;
        },
        editTopic(topicId, updates): TopicCommandResult {
          const found = findInlineNode(blocksRef.current, topicId);
          if (!found || found.node.type !== "topic-card") {
            return { ok: false, message: "Unable to update Topic card." };
          }
          const topic = createTopicCardNode({
            id: found.node.id,
            text: updates.text ?? found.node.text,
            color: updates.color ?? found.node.color
          });
          if (!topic) {
            return { ok: false, message: "Topic cards need a short label." };
          }
          commitBlocks(
            updateInlineNode(blocksRef.current, topicId, () => topic),
            currentSelection(),
            updates.color && !updates.text ? "recolor-topic" : "edit-topic",
            true
          );
          updateSelectedTopic(topicId);
          return { ok: true, topic };
        },
        removeTopic(topicId) {
          const edit = removeInlineNode(blocksRef.current, topicId);
          if (!edit) {
            return false;
          }
          applyModelEdit(edit, "remove-topic");
          return true;
        },
        clearSelectedBlock() {
          updateSelectedBlock(null);
          clearTokenSelection();
          pendingPageLinkPointRef.current = null;
          pendingTopicSelectionRef.current = null;
          if (bodyRef.current) {
            clearSelectedPageLink(bodyRef.current);
          }
        },
        selectTextMatch(blockId, query, occurrenceIndex) {
          if (!bodyRef.current) {
            return false;
          }
          updateSelectedBlock(null);
          clearTokenSelection();
          return selectTextMatchInBlock(
            bodyRef.current,
            blockId,
            query,
            occurrenceIndex
          );
        },
        undo: performUndo,
        redo: performRedo
      }),
      [currentPage, documentCapabilities, note, onChangeBlocks, onOpenPageLink]
    );

    return (
      <div className="note-editor">
        <div
          ref={bodyRef}
          className="note-editor__body note-editor__body--model"
          role="textbox"
          aria-label="Note body"
          aria-multiline="true"
          contentEditable={!loading}
          suppressContentEditableWarning
          onPointerDownCapture={(event) => {
            event.stopPropagation();
            logInteraction("pointerdown", {
              button: event.button,
              pointerType: event.pointerType
            });
          }}
          onWheelCapture={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (bodyRef.current?.contains(event.relatedTarget as Node | null)) {
              return;
            }
            updateHistorySelectionFromDom();
            void onBlur();
          }}
          onCopy={(event) => {
            if (!bodyRef.current) {
              return;
            }
            if (selectedBlockIdRef.current) {
              const payload = copySelectedBlock(
                bodyRef.current,
                selectedBlockIdRef.current
              );
              if (payload && event.nativeEvent.clipboardData) {
                event.preventDefault();
                event.nativeEvent.clipboardData.setData("text/plain", payload.text);
                event.nativeEvent.clipboardData.setData("text/html", payload.html);
                event.nativeEvent.clipboardData.setData(
                  NOTE_CLIPBOARD_MIME,
                  payload.internalHtml
                );
              }
              return;
            }
            const payload = currentClipboardPayload();
            if (payload && event.nativeEvent.clipboardData) {
              event.preventDefault();
              writeClipboardDataTransfer(event.nativeEvent.clipboardData, payload);
            }
          }}
          onCut={(event) => {
            if (!bodyRef.current) {
              return;
            }
            const handled = performCutToDataTransfer(event.nativeEvent.clipboardData);
            if (handled) {
              event.preventDefault();
            }
          }}
          onPaste={(event) => {
            const clipboard = event.nativeEvent.clipboardData;
            if (!clipboard) {
              return;
            }
            const internalHtml = clipboard.getData(NOTE_CLIPBOARD_MIME);
            const richHtml = clipboard.getData("text/html");
            if (
              internalHtml ||
              (richHtml &&
                (richHtml.includes("data-inline-type=\"page-link\"") ||
                  richHtml.includes("data-inline-type=\"topic-card\"")))
            ) {
              event.preventDefault();
              pasteBlocks(internalHtml ? clipboardBlocksFromHtml(internalHtml) : clipboardBlocksFromHtml(richHtml));
            }
          }}
          onDrop={(event) => {
            const transfer = event.dataTransfer;
            if (!transfer) {
              return;
            }
            const internalHtml = transfer.getData(NOTE_CLIPBOARD_MIME);
            const richHtml = transfer.getData("text/html");
            if (
              internalHtml ||
              (richHtml &&
                (richHtml.includes("data-inline-type=\"page-link\"") ||
                  richHtml.includes("data-inline-type=\"topic-card\"")))
            ) {
              event.preventDefault();
              pasteBlocks(internalHtml ? clipboardBlocksFromHtml(internalHtml) : clipboardBlocksFromHtml(richHtml));
            }
          }}
          onInput={(event) => {
            const inputEvent = event.nativeEvent as InputEvent;
            if (shouldLogBeforeInput(inputEvent.inputType)) {
              logInteraction("input", {
                inputType: inputEvent.inputType,
                data: inputEvent.data
              });
            }
            if (!compositionSessionRef.current) {
              if (shouldLogBeforeInput(inputEvent.inputType)) {
                logInteraction("input-ignored", {
                  reason: "model-owned-text",
                  inputType: inputEvent.inputType
                });
              }
            }
          }}
          onBeforeInput={(event) => {
            const inputEvent = event.nativeEvent as InputEvent;
            if (inputEvent.defaultPrevented) {
              event.preventDefault();
              return;
            }
            if (handleBeforeInputEvent(inputEvent)) {
              event.preventDefault();
            }
          }}
          onCompositionStart={(event) => {
            const selection = currentSelection();
            if (!selection) {
              return;
            }
            const blockId = selection.focus.blockId;
            const host =
              blockContentElement(event.target) ??
              findBlockElement(bodyRef.current!, blockId)?.querySelector<HTMLElement>(
                ".note-editor__block-content"
              ) ??
              null;
            compositionSessionRef.current = {
              blockId,
              host,
              marks: effectiveTextMarks(selection) ?? null,
              selection
            };
          }}
          onCompositionEnd={(event) => {
            const session = compositionSessionRef.current;
            compositionSessionRef.current = null;
            if (!session) {
              return;
            }
            if (
              !blocksRef.current.some((block) => block.id === session.blockId) ||
              (session.host && !bodyRef.current?.contains(session.host))
            ) {
              rerenderFromModel(session.selection);
              return;
            }
            const text = event.data ?? "";
            if (text.length > 0 || !isCollapsedModelSelection(session.selection)) {
              applyModelEdit(
                insertTextAtSelection(
                  blocksRef.current,
                  session.selection,
                  text,
                  session.marks ?? undefined
                ),
                "typing"
              );
              return;
            }
            rerenderFromModel(session.selection);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (shouldLogKeyDown(event.nativeEvent)) {
              logInteraction("keydown", {
                key: event.key,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                shiftKey: event.shiftKey
              });
            }
            if (event.metaKey || event.ctrlKey) {
              const key = event.key.toLowerCase();
              if (key === "a") {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.closest("input, textarea, select")
                ) {
                  return;
                }
                event.preventDefault();
                selectAllBlocks();
                return;
              }
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
              if (key === "b" || key === "i") {
                event.preventDefault();
                toggleSelectionMark(key === "b" ? "bold" : "italic");
                return;
              }
            }
            if (event.key === "Tab") {
              const selection = currentSelection();
              if (selection) {
                event.preventDefault();
                applyModelEdit(
                  replaceModelRange(blocksRef.current, selection, [
                    createTextNode("\t")
                  ]),
                  "typing"
                );
              }
              return;
            }
            if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "ArrowUp" ||
              event.key === "ArrowDown"
            ) {
              if (selectedPageLinkIdRef.current || selectedTopicIdRef.current) {
                const atomic = selectedAtomicInline();
                const found = atomic ? findInlineNode(blocksRef.current, atomic.id) : null;
                if (found) {
                  event.preventDefault();
                  const offset =
                    inlineNodeStartOffset(found.block, found.inlineIndex) +
                    (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0);
                  clearTokenSelection();
                  moveSelectionTo(blockOffsetToPoint(found.block, offset));
                }
                return;
              }
              if (handleCrossBlockArrow(event.key, event.shiftKey)) {
                event.preventDefault();
              }
            }
          }}
          onPointerDown={(event) => {
            if (!bodyRef.current || event.button !== 0 || !documentCapabilities) {
              return;
            }
            const targetElement = closestTargetElement(event.target);
            const pageLink =
              targetElement
                ? targetElement.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            const pageLinkId = pageLink?.dataset.pageLinkId;
            const found = pageLinkId
              ? findInlineNode(blocksRef.current, pageLinkId)
              : null;
            if (pageLink && found) {
              if (
                found.node.type === "page-link" &&
                found.node.origin?.kind === "heading-reference"
              ) {
                return;
              }
              event.preventDefault();
              const rect = pageLink.getBoundingClientRect();
              const after = event.clientX >= rect.left + rect.width / 2;
              const offset =
                inlineNodeStartOffset(found.block, found.inlineIndex) +
                (after ? 1 : 0);
              clearTokenSelection();
              moveSelectionTo(blockOffsetToPoint(found.block, offset));
            }
          }}
          onMouseDown={(event) => {
            if (!bodyRef.current) {
              return;
            }
            const targetElement = closestTargetElement(event.target);
            const topic =
              targetElement
                ? targetElement.closest<HTMLElement>("[data-inline-type='topic-card']")
                : null;
            if (topic) {
              event.preventDefault();
              updateSelectedPageLink(null);
              updateSelectedTopic(topic.dataset.topicId ?? null);
              updateSelectedBlock(
                findClosestBlockElement(bodyRef.current, topic)?.dataset.blockId ?? null
              );
              return;
            }
            if (
              !targetElement ||
              !targetElement.closest("[data-inline-type='page-link']")
            ) {
              clearTokenSelection();
              updateSelectedBlock(null);
            }
          }}
          onDoubleClick={(event) => {
            const targetElement = closestTargetElement(event.target);
            const pageLink =
              targetElement
                ? targetElement.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            if (pageLink?.dataset.pageLinkId) {
              event.preventDefault();
              updateSelectedPageLink(pageLink.dataset.pageLinkId);
            }
          }}
          onClick={(event) => {
            const targetElement = closestTargetElement(event.target);
            const topic =
              targetElement
                ? targetElement.closest<HTMLElement>("[data-inline-type='topic-card']")
                : null;
            if (topic) {
              event.preventDefault();
              event.stopPropagation();
              updateSelectedTopic(topic.dataset.topicId ?? null);
              return;
            }
            const pageLink =
              targetElement
                ? targetElement.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            const pageLinkId = pageLink?.dataset.pageLinkId;
            logInteraction("page-link-click", {
              pageLinkId: pageLinkId ?? null,
              documentCapabilities,
              blockId:
                pageLink
                  ?.closest<HTMLElement>("[data-block-id]")
                  ?.dataset.blockId ?? null,
              targetTag: targetElement?.tagName ?? null,
              originKind: pageLink?.dataset.pageLinkOriginKind ?? null,
              originOwnerBlockId:
                pageLink?.dataset.pageLinkOriginOwnerBlockId ?? null
            });
            if (!pageLinkId || !documentCapabilities) {
              logInteraction("page-link-click-ignored", {
                reason: !pageLinkId ? "missing-page-link-id" : "document-capabilities-disabled"
              });
              return;
            }
            const node = resolvePageLink(pageLinkId);
            if (!node) {
              logInteraction("page-link-click-unresolved", {
                pageLinkId
              });
              return;
            }
            logInteraction("page-link-click-resolved", {
              pageLinkId,
              documentId: node.documentId,
              pdfPageIndex: node.pdfPageIndex,
              bookPageLabel: node.bookPageLabel,
              originKind: node.origin?.kind ?? null,
              originOwnerBlockId:
                node.origin?.kind === "heading-reference" ? node.origin.ownerBlockId : null
            });
            event.preventDefault();
            event.stopPropagation();
            updateSelectedPageLink(pageLinkId);
            logInteraction("page-link-click-dispatch-open", {
              pageLinkId
            });
            onOpenPageLink(node);
          }}
        >
          {renderedBlocks.map((block) => (
            <NoteBlockView key={block.id} block={block} />
          ))}
        </div>
      </div>
    );
  }
);

export default ModelNoteEditor;
