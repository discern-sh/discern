/**
 * The single source of truth for discern-authored commit sites (ADR 0203) and the only
 * production boundary allowed to invoke `git commit` for them.
 *
 * Callers still own their surrounding workflow: they stage their scoped paths,
 * decide whether a failure is fatal, and perform any rollback. This boundary
 * owns only the commit message, attribution, and pathspec-limited invocation.
 */

import { DISCERN_BOT } from "./brand.ts";
import { discernCommitAttributionEnabled, type EnvReader } from "./env.ts";
import { type GitResult, runGit } from "./subprocess.ts";

/** Every workflow whose diff discern itself composes and commits. */
export const DISCERN_AUTHORED_COMMIT_SITES = {
  scaffoldWiring: "scaffold-wiring",
  setupCompletion: "setup-completion",
  standardsPin: "standards-pin",
} as const;

export type DiscernAuthoredCommitSite = typeof DISCERN_AUTHORED_COMMIT_SITES[
  keyof typeof DISCERN_AUTHORED_COMMIT_SITES
];

export interface DiscernCommitOptions {
  /** Canonical workflow identity; the enrolment guard holds one call per site. */
  readonly site: DiscernAuthoredCommitSite;
  readonly cwd: string;
  readonly subject: string;
  readonly body?: string;
  /** The exact paths this commit may carry. Empty pathspecs are refused. */
  readonly pathspecs: readonly string[];
  /** Injectable environment read for parallel-safe attribution tests. */
  readonly env?: EnvReader;
}

/** Render subject, optional body, and the default-on co-author trailer. */
export function discernCommitMessage(
  subject: string,
  body: string | undefined,
  env: EnvReader = Deno.env,
): string {
  const paragraphs = [subject];
  if (body !== undefined && body !== "") {
    paragraphs.push(body);
  }
  if (discernCommitAttributionEnabled(env)) {
    paragraphs.push(DISCERN_BOT.trailer);
  }
  return paragraphs.join("\n\n");
}

/** Commit one discern-composed diff without changing author or committer identity. */
export async function commitDiscernChanges(
  options: DiscernCommitOptions,
): Promise<GitResult> {
  if (options.pathspecs.length === 0) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr:
        `discern-authored commit site '${options.site}' has no pathspecs; refusing an unscoped commit`,
    };
  }
  const message = discernCommitMessage(
    options.subject,
    options.body,
    options.env,
  );
  return await runGit(
    ["commit", "-m", message, "--", ...options.pathspecs],
    { cwd: options.cwd },
  );
}
