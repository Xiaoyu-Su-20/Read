import type {
  DocumentSourceReference,
  NoteBlockType
} from "../../lib/types";

export type HeadingReferenceRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type HeadingReferenceDecoration = {
  blockId: string;
  blockType: Exclude<NoteBlockType, "paragraph">;
  reference: DocumentSourceReference;
  left: number;
  top: number;
};

export function isMeaningfulHeadingReferenceRect(
  rect: Pick<HeadingReferenceRect, "width" | "height">
) {
  return rect.width > 0.5 && rect.height > 0.5;
}

export function resolveHeadingReferenceAnchorRect(
  rects: Iterable<HeadingReferenceRect>,
  fallback: HeadingReferenceRect
) {
  const candidates = Array.from(rects);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const rect = candidates[index];
    if (rect && isMeaningfulHeadingReferenceRect(rect)) {
      return rect;
    }
  }

  return fallback;
}

export function createHeadingReferenceDecoration(args: {
  blockId: string;
  blockType: Exclude<NoteBlockType, "paragraph">;
  reference: DocumentSourceReference;
  anchorRect: HeadingReferenceRect;
  containerRect: Pick<HeadingReferenceRect, "left" | "top">;
  gapPx?: number;
}) {
  const gapPx = args.gapPx ?? 4;

  return {
    blockId: args.blockId,
    blockType: args.blockType,
    reference: args.reference,
    left: Math.max(0, args.anchorRect.right - args.containerRect.left + gapPx),
    top: Math.max(0, args.anchorRect.bottom - args.containerRect.top)
  } satisfies HeadingReferenceDecoration;
}
