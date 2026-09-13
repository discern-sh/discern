/**
 * Shared substrate for the acceptance executors: the landing sentences'
 * abbreviated commit form, the pre-effect refusal, consent wording and
 * resolution, the trunk-tip read, and the partial-acceptance projection.
 * Everything here is used by `accept.ts` and the extracted landing executors
 * alike, so it lives below both — this module never imports `accept.ts` at
 * runtime.
 */

import { fire, HINTS, hintTexts, mergeHintTexts } from "../../shared/hints.ts";
import type { DiscernResult, ErrorSlug } from "../../shared/result.ts";
import {
  type AcceptData,
  AppliedAcceptDataSchema,
} from "../../shared/result_schemas.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import { runGit } from "../../shared/subprocess.ts";
import { cloneLandingConsent } from "./accept_proof_recording.ts";
import {
  missingIntegrationBranchWarning,
  WorktreeGitError,
  WorktreeResultError,
} from "./git.ts";
import {
  type LandingAuthorityResolution,
  uncoveredLandingAuthorityDetails,
} from "./landing_authority.ts";
import type { AcceptExecutionProgress, EffortCheckout } from "./accept.ts";

/** The shared no-effects clause every pre-effect refusal ends with. */
export const ACCEPT_NOTHING_LANDED =
  "Nothing has been landed — the worktree, its branch, and the trunk are untouched.";

const SHORT_SHA_LENGTH = 12;

/** The abbreviated commit id every landing sentence uses. */
export function short(sha: string): string {
  return sha.slice(0, SHORT_SHA_LENGTH);
}

/** Stop before any effect with a complete result the surfaces render as-is. */
export function refusal(
  error: ErrorSlug,
  message: string,
  extra: { readonly hints?: string[]; readonly data?: AcceptData } = {},
): never {
  const result: DiscernResult<AcceptData> = {
    ok: false,
    verb: "accept",
    error,
    message,
    ...(extra.hints === undefined ? {} : { hints: extra.hints }),
    ...(extra.data === undefined ? {} : { data: extra.data }),
  };
  throw new WorktreeResultError(message, result);
}

/** Whether this request carries integration-judgment declarations. */
export function carriesDeclarations(
  request: { readonly met: readonly string[]; readonly unmet?: unknown },
): boolean {
  return request.met.length > 0 || request.unmet !== undefined;
}

/** The read-only refusal when declarations accompany a dry run: a preview
 * records nothing. Undefined when the combination is fine. */
export function dryRunDeclarationsRefusal(
  request: {
    readonly dryRun: boolean;
    readonly met: readonly string[];
    readonly unmet?: unknown;
  },
): DiscernResult<AcceptData> | undefined {
  if (!request.dryRun || !carriesDeclarations(request)) return undefined;
  return {
    ok: false,
    verb: "accept",
    error: "invalid_arguments",
    message:
      "A dry run records nothing, so --met/--unmet cannot accompany it. Preview without declarations, then answer the served question with an apply call.",
  };
}

/** The current trunk commit, read where the landing will advance it. */
export async function trunkTip(effort: EffortCheckout): Promise<string> {
  const run = await runGit(
    ["rev-parse", "--verify", `refs/heads/${effort.trunk}^{commit}`],
    { cwd: effort.mainRepo },
  );
  if (!run.success || run.stdout.trim() === "") {
    throw new WorktreeGitError(
      `${
        missingIntegrationBranchWarning(effort.trunk)
      } Acceptance cannot land until the trunk resolves.`,
    );
  }
  return run.stdout.trim();
}

/** The relay-and-recovery sentence the consent refusal serves on every surface. */
const ACCEPT_AWAITING_CONSENT_BASE =
  "Landing is the owner's decision, so `discern accept` needs their explicit " +
  "acceptance before it lands. Relay the Proof to your owner and wait for " +
  "their go-ahead, then re-run `discern accept --confirmed`. The flag attests " +
  "to that conversation; recorded grants in the trunk's `[acceptance]` section " +
  "or at the desk are checked automatically.";

/** The one refusal an agent relays when landing still needs the owner. */
export function acceptAwaitingConsentMessage(
  authority: LandingAuthorityResolution,
  submitted: boolean,
): string {
  const uncovered = uncoveredLandingAuthorityDetails(authority);
  const detail = uncovered.length > 0
    ? `Recorded standing grants do not cover ${uncovered.join(", ")}.`
    : undefined;
  const evidence = [
    ...(detail !== undefined ? [detail] : []),
    ...authority.warnings,
  ];
  const lead = submitted
    ? "The revision is submitted and waits in the landing queue for the owner. "
    : "";
  return `${lead}${ACCEPT_AWAITING_CONSENT_BASE}${
    evidence.length > 0 ? ` ${evidence.join(" ")}` : ""
  } ${ACCEPT_NOTHING_LANDED}`;
}

/** Prefer recorded authority; fall back to the conversation attestation. */
export function availableLandingConsent(
  authority: LandingAuthorityResolution,
  confirmed: boolean,
): LandingConsent | undefined {
  if (confirmed) return { source: "conversation" };
  if (authority.kind === "authorized") return authority.consent;
  return undefined;
}

/** One concise plan-detail rendering of the resolved authority. */
export function landingAuthorityDetail(
  authority: LandingAuthorityResolution,
  confirmed: boolean,
): string {
  if (authority.kind === "authorized") {
    if (authority.consent.source === "standing-grant") {
      return `standing grant (${authority.consent.scopes?.join(", ") ?? ""})`;
    }
    return "effort grant";
  }
  return confirmed ? "conversation consent" : "conversation required on apply";
}

/** Project the progress record into the result's data fields. */
export function progressData(
  root: string,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
): AcceptData {
  return AppliedAcceptDataSchema.parse({
    root,
    consent: cloneLandingConsent(consent),
    ...(progress.scopesChanged.length === 0
      ? {}
      : { scopes_changed: [...progress.scopesChanged] }),
    landing: { ...progress.landing },
    ...(progress.authorityWarnings.length === 0
      ? {}
      : { authority_warnings: [...progress.authorityWarnings] }),
    ...(progress.gateValidation === undefined
      ? {}
      : { gate_validation: progress.gateValidation }),
    ...(progress.proofMarkdown === undefined
      ? {}
      : { proof: progress.proofMarkdown }),
    ...(progress.proofLine === undefined
      ? {}
      : { proof_line: progress.proofLine }),
    ...(progress.proofNote === undefined
      ? {}
      : { proof_note: progress.proofNote }),
  });
}

/** Publish the exact durable effects and recovery evidence after a stop. */
export function partialAcceptanceResult(
  root: string,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
  message: string,
): DiscernResult<AcceptData> {
  return {
    ok: false,
    verb: "accept",
    error: "partial_acceptance",
    message,
    ...(progress.steps.length === 0 ? {} : { steps: [...progress.steps] }),
    data: progressData(root, consent, progress),
    hints: mergeHintTexts(
      hintTexts([fire(HINTS["accept-recover-partial-effects"])]),
      progress.convergenceHints,
    ),
    ...(progress.diagnostics.length === 0
      ? {}
      : { diagnostics: [...progress.diagnostics] }),
  };
}

/** Report a landing that performed some effects and then stopped, effect by effect. */
export function throwPartialAcceptance(
  root: string,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
  message: string,
): never {
  throw new WorktreeResultError(
    message,
    partialAcceptanceResult(root, consent, progress, message),
  );
}
