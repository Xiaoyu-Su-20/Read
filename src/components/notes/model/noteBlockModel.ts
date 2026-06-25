import {
  createEmptyNoteBlock,
  createTextNode,
  normalizeNoteBlocks,
  normalizeNoteInlineNodes
} from "../../../lib/notes";
import type {
  NoteBlock,
  NoteBlockType,
  NoteInlineNode,
  NoteModelPoint,
  NoteModelSelection,
  NoteTextNode
} from "../../../lib/types";

export type NoteModelEdit = {
  blocks: NoteBlock[];
  selection: NoteModelSelection;
};

export type TextMark = "bold" | "italic";

function cloneInlineNode(node: NoteInlineNode): NoteInlineNode {
  return { ...node };
}

function cloneBlock(block: NoteBlock): NoteBlock {
  return {
    ...block,
    children: block.children.map(cloneInlineNode)
  };
}

function inlineLength(node: NoteInlineNode) {
  return node.type === "text" ? node.text.length : 1;
}

export function blockLogicalLength(block: NoteBlock) {
  return block.children.reduce((length, node) => length + inlineLength(node), 0);
}

export function pointToBlockOffset(block: NoteBlock, point: NoteModelPoint) {
  const targetIndex = Math.max(0, Math.min(point.inlineIndex, block.children.length));
  let offset = 0;

  for (let index = 0; index < targetIndex; index += 1) {
    offset += inlineLength(block.children[index]);
  }

  const node = block.children[targetIndex];
  if (!node) {
    return offset;
  }

  if (node.type === "text") {
    return offset + Math.max(0, Math.min(point.textOffset, node.text.length));
  }

  return offset + (point.affinity === "after" ? 1 : 0);
}

export function blockOffsetToPoint(
  block: NoteBlock,
  requestedOffset: number,
  affinity: NoteModelPoint["affinity"] = "after"
): NoteModelPoint {
  const offset = Math.max(0, Math.min(requestedOffset, blockLogicalLength(block)));
  let cursor = 0;

  for (let index = 0; index < block.children.length; index += 1) {
    const node = block.children[index];
    const length = inlineLength(node);
    const end = cursor + length;

    if (node.type === "text") {
      if (offset <= end) {
        return {
          blockId: block.id,
          inlineIndex: index,
          textOffset: offset - cursor,
          affinity
        };
      }
    } else if (offset <= end) {
      return {
        blockId: block.id,
        inlineIndex: index,
        textOffset: 0,
        affinity: offset === cursor ? "before" : "after"
      };
    }

    cursor = end;
  }

  return {
    blockId: block.id,
    inlineIndex: block.children.length,
    textOffset: 0,
    affinity: "after"
  };
}

export function collapsedModelSelection(point: NoteModelPoint): NoteModelSelection {
  return {
    anchor: { ...point },
    focus: { ...point }
  };
}

function splitTextNode(node: NoteTextNode, offset: number) {
  const clampedOffset = Math.max(0, Math.min(offset, node.text.length));
  const marks = {
    ...(node.bold ? { bold: true } : {}),
    ...(node.italic ? { italic: true } : {})
  };
  return {
    before: clampedOffset > 0 ? createTextNode(node.text.slice(0, clampedOffset), marks) : null,
    after:
      clampedOffset < node.text.length
        ? createTextNode(node.text.slice(clampedOffset), marks)
        : null
  };
}

function samePoint(left: NoteModelPoint, right: NoteModelPoint) {
  return (
    left.blockId === right.blockId &&
    left.inlineIndex === right.inlineIndex &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity
  );
}

function textNodeMarks(node: NoteTextNode) {
  return {
    bold: Boolean(node.bold),
    italic: Boolean(node.italic)
  };
}

function updateTextNodeMark(node: NoteTextNode, mark: TextMark, enabled: boolean) {
  return createTextNode(node.text, {
    ...textNodeMarks(node),
    [mark]: enabled
  });
}

function compactInlineNodes(nodes: NoteInlineNode[]) {
  const normalized = normalizeNoteInlineNodes(nodes);
  if (normalized.length <= 1) {
    return normalized;
  }
  const compacted = normalized.filter((node) => node.type !== "text" || node.text.length > 0);
  return compacted.length > 0 ? compacted : [createTextNode("")];
}

export function splitInlineNodesAtOffset(children: NoteInlineNode[], requestedOffset: number) {
  const totalLength = children.reduce((length, node) => length + inlineLength(node), 0);
  const offset = Math.max(0, Math.min(requestedOffset, totalLength));
  const before: NoteInlineNode[] = [];
  const after: NoteInlineNode[] = [];
  let cursor = 0;

  for (const node of children) {
    const length = inlineLength(node);
    const end = cursor + length;

    if (offset <= cursor) {
      after.push(cloneInlineNode(node));
    } else if (offset >= end) {
      before.push(cloneInlineNode(node));
    } else if (node.type === "text") {
      const split = splitTextNode(node, offset - cursor);
      if (split.before) {
        before.push(split.before);
      }
      if (split.after) {
        after.push(split.after);
      }
    } else if (offset - cursor < 1) {
      after.push(cloneInlineNode(node));
    } else {
      before.push(cloneInlineNode(node));
    }

    cursor = end;
  }

  return {
    before: normalizeNoteInlineNodes(before),
    after: normalizeNoteInlineNodes(after)
  };
}

function orderedSelection(
  blocks: NoteBlock[],
  selection: NoteModelSelection
): { start: NoteModelPoint; end: NoteModelPoint } | null {
  const indexById = new Map(blocks.map((block, index) => [block.id, index]));
  const anchorIndex = indexById.get(selection.anchor.blockId);
  const focusIndex = indexById.get(selection.focus.blockId);
  if (anchorIndex == null || focusIndex == null) {
    return null;
  }

  if (anchorIndex < focusIndex) {
    return { start: selection.anchor, end: selection.focus };
  }
  if (anchorIndex > focusIndex) {
    return { start: selection.focus, end: selection.anchor };
  }

  const block = blocks[anchorIndex];
  return pointToBlockOffset(block, selection.anchor) <= pointToBlockOffset(block, selection.focus)
    ? { start: selection.anchor, end: selection.focus }
    : { start: selection.focus, end: selection.anchor };
}

export function isCollapsedModelSelection(selection: NoteModelSelection) {
  return (
    selection.anchor.blockId === selection.focus.blockId &&
    selection.anchor.inlineIndex === selection.focus.inlineIndex &&
    selection.anchor.textOffset === selection.focus.textOffset &&
    selection.anchor.affinity === selection.focus.affinity
  );
}

export function replaceModelRange(
  blocks: NoteBlock[],
  selection: NoteModelSelection,
  inserted: NoteInlineNode[] = []
): NoteModelEdit {
  const normalizedBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const ordered = orderedSelection(normalizedBlocks, selection);
  if (!ordered) {
    const fallback = normalizedBlocks[0] ?? createEmptyNoteBlock();
    const point = blockOffsetToPoint(fallback, 0);
    return {
      blocks: normalizedBlocks.length > 0 ? normalizedBlocks : [fallback],
      selection: collapsedModelSelection(point)
    };
  }

  const startIndex = normalizedBlocks.findIndex((block) => block.id === ordered.start.blockId);
  const endIndex = normalizedBlocks.findIndex((block) => block.id === ordered.end.blockId);
  const startBlock = normalizedBlocks[startIndex];
  const endBlock = normalizedBlocks[endIndex];
  const startOffset = pointToBlockOffset(startBlock, ordered.start);
  const endOffset = pointToBlockOffset(endBlock, ordered.end);
  const replacesWholeDocument =
    inserted.length === 0 &&
    startIndex === 0 &&
    endIndex === normalizedBlocks.length - 1 &&
    startOffset === 0 &&
    endOffset === blockLogicalLength(endBlock);

  if (replacesWholeDocument) {
    const empty = createEmptyNoteBlock();
    return {
      blocks: [empty],
      selection: collapsedModelSelection(blockOffsetToPoint(empty, 0))
    };
  }

  const startSplit = splitInlineNodesAtOffset(startBlock.children, startOffset);
  const endSplit = splitInlineNodesAtOffset(endBlock.children, endOffset);
  const insertedNodes = inserted.map(cloneInlineNode);
  const nextChildren = compactInlineNodes([
    ...startSplit.before,
    ...insertedNodes,
    ...endSplit.after
  ]);
  const replacementBlock: NoteBlock = {
    ...startBlock,
    children: nextChildren
  };
  const nextBlocks = [
    ...normalizedBlocks.slice(0, startIndex),
    replacementBlock,
    ...normalizedBlocks.slice(endIndex + 1)
  ];
  const caretOffset =
    startSplit.before.reduce((length, node) => length + inlineLength(node), 0) +
    insertedNodes.reduce((length, node) => length + inlineLength(node), 0);
  const caret = blockOffsetToPoint(replacementBlock, caretOffset);

  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(caret)
  };
}

export function insertTextAtSelection(
  blocks: NoteBlock[],
  selection: NoteModelSelection,
  text: string,
  marks?: { bold?: boolean; italic?: boolean }
): NoteModelEdit {
  if (text.length === 0) {
    return isCollapsedModelSelection(selection)
      ? {
          blocks: normalizeNoteBlocks(blocks).map(cloneBlock),
          selection
        }
      : replaceModelRange(blocks, selection);
  }
  return replaceModelRange(blocks, selection, [createTextNode(text, marks)]);
}

function deleteAtSelection(blocks: NoteBlock[], selection: NoteModelSelection, direction: "backward" | "forward") {
  if (!isCollapsedModelSelection(selection)) {
    return replaceModelRange(blocks, selection);
  }

  const normalizedBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const block = normalizedBlocks.find((candidate) => candidate.id === selection.focus.blockId);
  if (!block) {
    return null;
  }

  const offset = pointToBlockOffset(block, selection.focus);
  if (direction === "backward") {
    if (offset === 0) {
      return mergeBlockBackward(normalizedBlocks, block.id);
    }
    return replaceModelRange(normalizedBlocks, {
      anchor: blockOffsetToPoint(block, offset - 1),
      focus: blockOffsetToPoint(block, offset)
    });
  }

  if (offset === blockLogicalLength(block)) {
    return mergeBlockForward(normalizedBlocks, block.id);
  }
  return replaceModelRange(normalizedBlocks, {
    anchor: blockOffsetToPoint(block, offset),
    focus: blockOffsetToPoint(block, offset + 1)
  });
}

export function deleteBackward(blocks: NoteBlock[], selection: NoteModelSelection) {
  return deleteAtSelection(blocks, selection, "backward");
}

export function deleteForward(blocks: NoteBlock[], selection: NoteModelSelection) {
  return deleteAtSelection(blocks, selection, "forward");
}

export function insertBlocksAtSelection(
  blocks: NoteBlock[],
  selection: NoteModelSelection,
  insertedBlocks: NoteBlock[]
): NoteModelEdit {
  const deletion = replaceModelRange(blocks, selection);
  const targetPoint = deletion.selection.focus;
  const targetIndex = deletion.blocks.findIndex((block) => block.id === targetPoint.blockId);
  if (targetIndex < 0 || insertedBlocks.length === 0) {
    return deletion;
  }

  const target = deletion.blocks[targetIndex];
  const targetOffset = pointToBlockOffset(target, targetPoint);
  const targetSplit = splitInlineNodesAtOffset(target.children, targetOffset);
  const normalizedInserted = normalizeNoteBlocks(insertedBlocks).map(cloneBlock);

  if (normalizedInserted.length === 1) {
    target.children = normalizeNoteInlineNodes([
      ...targetSplit.before,
      ...normalizedInserted[0].children,
      ...targetSplit.after
    ]);
    const caretOffset =
      targetSplit.before.reduce((length, node) => length + inlineLength(node), 0) +
      normalizedInserted[0].children.reduce((length, node) => length + inlineLength(node), 0);
    return {
      blocks: normalizeNoteBlocks(deletion.blocks),
      selection: collapsedModelSelection(blockOffsetToPoint(target, caretOffset))
    };
  }

  const first = normalizedInserted[0];
  const last = normalizedInserted[normalizedInserted.length - 1];
  target.children = normalizeNoteInlineNodes([...targetSplit.before, ...first.children]);
  const middle = normalizedInserted.slice(1, -1);
  const lastBlock: NoteBlock = {
    ...last,
    id: crypto.randomUUID(),
    children: normalizeNoteInlineNodes([...last.children, ...targetSplit.after])
  };
  const nextBlocks = [
    ...deletion.blocks.slice(0, targetIndex),
    target,
    ...middle.map((block) => ({ ...block, id: crypto.randomUUID() })),
    lastBlock,
    ...deletion.blocks.slice(targetIndex + 1)
  ];
  const caretOffset = last.children.reduce((length, node) => length + inlineLength(node), 0);

  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(blockOffsetToPoint(lastBlock, caretOffset))
  };
}

export function selectedPlainText(
  blocks: NoteBlock[],
  selection: NoteModelSelection
): { block: NoteBlock; text: string } | null {
  const ordered = orderedSelection(blocks, selection);
  if (!ordered || ordered.start.blockId !== ordered.end.blockId) {
    return null;
  }
  const block = blocks.find((candidate) => candidate.id === ordered.start.blockId);
  if (!block) {
    return null;
  }
  const startOffset = pointToBlockOffset(block, ordered.start);
  const endOffset = pointToBlockOffset(block, ordered.end);
  const startSplit = splitInlineNodesAtOffset(block.children, startOffset);
  const selectedLength = Math.max(0, endOffset - startOffset);
  const selected = splitInlineNodesAtOffset(startSplit.after, selectedLength).before;
  if (selected.some((node) => node.type !== "text")) {
    return null;
  }
  return {
    block,
    text: selected.map((node) => node.text).join("")
  };
}

export function textMarksAtPoint(blocks: NoteBlock[], point: NoteModelPoint) {
  const block = blocks.find((candidate) => candidate.id === point.blockId);
  if (!block) {
    return { bold: false, italic: false };
  }

  const current = block.children[point.inlineIndex];
  if (current?.type === "text") {
    return textNodeMarks(current);
  }

  for (let index = point.inlineIndex - 1; index >= 0; index -= 1) {
    const node = block.children[index];
    if (node.type === "text") {
      return textNodeMarks(node);
    }
  }

  for (let index = point.inlineIndex + (current ? 1 : 0); index < block.children.length; index += 1) {
    const node = block.children[index];
    if (node.type === "text") {
      return textNodeMarks(node);
    }
  }

  return { bold: false, italic: false };
}

export function toggleTextMarkInSelection(
  blocks: NoteBlock[],
  selection: NoteModelSelection,
  mark: TextMark
): NoteModelEdit | null {
  if (isCollapsedModelSelection(selection)) {
    return null;
  }

  const normalizedBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const ordered = orderedSelection(normalizedBlocks, selection);
  if (!ordered) {
    return null;
  }

  const startIndex = normalizedBlocks.findIndex((block) => block.id === ordered.start.blockId);
  const endIndex = normalizedBlocks.findIndex((block) => block.id === ordered.end.blockId);
  if (startIndex < 0 || endIndex < 0) {
    return null;
  }

  let sawSelectedText = false;
  let allSelectedTextHasMark = true;

  for (let blockIndex = startIndex; blockIndex <= endIndex; blockIndex += 1) {
    const block = normalizedBlocks[blockIndex];
    const startOffset =
      blockIndex === startIndex ? pointToBlockOffset(block, ordered.start) : 0;
    const endOffset =
      blockIndex === endIndex ? pointToBlockOffset(block, ordered.end) : blockLogicalLength(block);
    if (endOffset <= startOffset) {
      continue;
    }
    const beforeSplit = splitInlineNodesAtOffset(block.children, startOffset);
    const selectedSplit = splitInlineNodesAtOffset(beforeSplit.after, endOffset - startOffset);
    for (const node of selectedSplit.before) {
      if (node.type !== "text" || node.text.length === 0) {
        continue;
      }
      sawSelectedText = true;
      if (!Boolean(node[mark])) {
        allSelectedTextHasMark = false;
      }
    }
  }

  if (!sawSelectedText) {
    return null;
  }

  const nextEnabled = !allSelectedTextHasMark;
  const nextBlocks = normalizedBlocks.map(cloneBlock);

  for (let blockIndex = startIndex; blockIndex <= endIndex; blockIndex += 1) {
    const block = nextBlocks[blockIndex];
    const startOffset =
      blockIndex === startIndex ? pointToBlockOffset(block, ordered.start) : 0;
    const endOffset =
      blockIndex === endIndex ? pointToBlockOffset(block, ordered.end) : blockLogicalLength(block);
    if (endOffset <= startOffset) {
      continue;
    }
    const beforeSplit = splitInlineNodesAtOffset(block.children, startOffset);
    const selectedSplit = splitInlineNodesAtOffset(beforeSplit.after, endOffset - startOffset);
    block.children = compactInlineNodes([
      ...beforeSplit.before,
      ...selectedSplit.before.map((node) =>
        node.type === "text" ? updateTextNodeMark(node, mark, nextEnabled) : cloneInlineNode(node)
      ),
      ...selectedSplit.after
    ]);
  }

  const anchorOffset = pointToBlockOffset(
    normalizedBlocks.find((block) => block.id === selection.anchor.blockId)!,
    selection.anchor
  );
  const focusOffset = pointToBlockOffset(
    normalizedBlocks.find((block) => block.id === selection.focus.blockId)!,
    selection.focus
  );
  const anchorBlock = nextBlocks.find((block) => block.id === selection.anchor.blockId)!;
  const focusBlock = nextBlocks.find((block) => block.id === selection.focus.blockId)!;

  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: {
      anchor: blockOffsetToPoint(anchorBlock, anchorOffset, selection.anchor.affinity),
      focus: blockOffsetToPoint(focusBlock, focusOffset, selection.focus.affinity)
    }
  };
}

export function findInlineNode(
  blocks: NoteBlock[],
  id: string
): { block: NoteBlock; blockIndex: number; node: NoteInlineNode; inlineIndex: number } | null {
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const inlineIndex = block.children.findIndex(
      (node) => node.type !== "text" && node.id === id
    );
    if (inlineIndex >= 0) {
      return {
        block,
        blockIndex,
        node: block.children[inlineIndex],
        inlineIndex
      };
    }
  }
  return null;
}

export function updateInlineNode(
  blocks: NoteBlock[],
  id: string,
  update: (node: NoteInlineNode) => NoteInlineNode
) {
  return normalizeNoteBlocks(
    blocks.map((block) => ({
      ...cloneBlock(block),
      children: block.children.map((node) =>
        node.type !== "text" && node.id === id ? update(cloneInlineNode(node)) : cloneInlineNode(node)
      )
    }))
  );
}

export function removeInlineNode(blocks: NoteBlock[], id: string): NoteModelEdit | null {
  const found = findInlineNode(blocks, id);
  if (!found) {
    return null;
  }
  const beforeOffset = found.block.children
    .slice(0, found.inlineIndex)
    .reduce((length, node) => length + inlineLength(node), 0);
  const start = blockOffsetToPoint(found.block, beforeOffset, "before");
  const end = blockOffsetToPoint(found.block, beforeOffset + 1, "after");
  return replaceModelRange(blocks, { anchor: start, focus: end });
}

export function splitBlockAtSelection(
  blocks: NoteBlock[],
  selection: NoteModelSelection,
  createId: () => string = () => crypto.randomUUID()
): NoteModelEdit {
  const deletion = isCollapsedModelSelection(selection)
    ? { blocks: normalizeNoteBlocks(blocks).map(cloneBlock), selection }
    : replaceModelRange(blocks, selection);
  const point = deletion.selection.focus;
  const blockIndex = deletion.blocks.findIndex((block) => block.id === point.blockId);
  if (blockIndex < 0) {
    return deletion;
  }

  const block = deletion.blocks[blockIndex];
  const offset = pointToBlockOffset(block, point);
  const blockLength = blockLogicalLength(block);

  if (offset === 0) {
    const paragraph: NoteBlock = {
      id: createId(),
      type: "paragraph",
      children: [createTextNode("")]
    };
    const nextBlocks = [
      ...deletion.blocks.slice(0, blockIndex),
      paragraph,
      block,
      ...deletion.blocks.slice(blockIndex + 1)
    ];
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(paragraph, 0))
    };
  }

  if (offset === blockLength) {
    const paragraph: NoteBlock = {
      id: createId(),
      type: "paragraph",
      children: [createTextNode("")]
    };
    const nextBlocks = [
      ...deletion.blocks.slice(0, blockIndex + 1),
      paragraph,
      ...deletion.blocks.slice(blockIndex + 1)
    ];
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(paragraph, 0))
    };
  }

  const split = splitInlineNodesAtOffset(block.children, offset);
  const rightBlock: NoteBlock = {
    id: createId(),
    type: "paragraph",
    children: split.after,
    sourceReference: null
  };
  const leftBlock: NoteBlock = {
    ...block,
    children: split.before
  };
  const nextBlocks = [
    ...deletion.blocks.slice(0, blockIndex),
    leftBlock,
    rightBlock,
    ...deletion.blocks.slice(blockIndex + 1)
  ];

  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(blockOffsetToPoint(rightBlock, 0))
  };
}

export function mergeBlockBackward(blocks: NoteBlock[], blockId: string): NoteModelEdit | null {
  const nextBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const blockIndex = nextBlocks.findIndex((block) => block.id === blockId);
  if (blockIndex <= 0) {
    const first = nextBlocks[0];
    if (!first || first.type === "paragraph") {
      return null;
    }
    first.type = "paragraph";
    first.sourceReference = null;
    return {
      blocks: nextBlocks,
      selection: collapsedModelSelection(blockOffsetToPoint(first, 0))
    };
  }

  const previous = nextBlocks[blockIndex - 1];
  const current = nextBlocks[blockIndex];
  const previousLength = blockLogicalLength(previous);
  const currentLength = blockLogicalLength(current);

  if (currentLength === 0) {
    nextBlocks.splice(blockIndex, 1);
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(previous, previousLength))
    };
  }

  if (previousLength === 0) {
    nextBlocks.splice(blockIndex - 1, 1);
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(current, 0))
    };
  }

  previous.children = normalizeNoteInlineNodes([...previous.children, ...current.children]);
  nextBlocks.splice(blockIndex, 1);
  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(blockOffsetToPoint(previous, previousLength))
  };
}

export function mergeBlockForward(blocks: NoteBlock[], blockId: string): NoteModelEdit | null {
  const nextBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const blockIndex = nextBlocks.findIndex((block) => block.id === blockId);
  if (blockIndex < 0 || blockIndex >= nextBlocks.length - 1) {
    return null;
  }

  const current = nextBlocks[blockIndex];
  const next = nextBlocks[blockIndex + 1];
  const currentLength = blockLogicalLength(current);
  const nextLength = blockLogicalLength(next);

  if (currentLength === 0) {
    nextBlocks.splice(blockIndex, 1);
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(next, 0))
    };
  }

  if (nextLength === 0) {
    nextBlocks.splice(blockIndex + 1, 1);
    return {
      blocks: normalizeNoteBlocks(nextBlocks),
      selection: collapsedModelSelection(blockOffsetToPoint(current, currentLength))
    };
  }

  current.children = normalizeNoteInlineNodes([...current.children, ...next.children]);
  nextBlocks.splice(blockIndex + 1, 1);
  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(blockOffsetToPoint(current, currentLength))
  };
}

export function convertBlockType(
  blocks: NoteBlock[],
  blockId: string,
  type: NoteBlockType
): NoteBlock[] {
  return normalizeNoteBlocks(
    blocks.map((block) =>
      block.id === blockId
        ? {
            ...cloneBlock(block),
            type,
            sourceReference: type === "paragraph" ? null : block.sourceReference ?? null
          }
        : cloneBlock(block)
    )
  );
}

export function removeModelBlock(blocks: NoteBlock[], blockId: string): NoteModelEdit | null {
  const nextBlocks = normalizeNoteBlocks(blocks).map(cloneBlock);
  const index = nextBlocks.findIndex((block) => block.id === blockId);
  if (index < 0) {
    return null;
  }

  nextBlocks.splice(index, 1);
  if (nextBlocks.length === 0) {
    const empty = createEmptyNoteBlock();
    return {
      blocks: [empty],
      selection: collapsedModelSelection(blockOffsetToPoint(empty, 0))
    };
  }

  const target = nextBlocks[index] ?? nextBlocks[index - 1];
  const offset = nextBlocks[index] ? 0 : blockLogicalLength(target);
  return {
    blocks: normalizeNoteBlocks(nextBlocks),
    selection: collapsedModelSelection(blockOffsetToPoint(target, offset))
  };
}
