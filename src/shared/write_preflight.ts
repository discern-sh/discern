/**
 * Tiny, effect-representative probes for writes Discern itself plans to perform
 * after potentially slow project commands.
 *
 * Permission metadata is not authoritative under sandboxes: `access(W_OK)` can
 * say yes while the actual open/create is denied. These probes therefore perform
 * the smallest real operation of the same class, clean it up immediately, and
 * return a structured failure instead of throwing.
 */

import type { Diagnostic } from "./result.ts";

/** One predictable write surface a workflow will need later. */
export type PlannedWriteTarget =
  | {
    /** Create, write, rename, and remove a temporary entry in this directory. */
    kind: "directory-entry";
    path: string;
    description: string;
  }
  | {
    /** Open this existing file for writing without changing its contents. */
    kind: "existing-file";
    path: string;
    description: string;
  };

/** A real write probe could not exercise one planned target. */
export interface WritePreflightFailure {
  ok: false;
  path: string;
  description: string;
  reason: string;
}

/** Every planned target accepted its representative write. */
export interface WritePreflightSuccess {
  ok: true;
}

export type WritePreflightResult =
  | WritePreflightSuccess
  | WritePreflightFailure;

/** Preserve an Error's message and stringify non-Error probe failures. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Best-effort cleanup for a probe path that may never have been created. */
async function removeProbe(path: string | undefined): Promise<void> {
  if (path === undefined) {
    return;
  }
  await Deno.remove(path).catch(() => {});
}

/** Exercise the directory operations used by Git-admin marker writes and Git's
 * own lock/rename protocol. The random, hidden entry is never a real marker. */
async function probeDirectoryEntry(
  target: Extract<PlannedWriteTarget, { kind: "directory-entry" }>,
): Promise<WritePreflightResult> {
  let created: string | undefined;
  let renamed: string | undefined;
  try {
    created = await Deno.makeTempFile({
      dir: target.path,
      prefix: ".discern-write-probe-",
    });
    await Deno.writeTextFile(created, "discern write probe\n");
    renamed = `${created}.renamed`;
    await Deno.rename(created, renamed);
    created = undefined;
    await Deno.remove(renamed);
    renamed = undefined;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      path: target.path,
      description: target.description,
      reason: errorText(error),
    };
  } finally {
    await removeProbe(created);
    await removeProbe(renamed);
  }
}

/** Opening without `create` or `truncate` changes no bytes or timestamps, while
 * still asking the OS/sandbox the exact question a later direct rewrite asks. */
async function probeExistingFile(
  target: Extract<PlannedWriteTarget, { kind: "existing-file" }>,
): Promise<WritePreflightResult> {
  try {
    const file = await Deno.open(target.path, { write: true });
    file.close();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      path: target.path,
      description: target.description,
      reason: errorText(error),
    };
  }
}

/** Probe each distinct target in order and stop at the first denial. */
export async function preflightPlannedWrites(
  targets: readonly PlannedWriteTarget[],
): Promise<WritePreflightResult> {
  const seen = new Set<string>();
  for (const target of targets) {
    const identity = `${target.kind}\0${target.path}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const result = target.kind === "directory-entry"
      ? await probeDirectoryEntry(target)
      : await probeExistingFile(target);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

/** One provider-neutral explanation shared by CLI, JSON, and MCP surfaces. */
export function writePreflightFailureMessage(
  failure: WritePreflightFailure,
): string {
  return `Discern cannot write ${failure.description} at ${failure.path}: ${failure.reason}. Grant this command write access to that path, then retry.`;
}

/** Tier-0 diagnostic for a built-in write-authority denial. */
export function writePreflightDiagnostic(
  failure: WritePreflightFailure,
  reproduceCmd: string,
): Diagnostic {
  return {
    tool: "write-access",
    severity: "error",
    message: writePreflightFailureMessage(failure),
    reproduce_cmd: reproduceCmd,
  };
}
