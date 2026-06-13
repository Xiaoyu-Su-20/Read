import {
  createEmptyNoteBlock,
  createPageLinkNode,
  createTextNode,
  formatPageLinkText,
  normalizeNoteBlocks,
  normalizeNoteInlineNodes
} from "./notes";
import type {
  NoteBlock,
  NoteBlockType,
  NoteDocument,
  NoteInlineNode,
  NotePageLinkNode,
  NoteTextNode
} from "./types";

const NOTE_CLIPBOARD_MIME = "application/x-calmreader-note-fragment";

type CaretRangeDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (
    x: number,
    y: number
  ) => {
    offsetNode: Node | null;
  } | null;
};

type MarkState = {
  bold: boolean;
  italic: boolean;
};

type NoteClipboardPayload = {
  html: string;
  text: string;
};

let internalClipboardPayload: NoteClipboardPayload | null = null;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
}

function blockTagName(type: NoteBlockType) {
  switch (type) {
    case "heading1":
      return "h1";
    case "heading2":
      return "h2";
    case "heading3":
      return "h3";
    default:
      return "div";
  }
}

function blockTypeFromTagName(tagName: string): NoteBlockType {
  switch (tagName.toLowerCase()) {
    case "h1":
      return "heading1";
    case "h2":
      return "heading2";
    case "h3":
      return "heading3";
    default:
      return "paragraph";
  }
}

function blockTypeFromElement(element: HTMLElement): NoteBlockType {
  return blockTypeFromTagName(element.tagName);
}

function nextUniqueBlockId(existingId: string | undefined, seenIds: Set<string>) {
  if (existingId && !seenIds.has(existingId)) {
    seenIds.add(existingId);
    return existingId;
  }

  const blockId = crypto.randomUUID();
  seenIds.add(blockId);
  return blockId;
}

function renderTextNodeHtml(node: NoteTextNode) {
  const text = escapeHtml(node.text);
  if (node.bold && node.italic) {
    return `<strong><em>${text}</em></strong>`;
  }
  if (node.bold) {
    return `<strong>${text}</strong>`;
  }
  if (node.italic) {
    return `<em>${text}</em>`;
  }
  return text;
}

function renderPageLinkNodeHtml(node: NotePageLinkNode) {
  return `<span class="page-link" data-inline-type="page-link" data-page-link-id="${escapeHtml(
    node.id
  )}" data-document-id="${escapeHtml(node.documentId ?? "")}" data-pdf-page-index="${escapeHtml(
    node.pdfPageIndex == null ? "" : String(node.pdfPageIndex)
  )}" data-book-page-label="${escapeHtml(node.bookPageLabel)}" data-created-at="${escapeHtml(
    node.createdAt
  )}" contenteditable="false" tabindex="0">${escapeHtml(
    node.text
  )}</span>`;
}

export function renderNoteInlineNodesHtml(children: NoteInlineNode[]) {
  return normalizeNoteInlineNodes(children)
    .map((node) => (node.type === "page-link" ? renderPageLinkNodeHtml(node) : renderTextNodeHtml(node)))
    .join("");
}

export function renderNoteBlocksHtml(blocks: NoteBlock[]) {
  return normalizeNoteBlocks(blocks)
    .map((block) => {
      const tagName = blockTagName(block.type);
      return `<${tagName} data-block-id="${escapeHtml(block.id)}" data-block-type="${block.type}">${renderNoteInlineNodesHtml(
        block.children
      )}</${tagName}>`;
    })
    .join("");
}

function pageLinkNodeFromElement(element: HTMLElement): NotePageLinkNode {
  const pdfPageIndexValue = element.dataset.pdfPageIndex;
  const pdfPageIndex =
    typeof pdfPageIndexValue === "string" && pdfPageIndexValue.trim().length > 0
      ? Number.parseInt(pdfPageIndexValue, 10)
      : null;

  return {
    type: "page-link",
    id: element.dataset.pageLinkId || crypto.randomUUID(),
    text: element.textContent ?? "",
    documentId: element.dataset.documentId?.trim() || null,
    pdfPageIndex: Number.isFinite(pdfPageIndex) ? pdfPageIndex : null,
    bookPageLabel: element.dataset.bookPageLabel?.trim() || "",
    createdAt: element.dataset.createdAt || new Date().toISOString()
  };
}

function inlineNodesFromNode(node: Node, activeMarks: MarkState): NoteInlineNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return [
      createTextNode(node.textContent ?? "", {
        ...(activeMarks.bold ? { bold: true } : {}),
        ...(activeMarks.italic ? { italic: true } : {})
      })
    ];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as HTMLElement;
  if (element.dataset.inlineType === "page-link") {
    return [pageLinkNodeFromElement(element)];
  }

  if (element.tagName === "BR") {
    return [
      createTextNode("\n", {
        ...(activeMarks.bold ? { bold: true } : {}),
        ...(activeMarks.italic ? { italic: true } : {})
      })
    ];
  }

  const nextMarks = {
    bold: activeMarks.bold || element.tagName === "B" || element.tagName === "STRONG",
    italic: activeMarks.italic || element.tagName === "I" || element.tagName === "EM"
  };

  return Array.from(element.childNodes).flatMap((childNode) => inlineNodesFromNode(childNode, nextMarks));
}

export function parseNoteBlocksFromEditor(root: HTMLElement): NoteBlock[] {
  const blocks = Array.from(root.childNodes).flatMap((childNode) => {
    if (childNode.nodeType === Node.TEXT_NODE) {
      const text = childNode.textContent ?? "";
      return text.trim().length > 0
        ? [
            {
              ...createEmptyNoteBlock(),
              children: [createTextNode(text)]
            }
          ]
        : [];
    }

    if (childNode.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    const element = childNode as HTMLElement;
    return [
      {
        id: element.dataset.blockId || crypto.randomUUID(),
        type: blockTypeFromTagName(element.tagName),
        children: normalizeNoteInlineNodes(inlineNodesFromNode(element, { bold: false, italic: false }))
      }
    ];
  });

  return normalizeNoteBlocks(blocks);
}

function configurePageLinkElement(element: HTMLElement) {
  element.classList.add("page-link");
  element.dataset.inlineType = "page-link";
  element.contentEditable = "false";
  element.tabIndex = 0;
}

export function normalizeNoteEditorDom(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  const seenBlockIds = new Set<string>();

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text.length === 0) {
        root.removeChild(child);
        continue;
      }

      const block = document.createElement("div");
      block.dataset.blockId = nextUniqueBlockId(undefined, seenBlockIds);
      block.dataset.blockType = "paragraph";
      block.textContent = text;
      root.replaceChild(block, child);
      continue;
    }

    if (!(child instanceof HTMLElement)) {
      continue;
    }

    if (child.tagName === "BR") {
      const block = document.createElement("div");
      block.dataset.blockId = nextUniqueBlockId(undefined, seenBlockIds);
      block.dataset.blockType = "paragraph";
      block.appendChild(document.createElement("br"));
      root.replaceChild(block, child);
      continue;
    }

    child.dataset.blockId = nextUniqueBlockId(child.dataset.blockId, seenBlockIds);
    child.dataset.blockType = blockTypeFromElement(child);

    child.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((pageLink) => {
      configurePageLinkElement(pageLink);
    });
  }
}

export function findBlockElement(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

export function findPageLinkElement(root: HTMLElement, pageLinkId: string) {
  return root.querySelector<HTMLElement>(`[data-page-link-id="${CSS.escape(pageLinkId)}"]`);
}

export function findClosestBlockElement(root: HTMLElement, node: Node | null) {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const block = element?.closest<HTMLElement>("[data-block-id]") ?? null;
  return block && root.contains(block) ? block : null;
}

export function findClosestPageLinkElement(root: HTMLElement, node: Node | null) {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const pageLink = element?.closest<HTMLElement>("[data-inline-type='page-link']") ?? null;
  return pageLink && root.contains(pageLink) ? pageLink : null;
}

function isPointWithinRects(rects: Iterable<DOMRect>, x: number, y: number, padding = 4) {
  for (const rect of rects) {
    if (
      x >= rect.left - padding &&
      x <= rect.right + padding &&
      y >= rect.top - padding &&
      y <= rect.bottom + padding
    ) {
      return true;
    }
  }

  return false;
}

export function isPointWithinBlockContent(root: HTMLElement, block: HTMLElement, x: number, y: number) {
  if (!root.contains(block)) {
    return false;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(block);
  const clientRects = Array.from(range.getClientRects());

  if (clientRects.length === 0) {
    const rect = block.getBoundingClientRect();
    return isPointWithinRects([rect], x, y);
  }

  return isPointWithinRects(clientRects, x, y);
}

export function isPointWithinPageLinkContent(root: HTMLElement, pageLink: HTMLElement, x: number, y: number) {
  if (!root.contains(pageLink)) {
    return false;
  }

  return isPointWithinRects([pageLink.getBoundingClientRect()], x, y, 4);
}

export function getBlockAtPoint(root: HTMLElement, x: number, y: number) {
  const ownerDocument = root.ownerDocument as CaretRangeDocument;
  let node: Node | null = null;

  if (ownerDocument.caretPositionFromPoint) {
    node = ownerDocument.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  } else if (ownerDocument.caretRangeFromPoint) {
    node = ownerDocument.caretRangeFromPoint(x, y)?.startContainer ?? null;
  }

  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? ownerDocument.elementFromPoint(x, y);

  const block = element?.closest<HTMLElement>("[data-block-id]") ?? null;
  return block && root.contains(block) ? block : null;
}

export function getPageLinkAtPoint(root: HTMLElement, x: number, y: number) {
  const ownerDocument = root.ownerDocument as CaretRangeDocument;
  let node: Node | null = null;

  if (ownerDocument.caretPositionFromPoint) {
    node = ownerDocument.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  } else if (ownerDocument.caretRangeFromPoint) {
    node = ownerDocument.caretRangeFromPoint(x, y)?.startContainer ?? null;
  }

  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? ownerDocument.elementFromPoint(x, y);
  const pageLink = element?.closest<HTMLElement>("[data-inline-type='page-link']") ?? null;
  return pageLink && root.contains(pageLink) ? pageLink : null;
}

function getRangeAtPoint(root: HTMLElement, x: number, y: number) {
  const ownerDocument = root.ownerDocument as CaretRangeDocument;

  if (ownerDocument.caretPositionFromPoint) {
    const position = ownerDocument.caretPositionFromPoint(x, y);
    if (position?.offsetNode) {
      const range = ownerDocument.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
  }

  if (ownerDocument.caretRangeFromPoint) {
    const range = ownerDocument.caretRangeFromPoint(x, y);
    if (range) {
      range.collapse(true);
      return range;
    }
  }

  return null;
}

function findBlockFromRange(root: HTMLElement, range: Range) {
  const candidateNodes: Array<Node | null> = [
    range.startContainer,
    range.endContainer,
    range.commonAncestorContainer
  ];

  for (const node of candidateNodes) {
    const block = findClosestBlockElement(root, node);
    if (block) {
      return block;
    }
  }

  return null;
}

export function captureCollapsedRangeAtPoint(root: HTMLElement, x: number, y: number) {
  const rangeAtPoint = getRangeAtPoint(root, x, y);
  if (rangeAtPoint) {
    const block = findBlockFromRange(root, rangeAtPoint);
    if (!block || !root.contains(block)) {
      return null;
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(rangeAtPoint);
    }

    return rangeAtPoint.cloneRange();
  }

  const blockAtPoint = getBlockAtPoint(root, x, y);
  if (!blockAtPoint || !root.contains(blockAtPoint)) {
    return null;
  }

  const fallbackRange = root.ownerDocument.createRange();
  fallbackRange.selectNodeContents(blockAtPoint);
  fallbackRange.collapse(false);

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
  }

  return fallbackRange.cloneRange();
}

export function captureBlockEndRange(root: HTMLElement, block: HTMLElement) {
  if (!root.contains(block)) {
    return null;
  }

  const range = root.ownerDocument.createRange();
  range.selectNodeContents(block);
  range.collapse(false);

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return range.cloneRange();
}

function getSelectionInRoot(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor =
    range.commonAncestorContainer instanceof HTMLElement
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!commonAncestor || !root.contains(commonAncestor)) {
    return null;
  }

  return selection;
}

export function getSelectedText(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  return selection ? selection.toString() : "";
}

export function getBlockFromSelection(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  if (!selection) {
    return null;
  }

  const candidateNodes: Array<Node | null> = [selection.anchorNode, selection.focusNode];

  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    candidateNodes.push(range.startContainer, range.endContainer, range.commonAncestorContainer);
  }

  for (const node of candidateNodes) {
    const block = findClosestBlockElement(root, node);
    if (block) {
      return block;
    }
  }

  return null;
}

export function getPageLinkFromSelection(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  if (!selection) {
    return null;
  }

  const candidateNodes: Array<Node | null> = [selection.anchorNode, selection.focusNode];

  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    candidateNodes.push(range.startContainer, range.endContainer, range.commonAncestorContainer);
  }

  for (const node of candidateNodes) {
    const pageLink = findClosestPageLinkElement(root, node);
    if (pageLink) {
      return pageLink;
    }
  }

  return null;
}

export function isSelectionWithinSingleBlock(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const startBlock = findClosestBlockElement(root, range.startContainer);
  const endBlock = findClosestBlockElement(root, range.endContainer);
  return Boolean(startBlock && endBlock && startBlock.dataset.blockId === endBlock.dataset.blockId);
}

export function isPointWithinSelectionContent(root: HTMLElement, x: number, y: number) {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects());
  if (clientRects.length > 0) {
    return isPointWithinRects(clientRects, x, y, 6);
  }

  const collapsedRect = range.getBoundingClientRect();
  if (collapsedRect.width > 0 || collapsedRect.height > 0) {
    return isPointWithinRects([collapsedRect], x, y, 6);
  }

  const selectionBlock = getBlockFromSelection(root);
  if (!selectionBlock) {
    return false;
  }

  return isPointWithinBlockContent(root, selectionBlock, x, y);
}

export function replaceBlockElementType(root: HTMLElement, blockId: string, nextType: NoteBlockType) {
  normalizeNoteEditorDom(root);
  const current = findBlockElement(root, blockId);
  if (!current) {
    return false;
  }

  const replacement = document.createElement(blockTagName(nextType));
  replacement.dataset.blockId = blockId;
  replacement.dataset.blockType = nextType;
  replacement.innerHTML = current.innerHTML;
  current.replaceWith(replacement);
  return true;
}

function createPageLinkElement(node: NotePageLinkNode) {
  const element = document.createElement("span");
  element.textContent = node.text;
  element.dataset.pageLinkId = node.id;
  element.dataset.documentId = node.documentId ?? "";
  element.dataset.pdfPageIndex = node.pdfPageIndex == null ? "" : String(node.pdfPageIndex);
  element.dataset.bookPageLabel = node.bookPageLabel;
  element.dataset.createdAt = node.createdAt;
  configurePageLinkElement(element);
  return element;
}

function placeCaretAfterNode(node: Node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretBeforeNode(node: Node) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStartBefore(node);
  range.setEndBefore(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function focusElementWithoutScroll(element: HTMLElement) {
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function shouldInsertLeadingSpace(root: HTMLElement, insertionRange: Range) {
  const block = findBlockFromRange(root, insertionRange);
  if (!block) {
    return false;
  }

  const prefixRange = root.ownerDocument.createRange();
  prefixRange.selectNodeContents(block);
  prefixRange.setEnd(insertionRange.endContainer, insertionRange.endOffset);

  const prefixText = prefixRange.toString();
  if (prefixText.length === 0) {
    return false;
  }

  return !/\s$/.test(prefixText);
}

export function insertPageLinkAtRange(
  root: HTMLElement,
  insertionRange: Range,
  note: NoteDocument,
  pageNumber: number,
  currentPdfPageIndex: number | null
) {
  if (!root.contains(insertionRange.commonAncestorContainer)) {
    return {
      ok: false as const,
      message: "Click inside a paragraph before adding a PageLink."
    };
  }

  const block = findBlockFromRange(root, insertionRange);
  if (!block || block.dataset.blockType !== "paragraph") {
    return {
      ok: false as const,
      message: "PageLinks can only be inserted into paragraphs."
    };
  }

  const node = createPageLinkNode({
    text: formatPageLinkText(pageNumber),
    bookPageLabel: String(pageNumber),
    documentId: note.bookId,
    pdfPageIndex: currentPdfPageIndex
  });
  const element = createPageLinkElement(node);

  focusElementWithoutScroll(root);
  const nextRange = insertionRange.cloneRange();
  nextRange.collapse(true);
  const fragment = root.ownerDocument.createDocumentFragment();
  if (shouldInsertLeadingSpace(root, nextRange)) {
    fragment.appendChild(root.ownerDocument.createTextNode(" "));
  }
  fragment.appendChild(element);
  nextRange.insertNode(fragment);
  placeCaretAfterNode(element);

  return {
    ok: true as const,
    node
  };
}

export function updatePageLinkTarget(root: HTMLElement, pageLinkId: string, pageNumber: number) {
  const pageLink = findPageLinkElement(root, pageLinkId);
  if (!pageLink) {
    return {
      ok: false as const,
      message: "Unable to update PageLink."
    };
  }

  const pdfPageIndex =
    pageLink.dataset.pdfPageIndex && pageLink.dataset.pdfPageIndex.length > 0
      ? Number.parseInt(pageLink.dataset.pdfPageIndex, 10)
      : null;
  const nextNode = createPageLinkNode({
    text: formatPageLinkText(pageNumber),
    bookPageLabel: String(pageNumber),
    documentId: pageLink.dataset.documentId?.trim() || null,
    pdfPageIndex
  });
  nextNode.id = pageLinkId;
  nextNode.createdAt = pageLink.dataset.createdAt || nextNode.createdAt;
  const replacement = createPageLinkElement(nextNode);
  focusElementWithoutScroll(root);
  pageLink.replaceWith(replacement);
  placeCaretAfterNode(replacement);

  return {
    ok: true as const,
    node: nextNode
  };
}

export function removePageLink(root: HTMLElement, pageLinkId: string) {
  const pageLink = findPageLinkElement(root, pageLinkId);
  if (!pageLink) {
    return false;
  }

  const nextSibling = pageLink.nextSibling;
  const parent = pageLink.parentNode;
  pageLink.remove();

  if (nextSibling) {
    placeCaretBeforeNode(nextSibling);
  } else if (parent) {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(parent);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return true;
}

export function selectPageLinkToken(root: HTMLElement, pageLinkId: string | null) {
  root.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((element) => {
    if (!pageLinkId || element.dataset.pageLinkId !== pageLinkId) {
      delete element.dataset.selected;
      return;
    }

    element.dataset.selected = "true";
  });
}

export function clearSelectedPageLink(root: HTMLElement) {
  selectPageLinkToken(root, null);
}

export function textFromEditable(root: HTMLElement) {
  return root.textContent ?? "";
}

export function copyPageLinkReference(root: HTMLElement, pageLinkId: string) {
  const pageLink = findPageLinkElement(root, pageLinkId);
  if (!pageLink) {
    return;
  }

  const text = pageLink.textContent ?? "";
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return;
  }

  insertTextAtSelection(text);
}

function serializeCurrentSelection(root: HTMLElement): NoteClipboardPayload | null {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) {
    const selectedPageLink = getPageLinkFromSelection(root);
    if (!selectedPageLink) {
      return null;
    }
    return {
      html: selectedPageLink.outerHTML,
      text: selectedPageLink.textContent ?? ""
    };
  }

  const range = selection.getRangeAt(0);
  const wrapper = document.createElement("div");
  wrapper.appendChild(range.cloneContents());
  return {
    html: wrapper.innerHTML,
    text: selection.toString()
  };
}

function rememberInternalClipboard(root: HTMLElement) {
  const payload = serializeCurrentSelection(root);
  if (payload) {
    internalClipboardPayload = payload;
  }
  return payload;
}

export function handleCopy(root: HTMLElement, event: ClipboardEvent) {
  const payload = rememberInternalClipboard(root);
  if (!payload || !event.clipboardData) {
    return;
  }

  event.preventDefault();
  event.clipboardData.setData("text/plain", payload.text);
  event.clipboardData.setData("text/html", payload.html);
  event.clipboardData.setData(NOTE_CLIPBOARD_MIME, payload.html);
}

export function handleCut(root: HTMLElement, event: ClipboardEvent) {
  const payload = rememberInternalClipboard(root);
  if (!payload || !event.clipboardData) {
    return;
  }

  event.preventDefault();
  event.clipboardData.setData("text/plain", payload.text);
  event.clipboardData.setData("text/html", payload.html);
  event.clipboardData.setData(NOTE_CLIPBOARD_MIME, payload.html);
  document.execCommand("delete");
}

export function copySelection(root: HTMLElement) {
  rememberInternalClipboard(root);
  document.execCommand("copy");
}

export function cutSelection(root: HTMLElement) {
  rememberInternalClipboard(root);
  const succeeded = document.execCommand("cut");
  if (!succeeded) {
    document.execCommand("delete");
  }
}

function insertHtmlAtSelection(html: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    placeCaretAfterNode(lastNode);
  }
}

export async function pasteSelection(root: HTMLElement) {
  const succeeded = document.execCommand("paste");
  if (succeeded) {
    return;
  }

  if (internalClipboardPayload && navigator.clipboard?.readText) {
    const currentClipboardText = await navigator.clipboard.readText();
    if (currentClipboardText === internalClipboardPayload.text) {
      insertHtmlAtSelection(internalClipboardPayload.html);
      normalizeNoteEditorDom(root);
      return;
    }
  }

  if (!navigator.clipboard?.readText) {
    return;
  }

  const text = await navigator.clipboard.readText();
  insertTextAtSelection(text);
}

export function handlePaste(root: HTMLElement, event: ClipboardEvent) {
  const customHtml = event.clipboardData?.getData(NOTE_CLIPBOARD_MIME);
  if (customHtml) {
    event.preventDefault();
    insertHtmlAtSelection(customHtml);
    normalizeNoteEditorDom(root);
    return;
  }

  const html = event.clipboardData?.getData("text/html");
  if (html && html.includes("data-inline-type=\"page-link\"")) {
    event.preventDefault();
    insertHtmlAtSelection(html);
    normalizeNoteEditorDom(root);
  }
}

export function insertTextAtSelection(text: string) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
}

function deepestVisibleNode(node: Node, direction: "first" | "last"): Node {
  let current = node;

  while (current.childNodes.length > 0 && !(current instanceof HTMLElement && current.dataset.inlineType === "page-link")) {
    current =
      direction === "first"
        ? current.childNodes[0]
        : current.childNodes[current.childNodes.length - 1];
  }

  return current;
}

function previousNodeInRoot(root: HTMLElement, node: Node): Node | null {
  if (node.previousSibling) {
    return deepestVisibleNode(node.previousSibling, "last");
  }

  let current: Node | null = node;
  while (current && current !== root) {
    if (current.parentNode?.previousSibling) {
      return deepestVisibleNode(current.parentNode.previousSibling, "last");
    }
    current = current.parentNode;
  }

  return null;
}

function nextNodeInRoot(root: HTMLElement, node: Node): Node | null {
  if (node.nextSibling) {
    return deepestVisibleNode(node.nextSibling, "first");
  }

  let current: Node | null = node;
  while (current && current !== root) {
    if (current.parentNode?.nextSibling) {
      return deepestVisibleNode(current.parentNode.nextSibling, "first");
    }
    current = current.parentNode;
  }

  return null;
}

export function getAdjacentPageLink(root: HTMLElement, direction: "backward" | "forward") {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  const offset = range.startOffset;

  let adjacentNode: Node | null = null;

  if (container.nodeType === Node.TEXT_NODE) {
    const textLength = container.textContent?.length ?? 0;
    if (direction === "backward") {
      if (offset > 0) {
        return null;
      }
      adjacentNode = previousNodeInRoot(root, container);
    } else {
      if (offset < textLength) {
        return null;
      }
      adjacentNode = nextNodeInRoot(root, container);
    }
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    const element = container as Element;
    if (direction === "backward") {
      adjacentNode =
        offset > 0
          ? deepestVisibleNode(element.childNodes[offset - 1], "last")
          : previousNodeInRoot(root, element);
    } else {
      adjacentNode =
        offset < element.childNodes.length
          ? deepestVisibleNode(element.childNodes[offset], "first")
          : nextNodeInRoot(root, element);
    }
  }

  return adjacentNode ? findClosestPageLinkElement(root, adjacentNode) : null;
}

export function moveCaretAroundPageLink(root: HTMLElement, pageLinkId: string, direction: "before" | "after") {
  const pageLink = findPageLinkElement(root, pageLinkId);
  if (!pageLink) {
    return false;
  }

  if (direction === "before") {
    placeCaretBeforeNode(pageLink);
  } else {
    placeCaretAfterNode(pageLink);
  }
  return true;
}
