/**
 * Canonical `.gitignore` convergence for discern-owned artifacts.
 *
 * Fresh setup and mutating upgrade both use the same model: the project owns the
 * rest of `.gitignore`, while discern owns exactly one delimited block. The block
 * is authored in `templates/.gitignore.fragment`, widened from the provider
 * registry for generated agent artifacts, and reconciled idempotently into
 * existing installs by absorbing old one-off `# discern:` fragments and scattered
 * legacy rules.
 */

import { join } from "@std/path";
import { agentArtifactPaths } from "./providers.ts";
import { resolveTemplatesDir } from "./paths.ts";
import type { EnvReader } from "../shared/env.ts";
import { runGit } from "../shared/subprocess.ts";

export const DISCERN_GITIGNORE_BEGIN = "# --- discern ---";
export const DISCERN_GITIGNORE_END = "# --- /discern ---";

const GITIGNORE_FRAGMENT_NAME = ".gitignore.fragment";
const TARGET_REL = ".gitignore";

export interface GitignoreArtifactSet {
  guidanceFiles: string[];
  skillsDirs: string[];
}

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

/**
 * Return the block setup and upgrade should write, ensuring the static fragment
 * has delimiters and every registry-declared agent artifact is covered.
 */
export function canonicalDiscernGitignoreBlock(
  fragment: string,
  artifacts: GitignoreArtifactSet = agentArtifactPaths(),
): string {
  const normalized = normalizeLineEndings(fragment).replace(/\n+$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const withoutEnd = lines.filter((line) =>
    line.trim() !== DISCERN_GITIGNORE_END
  );
  if ((withoutEnd[0] ?? "").trim() !== DISCERN_GITIGNORE_BEGIN) {
    withoutEnd.unshift(DISCERN_GITIGNORE_BEGIN);
  }

  const coverageLines = withoutEnd.map((line) => line.trim());
  const additions: string[] = [];
  for (const file of artifacts.guidanceFiles) {
    if (!ignoreCovers(coverageLines, file, false)) {
      const rule = `/${file}`;
      additions.push(rule);
      coverageLines.push(rule);
    }
  }
  for (const dir of artifacts.skillsDirs) {
    if (!ignoreCovers(coverageLines, dir, true)) {
      const rule = `/${dir}/`;
      additions.push(rule);
      coverageLines.push(rule);
    }
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
  artifacts: GitignoreArtifactSet = agentArtifactPaths(),
): GitignoreReconcileResult {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const normalized = normalizeLineEndings(existing);
  const canonical = canonicalDiscernGitignoreBlock(fragment, artifacts);
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
    return await Deno.readTextFile(join(templatesDir, GITIGNORE_FRAGMENT_NAME));
  } catch {
    return undefined;
  }
}

/** Plan `.gitignore` reconciliation without touching disk. */
export async function planDiscernGitignoreBlock(
  destDir: string,
  env: EnvReader = Deno.env,
): Promise<GitignoreFileReconcileResult> {
  const fragment = await readGitignoreFragment(env);
  if (fragment === undefined) {
    return { operations: [], templateAvailable: false };
  }
  const existing = await readTextIfExists(join(destDir, TARGET_REL)) ?? "";
  const result = reconcileDiscernGitignore(existing, fragment);
  return {
    operations: result.operations,
    templateAvailable: true,
  };
}

/** Reconcile `<destDir>/.gitignore` on disk. */
export async function ensureDiscernGitignoreBlock(
  destDir: string,
  env: EnvReader = Deno.env,
): Promise<GitignoreFileReconcileResult> {
  const fragment = await readGitignoreFragment(env);
  if (fragment === undefined) {
    return { operations: [], templateAvailable: false };
  }
  const path = join(destDir, TARGET_REL);
  const existing = await readTextIfExists(path) ?? "";
  const result = reconcileDiscernGitignore(existing, fragment);
  if (result.operations.length > 0) {
    await Deno.writeTextFile(path, result.text);
  }
  return {
    operations: result.operations,
    templateAvailable: true,
  };
}

/** Git-tracked paths that match discern's own generated/local ignore rules. */
export async function trackedDiscernIgnoredArtifacts(
  root: string,
  env: EnvReader = Deno.env,
): Promise<TrackedDiscernIgnoredArtifacts> {
  const artifacts = agentArtifactPaths();
  const fragment = await readGitignoreFragment(env);
  const block = canonicalDiscernGitignoreBlock(fragment ?? "", artifacts);
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

export function trackedDiscernIgnoredArtifactsHint(
  tracked: TrackedDiscernIgnoredArtifacts,
): string {
  return `Discern-managed ignored artifacts are tracked by Git (${
    summarizePaths(tracked.paths)
  }); remove them from the index with \`${
    gitRmCachedCommand(tracked.repairTargets)
  }\`, then run \`discern refresh\`.`;
}

export function gitRmCachedCommand(paths: readonly string[]): string {
  return `git rm -r --cached -- ${paths.map(shellQuote).join(" ")}`;
}

export function gitLsFilesCommand(paths: readonly string[]): string {
  return `git ls-files -- ${paths.map(shellQuote).join(" ")}`;
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

interface ManagedIgnoreRule {
  negated: boolean;
  path: string;
  directory: boolean;
  wildcardChildren: boolean;
}

function managedIgnoreRules(block: string): ManagedIgnoreRule[] {
  return block.split("\n").flatMap((line) => {
    const rule = parseManagedIgnoreRule(line);
    return rule === undefined ? [] : [rule];
  });
}

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

function trackedCandidateRoots(rules: readonly ManagedIgnoreRule[]): string[] {
  return unique(
    rules.filter((rule) => !rule.negated).map((rule) => rule.path),
  );
}

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

function pathMatchesRule(path: string, rule: ManagedIgnoreRule): boolean {
  if (rule.directory || rule.wildcardChildren) {
    return path === rule.path || path.startsWith(`${rule.path}/`);
  }
  return path === rule.path;
}

function repairTargetsFor(
  paths: readonly string[],
  artifacts: GitignoreArtifactSet,
): string[] {
  const targets: string[] = [];
  const covered = new Set<string>();
  for (
    const dir of [...artifacts.skillsDirs].sort((a, b) => b.length - a.length)
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
    pushUnique(targets, collapseWildcardRepairTarget(path));
  }
  return targets;
}

function collapseWildcardRepairTarget(path: string): string {
  if (!path.startsWith(".claude/")) {
    return path;
  }
  const [, child] = path.split("/");
  return child === undefined ? path : `.claude/${child}`;
}

function summarizePaths(paths: readonly string[], limit = 8): string {
  const shown = paths.slice(0, limit).join(", ");
  return paths.length <= limit
    ? shown
    : `${shown}, +${paths.length - limit} more`;
}

function gitPathNeedsQuoting(path: string): boolean {
  return !/^[A-Za-z0-9_./:@%+=,-]+$/.test(path);
}

function shellQuote(path: string): string {
  return gitPathNeedsQuoting(path)
    ? `'${path.replaceAll("'", "'\\''")}'`
    : path;
}

function splitNul(text: string): string[] {
  return text.split("\0").filter((part) => part !== "");
}

function unique(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    pushUnique(out, value);
  }
  return out;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function trimFinalSplit(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

interface StripResult {
  lines: string[];
  insertionIndex?: number;
}

function stripDiscernOwnedLines(
  lines: string[],
  canonical: string,
  artifacts: GitignoreArtifactSet,
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

    if (isLegacyDiscernMarker(trimmed)) {
      insertionIndex ??= kept.length;
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

function findClosingMarker(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === DISCERN_GITIGNORE_END) {
      return i;
    }
  }
  return -1;
}

function isLegacyBlockOwnedLine(
  line: string,
  canonicalOwned: Set<string>,
  artifacts: GitignoreArtifactSet,
): boolean {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed === "...") {
    return true;
  }
  if (isSectionMarker(trimmed)) {
    return false;
  }
  return canonicalOwned.has(trimmed) ||
    isLegacyDiscernComment(trimmed) ||
    isDiscernOwnedRule(trimmed, artifacts);
}

function isStandaloneDiscernOwnedLine(
  line: string,
  canonicalOwned: Set<string>,
  artifacts: GitignoreArtifactSet,
): boolean {
  const trimmed = line.trim();
  return trimmed !== "" &&
    (canonicalOwned.has(trimmed) ||
      isLegacyDiscernComment(trimmed) ||
      isDiscernOwnedRule(trimmed, artifacts));
}

function isSectionMarker(line: string): boolean {
  return /^# --- .+ ---$/.test(line) &&
    line !== DISCERN_GITIGNORE_BEGIN &&
    line !== DISCERN_GITIGNORE_END;
}

function isLegacyDiscernMarker(line: string): boolean {
  return /^# discern:/.test(line);
}

function isLegacyDiscernComment(line: string): boolean {
  return isLegacyDiscernMarker(line) ||
    line ===
      "# Per-branch work evidence captured by the gate (runtime store, not source).";
}

function isDiscernOwnedRule(
  line: string,
  artifacts: GitignoreArtifactSet,
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
  const ownedPaths = new Set<string>([
    ...artifacts.guidanceFiles,
    ...artifacts.skillsDirs,
    ".claude",
    ".claude/*",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".discern",
    ".discern/*",
    ".discern/skills",
    ".discern/evidence",
    ".discern/worktrees",
    ".discern-rescue",
    ".ai/skills",
  ]);
  return ownedPaths.has(parsed.path);
}

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
