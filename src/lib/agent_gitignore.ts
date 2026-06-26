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
import { runGit } from "../shared/subprocess.ts";

/** The marker the reconciler appends its added lines under (distinct from the seed
 * fragment's own `# --- discern harness ---` banner). */
const CONVERGE_MARKER = "# discern: agent build artifacts (registry-derived)";

/**
 * Is `path` already ignored by some line in `lines` — by an exact rule (with or
 * without a leading/trailing slash), or by an ancestor wildcard of its first segment
 * (`/.claude/*` covers `.claude/skills` AND `.claude/rules.md`)? The ONE coverage
 * definition, exported so the parity test ({@link import("../../tests/agent_parity_test.ts")})
 * shares it instead of re-implementing the variant list (a single source for the
 * gitignore semantics this module and that guard both depend on). `isDir` only widens
 * the exact forms; the ancestor-wildcard check is identical for files and dirs, so a
 * nested guidance file is recognised as covered just like a nested skills dir.
 */
export function ignoreCovers(
  lines: string[],
  path: string,
  isDir: boolean,
): boolean {
  const variants = isDir
    ? [`/${path}`, `/${path}/`, `${path}/`]
    : [`/${path}`, path];
  if (path.includes("/")) {
    const top = path.split("/")[0];
    variants.push(`/${top}/*`, `/${top}/`, `/${top}`);
  }
  return variants.some((v) => lines.includes(v));
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
    if (!ignoreCovers(lines, f, false)) {
      added.push(`/${f}`);
    }
  }
  for (const d of artifacts.skillsDirs) {
    if (!ignoreCovers(lines, d, true)) {
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

/** Which of `files` git already TRACKS under `destDir` (best-effort; empty set when
 * git is unavailable or the query fails). Lets the reconciler RESPECT a project's
 * deliberate choice to track a guidance file — ADR 0034 makes tracking a per-project
 * `.gitignore` decision, so it must not re-ignore a file the user committed on purpose. */
async function gitTrackedFiles(
  destDir: string,
  files: string[],
): Promise<Set<string>> {
  if (files.length === 0) {
    return new Set();
  }
  const r = await runGit(["ls-files", "--", ...files], { cwd: destDir });
  if (!r.success) {
    return new Set();
  }
  return new Set(
    r.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== ""),
  );
}

/**
 * Ensure `<destDir>/.gitignore` ignores every CURRENT-registry agent artifact,
 * idempotently. Returns the lines added (empty = already current, or no `.gitignore`
 * to amend — `init` always seeds one, so an absent file means "not a discern install
 * yet" and is left alone). The forward-looking complement to the seed fragment: a new
 * agent in the registry is covered on the next upgrade with no migration code.
 *
 * A guidance file the project deliberately TRACKS is excluded — re-ignoring it would
 * silently override the per-project tracking choice ADR 0034 sanctions (e.g. a repo
 * that commits AGENTS.md so it renders on its forge). Skills dirs carry no such
 * choice (a materialized dir is always generated), so they are not exempted.
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
  const artifacts = agentArtifactPaths();
  const tracked = await gitTrackedFiles(destDir, artifacts.guidanceFiles);
  const { text, added } = reconcileAgentIgnores(existing, {
    guidanceFiles: artifacts.guidanceFiles.filter((f) => !tracked.has(f)),
    skillsDirs: artifacts.skillsDirs,
  });
  if (added.length === 0) {
    return [];
  }
  await Deno.writeTextFile(path, text);
  return added;
}
