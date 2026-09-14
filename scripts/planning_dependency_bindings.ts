/** Durable source and predecessor selectors accepted in active programme briefs. */

/** Remove only complete durable selectors before checking transient claims. */
export function transientStateText(line: string): string {
  return line.replace(
    /^\*\*Dependency binding:\*\* worktree `([a-z0-9][a-z0-9-]*-[0-9a-f]{6})`, full branch `agent\/\1`\. Required readiness: \*\*\d+[A-Z] landed\*\*\.$/u,
    "",
  ).replace(
    /^\*\*Design-system worktree:\*\* `([a-z0-9][a-z0-9-]*-[0-9a-f]{6})`, full branch `agent\/\1`\. Retain through 4A\.$/u,
    "",
  );
}
