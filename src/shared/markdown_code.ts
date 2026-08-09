/** Render arbitrary text as a valid CommonMark code span. */
export function markdownCodeSpan(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const fenceLength = Math.max(1, ...runs.map((run) => run.length + 1));
  const fence = "`".repeat(fenceLength);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

/** Render prose as a line-preserving CommonMark blockquote. Unlike a code
 * fence, the projected text remains visible to prose tooling. */
export function markdownBlockquote(value: string): string {
  return value.split(/\r?\n/).map((line) => line === "" ? ">" : `> ${line}`)
    .join("\n");
}
