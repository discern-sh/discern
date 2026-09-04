/**
 * Canonical `.gitignore` convergence for discern-owned artifacts.
 *
 * Fresh setup and mutating upgrade both use the same model: the project owns the
 * rest of `.gitignore`, while discern owns exactly one delimited block. The block
 * enumerates ONLY what discern materializes or keeps machine-local (the
 * registry's ignored artifact kinds) — the compiled instruction files stay tracked,
 * so they never appear in it. It is authored in `templates/.gitignore.fragment`,
 * widened from the provider registry, and reconciled idempotently into existing
 * installs by reconciling that exact owned region and the exact rules discern
 * declares as its own.
 */

import { isAbsolute, join, relative } from "@std/path";
import {
  type AgentArtifactPosture,
  agentArtifactPosture,
  allInstructionFilePaths,
} from "./providers.ts";
import { resolveTemplatesDir } from "./paths.ts";
import type { EnvReader } from "../shared/env.ts";
import { readTextIfExists } from "../shared/fs_presence.ts";
import { fire, type FiredHint, HINTS } from "../shared/hints.ts";
import { runGit } from "../shared/subprocess.ts";
import { generatedArtifactMarker } from "../shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../shared/file_ownership.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import { resolveWorktreeRoot } from "./worktree_root.ts";
import { DISCERN_MANAGED_BLOCK } from "../shared/git_conventions.ts";

export const DISCERN_GITIGNORE_BEGIN = DISCERN_MANAGED_BLOCK.begin;
export const DISCERN_GITIGNORE_END = DISCERN_MANAGED_BLOCK.end;

const GITIGNORE_FRAGMENT_NAME = ".gitignore.fragment";
const TARGET_REL = ".gitignore";

export interface GitignoreReconcileOperation {
  kind: "create-block" | "replace-block";
  path: typeof TARGET_REL;
}

export interface GitignoreReconcileResult {
  text: string;
  operations: GitignoreReconcileOperation[];
}

export interface GitignoreFileReconcileResult {
  operations: GitignoreReconcileOperation[];
  templateAvailable: boolean;
}

export interface TrackedDiscernIgnoredArtifacts {
  paths: string[];
  repairTargets: string[];
}

/**
 * Is `path` already ignored by some line in `lines` — by an exact rule (with or
 * without a leading/trailing slash), or by an ancestor wildcard of its first
 * segment (`/.claude/*` covers `.claude/skills` AND `.claude/rules.md`)? The
 * parity test shares this ONE coverage definition with the reconciler.
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

/** Resolve the configured worktree root when it lives inside the repository. */
export function nestedWorktreeIgnorePath(
  repoRoot: string,
  config: DiscernConfig,
): string | undefined {
  const path = relative(repoRoot, resolveWorktreeRoot(repoRoot, config))
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/+$/u, "");
  return path === "" || path === ".." || path.startsWith("../") ||
      isAbsolute(path)
    ? undefined
    : path;
}

/**
 * Return the block setup and upgrade should write, ensuring the static fragment
 * has delimiters and every registry-declared IGNORED artifact — a materialized
 * directory or a machine-local state file — is covered. Instruction files are
 * tracked, so they are never widened in.
 */
export function canonicalDiscernGitignoreBlock(
  fragment: string,
  artifacts: AgentArtifactPosture = agentArtifactPosture(),
  env: EnvReader = Deno.env,
  nestedWorktreeRoot?: string,
): string {
  const normalized = normalizeLineEndings(fragment).replace(/\n+$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const withoutEnd = lines.filter((line) =>
    line.trim() !== DISCERN_GITIGNORE_END
  );
  if ((withoutEnd[0] ?? "").trim() !== DISCERN_GITIGNORE_BEGIN) {
    withoutEnd.unshift(DISCERN_GITIGNORE_BEGIN);
  }
  const provenanceMarker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.gitignore,
    env,
  );
  if (!withoutEnd.includes(provenanceMarker)) {
    withoutEnd.splice(1, 0, provenanceMarker);
  }

  const coverageLines = withoutEnd.map((line) => line.trim());
  const additions: string[] = [];
  for (const file of artifacts.localStateFiles) {
    if (!ignoreCovers(coverageLines, file, false)) {
      const rule = `/${file}`;
      additions.push(rule);
      coverageLines.push(rule);
    }
  }
  for (const dir of artifacts.materializedDirs) {
    if (!ignoreCovers(coverageLines, dir, true)) {
      const rule = `/${dir}/`;
      additions.push(rule);
      coverageLines.push(rule);
    }
  }
  if (
    nestedWorktreeRoot !== undefined &&
    !ignoreCovers(coverageLines, nestedWorktreeRoot, true)
  ) {
    const rule = `/${nestedWorktreeRoot}/`;
    additions.push(rule);
    coverageLines.push(rule);
  }
  if (additions.length > 0) {
    withoutEnd.push(
      "# Agent artifacts discovered from the provider registry.",
      ...additions,
    );
  }
  return `${[...withoutEnd, DISCERN_GITIGNORE_END].join("\n")}\n`;
}

/** Reconcile one `.gitignore` text to the current discern-owned block. */
export function reconcileDiscernGitignore(
  existing: string,
  fragment: string,
  artifacts: AgentArtifactPosture = agentArtifactPosture(),
  env: EnvReader = Deno.env,
  nestedWorktreeRoot?: string,
): GitignoreReconcileResult {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const normalized = normalizeLineEndings(existing);
  const canonical = canonicalDiscernGitignoreBlock(
    fragment,
    artifacts,
    env,
    nestedWorktreeRoot,
  );
  const canonicalLines = trimFinalSplit(canonical);
  const stripped = stripDiscernOwnedLines(
    trimFinalSplit(normalized),
    canonical,
    artifacts,
  );
  const insertionIndex = stripped.insertionIndex ?? stripped.lines.length;
  const before = stripped.lines.slice(0, insertionIndex);
  const after = stripped.lines.slice(insertionIndex);

  const combined: string[] = [];
  combined.push(...before);
  if (combined.length > 0 && !isBlank(combined[combined.length - 1] ?? "")) {
    combined.push("");
  }
  combined.push(...canonicalLines);
  if (after.length > 0 && !isBlank(after[0] ?? "")) {
    combined.push("");
  }
  combined.push(...after);

  const reconciled = `${combined.join("\n")}\n`;
  if (reconciled === normalized) {
    return { text: existing, operations: [] };
  }

  const kind = normalized.trim() === "" ? "create-block" : "replace-block";
  return {
    text: eol === "\n" ? reconciled : reconciled.replaceAll("\n", eol),
    operations: [{ kind, path: TARGET_REL }],
  };
}

/** Read the shipped `.gitignore` fragment, or report that it is unavailable. */
export async function readGitignoreFragment(
  env: EnvReader = Deno.env,
): Promise<string | undefined> {
  try {
    const templatesDir = await resolveTemplatesDir(env);
    return await readTextIfExists(join(templatesDir, GITIGNORE_FRAGMENT_NAME));
  } catch {
    // discern-best-effort: agent-gitignore-template-fallback
    return undefined;
  }
}

/** Plan `.gitignore` reconciliation without touching disk. */
export async function planDiscernGitignoreBlock(
  destDir: string,
  config?: DiscernConfig,
  env: EnvReader = Deno.env,
): Promise<GitignoreFileReconcileResult> {
  const fragment = await readGitignoreFragment(env);
  if (fragment === undefined) {
    return { operations: [], templateAvailable: false };
  }
  const existing = await readTextIfExists(join(destDir, TARGET_REL)) ?? "";
  const result = reconcileDiscernGitignore(
    existing,
    fragment,
    agentArtifactPosture(),
    env,
    config === undefined
      ? undefined
      : nestedWorktreeIgnorePath(destDir, config),
  );
  return {
    operations: result.operations,
    templateAvailable: true,
  };
}

/** Reconcile `<destDir>/.gitignore` on disk. */
export async function ensureDiscernGitignoreBlock(
  destDir: string,
  config?: DiscernConfig,
  env: EnvReader = Deno.env,
): Promise<GitignoreFileReconcileResult> {
  const fragment = await readGitignoreFragment(env);
  if (fragment === undefined) {
    return { operations: [], templateAvailable: false };
  }
  const path = join(destDir, TARGET_REL);
  const existing = await readTextIfExists(path) ?? "";
  const result = reconcileDiscernGitignore(
    existing,
    fragment,
    agentArtifactPosture(),
    env,
    config === undefined
      ? undefined
      : nestedWorktreeIgnorePath(destDir, config),
  );
  if (result.operations.length > 0) {
    await Deno.writeTextFile(path, result.text);
  }
  return {
    operations: result.operations,
    templateAvailable: true,
  };
}

/** Git-tracked paths that match discern's own materialized/local ignore rules —
 * scoped to the canonical block, so a user's own files under a provider's
 * directory (e.g. a tracked `.claude/commands/`) are never flagged. */
export async function trackedDiscernIgnoredArtifacts(
  root: string,
  env: EnvReader = Deno.env,
): Promise<TrackedDiscernIgnoredArtifacts> {
  const artifacts = agentArtifactPosture();
  const fragment = await readGitignoreFragment(env);
  const block = canonicalDiscernGitignoreBlock(
    fragment ?? "",
    artifacts,
    env,
  );
  const rules = managedIgnoreRules(block);
  const candidates = trackedCandidateRoots(rules);
  if (candidates.length === 0) {
    return { paths: [], repairTargets: [] };
  }

  const tracked = await runGit(["ls-files", "-z", "--", ...candidates], {
    cwd: root,
  });
  if (!tracked.success) {
    return { paths: [], repairTargets: [] };
  }

  const paths = unique(
    splitNul(tracked.stdout).filter((path) =>
      isIgnoredByManagedRules(
        path,
        rules,
      )
    ),
  ).sort();
  return { paths, repairTargets: repairTargetsFor(paths, artifacts) };
}

/**
 * Compiled instruction files present on disk but untracked AND not ignored — the
 * state an existing install lands in after upgrade narrows the managed ignore
 * block. Advisory input for a commit recommendation: an out-of-harness agent
 * reading a bare clone only gets the instructions once these are committed. A
 * project that deliberately ignores a compiled file in its OWN rules is
 * respected — git excludes an ignored file from this list, so no hint nags it.
 */
export async function untrackedInstructionFiles(
  root: string,
): Promise<string[]> {
  const run = await runGit(
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...allInstructionFilePaths(),
    ],
    { cwd: root },
  );
  if (!run.success) {
    return [];
  }
  return unique(splitNul(run.stdout)).sort();
}

/** Fire the advisory that asks the operator to commit newly trackable instructions. */
export function untrackedInstructionFilesHint(
  paths: readonly string[],
): FiredHint {
  return fire(HINTS["untracked-agent-files"], { paths });
}

/** Fire the repair advisory for discern-owned artifacts that Git already tracks. */
export function trackedDiscernIgnoredArtifactsHint(
  tracked: TrackedDiscernIgnoredArtifacts,
): FiredHint {
  return fire(HINTS["tracked-ignored-artifacts"], {
    pathSummary: summarizePaths(tracked.paths),
    repairCommand: gitRmCachedCommand(tracked.repairTargets),
  });
}

/** Render a shell-safe command that removes paths from Git's index without deleting them. */
export function gitRmCachedCommand(paths: readonly string[]): string {
  return `git rm -r --cached -- ${paths.map(shellQuote).join(" ")}`;
}

/** Render a shell-safe command for inspecting selected paths in Git's index. */
export function gitLsFilesCommand(paths: readonly string[]): string {
  return `git ls-files -- ${paths.map(shellQuote).join(" ")}`;
}

/** Convert CRLF and lone CR boundaries to LF for deterministic reconciliation. */
function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

interface ManagedIgnoreRule {
  negated: boolean;
  path: string;
  directory: boolean;
  wildcardChildren: boolean;
}

/** Parse actionable patterns from the managed block, dropping comments and blanks. */
function managedIgnoreRules(block: string): ManagedIgnoreRule[] {
  return block.split("\n").flatMap((line) => {
    const rule = parseManagedIgnoreRule(line);
    return rule === undefined ? [] : [rule];
  });
}

/** Decode one managed pattern into its negation and descendant-matching semantics. */
function parseManagedIgnoreRule(line: string): ManagedIgnoreRule | undefined {
  const withoutComment = line.split("#", 1)[0]?.trim() ?? "";
  if (withoutComment === "") {
    return undefined;
  }
  const negated = withoutComment.startsWith("!");
  const unnegated = negated ? withoutComment.slice(1) : withoutComment;
  const withoutLeadingSlash = unnegated.replace(/^\/+/, "");
  const wildcardChildren = withoutLeadingSlash.endsWith("/*");
  const directory = !wildcardChildren && withoutLeadingSlash.endsWith("/");
  const path = wildcardChildren
    ? withoutLeadingSlash.slice(0, -2).replace(/\/+$/, "")
    : withoutLeadingSlash.replace(/\/+$/, "");
  if (path === "") {
    return undefined;
  }
  return { negated, path, directory, wildcardChildren };
}

/** Deduplicate positive rule paths before using them as bounded Git pathspecs. */
function trackedCandidateRoots(rules: readonly ManagedIgnoreRule[]): string[] {
  return unique(
    rules.filter((rule) => !rule.negated).map((rule) => rule.path),
  );
}

/** Apply managed rules in order so later negations override earlier matches. */
function isIgnoredByManagedRules(
  path: string,
  rules: readonly ManagedIgnoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (pathMatchesRule(path, rule)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

/** Match an exact path or any descendant covered by a directory-style rule. */
function pathMatchesRule(path: string, rule: ManagedIgnoreRule): boolean {
  if (rule.directory || rule.wildcardChildren) {
    return path === rule.path || path.startsWith(`${rule.path}/`);
  }
  return path === rule.path;
}

/** Collapse tracked children under materialized roots while retaining uncovered files. */
function repairTargetsFor(
  paths: readonly string[],
  artifacts: AgentArtifactPosture,
): string[] {
  const targets: string[] = [];
  const covered = new Set<string>();
  for (
    const dir of [...artifacts.materializedDirs].sort((a, b) =>
      b.length - a.length
    )
  ) {
    const hasTrackedChild = paths.some((path) =>
      path === dir || path.startsWith(`${dir}/`)
    );
    if (!hasTrackedChild) {
      continue;
    }
    pushUnique(targets, dir);
    for (const path of paths) {
      if (path === dir || path.startsWith(`${dir}/`)) {
        covered.add(path);
      }
    }
  }

  for (const path of paths) {
    if (covered.has(path)) {
      continue;
    }
    pushUnique(targets, path);
  }
  return targets;
}

/** Join at most `limit` paths and append the count omitted from the advisory. */
function summarizePaths(paths: readonly string[], limit = 8): string {
  const shown = paths.slice(0, limit).join(", ");
  return paths.length <= limit
    ? shown
    : `${shown}, +${paths.length - limit} more`;
}

/** Detect characters that make a Git path unsafe as an unquoted shell word. */
function gitPathNeedsQuoting(path: string): boolean {
  return !/^[A-Za-z0-9_./:@%+=,-]+$/.test(path);
}

/** Preserve safe path spelling and single-quote paths that need shell protection. */
function shellQuote(path: string): string {
  return gitPathNeedsQuoting(path)
    ? `'${path.replaceAll("'", "'\\''")}'`
    : path;
}

/** Decode Git's NUL-delimited stdout and discard the terminal empty field. */
function splitNul(text: string): string[] {
  return text.split("\0").filter((part) => part !== "");
}

/** Preserve first-seen order while deduplicating strings. */
function unique(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    pushUnique(out, value);
  }
  return out;
}

/** Append `value` only when the ordered collection does not contain it yet. */
function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

/** Split text into lines without treating its final newline as an extra row. */
function trimFinalSplit(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Treat whitespace-only rows as separators during block reconciliation. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

interface StripResult {
  lines: string[];
  insertionIndex?: number;
}

/** Remove current and earlier discern fragments while retaining their insertion point. */
function stripDiscernOwnedLines(
  lines: string[],
  canonical: string,
  artifacts: AgentArtifactPosture,
): StripResult {
  const canonicalOwned = new Set(
    canonical.split("\n").map((line) => line.trim()).filter((line) =>
      line !== ""
    ),
  );
  const kept: string[] = [];
  let insertionIndex: number | undefined;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed === DISCERN_GITIGNORE_BEGIN) {
      insertionIndex ??= kept.length;
      const end = findClosingMarker(lines, i + 1);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
      i++;
      while (
        i < lines.length &&
        isLegacyBlockOwnedLine(lines[i] ?? "", canonicalOwned, artifacts)
      ) {
        i++;
      }
      continue;
    }

    if (isStandaloneDiscernOwnedLine(line, canonicalOwned, artifacts)) {
      insertionIndex ??= kept.length;
      i++;
      continue;
    }

    kept.push(line);
    i++;
  }
  return insertionIndex === undefined
    ? { lines: kept }
    : { lines: kept, insertionIndex };
}

/** Locate an end delimiter after `start`, or report an unterminated block. */
function findClosingMarker(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === DISCERN_GITIGNORE_END) {
      return i;
    }
  }
  return -1;
}

/** Decide whether earlier-block cleanup can absorb a line without crossing user content. */
function isLegacyBlockOwnedLine(
  line: string,
  canonicalOwned: Set<string>,
  artifacts: AgentArtifactPosture,
): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed === "...") {
    return true;
  }
  if (isSectionMarker(trimmed)) {
    return false;
  }
  return canonicalOwned.has(trimmed) ||
    isDiscernOwnedRule(trimmed, artifacts);
}

/** Identify a discern-owned ignore line found outside a delimited block. */
function isStandaloneDiscernOwnedLine(
  line: string,
  canonicalOwned: Set<string>,
  _artifacts: AgentArtifactPosture,
): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#") &&
    canonicalOwned.has(trimmed);
}

/** Recognize another delimited section so earlier-block cleanup stops at its boundary. */
function isSectionMarker(line: string): boolean {
  return /^# --- .+ ---$/.test(line) &&
    line !== DISCERN_GITIGNORE_BEGIN &&
    line !== DISCERN_GITIGNORE_END;
}

/** Recognize every current or retired ignore pattern that an upgrade may absorb. */
function isDiscernOwnedRule(
  line: string,
  artifacts: AgentArtifactPosture,
): boolean {
  if (line === "" || line.startsWith("#")) {
    return false;
  }
  const parsed = normalizeRule(line);
  if (parsed === undefined) {
    return false;
  }
  if (parsed.negated) {
    return parsed.path === ".claude/settings.json" ||
      parsed.path === ".claude/settings.local.json";
  }
  // A marked earlier block may carry the current registry's tracked or
  // materialized artifacts. Retired private paths are deliberately absent.
  const ownedPaths = new Set<string>(
    discernOwnedArtifactIgnorePaths(artifacts),
  );
  return ownedPaths.has(parsed.path);
}

/** Registry-derived paths a marked earlier block may identify as discern-owned. */
export function discernOwnedArtifactIgnorePaths(
  artifacts: AgentArtifactPosture = agentArtifactPosture(),
): string[] {
  return [
    ...new Set([
      ...artifacts.instructionFiles,
      ...artifacts.materializedDirs,
      ...artifacts.localStateFiles,
    ]),
  ];
}

/** Strip comments and boundary syntax into the path form used for ownership checks. */
function normalizeRule(
  line: string,
): { negated: boolean; path: string } | undefined {
  const withoutComment = line.split("#", 1)[0]?.trim() ?? "";
  if (withoutComment === "") {
    return undefined;
  }
  const negated = withoutComment.startsWith("!");
  const unprefixed = negated ? withoutComment.slice(1) : withoutComment;
  const withoutLeadingSlash = unprefixed.replace(/^\/+/, "");
  const path = withoutLeadingSlash.replace(/\/+$/, "");
  if (path === "") {
    return undefined;
  }
  return { negated, path };
}
