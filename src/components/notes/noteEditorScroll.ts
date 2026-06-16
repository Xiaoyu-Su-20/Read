export function computeCenteredChildScrollTop({
  childHeight,
  childTop,
  containerHeight,
  scrollHeight
}: {
  childHeight: number;
  childTop: number;
  containerHeight: number;
  scrollHeight: number;
}) {
  const maxScrollTop = Math.max(scrollHeight - containerHeight, 0);
  const centeredScrollTop = childTop - (containerHeight - childHeight) / 2;
  return Math.min(Math.max(centeredScrollTop, 0), maxScrollTop);
}
