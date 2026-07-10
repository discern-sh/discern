/**
 * Fix-stage strand detection (ADR 0047) — the gate's guard against a CLEAN finish
 * that nonetheless leaves uncommitted fixer output in the working tree.
 *
 * The fix stage is *meant* to mutate (a formatter, a codemod). The danger is narrow:
 * a fixer that reformats a file which was COMMITTED-clean at the start of the run
 * leaves an uncommitted change a green gate hides — and that `discern graduate` later
 * scoops up staged-but-uncommitted in the main checkout, surprising the agent.
 *
 * The signal is surgical: snapshot the TRACKED-dirty set immediately before the fix
 * stage (D0) and immediately after it (D1); the stranded files are `D1 \ D0` — tracked
 * paths the fix stage dirtied that were NOT already dirty. A fixer reworking the
 * agent's OWN uncommitted edits (the inner loop) touches files already in D0, so it
 * never trips; only a fixer touching a committed-clean file does. Comparing by PATH
 * (not by porcelain line) means a file whose status code merely changed — a staged
 * edit the fixer extends — is not mistaken for a fresh strand.
 *
 * Scope: TRACKED changes only — exactly what CI's trailing `git diff --exit-code`
 * catches, the guard this check brings to the local gate (ADR 0047). A fixer that
 * emits a brand-new UNTRACKED file is out of scope: it shows plainly as `??` in git
 * status and `git diff` ignores it too, so a codemod that creates a file (and the
 * scope gate that validates it) is unaffected.
 */

import type { Diagnostic } from "../../shared/result.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import {
  parsePorcelainPaths,
  repoPathPrefix,
  stripRepoPathPrefix,
} from "../scopes/scopes.ts";
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
    ["status", "--porcelain=v1", "--untracked-files=no"],
    { cwd: root },
  );
  if (!r.success) {
    return null;
  }
  return new Set(stripRepoPathPrefix(parsePorcelainPaths(r.stdout), prefix));
}

/**
 * The stranded paths: dirty AFTER the fix stage but not before (`D1 \ D0`), sorted for
 * stable output. Pure — the testable core of the strand decision.
 */
export function fixDriftPaths(
  before: Set<string>,
  after: Set<string>,
): string[] {
  return [...after].filter((p) => !before.has(p)).sort();
}

/**
 * The Tier-0 {@link Diagnostic} for stranded fix-stage output: the committed-clean
 * files the fix stage reformatted, a capped `git diff` of them (so the agent sees the
 * change is the fixer's own — usually trivial), and the commit-then-re-run guidance.
 * `git diff` is the reproduce command: it shows exactly what is left to commit.
 */
export async function fixDriftDiagnostic(
  root: string,
  paths: string[],
): Promise<Diagnostic> {
  const shown = paths.slice(0, 10).join(", ");
  const more = paths.length > 10 ? `, … (+${paths.length - 10} more)` : "";
  const diff = await runGit(["diff", "--", ...paths], { cwd: root });
  const outputFields = await diagnosticOutputFields(
    `The fix stage reformatted ${paths.length} file(s) that were committed-clean at ` +
      `the start of this run, leaving uncommitted changes:\n` +
      paths.map((p) => `  • ${p}`).join("\n") +
      `\n\nThis is the fix stage's own output — review it, commit it ` +
      `(e.g. \`git add -A && git commit\`), then re-run \`discern finish\`. A clean ` +
      `finish must mean a clean tree: graduating now would strand these changes ` +
      `staged-but-uncommitted in the main checkout.` +
      (diff.success && diff.stdout.trim() !== "" ? `\n\n${diff.stdout}` : ""),
  );
  return {
    tool: "fix",
    severity: "error",
    message:
      `fix stage left ${paths.length} file(s) uncommitted: ${shown}${more}`,
    reproduce_cmd: "git diff",
    ...outputFields,
  };
}
