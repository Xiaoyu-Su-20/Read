export type ContinuousPageMetric = {
  pageNumber: number;
  estimatedHeight: number;
  measuredHeight: number | null;
};

export type ContinuousPagePlacement = ContinuousPageMetric & {
  top: number;
  bottom: number;
  height: number;
};

export type ContinuousVirtualRange = {
  startPage: number;
  endPage: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
};

export type ContinuousScrollAnchor = {
  pageNumber: number;
  viewportOffset: number;
};

export type ContinuousSemanticAnchor = {
  pageNumber: number;
  normalizedOffset: number;
};

function finiteNonNegative(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(value, 0) : fallback;
}

export function resolvedPageHeight(metric: ContinuousPageMetric) {
  return finiteNonNegative(metric.measuredHeight ?? metric.estimatedHeight);
}

export function createEstimatedPageMetrics(
  pageCount: number,
  estimatePageHeight: (pageNumber: number) => number
): ContinuousPageMetric[] {
  const normalizedPageCount = Math.max(Math.floor(pageCount), 0);
  return Array.from({ length: normalizedPageCount }, (_, index) => {
    const pageNumber = index + 1;
    return {
      pageNumber,
      estimatedHeight: finiteNonNegative(estimatePageHeight(pageNumber), 1),
      measuredHeight: null
    };
  });
}

export function updateMeasuredPageHeight(
  metrics: ContinuousPageMetric[],
  pageNumber: number,
  measuredHeight: number
) {
  const nextMeasuredHeight = finiteNonNegative(measuredHeight);
  return metrics.map((metric) =>
    metric.pageNumber === pageNumber
      ? {
          ...metric,
          measuredHeight: nextMeasuredHeight
        }
      : metric
  );
}

export function computeContinuousPagePlacements(
  metrics: ContinuousPageMetric[],
  pageGapPx: number
): ContinuousPagePlacement[] {
  const gap = finiteNonNegative(pageGapPx);
  let cursor = 0;
  return metrics.map((metric, index) => {
    if (index > 0) {
      cursor += gap;
    }

    const height = resolvedPageHeight(metric);
    const top = cursor;
    const bottom = top + height;
    cursor = bottom;
    return {
      ...metric,
      top,
      bottom,
      height
    };
  });
}

export function computeContinuousTotalHeight(
  metrics: ContinuousPageMetric[],
  pageGapPx: number
) {
  const placements = computeContinuousPagePlacements(metrics, pageGapPx);
  return placements[placements.length - 1]?.bottom ?? 0;
}

export function captureContinuousScrollAnchor(
  metrics: ContinuousPageMetric[],
  scrollTop: number,
  pageGapPx: number
): ContinuousScrollAnchor | null {
  const placements = computeContinuousPagePlacements(metrics, pageGapPx);
  if (placements.length === 0) {
    return null;
  }

  const normalizedScrollTop = finiteNonNegative(scrollTop);
  const anchor =
    placements.find((placement) => placement.bottom >= normalizedScrollTop) ??
    placements[placements.length - 1];

  return {
    pageNumber: anchor.pageNumber,
    viewportOffset: anchor.top - normalizedScrollTop
  };
}

export function restoreScrollTopForContinuousAnchor(
  metrics: ContinuousPageMetric[],
  anchor: ContinuousScrollAnchor | null,
  pageGapPx: number
) {
  if (!anchor) {
    return 0;
  }

  const placement = computeContinuousPagePlacements(metrics, pageGapPx).find(
    (candidate) => candidate.pageNumber === anchor.pageNumber
  );
  if (!placement) {
    return 0;
  }

  return finiteNonNegative(placement.top - anchor.viewportOffset);
}

export function captureContinuousSemanticAnchor(
  metrics: ContinuousPageMetric[],
  scrollTop: number,
  readingLineOffsetPx: number,
  pageGapPx: number
): ContinuousSemanticAnchor | null {
  return captureContinuousSemanticAnchorFromPlacements(
    computeContinuousPagePlacements(metrics, pageGapPx),
    scrollTop,
    readingLineOffsetPx
  );
}

// Placements are sorted by position, so lookups by offset can binary-search.
function firstPlacementIndex(
  placements: ContinuousPagePlacement[],
  matches: (placement: ContinuousPagePlacement) => boolean
) {
  let low = 0;
  let high = placements.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (matches(placements[middle])) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function distanceToPlacement(placement: ContinuousPagePlacement, offset: number) {
  return Math.min(Math.abs(offset - placement.top), Math.abs(offset - placement.bottom));
}

export function captureContinuousSemanticAnchorFromPlacements(
  placements: ContinuousPagePlacement[],
  scrollTop: number,
  readingLineOffsetPx: number
): ContinuousSemanticAnchor | null {
  if (placements.length === 0) {
    return null;
  }

  const readingLine = finiteNonNegative(scrollTop) + finiteNonNegative(readingLineOffsetPx);
  const index = firstPlacementIndex(placements, (candidate) => candidate.bottom >= readingLine);
  let placement: ContinuousPagePlacement;
  if (index < placements.length && placements[index].top <= readingLine) {
    placement = placements[index];
  } else {
    // The reading line is in a gap or past the end: take the nearer neighbour.
    const before = placements[index - 1];
    const after = placements[index];
    if (!before) {
      placement = after;
    } else if (!after) {
      placement = before;
    } else {
      placement =
        distanceToPlacement(after, readingLine) < distanceToPlacement(before, readingLine)
          ? after
          : before;
    }
  }

  return {
    pageNumber: placement.pageNumber,
    normalizedOffset:
      placement.height <= 0
        ? 0
        : Math.min(Math.max((readingLine - placement.top) / placement.height, 0), 1)
  };
}

export function restoreScrollTopForContinuousSemanticAnchor(
  metrics: ContinuousPageMetric[],
  anchor: ContinuousSemanticAnchor | null,
  readingLineOffsetPx: number,
  pageGapPx: number
) {
  if (!anchor) {
    return 0;
  }

  const placement = computeContinuousPagePlacements(metrics, pageGapPx).find(
    (candidate) => candidate.pageNumber === anchor.pageNumber
  );
  if (!placement) {
    return 0;
  }

  return finiteNonNegative(
    placement.top + placement.height * Math.min(Math.max(anchor.normalizedOffset, 0), 1) - finiteNonNegative(readingLineOffsetPx)
  );
}

export function resolveContinuousActivePage(
  metrics: ContinuousPageMetric[],
  scrollTop: number,
  readingLineOffsetPx: number,
  pageGapPx: number
) {
  return captureContinuousSemanticAnchor(metrics, scrollTop, readingLineOffsetPx, pageGapPx)?.pageNumber ?? 1;
}

export function resolveContinuousActivePageFromPlacements(
  placements: ContinuousPagePlacement[],
  scrollTop: number,
  readingLineOffsetPx: number
) {
  return (
    captureContinuousSemanticAnchorFromPlacements(placements, scrollTop, readingLineOffsetPx)
      ?.pageNumber ?? 1
  );
}

export function computeContinuousVirtualRange(args: {
  metrics: ContinuousPageMetric[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
  pageGapPx: number;
}): ContinuousVirtualRange {
  return computeContinuousVirtualRangeFromPlacements({
    placements: computeContinuousPagePlacements(args.metrics, args.pageGapPx),
    scrollTop: args.scrollTop,
    viewportHeight: args.viewportHeight,
    overscanPx: args.overscanPx
  });
}

export function computeContinuousVirtualRangeFromPlacements(args: {
  placements: ContinuousPagePlacement[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}): ContinuousVirtualRange {
  const { placements } = args;
  const totalHeight = placements[placements.length - 1]?.bottom ?? 0;
  if (placements.length === 0) {
    return {
      startPage: 0,
      endPage: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      totalHeight: 0
    };
  }

  const viewportStart = finiteNonNegative(args.scrollTop) - finiteNonNegative(args.overscanPx);
  const viewportEnd =
    finiteNonNegative(args.scrollTop) +
    finiteNonNegative(args.viewportHeight) +
    finiteNonNegative(args.overscanPx);
  const firstIndex = firstPlacementIndex(
    placements,
    (placement) => placement.bottom >= viewportStart
  );
  const lastIndex =
    firstPlacementIndex(placements, (placement) => placement.top > viewportEnd) - 1;
  const anyVisible = firstIndex <= lastIndex;
  const first = anyVisible ? placements[firstIndex] : placements[0];
  const last = anyVisible ? placements[lastIndex] : first;

  return {
    startPage: first.pageNumber,
    endPage: last.pageNumber,
    topSpacerHeight: first.top,
    bottomSpacerHeight: Math.max(totalHeight - last.bottom, 0),
    totalHeight
  };
}

export function mergeContinuousVirtualRanges(
  metrics: ContinuousPageMetric[],
  pageGapPx: number,
  ranges: Array<Pick<ContinuousVirtualRange, "startPage" | "endPage"> | null>
): ContinuousVirtualRange {
  const placements = computeContinuousPagePlacements(metrics, pageGapPx);
  const totalHeight = placements[placements.length - 1]?.bottom ?? 0;
  const validRanges = ranges.filter(
    (range): range is Pick<ContinuousVirtualRange, "startPage" | "endPage"> =>
      range !== null && range.startPage > 0 && range.endPage >= range.startPage
  );
  if (placements.length === 0 || validRanges.length === 0) {
    return {
      startPage: 0,
      endPage: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      totalHeight
    };
  }

  const startPage = Math.max(
    Math.min(...validRanges.map((range) => range.startPage)),
    1
  );
  const endPage = Math.min(
    Math.max(...validRanges.map((range) => range.endPage)),
    placements.length
  );
  const first = placements[startPage - 1];
  const last = placements[endPage - 1];
  return {
    startPage,
    endPage,
    topSpacerHeight: first.top,
    bottomSpacerHeight: Math.max(totalHeight - last.bottom, 0),
    totalHeight
  };
}
