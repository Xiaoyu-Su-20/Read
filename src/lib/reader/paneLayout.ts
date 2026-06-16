export const DEFAULT_READER_PANE_SPLIT_RATIO = 0.46;
export const MIN_READER_PANE_WIDTH_PX = 320;
export const READER_PANE_SPLIT_KEYBOARD_STEP = 0.02;
export const READER_PANE_SPLITTER_LINE_WIDTH_PX = 1;
export const READER_PANE_SPLITTER_HIT_WIDTH_PX = 24;
export const READER_PANE_STACKED_MEDIA_QUERY = "(max-width: 900px)";

export type ReaderPaneLayout = {
  preferredRatio: number;
  constrainedRatio: number;
  documentWidth: number;
  notesWidth: number;
  usableWidth: number;
  isConstrained: boolean;
};

function roundRatio(value: number) {
  return Number(value.toFixed(4));
}

function roundWidth(value: number) {
  return Number(value.toFixed(2));
}

export function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeRatio(value: number) {
  return roundRatio(clampValue(value, 0, 1));
}

export function getReaderPaneUsableWidth(
  containerWidth: number,
  splitterWidth = READER_PANE_SPLITTER_LINE_WIDTH_PX
) {
  return Math.max(containerWidth - splitterWidth, 0);
}

export function getReaderPaneSplitRatioBounds(
  containerWidth: number,
  minPaneWidth = MIN_READER_PANE_WIDTH_PX,
  splitterWidth = READER_PANE_SPLITTER_LINE_WIDTH_PX
) {
  const usableWidth = getReaderPaneUsableWidth(containerWidth, splitterWidth);
  if (usableWidth <= 0) {
    return {
      minRatio: 0.5,
      maxRatio: 0.5
    };
  }

  if (usableWidth <= minPaneWidth * 2) {
    return {
      minRatio: 0.5,
      maxRatio: 0.5
    };
  }

  const minRatio = minPaneWidth / usableWidth;
  return {
    minRatio: roundRatio(minRatio),
    maxRatio: roundRatio(1 - minRatio)
  };
}

export function deriveReaderPaneLayout(
  preferredRatio: number,
  containerWidth: number,
  minPaneWidth = MIN_READER_PANE_WIDTH_PX,
  splitterWidth = READER_PANE_SPLITTER_LINE_WIDTH_PX
): ReaderPaneLayout {
  const normalizedPreferredRatio = normalizeRatio(preferredRatio);
  const usableWidth = getReaderPaneUsableWidth(containerWidth, splitterWidth);

  if (usableWidth <= 0) {
    return {
      preferredRatio: normalizedPreferredRatio,
      constrainedRatio: 0.5,
      documentWidth: 0,
      notesWidth: 0,
      usableWidth: 0,
      isConstrained: true
    };
  }

  if (usableWidth <= minPaneWidth * 2) {
    const documentWidth = roundWidth(usableWidth / 2);
    const notesWidth = roundWidth(Math.max(usableWidth - documentWidth, 0));

    return {
      preferredRatio: normalizedPreferredRatio,
      constrainedRatio: usableWidth === 0 ? 0.5 : roundRatio(documentWidth / usableWidth),
      documentWidth,
      notesWidth,
      usableWidth: roundWidth(usableWidth),
      isConstrained: true
    };
  }

  const preferredDocumentWidth = usableWidth * normalizedPreferredRatio;
  const documentWidth = roundWidth(
    clampValue(preferredDocumentWidth, minPaneWidth, usableWidth - minPaneWidth)
  );
  const notesWidth = roundWidth(Math.max(usableWidth - documentWidth, 0));
  const constrainedRatio = usableWidth === 0 ? 0.5 : roundRatio(documentWidth / usableWidth);

  return {
    preferredRatio: normalizedPreferredRatio,
    constrainedRatio,
    documentWidth,
    notesWidth,
    usableWidth: roundWidth(usableWidth),
    isConstrained: Math.abs(constrainedRatio - normalizedPreferredRatio) > 0.0001
  };
}

export function clampReaderPaneSplitRatio(
  ratio: number,
  containerWidth: number,
  minPaneWidth = MIN_READER_PANE_WIDTH_PX,
  splitterWidth = READER_PANE_SPLITTER_LINE_WIDTH_PX
) {
  return deriveReaderPaneLayout(
    ratio,
    containerWidth,
    minPaneWidth,
    splitterWidth
  ).constrainedRatio;
}

export function normalizeReaderPaneSplitRatio(value: unknown) {
  const fallback = DEFAULT_READER_PANE_SPLIT_RATIO;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return normalizeRatio(value);
}

export function getReaderPaneNotesRatio(documentRatio: number) {
  return roundRatio(1 - documentRatio);
}

export function getReaderPaneSplitRatioFromPointer(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  splitterWidth = READER_PANE_SPLITTER_LINE_WIDTH_PX
) {
  const usableWidth = getReaderPaneUsableWidth(containerWidth, splitterWidth);
  if (usableWidth <= 0) {
    return DEFAULT_READER_PANE_SPLIT_RATIO;
  }

  return roundRatio(clampValue(clientX - containerLeft, 0, usableWidth) / usableWidth);
}

export function nudgeReaderPaneSplitRatio(
  currentRatio: number,
  direction: "left" | "right",
  containerWidth: number
) {
  const delta =
    direction === "left" ? -READER_PANE_SPLIT_KEYBOARD_STEP : READER_PANE_SPLIT_KEYBOARD_STEP;
  return clampReaderPaneSplitRatio(currentRatio + delta, containerWidth);
}
