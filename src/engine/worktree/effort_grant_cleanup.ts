/**
 * The capability to consume or revoke an effort landing grant.
 *
 * Only the human-operated desk and successful acceptance may import this
 * module. Grant creation remains desk-only in effort_grant_writer.ts.
 */

import { join } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type { CheckedOutFastForwardResult } from "./git.ts";
import {
  type EffortGrant,
  effortGrantFailureReason,
  type EffortGrantRead,
  parseEffortGrant,
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
): Promise<EffortGrantClaimRead> {
  const marker = await gitAdminStatePath(cwd, "effortGrant");
  const claimsDir = await gitAdminStatePath(cwd, "effortGrantClaims");
  if (marker === undefined || claimsDir === undefined) {
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
  const claimPath = join(claimsDir, crypto.randomUUID());
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
  const parsed = parseEffortGrant(raw);
  if (parsed.status !== "granted") {
    await restoreEffortGrantClaim(cwd, {
      path: claimPath,
      grant: { branch: "", granted_at: "" },
      raw,
    });
    return parsed;
  }
  if (parsed.grant.branch !== branch) {
    await restoreEffortGrantClaim(cwd, {
      path: claimPath,
      grant: parsed.grant,
      raw,
    });
    return {
      status: "invalid",
      reason:
        `the effort grant belongs to ${parsed.grant.branch}, not ${branch}`,
    };
  }
  return {
    status: "claimed",
    claim: { path: claimPath, grant: parsed.grant, raw },
  };
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

/** How an effort claim must settle after the exact trunk transition attempt. */
export interface EffortGrantClaimSettlement {
  readonly disposition: "restore" | "consume";
  readonly settled: boolean;
}

/**
 * Settle one claimed effort grant from the ref outcome, without throwing.
 *
 * Authority is restored only when the old trunk ref is known to remain in
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
