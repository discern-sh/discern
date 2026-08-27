/**
 * The capability to consume or revoke an effort landing grant.
 *
 * Only the human-operated desk and successful acceptance may import this
 * module. Grant creation remains desk-only in effort_grant_writer.ts.
 */

import { join } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { type EnginePlan, verbatimStepLabel } from "../../shared/result.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import type { CheckedOutFastForwardResult } from "./git.ts";
import {
  type EffortGrant,
  effortGrantFailureReason,
  type EffortGrantRead,
  parseEffortGrant,
  readEffortGrant,
} from "./effort_grant.ts";

/** An effort grant atomically removed from the desk-visible marker while one
 * acceptance owns the decision. */
export interface EffortGrantClaim {
  readonly path: string;
  readonly grant: EffortGrant;
  readonly raw: string;
}

export type EffortGrantClaimRead =
  | { readonly status: "claimed"; readonly claim: EffortGrantClaim }
  | Exclude<EffortGrantRead, { readonly status: "granted" }>;

const CLAIM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Preview grant revocation while leaving the apply path to revalidate it. */
export async function clearEffortGrantPlan(cwd: string): Promise<EnginePlan> {
  const current = await readEffortGrant(cwd);
  const path = await gitAdminStatePath(cwd, "effortGrant");
  const removable = path !== undefined && current.status !== "missing";
  return {
    title: "Landing pre-authorization revocation plan",
    details: [
      `Task: ${cwd}`,
      `Authority record: ${path ?? "Git could not resolve the record path"}`,
    ],
    steps: [{
      kind: "git",
      label: verbatimStepLabel("remove landing pre-authorization"),
      disposition: removable ? "run" : "skip",
      note: removable
        ? `remove the ${current.status} authority record`
        : current.status === "missing"
        ? "no landing pre-authorization is recorded"
        : "Git could not resolve the authority record path",
    }],
  };
}

/** Resolve a transaction-owned claim path only for a valid UUID. */
async function effortGrantClaimPath(
  cwd: string,
  claimId: string,
): Promise<string | undefined> {
  if (!CLAIM_ID.test(claimId)) {
    return undefined;
  }
  const claimsDir = await gitAdminStatePath(cwd, "effortGrantClaims");
  return claimsDir === undefined ? undefined : join(claimsDir, claimId);
}

/** Validate a persisted grant and prove that it belongs to the accepting branch. */
function parseClaim(
  path: string,
  raw: string,
  branch: string,
): EffortGrantClaimRead {
  const parsed = parseEffortGrant(raw);
  if (parsed.status !== "granted") {
    return parsed;
  }
  if (parsed.grant.branch !== branch) {
    return {
      status: "invalid",
      reason:
        `the effort grant belongs to ${parsed.grant.branch}, not ${branch}`,
    };
  }
  return {
    status: "claimed",
    claim: { path, grant: parsed.grant, raw },
  };
}

/** Read the deterministic claim owned by one acceptance transaction. */
export async function readEffortGrantClaim(
  cwd: string,
  branch: string,
  claimId: string,
): Promise<EffortGrantClaimRead> {
  const path = await effortGrantClaimPath(cwd, claimId);
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the effort-grant claim path",
    };
  }
  try {
    return parseClaim(path, await Deno.readTextFile(path), branch);
  } catch (error) {
    return error instanceof Deno.errors.NotFound ? { status: "missing" } : {
      status: "unavailable",
      reason: effortGrantFailureReason(error),
    };
  }
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

/**
 * Atomically claim this worktree's grant for one acceptance.
 *
 * Renaming the marker is the linearization point shared with desk grant/revoke:
 * either revoke removes it first and this fails closed, or acceptance removes
 * it first and owns that already-recorded decision through the trunk CAS. A
 * unique claim path avoids replacement semantics and leaves a crash artifact
 * that cannot accidentally authorize another landing.
 */
export async function claimEffortGrant(
  cwd: string,
  branch: string,
  claimId?: string,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Promise<EffortGrantClaimRead> {
  const resolvedClaimId = claimId ?? entropy.uuid();
  const marker = await gitAdminStatePath(cwd, "effortGrant");
  const claimsDir = await gitAdminStatePath(cwd, "effortGrantClaims");
  const claimPath = await effortGrantClaimPath(cwd, resolvedClaimId);
  if (
    marker === undefined || claimsDir === undefined || claimPath === undefined
  ) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the effort-grant claim paths",
    };
  }
  try {
    await Deno.mkdir(claimsDir, { recursive: true });
  } catch (error) {
    return {
      status: "unavailable",
      reason: effortGrantFailureReason(error),
    };
  }
  try {
    await Deno.stat(claimPath);
    return {
      status: "unavailable",
      reason: "the acceptance transaction's effort claim already exists",
    };
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      return {
        status: "unavailable",
        reason: effortGrantFailureReason(error),
      };
    }
  }
  try {
    await Deno.rename(marker, claimPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "missing" };
    }
    return {
      status: "unavailable",
      reason: effortGrantFailureReason(error),
    };
  }

  let raw: string;
  try {
    raw = await Deno.readTextFile(claimPath);
  } catch (error) {
    return {
      status: "unavailable",
      reason: effortGrantFailureReason(error),
    };
  }
  const parsed = parseClaim(claimPath, raw, branch);
  if (parsed.status !== "claimed") {
    await restoreEffortGrantClaim(cwd, {
      path: claimPath,
      grant: { branch: "", granted_at: "" },
      raw,
    });
    return parsed;
  }
  return parsed;
}

/**
 * Restore a claimed grant after the landing CAS refuses. A newer desk grant
 * wins: `createNew` never overwrites it, and the obsolete claim is discarded.
 */
export async function restoreEffortGrantClaim(
  cwd: string,
  claim: EffortGrantClaim,
): Promise<boolean> {
  const marker = await gitAdminStatePath(cwd, "effortGrant");
  if (marker === undefined) {
    return false;
  }
  try {
    await Deno.writeTextFile(marker, claim.raw, { createNew: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      // discern-best-effort: effort-grant-restore-outcome
      return false;
    }
  }
  return await consumeEffortGrantClaim(claim);
}

/**
 * Permanently consume a claim after the trunk CAS succeeds. Missing is already
 * settled; every other removal failure stays visible without throwing after an
 * irreversible ref transition.
 */
export async function consumeEffortGrantClaim(
  claim: EffortGrantClaim,
): Promise<boolean> {
  try {
    await Deno.remove(claim.path);
    return true;
  } catch (error) {
    return error instanceof Deno.errors.NotFound;
  }
}

/** Consume a transaction-owned claim even when its payload cannot be parsed. */
export async function consumeEffortGrantClaimById(
  cwd: string,
  claimId: string,
): Promise<boolean> {
  const path = await effortGrantClaimPath(cwd, claimId);
  if (path === undefined) {
    return false;
  }
  return await consumeEffortGrantClaim({
    path,
    grant: { branch: "", granted_at: "" },
    raw: "",
  });
}

/** How an effort claim must settle after the exact trunk transition attempt. */
export interface EffortGrantClaimSettlement {
  readonly disposition: "restore" | "consume";
  readonly settled: boolean;
}

/**
 * Settle one claimed effort grant from the ref outcome, without throwing.
 *
 * Authority is restored only when the expected trunk ref is known to remain in
 * place. Once the trunk remains advanced, even with a failed checkout
 * convergence, the grant is spent and can only be consumed.
 */
export async function settleEffortGrantClaim(
  cwd: string,
  claim: EffortGrantClaim,
  outcome: CheckedOutFastForwardResult,
): Promise<EffortGrantClaimSettlement> {
  let disposition: EffortGrantClaimSettlement["disposition"];
  switch (outcome.kind) {
    case "updated":
      disposition = "consume";
      break;
    case "checkout-failed":
      disposition = outcome.rolledBack ? "restore" : "consume";
      break;
    case "not-fast-forward":
    case "moved":
    case "dirty":
      disposition = "restore";
      break;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
  return {
    disposition,
    settled: disposition === "restore"
      ? await restoreEffortGrantClaim(cwd, claim)
      : await consumeEffortGrantClaim(claim),
  };
}
