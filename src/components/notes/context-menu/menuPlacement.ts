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
