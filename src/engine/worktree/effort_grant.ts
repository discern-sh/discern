/**
 * The worktree-scoped landing grant written only by the interactive desk.
 *
 * The marker resolves through GIT_ADMIN_STATE, so it lives under this linked
 * worktree's Git administrative directory and disappears when Git removes the
 * worktree. Agent-run CLI and MCP surfaces may read it, but expose no writer.
 */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";

export interface EffortGrant {
  readonly branch: string;
  readonly granted_at: string;
}

export type EffortGrantRead =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

export type EffortGrantWrite =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "already_granted"; readonly grant: EffortGrant };

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseGrant(raw: string): EffortGrantRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "the marker is not valid JSON" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { status: "invalid", reason: "the marker is not an object" };
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.branch !== "string" || record.branch.trim() === "" ||
    typeof record.granted_at !== "string" ||
    Number.isNaN(Date.parse(record.granted_at))
  ) {
    return {
      status: "invalid",
      reason: "the marker needs a branch and ISO-8601 grant time",
    };
  }
  return {
    status: "granted",
    grant: { branch: record.branch, granted_at: record.granted_at },
  };
}

/** Read this worktree's effort grant. Unreadable or malformed state fails closed. */
export async function readEffortGrant(cwd: string): Promise<EffortGrantRead> {
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the effort-grant path",
    };
  }
  try {
    return parseGrant(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing" };
    }
    return { status: "unavailable", reason: failureReason(error) };
  }
}

/**
 * Record a desk-granted landing authority. Repeating the same grant is a no-op;
 * a branch rename replaces stale state with the human's current decision.
 */
export async function grantEffort(
  cwd: string,
  branch: string,
  grantedAt = new Date().toISOString(),
): Promise<EffortGrantWrite> {
  const current = await readEffortGrant(cwd);
  if (current.status === "granted" && current.grant.branch === branch) {
    return { status: "already_granted", grant: current.grant };
  }
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    throw new Error("Git could not resolve the effort-grant path.");
  }
  const grant: EffortGrant = { branch, granted_at: grantedAt };
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  let cleanupError: unknown;
  try {
    await Deno.writeTextFile(temp, `${JSON.stringify(grant)}\n`, {
      createNew: true,
    });
    await Deno.rename(temp, path);
  } finally {
    try {
      await Deno.remove(temp);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  return { status: "granted", grant };
}

/** Revoke this worktree's grant. Repeating the revoke is a no-op. */
export async function clearEffortGrant(cwd: string): Promise<boolean> {
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    return false;
  }
  try {
    await Deno.remove(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}
