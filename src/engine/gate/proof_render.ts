/**
 * The **proof** (ADR 0114, relay contract amended by ADR 0188) — what a green
 * gate hands the review moment, rendered in two forms from one set of facts:
 *
 * - the **line** — one-line CommonMark source (branch, validated sha, diffstat
 *   vs the trunk, standards state, the command that prints the page). The only
 *   proof content an agent puts in a message; the sha lets the owner check the
 *   claim against the marker instead of trusting the message.
 * - the **page** (`markdown`) — the review summary the owner pulls from discern
 *   (`done` at a terminal, `status --verbose`, `accept`'s landing record; always
 *   in `--json`/MCP). Standards render before the job table so a deviation is
 *   never below routine, and git's own facts (commits, per-file stats) stay with
 *   git — `Inspect:` names the command.
 *
 * Single source of truth: both renderings derive from the {@link DiscernResult}
 * envelope — "what ran" is read from `steps[]`, never recomputed — plus git facts
 * gathered ONCE here and carried in the envelope's `data.proof` beside the
 * rendered `line` and `markdown` ({@link ProofSchema}). Deterministic: same
 * tree, same result → same proof (durations excepted).
 *
 * A proof exists only for the state the review moment is about: a GREEN gate
 * over a CLEAN committed tree, on a branch ahead of the trunk. A dirty tree gets
 * no proof — the diff vs the trunk would describe a different tree than the one
 * the gate validated.
 */

import { runGit } from "../../shared/subprocess.ts";
import {
  type GitCount,
  gitCountFrom,
  isKnownGitCount,
} from "../../shared/git_count.ts";
import type {
  CheckpointDropData,
  GateStandard,
  Proof,
  ProofCheckpointsData,
  StandardLimitProposalData,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import {
  checkpointDropMarkdown,
  type GateMode,
} from "../../shared/checkpoint_drops.ts";
import { RELATED_CHECKPOINT_KIND_LABELS } from "../../shared/checkpoints.ts";
import type { StepResult } from "../../shared/result.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import { diffFiles } from "../worktree/git.ts";
import { isWorktreeFullyClean } from "./proof.ts";
import { fmtRate } from "./standards.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import { markdownBlockquote } from "../../shared/markdown_blockquote.ts";

const PROOF_LINE_SEPARATOR = " · ";

/** The facts half of a {@link Proof} — everything but the two renderings. */
type ProofFacts = Omit<Proof, "markdown" | "line">;

/** Escape a table-cell fragment so a `|` in a command can't break the row. */
function cell(s: string): string {
  return s.replaceAll("|", "\\|");
}

/** A markdown code span that survives content containing backticks. */
function code(s: string): string {
  return markdownCodeSpan(s.includes("`") ? ` ${s} ` : s);
}

/** A page duration from whole-second job timing: a run that rounds to zero says
 * `<1s` — it ran and was timed, just fast — and anything longer says `Ns`. */
export function fmtDuration(durationS: number): string {
  return durationS > 0 ? `${durationS}s` : "<1s";
}

/** One "what ran" table row from an envelope step. */
function stepRow(r: StepResult): string {
  const ran = r.step.disposition === "run";
  const command = ran ? code(r.step.note ?? r.step.label) : r.step.note ?? "—";
  const duration = ran && r.durationS !== undefined
    ? ` · ${fmtDuration(r.durationS)}`
    : "";
  return `| ${cell(r.step.label)} | ${
    cell(command)
  } | ${r.outcome}${duration} |`;
}

/** One standards bullet: the value against its bound, how it was obtained
 * (measured with its cost / replayed from a commit / deferred / skipped). */
function standardLine(o: GateStandard): string {
  const bound = o.direction === "up" ? "floor" : "ceiling";
  if (o.measurement === "deferred") {
    return `- ${o.name} — deferred (measure = "on-demand"; ${bound} ${o.limit} still verified) — run \`discern standards\``;
  }
  if (o.measurement === "skipped") {
    return `- ${o.name} — not measured (the gate stopped before it ran)`;
  }
  const value = o.value !== undefined ? `${fmtRate(o.value)} ` : "";
  const standing = o.verdict ?? "unmeasured";
  const how = o.measurement === "replayed"
    ? ` — replayed from \`${
      (o.replayed_from ?? "").slice(0, 7)
    }\` (inputs unchanged)`
    : o.duration_s !== undefined
    ? ` · ${fmtDuration(o.duration_s)}`
    : "";
  return `- ${o.name} ${value}(${bound} ${o.limit}, ${standing})${how}`;
}

/** The page's standards section: the Tier-1 verification line — "limits
 * verified against the trunk", or the LOUD unverified disclosure — then one
 * line per standard. Empty when no standards are configured (the section
 * earns its space only when there is something to vouch for). It renders BEFORE
 * the job table: this is the only section that can carry a deviation, and a
 * deviation must never sit below routine. */
function standardsSection(
  standards: GateStandard[],
  limits: StandardsLimitsData | undefined,
): string[] {
  if (standards.length === 0 && limits === undefined) {
    return [];
  }
  const lines: string[] = [""];
  if (limits === undefined || limits.status === "verified") {
    lines.push(
      `Standards (limits verified against ${code(limits?.trunk ?? "")}):`,
    );
  } else if (limits.status === "unverified") {
    lines.push(
      `Standards (limits UNVERIFIED — trunk config unavailable: ${
        limits.reason ?? "unknown"
      }):`,
    );
  } else if (limits.status === "proposed") {
    lines.push(
      `Standards (limits verified against ${
        code(limits.trunk)
      } with exact owner-decision proposal evidence):`,
    );
  } else {
    lines.push(
      `Standards (limit verification FAILED against ${code(limits.trunk)}):`,
    );
  }
  lines.push("");
  for (const o of standards) {
    lines.push(standardLine(o));
  }
  return lines;
}

/** The line's Standards segment: `Standards held` with improved/deferred counts
 * appended, `Standards deferred` when nothing was measured, the UNVERIFIED
 * disclosure when the trunk's limits could not be checked — or `undefined` when
 * no standards are configured (nothing to claim). A proof only exists for a
 * green gate, so a measured standard here held or improved by construction. */
function lineStandardsSegment(
  standards: GateStandard[],
  limits: StandardsLimitsData | undefined,
): string | undefined {
  if (limits?.status === "unverified") {
    return "Standards UNVERIFIED";
  }
  if (standards.length === 0) {
    return undefined;
  }
  const deferred = standards.filter(
    (o) => o.measurement === "deferred" || o.measurement === "skipped",
  ).length;
  if (deferred === standards.length) {
    return `Standards deferred (${deferred})`;
  }
  const improved = standards.filter((o) => o.verdict === "improved").length;
  const counts = [
    ...(improved > 0 ? [`${improved} improved`] : []),
    ...(deferred > 0 ? [`${deferred} deferred`] : []),
  ];
  return counts.length > 0
    ? `Standards held (${counts.join(", ")})`
    : "Standards held";
}

/** Proposal-bearing Proof is intentionally loud: the exact value and verbatim
 * reason appear before routine results, together with the narrower landing
 * decision that remains outstanding. */
function standardProposalsSection(
  proposals: readonly StandardLimitProposalData[] | undefined,
): string[] {
  if (proposals === undefined || proposals.length === 0) {
    return [];
  }
  const lines = [
    "",
    "Standard limit proposals — resolved only by the owner's exact decision:",
    "",
  ];
  for (const proposal of proposals) {
    lines.push(
      `- ${
        code(proposal.standard)
      }: ${proposal.trunk_limit} → ${proposal.proposed_limit} (measured ${proposal.measurement}; delta ${
        proposal.delta >= 0 ? "+" : ""
      }${proposal.delta})`,
      `  - Reason: ${proposal.reason}`,
      `  - Evidence: ${proposal.evidence_paths.map(code).join(", ")}`,
      `  - Bound to ${
        code(proposal.bound_commit.slice(0, 12))
      }; proposal commit ${
        code(proposal.commit.slice(0, 12))
      }; generic landing grants and checkpoint variances do not approve it.`,
    );
  }
  return lines;
}

/** The proposal segment both line renderings share, differing only in the
 * proposal's state. A single proposal carries the decision itself — Standard,
 * trunk limit, proposed limit — because the line is what owners actually read;
 * several fall back to a count, with the page carrying each tuple. */
function proposalsLineSegment(
  proposals: readonly StandardLimitProposalData[],
  state: "awaiting exact owner approval" | "approved by the owner",
): string {
  const [only] = proposals;
  return proposals.length === 1 && only !== undefined
    ? `Standard proposal ${state}: ${
      code(only.standard)
    } ${only.trunk_limit} → ${only.proposed_limit}`
    : `${proposals.length} Standard proposals ${state}`;
}

/** The one-line Proof's proposal segment: the open proposal as a present-state
 * fact, never a demand — the owner decision it awaits is stated as its state. */
function lineStandardProposalsSegment(
  proposals: readonly StandardLimitProposalData[] | undefined,
): string | undefined {
  return proposals === undefined || proposals.length === 0
    ? undefined
    : proposalsLineSegment(proposals, "awaiting exact owner approval");
}

/**
 * The page's checkpoint section: the agent-declared conclusions, kept
 * lexically separate from the machine-verified rows — every conclusion is
 * "declared met" or "declared unmet", never bare "met" or "passed". Unmet
 * rationales render through the code-span escaping boundary (they are opaque
 * evidence), and the section closes with the landing consequence when any
 * conclusion is declared unmet. Empty when no checkpoint governed the run.
 */
function checkpointsSection(
  checkpoints: ProofCheckpointsData | undefined,
): string[] {
  if (checkpoints === undefined) {
    return [];
  }
  const heading = checkpoints.review === undefined
    ? `Checkpoint conclusions (agent-declared${
      checkpoints.policy === undefined
        ? ""
        : `; policy ${code(checkpoints.policy.slice(0, 12))}`
    }):`
    : `Checkpoint review (reported, not enforced${
      checkpoints.policy === undefined
        ? ""
        : `; policy ${code(checkpoints.policy.slice(0, 12))}`
    }):`;
  const lines: string[] = [
    "",
    heading,
    "",
  ];
  const evidence = (
    entry: {
      matched?: readonly string[] | undefined;
      related?:
        | readonly {
          kind: "similar_existing";
          for_path: string;
          path: string;
        }[]
        | undefined;
    },
  ): string[] => {
    const matched = entry.matched ?? [];
    const changed = matched.length === 0
      ? []
      : [`  - Changed: ${matched.map(code).join(", ")}`];
    const related = (entry.related ?? []).map((relation) =>
      `  - ${RELATED_CHECKPOINT_KIND_LABELS[relation.kind]}: ${
        code(relation.path)
      } resembles ${code(relation.for_path)}`
    );
    return [...changed, ...related];
  };
  const question = (
    entry: {
      question?: string | undefined;
      question_file?: string | undefined;
      teach?: string | undefined;
      reference?: string | undefined;
    },
  ): string[] => {
    if (entry.question === undefined) {
      return ["  - Question: unavailable in this older Proof record"];
    }
    const prose = entry.question.trim();
    const rendered = prose === ""
      ? "  - Question: (empty)"
      : `  - Question:\n\n    ${prose.replaceAll("\n", "\n    ")}`;
    return [
      rendered,
      ...(entry.question_file === undefined
        ? []
        : [`  - Question source: ${code(entry.question_file)}`]),
      ...(entry.teach === undefined || entry.teach.trim() === ""
        ? []
        : [`  - Teach: ${entry.teach.trim()}`]),
      ...(entry.reference === undefined || entry.reference.trim() === ""
        ? []
        : [`  - Reference: ${code(entry.reference.trim())}`]),
    ];
  };
  for (const unreviewed of checkpoints.review?.unreviewed ?? []) {
    lines.push(`- ${code(unreviewed.id)}: unreviewed`);
    lines.push(...question(unreviewed));
    lines.push(...evidence(unreviewed));
  }
  for (const met of checkpoints.declared_met) {
    lines.push(`- ${code(met.id)}: declared met`);
    lines.push(...question(met));
    lines.push(...evidence(met));
  }
  for (const unmet of checkpoints.declared_unmet) {
    lines.push(
      `- ${code(unmet.id)}: declared unmet; rationale: ${code(unmet.why)}`,
    );
    lines.push(...question(unmet));
    lines.push(...evidence(unmet));
  }
  if (checkpoints.declared_unmet.length > 0) {
    lines.push(
      "",
      "A declared-unmet conclusion requires an owner-authorized variance to " +
        "land; recorded grants never cover one.",
    );
  }
  for (const drop of checkpoints.drops ?? []) {
    lines.push(`- ${checkpointDropMarkdown(drop)}`);
  }
  return lines;
}

/** The line's checkpoint segment: declared-conclusion counts, with the
 * variance consequence attached whenever any conclusion is declared unmet —
 * or `undefined` when no checkpoint governed the run. */
function lineCheckpointsSegment(
  checkpoints: ProofCheckpointsData | undefined,
): string | undefined {
  if (checkpoints === undefined) {
    return undefined;
  }
  if (checkpoints.review !== undefined) {
    const total = checkpoints.review.unreviewed?.length ?? 0;
    return total === 0
      ? "checkpoint review reported, not enforced — no review needed"
      : `checkpoint review reported, not enforced — ${total} unreviewed`;
  }
  const met = checkpoints.declared_met.length;
  const unmet = checkpoints.declared_unmet.length;
  if (unmet > 0) {
    return `${unmet} declared unmet — owner variance required to land` +
      (met > 0 ? ` (${met} declared met)` : "");
  }
  if (met > 0) {
    return `${met} checkpoint${met === 1 ? "" : "s"} declared met`;
  }
  return undefined;
}

/** The diffstat fragment both renderings share: `2 files changed (+42 −7)`. */
function diffstat(facts: ProofFacts): string {
  const files = `${facts.files_total} file${
    facts.files_total === 1 ? "" : "s"
  }`;
  return `${files} changed (+${facts.insertions} −${facts.deletions})`;
}

/** Assemble the canonical CommonMark source relayed by agents and projected by
 * terminal surfaces. Keeping the wrapper and separator here makes presentation
 * changes atomic across validation and landing lines. */
function proofLine(segments: readonly string[]): string {
  return markdownBlockquote(
    `**Proof:** ${segments.join(PROOF_LINE_SEPARATOR)}`,
  );
}

/**
 * Render the proof line — the one sentence an agent closes its report with.
 * Pure — exported so a test can pin the exact output for fixed inputs.
 */
export function renderProofLine(
  facts: ProofFacts,
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
): string {
  const standardsSegment = lineStandardsSegment(standards, limits);
  const proposalsSegment = lineStandardProposalsSegment(
    facts.standard_proposals,
  );
  const checkpointsSegment = lineCheckpointsSegment(facts.checkpoints);
  const segments = [
    `The Gate passed for ${code(facts.branch)} at ${code(facts.head)}`,
    `${diffstat(facts)} vs ${code(facts.trunk)}`,
    ...(standardsSegment !== undefined ? [standardsSegment] : []),
    ...(proposalsSegment !== undefined ? [proposalsSegment] : []),
    ...(checkpointsSegment !== undefined ? [checkpointsSegment] : []),
    `View the full Proof: ${code("discern status --verbose")}`,
  ];
  return proofLine(segments);
}

/** The owner decisions a landing resolves, which rewrite the validation
 * line's awaiting-decision segments into their resolved state. */
export interface LandingLineResolutions {
  /** The approved Standard limit proposals — the exact set the Proof carried
   * (acceptance refuses on any mismatch before this rendering happens). */
  readonly proposals?: readonly StandardLimitProposalData[];
  /** The Proof's checkpoint facts. A declared-unmet conclusion lands only
   * under an owner-authorized variance, so landing resolves every one. */
  readonly checkpoints?: ProofCheckpointsData;
}

/** Swap one ` · segment` of a proof line for its resolved form, appending the
 * resolved form instead when the line predates the current open wording (an
 * honored line stored by an earlier engine). Either way the resolution is
 * stated exactly once. */
function resolveLineSegment(
  line: string,
  open: string | undefined,
  resolved: string,
): string {
  const openSegment = open === undefined
    ? undefined
    : `${PROOF_LINE_SEPARATOR}${open}`;
  return openSegment !== undefined && line.includes(openSegment)
    ? line.replace(openSegment, `${PROOF_LINE_SEPARATOR}${resolved}`)
    : `${line}${PROOF_LINE_SEPARATOR}${resolved}`;
}

/**
 * Derive the landed line an agent relays after the worktree is gone. The
 * underlying gate proof stays a claim about validation; this rendering states
 * the landing's facts in their final state: each segment that awaited an owner
 * decision is rewritten as resolved — never left standing next to its own
 * resolution — and the consent evidence closes the line.
 */
export function renderLandingProofLine(
  proofLine: string,
  consent: LandingConsent,
  resolutions: LandingLineResolutions = {},
): string {
  let line = proofLine;
  const proposals = resolutions.proposals ?? [];
  if (proposals.length > 0) {
    line = resolveLineSegment(
      line,
      lineStandardProposalsSegment(proposals),
      proposalsLineSegment(proposals, "approved by the owner"),
    );
  }
  const checkpoints = resolutions.checkpoints;
  const unmet = checkpoints?.declared_unmet.length ?? 0;
  if (checkpoints !== undefined && unmet > 0) {
    const met = checkpoints.declared_met.length;
    line = resolveLineSegment(
      line,
      lineCheckpointsSegment(checkpoints),
      `${unmet} declared unmet — variance${
        unmet === 1 ? "" : "s"
      } authorized by the owner` + (met > 0 ? ` (${met} declared met)` : ""),
    );
  }
  switch (consent.source) {
    case "conversation":
      return `${line}${PROOF_LINE_SEPARATOR}landed with conversation consent`;
    case "effort-grant":
      return `${line}${PROOF_LINE_SEPARATOR}landed under effort grant`;
    case "standing-grant":
      return `${line}${PROOF_LINE_SEPARATOR}landed under standing grant: ${
        consent.scopes?.join(", ") ?? "(none)"
      }`;
  }
}

/**
 * Render the proof page from its envelope pieces: the gathered git `facts`
 * and the result's `steps[]`. Pure — exported so a test can pin the exact output
 * for fixed inputs (the diff-stability guarantee).
 */
export function renderProofMarkdown(
  facts: ProofFacts,
  steps: StepResult[],
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
): string {
  const lines: string[] = [
    `### Proof — ${code(facts.branch)}`,
    "",
    `All gate checks passed on a clean tree at ${code(facts.head)} · ` +
    `diff vs ${code(facts.trunk)}: ${diffstat(facts)}`,
  ];

  lines.push(...standardProposalsSection(facts.standard_proposals));
  lines.push(...standardsSection(standards, limits));
  lines.push(...checkpointsSection(facts.checkpoints));

  lines.push("");
  const jobSteps = steps.filter(
    (r) => r.step.kind === "job" || r.step.kind === "scope-gate",
  );
  if (jobSteps.length > 0) {
    lines.push("| ran | command | result |", "| --- | --- | --- |");
    for (const r of jobSteps) {
      lines.push(stepRow(r));
    }
  } else {
    lines.push("(no job is wired — nothing ran)");
  }

  lines.push(
    "",
    `Inspect: ${code(`git diff ${facts.trunk}...${facts.branch}`)}`,
  );
  return lines.join("\n");
}

/** The branch's commit count ahead of the trunk, retaining failed reads as unknown. */
async function commitsAheadCount(
  cwd: string,
  trunk: string,
): Promise<GitCount> {
  const r = await runGit(["rev-list", "--count", `${trunk}..HEAD`], { cwd });
  return gitCountFrom(r);
}

/**
 * Build the proof for a green gate run at `root`: gather the git facts vs
 * `trunk`, render the line and the page from them plus the envelope's `steps`,
 * and return the complete {@link Proof} — or `undefined` when there is nothing
 * to proof (a dirty tree, detached HEAD, the trunk itself, an unreadable repo,
 * or a branch with no commits ahead). Best-effort: never throws, never fails the
 * gate.
 */
export async function buildGateProof(
  root: string,
  trunk: string,
  steps: StepResult[],
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
  checkpoints?: ProofCheckpointsData,
  mode: GateMode = "strict",
  drops: readonly CheckpointDropData[] = [],
  standardProposals: readonly StandardLimitProposalData[] = [],
): Promise<Proof | undefined> {
  if (!(await isWorktreeFullyClean(root))) {
    return undefined;
  }
  const branchRun = await runGit(["branch", "--show-current"], { cwd: root });
  const branch = branchRun.stdout.trim();
  if (!branchRun.success || branch === "" || branch === trunk) {
    return undefined;
  }
  // Abbreviated to a fixed width (not git's repo-scaled default) so the same
  // history renders the same line in every clone, and so it matches the width
  // `status` uses when it reports a stale marker.
  const headRun = await runGit(["rev-parse", "--short=12", "HEAD"], {
    cwd: root,
  });
  const head = headRun.stdout.trim();
  if (!headRun.success || head === "") {
    return undefined;
  }
  const ahead = await commitsAheadCount(root, trunk);
  if (!isKnownGitCount(ahead) || ahead === 0) {
    return undefined;
  }
  let delta: Awaited<ReturnType<typeof diffFiles>>;
  try {
    delta = await diffFiles(root, `${trunk}...HEAD`, 0);
  } catch {
    // discern-best-effort: proof-render-diff-fallback
    return undefined;
  }
  const facts: ProofFacts = {
    branch,
    trunk,
    head,
    files_total: delta.filesTotal,
    insertions: delta.insertions,
    deletions: delta.deletions,
    ...(mode === "report" ? { mode } : {}),
    ...(drops.length === 0
      ? {}
      : { checkpoint_drops: drops.map((drop) => ({ ...drop })) }),
    ...(checkpoints === undefined ? {} : { checkpoints }),
    ...(standardProposals.length === 0 ? {} : {
      standard_proposals: [...standardProposals].sort((left, right) =>
        left.standard.localeCompare(right.standard)
      ),
    }),
  };
  return {
    ...facts,
    line: renderProofLine(facts, standards, limits),
    markdown: renderProofMarkdown(facts, steps, standards, limits),
  };
}
