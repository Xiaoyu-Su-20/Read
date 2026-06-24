export type PanePoint = {
  x: number;
  y: number;
};

export type PaneSize = {
  width: number;
  height: number;
};

export type MenuSize = {
  width: number;
  height: number;
};

export type SubmenuDirection = "right" | "left";
export type SubmenuPlacement = {
  direction: SubmenuDirection;
  offsetY: number;
};

const MENU_PADDING = 8;
const SUBMENU_OVERLAP = 4;

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function toPanePoint(clientX: number, clientY: number, pane: HTMLElement): PanePoint {
  const rect = pane.getBoundingClientRect();

  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

export function placeMenu(anchor: PanePoint, paneSize: PaneSize, menuSize: MenuSize): PanePoint {
  return {
    x: clamp(anchor.x, MENU_PADDING, paneSize.width - menuSize.width - MENU_PADDING),
    y: clamp(anchor.y, MENU_PADDING, paneSize.height - menuSize.height - MENU_PADDING)
  };
}

export function getSubmenuDirection(
  menuPosition: PanePoint,
  paneSize: PaneSize,
  menuSize: MenuSize,
  submenuWidth: number
): SubmenuDirection {
  const fitsRight =
    menuPosition.x + menuSize.width + submenuWidth - SUBMENU_OVERLAP <= paneSize.width - MENU_PADDING;
  const fitsLeft = menuPosition.x - submenuWidth + SUBMENU_OVERLAP >= MENU_PADDING;

  return fitsRight || !fitsLeft ? "right" : "left";
}

export function getSubmenuPlacement(
  triggerRect: DOMRect,
  paneRect: DOMRect,
  submenuSize: MenuSize
): SubmenuPlacement {
  const fitsRight =
    triggerRect.right + submenuSize.width - SUBMENU_OVERLAP <=
    paneRect.right - MENU_PADDING;

  const fitsLeft =
    triggerRect.left - submenuSize.width + SUBMENU_OVERLAP >=
    paneRect.left + MENU_PADDING;

  const direction = fitsRight || !fitsLeft ? "right" : "left";
  const desiredTop = triggerRect.top;
  const maximumTop = paneRect.bottom - submenuSize.height - MENU_PADDING;
  const clampedTop = clamp(desiredTop, paneRect.top + MENU_PADDING, maximumTop);

  return {
    direction,
    offsetY: clampedTop - triggerRect.top
  };
}
