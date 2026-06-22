import {
  createEmptyNoteBlock,
  createSectionBreakBlock,
  createPageLinkNode,
  createTextNode,
  formatPageLinkText,
  isSectionBreakBlockType,
  normalizeDocumentSourceReference,
  normalizeNoteBlocks,
  normalizeNoteInlineNodes,
  parsePageLinkText
} from "./notes";
import {
  DEFAULT_TOPIC_COLOR,
  MAX_TOPIC_LENGTH,
  normalizeParagraphTopic,
  normalizeParagraphTopics,
  normalizeTopicText,
  resolveTopicAppearance
} from "./paragraphTopics";
import type {
  DocumentSourceReference,
  InteractiveColorKey,
  NoteBlock,
  NoteBlockType,
  NoteDocument,
  NoteEditorSelectionPoint,
  NoteEditorSelectionSnapshot,
  NoteInlineNode,
  NotePageLinkNode,
  ParagraphTopic,
  NoteTextNode
} from "./types";

const NOTE_CLIPBOARD_MIME = "application/x-calmreader-note-fragment";
const PAGE_LINK_CARET_ANCHOR = "\u200B";
const SECTION_BREAK_TEXT = "---";
const TOPIC_INLINE_TYPE = "topic-card";
const PAGE_LINK_INLINE_TYPE = "page-link";

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
  internalHtml: string;
  text: string;
};

let internalClipboardPayload: NoteClipboardPayload | null = null;

function stripPageLinkCaretAnchors(value: string) {
  return value.replaceAll(PAGE_LINK_CARET_ANCHOR, "");
}

function isPageLinkCaretAnchorValue(value: string) {
  return value.length > 0 && stripPageLinkCaretAnchors(value).length === 0;
}

function isPageLinkCaretAnchorNode(node: Node | null): node is Text {
  return node?.nodeType === Node.TEXT_NODE && isPageLinkCaretAnchorValue(node.textContent ?? "");
}

function createPageLinkCaretAnchor(ownerDocument: Document) {
  return ownerDocument.createTextNode(PAGE_LINK_CARET_ANCHOR);
}

function normalizePageLinkCaretAnchorNode(node: Text) {
  node.textContent = PAGE_LINK_CARET_ANCHOR;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
}

function encodeDataJson(value: unknown) {
  return encodeURIComponent(JSON.stringify(value));
}

function decodeSourceReference(value: string | undefined, fallbackDocumentId?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return normalizeDocumentSourceReference(
      JSON.parse(decodeURIComponent(value)) as DocumentSourceReference,
      fallbackDocumentId
    );
  } catch {
    return null;
  }
}

function sourceReferencesEqual(
  left: DocumentSourceReference | null | undefined,
  right: DocumentSourceReference | null | undefined
) {
  if (!left || !right) {
    return false;
  }

  return (
    left.documentId === right.documentId &&
    left.kind === right.kind &&
    left.outlineItemId === right.outlineItemId &&
    left.outlineSource === right.outlineSource &&
    left.title === right.title &&
    JSON.stringify(left.target ?? null) === JSON.stringify(right.target ?? null)
  );
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
  const datasetType = element.dataset.blockType as NoteBlockType | undefined;
  if (datasetType && isSectionBreakBlockType(datasetType)) {
    return datasetType;
  }

  return blockTypeFromTagName(element.tagName);
}

function configureSectionBreakElement(element: HTMLElement, type: Extract<NoteBlockType, "sectionBreak">) {
  element.className = "note-section-break note-section-break--short";
  element.dataset.blockType = type;
  element.contentEditable = "false";
  element.setAttribute("role", "separator");
  element.setAttribute("aria-orientation", "horizontal");
  element.replaceChildren();
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
  const parsedText = parsePageLinkText(node.text);
  const visibleLabel = parsedText?.bookPageLabel ?? node.bookPageLabel ?? node.text;
  return `<span class="page-link" data-inline-type="page-link" data-page-link-id="${escapeHtml(
    node.id
  )}" data-document-id="${escapeHtml(node.documentId ?? "")}" data-pdf-page-index="${escapeHtml(
    node.pdfPageIndex == null ? "" : String(node.pdfPageIndex)
  )}" data-book-page-label="${escapeHtml(node.bookPageLabel)}" data-created-at="${escapeHtml(
    node.createdAt
  )}" contenteditable="false" tabindex="-1"><span class="page-link__icon" aria-hidden="true"><svg viewBox="5 3 14 18" focusable="false"><path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" /></svg></span><span class="page-link__paren" aria-hidden="true">(</span><span class="page-link__label">${escapeHtml(
    visibleLabel
  )}</span><span class="page-link__paren" aria-hidden="true">)</span></span>`;
}

function renderTopicCardHtml(topic: ParagraphTopic) {
  const appearance = resolveTopicAppearance(topic.color);
  const styleAttribute = Object.entries(appearance)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  return `<span class="paragraph-topic" data-inline-type="${TOPIC_INLINE_TYPE}" data-topic-id="${escapeHtml(
    topic.id
  )}" data-topic-text="${escapeHtml(topic.text)}" data-topic-color="${escapeHtml(
    topic.color
  )}" style="${escapeHtml(styleAttribute)}" contenteditable="false" tabindex="-1"><span class="paragraph-topic__bracket" aria-hidden="true">[</span><span class="paragraph-topic__label">${escapeHtml(
    topic.text
  )}</span><span class="paragraph-topic__bracket" aria-hidden="true">]</span><span class="paragraph-topic__separator" aria-hidden="true"> </span></span>`;
}

function renderTopicCardsHtml(topics: ParagraphTopic[]) {
  return normalizeParagraphTopics(topics)
    .map((topic) => renderTopicCardHtml(topic))
    .join("");
}

export function renderNoteInlineNodesHtml(children: NoteInlineNode[]) {
  return normalizeNoteInlineNodes(children)
    .map((node) => (node.type === "page-link" ? renderPageLinkNodeHtml(node) : renderTextNodeHtml(node)))
    .join("");
}

export function renderNoteBlocksHtml(blocks: NoteBlock[]) {
  return normalizeNoteBlocks(blocks)
    .map((block) => {
      if (isSectionBreakBlockType(block.type)) {
        return `<div data-block-id="${escapeHtml(block.id)}" data-block-type="${block.type}" class="note-section-break note-section-break--short" contenteditable="false" role="separator" aria-orientation="horizontal"></div>`;
      }

      const tagName = blockTagName(block.type);
      const sourceReference = block.sourceReference
        ? ` data-source-reference="${escapeHtml(encodeDataJson(block.sourceReference))}"`
        : "";
      const topicMarkup = block.type === "paragraph" ? renderTopicCardsHtml(block.topics ?? []) : "";
      const contentMarkup = `${topicMarkup}${renderNoteInlineNodesHtml(block.children)}`;
      return `<${tagName} data-block-id="${escapeHtml(block.id)}" data-block-type="${block.type}"${sourceReference}>${contentMarkup}</${tagName}>`;
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

function topicFromElement(element: HTMLElement): ParagraphTopic | null {
  return normalizeParagraphTopic({
    id: element.dataset.topicId || crypto.randomUUID(),
    text: element.dataset.topicText ?? element.textContent ?? "",
    color: (element.dataset.topicColor as InteractiveColorKey | undefined) ?? DEFAULT_TOPIC_COLOR
  });
}

function inlineNodesFromNode(node: Node, activeMarks: MarkState): NoteInlineNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = stripPageLinkCaretAnchors(node.textContent ?? "");
    if (text.length === 0) {
      return [];
    }

    return [
      createTextNode(text, {
        ...(activeMarks.bold ? { bold: true } : {}),
        ...(activeMarks.italic ? { italic: true } : {})
      })
    ];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const element = node as HTMLElement;
  if (element.dataset.headingReferenceIndicator === "true") {
    return [];
  }

  if (element.dataset.inlineType === TOPIC_INLINE_TYPE) {
    return [];
  }

  if (element.dataset.inlineType === PAGE_LINK_INLINE_TYPE) {
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
  const blocks: NoteBlock[] = Array.from(root.childNodes).flatMap<NoteBlock>((childNode) => {
    if (childNode.nodeType === Node.TEXT_NODE) {
      const text = stripPageLinkCaretAnchors(childNode.textContent ?? "");
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
    const type = blockTypeFromElement(element);
    const topics =
      type === "paragraph"
        ? normalizeParagraphTopics(
            Array.from(element.children)
              .filter(
                (child): child is HTMLElement =>
                  child instanceof HTMLElement && child.dataset.inlineType === TOPIC_INLINE_TYPE
              )
              .map((child) => topicFromElement(child))
              .filter((topic): topic is ParagraphTopic => topic != null)
          )
        : [];
    return [
      {
        id: element.dataset.blockId || crypto.randomUUID(),
        type,
        topics,
        children: isSectionBreakBlockType(type)
          ? []
          : normalizeNoteInlineNodes(inlineNodesFromNode(element, { bold: false, italic: false })),
        sourceReference:
          type === "paragraph" || isSectionBreakBlockType(type)
            ? null
            : decodeSourceReference(element.dataset.sourceReference)
      }
    ];
  });

  return normalizeNoteBlocks(blocks);
}

function configurePageLinkElement(element: HTMLElement) {
  element.classList.add("page-link");
  element.dataset.inlineType = PAGE_LINK_INLINE_TYPE;
  element.contentEditable = "false";
  element.tabIndex = -1;
}

function createTopicCardElement(topic: ParagraphTopic) {
  const element = document.createElement("span");
  updateTopicCardElement(element, topic);
  return element;
}

function updateTopicCardElement(element: HTMLElement, topic: ParagraphTopic) {
  const appearance = resolveTopicAppearance(topic.color);
  element.className = "paragraph-topic";
  element.dataset.inlineType = TOPIC_INLINE_TYPE;
  element.dataset.topicId = topic.id;
  element.dataset.topicText = topic.text;
  element.dataset.topicColor = topic.color;
  element.contentEditable = "false";
  element.tabIndex = -1;
  Object.entries(appearance).forEach(([key, value]) => {
    element.style.setProperty(key, value);
  });

  const leadingBracket = document.createElement("span");
  leadingBracket.className = "paragraph-topic__bracket";
  leadingBracket.setAttribute("aria-hidden", "true");
  leadingBracket.textContent = "[";

  const label = document.createElement("span");
  label.className = "paragraph-topic__label";
  label.textContent = topic.text;

  const trailingBracket = document.createElement("span");
  trailingBracket.className = "paragraph-topic__bracket";
  trailingBracket.setAttribute("aria-hidden", "true");
  trailingBracket.textContent = "]";

  const separator = document.createElement("span");
  separator.className = "paragraph-topic__separator";
  separator.setAttribute("aria-hidden", "true");
  separator.textContent = " ";

  element.replaceChildren(leadingBracket, label, trailingBracket, separator);
}

function configureTopicElement(element: HTMLElement) {
  const topic = topicFromElement(element);
  if (!topic) {
    element.remove();
    return null;
  }

  updateTopicCardElement(element, topic);
  return element;
}

function isPageLinkElementNode(node: Node | null): node is HTMLElement {
  return (
    node instanceof HTMLElement &&
    node.dataset.inlineType === PAGE_LINK_INLINE_TYPE
  );
}

function isTopicElementNode(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.inlineType === TOPIC_INLINE_TYPE;
}

function removeAdjacentAnchorDuplicates(anchorNode: Text, direction: "backward" | "forward") {
  let sibling =
    direction === "backward" ? anchorNode.previousSibling : anchorNode.nextSibling;

  while (isPageLinkCaretAnchorNode(sibling)) {
    const nextSibling =
      direction === "backward" ? sibling.previousSibling : sibling.nextSibling;
    sibling.remove();
    sibling = nextSibling;
  }
}

function ensurePageLinkCaretAnchors(pageLink: HTMLElement) {
  const ownerDocument = pageLink.ownerDocument;
  const previousSibling = pageLink.previousSibling;
  const nextSibling = pageLink.nextSibling;

  let leadingAnchor: Text;
  if (isPageLinkCaretAnchorNode(previousSibling)) {
    leadingAnchor = previousSibling;
    normalizePageLinkCaretAnchorNode(leadingAnchor);
  } else {
    leadingAnchor = createPageLinkCaretAnchor(ownerDocument);
    pageLink.before(leadingAnchor);
  }

  let trailingAnchor: Text;
  if (isPageLinkCaretAnchorNode(nextSibling)) {
    trailingAnchor = nextSibling;
    normalizePageLinkCaretAnchorNode(trailingAnchor);
  } else {
    trailingAnchor = createPageLinkCaretAnchor(ownerDocument);
    pageLink.after(trailingAnchor);
  }

  removeAdjacentAnchorDuplicates(leadingAnchor, "backward");
  removeAdjacentAnchorDuplicates(trailingAnchor, "forward");
}

function removeOrphanPageLinkCaretAnchors(root: HTMLElement) {
  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const anchorsToRemove: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!isPageLinkCaretAnchorNode(node)) {
      continue;
    }

    const hasAdjacentPageLink =
      isPageLinkElementNode(node.previousSibling) || isPageLinkElementNode(node.nextSibling);

    if (!hasAdjacentPageLink) {
      anchorsToRemove.push(node);
    }
  }

  for (const anchor of anchorsToRemove) {
    anchor.remove();
  }
}

function collectBlockTopicElements(block: HTMLElement) {
  return Array.from(block.querySelectorAll<HTMLElement>(`[data-inline-type='${TOPIC_INLINE_TYPE}']`)).filter(
    (element) => findClosestBlockElement(block, element) === block
  );
}

function normalizeTopicElementsInBlock(block: HTMLElement, blockType: NoteBlockType) {
  const topicElements = collectBlockTopicElements(block);
  if (topicElements.length === 0) {
    return;
  }

  if (blockType !== "paragraph") {
    for (const topicElement of topicElements) {
      topicElement.remove();
    }
    return;
  }

  let insertionPoint = block.firstChild;
  for (const topicElement of topicElements) {
    const configured = configureTopicElement(topicElement);
    if (!configured) {
      continue;
    }

    if (configured !== insertionPoint) {
      block.insertBefore(configured, insertionPoint);
    }
    insertionPoint = configured.nextSibling;
  }
}

export function normalizeNoteEditorDom(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  const seenBlockIds = new Set<string>();
  let previousBlockType: NoteBlockType | null = null;
  let previousSourceReference: DocumentSourceReference | null = null;

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = stripPageLinkCaretAnchors(child.textContent ?? "");
      if (text.length === 0) {
        root.removeChild(child);
        continue;
      }

      const block = document.createElement("div");
      block.dataset.blockId = nextUniqueBlockId(undefined, seenBlockIds);
      block.dataset.blockType = "paragraph";
      block.textContent = text;
      root.replaceChild(block, child);
      previousBlockType = "paragraph";
      previousSourceReference = null;
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
      previousBlockType = "paragraph";
      previousSourceReference = null;
      continue;
    }

    child.dataset.blockId = nextUniqueBlockId(child.dataset.blockId, seenBlockIds);
    const blockType = blockTypeFromElement(child);
    child.dataset.blockType = blockType;

    if (isSectionBreakBlockType(blockType)) {
      configureSectionBreakElement(
        child,
        blockType as Extract<NoteBlockType, "sectionBreak">
      );
      previousBlockType = blockType;
      previousSourceReference = null;
      continue;
    }

    if (blockType === "paragraph") {
      delete child.dataset.sourceReference;
      normalizeTopicElementsInBlock(child, blockType);
      previousBlockType = blockType;
      previousSourceReference = null;
    } else {
      normalizeTopicElementsInBlock(child, blockType);
      const hasVisibleText = (child.textContent ?? "").trim().length > 0;
      if (!hasVisibleText) {
        delete child.dataset.sourceReference;
        previousBlockType = blockType;
        previousSourceReference = null;
        child.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((pageLink) => {
          configurePageLinkElement(pageLink);
          ensurePageLinkCaretAnchors(pageLink);
        });
        removeOrphanPageLinkCaretAnchors(child);
        continue;
      }

      const sourceReference = decodeSourceReference(child.dataset.sourceReference);
      if (
        sourceReference &&
        previousBlockType === blockType &&
        sourceReferencesEqual(previousSourceReference, sourceReference)
      ) {
        delete child.dataset.sourceReference;
        previousSourceReference = null;
      } else {
        previousSourceReference = sourceReference;
      }
      previousBlockType = blockType;
    }

    child.querySelectorAll<HTMLElement>("[data-inline-type='page-link']").forEach((pageLink) => {
      configurePageLinkElement(pageLink);
      ensurePageLinkCaretAnchors(pageLink);
    });

    removeOrphanPageLinkCaretAnchors(child);
  }
}

export function findBlockElement(root: HTMLElement, blockId: string) {
  return root.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
}

export function findPageLinkElement(root: HTMLElement, pageLinkId: string) {
  return root.querySelector<HTMLElement>(`[data-page-link-id="${CSS.escape(pageLinkId)}"]`);
}

export function findTopicCardElement(root: HTMLElement, topicId: string) {
  return root.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(topicId)}"]`);
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

export function findClosestTopicCardElement(root: HTMLElement, node: Node | null) {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const topic = element?.closest<HTMLElement>(`[data-inline-type='${TOPIC_INLINE_TYPE}']`) ?? null;
  return topic && root.contains(topic) ? topic : null;
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

export function isPointWithinTopicCardContent(root: HTMLElement, topicCard: HTMLElement, x: number, y: number) {
  if (!root.contains(topicCard)) {
    return false;
  }

  return isPointWithinRects([topicCard.getBoundingClientRect()], x, y, 4);
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

export function getTopicCardAtPoint(root: HTMLElement, x: number, y: number) {
  const ownerDocument = root.ownerDocument as CaretRangeDocument;
  let node: Node | null = null;

  if (ownerDocument.caretPositionFromPoint) {
    node = ownerDocument.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  } else if (ownerDocument.caretRangeFromPoint) {
    node = ownerDocument.caretRangeFromPoint(x, y)?.startContainer ?? null;
  }

  const element =
    node instanceof HTMLElement ? node : node?.parentElement ?? ownerDocument.elementFromPoint(x, y);
  const topicCard = element?.closest<HTMLElement>(`[data-inline-type='${TOPIC_INLINE_TYPE}']`) ?? null;
  return topicCard && root.contains(topicCard) ? topicCard : null;
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

function serializeSelectionNodePath(root: HTMLElement, node: Node | null): number[] | null {
  if (!node) {
    return null;
  }

  const path: number[] = [];
  let current: Node | null = node;

  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent || !root.contains(parent)) {
      return null;
    }

    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) {
      return null;
    }
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

function resolveSelectionNodePath(root: HTMLElement, path: number[]) {
  let current: Node = root;

  for (const index of path) {
    const nextNode = current.childNodes[index];
    if (!nextNode) {
      return null;
    }
    current = nextNode;
  }

  return current;
}

function clampSelectionOffset(node: Node, offset: number) {
  if (node.nodeType === Node.TEXT_NODE) {
    return Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
  }

  return Math.max(0, Math.min(offset, node.childNodes.length));
}

function pointSnapshotFromNode(
  root: HTMLElement,
  node: Node | null,
  offset: number
): NoteEditorSelectionPoint | null {
  if (!node) {
    return null;
  }

  const path = serializeSelectionNodePath(root, node);
  if (!path) {
    return null;
  }

  return {
    path,
    offset: clampSelectionOffset(node, offset)
  };
}

export function captureEditorSelection(root: HTMLElement): NoteEditorSelectionSnapshot | null {
  const selection = getSelectionInRoot(root);
  if (!selection) {
    return null;
  }

  const anchor = pointSnapshotFromNode(root, selection.anchorNode, selection.anchorOffset);
  const focus = pointSnapshotFromNode(root, selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) {
    return null;
  }

  return {
    anchor,
    focus,
    isCollapsed: selection.isCollapsed
  };
}

export function restoreEditorSelection(root: HTMLElement, snapshot: NoteEditorSelectionSnapshot | null) {
  if (!snapshot) {
    return false;
  }

  const anchorNode = resolveSelectionNodePath(root, snapshot.anchor.path);
  const focusNode = resolveSelectionNodePath(root, snapshot.focus.path);
  if (!anchorNode || !focusNode) {
    return false;
  }

  const anchorOffset = clampSelectionOffset(anchorNode, snapshot.anchor.offset);
  const focusOffset = clampSelectionOffset(focusNode, snapshot.focus.offset);
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    return true;
  }

  const range = document.createRange();
  range.setStart(anchorNode, anchorOffset);
  range.setEnd(focusNode, focusOffset);
  selection.addRange(range);
  return true;
}

export function getSelectedText(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  return selection ? stripPageLinkCaretAnchors(selection.toString()) : "";
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

function isCollapsedSelectionAtBoundary(
  root: HTMLElement,
  direction: "start" | "end"
) {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  const block = getBlockFromSelection(root);
  if (!block) {
    return false;
  }

  const blockRange = root.ownerDocument.createRange();
  blockRange.selectNodeContents(block);
  blockRange.collapse(direction === "start");

  const selectionRange = selection.getRangeAt(0).cloneRange();
  return direction === "start"
    ? selectionRange.compareBoundaryPoints(Range.START_TO_START, blockRange) === 0
    : selectionRange.compareBoundaryPoints(Range.END_TO_END, blockRange) === 0;
}

function getSectionBreakAtCaretBoundary(
  root: HTMLElement,
  direction: "backward" | "forward"
) {
  const block = getBlockFromSelection(root);
  if (!block) {
    return null;
  }

  const atBoundary =
    direction === "backward"
      ? isCollapsedSelectionAtBoundary(root, "start")
      : isCollapsedSelectionAtBoundary(root, "end");
  if (!atBoundary) {
    return null;
  }

  const adjacent =
    direction === "backward"
      ? block.previousElementSibling
      : block.nextElementSibling;
  if (!(adjacent instanceof HTMLElement)) {
    return null;
  }

  const blockType = blockTypeFromElement(adjacent);
  return isSectionBreakBlockType(blockType) ? adjacent : null;
}

export function getSectionBreakBeforeCaret(root: HTMLElement) {
  return getSectionBreakAtCaretBoundary(root, "backward");
}

export function getSectionBreakAfterCaret(root: HTMLElement) {
  return getSectionBreakAtCaretBoundary(root, "forward");
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

export function isSelectionInsidePageLinkAnchor(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  return isPageLinkCaretAnchorNode(selection.anchorNode);
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
  if (isSectionBreakBlockType(nextType)) {
    configureSectionBreakElement(
      replacement,
      nextType as Extract<NoteBlockType, "sectionBreak">
    );
  } else {
    replacement.innerHTML = current.innerHTML;
  }
  current.replaceWith(replacement);
  return true;
}

function createParagraphBlockElement(blockId: string) {
  const element = document.createElement("div");
  element.dataset.blockId = blockId;
  element.dataset.blockType = "paragraph";
  element.appendChild(document.createElement("br"));
  return element;
}

export function insertSectionBreak(
  root: HTMLElement,
  args: {
    referenceBlockId: string;
    position: "before" | "after";
  }
) {
  normalizeNoteEditorDom(root);
  const referenceBlock = findBlockElement(root, args.referenceBlockId);
  if (!referenceBlock) {
    return null;
  }

  const referenceType = blockTypeFromElement(referenceBlock);
  const referenceText = referenceBlock.textContent?.trim() ?? "";
  if (referenceType === "paragraph" && referenceText.length === 0) {
    const replaced = replaceBlockElementType(root, args.referenceBlockId, "sectionBreak");
    if (!replaced) {
      return null;
    }

    focusElementWithoutScroll(root);
    return {
      sectionBreakId: args.referenceBlockId
    };
  }

  const adjacentSibling =
    args.position === "after"
      ? referenceBlock.nextElementSibling
      : referenceBlock.previousElementSibling;
  if (adjacentSibling instanceof HTMLElement) {
    const adjacentType = blockTypeFromElement(adjacentSibling);
    if (isSectionBreakBlockType(adjacentType)) {
      return null;
    }
  }

  const breakBlock = createSectionBreakBlock();
  const breakElement = document.createElement("div");
  breakElement.dataset.blockId = breakBlock.id;
  configureSectionBreakElement(breakElement, "sectionBreak");

  if (args.position === "after") {
    referenceBlock.after(breakElement);
  } else {
    referenceBlock.before(breakElement);
  }

  focusElementWithoutScroll(root);
  return {
    sectionBreakId: breakBlock.id
  };
}

function createPageLinkElement(node: NotePageLinkNode) {
  const element = document.createElement("span");
  element.dataset.pageLinkId = node.id;
  element.dataset.documentId = node.documentId ?? "";
  element.dataset.pdfPageIndex = node.pdfPageIndex == null ? "" : String(node.pdfPageIndex);
  element.dataset.bookPageLabel = node.bookPageLabel;
  element.dataset.createdAt = node.createdAt;
  configurePageLinkElement(element);
  const parsedText = parsePageLinkText(node.text);
  const visibleLabel = parsedText?.bookPageLabel ?? node.bookPageLabel ?? node.text;
  const leadingParen = document.createElement("span");
  leadingParen.className = "page-link__paren";
  leadingParen.setAttribute("aria-hidden", "true");
  leadingParen.textContent = "(";
  const icon = document.createElement("span");
  icon.className = "page-link__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="5 3 14 18" focusable="false"><path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3-6 3V5.5a1 1 0 0 1 1-1Z" /></svg>';
  const label = document.createElement("span");
  label.className = "page-link__label";
  label.textContent = visibleLabel;
  const trailingParen = document.createElement("span");
  trailingParen.className = "page-link__paren";
  trailingParen.setAttribute("aria-hidden", "true");
  trailingParen.textContent = ")";
  element.append(icon, leadingParen, label, trailingParen);
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

function placeCaretInsideAnchor(anchor: Text, position: "start" | "end" = "end") {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  const offset = position === "start" ? 0 : anchor.textContent?.length ?? 0;
  range.setStart(anchor, offset);
  range.setEnd(anchor, offset);
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

function getPageLinkCaretAnchor(pageLink: HTMLElement, direction: "before" | "after") {
  const sibling = direction === "before" ? pageLink.previousSibling : pageLink.nextSibling;
  return isPageLinkCaretAnchorNode(sibling) ? sibling : null;
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

  const prefixText = stripPageLinkCaretAnchors(prefixRange.toString());
  if (prefixText.length === 0) {
    return false;
  }

  return !/\s$/.test(prefixText);
}

function isRangeAtBlockEnd(root: HTMLElement, block: HTMLElement, range: Range) {
  const blockEndRange = root.ownerDocument.createRange();
  blockEndRange.selectNodeContents(block);
  blockEndRange.collapse(false);

  return (
    range.collapsed &&
    range.compareBoundaryPoints(Range.START_TO_START, blockEndRange) === 0
  );
}

function deepestTrailingNode(node: Node): Node {
  let current = node;

  while (current.lastChild) {
    current = current.lastChild;
  }

  return current;
}

function removeTrailingLineBreakArtifacts(block: HTMLElement) {
  while (block.lastChild instanceof HTMLBRElement) {
    block.lastChild.remove();
  }

  let trailingNode = block.lastChild ? deepestTrailingNode(block.lastChild) : null;

  while (trailingNode) {
    if (trailingNode instanceof HTMLBRElement) {
      const parent = trailingNode.parentNode;
      trailingNode.remove();
      trailingNode = parent?.lastChild ? deepestTrailingNode(parent.lastChild) : null;
      continue;
    }

    if (isPageLinkCaretAnchorNode(trailingNode)) {
      trailingNode = trailingNode.previousSibling
        ? deepestTrailingNode(trailingNode.previousSibling)
        : trailingNode.parentNode instanceof HTMLElement
          ? trailingNode.parentNode
          : null;
      continue;
    }

    if (trailingNode.nodeType === Node.TEXT_NODE) {
      const textNode = trailingNode as Text;
      const sanitized = stripPageLinkCaretAnchors(textNode.textContent ?? "");
      const trimmed = sanitized.replace(/[\r\n]+$/g, "");
      if (trimmed !== sanitized) {
        textNode.textContent = trimmed;
      }
      if ((textNode.textContent ?? "").length === 0) {
        const parent = textNode.parentNode;
        textNode.remove();
        trailingNode = parent?.lastChild ? deepestTrailingNode(parent.lastChild) : null;
        continue;
      }
    }

    break;
  }
}

type VisibleTextSegment = {
  node: Text;
  start: number;
  end: number;
  text: string;
};

function stripInlineArtifacts(fragment: DocumentFragment | HTMLElement) {
  fragment
    .querySelectorAll<HTMLElement>(`[data-inline-type='${PAGE_LINK_INLINE_TYPE}'], [data-inline-type='${TOPIC_INLINE_TYPE}']`)
    .forEach((element) => {
      element.remove();
    });
}

function visibleTextFromRange(range: Range) {
  const fragment = range.cloneContents();
  stripInlineArtifacts(fragment);
  const text = stripPageLinkCaretAnchors(fragment.textContent ?? "");
  return text.replace(/\u00a0/g, " ");
}

function selectionContainsInlineArtifacts(range: Range) {
  const fragment = range.cloneContents();
  return Boolean(
    fragment.querySelector?.(
      `[data-inline-type='${PAGE_LINK_INLINE_TYPE}'], [data-inline-type='${TOPIC_INLINE_TYPE}'], br`
    )
  );
}

function collectVisibleTextSegments(block: HTMLElement) {
  const ownerDocument = block.ownerDocument;
  const walker = ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const segments: VisibleTextSegment[] = [];
  let cursor = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeText = node.textContent ?? "";
    if (isPageLinkCaretAnchorValue(nodeText)) {
      continue;
    }

    const parentElement = node.parentNode instanceof Element ? node.parentNode : null;
    if (parentElement?.closest(`[data-inline-type='${PAGE_LINK_INLINE_TYPE}'], [data-inline-type='${TOPIC_INLINE_TYPE}']`)) {
      continue;
    }

    const text = nodeText.replace(/\u00a0/g, " ");
    if (text.length === 0) {
      continue;
    }

    segments.push({
      node,
      start: cursor,
      end: cursor + text.length,
      text
    });
    cursor += text.length;
  }

  return segments;
}

function domPointForVisibleOffset(segments: VisibleTextSegment[], offset: number) {
  if (segments.length === 0) {
    return null;
  }

  for (const segment of segments) {
    if (offset <= segment.end) {
      return {
        node: segment.node,
        offset: Math.max(0, Math.min(segment.text.length, offset - segment.start))
      };
    }
  }

  const lastSegment = segments[segments.length - 1];
  return lastSegment
    ? {
        node: lastSegment.node,
        offset: lastSegment.text.length
      }
    : null;
}

function visibleOffsetFromPoint(block: HTMLElement, container: Node, offset: number) {
  const range = block.ownerDocument.createRange();
  range.selectNodeContents(block);
  range.setEnd(container, offset);
  return visibleTextFromRange(range).length;
}

function replaceVisibleTextRange(block: HTMLElement, startOffset: number, endOffset: number, nextText: string) {
  const segments = collectVisibleTextSegments(block);
  const startPoint = domPointForVisibleOffset(segments, startOffset);
  const endPoint = domPointForVisibleOffset(segments, endOffset);
  if (!startPoint || !endPoint) {
    return false;
  }

  const range = block.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  range.deleteContents();
  if (nextText.length > 0) {
    range.insertNode(block.ownerDocument.createTextNode(nextText));
  }
  return true;
}

function cleanupEmptyWrappingDelimiters(block: HTMLElement, caretOffset: number) {
  const segments = collectVisibleTextSegments(block);
  const text = segments.map((segment) => segment.text).join("");
  if (text.length === 0) {
    return;
  }

  let leftIndex = caretOffset - 1;
  while (leftIndex >= 0 && /\s/.test(text[leftIndex] ?? "")) {
    leftIndex -= 1;
  }

  let rightIndex = caretOffset;
  while (rightIndex < text.length && /\s/.test(text[rightIndex] ?? "")) {
    rightIndex += 1;
  }

  const leftChar = text[leftIndex] ?? "";
  const rightChar = text[rightIndex] ?? "";
  const isWrapped =
    (leftChar === "(" && rightChar === ")") || (leftChar === "[" && rightChar === "]");

  if (!isWrapped) {
    return;
  }

  replaceVisibleTextRange(block, leftIndex, rightIndex + 1, "");
}

function cleanupWhitespaceAroundOffset(block: HTMLElement, caretOffset: number) {
  const segments = collectVisibleTextSegments(block);
  const text = segments.map((segment) => segment.text).join("");
  if (text.length === 0) {
    return;
  }

  let start = Math.max(0, Math.min(caretOffset, text.length));
  while (start > 0 && /\s/.test(text[start - 1] ?? "")) {
    start -= 1;
  }

  let end = Math.max(0, Math.min(caretOffset, text.length));
  while (end < text.length && /\s/.test(text[end] ?? "")) {
    end += 1;
  }

  if (start === end) {
    return;
  }

  const before = text[start - 1] ?? "";
  const after = text[end] ?? "";
  const replacement =
    start === 0 || end === text.length || /[),.;:!?]/.test(after) || /[([]/.test(before)
      ? ""
      : " ";

  replaceVisibleTextRange(block, start, end, replacement);
}

function insertTopicCardAtBlockStart(block: HTMLElement, topic: ParagraphTopic) {
  const topicElement = createTopicCardElement(topic);
  const topicElements = Array.from(block.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.dataset.inlineType === TOPIC_INLINE_TYPE
  );
  const insertionPoint = topicElements[topicElements.length - 1]?.nextSibling ?? block.firstChild;
  block.insertBefore(topicElement, insertionPoint);
  return topicElement;
}

function readTopicCard(element: HTMLElement) {
  return topicFromElement(element);
}

function topicCommandError(message: string) {
  return {
    ok: false as const,
    message
  };
}

function selectedTextCanBecomeTopic(root: HTMLElement) {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return topicCommandError("Select text inside one paragraph before creating a Topic card.");
  }

  const range = selection.getRangeAt(0);
  const startBlock = findClosestBlockElement(root, range.startContainer);
  const endBlock = findClosestBlockElement(root, range.endContainer);
  if (!startBlock || !endBlock || startBlock !== endBlock) {
    return topicCommandError("Topic cards can only be created from text inside one paragraph.");
  }

  if (startBlock.dataset.blockType !== "paragraph") {
    return topicCommandError("Topic cards can only be created from paragraph text.");
  }

  if (selectionContainsInlineArtifacts(range)) {
    return topicCommandError("Topic cards can only be created from plain text.");
  }

  const rawText = visibleTextFromRange(range);
  if (rawText.includes("\n")) {
    return topicCommandError("Topic cards cannot include line breaks.");
  }

  const topicText = normalizeTopicText(rawText);
  if (!topicText) {
    return topicCommandError("Select text inside one paragraph before creating a Topic card.");
  }

  if (topicText.length > MAX_TOPIC_LENGTH) {
    return topicCommandError(`Topic cards must stay under ${MAX_TOPIC_LENGTH} characters.`);
  }

  return {
    ok: true as const,
    range,
    block: startBlock,
    text: topicText
  };
}

export function canTurnSelectionIntoTopicCard(root: HTMLElement) {
  return selectedTextCanBecomeTopic(root).ok;
}

export function turnSelectionIntoTopicCard(
  root: HTMLElement,
  color: InteractiveColorKey = DEFAULT_TOPIC_COLOR
) {
  const result = selectedTextCanBecomeTopic(root);
  if (!result.ok) {
    return result;
  }

  const { range, block, text } = result;
  focusElementWithoutScroll(root);
  const workingRange = range.cloneRange();
  workingRange.deleteContents();

  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(workingRange);
  }

  const caretOffset = visibleOffsetFromPoint(block, workingRange.startContainer, workingRange.startOffset);
  cleanupEmptyWrappingDelimiters(block, caretOffset);
  cleanupWhitespaceAroundOffset(block, caretOffset);

  const topic = normalizeParagraphTopic({
    id: crypto.randomUUID(),
    text,
    color
  });
  if (!topic) {
    return topicCommandError("Unable to create Topic card.");
  }

  const topicElement = insertTopicCardAtBlockStart(block, topic);
  return {
    ok: true as const,
    blockId: block.dataset.blockId ?? null,
    topic,
    topicId: topic.id,
    topicElement
  };
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
  const blockType = block?.dataset.blockType ?? "";
  const canInsertIntoBlock =
    blockType === "paragraph" ||
    blockType === "heading1" ||
    blockType === "heading2" ||
    blockType === "heading3";
  if (!block || !canInsertIntoBlock) {
    return {
      ok: false as const,
      message: "PageLinks can only be inserted into paragraphs or headings."
    };
  }
  const insertingIntoHeading = blockType !== "paragraph";

  const node = createPageLinkNode({
    text: formatPageLinkText(pageNumber),
    bookPageLabel: String(pageNumber),
    documentId: note.bookId,
    pdfPageIndex: currentPdfPageIndex
  });
  const element = createPageLinkElement(node);

  focusElementWithoutScroll(root);
  let nextRange = insertionRange.cloneRange();
  nextRange.collapse(true);
  if (isRangeAtBlockEnd(root, block, nextRange)) {
    removeTrailingLineBreakArtifacts(block);
    nextRange = root.ownerDocument.createRange();
    nextRange.selectNodeContents(block);
    nextRange.collapse(false);
  }
  const fragment = root.ownerDocument.createDocumentFragment();
  if (!insertingIntoHeading && shouldInsertLeadingSpace(root, nextRange)) {
    fragment.appendChild(root.ownerDocument.createTextNode(" "));
  }
  fragment.appendChild(element);
  nextRange.insertNode(fragment);
  ensurePageLinkCaretAnchors(element);
  const trailingAnchor = getPageLinkCaretAnchor(element, "after");
  if (trailingAnchor) {
    placeCaretInsideAnchor(trailingAnchor, "end");
  } else {
    placeCaretAfterNode(element);
  }

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
  ensurePageLinkCaretAnchors(replacement);
  const trailingAnchor = getPageLinkCaretAnchor(replacement, "after");
  if (trailingAnchor) {
    placeCaretInsideAnchor(trailingAnchor, "end");
  } else {
    placeCaretAfterNode(replacement);
  }

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

  const leadingAnchor = getPageLinkCaretAnchor(pageLink, "before");
  const trailingAnchor = getPageLinkCaretAnchor(pageLink, "after");
  const nextSibling = trailingAnchor?.nextSibling ?? pageLink.nextSibling;
  const previousSibling = leadingAnchor?.previousSibling ?? pageLink.previousSibling;
  const parent = pageLink.parentNode;
  leadingAnchor?.remove();
  pageLink.remove();
  trailingAnchor?.remove();

  if (nextSibling) {
    placeCaretBeforeNode(nextSibling);
  } else if (previousSibling) {
    placeCaretAfterNode(previousSibling);
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

export function readTopicCardFromElement(element: HTMLElement) {
  return readTopicCard(element);
}

export function updateTopicCard(
  root: HTMLElement,
  topicId: string,
  updates: Partial<Pick<ParagraphTopic, "text" | "color">>
) {
  const topicCard = findTopicCardElement(root, topicId);
  if (!topicCard) {
    return {
      ok: false as const,
      message: "Unable to update Topic card."
    };
  }

  const current = readTopicCard(topicCard);
  if (!current) {
    return {
      ok: false as const,
      message: "Unable to update Topic card."
    };
  }

  const nextTopic = normalizeParagraphTopic({
    ...current,
    text: updates.text ?? current.text,
    color: updates.color ?? current.color
  });

  if (!nextTopic) {
    return {
      ok: false as const,
      message: "Topic cards need a short label."
    };
  }

  updateTopicCardElement(topicCard, nextTopic);
  return {
    ok: true as const,
    topic: nextTopic
  };
}

export function removeTopicCard(root: HTMLElement, topicId: string) {
  const topicCard = findTopicCardElement(root, topicId);
  if (!topicCard) {
    return false;
  }

  const block = findClosestBlockElement(root, topicCard);
  topicCard.remove();
  if (block) {
    focusElementWithoutScroll(root);
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(block);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  return true;
}

export function selectTopicCardToken(root: HTMLElement, topicId: string | null) {
  root.querySelectorAll<HTMLElement>(`[data-inline-type='${TOPIC_INLINE_TYPE}']`).forEach((element) => {
    if (!topicId || element.dataset.topicId !== topicId) {
      delete element.dataset.selected;
      return;
    }

    element.dataset.selected = "true";
  });
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

export function selectBlockElement(root: HTMLElement, blockId: string | null) {
  root.querySelectorAll<HTMLElement>("[data-block-id]").forEach((element) => {
    if (!blockId || element.dataset.blockId !== blockId) {
      delete element.dataset.selected;
      return;
    }

    element.dataset.selected = "true";
  });
}

export function textFromEditable(root: HTMLElement) {
  return stripPageLinkCaretAnchors(root.textContent ?? "");
}

function serializeBlockForClipboard(block: HTMLElement): NoteClipboardPayload | null {
  const blockType = blockTypeFromElement(block);
  if (!isSectionBreakBlockType(blockType)) {
    return null;
  }

  return {
    internalHtml: block.outerHTML,
    html: "<hr />",
    text: SECTION_BREAK_TEXT
  };
}

export function removeBlock(root: HTMLElement, blockId: string, options?: { preserveSelection?: boolean }) {
  normalizeNoteEditorDom(root);
  const block = findBlockElement(root, blockId);
  if (!block) {
    return false;
  }

  const currentSelection = options?.preserveSelection ? captureEditorSelection(root) : null;
  const nextSibling = block.nextElementSibling instanceof HTMLElement ? block.nextElementSibling : null;
  const previousSibling = block.previousElementSibling instanceof HTMLElement ? block.previousElementSibling : null;
  block.remove();

  if (root.children.length === 0) {
    const paragraph = createParagraphBlockElement(createEmptyNoteBlock().id);
    root.appendChild(paragraph);
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }

  if (currentSelection && restoreEditorSelection(root, currentSelection)) {
    return true;
  }

  const focusTarget = nextSibling ?? previousSibling;
  if (focusTarget) {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(focusTarget);
      range.collapse(nextSibling ? true : false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return true;
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

export function selectTextMatchInBlock(
  root: HTMLElement,
  blockId: string,
  query: string,
  occurrenceIndex: number
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return false;
  }

  const block = findBlockElement(root, blockId);
  if (!block) {
    return false;
  }

  const ownerDocument = root.ownerDocument;
  const walker = ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const textSegments: Array<{
    node: Text;
    sourceStart: number;
    sourceEnd: number;
    visibleStart: number;
    visibleEnd: number;
  }> = [];
  let visibleText = "";

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const sourceText = node.textContent ?? "";
    if (sourceText.length === 0 || isPageLinkCaretAnchorNode(node)) {
      continue;
    }

    const visibleStart = visibleText.length;
    visibleText += stripPageLinkCaretAnchors(sourceText);
    textSegments.push({
      node,
      sourceStart: 0,
      sourceEnd: sourceText.length,
      visibleStart,
      visibleEnd: visibleText.length
    });
  }

  const normalizedText = visibleText.toLocaleLowerCase();
  let cursor = 0;
  let currentOccurrence = 0;
  let matchStart = -1;

  while (cursor <= normalizedText.length) {
    const nextMatch = normalizedText.indexOf(normalizedQuery, cursor);
    if (nextMatch < 0) {
      break;
    }

    if (currentOccurrence === occurrenceIndex) {
      matchStart = nextMatch;
      break;
    }

    currentOccurrence += 1;
    cursor = nextMatch + Math.max(normalizedQuery.length, 1);
  }

  if (matchStart < 0) {
    return false;
  }

  const matchEnd = matchStart + normalizedQuery.length;
  const startSegment = textSegments.find((segment) =>
    matchStart >= segment.visibleStart && matchStart <= segment.visibleEnd
  );
  const endSegment = textSegments.find((segment) =>
    matchEnd >= segment.visibleStart && matchEnd <= segment.visibleEnd
  );

  if (!startSegment || !endSegment) {
    return false;
  }

  const range = ownerDocument.createRange();
  range.setStart(
    startSegment.node,
    Math.min(startSegment.sourceEnd, startSegment.sourceStart + matchStart - startSegment.visibleStart)
  );
  range.setEnd(
    endSegment.node,
    Math.min(endSegment.sourceEnd, endSegment.sourceStart + matchEnd - endSegment.visibleStart)
  );

  const selection = ownerDocument.defaultView?.getSelection();
  if (!selection) {
    return false;
  }

  selection.removeAllRanges();
  selection.addRange(range);
  block.scrollIntoView({ block: "center" });
  return true;
}

function serializeCurrentSelection(root: HTMLElement): NoteClipboardPayload | null {
  const selection = getSelectionInRoot(root);
  if (!selection || selection.rangeCount === 0 || selection.toString().length === 0) {
    const selectedPageLink = getPageLinkFromSelection(root);
    if (!selectedPageLink) {
      return null;
    }
    return {
      internalHtml: selectedPageLink.outerHTML,
      html: selectedPageLink.outerHTML,
      text: selectedPageLink.textContent ?? ""
    };
  }

  const range = selection.getRangeAt(0);
  const wrapper = document.createElement("div");
  wrapper.appendChild(range.cloneContents());
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
  const emptyNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const sanitized = stripPageLinkCaretAnchors(node.textContent ?? "");
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
    text: stripPageLinkCaretAnchors(selection.toString())
  };
}

export function copySelectedBlock(root: HTMLElement, blockId: string) {
  const block = findBlockElement(root, blockId);
  if (!block) {
    return null;
  }

  const payload = serializeBlockForClipboard(block);
  if (payload) {
    internalClipboardPayload = payload;
  }
  return payload;
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
  event.clipboardData.setData(NOTE_CLIPBOARD_MIME, payload.internalHtml);
}

export function handleCut(root: HTMLElement, event: ClipboardEvent) {
  const payload = rememberInternalClipboard(root);
  if (!payload || !event.clipboardData) {
    return;
  }

  event.preventDefault();
  event.clipboardData.setData("text/plain", payload.text);
  event.clipboardData.setData("text/html", payload.html);
  event.clipboardData.setData(NOTE_CLIPBOARD_MIME, payload.internalHtml);
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
      insertHtmlAtSelection(internalClipboardPayload.internalHtml);
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
  if (
    html &&
    (html.includes(`data-inline-type="${PAGE_LINK_INLINE_TYPE}"`) ||
      html.includes(`data-inline-type="${TOPIC_INLINE_TYPE}"`))
  ) {
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

function resolveAdjacentPageLinkFromNode(
  root: HTMLElement,
  node: Node | null,
  direction: "backward" | "forward"
) {
  if (!node) {
    return null;
  }

  const directPageLink = findClosestPageLinkElement(root, node);
  if (directPageLink) {
    return directPageLink;
  }

  if (!isPageLinkCaretAnchorNode(node)) {
    return null;
  }

  const neighboringNode =
    direction === "backward" ? previousNodeInRoot(root, node) : nextNodeInRoot(root, node);

  return neighboringNode ? findClosestPageLinkElement(root, neighboringNode) : null;
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
    if (isPageLinkCaretAnchorNode(container)) {
      adjacentNode =
        direction === "backward"
          ? previousNodeInRoot(root, container)
          : nextNodeInRoot(root, container);
      return resolveAdjacentPageLinkFromNode(root, adjacentNode, direction);
    }

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

  return resolveAdjacentPageLinkFromNode(root, adjacentNode, direction);
}

export function moveCaretAroundPageLink(root: HTMLElement, pageLinkId: string, direction: "before" | "after") {
  const pageLink = findPageLinkElement(root, pageLinkId);
  if (!pageLink) {
    return false;
  }

  if (direction === "before") {
    const leadingAnchor = getPageLinkCaretAnchor(pageLink, "before");
    if (leadingAnchor) {
      placeCaretInsideAnchor(leadingAnchor, "end");
      return true;
    }
    placeCaretBeforeNode(pageLink);
  } else {
    const trailingAnchor = getPageLinkCaretAnchor(pageLink, "after");
    if (trailingAnchor) {
      placeCaretInsideAnchor(trailingAnchor, "end");
      return true;
    }
    placeCaretAfterNode(pageLink);
  }
  return true;
}
