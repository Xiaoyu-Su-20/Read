import {
  blockOffsetToPoint,
  pointToBlockOffset
} from "../model/noteBlockModel";
import type {
  NoteBlock,
  NoteModelPoint,
  NoteModelSelection
} from "../../../lib/types";

const ATOMIC_SELECTOR = "[data-inline-type='page-link'], [data-inline-type='topic-card']";

export type NoteBlockLookup = ReadonlyMap<string, NoteBlock>;

function escapeCssIdentifier(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function closestBlock(root: HTMLElement, node: Node | null) {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const block = element?.closest<HTMLElement>("[data-block-id]") ?? null;
  return block && root.contains(block) ? block : null;
}

function blockContent(block: HTMLElement) {
  return block.querySelector<HTMLElement>(":scope > .note-editor__block-content") ?? block;
}

export function createNoteBlockLookup(blocks: NoteBlock[]): NoteBlockLookup {
  const lookup = new Map<string, NoteBlock>();
  for (const block of blocks) {
    lookup.set(block.id, block);
  }
  return lookup;
}

function lookupBlock(
  blocks: NoteBlock[],
  blockId: string | undefined,
  lookup?: NoteBlockLookup | null
) {
  if (!blockId) {
    return null;
  }
  return lookup?.get(blockId) ?? blocks.find((candidate) => candidate.id === blockId) ?? null;
}

function rootBoundaryPoint(
  root: HTMLElement,
  blocks: NoteBlock[],
  offset: number,
  lookup?: NoteBlockLookup | null
) {
  if (blocks.length === 0) {
    return null;
  }

  const clampedOffset = Math.max(0, Math.min(offset, root.childNodes.length));
  if (clampedOffset <= 0) {
    return blockOffsetToPoint(blocks[0], 0, "after");
  }

  if (clampedOffset >= root.childNodes.length) {
    const lastBlock = blocks[blocks.length - 1];
    return blockOffsetToPoint(lastBlock, pointToBlockOffset(lastBlock, {
      blockId: lastBlock.id,
      inlineIndex: lastBlock.children.length,
      textOffset: 0,
      affinity: "after"
    }), "after");
  }

  const nextChild = root.childNodes[clampedOffset];
  const nextBlockElement =
    nextChild instanceof HTMLElement ? nextChild.closest<HTMLElement>("[data-block-id]") : null;
  const nextBlock = lookupBlock(blocks, nextBlockElement?.dataset.blockId, lookup);
  return nextBlock ? blockOffsetToPoint(nextBlock, 0, "after") : null;
}

function isAtomic(element: Element) {
  return element.matches(ATOMIC_SELECTOR);
}

function domNodeLogicalLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (!(node instanceof Element)) {
    return 0;
  }
  if (isAtomic(node)) {
    return 1;
  }
  if (node.tagName === "BR") {
    return 0;
  }
  return Array.from(node.childNodes).reduce(
    (length, child) => length + domNodeLogicalLength(child),
    0
  );
}

function logicalOffsetBeforeNode(content: HTMLElement, target: Node) {
  function visit(parent: Node): { found: boolean; length: number } {
    let length = 0;
    for (const child of Array.from(parent.childNodes)) {
      if (child === target) {
        return { found: true, length };
      }
      if (child instanceof Element && !isAtomic(child)) {
        const nested = visit(child);
        if (nested.found) {
          return { found: true, length: length + nested.length };
        }
      }
      length += domNodeLogicalLength(child);
    }
    return { found: false, length };
  }
  return visit(content).length;
}

function pointOffsetInContent(content: HTMLElement, container: Node, domOffset: number) {
  const atomic =
    container instanceof Element
      ? container.closest<HTMLElement>(ATOMIC_SELECTOR)
      : container.parentElement?.closest<HTMLElement>(ATOMIC_SELECTOR);
  if (atomic && content.contains(atomic)) {
    const before = logicalOffsetBeforeNode(content, atomic);
    const rect = atomic.getBoundingClientRect();
    void rect;
    return before + (domOffset > 0 ? 1 : 0);
  }

  if (container.nodeType === Node.TEXT_NODE) {
    return (
      logicalOffsetBeforeNode(content, container) +
      Math.max(0, Math.min(domOffset, container.textContent?.length ?? 0))
    );
  }

  if (container instanceof Element) {
    let offset = container === content ? 0 : logicalOffsetBeforeNode(content, container);
    const children = Array.from(container.childNodes);
    for (let index = 0; index < Math.min(domOffset, children.length); index += 1) {
      offset += domNodeLogicalLength(children[index]);
    }
    return offset;
  }

  return 0;
}

export function modelPointFromDomPoint(
  root: HTMLElement,
  blocks: NoteBlock[],
  container: Node | null,
  offset: number,
  affinity: NoteModelPoint["affinity"],
  lookup?: NoteBlockLookup | null
) {
  if (container === root) {
    return rootBoundaryPoint(root, blocks, offset, lookup);
  }
  const blockElement = closestBlock(root, container);
  const block = lookupBlock(blocks, blockElement?.dataset.blockId, lookup);
  if (!blockElement || !block) {
    return null;
  }
  const content = blockContent(blockElement);
  return blockOffsetToPoint(
    block,
    pointOffsetInContent(content, container ?? content, offset),
    affinity
  );
}

export function captureModelSelection(
  root: HTMLElement,
  blocks: NoteBlock[],
  lookup?: NoteBlockLookup | null
): NoteModelSelection | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return null;
  }

  const anchor = modelPointFromDomPoint(
    root,
    blocks,
    selection.anchorNode,
    selection.anchorOffset,
    "after",
    lookup
  );
  const focus = modelPointFromDomPoint(
    root,
    blocks,
    selection.focusNode,
    selection.focusOffset,
    "after",
    lookup
  );
  return anchor && focus ? { anchor, focus } : null;
}

type DomPoint = {
  node: Node;
  offset: number;
};

function domPointAtOffset(content: HTMLElement, requestedOffset: number): DomPoint {
  if (requestedOffset <= 0 && domNodeLogicalLength(content) === 0) {
    return {
      node: content,
      offset: 0
    };
  }

  let remaining = Math.max(0, requestedOffset);

  function visit(parent: Node): DomPoint | null {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (remaining <= length) {
          return { node: child, offset: remaining };
        }
        remaining -= length;
        continue;
      }

      if (!(child instanceof Element)) {
        continue;
      }

      if (isAtomic(child)) {
        const index = Array.prototype.indexOf.call(parent.childNodes, child);
        if (remaining === 0) {
          return { node: parent, offset: index };
        }
        if (remaining === 1) {
          return { node: parent, offset: index + 1 };
        }
        remaining -= 1;
        continue;
      }

      if (child.tagName === "BR") {
        continue;
      }

      const result = visit(child);
      if (result) {
        return result;
      }
    }
    return null;
  }

  return visit(content) ?? {
    node: content,
    offset: content.childNodes.length
  };
}

function resolvePoint(
  root: HTMLElement,
  blocks: NoteBlock[],
  point: NoteModelPoint,
  lookup?: NoteBlockLookup | null
) {
  const block = lookupBlock(blocks, point.blockId, lookup);
  const blockElement = root.querySelector<HTMLElement>(
    `[data-block-id="${escapeCssIdentifier(point.blockId)}"]`
  );
  if (!block || !blockElement) {
    return null;
  }
  return domPointAtOffset(blockContent(blockElement), pointToBlockOffset(block, point));
}

export function restoreModelSelection(
  root: HTMLElement,
  blocks: NoteBlock[],
  selectionSnapshot: NoteModelSelection | null,
  lookup?: NoteBlockLookup | null
) {
  if (!selectionSnapshot) {
    return false;
  }
  const anchor = resolvePoint(root, blocks, selectionSnapshot.anchor, lookup);
  const focus = resolvePoint(root, blocks, selectionSnapshot.focus, lookup);
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!anchor || !focus || !selection) {
    return false;
  }

  root.focus({ preventScroll: true });
  selection.removeAllRanges();
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  } else {
    const range = root.ownerDocument.createRange();
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
    selection.addRange(range);
  }
  return true;
}
