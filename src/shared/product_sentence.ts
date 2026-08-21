/**
 * Finish one single-line, product-authored sentence.
 *
 * Opaque atoms and blocks are outside sentence composition: code spans, paths,
 * versions, raw multi-line output, and Markdown blocks keep their bytes. Callers
 * must likewise keep quoted subprocess output and project-authored payloads out
 * of this boundary.
 */
export function productSentence(value: string): string {
  const trimmed = value.trim();
  if (
    value.includes("\n") ||
    /^`+[^\n]*`+$/u.test(trimmed) ||
    /^v?\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/u.test(trimmed) ||
    /^\S+\.\.\.?\S+$/u.test(trimmed) ||
    (/^\S+$/u.test(trimmed) && /[\\/]/u.test(trimmed)) ||
    /^(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|```|~~~|\|.*\|$)/u.test(trimmed)
  ) {
    return value;
  }
  if (trimmed === "" || /[.?!]$/u.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}
