export type DropPosition = "before" | "after";
export type VerticalDropLayout = {
  id: string;
  top: number;
  bottom: number;
};

export function moveIdWithinOrder(
  ids: string[],
  draggedId: string,
  targetId: string,
  position: DropPosition
) {
  if (draggedId === targetId) {
    return ids;
  }

  const nextIds = ids.filter((id) => id !== draggedId);
  const targetIndex = nextIds.indexOf(targetId);
  if (targetIndex === -1) {
    return ids;
  }

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  nextIds.splice(insertIndex, 0, draggedId);
  return nextIds;
}

export function filterPdfPaths(paths: string[]) {
  return paths.filter((path) => path.toLowerCase().endsWith(".pdf"));
}

export function resolveVerticalDropTarget(
  layouts: VerticalDropLayout[],
  clientY: number
): { targetId: string; position: DropPosition } | null {
  if (layouts.length === 0) {
    return null;
  }

  for (const layout of layouts) {
    const centerY = (layout.top + layout.bottom) / 2;
    if (clientY < centerY) {
      return {
        targetId: layout.id,
        position: "before"
      };
    }
  }

  return {
    targetId: layouts[layouts.length - 1].id,
    position: "after"
  };
}
