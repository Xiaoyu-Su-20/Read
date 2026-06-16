const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.5;
const WHEEL_ZOOM_FACTOR = 1.04;
const KEYBOARD_ZOOM_FACTOR = 1.06;

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

export function resolveSurfaceScale(displayZoom: number, renderZoom: number) {
  if (!Number.isFinite(displayZoom) || !Number.isFinite(renderZoom) || renderZoom <= 0) {
    return 1;
  }

  return Number((displayZoom / renderZoom).toFixed(4));
}
