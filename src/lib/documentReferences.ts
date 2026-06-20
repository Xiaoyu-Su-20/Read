import { noteBlockText } from "./notes";
import type {
  DocumentSourceReference,
  NoteBlock,
  PdfNavigationTarget,
  PdfOutlineItem,
  PdfOutlineSource
} from "./types";

export function flattenOutlineItems(
  items: PdfOutlineItem[],
  depth = 0
): Array<{ item: PdfOutlineItem; depth: number }> {
  return items.flatMap((item) => [
    { item, depth },
    ...flattenOutlineItems(item.items ?? [], depth + 1)
  ]);
}

function normalizeReferenceTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function navigationTargetKey(target: PdfNavigationTarget | null | undefined) {
  if (!target) return "no-target";
  return [
    target.documentId,
    target.pageIndex,
    target.x ?? "",
    target.y ?? "",
    target.zoom ?? "",
    target.fit ?? ""
  ].join(":");
}

function outlineDedupeKey(item: PdfOutlineItem) {
  const destination = item.externalUrl
    ? `external:${item.externalUrl}`
    : `target:${navigationTargetKey(item.target)}:${item.page ?? ""}`;
  return `${normalizeReferenceTitle(item.title)}:${destination}`;
}

export function dedupeOutlineItems(items: PdfOutlineItem[]): PdfOutlineItem[] {
  const byKey = new Map<string, PdfOutlineItem>();

  for (const item of items) {
    const normalizedItem = {
      ...item,
      items: dedupeOutlineItems(item.items ?? [])
    };
    const key = outlineDedupeKey(normalizedItem);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, normalizedItem);
      continue;
    }

    byKey.set(key, {
      ...existing,
      items: dedupeOutlineItems([...(existing.items ?? []), ...(normalizedItem.items ?? [])])
    });
  }

  return Array.from(byKey.values());
}

export function navigationTargetToReaderPage(target: PdfNavigationTarget | null | undefined) {
  return target ? target.pageIndex + 1 : null;
}

export function headingLevel(block: NoteBlock) {
  if (block.type === "heading1") return 1;
  if (block.type === "heading2") return 2;
  if (block.type === "heading3") return 3;
  return null;
}

export function headingTitle(block: NoteBlock) {
  return noteBlockText(block).trim() || "Untitled section";
}

export function createDirectHeadingReference(args: {
  documentId: string;
  title: string;
  pageNumber: number;
}): DocumentSourceReference {
  const target: PdfNavigationTarget = {
    documentId: args.documentId,
    pageIndex: Math.max(args.pageNumber - 1, 0),
    fit: "xyz"
  };

  return {
    id: crypto.randomUUID(),
    documentId: args.documentId,
    kind: "direct",
    outlineItemId: null,
    outlineSource: null,
    title: args.title,
    target,
    createdAt: new Date().toISOString()
  };
}

export function resolveSourceReferenceTarget(
  reference: DocumentSourceReference | null | undefined,
  outlineItems: PdfOutlineItem[]
) {
  if (!reference) return null;
  if (reference.kind === "outline" && reference.outlineItemId) {
    const matched = flattenOutlineItems(outlineItems).find(({ item }) => item.id === reference.outlineItemId);
    if (matched?.item.target) return matched.item.target;
  }

  return reference.target;
}

export function sourceLabel(source: PdfOutlineSource | null | undefined) {
  if (source === "embedded") return "PDF section";
  return "Page link";
}
