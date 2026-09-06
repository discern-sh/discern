/** Render observed checkout changes without attributing writes to concurrent commands. */
import { parsePorcelainZ } from "./git_paths.ts";

/** Preserve literal names, including rename origins, in a bounded actionable diagnostic. */
export function checkoutChangesMessage(status: string): string {
  const paths = [
    ...new Set(
      parsePorcelainZ(status).flatMap((entry) =>
        entry.origPath === undefined
          ? [entry.path]
          : [entry.origPath, entry.path]
      ),
    ),
  ].sort();
  const shown = paths.slice(0, 10).map((path) => JSON.stringify(path)).join(
    ", ",
  );
  const more = paths.length > 10 ? ` (+${paths.length - 10} more)` : "";
  return `Unexpected checkout changes: ${shown}${more}. ` +
    "Run `git status --short` to inspect them. Preserve intended source edits; " +
    "put build scratch in a narrowly ignored output location. Prepare and commit " +
    "the intended tree before retrying validation.";
}
