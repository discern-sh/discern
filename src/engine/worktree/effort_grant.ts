/**
 * Read the worktree-scoped landing grant. Mutation capabilities live in
 * separately enrolled modules: the interactive desk owns grant creation, while
 * desk revocation and successful acceptance share the cleanup capability.
 *
 * The marker resolves through GIT_ADMIN_STATE, so it lives under this linked
 * worktree's Git administrative directory and disappears when Git removes the
 * worktree.
 */

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

/** Preserve an Error message while giving non-Error failures stable text. */
export function effortGrantFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate the persisted branch-bound grant and its ISO-8601 grant time. */
export function parseEffortGrant(raw: string): EffortGrantRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      status: "invalid",
      reason: "the effort-grant record is not valid JSON",
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "invalid",
      reason: "the effort-grant record is not a JSON object",
    };
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.branch !== "string" || record.branch.trim() === "" ||
    typeof record.granted_at !== "string" ||
    Number.isNaN(Date.parse(record.granted_at))
  ) {
    return {
      status: "invalid",
      reason:
        "the effort-grant record needs a branch and an ISO-8601 grant time",
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
    return parseEffortGrant(await Deno.readTextFile(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing" };
    }
    return { status: "unavailable", reason: effortGrantFailureReason(error) };
  }
}
