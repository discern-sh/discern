/**
 * A landing preview's facts, beside its plan: what lands, whether the trunk
 * moved so the landing composes first, the authority it lands under, the
 * queue walk after it, a landing it waits behind, what its checkout removal
 * discards and consumes, and the owner decisions or fresh checks it still
 * needs. Human surfaces word these facts; the plan's details stay the CLI's
 * context lines. Pure: the acceptance core reads everything first.
 */

import type { AcceptPreviewData, Proof } from "../../shared/result_schemas.ts";
import type { GitCount } from "../../shared/git_count.ts";
import type { IgnoredFileChangeSummary } from "./ignored.ts";
import type { AcceptanceCheckpointState } from "./acceptance_checkpoints.ts";
import type { LandingAuthorityResolution } from "./landing_authority.ts";
import type { SubmissionRow } from "./submissions_view.ts";

/** One queue row, as far as a preview reads it. */
export type AcceptPreviewRow = Pick<
  SubmissionRow,
  "effort" | "branch" | "head" | "authority" | "readiness" | "operation_handle"
>;

/** Everything one preview reads, already resolved by the acceptance core. */
export interface AcceptPreviewInputs {
  /** The landing effort's id, as queue rows name efforts. */
  readonly effort: string;
  /** The exact revision that lands. */
  readonly head: string;
  readonly proof: Pick<Proof, "files_total" | "insertions" | "deletions">;
  /** Standard limit changes the Proof proposes for the owner. */
  readonly standardApprovals: number;
  /** Commits the revision adds to the trunk. */
  readonly commits: GitCount;
  /** Trunk commits the revision lacks; absent for a direct landing. */
  readonly behind?: GitCount;
  readonly authority: LandingAuthorityResolution;
  /** Whether a queue entry records this revision. */
  readonly submitted: boolean;
  readonly ignored: IgnoredFileChangeSummary;
  /** The landing queue, in landing order. */
  readonly rows: readonly AcceptPreviewRow[];
  readonly checkpoints?: Pick<AcceptanceCheckpointState, "stale" | "unmet">;
}

/** A Git count, or nothing when Git could not count. */
function counted(value: GitCount): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** The authority facts, as counts a sentence can read. */
function authorityFacts(
  authority: LandingAuthorityResolution,
): AcceptPreviewData["authority"] {
  const uncovered = authority.kind === "authorized"
    ? 0
    : authority.uncovered.length;
  const covered = authority.standingScopes.length === 0
    ? 0
    : authority.classifications.length - uncovered;
  return {
    kind: authority.kind,
    ...(authority.kind === "authorized"
      ? {
        source: authority.consent.source,
        ...(authority.consent.scopes === undefined
          ? {}
          : { scopes: [...authority.consent.scopes] }),
      }
      : {}),
    covered_paths: covered,
    uncovered_paths: uncovered,
  };
}

/** A queue row as the preview names it. */
function submission(
  row: AcceptPreviewRow,
): AcceptPreviewData["queue_walk"][number] {
  return { effort: row.effort, branch: row.branch, head: row.head };
}

/** One landing preview's facts. */
export function acceptPreviewFacts(
  inputs: AcceptPreviewInputs,
): AcceptPreviewData {
  const others = inputs.rows.filter((row) => row.effort !== inputs.effort);
  const running = others.find((row) => row.operation_handle !== undefined);
  const commits = counted(inputs.commits);
  const behind = inputs.behind === undefined
    ? undefined
    : counted(inputs.behind);
  const ignored = inputs.ignored.status === "changed"
    ? inputs.ignored.changed_roots
    : [];
  const variances = (inputs.checkpoints?.unmet ?? []).map((unmet) => unmet.id);
  const standards = inputs.standardApprovals;
  const stale = inputs.checkpoints?.stale ?? [];
  return {
    lands: {
      head: inputs.head,
      ...(commits === undefined ? {} : { commits }),
      files: inputs.proof.files_total,
      insertions: inputs.proof.insertions,
      deletions: inputs.proof.deletions,
    },
    ...(inputs.behind === undefined
      ? {}
      : { integrates: behind === undefined ? {} : { behind } }),
    authority: authorityFacts(inputs.authority),
    queue_walk: others
      .filter((row) =>
        row.authority === "pre-authorized" && row.readiness === "ready" &&
        row.operation_handle === undefined
      )
      .map(submission),
    ...(running === undefined
      ? {}
      : { landing_in_progress: submission(running) }),
    ...(ignored.length === 0 ? {} : { ignored_roots: [...ignored] }),
    ends_grant: inputs.authority.effortGrant !== undefined,
    leaves_queue: inputs.submitted,
    ...(variances.length === 0 ? {} : { variances }),
    ...(standards === 0 ? {} : { standard_approvals: standards }),
    ...(stale.length === 0 ? {} : { stale_declarations: [...stale] }),
  };
}
