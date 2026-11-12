import { describe, expect, it } from "vitest";

import {
  captureContinuousScrollAnchor,
  captureContinuousSemanticAnchor,
  computeContinuousTotalHeight,
  computeContinuousPagePlacements,
  computeContinuousVirtualRange,
  computeContinuousVirtualRangeFromPlacements,
  createEstimatedPageMetrics,
  mergeContinuousVirtualRanges,
  resolveContinuousActivePage,
  resolveContinuousActivePageFromPlacements,
  restoreScrollTopForContinuousSemanticAnchor,
  restoreScrollTopForContinuousAnchor,
  updateMeasuredPageHeight
} from "./continuousPageMetrics";

describe("continuousPageMetrics placement lookups", () => {
  const heights = [100, 240, 0, 180, 60, 300, 120];

  for (const gap of [0, 20]) {
    it(`matches a linear scan for every offset (gap ${gap})`, () => {
      const metrics = createEstimatedPageMetrics(heights.length, (page) => heights[page - 1]);
      const placements = computeContinuousPagePlacements(metrics, gap);
      const totalHeight = placements[placements.length - 1].bottom;

      for (let scrollTop = 0; scrollTop <= totalHeight + 200; scrollTop += 7) {
        const readingLine = scrollTop + 40;
        const expectedPage = (
          placements.find((p) => readingLine >= p.top && readingLine <= p.bottom) ??
          placements.reduce((best, p) => {
            const distance = (q: typeof p) =>
              Math.min(Math.abs(readingLine - q.top), Math.abs(readingLine - q.bottom));
            return distance(p) < distance(best) ? p : best;
          }, placements[0])
        ).pageNumber;
        expect(resolveContinuousActivePageFromPlacements(placements, scrollTop, 40)).toBe(
          expectedPage
        );

        const viewportStart = scrollTop - 50;
        const viewportEnd = scrollTop + 150 + 50;
        const visible = placements.filter(
          (p) => p.bottom >= viewportStart && p.top <= viewportEnd
        );
        const first = visible[0] ?? placements[0];
        const last = visible[visible.length - 1] ?? first;
        const range = computeContinuousVirtualRangeFromPlacements({
          placements,
          scrollTop,
          viewportHeight: 150,
          overscanPx: 50
        });
        expect([range.startPage, range.endPage]).toEqual([first.pageNumber, last.pageNumber]);
        expect(range.topSpacerHeight).toBe(first.top);
        expect(range.totalHeight).toBe(totalHeight);
      }
    });
  }
});

describe("continuousPageMetrics", () => {
  it("builds a continuous document height from estimated page metrics", () => {
    const metrics = createEstimatedPageMetrics(3, (pageNumber) => pageNumber * 100);

    expect(computeContinuousTotalHeight(metrics, 20)).toBe(640);
  });

  it("computes a mounted page range with top and bottom spacers", () => {
    const metrics = createEstimatedPageMetrics(5, () => 100);
    const range = computeContinuousVirtualRange({
      metrics,
      scrollTop: 160,
      viewportHeight: 120,
      overscanPx: 10,
      pageGapPx: 20
    });

    expect(range).toEqual({
      startPage: 2,
      endPage: 3,
      topSpacerHeight: 120,
      bottomSpacerHeight: 240,
      totalHeight: 580
    });
  });

  it("preserves the anchor viewport offset when measurements above it change", () => {
    const estimated = createEstimatedPageMetrics(4, () => 100);
    const anchor = captureContinuousScrollAnchor(estimated, 130, 20);
    const measured = updateMeasuredPageHeight(estimated, 1, 180);

    expect(anchor).toEqual({
      pageNumber: 2,
      viewportOffset: -10
    });
    expect(restoreScrollTopForContinuousAnchor(measured, anchor, 20)).toBe(210);
  });

  it("preserves scroll position when the measured page is below the anchor", () => {
    const estimated = createEstimatedPageMetrics(4, () => 100);
    const anchor = captureContinuousScrollAnchor(estimated, 130, 20);
    const measured = updateMeasuredPageHeight(estimated, 4, 240);

    expect(restoreScrollTopForContinuousAnchor(measured, anchor, 20)).toBe(130);
  });

  it("resolves active page from a reading line across mixed page sizes", () => {
    const metrics = [
      { pageNumber: 1, estimatedHeight: 100, measuredHeight: null },
      { pageNumber: 2, estimatedHeight: 240, measuredHeight: null },
      { pageNumber: 3, estimatedHeight: 80, measuredHeight: null }
    ];

    expect(resolveContinuousActivePage(metrics, 130, 40, 20)).toBe(2);
    expect(resolveContinuousActivePage(metrics, 390, 40, 20)).toBe(3);
  });

  it("preserves the current page position when the measured page contains the anchor", () => {
    const estimated = createEstimatedPageMetrics(3, () => 100);
    const anchor = captureContinuousScrollAnchor(estimated, 130, 20);
    const measured = updateMeasuredPageHeight(estimated, 2, 180);

    expect(anchor?.pageNumber).toBe(2);
    expect(restoreScrollTopForContinuousAnchor(measured, anchor, 20)).toBe(130);
  });

  it("computes a range for large scrollbar jumps into unmeasured content", () => {
    const metrics = createEstimatedPageMetrics(100, () => 100);
    const range = computeContinuousVirtualRange({
      metrics,
      scrollTop: 7600,
      viewportHeight: 600,
      overscanPx: 300,
      pageGapPx: 20
    });

    expect(range.startPage).toBeLessThanOrEqual(62);
    expect(range.endPage).toBeGreaterThanOrEqual(69);
    expect(range.topSpacerHeight).toBeGreaterThan(7000);
    expect(range.bottomSpacerHeight).toBeGreaterThan(3000);
  });

  it("restores zoom using page plus normalized page offset", () => {
    const beforeZoom = createEstimatedPageMetrics(3, () => 100);
    const anchor = captureContinuousSemanticAnchor(beforeZoom, 150, 20, 20);
    const afterZoom = createEstimatedPageMetrics(3, () => 150);

    expect(anchor).toEqual({
      pageNumber: 2,
      normalizedOffset: 0.5
    });
    expect(restoreScrollTopForContinuousSemanticAnchor(afterZoom, anchor, 20, 30)).toBe(235);
  });

  it("keeps a pinned mounted range while expanding to include the restored viewport", () => {
    const metrics = createEstimatedPageMetrics(10, () => 100);
    const merged = mergeContinuousVirtualRanges(metrics, 20, [
      { startPage: 2, endPage: 4 },
      { startPage: 6, endPage: 8 }
    ]);

    expect(merged).toEqual({
      startPage: 2,
      endPage: 8,
      topSpacerHeight: 120,
      bottomSpacerHeight: 240,
      totalHeight: 1180
    });
  });
});
