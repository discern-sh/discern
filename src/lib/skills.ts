/**
 * Materialize the bundled skills into a project's `.icculus/skills/`.
 *
 * Skills are the binary's artifact (bundled via `deno compile --include
 * templates`), not committed by the user — `.icculus/skills/` is gitignored and
 * re-published. `init`/`upgrade` materialize it for the main checkout; a linked
 * git worktree does NOT inherit a gitignored directory on checkout, so worktree
 * setup materializes it too. Always overwritten so a removed skill does not
 * linger.
 */

import { join } from "@std/path";
import { copy } from "@std/fs";
import { resolveTemplatesDir } from "./paths.ts";

/**
 * Copy the bundled skill directories into `<root>/.icculus/skills/`, replacing
 * any existing copy. Returns the number of skills materialized (0 when none are
 * bundled).
 */
export async function materializeSkills(root: string): Promise<number> {
  const src = join(await resolveTemplatesDir(), ".icculus", "skills");
  const dest = join(root, ".icculus", "skills");

  const skills: string[] = [];
  try {
    for await (const entry of Deno.readDir(src)) {
      if (entry.isDirectory) {
        skills.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return 0; // no bundled skills
    }
    throw error;
  }

  for (const skill of skills) {
    const target = join(dest, skill);
    try {
      await Deno.remove(target, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    await copy(join(src, skill), target);
  }
  return skills.length;
}
