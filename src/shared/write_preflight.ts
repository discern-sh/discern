/**
 * Tiny, effect-representative probes for writes discern itself plans to perform.
 * The shared operation boundary uses broad Git-admin targets; Gate, setup, and
 * lifecycle plans add exact targets before slow work or partial effects.
 *
 * Permission metadata is not authoritative under sandboxes: `access(W_OK)` can
 * say yes while the actual open/create is denied. These probes therefore perform
 * the smallest real operation of the same class, clean it up immediately, and
 * return a structured failure instead of throwing.
 */

import { dirname, join } from "@std/path";
import type { Diagnostic, DiscernResult } from "./result.ts";
import { bestEffort } from "./best_effort.ts";
import { type SecureEntropy, SYSTEM_SECURE_ENTROPY } from "./entropy.ts";

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
  }
  | {
    /** Create a representative directory tree without materializing this path. */
    kind: "directory-tree";
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
  await bestEffort("write-preflight-probe-remove", async () => {
    await Deno.remove(path);
  });
}

/** Best-effort recursive cleanup for a temporary probe directory. */
async function removeProbeTree(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  await bestEffort("write-preflight-tree-remove", async () => {
    await Deno.remove(path, { recursive: true });
  });
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

/** Find the nearest existing directory above a path that does not yet exist. */
async function nearestExistingDirectory(path: string): Promise<string> {
  let candidate = dirname(path);
  while (true) {
    try {
      const stat = await Deno.stat(candidate);
      if (!stat.isDirectory) {
        throw new Error(`${candidate} exists but is not a directory`);
      }
      return candidate;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error(`no existing parent directory for ${path}`);
    }
    candidate = parent;
  }
}

/**
 * Exercise directory creation when a planned directory may not exist yet.
 * Existing targets receive the exact entry probe. Missing targets are
 * represented under a temporary sibling rooted at their nearest existing
 * ancestor; the real target is never created and cleanup removes the complete
 * representative tree.
 */
async function probeDirectoryTree(
  target: Extract<PlannedWriteTarget, { kind: "directory-tree" }>,
  entropy: SecureEntropy,
): Promise<WritePreflightResult> {
  try {
    const stat = await Deno.stat(target.path);
    if (!stat.isDirectory) {
      return {
        ok: false,
        path: target.path,
        description: target.description,
        reason: "the planned directory path exists but is not a directory",
      };
    }
    return await probeDirectoryEntry({
      kind: "directory-entry",
      path: target.path,
      description: target.description,
    });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      return {
        ok: false,
        path: target.path,
        description: target.description,
        reason: errorText(error),
      };
    }
  }

  let probeRoot: string | undefined;
  try {
    const parent = await nearestExistingDirectory(target.path);
    probeRoot = join(
      parent,
      `.discern-write-tree-probe-${entropy.uuid()}`,
    );
    await Deno.mkdir(probeRoot);
    const representative = join(probeRoot, "nested", "target");
    await Deno.mkdir(representative, { recursive: true });
    const result = await probeDirectoryEntry({
      kind: "directory-entry",
      path: representative,
      description: target.description,
    });
    if (!result.ok) {
      return {
        ...result,
        path: target.path,
        description: target.description,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      path: target.path,
      description: target.description,
      reason: errorText(error),
    };
  } finally {
    await removeProbeTree(probeRoot);
  }
}

/** Probe each distinct target in order and stop at the first denial. */
export async function preflightPlannedWrites(
  targets: readonly PlannedWriteTarget[],
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
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
      : target.kind === "existing-file"
      ? await probeExistingFile(target)
      : await probeDirectoryTree(target, entropy);
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
  return `discern cannot write ${failure.description} at ${failure.path}: ${failure.reason}. Allow this invocation to write that path, then retry. A successful probe confirms only that the representative write worked at that moment in that invocation.`;
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

/** One uniform refusal for a command whose planned writes were denied. */
export function writePreflightFailureResult<T>(
  verb: string,
  failure: WritePreflightFailure,
  reproduceCmd: string,
): DiscernResult<T> {
  return {
    ok: false,
    verb,
    error: "write_denied",
    message: writePreflightFailureMessage(failure),
    diagnostics: [writePreflightDiagnostic(failure, reproduceCmd)],
  };
}
