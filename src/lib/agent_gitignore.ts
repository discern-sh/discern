/**
 * Registry-driven `.gitignore` convergence for agent build artifacts.
 *
 * Every compiled guidance file and materialized skills dir is a gitignored build
 * artifact. The SEED fragment (`templates/.gitignore.fragment`) lists today's, and
 * the parity test (`tests/agent_parity_test.ts`) keeps it covering every known
 * agent for FRESH installs. This module is the other half: a single idempotent,
 * registry-derived reconciler that EXISTING installs run on every `upgrade`, so when
 * a future agent is added to the registry its artifacts get ignored automatically —
 * no bespoke per-agent migration, no second hand-maintained list (ADR 0043).
 *
 * It is purely ADDITIVE and conservative: it only appends ignore lines that are not
 * already covered (an exact rule OR an ancestor wildcard like `/.claude/*`), so a
 * correctly-configured install is an untouched no-op, and it never reorders or
 * removes a user's own rules.
 */

import { join } from "@std/path";
import { agentArtifactPaths } from "./providers.ts";

/** The marker the reconciler appends its added lines under (distinct from the seed
 * fragment's own `# --- discern harness ---` banner). */
const CONVERGE_MARKER = "# discern: agent build artifacts (registry-derived)";

/** Is `path` (a generated file) already ignored by some line in `lines`? Matches an
 * exact rule with or without a leading slash. */
function fileCovered(lines: string[], path: string): boolean {
  return lines.includes(`/${path}`) || lines.includes(path);
}

/** Is the materialized dir `dir` already ignored — by an exact `/<dir>/` rule, or by
 * an ancestor wildcard such as `/.claude/*` (which covers `.claude/skills`)? Mirrors
 * the parity test's coverage check and git's own semantics closely enough to avoid a
 * redundant rule. */
function dirCovered(lines: string[], dir: string): boolean {
  const top = dir.split("/")[0];
  return [`/${dir}`, `/${dir}/`, `${dir}/`, `/${top}/*`, `/${top}/`, `/${top}`]
    .some((v) => lines.includes(v));
}

/**
 * Reconcile `.gitignore` text against the registry's agent artifacts: return the
 * (possibly unchanged) text plus the ignore lines added. Pure — the FS wrapper
 * {@link ensureAgentArtifactsIgnored} reads/writes; this is the testable transform.
 */
export function reconcileAgentIgnores(
  existing: string,
  artifacts: { guidanceFiles: string[]; skillsDirs: string[] } =
    agentArtifactPaths(),
): { text: string; added: string[] } {
  const lines = existing.split("\n").map((l) => l.trim());
  const added: string[] = [];

  for (const f of artifacts.guidanceFiles) {
    if (!fileCovered(lines, f)) {
      added.push(`/${f}`);
    }
  }
  for (const d of artifacts.skillsDirs) {
    if (!dirCovered(lines, d)) {
      added.push(`/${d}/`);
    }
  }
  if (added.length === 0) {
    return { text: existing, added: [] };
  }

  const base = existing.replace(/\n+$/, "");
  const text = `${base}\n\n${CONVERGE_MARKER}\n${added.join("\n")}\n`;
  return { text, added };
}

/**
 * Ensure `<destDir>/.gitignore` ignores every CURRENT-registry agent artifact,
 * idempotently. Returns the lines added (empty = already current, or no `.gitignore`
 * to amend — `init` always seeds one, so an absent file means "not a discern install
 * yet" and is left alone). The forward-looking complement to the seed fragment: a new
 * agent in the registry is covered on the next upgrade with no migration code.
 */
export async function ensureAgentArtifactsIgnored(
  destDir: string,
): Promise<string[]> {
  const path = join(destDir, ".gitignore");
  let existing: string;
  try {
    existing = await Deno.readTextFile(path);
  } catch {
    return []; // no .gitignore — nothing to amend.
  }
  const { text, added } = reconcileAgentIgnores(existing);
  if (added.length === 0) {
    return [];
  }
  await Deno.writeTextFile(path, text);
  return added;
}
