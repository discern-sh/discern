/**
 * The **governing policy**: which checkpoints apply to this effort, resolved
 * from the configuration at the effort's MERGE-BASE with the trunk — never
 * the branch's own edits, never the live trunk tip. A branch adding, removing,
 * or weakening `[checkpoints]` tables therefore changes nothing for its own
 * gate; the edit takes effect for other efforts only after it lands. The
 * merge-base commit is the **policy identity**, reported separately from any
 * subject: `discern update` advances it together with a tree change, so
 * outcomes stay reproducible, and an unrelated advance moves the identity
 * without staling a single declaration.
 *
 * Resolution is deliberately LENIENT where the live loader is strict: the
 * governing config is history, not the file under the author's hands, so an
 * entry that cannot be resolved (an unknown scope, a missing question, a
 * config that does not load) drops out with an advisory instead of wedging
 * the effort — checkpoints FAIL OPEN on every uncertainty.
 *
 * `resolveCheckpoints` is the pure half: entry fields override a shipped
 * built-in seed's, scope selectors resolve through the same glob resolver the
 * scope classifier uses, `unless_changed` entries naming a configured scope
 * expand to its globs, and registered source-path references expand against
 * the SAME governing config — so a definition means one thing, computed in
 * one place.
 */

import { parse as parseToml } from "@std/toml";
import {
  type ConfigIssue,
  type DiscernConfig,
  parseConfig,
  validateConfigValue,
} from "../../shared/config_schema.ts";
import {
  BUILT_IN_CHECKPOINTS,
  type BuiltInCheckpointSeed,
  type CheckpointQuestionSourceField,
  DEFAULT_CHECKPOINT_MODE,
  selectCheckpointQuestionSource,
} from "../../shared/checkpoints.ts";
import {
  type CheckpointQuestionFileFailure,
  checkpointQuestionFileFailureMessage,
  type CheckpointQuestionFileRead,
  readCheckpointQuestionFileAtCommit,
} from "../../shared/checkpoint_question_files.ts";
import {
  type CheckpointDrop,
  entryCheckpointDrop,
  type EntryCheckpointDropReason,
  policyCheckpointDrop,
} from "../../shared/checkpoint_drops.ts";
import { questionById } from "../../shared/questions.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";
import {
  generatedGroupForPath,
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../../shared/generated_artifacts.ts";
import { runGit } from "../../shared/subprocess.ts";
import { resolvedScopePaths } from "../scopes/scope_paths.ts";
import type { ResolvedCheckpoint } from "./types.ts";

type SeedTriggerField = Exclude<
  keyof BuiltInCheckpointSeed,
  "question" | "mode" | "scope" | "paths"
>;

/** Binding table from every seed trigger spelling to its resolved authority.
 * A future seed field cannot compile until resolution tests can iterate it. */
export const CHECKPOINT_SEED_TRIGGER_BINDINGS = {
  include_generated: "includeGenerated",
  exclude_paths: "excludePaths",
  unless_changed: "unlessChanged",
  kinds: "kinds",
  adds_matching: "addsMatching",
  removes_matching: "removesMatching",
  new_directory: "newDirectory",
  binary: "binary",
  min_changed_files: "minChangedFiles",
  min_changed_lines: "minChangedLines",
  deletion_dominant: "deletionDominant",
  similar_new_file: "similarNewFile",
  min_commits: "minCommits",
  when: "when",
} as const satisfies Record<SeedTriggerField, keyof ResolvedCheckpoint>;

/** Each public question source's resolved identity fields. The selector below
 * is exhaustive over the same role-derived source set; the subject guard
 * requires every field named here to perturb the definition hash. */
export const CHECKPOINT_QUESTION_SOURCE_BINDINGS = {
  question: ["question"],
  question_file: ["question", "questionFile"],
} as const satisfies Record<
  CheckpointQuestionSourceField,
  readonly (keyof ResolvedCheckpoint)[]
>;

/** The governing policy for one effort. */
export interface GoverningPolicy {
  /** The merge-base commit whose config governs — the policy identity.
   * Undefined when it could not be resolved (the caller fails open). */
  policyCommit?: string;
  checkpoints: ResolvedCheckpoint[];
  /** Generated ownership resolved from the same governing config. */
  generatedGroups: ResolvedGeneratedGroup[];
  /** Structured accounts of anything that could not govern. */
  drops: CheckpointDrop[];
}

interface UnresolvedCheckpointDrop {
  checkpoint: string;
  mode: ResolvedCheckpoint["mode"];
  reason: Extract<
    EntryCheckpointDropReason,
    | "checkpoint_missing_question"
    | "checkpoint_question_file_missing"
    | "checkpoint_question_file_invalid_path"
    | "checkpoint_question_file_not_regular"
    | "checkpoint_question_file_oversized"
    | "checkpoint_question_file_invalid_utf8"
    | "checkpoint_question_file_unreadable"
    | "checkpoint_question_source_conflict"
    | "checkpoint_selector_conflict"
    | "checkpoint_unknown_scope"
  >;
  account: string;
}

/** True for TOML tables; arrays are values, not key-addressable tables. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve the mode needed by entry-scoped drop evidence even when today's
 * schema cannot type the historical entry. */
function historicalCheckpointMode(
  id: string,
  entry: Readonly<Record<string, unknown>>,
): ResolvedCheckpoint["mode"] {
  const configured = entry.mode;
  return configured === "stop" || configured === "advise"
    ? configured
    : BUILT_IN_CHECKPOINTS[id]?.mode ?? DEFAULT_CHECKPOINT_MODE;
}

/** Classify only question-source defects recoverable by dropping one
 * historical checkpoint. Every other config problem retains the policy-level
 * invalid-config account. */
function historicalQuestionSourceDrop(
  id: string,
  entry: Readonly<Record<string, unknown>>,
  issues: readonly ConfigIssue[],
): UnresolvedCheckpointDrop | undefined {
  const mode = historicalCheckpointMode(id, entry);
  const selected = selectCheckpointQuestionSource(
    entry,
    BUILT_IN_CHECKPOINTS[id] !== undefined,
  );
  if (selected.kind === "invalid") {
    switch (selected.problem) {
      case "multiple":
        return {
          checkpoint: id,
          mode,
          reason: "checkpoint_question_source_conflict",
          account:
            `checkpoint '${id}' sets both question and question_file; it does not govern this run.`,
        };
      case "missing":
      case "empty_question":
        return {
          checkpoint: id,
          mode,
          reason: "checkpoint_missing_question",
          account:
            `checkpoint '${id}' has no usable question source; it does not govern this run.`,
        };
      case "invalid_file":
        return {
          checkpoint: id,
          mode,
          reason: "checkpoint_question_file_invalid_path",
          account:
            `checkpoint '${id}' has an invalid question_file path; it does not govern this run.`,
        };
    }
  }
  const filePath = `checkpoints.${id}.question_file`;
  if (
    issues.some((issue) =>
      issue.path === filePath || issue.path.startsWith(`${filePath}.`)
    )
  ) {
    return {
      checkpoint: id,
      mode,
      reason: "checkpoint_question_file_invalid_path",
      account:
        `checkpoint '${id}' has a question_file path that is not a portable project-relative file path outside .git; it does not govern this run.`,
    };
  }
  return undefined;
}

/** Recover a governing config whose only current-schema defects are localized
 * question sources. The original TOML is parsed once; failed entries are
 * removed from a shallow copy, and every remaining field returns through the
 * complete canonical validator. */
function recoverHistoricalQuestionSources(
  text: string,
  issues: readonly ConfigIssue[],
): {
  config: DiscernConfig;
  drops: UnresolvedCheckpointDrop[];
  checkpointOrder: string[];
} | undefined {
  let raw: unknown;
  try {
    raw = parseToml(text);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !isRecord(raw.checkpoints)) {
    return undefined;
  }
  const checkpoints = { ...raw.checkpoints };
  const drops: UnresolvedCheckpointDrop[] = [];
  for (const [id, value] of Object.entries(raw.checkpoints)) {
    if (!isRecord(value)) {
      continue;
    }
    const drop = historicalQuestionSourceDrop(id, value, issues);
    if (drop === undefined) {
      continue;
    }
    drops.push(drop);
    delete checkpoints[id];
  }
  if (drops.length === 0) {
    return undefined;
  }
  const validated = validateConfigValue({ ...raw, checkpoints });
  return validated.config === undefined ? undefined : {
    config: validated.config,
    drops,
    checkpointOrder: Object.keys(raw.checkpoints),
  };
}

/** File-reader failures projected onto the durable checkpoint-drop vocabulary. */
const QUESTION_FILE_DROP_REASONS = {
  missing: "checkpoint_question_file_missing",
  not_regular_blob: "checkpoint_question_file_not_regular",
  not_tracked: "checkpoint_question_file_not_regular",
  oversized: "checkpoint_question_file_oversized",
  invalid_utf8: "checkpoint_question_file_invalid_utf8",
  unreadable: "checkpoint_question_file_unreadable",
} as const satisfies Record<
  CheckpointQuestionFileFailure,
  EntryCheckpointDropReason
>;

/** Resolve every `[checkpoints.<id>]` entry of `config` (pure). `seeds`
 * defaults to the shipped built-in membership; tests inject synthetic seeds so
 * the resolution path is provable before (and independent of) the shipped
 * set. */
export function resolveCheckpoints(
  config: DiscernConfig,
  seeds: Readonly<Record<string, BuiltInCheckpointSeed>> = BUILT_IN_CHECKPOINTS,
  questionFiles: ReadonlyMap<string, CheckpointQuestionFileRead> = new Map(),
): {
  checkpoints: ResolvedCheckpoint[];
  drops: UnresolvedCheckpointDrop[];
} {
  const checkpoints: ResolvedCheckpoint[] = [];
  const drops: UnresolvedCheckpointDrop[] = [];
  for (const [id, entry] of Object.entries(config.checkpoints)) {
    const seed = seeds[id];
    const mode = entry.mode ?? seed?.mode ?? DEFAULT_CHECKPOINT_MODE;
    const seedQuestion = seed === undefined
      ? undefined
      : questionById(seed.question);

    const source = selectCheckpointQuestionSource(entry, seed !== undefined);
    let question: string | undefined;
    let questionFile: string | undefined;
    if (source.kind === "inherit") {
      question = seedQuestion?.question;
    } else if (source.kind === "inline") {
      question = source.question;
    } else if (source.kind === "file") {
      const read = questionFiles.get(source.path) ?? {
        ok: false as const,
        path: source.path,
        reason: "unreadable" as const,
      };
      if (!read.ok) {
        drops.push({
          checkpoint: id,
          mode,
          reason: QUESTION_FILE_DROP_REASONS[read.reason],
          account: `${
            checkpointQuestionFileFailureMessage(read, "governing Git tree")
          }; checkpoint '${id}' does not govern this run.`,
        });
        continue;
      }
      question = read.question;
      questionFile = read.path;
    } else if (source.problem === "multiple") {
      drops.push({
        checkpoint: id,
        mode,
        reason: "checkpoint_question_source_conflict",
        account:
          `checkpoint '${id}' sets both question and question_file; it does not govern this run.`,
      });
      continue;
    }
    if (question === undefined) {
      drops.push({
        checkpoint: id,
        mode,
        reason: "checkpoint_missing_question",
        account:
          `checkpoint '${id}' names no shipped checkpoint and defines no question; it does not govern this run.`,
      });
      continue;
    }

    // The selector is ONE slot (`scope` xor `paths`): an entry that sets either
    // half replaces the seed's whole selector. Merging per field would pair an
    // entry's `paths` with a seed's `scope` and silently resolve the seed's
    // side, discarding the override.
    const entrySetsSelector = entry.scope !== undefined ||
      entry.paths !== undefined;
    const scope = entrySetsSelector ? entry.scope : seed?.scope;
    const paths = entrySetsSelector ? entry.paths : seed?.paths;
    if (entry.scope !== undefined && entry.paths !== undefined) {
      drops.push({
        checkpoint: id,
        mode,
        reason: "checkpoint_selector_conflict",
        account:
          `checkpoint '${id}' sets both scope and paths; it does not govern this run.`,
      });
      continue;
    }
    let selector: ResolvedCheckpoint["selector"];
    if (scope !== undefined) {
      if (config.scopes[scope] === undefined) {
        drops.push({
          checkpoint: id,
          mode,
          reason: "checkpoint_unknown_scope",
          account:
            `checkpoint '${id}' selects unknown scope '${scope}'; it does not govern this run.`,
        });
        continue;
      }
      selector = { scope, globs: resolvedScopePaths(config, scope) };
    } else if (paths !== undefined) {
      selector = {
        globs: paths.map((glob) => expandSourcePathReferences(glob, config)),
      };
    }

    const unlessChanged = (entry.unless_changed ?? seed?.unless_changed ?? [])
      .flatMap(
        (item) =>
          config.scopes[item] !== undefined
            ? resolvedScopePaths(config, item)
            : [expandSourcePathReferences(item, config)],
      );
    const excludePaths = (entry.exclude_paths ?? seed?.exclude_paths ?? [])
      .map((glob) => expandSourcePathReferences(glob, config));

    const teach = entry.teach ?? seedQuestion?.teach;
    const reference = entry.reference ?? seedQuestion?.reference;
    const governedWhen = entry.when ?? seed?.when;
    const when = governedWhen !== undefined && governedWhen.trim() !== ""
      ? governedWhen
      : undefined;
    const minChangedFiles = entry.min_changed_files ?? seed?.min_changed_files;
    const minChangedLines = entry.min_changed_lines ?? seed?.min_changed_lines;
    const minCommits = entry.min_commits ?? seed?.min_commits;
    const binary = entry.binary ?? seed?.binary;
    checkpoints.push({
      id,
      mode,
      question,
      ...(questionFile === undefined ? {} : { questionFile }),
      ...(teach === undefined ? {} : { teach }),
      ...(reference === undefined ? {} : { reference }),
      ...(selector === undefined ? {} : { selector }),
      includeGenerated: entry.include_generated ?? seed?.include_generated ??
        false,
      excludePaths,
      unlessChanged,
      kinds: [...(entry.kinds ?? seed?.kinds ?? [])],
      addsMatching: [...(entry.adds_matching ?? seed?.adds_matching ?? [])],
      removesMatching: [
        ...(entry.removes_matching ?? seed?.removes_matching ?? []),
      ],
      newDirectory: entry.new_directory ?? seed?.new_directory ?? false,
      ...(binary === undefined ? {} : { binary }),
      ...(minChangedFiles === undefined ? {} : { minChangedFiles }),
      ...(minChangedLines === undefined ? {} : { minChangedLines }),
      deletionDominant: entry.deletion_dominant ?? seed?.deletion_dominant ??
        false,
      similarNewFile: entry.similar_new_file ?? seed?.similar_new_file ??
        false,
      ...(minCommits === undefined ? {} : { minCommits }),
      ...(when === undefined ? {} : { when }),
    });
  }
  return {
    checkpoints,
    drops,
  };
}

/**
 * Whether a resolved checkpoint is DORMANT by configuration: its selector
 * exists but expands to nothing that could ever match — every glob is the
 * empty pattern, which the shared dialect defines as matching nothing (the
 * property that lets a shipped checkpoint reference an unset scalar such as
 * the gotchas doc and stay quiet until the owner names one). A selector-less
 * checkpoint watches the whole diff, so it is never dormant.
 */
export function structurallyDormant(def: ResolvedCheckpoint): boolean {
  const selector = def.selector;
  return selector !== undefined &&
    selector.globs.every((glob) => glob === "");
}

/**
 * The configured checkpoint ids whose triggers could structurally fire — the
 * hygiene candidate set. An entry resolution drops (it cannot govern) or one
 * dormant by configuration is excluded: "configured but never fired" is a
 * scoping signal, and a checkpoint that CANNOT fire yet is not mis-scoped,
 * it is waiting for the configuration that arms it.
 */
export function firableCheckpointIds(config: DiscernConfig): string[] {
  // Firing economics needs the trigger, not the prose. Supply an empty but
  // successful resolved question for each validated live file source so this
  // structural projection does not misclassify file-backed entries as broken.
  const questionFiles = new Map<string, CheckpointQuestionFileRead>(
    Object.values(config.checkpoints).flatMap((entry) =>
      entry.question_file === undefined ? [] : [
        [entry.question_file, {
          ok: true as const,
          path: entry.question_file,
          question: "",
        }] as const,
      ]
    ),
  );
  return resolveCheckpoints(config, BUILT_IN_CHECKPOINTS, questionFiles)
    .checkpoints
    .filter((def) => !structurallyDormant(def))
    .map((def) => def.id)
    .sort();
}

/** The effort's merge-base with the trunk, or undefined when unanswerable. */
export async function policyMergeBase(
  root: string,
  trunk: string,
): Promise<string | undefined> {
  const out = await runGit(["merge-base", trunk, "HEAD"], { cwd: root });
  const sha = out.stdout.trim();
  return out.success && sha !== "" ? sha : undefined;
}

/**
 * Load the governing policy for the effort at `root`. `config` is the LIVE
 * config (it contributes only the trunk name; the env override wins, matching
 * every other trunk consumer) — the `[checkpoints]` tables that govern come
 * from the merge-base commit via git, not from any working tree.
 */
export async function loadGoverningPolicy(
  root: string,
  config: DiscernConfig,
): Promise<GoverningPolicy> {
  const trunk = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk) ||
    config.repository.trunk;
  const policyCommit = await policyMergeBase(root, trunk);
  if (policyCommit === undefined) {
    return {
      checkpoints: [],
      generatedGroups: [],
      drops: [policyCheckpointDrop(
        "merge_base_unresolved",
        `the merge-base with '${trunk}' could not be resolved; no checkpoints govern this run.`,
      )],
    };
  }
  const configSpec = `${policyCommit}:./discern.toml`;
  const listed = await runGit(
    ["ls-tree", "-z", policyCommit, "--", "discern.toml"],
    { cwd: root },
  );
  if (!listed.success) {
    return {
      policyCommit,
      checkpoints: [],
      generatedGroups: [],
      drops: [policyCheckpointDrop(
        "governing_config_unreadable",
        `the governing configuration at ${
          policyCommit.slice(0, 12)
        } could not be inspected; no checkpoints govern this run.`,
        policyCommit,
      )],
    };
  }
  if (listed.stdout === "") {
    return { policyCommit, checkpoints: [], generatedGroups: [], drops: [] };
  }
  // `:./` anchors the path at this project root even when the repository's
  // top level sits above it — the same spelling the standards trunk read uses.
  const shown = await runGit(["show", configSpec], {
    cwd: root,
  });
  if (!shown.success) {
    return {
      policyCommit,
      checkpoints: [],
      generatedGroups: [],
      drops: [policyCheckpointDrop(
        "governing_config_unreadable",
        `the governing configuration at ${
          policyCommit.slice(0, 12)
        } could not be read; no checkpoints govern this run.`,
        policyCommit,
      )],
    };
  }
  let parsed: ReturnType<typeof parseConfig>;
  let sourceDrops: UnresolvedCheckpointDrop[] = [];
  let checkpointOrder: string[] | undefined;
  try {
    parsed = parseConfig(shown.stdout);
  } catch {
    parsed = { config: undefined, issues: [] };
  }
  if (parsed.config === undefined) {
    const recovered = recoverHistoricalQuestionSources(
      shown.stdout,
      parsed.issues,
    );
    if (recovered !== undefined) {
      parsed = { config: recovered.config, issues: [] };
      sourceDrops = recovered.drops;
      checkpointOrder = recovered.checkpointOrder;
    }
  }
  if (parsed.config === undefined) {
    return {
      policyCommit,
      checkpoints: [],
      generatedGroups: [],
      drops: [policyCheckpointDrop(
        "governing_config_invalid",
        `the governing configuration at ${
          policyCommit.slice(0, 12)
        } does not load; no checkpoints govern this run.`,
        policyCommit,
      )],
    };
  }
  let resolved: ReturnType<typeof resolveCheckpoints>;
  let generatedGroups: ResolvedGeneratedGroup[];
  try {
    const questionPaths = [
      ...new Set(
        Object.values(parsed.config.checkpoints).flatMap((entry) =>
          entry.question_file === undefined ? [] : [entry.question_file]
        ),
      ),
    ];
    const questionReads = await Promise.all(
      questionPaths.map(async (path) =>
        [
          path,
          await readCheckpointQuestionFileAtCommit(root, policyCommit, path),
        ] as const
      ),
    );
    resolved = resolveCheckpoints(
      parsed.config,
      BUILT_IN_CHECKPOINTS,
      new Map(questionReads),
    );
    generatedGroups = resolveGeneratedGroups(parsed.config);
    // Force every glob through the matcher while the failure can still be
    // attributed to the policy as a whole. Diff collection must never silently
    // reinterpret a broken governing model as "everything is authored".
    for (const group of generatedGroups) {
      for (const pattern of group.paths) {
        generatedGroupForPath([{ ...group, paths: [pattern] }], "");
      }
    }
  } catch {
    return {
      policyCommit,
      checkpoints: [],
      generatedGroups: [],
      drops: [policyCheckpointDrop(
        "governing_config_invalid",
        `the governing generated-path model at ${
          policyCommit.slice(0, 12)
        } could not be resolved; no checkpoints govern this run.`,
        policyCommit,
      )],
    };
  }
  return {
    policyCommit,
    checkpoints: resolved.checkpoints,
    generatedGroups,
    drops: [...sourceDrops, ...resolved.drops].sort((left, right) => {
      if (checkpointOrder === undefined) return 0;
      return checkpointOrder.indexOf(left.checkpoint) -
        checkpointOrder.indexOf(right.checkpoint);
    }).map((drop) =>
      entryCheckpointDrop(
        drop.checkpoint,
        drop.mode,
        policyCommit,
        drop.reason,
        drop.account,
      )
    ),
  };
}
