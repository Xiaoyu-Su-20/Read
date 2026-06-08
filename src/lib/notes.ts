import type {
  NoteBlock,
  NoteBlockType,
  NoteDocument,
  NoteInlineNode,
  NoteNavigationItem,
  NotePageLinkNode,
  NoteSpan,
  NoteTextNode
} from "./types";

export const NOTE_SAVE_DEBOUNCE_MS = 1000;
export const PAGE_LINK_TEXT_PATTERN = /^\(p\.\s*(\d+)\)$/;

export function createTextNode(text = "", marks?: Pick<NoteTextNode, "bold" | "italic">): NoteTextNode {
  return {
    type: "text",
    text,
    ...(marks?.bold ? { bold: true } : {}),
    ...(marks?.italic ? { italic: true } : {})
  };
}

export function createEmptyNoteBlock(id = crypto.randomUUID()): NoteBlock {
  return {
    id,
    type: "paragraph",
    children: [createTextNode("")]
  };
}

export function pageLinkText(node: NotePageLinkNode) {
  return node.text;
}

export function noteInlineText(node: NoteInlineNode) {
  return node.type === "page-link" ? pageLinkText(node) : node.text;
}

export function noteBlockText(block: NoteBlock) {
  return block.children.map(noteInlineText).join("");
}

export function noteToPlainText(note: NoteDocument) {
  const lines = [note.title.trim(), ...note.blocks.map(noteBlockText).map((text) => text.trim())];
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
    createdAt: node.createdAt || new Date().toISOString()
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

    pendingText.push(createTextNode(node.text, node));
  }

  flushText();
  return normalized.length > 0 ? normalized : [createTextNode("")];
}

export function normalizeNoteBlocks(blocks: NoteBlock[], fallbackDocumentId?: string | null): NoteBlock[] {
  const seenIds = new Set<string>();
  const normalized = blocks.map((block) => {
    let blockId = block.id;

    if (!blockId || seenIds.has(blockId)) {
      blockId = crypto.randomUUID();
    }

    seenIds.add(blockId);

    const children =
      Array.isArray(block.children) && block.children.length > 0
        ? block.children
        : spansToChildren(block.spans ?? []);

    return {
      id: blockId,
      type: block.type,
      children: normalizeNoteInlineNodes(children, fallbackDocumentId)
    };
  });

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

    const title = noteBlockText(block).trim() || "Untitled section";
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
            type: nextType
          }
        : block
    )
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

export function createPageLinkNode(args: {
  text: string;
  bookPageLabel: string;
  documentId: string | null;
  pdfPageIndex: number | null;
}) {
  return normalizePageLinkNode({
    type: "page-link",
    id: crypto.randomUUID(),
    text: args.text,
    documentId: args.documentId,
    pdfPageIndex: args.pdfPageIndex,
    bookPageLabel: args.bookPageLabel,
    createdAt: new Date().toISOString()
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
