export type DropEdge = "top" | "bottom";

export function getClosestVerticalEdge(
  rect: Pick<DOMRect, "top" | "height">,
  clientY: number
): DropEdge {
  return clientY < rect.top + rect.height / 2 ? "top" : "bottom";
}

export function getReorderFinishIndex({
  startIndex,
  targetIndex,
  edge,
}: {
  startIndex: number;
  targetIndex: number;
  edge: DropEdge;
}): number {
  if (startIndex < 0 || targetIndex < 0 || startIndex === targetIndex) {
    return startIndex;
  }
  if (startIndex < targetIndex) {
    return edge === "top" ? targetIndex - 1 : targetIndex;
  }
  return edge === "top" ? targetIndex : targetIndex + 1;
}

export function moveOrderItem(
  order: readonly string[],
  startIndex: number,
  finishIndex: number
): string[] {
  if (
    startIndex < 0 ||
    finishIndex < 0 ||
    startIndex >= order.length ||
    finishIndex >= order.length ||
    startIndex === finishIndex
  ) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(startIndex, 1);
  next.splice(finishIndex, 0, moved);
  return next;
}

export function reorderWebsiteOrder(
  order: readonly string[],
  sourceId: string,
  targetId: string,
  edge: DropEdge
): string[] {
  const startIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  const finishIndex = getReorderFinishIndex({ startIndex, targetIndex, edge });
  return moveOrderItem(order, startIndex, finishIndex);
}
