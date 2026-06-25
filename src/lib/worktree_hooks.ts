/**
 * The Claude Code worktree-hook adapter — a FEATURE-layer module (like
 * `./skills.ts`, which owns the `.claude/skills` materialization). It is the ONE
 * place coupled to Claude Code's `WorktreeCreate` / `WorktreeRemove` hook
 * contract: the JSON payload it pushes on stdin (`{name, cwd}` /
 * `{worktree_path}`) and the `.claude/worktrees/` directory convention. It lives
 * here, NOT in the stack-neutral engine (`src/engine/**`, which builds no
 * `.claude` path and discovers worktree locations from git's own registry — see
 * the agent-agnosticism guard in `tests/agent_agnostic_test.ts`).
 *
 * These verbs replace the old jq + git shell one-liners that lived inside
 * `.claude/settings.json`: instead of the hook parsing the payload with `jq` and
 * running `git worktree add` itself, the hook is now a thin `discern
 * worktree:create` / `discern worktree:remove`, and the binary — already invoked
 * by the hook, and already a JSON-native program — reads its own stdin. That
 * removes `jq` as an end-user dependency and moves the logic into the tested
 * engine (see ADR 0040).
 *
 * Stream discipline mirrors the old hook's `… 1>&2; printf %s "$dir"`: all setup
 * narration goes to stderr (the logger's `humanStream`), and `create` writes ONLY
 * the worktree path to stdout, with no trailing newline, because Claude Code reads
 * that path as the hook's result.
 */

import { join } from "@std/path";
import { Logger } from "./log.ts";
import { loadConfig } from "../shared/config_schema.ts";
import {
  lifecycleContext,
  worktreeSetup,
  worktreeTeardown,
} from "../engine/worktree/lifecycle.ts";
import { addWorktree, WorktreeGitError } from "../engine/worktree/git.ts";

/**
 * The directory, relative to the project root, under which Claude Code worktrees
 * are materialized. This is Claude Code's own convention (`name` + this base →
 * the worktree path the hook returns); it lives here, in the Claude-Code adapter,
 * and nowhere in the agent-agnostic git layer.
 */
const CLAUDE_WORKTREES_SUBDIR = ".claude/worktrees";

/** A logger whose human output is on stderr, so stdout stays the hook's result. */
function hookLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stderr" });
}

/** Read all of stdin and parse it as a JSON object. `{}` when stdin is empty. */
async function readJsonStdin(): Promise<Record<string, unknown>> {
  const raw = (await new Response(Deno.stdin.readable).text()).trim();
  if (raw === "") {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("hook payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** A non-empty string field from the payload, or undefined when absent/blank. */
function stringField(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * `discern worktree:create` — the `WorktreeCreate` hook entry point. Reads
 * `{name, cwd}` from stdin, creates a linked worktree at
 * `<cwd>/.claude/worktrees/<name>` on branch `<branch_prefix><name>`, runs the
 * per-worktree setup inside it, and prints the worktree's path on stdout for
 * Claude Code to read. Idempotent end to end — a re-fired hook leaves an existing
 * worktree in place and re-readies it (resources via `ensure`, setup steps
 * skipped) rather than re-creating anything. Returns a process exit code.
 */
export async function worktreeCreateHook(): Promise<number> {
  const log = hookLogger();
  if (Deno.stdin.isTerminal()) {
    log.error(
      "discern worktree:create reads a Claude Code WorktreeCreate JSON payload ({name, cwd}) on stdin.",
    );
    return 1;
  }
  let payload: Record<string, unknown>;
  try {
    payload = await readJsonStdin();
  } catch (e) {
    log.error(
      `Could not parse the WorktreeCreate payload: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }

  const name = stringField(payload, "name");
  const cwd = stringField(payload, "cwd");
  if (name === undefined || cwd === undefined) {
    log.error(
      "WorktreeCreate payload is missing a string `name` and/or `cwd`.",
    );
    return 1;
  }

  const dir = join(cwd, CLAUDE_WORKTREES_SUBDIR, name);
  try {
    // The branch name is read from the MAIN checkout's config — the worktree it
    // names does not exist yet. (`<branch_prefix><name>`, matching the old hook.)
    const config = await loadConfig(cwd);
    const branch = `${config.project.branch_prefix}${name}`;
    await addWorktree(cwd, dir, branch);

    // Run setup with the new worktree as BOTH root and cwd — exactly what the old
    // `cd "$dir" && discern worktree` resolved (a linked worktree is its own
    // checkout, with its own discern.toml and gitignored .claude/skills to build).
    await worktreeSetup(await lifecycleContext(dir, log, dir));
  } catch (e) {
    if (e instanceof WorktreeGitError) {
      log.error(e.message);
      return 1;
    }
    throw e;
  }

  // Claude Code reads the worktree path from stdout — only this, no newline (the
  // old hook ended in `printf %s "$dir"`).
  await Deno.stdout.write(new TextEncoder().encode(dir));
  return 0;
}

/**
 * `discern worktree:remove` — the `WorktreeRemove` hook entry point. Reads
 * `{worktree_path}` from stdin and tears down that worktree's resources.
 * Best-effort: like the old hook's trailing `|| true`, a teardown problem (or a
 * worktree already gone) never fails the event, so it always returns 0.
 */
export async function worktreeRemoveHook(): Promise<number> {
  const log = hookLogger();
  try {
    if (Deno.stdin.isTerminal()) {
      log.warn(
        "discern worktree:remove reads a Claude Code WorktreeRemove JSON payload ({worktree_path}) on stdin — nothing to do.",
      );
      return 0;
    }
    const payload = await readJsonStdin();
    const worktreePath = stringField(payload, "worktree_path");
    if (worktreePath === undefined) {
      log.warn(
        "WorktreeRemove payload has no `worktree_path` — nothing to do.",
      );
      return 0;
    }
    await worktreeTeardown(
      await lifecycleContext(worktreePath, log, worktreePath),
    );
  } catch (e) {
    // Never fail the remove event — a stranded resource is reclaimed later by
    // `discern worktree:prune`. Narrate the reason to stderr and move on.
    log.warn(
      `worktree:remove teardown did not complete: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  return 0;
}
