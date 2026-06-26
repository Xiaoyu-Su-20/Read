export function computeTopAlignedChildScrollTop({
  childTop,
  containerHeight,
  topOffset,
  scrollHeight
}: {
  childTop: number;
  containerHeight: number;
  topOffset: number;
  scrollHeight: number;
}) {
  const maxScrollTop = Math.max(scrollHeight - containerHeight, 0);
  const topAlignedScrollTop = childTop - topOffset;
  return Math.min(Math.max(topAlignedScrollTop, 0), maxScrollTop);
}
