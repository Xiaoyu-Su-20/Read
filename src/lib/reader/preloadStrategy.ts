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
