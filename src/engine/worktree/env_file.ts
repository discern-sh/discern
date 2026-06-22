/**
 * The one place the worktree lifecycle writes a `DISCERN_*` line into a
 * worktree's `.env`. The deterministic port and the per-worktree resource handles
 * are both recorded here so a project's OWN tooling — its gate, its scripts,
 * running later in a separate process — can discover this worktree's identity at
 * runtime by reading `.env` (the `discern worktree-name --port|--resource` query
 * is the always-available second channel).
 *
 * Extracted so the port write (`recordPort`) and the resource writes share ONE
 * upsert idiom — replace the first `KEY=` line if present, else append respecting
 * the file's trailing-newline convention. `.env` is never CREATED here: a project
 * without one discovers identity via `worktree-name` instead (matching the port's
 * long-standing behaviour).
 */

import { join } from "@std/path";

/**
 * Upsert `KEY=value` into `.env` text: replace the first existing `KEY=` line
 * (value only), else append. Appending mirrors the shell `printf … >> .env`:
 * when the text ends with a newline (or is empty) the new line slots before the
 * trailing blank so the file keeps exactly one terminating newline; otherwise it
 * is pushed onto the unterminated last line. Pure — the caller owns the I/O.
 */
export function upsertEnvLine(
  envText: string,
  key: string,
  value: string,
): string {
  const prefix = `${key}=`;
  const lines = envText.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && line.startsWith(prefix)) {
      replaced = true;
      return `${prefix}${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (envText.endsWith("\n") || envText === "") {
      next.splice(
        next.length - (envText.endsWith("\n") ? 1 : 0),
        0,
        `${prefix}${value}`,
      );
    } else {
      next.push(`${prefix}${value}`);
    }
  }
  return next.join("\n");
}

/** Read a worktree's `.env`, or undefined when it has none. */
export async function readEnvFile(
  worktreeRoot: string,
): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(join(worktreeRoot, ".env"));
  } catch {
    return undefined;
  }
}

/**
 * Upsert `KEY=value` into the worktree's `.env`, writing it back. Returns true
 * when written, false when the worktree has no `.env` (in which case nothing is
 * created — the value stays discoverable via `discern worktree-name`). The caller
 * decides what to log.
 */
export async function writeEnvVar(
  worktreeRoot: string,
  key: string,
  value: string,
): Promise<boolean> {
  const text = await readEnvFile(worktreeRoot);
  if (text === undefined) {
    return false;
  }
  await Deno.writeTextFile(
    join(worktreeRoot, ".env"),
    upsertEnvLine(text, key, value),
  );
  return true;
}
