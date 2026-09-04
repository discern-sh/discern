/**
 * Canonical `.gitattributes` convergence for generated artifacts and discern's
 * registered Markdown surfaces.
 *
 * The project owns every byte outside one delimited block. The block is derived
 * from `[generated]` scope globs, tracked or present refresh-compiled Agent
 * files, and the source-path registry. Git attributes use a narrower pattern
 * language than scope classification, so the translator refuses forms whose
 * meaning cannot be preserved.
 */

import { join } from "@std/path";
import { classifyPattern } from "../engine/scopes/glob.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import {
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../shared/generated_artifacts.ts";
import { generatedArtifactMarker } from "../shared/brand.ts";
import type { EnvReader } from "../shared/env.ts";
import {
  fileExists,
  pathExists,
  readTextIfExists,
} from "../shared/fs_presence.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../shared/file_ownership.ts";
import { splitNulRecords } from "../shared/git_paths.ts";
import { runGit } from "../shared/subprocess.ts";
import { resolveSourcePaths } from "../shared/source_path_resolution.ts";
import {
  DISCERN_GENERATED_MERGE_DRIVER,
  DISCERN_MANAGED_BLOCK,
  DISCERN_MARKDOWN_DIFF_DRIVER,
  LINGUIST_GENERATED_ATTRIBUTE,
} from "../shared/git_conventions.ts";

export const DISCERN_GITATTRIBUTES_BEGIN = DISCERN_MANAGED_BLOCK.begin;
export const DISCERN_GITATTRIBUTES_END = DISCERN_MANAGED_BLOCK.end;
export {
  DISCERN_GENERATED_MERGE_DRIVER,
  DISCERN_MARKDOWN_DIFF_DRIVER,
  LINGUIST_GENERATED_ATTRIBUTE,
};
export const GITATTRIBUTES_REL = ".gitattributes";

export type GitattributesTranslation =
  | { readonly ok: true; readonly source: string; readonly pattern: string }
  | { readonly ok: false; readonly source: string; readonly reason: string };

export interface RefusedGitattributesPattern {
  readonly origin:
    | { readonly kind: "generated"; readonly group: string }
    | { readonly kind: "refresh" }
    | { readonly kind: "markdown"; readonly surface: string };
  readonly pattern: string;
  readonly reason: string;
}

/** One registered discern surface whose Markdown files use Git's driver. */
export interface DiscernMarkdownAttributePath {
  readonly surface: string;
  readonly path: string;
}

export interface GitattributesReconcileOperation {
  readonly kind: "create-block" | "replace-block" | "remove-block";
  readonly path: typeof GITATTRIBUTES_REL;
}

export interface GitattributesBlockResult {
  readonly text: string;
  /** Patterns that need the clone-local shared generated merge driver. */
  readonly patterns: string[];
  readonly refused: RefusedGitattributesPattern[];
}

export interface GitattributesReconcileResult extends GitattributesBlockResult {
  readonly operations: GitattributesReconcileOperation[];
}

export interface GitattributesFileReconcileResult {
  readonly operations: GitattributesReconcileOperation[];
  readonly patterns: string[];
  readonly refused: RefusedGitattributesPattern[];
}

export interface GitattributesFilePlan
  extends GitattributesFileReconcileResult {
  readonly existing: string | undefined;
  readonly text: string;
}

/** Build a refused scope-glob translation. */
function refused(source: string, reason: string): GitattributesTranslation {
  return { ok: false, source, reason };
}

/** Explain why a pattern cannot map safely to Git attributes syntax. */
function unsafeAttributesSyntax(pattern: string): string | undefined {
  if (/\s/u.test(pattern)) {
    return "whitespace changes how Git separates the pattern from its attributes";
  }
  if (pattern.startsWith("!")) {
    return "negative patterns are forbidden in .gitattributes";
  }
  if (pattern.startsWith("#") || pattern.startsWith('"')) {
    return "the leading character has special .gitattributes syntax";
  }
  if (pattern.includes("\\")) {
    return "backslash escaping differs between scope globs and .gitattributes";
  }
  if (/(?:^|\/)\.{1,2}(?:\/|$)/u.test(pattern)) {
    return "the path must be root-relative without dot segments";
  }
  if (pattern.includes("//")) {
    return "empty path segments have no stable .gitattributes meaning";
  }
  if (pattern.includes("{") || pattern.includes("}")) {
    return "brace expansion has no equivalent in .gitattributes";
  }
  if (/[?*+@!]\(/u.test(pattern)) {
    return "extended glob groups have no equivalent in .gitattributes";
  }
  return undefined;
}

/** Translate one scope-path glob into a root `.gitattributes` pattern. */
export function translateScopeGlobToGitattributes(
  source: string,
): GitattributesTranslation {
  if (source === "") {
    return refused(source, "an empty scope pattern matches no path");
  }
  const unsafe = unsafeAttributesSyntax(source);
  if (unsafe !== undefined) {
    return refused(source, unsafe);
  }

  const kind = classifyPattern(source);
  switch (kind?.name) {
    case "prefix-globstar": {
      const withoutRoot = source.replace(/^\//u, "");
      return {
        ok: true,
        source,
        pattern: withoutRoot === "**" ? "**" : withoutRoot,
      };
    }
    case "segment": {
      const segment = source.slice(1, -1);
      if (segment === "") {
        return refused(source, "an empty directory segment matches no file");
      }
      return { ok: true, source, pattern: `**/${segment}/**` };
    }
    case "prefix":
      return { ok: true, source, pattern: `${source}**` };
    case "suffix":
      return { ok: true, source, pattern: source };
    case "standard-glob": {
      if (source.endsWith("/")) {
        return refused(
          source,
          "a directory-only glob matches no tracked file consistently",
        );
      }
      const withoutRoot = source.replace(/^\//u, "");
      const pattern = withoutRoot.includes("/") || withoutRoot === "**"
        ? withoutRoot
        : `/${withoutRoot}`;
      return { ok: true, source, pattern };
    }
    case "exact": {
      if (source.startsWith("/")) {
        return refused(
          source,
          "a leading slash on an exact scope path matches no root-relative path",
        );
      }
      return {
        ok: true,
        source,
        pattern: `/${source}`,
      };
    }
    default:
      return refused(source, "the scope pattern has no recognized form");
  }
}

/** Append a value only when it is not already present. */
function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

/** Describe the declaration that supplied a pattern Git attributes cannot use. */
export function refusedGitattributesPatternLabel(
  refusedPattern: RefusedGitattributesPattern,
): string {
  switch (refusedPattern.origin.kind) {
    case "generated":
      return `[generated.${refusedPattern.origin.group}].paths`;
    case "refresh":
      return "the refresh-compiled Agent path";
    case "markdown":
      return `the registered ${refusedPattern.origin.surface} Markdown surface`;
  }
}

/** Derive Markdown patterns only from discern's registered authored surfaces. */
export function discernMarkdownAttributePaths(
  config: DiscernConfig,
): DiscernMarkdownAttributePath[] {
  const paths: DiscernMarkdownAttributePath[] = [];
  for (const entry of resolveSourcePaths(config)) {
    if (entry.pathKind === "file") {
      if (entry.path.toLowerCase().endsWith(".md")) {
        paths.push({
          surface: entry.name,
          path: entry.path,
        });
      }
      continue;
    }
    const directory = entry.path.replace(/\/+$/u, "");
    paths.push({
      surface: entry.name,
      path: `${directory}/**/*.md`,
    });
  }
  return paths;
}

interface PatternAttributes {
  merge: boolean;
  linguistGenerated: boolean;
  markdownDiff: boolean;
}

/** Build the complete discern-owned block for the supplied declarations. */
export function canonicalDiscernGitattributesBlock(
  groups: readonly ResolvedGeneratedGroup[],
  builtInPaths: readonly string[] = [],
  markdownPaths: readonly DiscernMarkdownAttributePath[] = [],
  env: EnvReader = Deno.env,
): GitattributesBlockResult {
  const patterns: string[] = [];
  const refusedPatterns: RefusedGitattributesPattern[] = [];
  const attributesByPattern = new Map<string, PatternAttributes>();

  const collect = (
    origin: RefusedGitattributesPattern["origin"],
    source: string,
    requested: PatternAttributes,
  ): void => {
    const translated = translateScopeGlobToGitattributes(source);
    if (translated.ok) {
      const attributes = attributesByPattern.get(translated.pattern) ?? {
        merge: false,
        linguistGenerated: false,
        markdownDiff: false,
      };
      attributes.merge ||= requested.merge;
      attributes.linguistGenerated ||= requested.linguistGenerated;
      attributes.markdownDiff ||= requested.markdownDiff;
      attributesByPattern.set(translated.pattern, attributes);
      if (requested.merge) {
        pushUnique(patterns, translated.pattern);
      }
      return;
    }
    refusedPatterns.push({
      origin,
      pattern: translated.source,
      reason: translated.reason,
    });
  };

  for (const group of groups) {
    for (const path of group.paths) {
      collect(
        { kind: "generated", group: group.name },
        path,
        {
          merge: true,
          linguistGenerated: group.linguistGenerated,
          markdownDiff: false,
        },
      );
    }
  }
  for (const path of builtInPaths) {
    collect(
      { kind: "refresh" },
      path,
      {
        merge: true,
        linguistGenerated: false,
        markdownDiff: path.toLowerCase().endsWith(".md"),
      },
    );
  }
  for (const markdown of markdownPaths) {
    collect(
      { kind: "markdown", surface: markdown.surface },
      markdown.path,
      { merge: false, linguistGenerated: false, markdownDiff: true },
    );
  }

  if (attributesByPattern.size === 0) {
    return {
      text: "",
      patterns,
      refused: refusedPatterns,
    };
  }
  const marker = generatedArtifactMarker(
    ARTIFACT_PROVENANCE_SOURCES.gitattributes,
    env,
  );
  const body = [...attributesByPattern.entries()].map(
    ([pattern, attributes]) => {
      const values: string[] = [];
      if (attributes.merge) {
        values.push(`merge=${DISCERN_GENERATED_MERGE_DRIVER}`);
      }
      if (attributes.linguistGenerated) {
        values.push(LINGUIST_GENERATED_ATTRIBUTE);
      }
      if (attributes.markdownDiff) {
        values.push(`diff=${DISCERN_MARKDOWN_DIFF_DRIVER}`);
      }
      return `${pattern} ${values.join(" ")}`;
    },
  );
  return {
    text: [
      DISCERN_GITATTRIBUTES_BEGIN,
      marker,
      ...body,
      DISCERN_GITATTRIBUTES_END,
      "",
    ].join("\n"),
    patterns,
    refused: refusedPatterns,
  };
}

interface TextLine {
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

interface BlockRange {
  readonly start: number;
  readonly end: number;
}

/** Index text lines while preserving their source offsets. */
function textLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  const pattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index;
    if (raw === "" || start === undefined) {
      continue;
    }
    lines.push({
      start,
      end: start + raw.length,
      content: raw.replace(/(?:\r\n|\r|\n)$/u, ""),
    });
  }
  return lines;
}

/** Locate each discern-owned block, including an unterminated final block. */
function managedBlockRanges(text: string): BlockRange[] {
  const ranges: BlockRange[] = [];
  let open: TextLine | undefined;
  for (const line of textLines(text)) {
    const content = line.content.trim();
    if (open === undefined && content === DISCERN_GITATTRIBUTES_BEGIN) {
      open = line;
      continue;
    }
    if (open !== undefined && content === DISCERN_GITATTRIBUTES_END) {
      ranges.push({ start: open.start, end: line.end });
      open = undefined;
    }
  }
  if (open !== undefined) {
    ranges.push({ start: open.start, end: text.length });
  }
  return ranges;
}

/** Detect the line-ending convention already used by the text. */
function lineEnding(text: string): string {
  if (text.includes("\r\n")) {
    return "\r\n";
  }
  if (text.includes("\r")) {
    return "\r";
  }
  return "\n";
}

/** Convert LF-delimited text to the selected line ending. */
function withLineEnding(text: string, eol: string): string {
  return eol === "\n" ? text : text.replaceAll("\n", eol);
}

/** Append a managed block without disturbing the existing final newline. */
function appendBlock(existing: string, block: string, eol: string): string {
  if (existing === "") {
    return block;
  }
  let prefix = existing;
  if (!/(?:\r\n|\r|\n)$/u.test(prefix)) {
    prefix += eol;
  }
  return `${prefix}${block}`;
}

/** Reconcile one `.gitattributes` text to its current discern-owned block. */
export function reconcileDiscernGitattributes(
  existing: string,
  groups: readonly ResolvedGeneratedGroup[],
  builtInPaths: readonly string[] = [],
  markdownPaths: readonly DiscernMarkdownAttributePath[] = [],
  env: EnvReader = Deno.env,
): GitattributesReconcileResult {
  const canonical = canonicalDiscernGitattributesBlock(
    groups,
    builtInPaths,
    markdownPaths,
    env,
  );
  const eol = lineEnding(existing);
  const block = withLineEnding(canonical.text, eol);
  const ranges = managedBlockRanges(existing);

  let text: string;
  if (ranges.length === 0) {
    text = block === "" ? existing : appendBlock(existing, block, eol);
  } else {
    let cursor = 0;
    let next = "";
    for (const [index, range] of ranges.entries()) {
      next += existing.slice(cursor, range.start);
      if (index === 0) {
        next += block;
      }
      cursor = range.end;
    }
    text = next + existing.slice(cursor);
  }

  if (text === existing) {
    return { ...canonical, text: existing, operations: [] };
  }
  const kind = block === ""
    ? "remove-block"
    : ranges.length === 0
    ? "create-block"
    : "replace-block";
  return {
    ...canonical,
    text,
    operations: [{ kind, path: GITATTRIBUTES_REL }],
  };
}

/** Return built-in candidates that are tracked or currently present. */
async function activeBuiltInPaths(
  root: string,
  candidates: readonly string[],
  materializedCandidates: readonly string[] = [],
): Promise<string[]> {
  if (candidates.length === 0) {
    return [];
  }
  const listed = await runGit(["ls-files", "-z", "--", ...candidates], {
    cwd: root,
  });
  const tracked = new Set(
    listed.success ? splitNulRecords(listed.stdout) : [],
  );
  const materialized = new Set(materializedCandidates);
  const active: string[] = [];
  for (const path of candidates) {
    if (materialized.has(path) || tracked.has(path)) {
      active.push(path);
      continue;
    }
    if (await fileExists(join(root, path))) {
      active.push(path);
    }
  }
  return active;
}

/** Path whose presence makes one registered Markdown surface active. */
function markdownSurfaceRoot(path: string): string {
  return path.endsWith("/**/*.md") ? path.slice(0, -"/**/*.md".length) : path;
}

/** Return only registered Markdown surfaces that exist or are tracked. */
async function activeMarkdownPaths(
  root: string,
  candidates: readonly DiscernMarkdownAttributePath[],
  materializedCandidates: readonly string[] = [],
): Promise<DiscernMarkdownAttributePath[]> {
  const roots = candidates.map((candidate) =>
    markdownSurfaceRoot(candidate.path)
  );
  const listed = roots.length === 0
    ? undefined
    : await runGit(["ls-files", "-z", "--", ...roots], { cwd: root });
  const tracked = new Set(
    listed?.success === true ? splitNulRecords(listed.stdout) : [],
  );
  const materialized = new Set(materializedCandidates);
  const active: DiscernMarkdownAttributePath[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const surfaceRoot = roots[index];
    if (surfaceRoot === undefined) continue;
    if (
      [...materialized].some((path) =>
        path === surfaceRoot || path.startsWith(`${surfaceRoot}/`)
      ) ||
      [...tracked].some((path) =>
        path === surfaceRoot || path.startsWith(`${surfaceRoot}/`)
      ) || await pathExists(join(root, surfaceRoot))
    ) {
      active.push(candidate);
    }
  }
  return active;
}

/** Compute the complete on-disk reconciliation without touching the file. */
export async function planDiscernGitattributesFile(
  root: string,
  config: DiscernConfig,
  builtInCandidates: readonly string[] = [],
  env: EnvReader = Deno.env,
  materializedCandidates: readonly string[] = [],
): Promise<GitattributesFilePlan> {
  const existing = await readTextIfExists(join(root, GITATTRIBUTES_REL));
  const builtIns = await activeBuiltInPaths(
    root,
    builtInCandidates,
    materializedCandidates,
  );
  const markdown = await activeMarkdownPaths(
    root,
    discernMarkdownAttributePaths(config),
    materializedCandidates,
  );
  const result = reconcileDiscernGitattributes(
    existing ?? "",
    resolveGeneratedGroups(config),
    builtIns,
    markdown,
    env,
  );
  return {
    existing,
    text: result.text,
    operations: result.operations,
    patterns: result.patterns,
    refused: result.refused,
  };
}

/** Plan `.gitattributes` reconciliation without touching disk. */
export async function planDiscernGitattributesBlock(
  root: string,
  config: DiscernConfig,
  builtInCandidates: readonly string[] = [],
  env: EnvReader = Deno.env,
): Promise<GitattributesFileReconcileResult> {
  const result = await planDiscernGitattributesFile(
    root,
    config,
    builtInCandidates,
    env,
  );
  return {
    operations: result.operations,
    patterns: result.patterns,
    refused: result.refused,
  };
}

/** Reconcile `<root>/.gitattributes` on disk. */
export async function ensureDiscernGitattributesBlock(
  root: string,
  config: DiscernConfig,
  builtInCandidates: readonly string[] = [],
  env: EnvReader = Deno.env,
  materializedCandidates: readonly string[] = [],
): Promise<GitattributesFileReconcileResult> {
  const result = await planDiscernGitattributesFile(
    root,
    config,
    builtInCandidates,
    env,
    materializedCandidates,
  );
  if (result.operations.length > 0) {
    const path = join(root, GITATTRIBUTES_REL);
    if (result.text === "" && result.existing !== undefined) {
      await Deno.remove(path);
    } else {
      await Deno.writeTextFile(path, result.text);
    }
  }
  return {
    operations: result.operations,
    patterns: result.patterns,
    refused: result.refused,
  };
}
