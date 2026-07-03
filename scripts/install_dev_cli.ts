/**
 * Install (or refresh) the local-development `discern` wrapper onto PATH.
 *
 * The wrapper (`scripts/discern`) runs the engine from whichever checkout you are
 * inside — a worktree runs its own in-progress engine — falling back elsewhere to
 * $DISCERN_HOME, then to the main checkout baked in here. This script writes it
 * next to the `discern` already on PATH (or `~/.local/bin`), so the installed
 * copy survives worktree churn, and stamps that main-checkout path into the copy
 * so the installed shim resolves the engine even with no $DISCERN_HOME in the
 * environment (a GUI-launched agent's hooks, cron, CI). $DISCERN_HOME still
 * overrides when set.
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

import { fromFileUrl } from "@std/path";
import {
  renderShim,
  resolveBakedCheckout,
  resolveCliDest,
  writeExecutable,
} from "./cli_install.ts";

async function main(): Promise<number> {
  const repoRoot = fromFileUrl(new URL("..", import.meta.url));
  const bakedCheckout = await resolveBakedCheckout(repoRoot);

  const { dest, targetDir, onPath } = await resolveCliDest();
  try {
    await writeExecutable(renderShim(bakedCheckout), dest);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`install-dev-cli: could not write ${dest}: ${reason}`);
    return 1;
  }
  console.error(`installed: ${dest}`);
  console.error(`  baked-in fallback checkout: ${bakedCheckout}`);
  console.error(
    "  → resolves the engine from any project with no DISCERN_HOME needed.",
  );
  console.error("");
  console.error(
    `Optional: export DISCERN_HOME=<path> to override the baked-in checkout.`,
  );

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
