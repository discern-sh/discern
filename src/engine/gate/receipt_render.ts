/**
 * The **receipt** (ADR 0114, relay contract amended by ADR 0188) — what a green
 * gate hands the review moment, rendered in two forms from one set of facts:
 *
 * - the **line** — one sentence (branch, validated sha, diffstat vs the trunk,
 *   standards state, the command that prints the page). The only receipt content
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
 * gathered ONCE here and carried in the envelope's `data.receipt` beside the
 * rendered `line` and `markdown` ({@link ReceiptSchema}). Deterministic: same
 * tree, same result → same receipt (durations excepted).
 *
 * A receipt exists only for the state the review moment is about: a GREEN gate
 * over a CLEAN committed tree, on a branch ahead of the trunk. A dirty tree gets
 * no receipt — the diff vs the trunk would describe a different tree than the one
 * the gate validated.
 */

import { runGit } from "../../shared/subprocess.ts";
import type {
  GateStandard,
  Receipt,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import type { StepResult } from "../../shared/result.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import { diffFiles } from "../worktree/git.ts";
import { isWorktreeFullyClean } from "./receipt.ts";
import { fmtRate } from "./standards.ts";

/** The facts half of a {@link Receipt} — everything but the two renderings. */
type ReceiptFacts = Omit<Receipt, "markdown" | "line">;

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
function fmtDuration(durationS: number): string {
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
 * no standards are configured (nothing to claim). A receipt only exists for a
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

/** The diffstat fragment both renderings share: `2 files +42 −7`. */
function diffstat(facts: ReceiptFacts): string {
  const files = `${facts.files_total} file${
    facts.files_total === 1 ? "" : "s"
  }`;
  return `${files} +${facts.insertions} −${facts.deletions}`;
}

/**
 * Render the receipt line — the one sentence an agent closes its report with.
 * Pure — exported so a test can pin the exact output for fixed inputs.
 */
export function renderReceiptLine(
  facts: ReceiptFacts,
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
): string {
  const standardsSegment = lineStandardsSegment(standards, limits);
  const segments = [
    `gate passed on ${facts.branch} @ ${facts.head}`,
    `${diffstat(facts)} vs ${facts.trunk}`,
    ...(standardsSegment !== undefined ? [standardsSegment] : []),
    "full receipt: discern status --verbose",
  ];
  return `Receipt: ${segments.join(" · ")}`;
}

/**
 * Add the consent evidence to a gate receipt once that tree has landed. The
 * underlying gate receipt stays a claim about validation; this derived line is
 * the acceptance record agents relay after the worktree is gone.
 */
export function renderLandingReceiptLine(
  receiptLine: string,
  consent: LandingConsent,
): string {
  switch (consent.source) {
    case "conversation":
      return `${receiptLine} · landed with conversation consent`;
    case "effort-grant":
      return `${receiptLine} · landed under effort grant`;
    case "standing-grant":
      return `${receiptLine} · landed under standing grant: ${
        consent.scopes?.join(", ") ?? "(none)"
      }`;
  }
}

/**
 * Render the receipt page from its envelope pieces: the gathered git `facts`
 * and the result's `steps[]`. Pure — exported so a test can pin the exact output
 * for fixed inputs (the diff-stability guarantee).
 */
export function renderReceiptMarkdown(
  facts: ReceiptFacts,
  steps: StepResult[],
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
): string {
  const lines: string[] = [
    `### Receipt — ${code(facts.branch)}`,
    "",
    `All gate checks passed on a clean tree at ${code(facts.head)} · ` +
    `diff vs ${code(facts.trunk)}: ${diffstat(facts)}`,
  ];

  lines.push(...standardsSection(standards, limits));

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
 * repo, unreadable log) — and 0 means "nothing to receipt". */
async function commitsAheadCount(cwd: string, trunk: string): Promise<number> {
  const r = await runGit(["rev-list", "--count", `${trunk}..HEAD`], { cwd });
  const count = Number(r.stdout.trim());
  return r.success && Number.isFinite(count) ? count : 0;
}

/**
 * Build the receipt for a green gate run at `root`: gather the git facts vs
 * `trunk`, render the line and the page from them plus the envelope's `steps`,
 * and return the complete {@link Receipt} — or `undefined` when there is nothing
 * to receipt (a dirty tree, detached HEAD, the trunk itself, an unreadable repo,
 * or a branch with no commits ahead). Best-effort: never throws, never fails the
 * gate.
 */
export async function buildGateReceipt(
  root: string,
  trunk: string,
  steps: StepResult[],
  standards: GateStandard[] = [],
  limits?: StandardsLimitsData,
): Promise<Receipt | undefined> {
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
  const facts: ReceiptFacts = {
    branch,
    trunk,
    head,
    files_total: delta.filesTotal,
    insertions: delta.insertions,
    deletions: delta.deletions,
  };
  return {
    ...facts,
    line: renderReceiptLine(facts, standards, limits),
    markdown: renderReceiptMarkdown(facts, steps, standards, limits),
  };
}
