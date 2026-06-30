/**
 * Install (or refresh) the local-development `discern` wrapper onto PATH.
 *
 * The wrapper (`scripts/discern`) runs the engine from whichever checkout you are
 * inside — a worktree runs its own in-progress engine — falling back to
 * $DISCERN_HOME elsewhere. This script copies it next to the `discern` already on
 * PATH (or `~/.local/bin`), so the installed copy survives worktree churn, and
 * prints the $DISCERN_HOME to export for the out-of-checkout fallback.
 *
 * Its inverse is `use-compiled-build`, which temporarily runs the real
 * compiled binary instead; this is the command that puts the dev shim back.
 *
 * It is a MAINTAINER helper, not a shipped feature: it lives in `scripts/`
 * (outside `templates/`), is never bundled into the binary, and is deliberately
 * kept OUT of discern's own `setup`/`upgrade` verbs — those are user-facing.
 *
 * Usage:
 *   deno task install-dev-cli
 */

import { dirname, fromFileUrl } from "@std/path";
import {
  capture,
  installExecutable,
  resolveCliDest,
  shimSource,
} from "./cli_install.ts";

async function main(): Promise<number> {
  const repoRoot = fromFileUrl(new URL("..", import.meta.url));

  // The durable fallback checkout: the *main* working tree, found via the shared
  // git dir so it resolves to main even when this runs from a linked worktree.
  const common = await capture(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    repoRoot,
  );
  const discernHome = common.code === 0 && common.stdout.length > 0
    ? dirname(common.stdout)
    : repoRoot;

  const { dest, targetDir, onPath } = await resolveCliDest();
  try {
    await installExecutable(shimSource(), dest);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`install-dev-cli: could not write ${dest}: ${reason}`);
    return 1;
  }
  console.error(`installed: ${dest}`);

  console.error("");
  console.error(
    "For the out-of-checkout fallback (running discern against other projects),",
  );
  console.error("export this in your shell profile:");
  console.error(`    export DISCERN_HOME=${discernHome}`);

  if (!onPath) {
    console.error("");
    console.error(
      `Note: ${targetDir} is not on your PATH — add it to use \`discern\`.`,
    );
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
