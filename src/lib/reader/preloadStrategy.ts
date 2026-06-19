import type { NavigationDirection } from "./rapidTurn";

export function resolveAdjacentPreloadPages(
  anchorPage: number,
  pageCount: number,
  preferredDirection: NavigationDirection | null
) {
  const previousPage = anchorPage > 1 ? anchorPage - 1 : null;
  const nextPage = anchorPage < pageCount ? anchorPage + 1 : null;

  const orderedCandidates =
    preferredDirection === "previous"
      ? [previousPage, nextPage]
      : [nextPage, previousPage];

  return orderedCandidates.filter((pageNumber): pageNumber is number => pageNumber !== null);
}

export function resolveDisplayListWarmupPages(
  anchorPage: number,
  pageCount: number,
  preferredDirection: NavigationDirection | null
) {
  const normalizedPageCount = Math.max(Math.round(pageCount), 0);
  if (normalizedPageCount <= 0) {
    return [];
  }

  const clampedAnchorPage = Math.min(
    Math.max(Math.round(anchorPage), 1),
    normalizedPageCount
  );
  const offsets =
    preferredDirection === "previous"
      ? [0, -1, -2, 1]
      : [0, 1, 2, -1];
  const seen = new Set<number>();

  return offsets
    .map((offset) => clampedAnchorPage + offset)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= normalizedPageCount)
    .filter((pageNumber) => {
      if (seen.has(pageNumber)) {
        return false;
      }
      seen.add(pageNumber);
      return true;
    });
}
