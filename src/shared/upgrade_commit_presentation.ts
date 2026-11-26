/** Renderer-neutral sentence for what an applied upgrade did with its changes in Git. */

import { code, plural, strings, text } from "./result_markdown_values.ts";

/**
 * One sentence on the upgrade's commit outcome, shared by the terminal summary
 * and the Markdown result. An upgrade that changed nothing has no sentence.
 */
export function upgradeCommitSentence(
  commit: Record<string, unknown> | undefined,
): string | undefined {
  const reason = text(commit?.reason) ?? "";
  switch (text(commit?.state)) {
    case "committed":
      return `Committed the upgrade as ${
        code(text(commit?.head)?.slice(0, 12))
      } (${plural(strings(commit?.paths).length, "file")}).`;
    case "uncommitted":
      return `Left the upgrade uncommitted: ${reason}`;
    case "failed":
      return `Could not commit the upgrade: ${reason}`;
    default:
      return undefined;
  }
}
