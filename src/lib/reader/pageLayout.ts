function roundOffset(value: number) {
  return Math.max(0, Math.floor(value));
}

export function computePageAxisOffset(viewportSize: number, pageSize: number) {
  const extraSpace = viewportSize - pageSize;
  if (extraSpace <= 0) {
    return 0;
  }

  return roundOffset(extraSpace / 2);
}

export function computePageShellOffsets(
  viewportWidth: number,
  viewportHeight: number,
  pageWidth: number,
  pageHeight: number
) {
  return {
    offsetX: computePageAxisOffset(viewportWidth, pageWidth),
    offsetY: computePageAxisOffset(viewportHeight, pageHeight)
  };
}
