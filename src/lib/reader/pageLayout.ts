export const PAGE_CENTER_TRANSITION_BAND_PX = 160;

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

export function smoothstep(value: number) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function computePageAxisOffset(
  viewportSize: number,
  pageSize: number,
  transitionBandPx = PAGE_CENTER_TRANSITION_BAND_PX
) {
  const extraSpace = viewportSize - pageSize;
  if (extraSpace <= 0) {
    return 0;
  }

  const centeredOffset = extraSpace / 2;
  if (extraSpace >= transitionBandPx) {
    return centeredOffset;
  }

  const t = smoothstep(extraSpace / transitionBandPx);
  return centeredOffset * t;
}

export function computePageShellOffsets(
  viewportWidth: number,
  viewportHeight: number,
  pageWidth: number,
  pageHeight: number,
  transitionBandPx = PAGE_CENTER_TRANSITION_BAND_PX
) {
  return {
    offsetX: computePageAxisOffset(viewportWidth, pageWidth, transitionBandPx),
    offsetY: computePageAxisOffset(viewportHeight, pageHeight, transitionBandPx)
  };
}
