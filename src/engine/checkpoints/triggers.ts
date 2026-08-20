/**
 * The **trigger engine** — the pure, plan-side evaluation of a checkpoint's
 * closed predicate menu against an effort diff. No git, no filesystem, no
 * clock: every function here is a deterministic function of its arguments, so
 * the same diff and definition always produce the same verdict.
 *
 * The menu is closed and conjunctive. A trigger holds when EVERY configured
 * predicate holds, evaluated in a fixed order (cheapest veto first):
 *
 *   1. generated paths leave the source universe unless the checkpoint opts
 *      in; the selector then chooses changed candidates;
 *   2. `exclude_paths` removes checkpoint-specific noise from changed and
 *      base-tree paths before any remaining calculation;
 *   3. evidence predicates narrow changed evidence and carry typed related
 *      paths separately;
 *   4. `unless_changed` vetoes when ANY filtered changed path matches it — the
 *      inverted conjunction ("fine when the counterpart moved too");
 *   5. thresholds and remaining conditions evaluate the narrowed changed set;
 *   6. `when` has the final executable word.
 *
 * The executable `when` condition is deliberately NOT run here (it is an
 * effect; `when.ts` owns it): the structural outcome says whether `when` must
 * still decide, and {@link resolveTriggerOutcome} composes the two halves into
 * the final verdict — including the fail-open rule for a `when` error.
 *
 * Semantics live only in the question the agent judges; these predicates are
 * mechanical facts about the diff.
 */

import { pathMatchesPattern } from "../scopes/glob.ts";
import { CHECKPOINT_PATTERN_LIMITS } from "../../shared/checkpoints.ts";
import type {
  ContentFactUnavailableReason,
  EffortDiff,
  EffortFileChange,
  HistoryFactUnavailableReason,
  RelatedCheckpointPath,
  ResolvedCheckpoint,
  SimilarNewFile,
  StructuralTriggerOutcome,
  TriggerOutcome,
  WhenOutcome,
} from "./types.ts";

const ENCODER = new TextEncoder();

// ── deletion-dominant thresholds ────────────────────────────────────────────

/** Removals must reach this many lines before a change can read as
 * deletion-dominant — the false-positive guard that keeps a small cleanup from
 * firing a review meant for substantial cuts. */
export const DELETION_DOMINANT_MIN_DELETED_LINES = 50;

/** Removals must be at least this multiple of additions — the guard that keeps
 * a balanced refactor (rewrite-in-place, similar churn both ways) from reading
 * as a cut. */
export const DELETION_DOMINANT_RATIO = 2;

// ── name-similarity normalization ───────────────────────────────────────────

/**
 * Decorator tokens stripped (repeatedly, case-insensitively) from the END of a
 * file stem when a separator (`-`, `_`, `.`, or a space) precedes them: the
 * conventional spellings of "a parallel copy of the original". `v\d+` covers
 * version suffixes and `\d+` a separated trailing number (`thing-2`).
 */
export const SIMILAR_STEM_DECORATORS: readonly string[] = [
  "copy",
  "new",
  "old",
  "final",
  "backup",
  "bak",
  "tmp",
  "temp",
  "orig",
  "original",
  "next",
  "alt",
  "v\\d+",
  "\\d+",
];

const SEPARATED_DECORATOR_RE = new RegExp(
  `[-_. ](?:${SIMILAR_STEM_DECORATORS.join("|")})$`,
  "i",
);

/** A single bare trailing digit after a letter (`utils2`) also reads as a
 * decorator; longer digit runs (`base64`, `sha256`) are real names and do not. */
const BARE_TRAILING_DIGIT_RE = /(?<=[a-z])\d$/i;

/** `path` split into its parent directory (no trailing slash; "" at the root),
 * stem, and extension (the last `.suffix`; a leading dot is part of the stem). */
function splitPath(
  path: string,
): { dir: string; stem: string; ext: string } {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return { dir, stem: base, ext: "" };
  }
  return { dir, stem: base.slice(0, dot), ext: base.slice(dot) };
}

/**
 * The normalized form of a file stem for the name-similarity comparison:
 * lowercased, then trailing decorator tokens stripped until none remain. Two
 * files are "name-similar" when their normalized stems are equal but their raw
 * basenames differ — `service_v2` and `service` normalize together; `service`
 * and `service_test` stay apart. Exported for the trigger tests.
 */
export function normalizeStem(stem: string): string {
  let out = stem.toLowerCase();
  while (true) {
    const separated = out.replace(SEPARATED_DECORATOR_RE, "");
    const next = separated === out
      ? out.replace(BARE_TRAILING_DIGIT_RE, "")
      : separated;
    if (next === out) {
      return out;
    }
    out = next;
  }
}

/**
 * Every name-similar pair among `added` (added file paths) versus the
 * merge-base listing: same directory, same extension, different basename,
 * equal non-empty normalized stems — and the existing sibling must survive the
 * diff (a deleted original makes the pair a rename, not a parallel
 * implementation). Exported for the trigger tests.
 */
export function similarNewFiles(
  added: readonly string[],
  diff: EffortDiff,
): SimilarNewFile[] {
  if (added.length === 0) {
    return [];
  }
  const deleted = new Set(
    diff.files.filter((f) => f.kind === "deleted").map((f) => f.path),
  );
  // Index the base tree once by (directory, extension, normalized stem) so the
  // comparison stays linear in the tree size however many files were added.
  const byIdentity = new Map<string, string[]>();
  for (const base of diff.baseFiles) {
    const existing = base.path;
    if (deleted.has(existing)) {
      continue; // a vanishing original makes the pair a rename, not a sibling
    }
    const e = splitPath(existing);
    const norm = normalizeStem(e.stem);
    if (norm === "") {
      continue;
    }
    const key = `${e.dir}\0${e.ext}\0${norm}`;
    const bucket = byIdentity.get(key);
    if (bucket === undefined) {
      byIdentity.set(key, [existing]);
    } else {
      bucket.push(existing);
    }
  }
  const pairs: SimilarNewFile[] = [];
  for (const path of added) {
    const a = splitPath(path);
    const aNorm = normalizeStem(a.stem);
    if (aNorm === "") {
      continue; // a stem that normalizes away matches nothing
    }
    for (
      const existing of byIdentity.get(`${a.dir}\0${a.ext}\0${aNorm}`) ?? []
    ) {
      if (existing === path || splitPath(existing).stem === a.stem) {
        continue; // the same file, or the same basename, is not a sibling
      }
      pairs.push({ added: path, existing });
    }
  }
  return pairs;
}

// ── the structural evaluation ───────────────────────────────────────────────

/** Whether `path` matches any glob in `globs` (the shared scope-glob dialect). */
function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => pathMatchesPattern(path, glob));
}

/** The deletion-dominant fact over one set of file changes. */
function isDeletionDominant(files: readonly EffortFileChange[]): boolean {
  let insertions = 0;
  let deletions = 0;
  for (const file of files) {
    insertions += file.insertions;
    deletions += file.deletions;
  }
  return deletions >= DELETION_DOMINANT_MIN_DELETED_LINES &&
    deletions >= DELETION_DOMINANT_RATIO * insertions;
}

/** A collected fact needed by one definition is unavailable. The inspection
 * layer turns this into a checkpoint-scoped fail-open drop. */
export type TriggerFactIssue =
  | { fact: "content"; reason: ContentFactUnavailableReason }
  | { fact: "history"; reason: HistoryFactUnavailableReason };

export type StructuralTriggerEvaluation =
  | { outcome: StructuralTriggerOutcome; issue?: never }
  | { issue: TriggerFactIssue; outcome?: never };

interface CompiledPattern {
  bytes: Uint8Array;
  prefix: Uint16Array;
}

/** Compile one literal byte pattern and its KMP prefix table once. */
function compilePattern(value: string): CompiledPattern {
  const bytes = ENCODER.encode(value);
  const prefix = new Uint16Array(bytes.length);
  let matched = 0;
  for (let index = 1; index < bytes.length; index++) {
    while (matched > 0 && bytes[index] !== bytes[matched]) {
      matched = prefix[matched - 1] ?? 0;
    }
    if (bytes[index] === bytes[matched]) matched++;
    prefix[index] = matched;
  }
  return { bytes, prefix };
}

/** Knuth-Morris-Pratt keeps one pattern scan linear in the line bytes. */
function bytesContain(haystack: Uint8Array, pattern: CompiledPattern): boolean {
  let matched = 0;
  for (const byte of haystack) {
    while (matched > 0 && byte !== pattern.bytes[matched]) {
      matched = pattern.prefix[matched - 1] ?? 0;
    }
    if (byte === pattern.bytes[matched]) matched++;
    if (matched === pattern.bytes.length) return true;
  }
  return false;
}

/** Whether one file has any literal match on the requested changed-line side. */
function contentMatches(
  file: EffortFileChange,
  side: "added" | "removed",
  patterns: readonly CompiledPattern[],
): boolean {
  const content = file.content;
  if (content === undefined || content.status !== "available") return false;
  return content[side].some((line) =>
    patterns.some((pattern) => bytesContain(line, pattern))
  );
}

/** Worst-case linear byte comparisons for one definition's content scan. */
function contentComparisonWork(
  files: readonly EffortFileChange[],
  patternCount: number,
): number {
  let bytes = 0;
  for (const file of files) {
    if (file.content?.status !== "available") continue;
    for (const line of [...file.content.added, ...file.content.removed]) {
      bytes += line.length;
    }
  }
  return bytes * patternCount;
}

/** Parent directory, with the project root represented as the empty string. */
function parentDirectory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Union of paths whose raw diff lines at least one governing content
 * definition may inspect. It applies the authored/selector/exclusion boundary
 * before I/O; later narrowing stays pure. */
export interface FactCollectionPaths {
  /** Literal changed-line bytes are needed. */
  content: Set<string>;
  /** Exact binary classification is needed. */
  binary: Set<string>;
  /** Exact untracked line counts are needed. */
  lineStats: Set<string>;
}

/** Paths whose untracked facts at least one governing definition can consume.
 * Admission applies every filter that precedes fact evaluation, so an
 * irrelevant, generated, excluded, wrong-kind path never spends the shared
 * collector budget. */
export function factCollectionPaths(
  definitions: readonly ResolvedCheckpoint[],
  diff: EffortDiff,
): FactCollectionPaths {
  const content = new Set<string>();
  const binary = new Set<string>();
  const lineStats = new Set<string>();
  for (const def of definitions) {
    const needsContent = def.addsMatching.length > 0 ||
      def.removesMatching.length > 0;
    const needsLineStats = needsContent || def.minChangedLines !== undefined ||
      def.deletionDominant || def.when !== undefined;
    const needsBinary = needsLineStats || def.binary !== undefined;
    if (!needsBinary) {
      continue;
    }
    for (const file of diff.files) {
      if (!def.includeGenerated && file.generated) continue;
      if (
        def.selector !== undefined &&
        !matchesAny(file.path, def.selector.globs)
      ) continue;
      if (matchesAny(file.path, def.excludePaths)) continue;
      if (def.kinds.length > 0 && !def.kinds.includes(file.kind)) continue;
      if (needsContent) content.add(file.path);
      if (needsLineStats) lineStats.add(file.path);
      if (needsBinary) binary.add(file.path);
    }
  }
  return { content, binary, lineStats };
}

/** Backward-compatible content-only projection for focused callers. */
export function contentCollectionPaths(
  definitions: readonly ResolvedCheckpoint[],
  diff: EffortDiff,
): Set<string> {
  return factCollectionPaths(definitions, diff).content;
}

/**
 * Evaluate one checkpoint's structural predicates against the effort diff —
 * the pure half of the trigger. `when` is not run here: a holding outcome
 * carries `whenPending` so the caller knows whether the executable condition
 * still has the last word ({@link resolveTriggerOutcome} composes it).
 */
export function evaluateStructuralTriggerFacts(
  def: ResolvedCheckpoint,
  diff: EffortDiff,
): StructuralTriggerEvaluation {
  const selector = def.selector;
  const selectedComplete = selector === undefined
    ? [...diff.files]
    : diff.files.filter((file) => matchesAny(file.path, selector.globs));
  if (selectedComplete.length === 0) {
    return { outcome: { holds: false, vetoedBy: "empty_matched_set" } };
  }

  // Filters — one governing source classification, then one checkpoint-local
  // exclusion. Inspect the complete selector result only to name the truthful
  // generated-only veto; every later calculation consumes filtered paths.
  const sourceFiles = def.includeGenerated
    ? [...diff.files]
    : diff.files.filter((file) => !file.generated);
  const selectedSource = selector === undefined
    ? [...sourceFiles]
    : sourceFiles.filter((file) => matchesAny(file.path, selector.globs));
  if (selectedSource.length === 0) {
    return { outcome: { holds: false, vetoedBy: "generated_only" } };
  }
  const filteredUniverse = sourceFiles.filter((file) =>
    !matchesAny(file.path, def.excludePaths)
  );
  let candidate = selectedSource.filter((file) =>
    !matchesAny(file.path, def.excludePaths)
  );
  if (candidate.length === 0) {
    return { outcome: { holds: false, vetoedBy: "excluded_only" } };
  }
  const baseFiles = diff.baseFiles.filter((file) =>
    (def.includeGenerated || !file.generated) &&
    !matchesAny(file.path, def.excludePaths)
  );

  // Evidence narrowing. Every field sees the survivors of its predecessors.
  if (def.kinds.length > 0) {
    const kinds = new Set(def.kinds);
    candidate = candidate.filter((file) => kinds.has(file.kind));
    if (candidate.length === 0) {
      return { outcome: { holds: false, vetoedBy: "kinds" } };
    }
  }
  const contentPatternCount = def.addsMatching.length +
    def.removesMatching.length;
  if (
    contentPatternCount > 0 &&
    contentComparisonWork(candidate, contentPatternCount) >
      CHECKPOINT_PATTERN_LIMITS.maxComparisonBytes
  ) {
    return { issue: { fact: "content", reason: "comparison_work" } };
  }
  for (
    const [field, side, patterns] of [
      ["adds_matching", "added", def.addsMatching],
      ["removes_matching", "removed", def.removesMatching],
    ] as const
  ) {
    if (patterns.length === 0) continue;
    for (const file of candidate) {
      if (file.content === undefined) {
        return { issue: { fact: "content", reason: "patch_mismatch" } };
      }
      if (file.content.status === "unavailable") {
        return {
          issue: { fact: "content", reason: file.content.reason },
        };
      }
    }
    const encoded = patterns.map(compilePattern);
    candidate = candidate.filter((file) => contentMatches(file, side, encoded));
    if (candidate.length === 0) {
      return { outcome: { holds: false, vetoedBy: field } };
    }
  }
  if (def.newDirectory) {
    const baseDirectories = new Set<string>();
    for (const file of baseFiles) {
      let directory = parentDirectory(file.path);
      while (directory !== "") {
        baseDirectories.add(directory);
        directory = parentDirectory(directory);
      }
    }
    candidate = candidate.filter((file) => {
      const parent = parentDirectory(file.path);
      return file.kind === "added" && parent !== "" &&
        !baseDirectories.has(parent);
    });
    if (candidate.length === 0) {
      return { outcome: { holds: false, vetoedBy: "new_directory" } };
    }
  }
  if (def.binary !== undefined) {
    if (candidate.some((file) => file.binary === "unknown")) {
      return { issue: { fact: "content", reason: "unreadable" } };
    }
    candidate = candidate.filter((file) => file.binary === def.binary);
    if (candidate.length === 0) {
      return { outcome: { holds: false, vetoedBy: "binary" } };
    }
  }

  // Similarity keeps only suspicious ADDED changed paths
  // and carries each existing sibling separately. The sibling never counts as
  // a changed file or enters `when`'s declared-match boundary.
  let related: RelatedCheckpointPath[] = [];
  if (def.similarNewFile) {
    const similar = similarNewFiles(
      candidate.filter((file) => file.kind === "added").map((f) => f.path),
      { files: filteredUniverse, baseFiles },
    );
    if (similar.length === 0) {
      return { outcome: { holds: false, vetoedBy: "similar_new_file" } };
    }
    const suspicious = new Set(similar.map((pair) => pair.added));
    candidate = candidate.filter((file) => suspicious.has(file.path));
    related = similar.map((pair) => ({
      kind: "similar_existing",
      forPath: pair.added,
      path: pair.existing,
    }));
  }

  // Conjunctive vetoes and thresholds all see the filtered model. The
  // counterpart condition deliberately sees the full filtered source universe,
  // not just selector matches; thresholds see only narrowed changed evidence.
  if (
    def.unlessChanged.length > 0 &&
    filteredUniverse.some((file) => matchesAny(file.path, def.unlessChanged))
  ) {
    return { outcome: { holds: false, vetoedBy: "unless_changed" } };
  }
  if (
    def.minChangedFiles !== undefined && candidate.length < def.minChangedFiles
  ) {
    return { outcome: { holds: false, vetoedBy: "min_changed_files" } };
  }
  if (
    def.minChangedLines !== undefined &&
    candidate.some((file) => file.binary === "unknown")
  ) {
    return { issue: { fact: "content", reason: "unreadable" } };
  }
  if (
    def.minChangedLines !== undefined &&
    candidate.reduce(
        (total, file) => total + file.insertions + file.deletions,
        0,
      ) < def.minChangedLines
  ) {
    return { outcome: { holds: false, vetoedBy: "min_changed_lines" } };
  }
  if (
    def.deletionDominant &&
    candidate.some((file) => file.binary === "unknown")
  ) {
    return { issue: { fact: "content", reason: "unreadable" } };
  }
  if (def.deletionDominant && !isDeletionDominant(candidate)) {
    return { outcome: { holds: false, vetoedBy: "deletion_dominant" } };
  }
  if (def.minCommits !== undefined) {
    if (diff.history === undefined) {
      return { issue: { fact: "history", reason: "git_failed" } };
    }
    if (diff.history.status === "unavailable") {
      return { issue: { fact: "history", reason: diff.history.reason } };
    }
    if (diff.history.count < def.minCommits) {
      return { outcome: { holds: false, vetoedBy: "min_commits" } };
    }
  }
  const matched = candidate.map((file) => file.path).sort();
  const whenPending = def.when !== undefined && def.when.trim() !== "";
  if (whenPending && candidate.some((file) => file.binary === "unknown")) {
    return { issue: { fact: "content", reason: "unreadable" } };
  }
  return {
    outcome: {
      holds: true,
      matched,
      whenPending,
      related,
      changed: candidate,
      ...(diff.history?.status === "available"
        ? { history: diff.history }
        : {}),
    },
  };
}

/** Pure convenience for callers that supplied complete facts. Production read
 * and gate surfaces use `evaluateStructuralTriggerFacts` so an unavailable
 * fact becomes a durable fail-open drop. */
export function evaluateStructuralTrigger(
  def: ResolvedCheckpoint,
  diff: EffortDiff,
): StructuralTriggerOutcome {
  const evaluated = evaluateStructuralTriggerFacts(def, diff);
  if (evaluated.issue !== undefined) {
    throw new Error(
      `checkpoint ${evaluated.issue.fact} facts unavailable: ${evaluated.issue.reason}`,
    );
  }
  return evaluated.outcome;
}

/**
 * Compose the structural outcome with the `when` command's outcome (when one
 * was pending) into the final trigger verdict:
 *
 *   - structural veto → not fired;
 *   - `when` exit 0 → fired, valid declared matches narrowing the structural
 *     matched set (falling back to that set when none remains);
 *   - `when` exit 1 → not fired;
 *   - `when` error or timeout → FAIL OPEN: not fired, advisory attached.
 *
 * A pending `when` with no outcome supplied is a caller defect, not a state —
 * it throws rather than inventing a verdict.
 */
export function resolveTriggerOutcome(
  structural: StructuralTriggerOutcome,
  when?: WhenOutcome,
): TriggerOutcome {
  if (!structural.holds) {
    return { fired: false, vetoedBy: structural.vetoedBy };
  }
  if (!structural.whenPending) {
    return {
      fired: true,
      matched: structural.matched,
      related: structural.related,
    };
  }
  if (when === undefined) {
    throw new Error(
      "trigger has a pending `when` condition; run it and pass its outcome",
    );
  }
  switch (when.kind) {
    case "fire": {
      const structurallyMatched = new Set(structural.matched);
      const narrowed = [
        ...new Set(
          when.matches.filter((path) => structurallyMatched.has(path)),
        ),
      ].sort();
      return {
        fired: true,
        matched: narrowed.length > 0 ? narrowed : structural.matched,
        related: structural.related.filter((relation) =>
          (narrowed.length > 0 ? narrowed : structural.matched).includes(
            relation.forPath,
          )
        ),
      };
    }
    case "pass":
      return { fired: false };
    case "error":
      return { fired: false, advisory: when.advisory };
  }
}
