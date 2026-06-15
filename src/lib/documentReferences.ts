import { noteBlockText } from "./notes";
import type {
  DocumentSourceReference,
  NoteBlock,
  PdfNavigationTarget,
  PdfOutlineItem,
  PdfOutlineSource
} from "./types";

export type OutlinePickerItem = {
  item: PdfOutlineItem;
  depth: number;
  score: number;
};

export function mergeOutlineItems(
  embeddedOutlineItems: PdfOutlineItem[],
  userOutlineItems: PdfOutlineItem[] = []
): PdfOutlineItem[] {
  return dedupeOutlineItems([...userOutlineItems, ...embeddedOutlineItems]);
}

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

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase();
}

function titleMatchScore(heading: string, candidate: string) {
  const left = normalizeSearchText(heading);
  const right = normalizeSearchText(candidate);
  if (!left || !right) return 0;
  if (left === right) return 90;
  if (right.includes(left) || left.includes(right)) return 55;

  const headingTerms = new Set(left.split(/\s+/).filter(Boolean));
  const candidateTerms = right.split(/\s+/).filter(Boolean);
  const overlap = candidateTerms.filter((term) => headingTerms.has(term)).length;
  return overlap * 10;
}

function pageProximityScore(currentPage: number | null, item: PdfOutlineItem) {
  if (!currentPage || !item.page) return 0;
  const distance = Math.abs(item.page - currentPage);
  if (distance === 0) return 45;
  if (distance <= 2) return 25;
  if (distance <= 8) return 10;
  return 0;
}

export function scoreOutlineCandidates(args: {
  outlineItems: PdfOutlineItem[];
  headingTitle: string;
  currentPage: number | null;
  query: string;
}) {
  const query = normalizeSearchText(args.query);
  return flattenOutlineItems(args.outlineItems)
    .filter(({ item }) => {
      if (!query) return true;
      return normalizeSearchText(item.title).includes(query);
    })
    .map<OutlinePickerItem>(({ item, depth }) => ({
      item,
      depth,
      score:
        titleMatchScore(args.headingTitle, item.title) +
        pageProximityScore(args.currentPage, item) +
        (item.source === "user" ? 4 : 0) -
        depth
    }))
    .sort((left, right) => right.score - left.score || (left.item.page ?? 0) - (right.item.page ?? 0));
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

export function createOutlineHeadingReference(item: PdfOutlineItem): DocumentSourceReference {
  return {
    id: crypto.randomUUID(),
    documentId: item.target?.documentId ?? null,
    kind: "outline",
    outlineItemId: item.id,
    outlineSource: item.source,
    title: item.title,
    target: item.target,
    createdAt: new Date().toISOString()
  };
}

export function createUserOutlineItemFromHeading(args: {
  documentId: string;
  title: string;
  pageNumber: number;
}): PdfOutlineItem {
  const target: PdfNavigationTarget = {
    documentId: args.documentId,
    pageIndex: Math.max(args.pageNumber - 1, 0),
    fit: "xyz"
  };
  const createdAt = new Date().toISOString();

  return {
    id: `user:${crypto.randomUUID()}`,
    title: args.title,
    source: "user",
    sourceId: null,
    target,
    page: args.pageNumber,
    externalUrl: null,
    items: [],
    createdAt
  };
}

export function findUserOutlineItemForHeading(args: {
  items: PdfOutlineItem[];
  documentId: string;
  title: string;
  pageNumber: number;
}) {
  const target: PdfNavigationTarget = {
    documentId: args.documentId,
    pageIndex: Math.max(args.pageNumber - 1, 0),
    fit: "xyz"
  };
  const key = `${normalizeReferenceTitle(args.title)}:target:${navigationTargetKey(target)}:${args.pageNumber}`;

  return flattenOutlineItems(args.items).find(
    ({ item }) => item.source === "user" && outlineDedupeKey(item) === key
  )?.item ?? null;
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
  if (source === "user") return "User section";
  if (source === "embedded") return "PDF section";
  return "Page link";
}
