/**
 * The **single source of truth for `discern.toml`** — one Zod schema from which
 * every other artifact derives (ADR 0026). It defines every section, key, type,
 * **default**, and **human description**; the engine reads a fully-typed,
 * fully-defaulted object parsed through it, and the editor JSON Schema + the docs
 * config-reference are generated from it (see `config_codegen.ts`) — the docs
 * rendering straight from its `.describe(...)` annotations. The `discern.toml`
 * template renders from this schema plus the config prose registry
 * (`config_prose.ts`, ADR 0363) through `config_template_codegen.ts`; each
 * section's description here IS the registry's `what`, so the two never diverge.
 *
 * Before this, the config's shape/defaults/prose were smeared across a stringly
 * accessor, wizard defaults, a hand-written JSON Schema, the closed vocabularies,
 * path defaults, and `doctor`'s ad-hoc checks — copies that had already drifted
 * (ADR 0017 gave the known command names a closed vocabulary; ADR 0019 made "one source,
 * nothing to drift" the rule; this finishes the job at the config boundary).
 *
 * Two views share the same building blocks:
 *   - {@link configSchema} — the live `discern.toml` the engine validates.
 *   - {@link configDocSchema} — the declarative config *document* consumed by
 *     `setup begin --config`, a derived subset so it cannot diverge.
 *
 * The inferred Zod types stay internal (re-exported as plain aliases); they never
 * surface in the package's exported API, so `no-slow-types` has nothing to chew.
 */

import { z } from "@zod/zod";
import { tryParseVersion } from "./semver.ts";
import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "./env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import { DEFAULT_WORKTREE_BRANCH_PREFIX } from "./git_conventions.ts";
import {
  isKnownJob,
  isValidSlug,
  KNOWN_JOBS,
  type KnownJob,
  SLUG_RULE,
  STAGES,
} from "./capabilities.ts";
import {
  GLOB_METACHARACTER_RE,
  isConcretePath,
  SOURCE_PATHS,
} from "./paths_registry.ts";
import { LIVE_PATH_REFERENCE_SPELLINGS } from "./source_path_references.ts";
import {
  normalizeProjectRelativeDirectoryPath,
  normalizeProjectRelativeFilePath,
  PROJECT_RELATIVE_DIRECTORY_INPUT_RE,
  PROJECT_RELATIVE_FILE_INPUT_RE,
  projectRelativePathIssue,
} from "./project_path.ts";
import { deadConfigPosition, retiredConfigKeySuccessor } from "./vocabulary.ts";
import { AGENT_NAMES } from "./agent_catalogue.ts";
import { CONFIG_PROSE } from "./config_prose.ts";
import {
  CHECKPOINT_CHANGE_KINDS,
  CHECKPOINT_MODES,
  CHECKPOINT_PATTERN_LIMITS,
  isBuiltInCheckpoint,
  selectCheckpointQuestionSource,
} from "./checkpoints.ts";
import {
  checkpointQuestionFileFailureMessage,
  readLiveCheckpointQuestionFile,
} from "./checkpoint_question_files.ts";
import { type ConfigIssue, unknownRootSections } from "./config_issues.ts";
import type { DiscernWrittenMetaKey } from "./config_metadata.ts";

export { AGENT_NAMES } from "./agent_catalogue.ts";
export type { ConfigIssue } from "./config_issues.ts";

// ── TOML syntax diagnostics (kept here so config_read/toml_render share them) ──

/**
 * A friendly one-line summary of a TOML parse failure. `@std/toml`'s message is
 * accurate but cryptic (e.g. "key length is not a positive number, Parse error
 * on line 3, column 8"); lead with a plain "syntax error near line N in
 * discern.toml" when a line number is present, keeping the raw detail in parens.
 */
export function tomlSyntaxHint(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).trim()
    // `@std/toml` sometimes repeats its own "Parse error on line N, column M:"
    // prefix; collapse the duplicate so the detail reads once.
    .replace(
      /(Parse error on line \d+, column \d+: )(?=Parse error on line \d+, column \d+: )/g,
      "",
    );
  const line = raw.match(/line (\d+)/i)?.[1];
  return line !== undefined
    ? `syntax error near line ${line} in discern.toml (${raw})`
    : `discern.toml is not valid TOML: ${raw}`;
}

/**
 * A clear, catchable error for an unparseable install config. Replaces the raw
 * `@std/toml` `SyntaxError` (which, uncaught, dumps a stack trace at a user who
 * merely has a config typo). The CLI's top-level handler turns this into a clean
 * one-line message and a non-zero exit, in both human and `--json` modes.
 */
export class ConfigParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigParseError";
  }
}

/**
 * A config read that found no file: the checkout the root names is gone, or
 * holds no discern install. A trusted root can stop being true between calls —
 * a worktree is removed once its effort lands — so the config chokepoints raise
 * this typed error and the shared failure boundary refuses gracefully, instead
 * of the raw filesystem error being classified as a crash inside discern.
 */
export class ConfigMissingError extends Error {
  /** The absolute config path the read attempted. */
  readonly path: string;
  constructor(path: string, options?: ErrorOptions) {
    super(
      `No config file at ${path}: the checkout this command targeted no ` +
        `longer exists, or is not a discern project. Move into an existing ` +
        `discern project, or target one explicitly.`,
      options,
    );
    this.name = "ConfigMissingError";
    this.path = path;
  }
}

/**
 * Read a config file, converting a missing file — including a vanished
 * ancestor directory — into {@link ConfigMissingError}. The single reader
 * behind every live-config load, so no surface can reintroduce the raw
 * filesystem throw.
 */
export async function readConfigFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (
      err instanceof Deno.errors.NotFound ||
      err instanceof Deno.errors.NotADirectory
    ) {
      throw new ConfigMissingError(path, { cause: err });
    }
    throw err;
  }
}

// ── shared building blocks (reused by the live config AND the document) ────────

/** TOML bare-key shape, enforced for job/scope/standard/resource names. The ONE
 * definition of record-key legality: the `z.record` key schema below applies it at
 * load, the generated JSON Schema carries it as `propertyNames.pattern`, and the
 * settable-path walker reads that pattern back — so `config set` can never write a
 * `<name>` the next load would reject. */
export const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** One schema-description sentence for every field that accepts the shared
 * scope-glob dialect. The reference list derives from the live-reference
 * membership (registry members plus the enumerated scalar docs), so the
 * generated config reference documents a future member immediately. */
const LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION = `Registered path references (${
  LIVE_PATH_REFERENCE_SPELLINGS.join(", ")
}) resolve from this config before matching or execution; unregistered braced forms stay untouched.`;

/** One portable project-relative file path. Shared by every scalar file key,
 * including checkpoint question sources. */
const projectFilePath = z.string().regex(
  PROJECT_RELATIVE_FILE_INPUT_RE,
  "must be a portable project-relative file path outside .git",
).overwrite(normalizeProjectRelativeFilePath).refine(
  (value) => projectRelativePathIssue(value) === undefined,
  { message: "must be a portable project-relative file path outside .git" },
);

/** The native provider names are derived from the shared identity catalogue,
 * then reused by the document's `agents` enum, generated editor JSON Schema,
 * and installer `KNOWN_AGENTS` export. Signal-only identities never become
 * configuration choices. */

/**
 * The providers a fresh install emits when `[project].agents` is unset — the
 * two built-in agents (gemini is opt-in). The ONE definition of this default,
 * shared by the init seed (`lib/config.ts`) and the compile fallback
 * ({@link resolveConfiguredAgents}), so the two can never disagree.
 */
export const DEFAULT_AGENTS = [
  "claude_code",
  "codex",
] as const satisfies readonly (typeof AGENT_NAMES)[number][];

/** A job/gate/standard value: one command, or a list run in order. */
const commandOrList = z.union([z.string(), z.array(z.string())]).describe(
  `A single command, or a list of commands run in order. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
);

/** The per-job `timeout` override: replaces the global `[gate].timeout` budget for
 * this job only, in seconds; `0` disables the bound for it. Shared by the known-job
 * table form and the custom-job/`[scopes]`/`[standards]` tables, so every job-bearing
 * config value spells the override identically. */
const jobTimeout = z.number().min(
  0,
  "timeout is a per-job budget in seconds and cannot be negative.",
).optional().describe(
  "Time budget in seconds for this job alone, replacing [gate].timeout; 0 removes the bound. Omit to inherit the global budget.",
);

const completionCommandsSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);
export const ProducerSelectorSchema = z.string().regex(
  /^(?:jobs\.[A-Za-z0-9_-]+|scopes\.[A-Za-z0-9_-]+\.gate|standards\.[A-Za-z0-9_-]+)$/u,
);

/** A process recipe, including every declared process-affecting input. */
export const ProducerDeclarationSchema = z.strictObject({
  run: completionCommandsSchema,
  inputs: z.array(z.string().min(1)).min(1).optional(),
  needs: z.array(ProducerSelectorSchema).default([]),
  artifacts: z.array(projectFilePath).default([]),
  environment: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)).default(
    [],
  ),
  toolchain: z.array(projectFilePath).default([]),
  timeout: z.number().nonnegative().optional(),
});
export type ProducerDeclaration = z.infer<typeof ProducerDeclarationSchema>;

/** `run` always produces. `extract` always consumes captured output or an artifact. */
export const StandardInputSchema = z.union([
  z.strictObject({
    run: completionCommandsSchema,
    extract: completionCommandsSchema.optional(),
    artifact: projectFilePath.optional(),
  }),
  z.strictObject({
    producer: ProducerSelectorSchema,
    extract: completionCommandsSchema.optional(),
    artifact: projectFilePath.optional(),
  }),
]).refine(
  (source) => source.artifact === undefined || source.extract !== undefined,
  "artifact consumption requires an extract operation",
);
export type StandardInput = z.infer<typeof StandardInputSchema>;

export interface StandardInputPlan {
  readonly producer: {
    readonly kind: "inline";
    readonly run: readonly string[];
  } | { readonly kind: "reference"; readonly selector: string };
  readonly extraction: {
    readonly run: readonly string[];
    readonly input: { readonly kind: "output" } | {
      readonly kind: "artifact";
      readonly path: string;
    };
  } | null;
}

/** Pure normalization retains the semantic operation independently of selection. */
export function planStandardInput(input: StandardInput): StandardInputPlan {
  const source = StandardInputSchema.parse(input);
  return {
    producer: "run" in source
      ? {
        kind: "inline",
        run: typeof source.run === "string" ? [source.run] : source.run,
      }
      : { kind: "reference", selector: source.producer },
    extraction: source.extract === undefined ? null : {
      run: typeof source.extract === "string"
        ? [source.extract]
        : source.extract,
      input: source.artifact === undefined
        ? { kind: "output" }
        : { kind: "artifact", path: source.artifact },
    },
  };
}

/** Fields shared by every configured producer. Missing inputs bind reuse to the candidate. */
const producerFields = {
  inputs: ProducerDeclarationSchema.shape.inputs.describe(
    "Complete input closure as scope globs; omission binds evidence to the candidate.",
  ),
  needs: ProducerDeclarationSchema.shape.needs.removeDefault().optional()
    .describe(
      "Producer selectors that must finish successfully before this producer runs.",
    ),
  artifacts: ProducerDeclarationSchema.shape.artifacts.removeDefault()
    .optional().describe(
      "Project-relative outputs captured into immutable attempt storage after production.",
    ),
  environment: ProducerDeclarationSchema.shape.environment.removeDefault()
    .optional().describe(
      "Environment variable names whose effective values enter evidence identity as digests.",
    ),
  toolchain: ProducerDeclarationSchema.shape.toolchain.removeDefault()
    .optional().describe(
      "Project-relative identity files for the applicable toolchain.",
    ),
};
/** A known-job value: the bare command-or-list, or the table form
 * `{ run = "…", timeout = N }` when the job needs its own time budget. */
const knownJobCommand = z.union([
  z.string(),
  z.array(z.string()),
  z.strictObject({
    run: commandOrList.describe(
      `The command(s) to run. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
    ),
    timeout: jobTimeout,
    ...producerFields,
  }),
]).describe(
  'A single command, a list of commands run in order, or a table { run = "…", timeout = N } declaring producer facts and a time budget. ' +
    LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION,
);

/** A command-bearing config value in any of its shapes: a bare command, a list, or
 * the known-job table form carrying per-job options. */
export type CommandValue = z.infer<typeof knownJobCommand>;

/** A git pathspec, or a NON-EMPTY list of them — the extent a built-in `per`
 * measures over. The list form requires at least one pathspec: an empty list would
 * reach `git ls-files -z --` with zero pathspecs, which git reads as "every tracked
 * file", silently making a standard's denominator the whole repository instead of
 * the extent its config named. Refusing `[]` here closes that for every measure at
 * once, since each `perExtent` extent reuses this shape. */
const globOrList = z.union([
  z.string(),
  z.array(z.string()).min(1, "a per extent needs at least one git pathspec."),
]);

/** The built-in extents a standard's `per` can divide by — universal, stack-neutral
 * text measures over a git pathspec. discern counts these itself, so the `run`
 * emits only the numerator. The single source of truth for the set; the plan and
 * executor import {@link Extent} from here so a new measure enrolls in one place. */
export const EXTENTS = ["files", "lines", "words", "bytes"] as const;
export type Extent = (typeof EXTENTS)[number];
// `satisfies Record<Extent, …>` pins the object's keys to EXTENTS at compile time:
// a measure added to EXTENTS with no key here (or a key here not in EXTENTS) fails
// `deno check`, so the set and its schema shape can never drift. Exactly one key
// may be set — the refine enforces that, iterating the same EXTENTS list.
const perExtent = z.strictObject(
  {
    files: globOrList.optional(),
    lines: globOrList.optional(),
    words: globOrList.optional(),
    bytes: globOrList.optional(),
  } satisfies Record<Extent, z.ZodType>,
).refine(
  (o) => EXTENTS.filter((k) => o[k] !== undefined).length === 1,
  { message: `per must name exactly one extent: ${EXTENTS.join(" | ")}.` },
);

/** A standard's denominator. Turn a raw count into a *rate* so the number doesn't
 * rise just because the project grew. Either the name of a second metric the `run`
 * emits, or a built-in extent discern measures itself, e.g.
 * `per = { words = "${map.dir}**" }`. */
const perValue = z.union([z.string(), perExtent]);

/** The gate stages a custom job may name. */
const stageEnum = z.enum(STAGES);

/** A custom `[jobs.<name>]` table with an explicit stage. */
const customJobValue = z.strictObject({
  stage: stageEnum.describe(
    "The gate stage this job runs in: fix, build, check, or test.",
  ),
  run: commandOrList.describe(
    `The command(s) to run. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  ...producerFields,
  provides: z.string().optional().describe(
    "A free-text label for humans and audit.",
  ),
  timeout: jobTimeout,
}).describe(
  "A custom job. Its name is open, but its stage and command are explicit.",
);

/** One custom `[jobs.<name>]` entry, fully defaulted. */
export type CustomJobConfig = z.infer<typeof customJobValue>;
/** One declared job, either a known-name command value or a custom job table. */
export type JobConfig = CommandValue | CustomJobConfig;

/** A `[scopes.<name>]` table — a named region with optional attributes. */
const scopeValue = z.strictObject({
  paths: z.array(z.string()).describe(
    `The globs that define the scope: a directory prefix (src/**), a standard glob (src/**/*.ext, src/*), a *.ext suffix at any depth, a /seg/ segment, or an exact path. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  neutral: z.boolean().default(false).describe(
    "true: changes here need no gate, as for documentation and agent instructions.",
  ),
  preview: commandOrList.refine(
    (preview) => toCommandList(preview).length > 0,
    { message: "scope preview must contain at least one command." },
  ).optional().describe(
    `A read-only command an agent can run from this worktree to preview a change in this scope. discern reports this action but never executes it. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  ...producerFields,
  gate: commandOrList.optional().describe(
    `A command \`discern done\` runs when this scope changed: a sub-component's own self-contained gate. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  timeout: jobTimeout,
});

/** A `[generated.<name>]` table — one generator's committed artifacts and the
 * deterministic command that re-derives them (ADR 0247). */
const generatedValue = z.strictObject({
  paths: z.array(z.string()).describe(
    `The scope-paths globs naming the committed artifacts this generator wholly owns: a directory prefix (\`reference/**\`), a standard glob (\`reference/**/*.md\`, \`reference/*\`), a \`*.ext\` suffix at any depth, a \`/seg/\` segment, or an exact path. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  run: commandOrList.refine(
    (run) => toCommandList(run).length > 0,
    { message: "generated run must contain at least one command." },
  ).describe(
    `The deterministic command(s) that rewrite this group's artifacts: the same tree must produce the same bytes, and the generator must remove orphaned artifacts it no longer emits. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  linguist_generated: z.boolean().default(false).describe(
    "true marks the group's paths generated for GitHub through the `linguist-generated` attribute: hidden in diffs by default and excluded from language statistics.",
  ),
  timeout: jobTimeout,
});

/** A `[standards.<name>]` table — one never-loosen metric floor/ceiling. */
const standardValue = z.strictObject({
  metric: z.string().optional().describe(
    "The metric name the run emits. Defaults to the standard's name.",
  ),
  direction: z.enum(["up", "down"]).describe(
    '"up" when the value should rise, so the limit is a floor; "down" when it should fall, so the limit is a ceiling.',
  ),
  limit: z.number().min(Number.MIN_SAFE_INTEGER).describe(
    "The floor or ceiling, compared with the trunk's: a floor may only rise and a ceiling may only fall.",
  ),
  run: completionCommandsSchema.optional().describe(
    "This standard's producer command. Emits DISCERN_METRIC <metric> <number>; cannot accompany producer.",
  ),
  producer: ProducerSelectorSchema.optional().describe(
    "Consume an existing job, scope gate, or standard producer instead of running a separate producer.",
  ),
  extract: completionCommandsSchema.optional().describe(
    "Extract readings from captured producer output on stdin; this is a separate operation from run.",
  ),
  artifact: projectFilePath.optional().describe(
    "Declared producer artifact supplied on stdin to extract; requires extract.",
  ),
  ...producerFields,
  per: perValue.optional().describe(
    "Divide the metric to hold a rate rather than a raw count, so the number does not rise because the project grew: " +
      "a second metric the run emits, or a built-in extent discern measures itself, " +
      'per = { words = "${map.dir}**" } (files, lines, words, or bytes over a git pathspec). ' +
      LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION,
  ),
  scale: z.number().positive("scale must be greater than zero.").default(1)
    .describe(
      "Multiply the rate so the limit reads in human units; scale = 1000 reads as per 1,000.",
    ),
  margin: z.number().min(
    0,
    "margin is headroom and cannot be negative — a negative margin would tighten a pinned limit PAST the measured value, so that measurement would fail it.",
  ).default(0).describe(
    "Headroom `discern standards --pin` leaves when it tightens the limit to the measured value. " +
      "Give a metric that drifts on unrelated changes, such as a size or a coverage percentage, " +
      "a margin so a pinned limit is not tripped by ordinary fluctuation.",
  ),
  timeout: jobTimeout,
}).superRefine((value, ctx) => {
  if ((value.run === undefined) === (value.producer === undefined)) {
    ctx.addIssue({
      code: "custom",
      message: "a standard requires exactly one of run or producer",
      path: ["producer"],
    });
  }
  if (value.artifact !== undefined && value.extract === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "artifact requires a separately named extract operation",
      path: ["artifact"],
    });
  }
});

/** A `[checkpoints.<name>]` table — one change-triggered review rule: a
 * deterministic trigger, a semantic question the agent judges, and a mode.
 * Every field is optional so a bare table can reference a shipped built-in by
 * id; trigger and mode defaults are applied when the rule is resolved, so an
 * unset field can still inherit a built-in's value. */
const checkpointKinds = z.array(z.enum(CHECKPOINT_CHANGE_KINDS)).min(
  1,
  "kinds must name at least one change kind.",
).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: "custom",
      message: "kinds must not contain duplicates.",
    });
  }
});

const checkpointLinePatterns = z.array(
  z.string().min(
    1,
    "a content pattern must not be empty.",
  ).refine(
    (value) =>
      !value.includes("\0") && !value.includes("\r") &&
      !value.includes("\n"),
    "a literal-line content pattern cannot contain NUL, CR, or LF.",
  ).refine(
    (value) =>
      new TextEncoder().encode(value).length <=
        CHECKPOINT_PATTERN_LIMITS.maxPatternBytes,
    `a content pattern must be at most ${CHECKPOINT_PATTERN_LIMITS.maxPatternBytes} UTF-8 bytes.`,
  ),
).min(1, "a content pattern list must not be empty.").max(
  CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField,
  `a content pattern list accepts at most ${CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField} entries.`,
).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({
      code: "custom",
      message: "content patterns must not contain duplicates.",
    });
  }
});

const checkpointValue = z.strictObject({
  scope: z.string().regex(NAME_RE).optional().describe(
    "Selector: a configured [scopes.<name>] whose paths choose the matched set. Prefer this over repeating the scope's globs in `paths`; a checkpoint takes one selector.",
  ),
  paths: z.array(z.string()).optional().describe(
    `Selector globs in the scope dialect: prefix, standard glob, suffix, segment, or exact path. Use either \`scope\` or \`paths\`. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  include_generated: z.boolean().optional().describe(
    "true includes paths a [generated.<name>] group owns; the default evaluates authored change only.",
  ),
  exclude_paths: z.array(z.string()).optional().describe(
    `Globs removed after selection and before every predicate, subject, evidence, and \`when\`. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  unless_changed: z.array(z.string()).optional().describe(
    `Hold fire when any changed path matches one of these globs or scope names: flag this change class unless its counterpart moved too. ${LIVE_SOURCE_PATH_REFERENCE_DESCRIPTION}`,
  ),
  kinds: checkpointKinds.optional().describe(
    'Narrow changed evidence to the named Git kinds: "added", "modified", or "deleted".',
  ),
  adds_matching: checkpointLinePatterns.optional().describe(
    `Narrow text evidence to files with an added line containing any configured case-sensitive literal UTF-8 byte substring. Accepts up to ${CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField} distinct patterns of 1–${CHECKPOINT_PATTERN_LIMITS.maxPatternBytes} UTF-8 bytes; NUL, CR, and LF are invalid.`,
  ),
  removes_matching: checkpointLinePatterns.optional().describe(
    `Narrow text evidence to files with a removed line containing any configured case-sensitive literal UTF-8 byte substring. Accepts up to ${CHECKPOINT_PATTERN_LIMITS.maxPatternsPerField} distinct patterns of 1–${CHECKPOINT_PATTERN_LIMITS.maxPatternBytes} UTF-8 bytes; NUL, CR, and LF are invalid.`,
  ),
  new_directory: z.boolean().optional().describe(
    "Narrow to added files whose parent directory held no admitted file at the merge-base; root-level additions never qualify.",
  ),
  binary: z.boolean().optional().describe(
    "Narrow to binary changes when true or text changes when false.",
  ),
  min_changed_files: z.number().int().min(
    1,
    "min_changed_files is a matched-set size threshold and must be at least 1.",
  ).optional().describe(
    "Fire only when at least this many matched files changed. Omit for no threshold (any matched change fires).",
  ),
  min_changed_lines: z.number().int().min(
    1,
    "min_changed_lines must be at least 1.",
  ).optional().describe(
    "Require this many added-plus-removed text lines across the final narrowed evidence; binary files contribute zero.",
  ),
  deletion_dominant: z.boolean().optional().describe(
    "Fire only when the matched change is deletion-dominant: line removals clearly outweigh additions and exceed a fixed floor, so a large cut is reviewed and an ordinary edit or balanced refactor is not.",
  ),
  similar_new_file: z.boolean().optional().describe(
    "Fire only when the change adds a file whose name closely resembles an existing sibling in the same directory, the signature of a parallel implementation growing beside the original.",
  ),
  min_commits: z.number().int().min(
    1,
    "min_commits must be at least 1.",
  ).optional().describe(
    "Require this many commits in merge-base..HEAD, including merge commits; uncommitted work adds no commit.",
  ),
  when: z.string().optional().describe(
    "Final executable condition: exit 0 fires, exit 10 passes; every other outcome is indeterminate. `DISCERN_MATCH <path>` narrows the structural matches.",
  ),
  mode: z.enum(CHECKPOINT_MODES).optional().describe(
    '"stop" (the default): the gate refuses to run until the agent declares the question met or unmet. "advise": the question and its evidence are delivered through the advisory channel and nothing blocks.',
  ),
  question: z.string().optional().describe(
    "Inline judgment prose. A project checkpoint needs this or `question_file`; a built-in inherits unless overridden. Review surfaces serve it. Do not include secrets.",
  ),
  question_file: projectFilePath.optional().describe(
    "Repository-relative Markdown path from the governing merge-base Git tree. Mutually exclusive with `question`; built-ins may inherit. Must be a regular Git blob, valid UTF-8, and at most 65536 bytes. Text can appear in terminal, MCP, CI, Proof, and landing review; repository access is its only privacy. Do not include secrets.",
  ),
  teach: z.string().optional().describe(
    "Optional lesson prose carried into renderings: why the question matters and what good looks like.",
  ),
  reference: z.string().optional().describe(
    "Optional displayed pointer. discern performs no content loading or execution. Review surfaces may show it. Do not include secrets.",
  ),
});

const checkpointsSection = z.record(z.string().regex(NAME_RE), checkpointValue)
  .default({}).describe(CONFIG_PROSE.checkpoints.what);

// ── the live `discern.toml` schema ─────────────────────────────────────────────

const projectDirectoryPath = z.string().regex(
  PROJECT_RELATIVE_DIRECTORY_INPUT_RE,
  "must be a portable project-relative directory path outside .git",
).overwrite(normalizeProjectRelativeDirectoryPath).refine(
  (value) => projectRelativePathIssue(value) === undefined,
  {
    message: "must be a portable project-relative directory path outside .git",
  },
);

const instructionSourceInputPattern = new RegExp(
  `(?:${PROJECT_RELATIVE_FILE_INPUT_RE.source})|` +
    `(?:${GLOB_METACHARACTER_RE.source})`,
);
const instructionSourcePath = z.string().regex(
  instructionSourceInputPattern,
  "must be a project-relative file path or glob",
).overwrite((value) =>
  isConcretePath(value) ? normalizeProjectRelativeFilePath(value) : value
).refine(
  (value) =>
    !isConcretePath(value) || projectRelativePathIssue(value) === undefined,
  { message: "concrete sources must be portable project-relative file paths" },
);

/** Enforce path uniqueness under case folding and Unicode normalization. */
function projectPathsAreUnique(values: readonly string[]): boolean {
  const identities = values.map((value) =>
    value.normalize("NFC").toLowerCase()
  );
  return new Set(identities).size === identities.length;
}

/** Mark one config key as discern-written in the generated public schema. */
function discernWritten<T extends z.ZodType>(
  key: DiscernWrittenMetaKey,
  schema: T,
): T {
  void key;
  return schema.meta({
    readOnly: true,
  }) as T;
}

const metaSection = z.strictObject({
  managed_version: discernWritten(
    "managed_version",
    z.string().refine((value) => tryParseVersion(value) !== undefined, {
      message:
        "must be a strict numeric SemVer, without a tag prefix or codename",
    }).optional().describe(
      "Highest discern release whose successful setup or upgrade adopted managed material. Project evidence, independent of installed binaries, schema, and content currency.",
    ),
  ),
  schema_version: discernWritten(
    "schema_version",
    z.number().int().min(1).optional().describe(
      "The install schema version. `discern upgrade` bumps it; never edit it by hand.",
    ),
  ),
  bootstrapped: discernWritten(
    "bootstrapped",
    z.boolean().default(false).describe(
      "true once `discern setup` has completed, which retires the one-time setup redirect.",
    ),
  ),
  setup_completion: discernWritten(
    "setup_completion",
    z.enum(["proven", "unproven"]).optional().describe(
      "Evidence recorded for the setup completion event: proven by the gate, or explicitly completed unproven.",
    ),
  ),
  setup_model: discernWritten(
    "setup_model",
    z.string().default("").describe(
      "The model the agent declared at `discern setup begin --model`. Recorded for support triage; advisory, since discern cannot verify it.",
    ),
  ),
  setup_version: discernWritten(
    "setup_version",
    z.string().default("").describe(
      "The discern version that ran setup, recorded for support triage.",
    ),
  ),
}).prefault({}).describe(CONFIG_PROSE.meta.what);

const projectSection = z.strictObject({
  name: z.string().default("").describe(
    "Display name, free text, used when compiled instructions address the project. Empty falls back to the slug.",
  ),
  slug: z.string().refine(
    (value) => value === "" || isValidSlug(value),
    { message: `slug must be ${SLUG_RULE}.` },
  ).default("").describe(
    "Short, lowercase, dash-separated identity, used in worktree, site, and branch names.",
  ),
  gotchas_doc: z.string().default("").describe(
    "The doc the gate points an agent at when a stage fails in a non-obvious way. Keep it current with your stack's traps; empty disables the pointer.",
  ),
  todo: projectFilePath.default(SOURCE_PATHS.todo.defaultPath).describe(
    "The deferred-work ledger: the running TODO list agents read and maintain, relative to the project root.",
  ),
  logbook: z.boolean().default(true).describe(
    "When true, record one line of local, metadata-only history per verb run: timings, outcomes, and names, with no code or output. " +
      "Files stay under .git, outside commits and any network; false stops all writes.",
  ),
  agents: z.array(z.enum(AGENT_NAMES)).optional().describe(
    `Which agent integrations to enable: ${AGENT_NAMES.join(", ")}. ` +
      `Omit the key for the default pair (${
        DEFAULT_AGENTS.join(", ")
      }); an explicit empty list emits for no agent.`,
  ),
}).prefault({}).describe(CONFIG_PROSE.project.what);

const repositorySection = z.strictObject({
  trunk: z.string().default("main").describe(
    `The shared branch the gate compares against and completed work lands on. Detected at setup; ${DISCERN_ENVIRONMENT_VARIABLES.trunk} overrides it per invocation.`,
  ),
  branch_prefix: z.string().default(DEFAULT_WORKTREE_BRANCH_PREFIX).describe(
    `Branch prefix for worktrees created by discern, e.g. "${DEFAULT_WORKTREE_BRANCH_PREFIX}my-feature".`,
  ),
  proof_notes: z.enum(["local", "fetch"]).default("local").describe(
    'Both modes record landed Proof notes locally. "fetch" also manages fetch-only transport. Publishing remains an explicit owner action; there is no off mode.',
  ),
  ensure: z.array(z.string()).default([]).describe(
    "Idempotent commands that make any checkout usable for its tracked tree, such as installing dependencies from a lockfile. They run in order on every worktree pass and after a landing.",
  ),
}).prefault({}).describe(CONFIG_PROSE.repository.what);

const instructionSection = z.strictObject({
  sources: z.array(instructionSourcePath).default([
    SOURCE_PATHS.instructions.defaultPath,
  ])
    .describe(
      "Instruction source files or globs, relative to the project root. Missing files are skipped; `discern setup begin` seeds the default source.",
    ),
}).prefault({}).describe(CONFIG_PROSE.instructions.what);

const skillsSection = z.strictObject({
  dir: projectDirectoryPath.default(SOURCE_PATHS.skills.defaultPath).describe(
    "Where your authored skills live, relative to the project root. Read only when present, so a project with no authored skills uses the built-ins.",
  ),
  exclude: z.array(z.string()).default([]).describe(
    "Skill names, bundled or authored, to leave out of materialization. Each materialized skill occupies context in every agent session, so exclude what this project never needs; an unknown name warns and never fails.",
  ),
}).prefault({}).describe(CONFIG_PROSE.skills.what);

const mapSection = z.strictObject({
  dir: projectDirectoryPath.overwrite((value) => `${value}/`).default(
    SOURCE_PATHS.map.defaultPath,
  ).describe(
    "Where the project map lives, relative to the project root. `discern setup begin` scaffolds it here and `discern map` browses it.",
  ),
}).prefault({}).describe(CONFIG_PROSE.map.what);

/** The single `[jobs]` object. Known names have their stage-derived flat form;
 * every other legal name is parsed through the custom table form. Shared by the
 * live config and config document so runtime validation, editor schemas, and the
 * generated reference describe the same namespace. */
const jobValuesObject = z.strictObject({
  format: knownJobCommand.optional().describe(
    "A formatter or codemod. Mutating, so it runs first and serially.",
  ),
  build: knownJobCommand.optional().describe(
    "Produce the artifacts later stages read: compile, bundle.",
  ),
  lint: knownJobCommand.optional().describe(
    "Read-only static analysis.",
  ),
  typecheck: knownJobCommand.optional().describe(
    "Read-only type checking.",
  ),
  test: knownJobCommand.optional().describe("The test suite."),
  smoke: knownJobCommand.optional().describe(
    "A fast, side-effect-light readiness check: the app boots with real config in this checkout. `discern done` and `discern test` run it in the same fail-fast test group, so a quick failure cancels slower siblings.",
  ),
}).catchall(customJobValue);
const jobsObject = z.intersection(
  z.record(z.string().regex(NAME_RE), z.unknown()),
  jobValuesObject,
);

const jobsSection = jobsObject.prefault({}).describe(CONFIG_PROSE.jobs.what);

/** The known-job enum as schema data, derived from {@link KNOWN_JOBS}. The cast
 * records the authority's non-empty invariant so Zod can publish an enum rather
 * than a string refinement; a new known job then joins config validation and the
 * generated JSON Schema in the same edit. */
const knownJobNameSchema = z.enum(
  Object.keys(KNOWN_JOBS) as [KnownJob, ...KnownJob[]],
);

/** Setup coverage policy. Applicability is separate from `[jobs]`: it changes
 * the setup assurance denominator and never changes what the Gate schedules. */
const setupSection = z.strictObject({
  not_applicable: z.array(knownJobNameSchema).refine(
    (names) => new Set(names).size === names.length,
    { message: "each known job may be listed only once." },
  ).meta({ uniqueItems: true }).default([]).describe(
    "Known jobs this project's lifecycle does not have. A job listed here cannot also be configured under [jobs].",
  ),
}).prefault({}).describe(CONFIG_PROSE.setup.what);

const scopesSection = z.record(z.string().regex(NAME_RE), scopeValue).default(
  {},
)
  .describe(CONFIG_PROSE.scopes.what);

const generatedSection = z.record(
  z.string().regex(NAME_RE),
  generatedValue,
).default({}).describe(CONFIG_PROSE.generated.what);

const acceptanceSection = z.strictObject({
  pre_authorized: z.array(z.string()).default([]).describe(
    "Scope names whose changes may land without a per-landing conversation. An owner decision recorded on the trunk: widening a named scope widens its grant. Empty means every landing needs the owner's acceptance.",
  ),
}).prefault({}).describe(CONFIG_PROSE.acceptance.what);

const resourceValue = z.strictObject({
  create: z.string().default("").describe(
    "Command run once at worktree setup. discern records cleanup intent before running it and skips it only after readiness is recorded. An empty command is a clean no-op.",
  ),
  destroy: z.string().default("").describe(
    "Command run once at teardown. Author it idempotent (it may re-run via worktree prune) and cwd-independent.",
  ),
  ensure: z.string().default("").describe(
    "Idempotently reconcile drift or re-readiness at session start.",
  ),
  required: z.boolean().default(true).describe(
    "false makes a create failure non-fatal, so setup continues.",
  ),
  retries: z.number().int().min(0).max(5).default(0).describe(
    "Retry create/destroy this many times.",
  ),
  gc: z.boolean().default(true).describe(
    "false exempts the resource from orphan pruning, for data-loss-sensitive resources that only teardown may remove.",
  ),
});

/**
 * The Zod entry schema for each record-table family — the single source of truth
 * for the knobs each open `<name>` table accepts. Keyed by record family so the
 * managed-banner guard (ADR 0138) can assert every knob is documented in that
 * family's banner — the only channel by which a newly-added knob reaches an
 * existing install. A field added here auto-enrols in that check.
 */
export const RECORD_ENTRY_SCHEMAS = {
  jobs: customJobValue,
  scopes: scopeValue,
  generated: generatedValue,
  standards: standardValue,
  checkpoints: checkpointValue,
  "worktree.resources": resourceValue,
} as const;

const worktreeSection = z.strictObject({
  root: z.string().default("").describe(
    'Where per-worktree checkouts are created. Empty means a sibling of the repository, "<repo>.worktrees", outside the checkout. A relative path resolves against the repo root; absolute is used as-is.',
  ),
  inherit_env: z.array(z.string()).default([]).describe(
    "Names copied from the main checkout's declared env files. A value fills an empty entry or the first file's `<file>.example` default. A missing first file is created at mode 0600; existing modes stay unchanged.",
  ),
  env_files: z.array(projectFilePath).refine(projectPathsAreUnique, {
    message:
      "each env-file path may appear only once, including aliases on a case-insensitive filesystem",
  }).meta({ uniqueItems: true }).default([".env", ".env.local"]).describe(
    "Env files read and written in order: the last definition wins; new values use the first existing file. Inheritance alone may create the first file. Managed values share one scoped marker.",
  ),
  port: z.boolean().default(false).describe(
    "Record each worktree's deterministic dev-server port in its env files, for tooling that reads DISCERN_WORKTREE_PORT. `discern identity --port` reports it either way.",
  ),
  ignored_file_drift: z.boolean().default(true).describe(
    "Track ignored files at worktree setup and report the top-level ignored paths that changed before the worktree is removed. Turn it off when ignored outputs churn too much to be useful.",
  ),
  resources: z.record(z.string().regex(NAME_RE), resourceValue).default({})
    .describe(CONFIG_PROSE["worktree.resources"].what),
  setup: z.strictObject({
    steps: z.array(z.string()).default([]).describe(
      "Commands run once at worktree creation, in order, after the resources exist: one-shot scaffolding such as seeding fixtures.",
    ),
    ensure: z.array(z.string()).default([]).describe(
      "Commands run on every linked-worktree pass: creation, session start, and after `discern update`. For convergence that depends on worktree identity, ports, or resources; the main checkout never runs them.",
    ),
  }).prefault({}).describe(CONFIG_PROSE["worktree.setup"].what),
}).prefault({}).describe(CONFIG_PROSE.worktree.what);

/** The two live-config sections a version-2 setup recipe may fill wholesale.
 * Reusing these exact schemas keeps the bounded document projection aligned
 * with every nested worktree and setup field the runtime accepts. */
export const CONFIG_DOC_BOUNDED_SECTION_SCHEMAS = {
  setup: setupSection,
  worktree: worktreeSection,
} as const;

const standardsSection = z.record(z.string().regex(NAME_RE), standardValue)
  .default(
    {},
  ).describe(CONFIG_PROSE.standards.what);

const gateSection = z.strictObject({
  stream: z.boolean().default(false).describe(
    "false groups each job's complete output in a static transcript; true streams prefixed lines. Live terminals always show the gate frame's bounded tail; CI, pipes, and --plain are static.",
  ),
  fail_fast: z.boolean().default(true).describe(
    "Cancel the in-flight sibling commands the moment one fails; an agent-driven gate wants a fast abort. false runs every job and shows all failures in one pass.",
  ),
  timeout: z.number().int().min(0).default(600).describe(
    "Time budget in seconds for every command the gate runs. A command that overruns is tree-killed and the stage fails with a timeout diagnostic, so a watch-mode runner cannot hang the gate. 0 removes the bound.",
  ),
  concurrent_test_runs: z.number().int().min(0).default(1).describe(
    "How many test stages may run on this machine at once; the rest wait for a slot. Fresh projects use 1; 0 is uncapped. `discern queue -- <command>` shares the cap.",
  ),
}).prefault({}).describe(CONFIG_PROSE.gate.what);

const couplingSection = z.strictObject({
  in_gate: z.boolean().default(true).describe(
    "Surface coupling findings as trailing hints in `discern done` and `discern prepare`, while the change is hot. false keeps coupling available through `discern coupling` alone.",
  ),
}).prefault({}).describe(CONFIG_PROSE.coupling.what);

const scriptsSection = z.strictObject({
  dir: projectDirectoryPath.default(SOURCE_PATHS.scripts.defaultPath).describe(
    'Where your project scripts live, relative to the project root. The default works with no config; point it elsewhere, such as "tools/", if you prefer.',
  ),
}).prefault({}).describe(CONFIG_PROSE.scripts.what);

/** The canonical live-`discern.toml` schema. Every section carries a default, so
 * an empty `{}` validates to a fully-defaulted object. Strict throughout: an
 * unknown section or key stops the load. Root unknowns retain their classification
 * because they can be either a typo or config from a newer running build. */
export const configSchema = z.strictObject({
  project: projectSection,
  repository: repositorySection,
  map: mapSection,
  instructions: instructionSection,
  skills: skillsSection,
  jobs: jobsSection,
  setup: setupSection,
  scopes: scopesSection,
  generated: generatedSection,
  acceptance: acceptanceSection,
  worktree: worktreeSection,
  standards: standardsSection,
  checkpoints: checkpointsSection,
  gate: gateSection,
  coupling: couplingSection,
  scripts: scriptsSection,
  meta: metaSection,
});

/** The fully-typed, fully-defaulted live config the engine reads. Internal alias
 * of the inferred Zod type — never part of the package's exported API. */
type InferredDiscernConfig = z.infer<typeof configSchema>;
export type DiscernConfig = Omit<InferredDiscernConfig, "jobs"> & {
  /** Known and custom jobs share one runtime namespace. Position-sensitive
   * validation decides which union arm a name may use. */
  jobs: Record<string, JobConfig>;
};

/**
 * The provider names to emit instructions / materialize skills for: the configured
 * `[project].agents`, else {@link DEFAULT_AGENTS}. The single resolver shared
 * by the compiler, the worktree dispatcher, AND the skills currency check — so
 * "which agents are configured" is answered identically everywhere, never
 * re-derived per call-site. Pure: reads only the passed config.
 *
 * `[project].agents` is OPTIONAL, so an absent key (undefined) and an explicit
 * empty list are distinct: absent falls through to the default pair, while an
 * explicit `agents = []` is an author's deliberate "emit for no agents" and is
 * honored verbatim. Conflating the two — the historic behaviour — made "no
 * agents, please" impossible to express.
 */
export function resolveConfiguredAgents(config: DiscernConfig): string[] {
  if (config.project.agents !== undefined) {
    return [...config.project.agents];
  }
  return [...DEFAULT_AGENTS];
}

/**
 * How prose addresses this project: `[project].name`, else the slug verbatim
 * (no case fabrication — "my-app" must not become "My App"), else a neutral
 * stand-in a config with neither identity field can still render.
 */
export function projectDisplayName(config: DiscernConfig): string {
  const name = config.project.name.trim();
  if (name !== "") {
    return name;
  }
  const slug = config.project.slug.trim();
  return slug !== "" ? slug : "this project";
}

/** One `[scopes.<name>]` entry, fully defaulted. */
export type ScopeConfig = z.infer<typeof scopeValue>;
/** One `[generated.<name>]` entry, fully defaulted. */
export type GeneratedConfig = z.infer<typeof generatedValue>;
/** One `[standards.<name>]` entry, fully defaulted. */
export type StandardConfig = z.infer<typeof standardValue>;
/** One `[checkpoints.<name>]` entry. Every field stays optional in the parsed
 * shape: presence is meaningful (an unset field inherits a built-in's default
 * at resolution), so the schema applies no value defaults of its own. */
export type CheckpointConfig = z.infer<typeof checkpointValue>;
/** One `[worktree.resources.<name>]` entry, fully defaulted. */
export type ResourceConfig = z.infer<typeof resourceValue>;

// ── the declarative config *document* (`setup begin --config`) ────────────────

/**
 * The config-document major version this build understands. A document may omit
 * `version` (assumed current) or carry a matching major; a different major is a
 * breaking shape this build refuses rather than misreads.
 */
export const CONFIG_DOC_VERSION = "2";

/** The document's gate-config tables reuse the *same* building blocks as the live
 * config, so the document shape can never diverge from what the engine reads. The
 * base fields (name/slug/branch_prefix/brief/agents) remain flat version-2
 * install inputs; the bounded setup and worktree sections project their live
 * config shapes without admitting unrelated standing policy.
 *
 * Strictness is shared by the generated editor schema and runtime validation:
 * misspelled, retired, and newer keys fail at the boundary instead of being
 * silently discarded. The explicit major remains the compatibility gate. */
export const configDocSchema = z.strictObject({
  $schema: z.string().optional().describe(
    "Editor-only pointer to this schema; ignored by discern.",
  ),
  version: z.union([z.string(), z.number()]).optional().describe(
    `Document major version. Omit (assumed current) or use a matching major; this build understands version ${CONFIG_DOC_VERSION}.`,
  ),
  name: z.string().optional().describe("Project name (free text)."),
  slug: z.string().refine(isValidSlug, {
    message: `slug must be ${SLUG_RULE}.`,
  })
    .optional().describe(
      "Project slug: lowercase letters, digits and dashes, starting with a letter or digit.",
    ),
  branch_prefix: z.string().optional().describe(
    `Branch prefix for worktrees, e.g. "${DEFAULT_WORKTREE_BRANCH_PREFIX}".`,
  ),
  brief: z.string().optional().describe(
    "Free-text description of what the project is.",
  ),
  agents: z.array(z.enum(AGENT_NAMES)).optional().describe(
    "Which agent integrations to enable: claude_code -> CLAUDE.md, gemini -> GEMINI.md, codex / cursor / copilot -> AGENTS.md.",
  ),
  map: mapSection.optional().describe(
    "[map] settings — chiefly the project-relative directory holding discern's agent documentation tree.",
  ),
  jobs: jobsObject.optional().describe(
    "[jobs] fills. Known names take a command, list, or { run, timeout } and derive their stage; a custom [jobs.<name>] table requires `stage` and `run`.",
  ),
  scopes: z.record(z.string().regex(NAME_RE), scopeValue).optional().describe(
    "[scopes.<name>] tables — a named region defined by `paths`, with optional attributes.",
  ),
  generated: z.record(z.string().regex(NAME_RE), generatedValue).optional()
    .describe(
      "[generated.<name>] tables — committed artifacts, their deterministic regeneration command, and an optional timeout.",
    ),
  standards: z.record(z.string().regex(NAME_RE), standardValue).optional()
    .describe(
      "[standards.<name>] tables. Coverage is just a conventional name.",
    ),
  checkpoints: z.record(z.string().regex(NAME_RE), checkpointValue).optional()
    .describe(
      "[checkpoints.<name>] tables — change-triggered review rules: trigger fields, mode, and the question the agent judges.",
    ),
  setup: CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.setup.optional().describe(
    "Bounded [setup] configuration for setup coverage accounting.",
  ),
  worktree: CONFIG_DOC_BOUNDED_SECTION_SCHEMAS.worktree.optional().describe(
    "Bounded [worktree] configuration for isolated-checkout behavior and resources.",
  ),
}).describe(
  "A bounded version-2 setup recipe consumed only by `discern setup begin --config <file>`. Project identity and setup inputs stay flat; its map, jobs, scopes, generated groups, standards, checkpoints, setup policy, and worktree settings fill discern.toml. Standing acceptance grants remain outside this document. Every field is optional.",
);

/** Runtime validation is the same closed contract the authoring schema exposes. */
export const configDocRuntimeSchema = configDocSchema;

/** The config-document shape — the *input* view (what an author writes, before
 * defaults), so optional attributes such as a scope's `neutral` stay optional.
 * Internal alias of the inferred Zod type. */
type InferredDiscernConfigDoc = z.input<typeof configDocSchema>;
export type DiscernConfigDoc = Omit<InferredDiscernConfigDoc, "jobs"> & {
  /** The open document view: runtime validation applies the known-name/custom-
   * name positional rule that TypeScript index signatures cannot express. */
  jobs?: Record<string, JobConfig> | undefined;
};

// ── parse / validate / load ────────────────────────────────────────────────────

/**
 * A clear, catchable error for a config that parses as TOML but violates the
 * schema. Carries the full {@link ConfigIssue} list so `--json` can report each;
 * the message is a path-qualified summary. Surfaces through the same top-level
 * CLI handler as {@link ConfigParseError}.
 */
export class ConfigValidationError extends Error {
  readonly issues: ConfigIssue[];
  constructor(issues: ConfigIssue[]) {
    super(summariseIssues(issues));
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

/** A path-qualified one-line-per-issue summary for a {@link ConfigValidationError}. */
function summariseIssues(issues: ConfigIssue[]): string {
  if (issues.length === 0) {
    return "discern.toml is invalid.";
  }
  const unknownSections = unknownRootSections(issues);
  if (unknownSections.length > 0 && unknownSections.length === issues.length) {
    const noun = unknownSections.length === 1 ? "section" : "sections";
    return `The running discern process does not recognize the discern.toml root ${noun} ${
      unknownSections.map((section) => `[${section}]`).join(", ")
    }.`;
  }
  const lines = issues.map((i) =>
    i.path === "" ? `  - ${i.message}` : `  - ${i.path}: ${i.message}`
  );
  return `${
    unknownSections.length > 0
      ? "The running discern process cannot load discern.toml"
      : "discern.toml is invalid"
  }:\n${lines.join("\n")}`;
}

/** Turn one Zod issue into a {@link ConfigIssue}, with discern-specific hints
 * for retired config positions: dead positions come from the
 * DEAD_CONFIG_POSITIONS table, renamed keys from RETIRED_CONFIG_KEY_REDIRECTS
 * (both in vocabulary.ts), so retiring a position is a row, not a branch. */
function toConfigIssues(issue: z.core.$ZodIssue): ConfigIssue[] {
  const path = issue.path.map((p) => String(p)).join(".");
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.join(", ");
    if (path === "") {
      return issue.keys.map((key): ConfigIssue => {
        const dead = deadConfigPosition("", [key]);
        if (dead !== undefined) {
          return { path: key, message: dead.message(key) };
        }
        const successor = retiredConfigKeySuccessor(key);
        return successor === undefined
          ? {
            kind: "unknown_root_section",
            path: key,
            message:
              `the running discern process does not recognize the root section [${key}].`,
          }
          : {
            path: key,
            message:
              `[${key}] is not a discern config section; use [${successor}].`,
          };
      });
    }
    const dead = deadConfigPosition(path, issue.keys);
    if (dead !== undefined) {
      return [{ path, message: dead.message(keys) }];
    }
    if (/^standards\.[^.]+$/.test(path) && issue.keys.includes("measure")) {
      return [{
        path: `${path}.measure`,
        message:
          `\`measure\` is not a standard setting: every standard is measured on every \`discern done\` and its limit is required for completion. Delete the key from [${path}]. To avoid running an expensive command twice, read the standard from the job that already runs it with \`producer = "jobs.<name>"\` and, when the reading needs deriving, \`extract\`.`,
      }];
    }
    return [{
      path: `${path}.${keys}`,
      message: `unknown key(s) in [${path}]: ${keys}`,
    }];
  }
  // A boolean value written as a quoted string is the most common type trip
  // (`fail_fast = "false"`, `docs = "yes"`); the raw Zod message ("expected
  // boolean, received string") doesn't hint the fix.
  if (issue.code === "invalid_type" && issue.expected === "boolean") {
    return [{
      path,
      message:
        "expected a boolean — use a bare `true` or `false` (not a quoted string).",
    }];
  }
  return [{ path, message: issue.message }];
}

/**
 * Classify the structural issues from an arbitrary strict config schema. Tests
 * use this seam to model an older running build by omitting one current root
 * section; the live loader uses the same issue translator below.
 */
export function configSchemaIssues(
  parsed: unknown,
  schema: z.ZodType = configSchema,
): ConfigIssue[] {
  const result = schema.safeParse(parsed);
  return result.success ? [] : result.error.issues.flatMap(toConfigIssues);
}

/** Position-sensitive `[jobs]` rules that JSON Schema cannot express alone. */
function jobFormIssues(parsed: unknown): ConfigIssue[] {
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) {
    return [];
  }
  const issues: ConfigIssue[] = [];
  for (const [name, value] of Object.entries(parsed.jobs)) {
    const declaresStage = isRecord(value) && Object.hasOwn(value, "stage");
    if (isKnownJob(name) && declaresStage) {
      issues.push({
        path: `jobs.${name}.stage`,
        message: `known job "${name}" derives stage "${
          KNOWN_JOBS[name]
        }" from its name — remove \`stage\`.`,
      });
    } else if (!isKnownJob(name) && !declaresStage) {
      issues.push({
        path: `jobs.${name}`,
        message:
          `custom job "${name}" must use the table form \`{ stage = "check", run = "…" }\` — \`stage\` is required.`,
      });
    }
  }
  return issues;
}

/** Cross-section applicability rules. A declaration cannot mask any configured
 * value, including a no-op or discern-only housekeeping command: applicability
 * changes assurance accounting and never suppresses Gate configuration. */
function jobApplicabilityIssues(parsed: unknown): ConfigIssue[] {
  if (
    !isRecord(parsed) || !isRecord(parsed.jobs) ||
    !isRecord(parsed.setup) ||
    !Array.isArray(parsed.setup.not_applicable)
  ) {
    return [];
  }
  const jobs = parsed.jobs;
  const notApplicable = parsed.setup.not_applicable;
  return notApplicable.flatMap((name, index) => {
    if (
      typeof name !== "string" || !Object.hasOwn(jobs, name)
    ) {
      return [];
    }
    return [{
      path: `setup.not_applicable.${index}`,
      message:
        `known job "${name}" is configured under [jobs] and cannot be declared not applicable. Run \`discern config set-job ${name} --applicable\` to keep the configured command.`,
    }];
  });
}

/**
 * Cross-section `[checkpoints]` REFERENCE rules that JSON Schema cannot express
 * alone — shapes that are wrong however complete the entry becomes, so they
 * block programmatic writes as well as loads: a `scope` selector naming no
 * configured scope, and both selectors set at once.
 */
function checkpointReferenceIssues(parsed: unknown): ConfigIssue[] {
  if (!isRecord(parsed) || !isRecord(parsed.checkpoints)) {
    return [];
  }
  const scopes = isRecord(parsed.scopes)
    ? Object.keys(parsed.scopes).sort()
    : [];
  const defined = scopes.length === 0 ? "(none)" : scopes.join(", ");
  const issues: ConfigIssue[] = [];
  for (const [id, entry] of Object.entries(parsed.checkpoints)) {
    if (!isRecord(entry)) {
      continue; // the schema reports the shape problem
    }
    if (typeof entry.scope === "string" && !scopes.includes(entry.scope)) {
      issues.push({
        path: `checkpoints.${id}.scope`,
        message:
          `unknown scope "${entry.scope}". Define it under [scopes.${entry.scope}] or use \`paths\`; defined scopes: ${defined}.`,
      });
    }
    if (entry.scope !== undefined && entry.paths !== undefined) {
      issues.push({
        path: `checkpoints.${id}`,
        message:
          "a checkpoint takes ONE selector — `scope` or `paths`, not both.",
      });
    }
  }
  return issues;
}

/**
 * `[checkpoints]` QUESTION-SOURCE rules. A project-authored id supplies one
 * source; a shipped built-in may omit both to inherit. These semantic rules
 * apply to loads and programmatic writes so no editor can leave an ambiguous
 * source or a table that cannot become a question.
 */
function checkpointQuestionSourceIssues(parsed: unknown): ConfigIssue[] {
  if (!isRecord(parsed) || !isRecord(parsed.checkpoints)) {
    return [];
  }
  const issues: ConfigIssue[] = [];
  for (const [id, entry] of Object.entries(parsed.checkpoints)) {
    if (!isRecord(entry)) {
      continue;
    }
    const builtIn = isBuiltInCheckpoint(id);
    const source = selectCheckpointQuestionSource(entry, builtIn);
    if (source.kind !== "invalid") {
      continue;
    }
    switch (source.problem) {
      case "multiple":
        issues.push({
          path: `checkpoints.${id}`,
          message: `[checkpoints.${id}] sets both \`question\` and ` +
            `\`question_file\`. Keep one question source.` +
            (builtIn
              ? " Remove both fields to inherit the shipped question."
              : ' Valid forms are `question = "…"` or `question_file = "path/to/question.md"`.'),
        });
        break;
      case "missing":
        issues.push({
          path: `checkpoints.${id}`,
          message: `[checkpoints.${id}] names no shipped checkpoint. Set ` +
            'exactly one question source: `question = "…"` or ' +
            '`question_file = "path/to/question.md"`.',
        });
        break;
      case "empty_question":
        issues.push({
          path: `checkpoints.${id}.question`,
          message: `[checkpoints.${id}].question contains no judgment prose. ` +
            "Write a non-whitespace question, or replace it with " +
            '`question_file = "path/to/question.md"`.',
        });
        break;
      case "invalid_file":
        // The strict field schema owns type and portable-path diagnostics.
        break;
    }
  }
  return issues;
}

/** Cross-section `[acceptance]` rules that JSON Schema cannot express alone. */
function acceptanceGrantIssues(parsed: unknown): ConfigIssue[] {
  if (!isRecord(parsed) || !isRecord(parsed.acceptance)) {
    return [];
  }
  const configured = parsed.acceptance.pre_authorized;
  if (!Array.isArray(configured)) {
    return [];
  }
  const scopes = isRecord(parsed.scopes)
    ? Object.keys(parsed.scopes).sort()
    : [];
  const defined = scopes.length === 0 ? "(none)" : scopes.join(", ");
  return configured.flatMap((name, index) => {
    if (typeof name !== "string" || scopes.includes(name)) {
      return [];
    }
    return [{
      path: `acceptance.pre_authorized.${index}`,
      message:
        `unknown scope "${name}". Define it under [scopes.${name}] or remove it; defined scopes: ${defined}.`,
    }];
  });
}

/** Completed installs must retain the explicit migration anchor setup wrote. */
function completedInstallMetadataIssues(parsed: unknown): ConfigIssue[] {
  if (!isRecord(parsed) || !isRecord(parsed.meta)) return [];
  if (
    parsed.meta.bootstrapped === true &&
    !Object.hasOwn(parsed.meta, "schema_version")
  ) {
    return [{
      path: "meta.schema_version",
      message:
        "a completed install must record [meta].schema_version; restore it from version control before running upgrade.",
    }];
  }
  return [];
}

/** Validate an already-parsed TOML value through the complete live contract.
 * Governing-policy recovery uses this after removing only checkpoint entries
 * whose governing question source cannot be represented by the current schema. */
export function validateConfigValue(
  parsed: unknown,
): { config: DiscernConfig | undefined; issues: ConfigIssue[] } {
  const jobIssues = jobFormIssues(parsed);
  const formIssues = [
    ...jobIssues,
    ...jobApplicabilityIssues(parsed),
    ...completedInstallMetadataIssues(parsed),
    ...acceptanceGrantIssues(parsed),
    ...checkpointReferenceIssues(parsed),
    ...checkpointQuestionSourceIssues(parsed),
  ];
  const result = configSchema.safeParse(parsed);
  if (result.success) {
    if (formIssues.length > 0) {
      return { config: undefined, issues: formIssues };
    }
    return { config: result.data as DiscernConfig, issues: [] };
  }
  const formOwners = new Set(
    jobIssues.map((issue) => issue.path.split(".").slice(0, 2).join(".")),
  );
  const schemaIssues = result.error.issues.flatMap(toConfigIssues).filter(
    (issue) => !formOwners.has(issue.path.split(".").slice(0, 2).join(".")),
  );
  return { config: undefined, issues: [...formIssues, ...schemaIssues] };
}

/** Read-only lookup used while projecting a committed governing config onto
 * the current schema. Tests inject a synthetic retirement before any public
 * redirect row exists. */
export type RetiredConfigKeyLookup = (path: string) => string | undefined;

/** One cloned object-key path in a parsed config document. */
interface ConfigObjectKey {
  readonly path: string;
  readonly depth: number;
}

/** Clone JSON-compatible parsed TOML without sharing containers with callers. */
function cloneConfigValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneConfigValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneConfigValue(child)]),
  );
}

/** Enumerate every object key deepest-first so a nested retirement can move
 * before an enclosing table retirement. Parsed TOML has no object-valued array
 * today, but indexes are retained in the path if one is introduced later. */
function configObjectKeys(
  value: unknown,
  segments: readonly string[] = [],
): ConfigObjectKey[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      configObjectKeys(child, [...segments, String(index)])
    );
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...segments, key];
    return [
      { path: path.join("."), depth: path.length },
      ...configObjectKeys(child, path),
    ];
  }).sort((left, right) => right.depth - left.depth);
}

/** Read one own-key path without treating an inherited property as config. */
function configValueAtPath(
  root: unknown,
  dotted: string,
): { readonly found: boolean; readonly value?: unknown } {
  let node: unknown = root;
  for (const segment of dotted.split(".")) {
    if (!isRecord(node) || !Object.hasOwn(node, segment)) {
      return { found: false };
    }
    node = node[segment];
  }
  return { found: true, value: node };
}

/** Write one dotted key into a cloned config, creating absent parent tables.
 * A scalar already occupying a required parent makes the redirect unusable. */
function setConfigValueAtPath(
  root: unknown,
  dotted: string,
  value: unknown,
): boolean {
  if (!isRecord(root)) return false;
  const segments = dotted.split(".");
  const leaf = segments.pop();
  if (leaf === undefined) return false;
  let parent = root;
  for (const segment of segments) {
    const existing = parent[segment];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      parent[segment] = created;
      parent = created;
    } else if (isRecord(existing)) {
      parent = existing;
    } else {
      return false;
    }
  }
  parent[leaf] = value;
  return true;
}

/** Delete one dotted own-key path from a cloned config. */
function deleteConfigValueAtPath(root: unknown, dotted: string): void {
  if (!isRecord(root)) return;
  const segments = dotted.split(".");
  const leaf = segments.pop();
  if (leaf === undefined) return;
  let parent: Record<string, unknown> = root;
  for (const segment of segments) {
    const child = parent[segment];
    if (!isRecord(child)) return;
    parent = child;
  }
  delete parent[leaf];
}

/** Apply retired-key redirects without mutating the committed bytes. A current
 * spelling wins when both are present; the retired value is then genuinely
 * ignored and joins the reported path set. */
function applyGoverningConfigRedirects(
  value: unknown,
  lookup: RetiredConfigKeyLookup,
): { readonly value: unknown; readonly ignoredKeyPaths: string[] } {
  const redirected = cloneConfigValue(value);
  const ignoredKeyPaths: string[] = [];
  for (const { path } of configObjectKeys(redirected)) {
    const successor = lookup(path);
    if (successor === undefined || successor === path) continue;
    const source = configValueAtPath(redirected, path);
    if (!source.found) continue;
    const current = configValueAtPath(redirected, successor);
    if (
      current.found ||
      !setConfigValueAtPath(redirected, successor, source.value)
    ) {
      ignoredKeyPaths.push(path);
    }
    deleteConfigValueAtPath(redirected, path);
  }
  return { value: redirected, ignoredKeyPaths };
}

/** Resolve a local JSON-Schema reference emitted for a reused config node. */
function localSchemaReference(
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
): Record<string, unknown> {
  const reference = schema.$ref;
  if (typeof reference !== "string" || !reference.startsWith("#/")) {
    return schema;
  }
  let node: unknown = root;
  for (const encoded of reference.slice(2).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(node)) return schema;
    node = node[segment];
  }
  return isRecord(node) ? node : schema;
}

/** Select the schema branch that can own an object or array container. Scalar
 * alternatives have no nested keys to strip. */
function schemaForConfigValue(
  schema: Record<string, unknown>,
  value: unknown,
  root: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = objectSchemaView(localSchemaReference(schema, root));
  const alternatives = Array.isArray(resolved.anyOf)
    ? resolved.anyOf
    : Array.isArray(resolved.oneOf)
    ? resolved.oneOf
    : [];
  const expected = Array.isArray(value)
    ? "array"
    : isRecord(value)
    ? "object"
    : undefined;
  if (expected === undefined) return resolved;
  for (const alternative of alternatives) {
    if (!isRecord(alternative)) continue;
    const candidate = objectSchemaView(localSchemaReference(alternative, root));
    if (
      candidate.type === expected ||
      (expected === "object" &&
        (isRecord(candidate.properties) ||
          isRecord(candidate.additionalProperties)))
    ) {
      return candidate;
    }
  }
  return resolved;
}

/** Project one value through the current schema, retaining every recognized
 * key and returning every dropped dotted path. Open record names recurse into
 * their entry schema; fixed strict objects drop unknowns at any depth. */
function withoutUnknownConfigKeys(
  value: unknown,
  schema: Record<string, unknown>,
  root: Record<string, unknown>,
  segments: readonly string[] = [],
): { readonly value: unknown; readonly ignoredKeyPaths: string[] } {
  const node = schemaForConfigValue(schema, value, root);
  if (Array.isArray(value)) {
    const items = isRecord(node.items) ? node.items : undefined;
    if (items === undefined) return { value, ignoredKeyPaths: [] };
    const children = value.map((child, index) =>
      withoutUnknownConfigKeys(child, items, root, [
        ...segments,
        String(index),
      ])
    );
    return {
      value: children.map((child) => child.value),
      ignoredKeyPaths: children.flatMap((child) => child.ignoredKeyPaths),
    };
  }
  if (!isRecord(value)) return { value, ignoredKeyPaths: [] };

  const properties = isRecord(node.properties) ? node.properties : {};
  const additional = node.additionalProperties;
  const keyPattern = recordKeyPattern(node);
  const kept: Record<string, unknown> = {};
  const ignoredKeyPaths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = [...segments, key];
    let childSchema: Record<string, unknown> | undefined;
    if (Object.hasOwn(properties, key) && isRecord(properties[key])) {
      childSchema = properties[key];
    } else if (
      isRecord(additional) &&
      (keyPattern === undefined || keyPattern.test(key))
    ) {
      childSchema = additional;
    } else if (additional !== false) {
      kept[key] = child;
      continue;
    }
    if (childSchema === undefined) {
      ignoredKeyPaths.push(path.join("."));
      continue;
    }
    const projected = withoutUnknownConfigKeys(child, childSchema, root, path);
    kept[key] = projected.value;
    ignoredKeyPaths.push(...projected.ignoredKeyPaths);
  }
  return { value: kept, ignoredKeyPaths };
}

/** Read committed policy across config renames and retirements. Redirects run
 * before the current schema drops unrecognized keys, so a renamed path keeps
 * its meaning. Live reads never call this projection and remain strict. */
function governingConfigProjection(
  value: unknown,
  retiredLookup: RetiredConfigKeyLookup = retiredConfigKeySuccessor,
): { readonly value: unknown; readonly ignoredKeyPaths: string[] } {
  const redirected = applyGoverningConfigRedirects(value, retiredLookup);
  const schema = liveSchemaJson();
  const stripped = withoutUnknownConfigKeys(
    redirected.value,
    schema,
    schema,
  );
  return {
    value: stripped.value,
    ignoredKeyPaths: [
      ...new Set([
        ...redirected.ignoredKeyPaths,
        ...stripped.ignoredKeyPaths,
      ]),
    ].sort(),
  };
}

/** The current-schema value a committed governing document contributes. */
export function governingConfigValue(
  value: unknown,
  retiredLookup: RetiredConfigKeyLookup = retiredConfigKeySuccessor,
): unknown {
  return governingConfigProjection(value, retiredLookup).value;
}

/** Pinned policy uses current enforcement even when its document predates the
 * running schema, and reports every key whose value could not govern. */
export function parseGoverningConfig(
  text: string,
  retiredLookup: RetiredConfigKeyLookup = retiredConfigKeySuccessor,
): ReturnType<typeof validateConfigValue> & {
  readonly ignoredKeyPaths: string[];
} {
  const projected = governingConfigProjection(parseToml(text), retiredLookup);
  return {
    ...validateConfigValue(projected.value),
    ignoredKeyPaths: projected.ignoredKeyPaths,
  };
}

/**
 * Parse `discern.toml` text and validate it against the schema, collecting EVERY
 * problem rather than failing on the first — so `doctor` can report all of them.
 * On success, `config` is the fully-typed, fully-defaulted object and `issues` is
 * empty. A TOML *syntax* error is unrecoverable (nothing can be validated), so it
 * throws {@link ConfigParseError}; schema problems are returned as issues.
 */
export function parseConfig(
  text: string,
): { config: DiscernConfig | undefined; issues: ConfigIssue[] } {
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    throw new ConfigParseError(tomlSyntaxHint(err), { cause: err });
  }
  return validateConfigValue(parsed);
}

/**
 * Parse, validate, and return the typed config — throwing {@link ConfigParseError}
 * on a TOML syntax error or {@link ConfigValidationError} on a schema violation.
 * The fail-fast counterpart to {@link parseConfig}, used everywhere the engine
 * constructs a config from in-memory text.
 */
export function parseConfigOrThrow(text: string): DiscernConfig {
  const { config, issues } = parseConfig(text);
  if (config === undefined) {
    throw new ConfigValidationError(issues);
  }
  return config;
}

/**
 * Load, parse, and validate `discern.toml` under a project `root`, returning the
 * fully-typed object. Throws {@link ConfigMissingError} on a missing file,
 * {@link ConfigParseError} on a syntax error, or {@link ConfigValidationError}
 * on a schema violation.
 */
export async function loadConfig(root: string): Promise<DiscernConfig> {
  const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const config = parseConfigOrThrow(await readConfigFile(join(root, rel)));
  const reads = await Promise.all(
    Object.entries(config.checkpoints).flatMap(([id, entry]) =>
      entry.question_file === undefined ? [] : [
        readLiveCheckpointQuestionFile(root, entry.question_file).then(
          (read): ConfigIssue | undefined =>
            read.ok ? undefined : {
              path: `checkpoints.${id}.question_file`,
              message: `${
                checkpointQuestionFileFailureMessage(
                  read,
                  "live configuration",
                )
              }. Add a regular tracked UTF-8 file at that path, or use \`question\` in [checkpoints.${id}].`,
            },
        ),
      ]
    ),
  );
  const issues = reads.filter((issue): issue is ConfigIssue =>
    issue !== undefined
  );
  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
  return config;
}

/** True for a non-null, non-array object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The live schema as a JSON Schema, computed once for path checks. */
let liveJsonSchema: Record<string, unknown> | undefined;
/** Cache the input-side JSON Schema that resolves writable config paths. */
function liveSchemaJson(): Record<string, unknown> {
  if (liveJsonSchema === undefined) {
    liveJsonSchema = z.toJSONSchema(configSchema, { io: "input" }) as Record<
      string,
      unknown
    >;
  }
  return liveJsonSchema;
}

/** The record-key name pattern a schema node enforces on its `<name>` segments,
 * read from the JSON Schema's `propertyNames.pattern` — the same constraint the
 * runtime `z.record(z.string().regex(NAME_RE), …)` key schema applies. Returns
 * undefined for a node that names no pattern (then any key is legal). */
function recordKeyPattern(node: Record<string, unknown>): RegExp | undefined {
  const propertyNames = node.propertyNames;
  if (!isRecord(propertyNames) || typeof propertyNames.pattern !== "string") {
    return undefined;
  }
  return new RegExp(propertyNames.pattern);
}

/** Merge object fragments from JSON Schema `allOf` for schema-guided config
 * writes. `[jobs]` is the one hybrid node: fixed known-name properties plus an
 * open custom-name value shape and a shared key-name pattern. */
function objectSchemaView(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(schema.allOf)) return schema;
  const view: Record<string, unknown> = { ...schema };
  delete view.allOf;
  for (const part of schema.allOf) {
    if (!isRecord(part)) continue;
    const currentProps = isRecord(view.properties) ? view.properties : {};
    const partProps = isRecord(part.properties) ? part.properties : {};
    Object.assign(view, part, {
      properties: { ...currentProps, ...partProps },
    });
  }
  return view;
}

/**
 * Walk the live JSON Schema along a dotted key. `found` is whether every segment
 * resolved (a record section — `jobs`, `scopes`, `standards`,
 * `worktree.resources` — accepts a `<name>` segment matching the section's
 * `propertyNames.pattern`, descending into the value shape); `node` is the schema
 * node the path lands on. The ONE walk behind both {@link isSettableConfigPath}
 * and {@link settableConfigValueKind}, so "does this path exist" and "what does it
 * hold" can never disagree.
 *
 * The record-key pattern is enforced here so the walker refuses exactly the
 * `<name>` shapes the runtime `z.record` key schema would refuse — otherwise
 * `config set` would accept a key (a space, a slash, non-ASCII) it then writes as
 * a `[jobs.<bad name>]` header the next load rejects.
 */
function settableSchemaNode(
  dotted: string,
): { found: boolean; node: Record<string, unknown> | undefined } {
  let node: Record<string, unknown> | undefined = liveSchemaJson();
  for (const seg of dotted.split(".")) {
    if (node === undefined) {
      return { found: false, node: undefined };
    }
    node = objectSchemaView(node);
    const props: Record<string, unknown> | undefined = isRecord(node.properties)
      ? node.properties
      : undefined;
    const child: unknown = props?.[seg];
    if (props !== undefined && Object.hasOwn(props, seg)) {
      node = isRecord(child) ? child : undefined;
    } else if (isRecord(node.additionalProperties)) {
      // A record table: `seg` is a `<name>`. It is only settable when it matches
      // the record's key pattern — the same legality the runtime validator holds.
      const pattern = recordKeyPattern(node);
      if (pattern !== undefined && !pattern.test(seg)) {
        return { found: false, node: undefined };
      }
      node = node.additionalProperties;
    } else {
      return { found: false, node: undefined }; // unknown key, not a record table
    }
  }
  return { found: true, node };
}

/**
 * Whether a dotted key is a writable path in the schema — so `discern config set`
 * can refuse a typo (`project.frobnicate`, `gate.bogus`) at WRITE time rather
 * than leave a config the next read rejects. This deliberately permits a
 * valid-but-incomplete path (e.g. `standards.coverage.limit` before its `run` is
 * set) — incremental table construction is legitimate; only an UNKNOWN
 * key/section is rejected.
 */
export function isSettableConfigPath(dotted: string): boolean {
  return settableSchemaNode(dotted).found;
}

/**
 * The value shape the schema expects at a settable path — so `config set` renders
 * the TOML type the next read requires instead of guessing it from the value's
 * spelling (a guess wrote `agents = "claude_code"` where an array belongs, and
 * `slug = 2048` where a string belongs, bricking every later read).
 *
 * - `string` — carries the closed `values` list when the schema is an enum.
 * - `number` / `boolean` / `string-array` — the plain scalar and array shapes.
 * - `table` — the path names a section, not a single key.
 * - `mixed` — a union (a command-or-list, a standard `per`): no single required
 *   type, so the caller falls back to inference and the write-time validation
 *   backstop.
 *
 * Returns undefined for a path that is not settable at all.
 */
export type ConfigValueKind =
  | { kind: "string"; values?: string[] }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "string-array" }
  | { kind: "table" }
  | { kind: "mixed" };

/** Read the live schema to determine how `config set` must encode a path's value. */
export function settableConfigValueKind(
  dotted: string,
): ConfigValueKind | undefined {
  const { found, node: foundNode } = settableSchemaNode(dotted);
  if (!found) {
    return undefined;
  }
  if (foundNode === undefined) {
    return { kind: "mixed" }; // unreachable for Zod-emitted schemas; stay lenient
  }
  const node = objectSchemaView(foundNode);
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    return { kind: "mixed" };
  }
  if (node.type === "string") {
    const values = Array.isArray(node.enum) &&
        node.enum.every((v): v is string => typeof v === "string")
      ? node.enum
      : undefined;
    return values === undefined
      ? { kind: "string" }
      : { kind: "string", values };
  }
  if (node.type === "number" || node.type === "integer") {
    return { kind: "number" };
  }
  if (node.type === "boolean") {
    return { kind: "boolean" };
  }
  if (node.type === "array") {
    const items = isRecord(node.items) ? node.items : undefined;
    return items?.type === "string"
      ? { kind: "string-array" }
      : { kind: "mixed" };
  }
  if (
    node.type === "object" || isRecord(node.properties) ||
    isRecord(node.additionalProperties)
  ) {
    return { kind: "table" };
  }
  return { kind: "mixed" };
}

/** The dotted record-family prefixes whose entries may be built incrementally,
 * derived from {@link RECORD_ENTRY_SCHEMAS} so a new record section auto-enrols. */
function recordFamilyPrefixes(): string[] {
  return Object.keys(RECORD_ENTRY_SCHEMAS);
}

/** The raw parsed-TOML value at a Zod issue path, or undefined when absent. */
function rawValueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = raw;
  for (const seg of path) {
    if (!isRecord(node)) {
      return undefined;
    }
    node = node[String(seg)];
  }
  return node;
}

/**
 * Whether a schema issue is a MISSING key inside a record-family entry
 * (`[jobs.<n>]`, `[scopes.<n>]`, `[standards.<n>]`, `[worktree.resources.<n>]`)
 * — the one shape a programmatic write tolerates, because incremental table
 * construction is legitimate (`config set standards.cov.limit 80` before its
 * `run` exists), the same allowance {@link isSettableConfigPath} documents.
 * A key that is PRESENT with the wrong shape is never excused.
 */
function isIncompleteRecordEntry(
  raw: unknown,
  path: readonly PropertyKey[],
): boolean {
  if (rawValueAt(raw, path) !== undefined) {
    return false;
  }
  const dotted = path.map((p) => String(p)).join(".");
  return recordFamilyPrefixes().some((family) => {
    if (!dotted.startsWith(`${family}.`)) {
      return false;
    }
    // At least `<name>.<key>` beyond the family prefix: the issue sits inside
    // one entry, not on the family section itself.
    return dotted.slice(family.length + 1).split(".").length >= 2;
  });
}

/**
 * The problems that must BLOCK a programmatic write of new `discern.toml` text —
 * the write-time counterpart of {@link parseConfig}, used so a config editor can
 * never report success and leave a file the next read rejects. A TOML syntax
 * error or any schema violation blocks, with one allowance: a missing required
 * key inside a record-family entry (see {@link isIncompleteRecordEntry}).
 * Returns an empty list when the text is safe to write.
 */
export function configWriteIssues(text: string): ConfigIssue[] {
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    return [{ path: "", message: tomlSyntaxHint(err) }];
  }
  const semanticIssues = [
    ...jobFormIssues(parsed),
    ...jobApplicabilityIssues(parsed),
    ...acceptanceGrantIssues(parsed),
    ...checkpointReferenceIssues(parsed),
    ...checkpointQuestionSourceIssues(parsed),
  ];
  const result = configSchema.safeParse(parsed);
  if (result.success) {
    return semanticIssues;
  }
  return [
    ...semanticIssues,
    ...result.error.issues
      .filter((issue) => !isIncompleteRecordEntry(parsed, issue.path))
      .flatMap(toConfigIssues),
  ];
}

/**
 * Normalise a command-bearing config value into the engine's job list: a scalar
 * becomes a one-element list, an absent value an empty list, the known-job table
 * form contributes its `run`, and empty / `:` no-op items are dropped (the
 * long-standing `config_array` semantics).
 */
export function toCommandList(value: CommandValue | undefined): string[] {
  const run = typeof value === "object" && value !== null &&
      !Array.isArray(value)
    ? value.run
    : value;
  const items = run === undefined ? [] : Array.isArray(run) ? run : [run];
  return items.filter((s) => s !== "" && s !== ":");
}

/** A command-bearing value rendered as one shell command: list items joined with
 * ` && `, empties/`:` dropped. `""` when nothing real remains. Mirrors how a
 * multi-command value runs as a single job (e.g. a scope gate). */
export function toCommand(value: CommandValue | undefined): string {
  return toCommandList(value).join(" && ");
}

/** The per-job `timeout` override a command-bearing value carries, or undefined
 * when the value inherits the global `[gate].timeout` (the bare command-or-list
 * forms carry none; only the known-job table form can). */
export function commandTimeout(
  value: CommandValue | undefined,
): number | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value.timeout
    : undefined;
}
