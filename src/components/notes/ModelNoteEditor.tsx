import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import { logNoteDebugEvent } from "../../lib/api";
import { debugAction, debugLocalAction } from "../../lib/debugLog";
import {
  blockLogicalLength,
  blockOffsetToPoint,
  collapsedModelSelection,
  convertBlockType,
  findInlineNode,
  insertBlocksAtSelection,
  isCollapsedModelSelection,
  mergeBlockBackward,
  mergeBlockForward,
  pointToBlockOffset,
  removeInlineNode,
  removeModelBlock,
  replaceModelRange,
  selectedPlainText,
  splitBlockAtSelection,
  updateInlineNode,
  type NoteModelEdit
} from "../../lib/noteBlockModel";
import {
  captureModelSelection,
  modelPointFromDomPoint,
  restoreModelSelection
} from "../../lib/noteBlockSelection";
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
  handleCopy,
  isPointWithinPageLinkContent,
  isPointWithinSelectionContent,
  isPointWithinTopicCardContent,
  normalizeNoteEditorDom,
  parseNoteBlocksFromEditor,
  parseNoteInlineNodesFromElement,
  renderNoteInlineNodesHtml,
  resolveCollapsedRangeAtPoint,
  selectBlockElement,
  selectPageLinkToken,
  selectTextMatchInBlock,
  selectTopicCardToken
} from "../../lib/noteEditorDom";
import {
  commitNoteModelHistory,
  createNoteModelHistory,
  redoNoteModelHistory,
  replaceNoteModelHistorySelection,
  undoNoteModelHistory,
  type NoteModelHistoryState
} from "../../lib/noteModelHistory";
import {
  createEmptyNoteBlock,
  createPageLinkNode,
  createTextNode,
  createTopicCardNode,
  formatPageLinkText,
  normalizeNoteBlocks
} from "../../lib/notes";
import { DEFAULT_TOPIC_COLOR, normalizeTopicText } from "../../lib/paragraphTopics";
import { extractStandaloneSpellcheckWord } from "../../lib/spellcheck";
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
} from "../../lib/types";
import { computeCenteredChildScrollTop } from "./noteEditorScroll";

const NOTE_CLIPBOARD_MIME = "application/x-calmreader-note-fragment";
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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

function blocksEqual(left: NoteBlock[], right: NoteBlock[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneBlocks(blocks: NoteBlock[]) {
  return JSON.parse(JSON.stringify(blocks)) as NoteBlock[];
}

function blockContentElement(node: EventTarget | null) {
  return node instanceof HTMLElement
    ? node.closest<HTMLElement>(".note-editor__block-content")
    : null;
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
    const blocksRef = useRef<NoteBlock[]>(
      normalizeNoteBlocks(note?.blocks ?? [createEmptyNoteBlock()])
    );
    const [renderedBlocks, setRenderedBlocks] = useState(() => cloneBlocks(blocksRef.current));
    const selectedBlockIdRef = useRef<string | null>(null);
    const selectedPageLinkIdRef = useRef<string | null>(null);
    const selectedTopicIdRef = useRef<string | null>(null);
    const pendingPageLinkPointRef = useRef<NoteModelPoint | null>(null);
    const pendingTopicSelectionRef = useRef<NoteModelSelection | null>(null);
    const pendingSelectionRestoreRef = useRef<NoteModelSelection | null>(null);
    const historyRef = useRef<NoteModelHistoryState | null>(null);
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
      selectedBlockIdRef.current = blockId;
      if (bodyRef.current) {
        selectBlockElement(bodyRef.current, blockId);
      }
    }

    function updateSelectedPageLink(pageLinkId: string | null) {
      selectedPageLinkIdRef.current = pageLinkId;
      if (bodyRef.current) {
        selectPageLinkToken(bodyRef.current, pageLinkId);
      }
    }

    function updateSelectedTopic(topicId: string | null) {
      selectedTopicIdRef.current = topicId;
      if (bodyRef.current) {
        selectTopicCardToken(bodyRef.current, topicId);
      }
    }

    function clearTokenSelection() {
      updateSelectedPageLink(null);
      updateSelectedTopic(null);
    }

    function commitBlocks(
      nextBlocks: NoteBlock[],
      selection: NoteModelSelection | null,
      mergeKey: NoteHistoryMergeKey | null,
      render: boolean
    ) {
      const normalized = normalizeNoteBlocks(nextBlocks, note?.bookId ?? null);
      const previous = blocksRef.current;
      blocksRef.current = normalized;
      const history = historyRef.current;

      if (!history) {
        historyRef.current = createNoteModelHistory({ blocks: normalized, selection });
      } else if (blocksEqual(history.current.blocks, normalized)) {
        historyRef.current = replaceNoteModelHistorySelection(history, selection);
      } else {
        historyRef.current = commitNoteModelHistory(
          history,
          { blocks: normalized, selection },
          mergeKey
        );
      }

      if (render) {
        pendingSelectionRestoreRef.current = selection;
        setRenderedBlocks(cloneBlocks(normalized));
      }
      if (!blocksEqual(previous, normalized)) {
        onChangeBlocks(normalized);
      }
    }

    function applyModelEdit(edit: NoteModelEdit, mergeKey: NoteHistoryMergeKey | null) {
      clearTokenSelection();
      updateSelectedBlock(null);
      commitBlocks(edit.blocks, edit.selection, mergeKey, true);
    }

    function syncActiveBlock(content: HTMLElement, mergeKey: NoteHistoryMergeKey | null) {
      const blockId = content.parentElement?.dataset.blockId;
      if (!blockId) {
        return;
      }
      const nextBlocks = blocksRef.current.map((block) =>
        block.id === blockId
          ? { ...block, children: parseNoteInlineNodesFromElement(content) }
          : block
      );
      commitBlocks(nextBlocks, currentSelection(), mergeKey, false);
    }

    function updateHistorySelectionFromDom() {
      if (!historyRef.current || applyingHistoryRef.current) {
        return;
      }
      historyRef.current = replaceNoteModelHistorySelection(
        historyRef.current,
        currentSelection()
      );
    }

    function applyHistoryState(nextHistory: NoteModelHistoryState) {
      applyingHistoryRef.current = true;
      historyRef.current = nextHistory;
      blocksRef.current = normalizeNoteBlocks(nextHistory.current.blocks, note?.bookId ?? null);
      pendingSelectionRestoreRef.current = nextHistory.current.selection;
      setRenderedBlocks(cloneBlocks(blocksRef.current));
      onChangeBlocks(blocksRef.current);
      clearTokenSelection();
      updateSelectedBlock(null);
      applyingHistoryRef.current = false;
      return true;
    }

    function performUndo() {
      updateHistorySelectionFromDom();
      const next = historyRef.current ? undoNoteModelHistory(historyRef.current) : null;
      return next ? applyHistoryState(next) : false;
    }

    function performRedo() {
      updateHistorySelectionFromDom();
      const next = historyRef.current ? redoNoteModelHistory(historyRef.current) : null;
      return next ? applyHistoryState(next) : false;
    }

    function focusEditor() {
      const root = bodyRef.current;
      if (!root) {
        return;
      }
      const selected = currentSelection()?.focus.blockId;
      const content =
        (selected
          ? root.querySelector<HTMLElement>(
              `[data-block-id="${CSS.escape(selected)}"] > .note-editor__block-content`
            )
          : null) ?? root.querySelector<HTMLElement>(".note-editor__block-content");
      content?.focus({ preventScroll: true });
    }

    function moveSelectionTo(point: NoteModelPoint, extend = false) {
      if (!bodyRef.current) {
        return;
      }
      const existing = currentSelection();
      const selection =
        extend && existing
          ? { anchor: existing.anchor, focus: point }
          : collapsedModelSelection(point);
      restoreModelSelection(bodyRef.current, blocksRef.current, selection);
      updateHistorySelectionFromDom();
    }

    function handleBoundaryDelete(direction: "backward" | "forward") {
      const selection = currentSelection();
      if (!selection) {
        return false;
      }
      if (!isCollapsedModelSelection(selection)) {
        applyModelEdit(replaceModelRange(blocksRef.current, selection), "delete");
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
        const selected =
          selectedPageLinkIdRef.current === atomic.id ||
          selectedTopicIdRef.current === atomic.id;
        if (selected) {
          const edit = removeInlineNode(blocksRef.current, atomic.id);
          if (edit) {
            applyModelEdit(
              edit,
              atomic.type === "page-link" ? "remove-page-link" : "remove-topic"
            );
          }
        } else if (atomic.type === "page-link") {
          updateSelectedTopic(null);
          updateSelectedPageLink(atomic.id);
        } else {
          updateSelectedPageLink(null);
          updateSelectedTopic(atomic.id);
        }
        return true;
      }

      const edit =
        direction === "backward" && offset === 0
          ? mergeBlockBackward(blocksRef.current, block.id)
          : direction === "forward" && offset === blockLogicalLength(block)
            ? mergeBlockForward(blocksRef.current, block.id)
            : null;
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
        const empty = [createEmptyNoteBlock()];
        blocksRef.current = empty;
        setRenderedBlocks(cloneBlocks(empty));
        appliedNoteIdRef.current = null;
        historyRef.current = null;
        return;
      }
      if (appliedNoteIdRef.current === note.id) {
        return;
      }
      const normalized = normalizeNoteBlocks(note.blocks, note.bookId);
      blocksRef.current = normalized;
      setRenderedBlocks(cloneBlocks(normalized));
      historyRef.current = createNoteModelHistory({ blocks: normalized, selection: null });
      appliedNoteIdRef.current = note.id;
      clearTokenSelection();
      updateSelectedBlock(null);
      pendingPageLinkPointRef.current = null;
      pendingTopicSelectionRef.current = null;
    }, [note]);

    useClientLayoutEffect(() => {
      if (!bodyRef.current) {
        return;
      }
      selectBlockElement(bodyRef.current, selectedBlockIdRef.current);
      selectPageLinkToken(bodyRef.current, selectedPageLinkIdRef.current);
      selectTopicCardToken(bodyRef.current, selectedTopicIdRef.current);
      if (pendingSelectionRestoreRef.current) {
        restoreModelSelection(
          bodyRef.current,
          blocksRef.current,
          pendingSelectionRestoreRef.current
        );
        pendingSelectionRestoreRef.current = null;
      }
    }, [renderedBlocks]);

    useEffect(() => {
      function handleSelectionChange() {
        updateHistorySelectionFromDom();
      }
      document.addEventListener("selectionchange", handleSelectionChange);
      return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, []);

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
          document.execCommand("copy");
        },
        cutSelection() {
          document.execCommand("cut");
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
          const found = findInlineNode(blocksRef.current, pageLinkId);
          if (!found || found.node.type !== "page-link") {
            return null;
          }
          onOpenPageLink(found.node);
          return found.node;
        },
        getPageLink(pageLinkId) {
          const found = findInlineNode(blocksRef.current, pageLinkId);
          return found?.node.type === "page-link" ? found.node : null;
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
            handleCopy(bodyRef.current, event.nativeEvent);
          }}
          onCut={(event) => {
            if (!bodyRef.current) {
              return;
            }
            if (selectedBlockIdRef.current) {
              const payload = copySelectedBlock(
                bodyRef.current,
                selectedBlockIdRef.current
              );
              const edit = removeModelBlock(
                blocksRef.current,
                selectedBlockIdRef.current
              );
              if (payload && edit && event.nativeEvent.clipboardData) {
                event.preventDefault();
                event.nativeEvent.clipboardData.setData("text/plain", payload.text);
                event.nativeEvent.clipboardData.setData("text/html", payload.html);
                event.nativeEvent.clipboardData.setData(
                  NOTE_CLIPBOARD_MIME,
                  payload.internalHtml
                );
                applyModelEdit(edit, "delete");
              }
              return;
            }
            const selection = currentSelection();
            if (!selection || isCollapsedModelSelection(selection)) {
              return;
            }
            handleCopy(bodyRef.current, event.nativeEvent);
            applyModelEdit(replaceModelRange(blocksRef.current, selection), "delete");
          }}
          onPaste={(event) => {
            const clipboard = event.nativeEvent.clipboardData;
            if (!clipboard) {
              return;
            }
            event.preventDefault();
            const internalHtml = clipboard.getData(NOTE_CLIPBOARD_MIME);
            const richHtml = clipboard.getData("text/html");
            const text = clipboard.getData("text/plain");
            const pastedBlocks = internalHtml
              ? clipboardBlocksFromHtml(internalHtml)
              : richHtml &&
                  (richHtml.includes("data-inline-type=\"page-link\"") ||
                    richHtml.includes("data-inline-type=\"topic-card\""))
                ? clipboardBlocksFromHtml(richHtml)
                : clipboardBlocksFromText(text);
            pasteBlocks(pastedBlocks);
          }}
          onInput={(event) => {
            const content = blockContentElement(event.target);
            if (!content) {
              return;
            }
            const inputEvent = event.nativeEvent as InputEvent;
            logInteraction("input", {
              blockId: content.parentElement?.dataset.blockId ?? null,
              inputType: inputEvent.inputType,
              data: inputEvent.data
            });
            const mergeKey: NoteHistoryMergeKey | null =
              inputEvent.inputType.startsWith("delete")
                ? "delete"
                : inputEvent.inputType.includes("Paste")
                  ? "paste"
                  : "typing";
            syncActiveBlock(content, mergeKey);
          }}
          onBeforeInput={(event) => {
            const inputEvent = event.nativeEvent as InputEvent;
            logInteraction("beforeinput", {
              inputType: inputEvent.inputType,
              data: inputEvent.data
            });
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
            if (inputEvent.inputType === "insertParagraph") {
              event.preventDefault();
              const selection = currentSelection();
              if (selection) {
                applyModelEdit(
                  splitBlockAtSelection(blocksRef.current, selection),
                  null
                );
              }
              return;
            }

            const selection = currentSelection();
            if (
              selection &&
              !isCollapsedModelSelection(selection) &&
              inputEvent.inputType === "insertText" &&
              typeof inputEvent.data === "string"
            ) {
              event.preventDefault();
              applyModelEdit(
                replaceModelRange(blocksRef.current, selection, [
                  createTextNode(inputEvent.data)
                ]),
                "typing"
              );
              return;
            }
            if (
              inputEvent.inputType === "deleteContentBackward" ||
              inputEvent.inputType === "deleteContentForward"
            ) {
              const handled = handleBoundaryDelete(
                inputEvent.inputType === "deleteContentBackward"
                  ? "backward"
                  : "forward"
              );
              if (handled) {
                event.preventDefault();
              }
              return;
            }

            const selectedAtomicId =
              selectedPageLinkIdRef.current ?? selectedTopicIdRef.current;
            if (
              selectedAtomicId &&
              (inputEvent.inputType === "insertText" ||
                inputEvent.inputType === "insertLineBreak")
            ) {
              const removal = removeInlineNode(blocksRef.current, selectedAtomicId);
              if (!removal) {
                return;
              }
              event.preventDefault();
              const inserted =
                inputEvent.inputType === "insertText" &&
                typeof inputEvent.data === "string"
                  ? [createTextNode(inputEvent.data)]
                  : [createTextNode("\n")];
              applyModelEdit(
                replaceModelRange(removal.blocks, removal.selection, inserted),
                "typing"
              );
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            logInteraction("keydown", {
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey
            });
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
              if (key === "b" || key === "i") {
                event.preventDefault();
                document.execCommand(key === "b" ? "bold" : "italic");
                requestAnimationFrame(() => {
                  const content = blockContentElement(document.activeElement);
                  if (content) {
                    syncActiveBlock(content, "format");
                  }
                });
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
                const id =
                  selectedPageLinkIdRef.current ?? selectedTopicIdRef.current;
                const found = id ? findInlineNode(blocksRef.current, id) : null;
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
            const pageLink =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            const pageLinkId = pageLink?.dataset.pageLinkId;
            const found = pageLinkId
              ? findInlineNode(blocksRef.current, pageLinkId)
              : null;
            if (pageLink && found) {
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
            const topic =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>("[data-inline-type='topic-card']")
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
              !(event.target instanceof HTMLElement) ||
              !event.target.closest("[data-inline-type='page-link']")
            ) {
              clearTokenSelection();
              updateSelectedBlock(null);
            }
          }}
          onDoubleClick={(event) => {
            const pageLink =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            if (pageLink?.dataset.pageLinkId) {
              event.preventDefault();
              updateSelectedPageLink(pageLink.dataset.pageLinkId);
            }
          }}
          onClick={(event) => {
            const topic =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>("[data-inline-type='topic-card']")
                : null;
            if (topic) {
              event.preventDefault();
              event.stopPropagation();
              updateSelectedTopic(topic.dataset.topicId ?? null);
              return;
            }
            const pageLink =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>("[data-inline-type='page-link']")
                : null;
            const pageLinkId = pageLink?.dataset.pageLinkId;
            if (!pageLinkId || !documentCapabilities) {
              return;
            }
            const found = findInlineNode(blocksRef.current, pageLinkId);
            if (found?.node.type === "page-link") {
              event.preventDefault();
              event.stopPropagation();
              updateSelectedPageLink(pageLinkId);
              onOpenPageLink(found.node);
            }
          }}
        >
          {renderedBlocks.map((block) => (
            <div
              key={block.id}
              className="note-editor__block"
              data-block-id={block.id}
              data-block-type={block.type}
              data-source-reference={
                block.sourceReference
                  ? encodeURIComponent(JSON.stringify(block.sourceReference))
                  : undefined
              }
            >
              <div
                className="note-editor__block-content"
                contentEditable={!loading}
                suppressContentEditableWarning
                spellCheck={false}
                dangerouslySetInnerHTML={{
                  __html: renderNoteInlineNodesHtml(block.children) || "<br>"
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
);

export default ModelNoteEditor;
