/** Render prose as a line-preserving CommonMark blockquote. Unlike a code
 * fence, the projected text remains visible to prose tooling. */
export function markdownBlockquote(value: string): string {
  return value.split(/\r?\n/).map((line) => line === "" ? ">" : `> ${line}`)
    .join("\n");
}
