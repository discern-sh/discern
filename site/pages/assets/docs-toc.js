/** Pick the heading that owns the reader's current scroll position. */
export function activeTocIndex({
  headingTops,
  scrollY,
  viewportHeight,
  documentHeight,
  headerOffset,
  pinnedIndex = -1,
}) {
  if (headingTops.length === 0) return -1;
  if (
    Number.isInteger(pinnedIndex) && pinnedIndex >= 0 &&
    pinnedIndex < headingTops.length
  ) {
    return pinnedIndex;
  }

  const maxScroll = Math.max(0, documentHeight - viewportHeight);
  const clampedScroll = Math.min(Math.max(0, scrollY), maxScroll);
  const remainingScroll = Math.max(0, maxScroll - clampedScroll);
  const readableViewport = Math.max(0, viewportHeight - headerOffset);
  const tailLookahead = Math.max(0, readableViewport - remainingScroll);
  const marker = Math.min(
    documentHeight,
    clampedScroll + headerOffset + tailLookahead,
  );
  let active = 0;
  for (const [index, top] of headingTops.entries()) {
    if (top > marker) break;
    active = index;
  }
  return active;
}
