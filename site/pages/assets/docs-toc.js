/**
 * Pick the heading that owns the reader's current scroll position. Reaching
 * the document bottom always reaches the final heading, even when the final
 * section is too short to cross the header marker by itself.
 */
export function activeTocIndex({
  headingTops,
  scrollY,
  viewportHeight,
  documentHeight,
  headerOffset,
}) {
  if (headingTops.length === 0) return -1;
  if (scrollY + viewportHeight >= documentHeight - 1) {
    return headingTops.length - 1;
  }

  const marker = scrollY + headerOffset;
  let active = 0;
  for (const [index, top] of headingTops.entries()) {
    if (top > marker) break;
    active = index;
  }
  return active;
}
