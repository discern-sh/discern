/**
 * Checkpoint vocabulary shared by the config schema and the checkpoint engine:
 * the closed **mode** pair and the **built-in checkpoint membership**.
 *
 * A checkpoint is one configured rule — deterministic trigger + semantic
 * question + mode — evaluated by the engine in `src/engine/checkpoints/`. The
 * question prose lives in the canonical vocabulary (`shared/questions.ts`); a
 * BUILT-IN checkpoint is the checkpoint MEMBERSHIP of one of those questions: it
 * pairs the question with a shipped trigger, and a project enables it by
 * declaring `[checkpoints.<id>]` with that id (fields it sets override the
 * seed's). This module owns the id set so config validation can tell "a
 * reference to a shipped checkpoint" from "an authored checkpoint missing its
 * question" without reaching into the engine.
 *
 * The parity guards (`tests/questions_registry_test.ts`) walk the registry:
 * every entry must resolve to a canonical question whose violations are
 * diff-introduced (the conversion rule), so an accrued pairing can never ship.
 */

/**
 * The two checkpoint modes:
 *   - `stop`: `discern done` refuses to run any gate job until the agent
 *     declares the question met or unmet (the default).
 *   - `advise`: the question and its evidence are delivered through the
 *     advisory channel; nothing blocks.
 */
export const CHECKPOINT_MODES = ["stop", "advise"] as const;

/** One checkpoint mode ({@link CHECKPOINT_MODES}). */
export type CheckpointMode = (typeof CHECKPOINT_MODES)[number];

/** The mode an entry that names none receives. */
export const DEFAULT_CHECKPOINT_MODE: CheckpointMode = "stop";

/** Git change kinds accepted by the `kinds` trigger field. */
export const CHECKPOINT_CHANGE_KINDS = [
  "added",
  "modified",
  "deleted",
] as const;
export type CheckpointChangeKind = (typeof CHECKPOINT_CHANGE_KINDS)[number];

/** Structured checkpoint-command protocol. One shared authority owns the
 * version and shape written to `DISCERN_CHECKPOINT_INPUT`. */
export const CHECKPOINT_WHEN_INPUT_VERSION = 1 as const;
/** The only decisive non-fire outcome for a checkpoint `when` command. */
export const CHECKPOINT_WHEN_PASS_EXIT_CODE = 10 as const;
export interface CheckpointWhenInput {
  version: typeof CHECKPOINT_WHEN_INPUT_VERSION;
  checkpoint: { id: string; mode: CheckpointMode };
  policy_commit: string;
  changed_files: readonly {
    path: string;
    kind: CheckpointChangeKind;
    insertions: number;
    deletions: number;
    binary: boolean;
  }[];
  history?: { count: number; fingerprint: string };
}

/** Safety limits for the literal UTF-8 line-pattern dialect. The two pattern
 * fields may each carry 16 patterns, so 2 MiB of admitted bytes bounds the
 * worst-case literal comparison work at 64 MiB per checkpoint. */
export const CHECKPOINT_PATTERN_LIMITS = {
  maxPatternsPerField: 16,
  maxPatternBytes: 128,
  maxLineBytes: 8 * 1024,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxContentLines: 64 * 1024,
  maxComparisonBytes: 64 * 1024 * 1024,
} as const;

/** Every public checkpoint entry field, classified once. Consumers derive the
 * trigger-only set rather than maintaining an exception list. */
export const CHECKPOINT_FIELD_ROLES = {
  scope: "selector",
  paths: "selector",
  include_generated: "trigger",
  exclude_paths: "trigger",
  unless_changed: "trigger",
  kinds: "trigger",
  adds_matching: "trigger",
  removes_matching: "trigger",
  new_directory: "trigger",
  binary: "trigger",
  min_changed_files: "trigger",
  min_changed_lines: "trigger",
  deletion_dominant: "trigger",
  similar_new_file: "trigger",
  min_commits: "trigger",
  when: "trigger",
  mode: "review",
  question: "question_source",
  question_file: "question_source",
  teach: "review",
  reference: "review",
} as const;

export const CHECKPOINT_TRIGGER_FIELDS = Object.entries(CHECKPOINT_FIELD_ROLES)
  .filter(([, role]) => role === "trigger")
  .map(([field]) => field);

/** Public fields that can supply the judgment prose. Membership derives from
 * the complete field-role registry, so another source cannot enter the schema
 * without enrolling source selection and definition identity. */
export type CheckpointQuestionSourceField = {
  [Field in keyof typeof CHECKPOINT_FIELD_ROLES]:
    (typeof CHECKPOINT_FIELD_ROLES)[Field] extends "question_source" ? Field
      : never;
}[keyof typeof CHECKPOINT_FIELD_ROLES];

export const CHECKPOINT_QUESTION_SOURCE_FIELDS = Object.entries(
  CHECKPOINT_FIELD_ROLES,
).filter(([, role]) => role === "question_source").map(([field]) =>
  field
) as CheckpointQuestionSourceField[];

/** One table's semantic question-source choice before file bytes are read. */
export type CheckpointQuestionSourceSelection =
  | { kind: "inherit" }
  | { kind: "inline"; question: string }
  | { kind: "file"; path: string }
  | {
    kind: "invalid";
    problem: "multiple" | "missing" | "empty_question" | "invalid_file";
  };

/**
 * Select exactly one project-authored question source, or the inherited source
 * of a shipped built-in. The switch is exhaustive over the role-derived field
 * union: adding another public source fails type checking until this authority
 * defines how it becomes an ordinary question.
 */
export function selectCheckpointQuestionSource(
  entry: object,
  builtIn: boolean,
): CheckpointQuestionSourceSelection {
  const record = entry as Readonly<Record<string, unknown>>;
  const configured = CHECKPOINT_QUESTION_SOURCE_FIELDS.filter(
    (field) => record[field] !== undefined,
  );
  if (configured.length > 1) {
    return { kind: "invalid", problem: "multiple" };
  }
  const field = configured[0];
  if (field === undefined) {
    return builtIn
      ? { kind: "inherit" }
      : { kind: "invalid", problem: "missing" };
  }
  switch (field) {
    case "question": {
      const question = record.question;
      return typeof question === "string" && question.trim() !== ""
        ? { kind: "inline", question }
        : { kind: "invalid", problem: "empty_question" };
    }
    case "question_file": {
      const path = record.question_file;
      return typeof path === "string" && path !== ""
        ? { kind: "file", path }
        : { kind: "invalid", problem: "invalid_file" };
    }
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/** Why a structural trigger did not hold — the closed veto vocabulary, named
 * so previews can explain and wire schemas can enumerate. */
export const TRIGGER_VETOES = [
  "empty_matched_set",
  "generated_only",
  "excluded_only",
  "kinds",
  "adds_matching",
  "removes_matching",
  "new_directory",
  "binary",
  "unless_changed",
  "min_changed_files",
  "min_changed_lines",
  "deletion_dominant",
  "similar_new_file",
  "min_commits",
] as const;

/** One structural-trigger veto ({@link TRIGGER_VETOES}). */
export type TriggerVeto = (typeof TRIGGER_VETOES)[number];

/** Closed typed relations carried beside changed checkpoint evidence. */
export const RELATED_CHECKPOINT_KINDS = [
  "similar_existing",
  "map_explanation",
] as const;
export type RelatedCheckpointKind = (typeof RELATED_CHECKPOINT_KINDS)[number];

/** Narrow persisted/public input against the canonical relation-kind registry. */
export function isRelatedCheckpointKind(
  value: unknown,
): value is RelatedCheckpointKind {
  return typeof value === "string" &&
    (RELATED_CHECKPOINT_KINDS as readonly string[]).includes(value);
}

/** Total human labels: a future kind cannot compile until its wording exists. */
export const RELATED_CHECKPOINT_KIND_LABELS: Readonly<
  Record<RelatedCheckpointKind, string>
> = {
  similar_existing: "Related existing",
  map_explanation: "Review explanation",
};

/** Total relation wording for every evidence kind. */
export const RELATED_CHECKPOINT_KIND_VERBS: Readonly<
  Record<RelatedCheckpointKind, string>
> = {
  similar_existing: "resembles",
  map_explanation: "links to",
};

/** The strict checkpoint obligation one canonical inspection can project for
 * every governing checkpoint. These are decision states, not trigger states:
 * a persisted open question can therefore remain awaiting while its current
 * structural trigger is idle. */
export const CHECKPOINT_OBLIGATION_STATES = [
  "none",
  "will_open",
  "awaiting_declaration",
  "reopened",
  "declared_met",
  "declared_unmet",
  "unknown",
] as const;

/** One checkpoint's projected strict-gate obligation. */
export type CheckpointObligationState =
  (typeof CHECKPOINT_OBLIGATION_STATES)[number];

/**
 * One shipped checkpoint seed: the question it serves plus the trigger and
 * mode defaults a bare `[checkpoints.<id>]` reference receives. Every field a
 * project sets on its entry overrides the seed's value; fields carry the same
 * meaning as the `[checkpoints.<id>]` config keys.
 */
export interface BuiltInCheckpointSeed {
  /** The canonical question id this checkpoint serves (`shared/questions.ts`). */
  readonly question: string;
  /** Default mode; absent means {@link DEFAULT_CHECKPOINT_MODE}. */
  readonly mode?: CheckpointMode;
  /** Internal dynamic selector authority. This is not a public checkpoint
   * field; a project-authored `scope` or `paths` selector still replaces it. */
  readonly selectorFrom?: "instructions.sources";
  /** Built-in map evidence selection; not a public trigger field. */
  readonly mapReview?: "focus" | "drift";
  /** Default selector: a configured scope name the trigger matches. */
  readonly scope?: string;
  /** Default selector: the globs the trigger matches. */
  readonly paths?: readonly string[];
  /** Include generated changed/base paths (default false). */
  readonly include_generated?: boolean;
  /** Remove checkpoint-specific path noise before every predicate. */
  readonly exclude_paths?: readonly string[];
  /** Default inverted-conjunction condition (globs or scope names). */
  readonly unless_changed?: readonly string[];
  /** Narrow to these Git change kinds. */
  readonly kinds?: readonly CheckpointChangeKind[];
  /** Literal UTF-8 substrings required in an added line. */
  readonly adds_matching?: readonly string[];
  /** Literal UTF-8 substrings required in a removed line. */
  readonly removes_matching?: readonly string[];
  /** Require additions under a parent absent from the base tree. */
  readonly new_directory?: boolean;
  /** Narrow to binary (`true`) or text (`false`) changes. */
  readonly binary?: boolean;
  /** Default matched-set size threshold. */
  readonly min_changed_files?: number;
  /** Default added-plus-removed text-line threshold. */
  readonly min_changed_lines?: number;
  /** Default deletion-dominant delta-shape predicate. */
  readonly deletion_dominant?: boolean;
  /** Default new-file name-similarity predicate. */
  readonly similar_new_file?: boolean;
  /** Default merge-base..HEAD commit-count threshold. */
  readonly min_commits?: number;
  /** Default executable final condition. */
  readonly when?: string;
}

/**
 * The built-in checkpoints, by id — the checkpoint membership of the canonical
 * question vocabulary, and the single source config validation and policy
 * resolution consult. A project enables one by declaring `[checkpoints.<id>]`;
 * every field the entry sets overrides the seed's.
 *
 * Selectors use live configured authorities rather than copied paths.
 * `instruction-economy` reads the project's `[instructions].sources` list;
 * scalar authored paths use live references. `gotchas-playbook` tracks
 * `[project].gotchas_doc`:
 * unset, the reference expands to the empty pattern, which matches nothing,
 * so the checkpoint stays quiet until the owner names a doc.
 *
 * The four `stop` members fire on the knowledge surfaces — map, instructions,
 * skills, gotchas — where a weak entry quietly misleads every later session.
 * Code-facing members are all `advise`: no shipped default ever interlocks a
 * code change.
 */
export const BUILT_IN_CHECKPOINTS: Readonly<
  Record<string, BuiltInCheckpointSeed>
> = {
  // ── stop: the knowledge surfaces ─────────────────────────────────────────────
  "map-focus": {
    question: "map.focus",
    paths: ["${map.dir}**"],
    mapReview: "focus",
  },
  "instruction-economy": {
    question: "instructions.economy",
    selectorFrom: "instructions.sources",
  },
  "skills-playbook": {
    question: "skills.executable",
    paths: ["${skills.dir}"],
  },
  "gotchas-playbook": {
    question: "setup.failure-memory",
    paths: ["${project.gotchas_doc}"],
  },
  // ── advise: the shape of the change ────────────────────────────────────────
  "deletion-heavy-change": {
    question: "change.deletion-safety",
    mode: "advise",
    deletion_dominant: true,
  },
  "parallel-implementation": {
    question: "change.parallel-implementation",
    mode: "advise",
    similar_new_file: true,
  },
  "new-binary-asset": {
    question: "change.binary-asset",
    mode: "advise",
    kinds: ["added"],
    binary: true,
  },
  "effort-sprawl": {
    question: "change.effort-scope",
    mode: "advise",
    // Whole-diff breadth: an ordinary single effort rarely spans this many
    // files.
    min_changed_files: 25,
  },
  "map-drift": {
    question: "map.current",
    mode: "advise",
    mapReview: "drift",
  },
  "commit-story": {
    question: "change.commit-story",
    mode: "advise",
    // The closed menu counts matched files, not commits; breadth is the
    // deterministic stand-in — a change this wide carries a history worth
    // telling however it was committed.
    min_changed_files: 15,
  },
};

/**
 * One short line per built-in, in the words the scaffolded config carries
 * beside each enabled entry. Kept apart from the seeds because a seed's keys
 * are trigger fields the resolver iterates; the registry guard holds this
 * table's keys equal to the built-in set.
 */
export const BUILT_IN_CHECKPOINT_SUMMARIES: Readonly<Record<string, string>> = {
  "map-focus": "new explanations must earn their place",
  "instruction-economy": "always-loaded prose must pay its way",
  "skills-playbook": "a skill is an executable playbook",
  "gotchas-playbook": "failure memory: symptom, cause, recovery",
  "deletion-heavy-change": "a big cut: proven dead, recoverable?",
  "parallel-implementation": "a name-similar sibling file appeared",
  "new-binary-asset": "a new binary needs clear provenance",
  "effort-sprawl": "one effort, or several bundled in?",
  "map-drift": "changed sources prompt map review",
  "commit-story": "a large change: do commits tell why?",
};

/** Whether `id` names a shipped built-in checkpoint. */
export function isBuiltInCheckpoint(id: string): boolean {
  return Object.hasOwn(BUILT_IN_CHECKPOINTS, id);
}
