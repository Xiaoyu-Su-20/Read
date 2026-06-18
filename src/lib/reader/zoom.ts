import type { ReaderFitMode } from "../types";

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const WHEEL_ZOOM_FACTOR = 1.02;
const KEYBOARD_ZOOM_FACTOR = 1.03;
const AUTO_MAXIMIZE_VERTICAL_MARGIN_PX = 0;
export const AUTO_MAXIMIZE_HORIZONTAL_MARGIN_PX = 12;
const AUTO_MAXIMIZE_ZOOM_EPSILON = 0.01;

export type ResolvedReaderFitMode = Exclude<ReaderFitMode, "width">;

export function clampZoom(zoom: number) {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

export function normalizeZoom(zoom: number) {
  return Number(clampZoom(zoom).toFixed(2));
}

export function scaleZoomByWheelDelta(currentZoom: number, delta: number) {
  if (delta === 0) {
    return normalizeZoom(currentZoom);
  }

  const directionFactor = delta < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
  return normalizeZoom(currentZoom * directionFactor);
}

export function scaleZoomByKeyboardDirection(currentZoom: number, direction: "in" | "out") {
  const directionFactor = direction === "in" ? KEYBOARD_ZOOM_FACTOR : 1 / KEYBOARD_ZOOM_FACTOR;
  return normalizeZoom(currentZoom * directionFactor);
}

export function normalizeReaderFitMode(fitMode: unknown): ResolvedReaderFitMode {
  if (fitMode === "free") {
    return "free";
  }

  return "auto-maximize";
}

export function shouldAutoFitReaderPage(fitMode: unknown) {
  return normalizeReaderFitMode(fitMode) !== "free";
}

export function resolveAutoMaximizeZoom(
  viewportWidth: number,
  viewportHeight: number,
  pageWidth: number,
  pageHeight: number
) {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    return null;
  }

  const availableWidth = Math.max(viewportWidth - AUTO_MAXIMIZE_HORIZONTAL_MARGIN_PX * 2, 1);
  const availableHeight = Math.max(viewportHeight - AUTO_MAXIMIZE_VERTICAL_MARGIN_PX * 2, 1);
  const widthFitZoom = availableWidth / pageWidth;
  const heightFitZoom = availableHeight / pageHeight;

  return normalizeZoom(Math.min(widthFitZoom, heightFitZoom));
}

export function hasMeaningfulZoomDelta(nextZoom: number, previousZoom: number | null | undefined) {
  if (typeof previousZoom !== "number" || !Number.isFinite(previousZoom)) {
    return true;
  }

  return Math.abs(nextZoom - previousZoom) >= AUTO_MAXIMIZE_ZOOM_EPSILON;
}

export function resolveSurfaceScale(displayZoom: number, renderZoom: number) {
  if (!Number.isFinite(displayZoom) || !Number.isFinite(renderZoom) || renderZoom <= 0) {
    return 1;
  }

  return Number((displayZoom / renderZoom).toFixed(4));
}
