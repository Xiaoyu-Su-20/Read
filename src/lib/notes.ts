import type {
  NoteBlock,
  NoteBlockType,
  DocumentSourceReference,
  NoteDocument,
  NoteInlineNode,
  PdfNavigationTarget,
  NoteNavigationItem,
  NotePageLinkNode,
  NoteSpan,
  NoteTopicCardNode,
  NoteTextNode
} from "./types";
import { normalizeParagraphTopic } from "./paragraphTopics";

export const NOTE_SAVE_DEBOUNCE_MS = 1000;
export const PAGE_LINK_TEXT_PATTERN = /^\(p\.\s*(\d+)\)$/;
export const PAGE_LINK_TARGET_INPUT_PATTERN = /^\d+$/;

export function createTextNode(text = "", marks?: Pick<NoteTextNode, "bold" | "italic">): NoteTextNode {
  return {
    type: "text",
    text,
    ...(marks?.bold ? { bold: true } : {}),
    ...(marks?.italic ? { italic: true } : {})
  };
}

export function createTopicCardNode(args: {
  text: string;
  color: NoteTopicCardNode["color"];
  id?: string;
}) {
  const normalizedTopic = normalizeParagraphTopic({
    id: args.id || crypto.randomUUID(),
    text: args.text,
    color: args.color
  });

  if (!normalizedTopic) {
    return null;
  }

  return {
    type: "topic-card" as const,
    ...normalizedTopic
  };
}

export function createEmptyNoteBlock(id = crypto.randomUUID()): NoteBlock {
  return {
    id,
    type: "paragraph",
    children: [createTextNode("")]
  };
}

function normalizePageLinkOrigin(origin: NotePageLinkNode["origin"]): NotePageLinkNode["origin"] {
  if (!origin) {
    return null;
  }

  if (origin.kind === "inline") {
    return { kind: "inline" };
  }

  if (origin.kind === "heading-reference" && origin.ownerBlockId.trim().length > 0) {
    return {
      kind: "heading-reference",
      ownerBlockId: origin.ownerBlockId
    };
  }

  return null;
}

function isHeadingReferencePageLink(node: NoteInlineNode, ownerBlockId: string): node is NotePageLinkNode {
  return (
    node.type === "page-link" &&
    node.origin?.kind === "heading-reference" &&
    node.origin.ownerBlockId === ownerBlockId
  );
}

function findHeadingReferencePageLink(children: NoteInlineNode[], ownerBlockId: string): NotePageLinkNode | null {
  return children.find((child): child is NotePageLinkNode => isHeadingReferencePageLink(child, ownerBlockId)) ?? null;
}

function removeHeadingReferencePageLink(children: NoteInlineNode[], ownerBlockId: string) {
  return children.filter((child) => !isHeadingReferencePageLink(child, ownerBlockId));
}

function sourceReferenceFromHeadingPageLink(args: {
  block: NoteBlock;
  pageLink: NotePageLinkNode | null;
  fallbackDocumentId?: string | null;
}) {
  const pageNumber = args.pageLink?.pdfPageIndex;
  const documentId = args.pageLink?.documentId ?? args.fallbackDocumentId ?? null;
  if (!Number.isInteger(pageNumber) || pageNumber == null || pageNumber <= 0 || !documentId) {
    return null;
  }

  const headingChildren = removeHeadingReferencePageLink(args.block.children ?? [], args.block.id);
  const title =
    noteBlockText({
      ...args.block,
      children: headingChildren
    }).trim() || "Untitled section";

  return normalizeDocumentSourceReference(
    {
      id: args.pageLink?.id || crypto.randomUUID(),
      documentId,
      kind: "direct",
      outlineItemId: null,
      outlineSource: null,
      title,
      target: {
        documentId,
        pageIndex: pageNumber - 1
      },
      createdAt: args.pageLink?.createdAt || new Date().toISOString()
    },
    args.fallbackDocumentId
  );
}

function migrateLegacyHeadingReferences(blocks: NoteBlock[], fallbackDocumentId?: string | null) {
  return blocks.map((block) => {
    if (block.type === "paragraph") {
      return {
        ...block,
        sourceReference: null,
        children: removeHeadingReferencePageLink(block.children ?? [], block.id)
      };
    }

    const normalizedChildren = normalizeNoteInlineNodes(block.children ?? [], fallbackDocumentId);
    const childrenWithoutHeadingReference = removeHeadingReferencePageLink(
      normalizedChildren,
      block.id
    );
    const normalizedSourceReference = normalizeDocumentSourceReference(
      block.sourceReference,
      fallbackDocumentId
    );
    const existing = findHeadingReferencePageLink(normalizedChildren, block.id);
    const hiddenSourceReference =
      normalizedSourceReference ??
      sourceReferenceFromHeadingPageLink({
        block: {
          ...block,
          children: normalizedChildren
        },
        pageLink: existing,
        fallbackDocumentId
      });
    const hasVisibleText = childrenWithoutHeadingReference.some((child) => child.text.trim().length > 0);

    if (!hiddenSourceReference || !hasVisibleText) {
      return {
        ...block,
        sourceReference: null,
        children: childrenWithoutHeadingReference
      };
    }

    return {
      ...block,
      sourceReference: hiddenSourceReference,
      children: childrenWithoutHeadingReference
    };
  });
}

function normalizeNavigationTarget(target: PdfNavigationTarget | null | undefined): PdfNavigationTarget | null {
  if (!target || !target.documentId || !Number.isInteger(target.pageIndex) || target.pageIndex < 0) {
    return null;
  }

  return {
    documentId: target.documentId,
    pageIndex: target.pageIndex,
    ...(typeof target.x === "number" && Number.isFinite(target.x) ? { x: target.x } : {}),
    ...(typeof target.y === "number" && Number.isFinite(target.y) ? { y: target.y } : {}),
    ...(typeof target.zoom === "number" && Number.isFinite(target.zoom) && target.zoom > 0
      ? { zoom: target.zoom }
      : {}),
    ...(target.fit ? { fit: target.fit } : {})
  };
}

export function normalizeDocumentSourceReference(
  reference: DocumentSourceReference | null | undefined,
  fallbackDocumentId?: string | null
): DocumentSourceReference | null {
  if (!reference) {
    return null;
  }

  const target = normalizeNavigationTarget(reference.target);
  const outlineItemId = reference.outlineItemId?.trim() || null;
  const kind = outlineItemId ? "outline" : reference.kind === "outline" ? "outline" : "direct";

  if (kind === "outline" && !outlineItemId && !target) {
    return null;
  }

  if (kind === "direct" && !target) {
    return null;
  }

  return {
    id: reference.id || crypto.randomUUID(),
    documentId: reference.documentId ?? target?.documentId ?? fallbackDocumentId ?? null,
    kind,
    outlineItemId,
    outlineSource: kind === "outline" ? reference.outlineSource ?? null : null,
    title: reference.title.trim() || "Untitled section",
    target,
    createdAt: reference.createdAt || new Date().toISOString()
  };
}

export function pageLinkText(node: NotePageLinkNode) {
  return node.text;
}

export function noteInlineText(node: NoteInlineNode) {
  if (node.type === "page-link") {
    return pageLinkText(node);
  }

  if (node.type === "topic-card") {
    return `[${node.text}] `;
  }

  return node.text;
}

export function noteBlockText(block: NoteBlock) {
  return block.children.map(noteInlineText).join("");
}

function noteBlockPlainText(block: NoteBlock) {
  return noteBlockText(block).trim();
}

export function noteToPlainText(note: NoteDocument) {
  const lines = [
    note.title.trim(),
    ...note.blocks.map(noteBlockPlainText)
  ];
  return lines.filter((line) => line.length > 0).join("\n");
}

export function noteExcerpt(note: NoteDocument) {
  const excerpt = note.blocks
    .map(noteBlockText)
    .map((text) => text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);

  return excerpt.length === 160 ? `${excerpt}...` : excerpt;
}

export function normalizeNoteSpans(spans: NoteSpan[]): NoteSpan[] {
  const normalized = spans.reduce<NoteSpan[]>((result, span) => {
    const nextSpan: NoteSpan = {
      text: span.text,
      ...(span.bold ? { bold: true } : {}),
      ...(span.italic ? { italic: true } : {})
    };
    const previous = result[result.length - 1];

    if (
      previous &&
      Boolean(previous.bold) === Boolean(nextSpan.bold) &&
      Boolean(previous.italic) === Boolean(nextSpan.italic)
    ) {
      previous.text += nextSpan.text;
      return result;
    }

    result.push(nextSpan);
    return result;
  }, []);

  return normalized.length > 0 ? normalized : [{ text: "" }];
}

function normalizeTextNodes(nodes: NoteTextNode[]) {
  const normalized = nodes.reduce<NoteTextNode[]>((result, node) => {
    const nextNode = createTextNode(node.text, {
      ...(node.bold ? { bold: true } : {}),
      ...(node.italic ? { italic: true } : {})
    });
    const previous = result[result.length - 1];

    if (
      previous &&
      Boolean(previous.bold) === Boolean(nextNode.bold) &&
      Boolean(previous.italic) === Boolean(nextNode.italic)
    ) {
      previous.text += nextNode.text;
      return result;
    }

    result.push(nextNode);
    return result;
  }, []);

  return normalized.length > 0 ? normalized : [createTextNode("")];
}

function normalizePageLinkNode(node: NotePageLinkNode): NotePageLinkNode {
  return {
    type: "page-link",
    id: node.id || crypto.randomUUID(),
    text: node.text,
    documentId: node.documentId ?? null,
    pdfPageIndex:
      typeof node.pdfPageIndex === "number" && Number.isFinite(node.pdfPageIndex)
        ? node.pdfPageIndex
        : null,
    bookPageLabel: node.bookPageLabel.trim(),
    createdAt: node.createdAt || new Date().toISOString(),
    ...(normalizePageLinkOrigin(node.origin) ? { origin: normalizePageLinkOrigin(node.origin) } : {})
  };
}

function normalizeTopicCardNode(node: NoteTopicCardNode): NoteTopicCardNode | null {
  const normalizedTopic = normalizeParagraphTopic(node);
  if (!normalizedTopic) {
    return null;
  }

  return {
    type: "topic-card",
    ...normalizedTopic
  };
}

function spansToChildren(spans: NoteSpan[]): NoteInlineNode[] {
  return normalizeNoteSpans(spans).map((span) => createTextNode(span.text, span));
}

export function normalizeNoteInlineNodes(nodes: NoteInlineNode[], fallbackDocumentId?: string | null) {
  const normalized: NoteInlineNode[] = [];
  const pendingText: NoteTextNode[] = [];

  function flushText() {
    if (pendingText.length === 0) {
      return;
    }
    normalized.push(...normalizeTextNodes(pendingText));
    pendingText.length = 0;
  }

  for (const node of nodes) {
    if (node.type === "page-link") {
      flushText();
      normalized.push(
        normalizePageLinkNode({
          ...node,
          documentId: node.documentId ?? fallbackDocumentId ?? null
        })
      );
      continue;
    }

    if (node.type === "topic-card") {
      flushText();
      const normalizedTopicNode = normalizeTopicCardNode(node);
      if (normalizedTopicNode) {
        normalized.push(normalizedTopicNode);
      }
      continue;
    }

    pendingText.push(createTextNode(node.text, node));
  }

  flushText();
  return normalized.length > 0 ? normalized : [createTextNode("")];
}

export function normalizeNoteBlocks(blocks: NoteBlock[], fallbackDocumentId?: string | null): NoteBlock[] {
  const migratedBlocks = migrateLegacyHeadingReferences(blocks, fallbackDocumentId);
  const seenIds = new Set<string>();
  const normalized: NoteBlock[] = [];

  for (const block of migratedBlocks) {
    if ((block.type as string) === "sectionBreak") {
      continue;
    }

    let blockId = block.id;

    if (!blockId || seenIds.has(blockId)) {
      blockId = crypto.randomUUID();
    }

    seenIds.add(blockId);

    const hasInlineTopicCards = Array.isArray(block.children)
      ? block.children.some((child) => child.type === "topic-card")
      : false;
    const legacyTopicNodes =
      hasInlineTopicCards
        ? []
        : (block.topics?.flatMap((topic) => {
            const topicNode = createTopicCardNode(topic);
            return topicNode ? [topicNode] : [];
          }) ?? []);
    const fallbackChildren = spansToChildren(block.spans ?? []);
    const children =
      Array.isArray(block.children) && block.children.length > 0
        ? [...legacyTopicNodes, ...block.children]
        : [...legacyTopicNodes, ...fallbackChildren];
    const normalizedChildren = normalizeNoteInlineNodes(children, fallbackDocumentId);

    normalized.push({
      id: blockId,
      type: block.type,
      children: normalizedChildren,
      sourceReference: block.type === "paragraph" ? null : block.sourceReference ?? null
    });
  }

  return normalized.length > 0 ? normalized : [createEmptyNoteBlock()];
}

export function normalizeNoteDocument(note: NoteDocument): NoteDocument {
  return {
    ...note,
    title: note.title.trim() || "Untitled note",
    blocks: normalizeNoteBlocks(note.blocks, note.bookId)
  };
}

export function deriveNoteNavigationItems(blocks: NoteBlock[]): NoteNavigationItem[] {
  return blocks.flatMap((block) => {
    if (block.type === "paragraph") {
      return [];
    }

    const title = noteBlockText(block).trim();
    if (!title) {
      return [];
    }

    const level = Number.parseInt(block.type.replace("heading", ""), 10) as 1 | 2 | 3;
    return [
      {
        id: `navigation-${block.id}`,
        blockId: block.id,
        title,
        level
      }
    ];
  });
}

export function replaceBlockType(
  blocks: NoteBlock[],
  blockId: string,
  nextType: NoteBlockType
) {
  return normalizeNoteBlocks(
    blocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            type: nextType,
            children: block.children,
            sourceReference: nextType === "paragraph" ? null : block.sourceReference ?? null
          }
        : block
    )
  );
}

export function replaceBlockSourceReference(
  blocks: NoteBlock[],
  blockId: string,
  sourceReference: DocumentSourceReference | null,
  fallbackDocumentId?: string | null
) {
  const normalizedReference = normalizeDocumentSourceReference(sourceReference, fallbackDocumentId);
  return normalizeNoteBlocks(
    blocks.map((block) => {
      if (block.id !== blockId) {
        return block;
      }

      if (block.type === "paragraph") {
        return {
          ...block,
          sourceReference: null,
          children: removeHeadingReferencePageLink(block.children, block.id)
        };
      }

      const children = removeHeadingReferencePageLink(block.children, block.id);
      if (!normalizedReference) {
        return {
          ...block,
          sourceReference: null,
          children
        };
      }

      return {
        ...block,
        sourceReference: normalizedReference,
        children
      };
    }),
    fallbackDocumentId
  );
}

export function parsePageLinkText(selectionText: string) {
  const trimmed = selectionText.trim();
  const match = PAGE_LINK_TEXT_PATTERN.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    rawText: trimmed,
    bookPageLabel: match[1]
  };
}

export function formatPageLinkText(pageNumber: number) {
  return `(p. ${pageNumber})`;
}

export function parsePageLinkTargetInput(input: string) {
  const trimmed = input.trim();
  if (!PAGE_LINK_TARGET_INPUT_PATTERN.test(trimmed)) {
    return null;
  }

  const pageNumber = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
    return null;
  }

  return {
    pageNumber,
    bookPageLabel: trimmed,
    text: formatPageLinkText(pageNumber)
  };
}

export function createPageLinkNode(args: {
  text: string;
  bookPageLabel: string;
  documentId: string | null;
  pdfPageIndex: number | null;
  id?: string;
  createdAt?: string;
  origin?: NotePageLinkNode["origin"];
}) {
  return normalizePageLinkNode({
    type: "page-link",
    id: args.id || crypto.randomUUID(),
    text: args.text,
    documentId: args.documentId,
    pdfPageIndex: args.pdfPageIndex,
    bookPageLabel: args.bookPageLabel,
    createdAt: args.createdAt || new Date().toISOString(),
    ...(args.origin ? { origin: args.origin } : {})
  });
}

export function createSaveScheduler(onFlush: () => void, delayMs = NOTE_SAVE_DEBOUNCE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        onFlush();
      }, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      onFlush();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isScheduled() {
      return timer !== null;
    }
  };
}
