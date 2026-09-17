/** Normalize user-originated config load errors into the shared result envelope. */

import {
  ConfigMissingError,
  ConfigParseError,
  ConfigValidationError,
} from "./config_schema.ts";
import type { ConfigIssue } from "./config_issues.ts";
import { unknownRootSections } from "./config_issues.ts";
import { noProjectResult } from "./env.ts";
import { fire, HINTS, hintTexts, withFailureRecoveryHint } from "./hints.ts";
import type { DiscernResult } from "./result.ts";

/** The shared structured payload every verb schema accepts for config failures. */
export interface ConfigIssueData {
  issues: ConfigIssue[];
}

/**
 * Map one recognized config error to a strict failed result. Returns undefined
 * for non-config exceptions so callers can preserve their crash boundary.
 */
export function configFailureResult(
  verb: string,
  error: unknown,
): DiscernResult<ConfigIssueData> | undefined {
  if (error instanceof ConfigMissingError) {
    // A vanished checkout is a project state, not a config the user can fix in
    // place — the canonical "no discern project here" refusal fits exactly.
    return withFailureRecoveryHint(noProjectResult(verb, error.message));
  }
  if (error instanceof ConfigParseError) {
    return withFailureRecoveryHint({
      ok: false,
      verb,
      error: "invalid_toml",
      message: error.message,
    });
  }
  if (!(error instanceof ConfigValidationError)) {
    return undefined;
  }

  const sections = unknownRootSections(error.issues);
  const recovery = sections.length > 0
    ? fire(HINTS["config-unknown-root-sections"], { sections })
    : fire(HINTS["config-correct-validation"]);
  return withFailureRecoveryHint({
    ok: false,
    verb,
    error: "invalid_config",
    message: error.message,
    data: { issues: error.issues },
    hints: hintTexts([recovery]),
  });
}
