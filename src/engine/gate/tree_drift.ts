/**
 * Tree-drift strand detection (ADR 0047, extended to every stage by ADR 0148) —
 * the gate's guard against a GREEN finish that nonetheless leaves uncommitted
 * gate output in the working tree.
 *
 * The fix stage is *meant* to mutate (a formatter, a codemod) — but any stage
 * can: a build that regenerates a tracked artifact, a test that rewrites a
 * golden file, a scope gate that runs a generator. Whatever the stage, a change
 * it leaves on a file that was COMMITTED-clean at the start of the run is a
 * change a green gate would hide — and that `discern accept` later scoops up
 * staged-but-uncommitted in the main checkout, surprising the agent.
 *
 * The signal is surgical: snapshot the TRACKED-dirty set before any stage group
 * runs (D0) and again after each group; the stranded files are those dirty in
 * the FINAL snapshot but not in D0 — tracked paths the gate dirtied that were
 * NOT already dirty. A stage reworking the agent's OWN uncommitted edits (the
 * inner loop) touches files already in D0, so it never trips; only a stage
 * touching a committed-clean file does. Each strand is attributed to the FIRST
 * snapshot that shows it, so the diagnostic names the stage that produced it.
 * Comparing by PATH (not by porcelain line) means a file whose status code
 * merely changed — a staged edit a fixer extends — is not mistaken for a fresh
 * strand.
 *
 * Scope: TRACKED changes only — exactly what CI's trailing `git diff
 * --exit-code` catches, the guard this check brings to the local gate. A stage
 * that emits a brand-new UNTRACKED file is out of scope: it shows plainly as
 * `??` in git status and `git diff` ignores it too, so a codemod that creates a
 * file (and the scope gate that validates it) is unaffected.
 */

import type { Diagnostic, FailedStage } from "../../shared/result.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "../scopes/scopes.ts";
import { runGit } from "../../shared/subprocess.ts";

/**
 * The set of TRACKED paths with uncommitted changes (staged or unstaged) — the dirt
 * `git diff --exit-code` would see. Untracked and .gitignored files are excluded, so a
 * fixer-created new file and generated artifacts never count. Returns `null` when git
 * can't answer — in which case the caller SKIPS the strand check (fail-open: a missing
 * snapshot must never fabricate a failure). Paths are ROOT-relative (porcelain speaks
 * toplevel-relative) so the strand diagnostic names files the way the project knows
 * them and its `git diff -- <paths>` pathspecs resolve from the root.
 */
export async function worktreeDirtyPaths(
  root: string,
): Promise<Set<string> | null> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return null;
  }
  const r = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=no"],
    { cwd: root },
  );
  if (!r.success) {
    return null;
  }
  const paths = new Set<string>();
  for (const entry of parsePorcelainZ(r.stdout)) {
    if (entry.origPath !== undefined) {
      paths.add(entry.origPath);
    }
    paths.add(entry.path);
  }
  return new Set(stripRepoPathPrefix([...paths], prefix));
}

/** The tracked-dirty set observed right after one stage group ran green. */
export interface StageSnapshot {
  /** The stage label the group reports (`fix`, `build`, `check/test`, `scope_gates`). */
  stage: FailedStage;
  /** The tracked-dirty paths at that moment. */
  dirty: Set<string>;
}

/** The strands one stage left: the committed-clean tracked paths it dirtied. */
export interface StageStrands {
  stage: FailedStage;
  paths: string[];
}

/**
 * The stranded paths, attributed to the stage that produced them. A path is
 * stranded when it is dirty in the FINAL snapshot but was not dirty before any
 * stage ran — so a path a later stage restores to its committed state never
 * counts (the finished tree is what the proof vouches for). Each strand is
 * attributed to the FIRST snapshot that shows it dirty; stages appear in run
 * order, paths sorted within a stage. Pure — the testable core of the strand
 * decision.
 */
export function strandedByStage(
  before: Set<string>,
  snapshots: readonly StageSnapshot[],
): StageStrands[] {
  const final = snapshots.at(-1)?.dirty;
  if (final === undefined) {
    return [];
  }
  const stranded = [...final].filter((p) => !before.has(p)).sort();
  const byStage = new Map<FailedStage, string[]>();
  for (const path of stranded) {
    const origin = snapshots.find((s) => s.dirty.has(path));
    if (origin === undefined) {
      continue; // unreachable: `path` came from the final snapshot
    }
    const paths = byStage.get(origin.stage);
    if (paths === undefined) {
      byStage.set(origin.stage, [path]);
    } else {
      paths.push(path);
    }
  }
  return [...byStage].map(([stage, paths]) => ({ stage, paths }));
}

/** The human phrase for a strand's origin stage. */
function stagePhrase(stage: FailedStage): string {
  return stage === "scope_gates" ? "a scope gate" : `the ${stage} stage`;
}

/**
 * The Tier-0 {@link Diagnostic} for stranded gate output: the committed-clean files
 * each stage dirtied, a capped `git diff` of them (so the agent sees the change is the
 * gate's own — usually trivial), and the commit-then-re-run instructions. `git diff` is
 * the reproduce command: it shows exactly what is left to commit.
 */
export async function treeDriftDiagnostic(
  root: string,
  strands: StageStrands[],
): Promise<Diagnostic> {
  const paths = strands.flatMap((s) => s.paths);
  const stages = strands.map((s) => stagePhrase(s.stage));
  const origin = stages.length === 1
    ? (stages[0] ?? "the gate")
    : "gate stages";
  const shown = paths.slice(0, 10).join(", ");
  const more = paths.length > 10 ? `, … (+${paths.length - 10} more)` : "";
  const diff = await runGit(["diff", "--", ...paths], { cwd: root });
  const outputFields = await diagnosticOutputFields(
    root,
    `The gate dirtied ${paths.length} tracked file(s) that were committed-clean at ` +
      `the start of this run, leaving uncommitted changes:\n` +
      strands.flatMap((s) =>
        s.paths.map((p) => `  • ${p} (${stagePhrase(s.stage)})`)
      ).join("\n") +
      `\n\nThis is the gate's own output — the named stage produced it while ` +
      `running. Review it, commit it (e.g. \`git add -A && git commit\`), then ` +
      `re-run \`discern done\`. A green \`discern done\` run must mean a clean ` +
      `tree: accepting now would strand these changes staged-but-uncommitted ` +
      `in the main checkout.` +
      (diff.success && diff.stdout.trim() !== "" ? `\n\n${diff.stdout}` : ""),
  );
  return {
    tool: "tree-drift",
    severity: "error",
    message:
      `${origin} left ${paths.length} tracked file(s) uncommitted: ${shown}${more}`,
    reproduce_cmd: "git diff",
    ...outputFields,
  };
}
