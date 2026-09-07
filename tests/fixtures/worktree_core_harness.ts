/**
 * Test-only process boundary for worktree cores that production lifecycle
 * commands call directly. Keeping this outside the CLI proves their process
 * and race behavior without reviving the retired helper-command surface.
 */

import { Logger } from "../../src/lib/log.ts";
import { loadConfig } from "../../src/shared/config_schema.ts";
import { findRoot } from "../../src/shared/env.ts";
import {
  loadIdentitySettings,
  resolveIdentity,
  resolveWorktreeId,
} from "../../src/engine/worktree/identity.ts";
import {
  inheritMainEnvVars,
  removeWorktreeSafely,
  WorktreeGitError,
} from "../../src/engine/worktree/git.ts";

/** Run one test-only worktree core and return its process exit status. */
async function run(): Promise<number> {
  const [operation, target, retired] = Deno.args;
  const log = new Logger({ json: false, noColor: true });
  try {
    switch (operation) {
      case "identity-after-retirement": {
        if (target === undefined || retired === undefined) {
          throw new TypeError(
            "identity-after-retirement requires target and retired paths",
          );
        }
        await Deno.remove(retired, { recursive: true });
        const settings = await loadIdentitySettings(target);
        const ids = [
          await resolveWorktreeId(settings, target),
          (await resolveIdentity(target, target)).id,
        ];
        console.log(JSON.stringify(ids));
        return 0;
      }
      case "remove":
        if (target === undefined) {
          throw new TypeError("remove requires a target path");
        }
        await removeWorktreeSafely(target, Deno.cwd());
        return 0;
      case "inherit": {
        const root = await findRoot();
        if (root === undefined) {
          throw new TypeError("inherit requires a discern project");
        }
        const config = await loadConfig(root);
        await inheritMainEnvVars({
          worktreeRoot: root,
          vars: config.worktree.inherit_env,
          files: config.worktree.env_files,
          log,
        });
        return 0;
      }
      default:
        throw new TypeError(`unknown worktree core operation: ${operation}`);
    }
  } catch (error) {
    if (error instanceof WorktreeGitError) {
      log.error(error.message);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  Deno.exit(await run());
}
