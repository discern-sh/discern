/**
 * The Claude Code worktree-hook adapter — a FEATURE-layer module (like
 * `./skills.ts`, which owns the `.claude/skills` materialization). It is the ONE
 * place coupled to Claude Code's `WorktreeCreate` / `WorktreeRemove` hook
 * contract: the JSON payload it pushes on stdin (`{name, cwd}` /
 * `{worktree_path}`) and the worktree path it reads back on stdout. WHERE the
 * worktree is placed is not decided here — the shared `resolveWorktreeRoot`
 * resolver (`./paths.ts`) computes it from `[worktree].root` (a sibling of the
 * repo by default; ADR 0052). This adapter lives here, NOT in the stack-neutral
 * engine (`src/engine/**`, which builds no agent-specific path and discovers
 * worktree locations from git's own registry — see the agent-agnosticism guard
 * in `tests/agent_agnostic_test.ts`).
 *
 * Each verb is a thin `discern worktree:create` / `discern worktree:remove`: the
 * binary — already invoked by the hook, and already a JSON-native program —
 * parses the `{name, cwd}` / `{worktree_path}` payload from its own stdin and
 * runs the git plumbing itself. Keeping that logic in the binary rather than in
 * `.claude/settings.json` keeps `jq` off the end user's dependency list and puts
 * the worktree lifecycle under the engine's tests (see ADR 0040).
 *
 * Stream discipline: all setup narration goes to stderr (the logger's
 * `humanStream`), and `create` writes ONLY the worktree path to stdout, with no
 * trailing newline, because Claude Code reads that path as the hook's result.
 */

import { join } from "@std/path";
import { Logger } from "./log.ts";
import { resolveWorktreeRoot } from "./paths.ts";
import { loadConfig } from "../shared/config_schema.ts";
import {
  createAndSetupWorktree,
  lifecycleContext,
  worktreeTeardown,
} from "../engine/worktree/lifecycle.ts";
import { WorktreeGitError } from "../engine/worktree/git.ts";

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
 * `<resolveWorktreeRoot(cwd, config)>/<name>` (a sibling of the repo by default —
 * `[worktree].root` overrides) on branch `<branch_prefix><name>`, runs the
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

  // The config is the MAIN checkout's — the worktree it will spawn does not exist
  // yet. It supplies both the placement root (`[worktree].root`, via the shared
  // resolver) and the branch name (`<branch_prefix><name>`).
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(cwd);
  } catch (e) {
    log.error(
      `Could not read discern.toml under ${cwd}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }
  const dir = join(resolveWorktreeRoot(cwd, config), name);
  try {
    const branch = `${config.project.branch_prefix}${name}`;
    // The shared create-then-setup core (also used by `discern start`); WHERE the
    // worktree lands is decided above by `resolveWorktreeRoot`, not in the engine.
    await createAndSetupWorktree(cwd, dir, branch, log);
  } catch (e) {
    if (e instanceof WorktreeGitError) {
      log.error(e.message);
      return 1;
    }
    throw e;
  }

  // Claude Code reads the worktree path from stdout — only this, with no trailing
  // newline.
  await Deno.stdout.write(new TextEncoder().encode(dir));
  return 0;
}

/**
 * `discern worktree:remove` — the `WorktreeRemove` hook entry point. Reads
 * `{worktree_path}` from stdin and tears down that worktree's resources.
 * Best-effort: a teardown problem (or a worktree already gone) never fails the
 * event, so it always returns 0.
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
