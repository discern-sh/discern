/**
 * The **receipt** (v1) — the compact review summary a green gate hands the human
 * at the review moment: the branch, what ran (each capability/check with its
 * command, outcome, and duration), the diffstat vs the trunk, and the branch's
 * commit list, rendered as one screen of markdown an agent relays verbatim (and
 * that pastes cleanly into a PR body).
 *
 * Single source of truth: the receipt derives from the {@link DiscernResult}
 * envelope — "what ran" is read from `steps[]`, never recomputed — plus git facts
 * gathered ONCE here and carried in the envelope's `data.receipt` beside the
 * rendered `markdown` ({@link ReceiptSchema}). Deterministic: same tree, same
 * result → same receipt (durations excepted).
 *
 * A receipt exists only for the state the review moment is about: a GREEN gate
 * over a CLEAN committed tree, on a branch ahead of the trunk. A dirty tree gets
 * no receipt — the diff vs the trunk would describe a different tree than the one
 * the gate validated.
 */

import { runGit } from "../../shared/subprocess.ts";
import type { Receipt } from "../../shared/result_schemas.ts";
import type { StepResult } from "../../shared/result.ts";
import { diffFiles } from "../worktree/git.ts";
import { isWorktreeFullyClean } from "./receipt.ts";

/** Commits listed in the receipt before "… and N more" (one-screen budget). */
const RECEIPT_COMMIT_CAP = 10;
/** Files listed in the receipt before "… and N more" (one-screen budget). */
const RECEIPT_FILE_CAP = 10;

/** The facts half of a {@link Receipt} — everything but the rendered markdown. */
type ReceiptFacts = Omit<Receipt, "markdown">;

/** Escape a table-cell fragment so a `|` in a command can't break the row. */
function cell(s: string): string {
  return s.replaceAll("|", "\\|");
}

/** A markdown code span that survives content containing backticks. */
function code(s: string): string {
  return s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``;
}

/** One file bullet: the path plus its `+`/`−` counts (binary files have none). */
function fileLine(f: Receipt["files"][number]): string {
  const counts = f.added === null || f.removed === null
    ? "binary"
    : `+${f.added} −${f.removed}`;
  return `- ${code(f.path)} (${counts})`;
}

/** One "what ran" table row from an envelope step. */
function stepRow(r: StepResult): string {
  const ran = r.step.disposition === "run";
  const command = ran ? code(r.step.note ?? r.step.label) : r.step.note ?? "—";
  const duration = ran && r.durationS !== undefined && r.durationS > 0
    ? ` · ${r.durationS}s`
    : "";
  return `| ${cell(r.step.label)} | ${
    cell(command)
  } | ${r.outcome}${duration} |`;
}

/**
 * Render the receipt markdown from its envelope pieces: the gathered git `facts`
 * and the result's `steps[]`. Pure — exported so a test can pin the exact output
 * for fixed inputs (the diff-stability guarantee).
 */
export function renderReceiptMarkdown(
  facts: ReceiptFacts,
  steps: StepResult[],
): string {
  const lines: string[] = [
    `### Receipt — ${code(facts.branch)}`,
    "",
    `All gate checks passed on a clean tree · diff vs ${code(facts.trunk)}: ` +
    `${facts.files_total} file${facts.files_total === 1 ? "" : "s"} ` +
    `(+${facts.insertions} −${facts.deletions})`,
    "",
  ];

  const jobSteps = steps.filter(
    (r) => r.step.kind === "job" || r.step.kind === "scope-gate",
  );
  if (jobSteps.length > 0) {
    lines.push("| ran | command | result |", "| --- | --- | --- |");
    for (const r of jobSteps) {
      lines.push(stepRow(r));
    }
  } else {
    lines.push("(no capability or check is wired — nothing ran)");
  }

  lines.push("", `Commits (${facts.commits_total}):`, "");
  for (const c of facts.commits) {
    lines.push(`- \`${c.sha}\` ${c.subject}`);
  }
  if (facts.commits_total > facts.commits.length) {
    lines.push(`- … and ${facts.commits_total - facts.commits.length} more`);
  }

  if (facts.files.length > 0) {
    lines.push("", `Files (${facts.files_total}):`, "");
    for (const f of facts.files) {
      lines.push(fileLine(f));
    }
    if (facts.files_total > facts.files.length) {
      lines.push(`- … and ${facts.files_total - facts.files.length} more`);
    }
  }

  lines.push(
    "",
    `Inspect: ${code(`git diff ${facts.trunk}...${facts.branch}`)}`,
  );
  return lines.join("\n");
}

/** The branch's commits ahead of the trunk (`%h<TAB>%s`), capped, with the pre-cap
 * total. Fails open to a zero total (no trunk, no repo, unreadable log). */
async function commitsAhead(
  cwd: string,
  trunk: string,
): Promise<{ commits: Receipt["commits"]; total: number }> {
  const r = await runGit(
    ["log", "--pretty=format:%h%x09%s", `${trunk}..HEAD`],
    { cwd },
  );
  if (!r.success) {
    return { commits: [], total: 0 };
  }
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  const commits = lines.slice(0, RECEIPT_COMMIT_CAP).map((line) => {
    const tab = line.indexOf("\t");
    return {
      sha: tab >= 0 ? line.slice(0, tab) : line,
      subject: tab >= 0 ? line.slice(tab + 1) : "",
    };
  });
  return { commits, total: lines.length };
}

/**
 * Build the receipt for a green gate run at `root`: gather the git facts vs
 * `trunk`, render the markdown from them plus the envelope's `steps`, and return
 * the complete {@link Receipt} — or `undefined` when there is nothing to receipt
 * (a dirty tree, detached HEAD, the trunk itself, an unreadable repo, or a branch
 * with no commits ahead). Best-effort: never throws, never fails the gate.
 */
export async function buildGateReceipt(
  root: string,
  trunk: string,
  steps: StepResult[],
): Promise<Receipt | undefined> {
  if (!(await isWorktreeFullyClean(root))) {
    return undefined;
  }
  const branchRun = await runGit(["branch", "--show-current"], { cwd: root });
  const branch = branchRun.stdout.trim();
  if (!branchRun.success || branch === "" || branch === trunk) {
    return undefined;
  }
  const { commits, total } = await commitsAhead(root, trunk);
  if (total === 0) {
    return undefined;
  }
  const delta = await diffFiles(root, `${trunk}...HEAD`, RECEIPT_FILE_CAP);
  const facts: ReceiptFacts = {
    branch,
    trunk,
    commits,
    commits_total: total,
    files: delta.files,
    files_total: delta.filesTotal,
    insertions: delta.insertions,
    deletions: delta.deletions,
  };
  return { ...facts, markdown: renderReceiptMarkdown(facts, steps) };
}
