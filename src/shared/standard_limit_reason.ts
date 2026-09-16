/** One authority for the durable owner-facing proposed-limit reason. */

export const STANDARD_LIMIT_REASON_MAX_LENGTH = 500;

export type StandardLimitReasonValidation =
  | { readonly ok: true; readonly reason: string }
  | { readonly ok: false; readonly message: string };

const OBVIOUS_SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/u,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S+/iu,
];

/** Approval remains acceptance evidence, never part of technical rationale. */
const AUTHORITY_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(?:owner|user|human|maintainer)\s+(?:has\s+)?approved\b/iu,
  /\bapproved\s+by\s+(?:the\s+)?(?:owner|user|human|maintainer)\b/iu,
  /\b(?:approval|consent|permission)\s+(?:was\s+|has\s+been\s+)?(?:given|granted|received)\b/iu,
];

/** Validate without normalizing: accepted bytes are recorded verbatim. */
export function validateStandardLimitReason(
  reason: string,
): StandardLimitReasonValidation {
  if (reason.trim().length === 0) {
    return {
      ok: false,
      message: "--reason needs a non-empty explanation (1-500 characters).",
    };
  }
  if (reason.length > STANDARD_LIMIT_REASON_MAX_LENGTH) {
    const reduction = reason.length - STANDARD_LIMIT_REASON_MAX_LENGTH;
    return {
      ok: false,
      message:
        `--reason is ${reason.length} characters; remove at least ${reduction} to meet the ${STANDARD_LIMIT_REASON_MAX_LENGTH}-character maximum.`,
    };
  }
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(reason)) {
    return {
      ok: false,
      message:
        "--reason must be one visible paragraph: no newlines, tabs, control, or invisible formatting characters.",
    };
  }
  if (OBVIOUS_SECRET_PATTERNS.some((pattern) => pattern.test(reason))) {
    return {
      ok: false,
      message:
        "--reason appears to contain a credential or secret. Remove it and describe the engineering reason without sensitive values.",
    };
  }
  if (AUTHORITY_CLAIM_PATTERNS.some((pattern) => pattern.test(reason))) {
    return {
      ok: false,
      message:
        "--reason must contain only the technical justification. Keep approval, consent, and landing authority in the separate acceptance decision.",
    };
  }
  return { ok: true, reason };
}
