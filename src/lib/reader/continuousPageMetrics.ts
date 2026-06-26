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
  const placements = computeContinuousPagePlacements(metrics, pageGapPx);
  if (placements.length === 0) {
    return null;
  }

  const readingLine = finiteNonNegative(scrollTop) + finiteNonNegative(readingLineOffsetPx);
  const placement =
    placements.find((candidate) => readingLine >= candidate.top && readingLine <= candidate.bottom) ??
    placements.reduce((best, candidate) => {
      const bestDistance = Math.min(Math.abs(readingLine - best.top), Math.abs(readingLine - best.bottom));
      const candidateDistance = Math.min(
        Math.abs(readingLine - candidate.top),
        Math.abs(readingLine - candidate.bottom)
      );
      return candidateDistance < bestDistance ? candidate : best;
    }, placements[0]);

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

export function computeContinuousVirtualRange(args: {
  metrics: ContinuousPageMetric[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
  pageGapPx: number;
}): ContinuousVirtualRange {
  const placements = computeContinuousPagePlacements(args.metrics, args.pageGapPx);
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
  const visiblePlacements = placements.filter(
    (placement) => placement.bottom >= viewportStart && placement.top <= viewportEnd
  );
  const first = visiblePlacements[0] ?? placements[0];
  const last = visiblePlacements[visiblePlacements.length - 1] ?? first;

  return {
    startPage: first.pageNumber,
    endPage: last.pageNumber,
    topSpacerHeight: first.top,
    bottomSpacerHeight: Math.max(totalHeight - last.bottom, 0),
    totalHeight
  };
}
