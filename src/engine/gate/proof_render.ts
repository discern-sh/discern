/**
 * The **proof** (ADR 0114, relay contract amended by ADR 0188) — what a green
 * gate hands the review moment, rendered in two forms from one set of facts:
 *
 * - the **line** — one sentence (branch, validated sha, diffstat vs the trunk,
 *   standards state, the command that prints the page). The only proof content
 *   an agent puts in a message; the sha lets the owner check the claim against
 *   the marker instead of trusting the message.
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
import type {
  GateStandard,
  Proof,
  ProofCheckpointsData,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import type { StepResult } from "../../shared/result.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import { diffFiles } from "../worktree/git.ts";
import { isWorktreeFullyClean } from "./proof.ts";
import { fmtRate } from "./standards.ts";

/** The facts half of a {@link Proof} — everything but the two renderings. */
type ProofFacts = Omit<Proof, "markdown" | "line">;

/** Escape a table-cell fragment so a `|` in a command can't break the row. */
function cell(s: string): string {
  return s.replaceAll("|", "\\|");
}

/** A markdown code span that survives content containing backticks. */
function code(s: string): string {
  return s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``;
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

/** The line's standards segment: `standards held` with improved/deferred counts
 * appended, `standards deferred` when nothing was measured, the UNVERIFIED
 * disclosure when the trunk's limits could not be checked — or `undefined` when
 * no standards are configured (nothing to claim). A proof only exists for a
 * green gate, so a measured standard here held or improved by construction. */
function lineStandardsSegment(
  standards: GateStandard[],
  limits: StandardsLimitsData | undefined,
): string | undefined {
  if (limits !== undefined && limits.status !== "verified") {
    return "standards UNVERIFIED";
  }
  if (standards.length === 0) {
    return undefined;
  }
  const deferred = standards.filter(
    (o) => o.measurement === "deferred" || o.measurement === "skipped",
  ).length;
  if (deferred === standards.length) {
    return `standards deferred (${deferred})`;
  }
  const improved = standards.filter((o) => o.verdict === "improved").length;
  const counts = [
    ...(improved > 0 ? [`${improved} improved`] : []),
    ...(deferred > 0 ? [`${deferred} deferred`] : []),
  ];
  return counts.length > 0
    ? `standards held, ${counts.join(", ")}`
    : "standards held";
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
  const lines: string[] = [
    "",
    `Checkpoint conclusions (agent-declared; policy ${
      code(checkpoints.policy.slice(0, 12))
    }):`,
    "",
  ];
  for (const met of checkpoints.declared_met) {
    lines.push(`- ${met.id} — declared met`);
  }
  for (const unmet of checkpoints.declared_unmet) {
    lines.push(
      `- ${unmet.id} — declared unmet; rationale: ${code(unmet.why)}`,
    );
  }
  if (checkpoints.declared_unmet.length > 0) {
    lines.push(
      "",
      "A declared-unmet conclusion requires an owner-authorized variance to " +
        "land; recorded grants never cover one.",
    );
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

/** The diffstat fragment both renderings share: `2 files +42 −7`. */
function diffstat(facts: ProofFacts): string {
  const files = `${facts.files_total} file${
    facts.files_total === 1 ? "" : "s"
  }`;
  return `${files} +${facts.insertions} −${facts.deletions}`;
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
  const checkpointsSegment = lineCheckpointsSegment(facts.checkpoints);
  const segments = [
    `gate passed on ${facts.branch} @ ${facts.head}`,
    `${diffstat(facts)} vs ${facts.trunk}`,
    ...(standardsSegment !== undefined ? [standardsSegment] : []),
    ...(checkpointsSegment !== undefined ? [checkpointsSegment] : []),
    "full proof: discern status --verbose",
  ];
  return `Proof: ${segments.join(" · ")}`;
}

/**
 * Add the consent evidence to a gate proof once that tree has landed. The
 * underlying gate proof stays a claim about validation; this derived line is
 * the acceptance record agents relay after the worktree is gone.
 */
export function renderLandingProofLine(
  proofLine: string,
  consent: LandingConsent,
): string {
  switch (consent.source) {
    case "conversation":
      return `${proofLine} · landed with conversation consent`;
    case "effort-grant":
      return `${proofLine} · landed under effort grant`;
    case "standing-grant":
      return `${proofLine} · landed under standing grant: ${
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

/** The branch's commit count ahead of the trunk. Fails open to 0 (no trunk, no
 * repo, unreadable log) — and 0 means "nothing to proof". */
async function commitsAheadCount(cwd: string, trunk: string): Promise<number> {
  const r = await runGit(["rev-list", "--count", `${trunk}..HEAD`], { cwd });
  const count = Number(r.stdout.trim());
  return r.success && Number.isFinite(count) ? count : 0;
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
  if ((await commitsAheadCount(root, trunk)) === 0) {
    return undefined;
  }
  const delta = await diffFiles(root, `${trunk}...HEAD`, 0);
  const facts: ProofFacts = {
    branch,
    trunk,
    head,
    files_total: delta.filesTotal,
    insertions: delta.insertions,
    deletions: delta.deletions,
    ...(checkpoints === undefined ? {} : { checkpoints }),
  };
  return {
    ...facts,
    line: renderProofLine(facts, standards, limits),
    markdown: renderProofMarkdown(facts, steps, standards, limits),
  };
}
