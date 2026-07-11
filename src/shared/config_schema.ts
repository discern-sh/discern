/**
 * The **single source of truth for `discern.toml`** — one Zod schema from which
 * every other artifact derives (ADR 0026). It defines every section, key, type,
 * **default**, and **human description**; the engine reads a fully-typed,
 * fully-defaulted object parsed through it, and the editor JSON Schema + the docs
 * config-reference are generated from it (see `config_codegen.ts`) — the docs
 * rendering straight from its `.describe(...)` annotations. (The `discern.toml`
 * template stays hand-authored for legibility — ADR 0005 — bound to the schema by
 * drift-guard tests rather than generated.)
 *
 * Before this, the config's shape/defaults/prose were smeared across a stringly
 * accessor, wizard defaults, a hand-written JSON Schema, the closed vocabularies,
 * path defaults, and `doctor`'s ad-hoc checks — copies that had already drifted
 * (ADR 0017 gave `[capabilities]` a closed vocabulary; ADR 0019 made "one source,
 * nothing to drift" the rule; this finishes the job at the config boundary).
 *
 * Two views share the same building blocks:
 *   - {@link configSchema} — the live `discern.toml` the engine validates.
 *   - {@link configDocSchema} — the declarative config *document* consumed by
 *     `setup --config` and presets, a derived subset so it cannot diverge.
 *
 * The inferred Zod types stay internal (re-exported as plain aliases); they never
 * surface in the package's exported API, so `no-slow-types` has nothing to chew.
 */

import { z } from "@zod/zod";
import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "./env.ts";
import { KNOWN_CAPABILITIES, STAGES } from "./capabilities.ts";
import { isValidDocsDir } from "./docs_path.ts";
import { SOURCE_PATHS } from "./paths_registry.ts";

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
  constructor(message: string) {
    super(message);
    this.name = "ConfigParseError";
  }
}

// ── shared building blocks (reused by the live config AND the document) ────────

/** TOML bare-key shape, enforced for check/scope/ratchet/resource names. The ONE
 * definition of record-key legality: the `z.record` key schema below applies it at
 * load, the generated JSON Schema carries it as `propertyNames.pattern`, and the
 * settable-path walker reads that pattern back — so `config set` can never write a
 * `<name>` the next load would reject. */
export const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** The agent/provider files discern knows how to emit — the single source for
 * the document's `agents` enum, the generated editor JSON Schema (so it can never
 * miss one), AND the installer's `KNOWN_AGENTS` (re-exported from
 * `lib/config.ts`). */
export const AGENT_NAMES = [
  "claude_code",
  "codex",
  "gemini",
  "cursor",
  "copilot",
] as const;

/**
 * The providers a fresh install emits when neither `[guidance].agents` nor the
 * legacy `[project].agents` is set — the two committed-standard agents (gemini is
 * opt-in). The ONE definition of this default, shared by the init seed
 * (`lib/config.ts`), the compile fallback ({@link resolveConfiguredAgents}), and
 * the schema-migration fallback, so the three can never disagree.
 */
export const DEFAULT_AGENTS = [
  "claude_code",
  "codex",
] as const satisfies readonly (typeof AGENT_NAMES)[number][];

/** A capability/check/gate/ratchet value: one command, or a list run in order. */
const commandOrList = z.union([z.string(), z.array(z.string())]).describe(
  "A single command, or a list of commands run in order.",
);

/** A git pathspec, or a NON-EMPTY list of them — the extent a built-in `per`
 * measures over. The list form requires at least one pathspec: an empty list would
 * reach `git ls-files -z --` with zero pathspecs, which git reads as "every tracked
 * file", silently making a ratchet's denominator the whole repository instead of
 * the extent its config named. Refusing `[]` here closes that for every measure at
 * once, since each `perExtent` extent reuses this shape. */
const globOrList = z.union([
  z.string(),
  z.array(z.string()).min(1, "a per extent needs at least one git pathspec."),
]);

/** The built-in extents a ratchet's `per` can divide by — universal, stack-neutral
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

/** A ratchet's denominator. Turn a raw count into a *rate* so the number doesn't
 * rise just because the project grew. Either the name of a second metric the `run`
 * emits, or a built-in extent discern measures itself, e.g.
 * `per = { words = "${docs.dir}**" }`. */
const perValue = z.union([z.string(), perExtent]);

/** The gate stages a `[checks.<name>].stage` may name. */
const stageEnum = z.enum(STAGES);

/** A `[checks.<name>]` table — custom gate work with an explicit stage. */
const checkValue = z.strictObject({
  stage: stageEnum.describe(
    "When the check runs in the gate (fix|build|check|test).",
  ),
  run: commandOrList.describe("The command(s) to run."),
  provides: z.string().optional().describe(
    "Optional free-text label, for humans / audit.",
  ),
});

/** A `[scopes.<name>]` table — a named region with optional attributes. */
const scopeValue = z.strictObject({
  paths: z.array(z.string()).describe(
    "The globs that define the scope: a directory prefix (src/**), a standard glob (src/**/*.ext, src/*), a *.ext suffix at any depth, a /seg/ segment, or an exact path.",
  ),
  neutral: z.boolean().default(false).describe(
    "true: changes here need no gate (docs, agent guidance).",
  ),
  previewable: z.boolean().default(false).describe(
    "true: a person could see changes here — worth a preview link.",
  ),
  gate: commandOrList.optional().describe(
    "A command discern done runs when this scope changed (a sub-component with its own self-contained gate).",
  ),
});

/** A `[ratchets.<name>]` table — one never-loosen metric floor/ceiling. */
const ratchetValue = z.strictObject({
  metric: z.string().optional().describe(
    "Metric name the run emits (default: the ratchet name).",
  ),
  direction: z.enum(["up", "down"]).default("up").describe(
    '"up": limit is a floor; "down": limit is a ceiling.',
  ),
  limit: z.number().describe("The floor (up) or ceiling (down)."),
  run: commandOrList.describe(
    "The command whose output emits the metric line: DISCERN_METRIC <metric> <number>.",
  ),
  per: perValue.optional().describe(
    "Divide the metric by this to ratchet a *rate*, not a raw count — so the number " +
      "doesn't rise just because the project grew. Either a second metric the run emits, " +
      'or a built-in extent discern measures itself: per = { words = "${docs.dir}**" } ' +
      "(files | lines | words | bytes over a git pathspec).",
  ),
  scale: z.number().default(1).describe(
    'Multiply the rate by this so the limit reads in human units, e.g. scale = 1000 for "per 1,000 words".',
  ),
  margin: z.number().min(
    0,
    "margin is headroom and cannot be negative — a negative margin would tighten a pinned limit PAST the measured value, so the value just measured would fail it.",
  ).default(0).describe(
    "Headroom `discern ratchets --pin` leaves when it tightens this limit to the " +
      "measured value: pin sets a floor to measured−margin (up) or a ceiling to " +
      "measured+margin (down), and leaves a ratchet un-pinned when the improvement " +
      "is smaller than its margin. Must be ≥ 0. Default 0 pins to the exact measured " +
      "value; give a metric that drifts on unrelated changes (bundle size, coverage) " +
      "a margin so a pinned limit isn't tripped by ordinary fluctuation.",
  ),
});

// ── the live `discern.toml` schema ─────────────────────────────────────────────

const metaSection = z.strictObject({
  schema_version: z.number().int().optional().describe(
    "The install schema version — managed by discern (bumped by `discern upgrade`). Don't edit by hand.",
  ),
  bootstrapped: z.boolean().default(false).describe(
    "Whether `discern setup` has completed — retires the one-time setup redirect.",
  ),
  setup_model: z.string().default("").describe(
    "The model the agent self-declared at `discern setup begin --model=…`. Recorded for support triage; advisory only (discern can't verify it).",
  ),
  setup_version: z.string().default("").describe(
    "The discern version that ran setup (observed at `begin`). Recorded for support triage.",
  ),
}).prefault({}).describe(
  "Installer bookkeeping. `schema_version` is the migration anchor; edit by hand only to force a re-migration.",
);

const projectSection = z.strictObject({
  slug: z.string().default("").describe(
    "Short, lowercase, dash-separated identity. Used for worktree/site/branch names.",
  ),
  branch_prefix: z.string().default("agent/").describe(
    'Branch prefix for worktrees created by the harness, e.g. "agent/my-feature".',
  ),
  main_branch: z.string().default("main").describe(
    "The integration branch the gate merges into and completed work lands on. Override per-invocation with the DISCERN_MAIN_BRANCH env var.",
  ),
  gotchas_doc: z.string().default("").describe(
    "Where the gate points an agent when a stage fails in a non-obvious way. Empty disables the pointer.",
  ),
  todo: z.string().default(SOURCE_PATHS.todo.defaultPath).describe(
    "Where the deferred-work ledger (the running TODO list agents read and maintain) lives, relative to the project root.",
  ),
  agents: z.array(z.string()).optional().describe(
    "Deprecated: providers now live under [guidance].agents. Read only as a pre-migration fallback.",
  ),
}).prefault({}).describe("Project identity and integration settings.");

const guidanceSection = z.strictObject({
  sources: z.array(z.string()).default([SOURCE_PATHS.guidance.defaultPath])
    .describe(
      "Your guideline source file(s), relative to the project root. Globs allowed; the generated agent files are never picked up as sources, so a glob may safely match them. Read only if present; the built-in harness guidance is always prepended.",
    ),
  agents: z.array(z.string()).optional().describe(
    "Which agent integrations to enable: claude_code -> CLAUDE.md, gemini -> GEMINI.md, codex / cursor / copilot -> AGENTS.md. OMIT the key for the default pair (claude_code, codex); set it to an explicit empty list [] to emit for no agents at all.",
  ),
}).prefault({}).describe(
  "The author-once → compile-everywhere agent-instruction pipeline. `discern refresh` compiles discern's built-in guidance plus your sources into one generated file per provider.",
);

const skillsSection = z.strictObject({
  dir: z.string().default(SOURCE_PATHS.skills.defaultPath).describe(
    "Where your authored skills live, relative to the project root. Read only if present, so a project with no authored-skills dir simply uses the built-ins.",
  ),
  exclude: z.array(z.string()).default([]).describe(
    "Skill names (bundled or authored) excluded from materialization — each materialized skill occupies context in every agent session, so drop the ones this project never needs. An unknown name is warned about, never fatal.",
  ),
}).prefault({}).describe(
  "Focused, reusable task playbooks. The effective set is discern's bundled built-ins plus your authored skills under the directory below, where yours override a built-in of the same name, minus any names in `exclude`.",
);

const docsSection = z.strictObject({
  dir: z.string().refine(isValidDocsDir, {
    message:
      "must be a project-relative directory that stays inside the repository",
  }).default(SOURCE_PATHS.docs.defaultPath).describe(
    "Where discern's agent documentation tree lives, relative to the project root. `discern setup` scaffolds it here and `discern docs` browses it by default.",
  ),
}).prefault({}).describe(
  "The project documentation tree discern scaffolds, validates, and browses.",
);

/** The closed [capabilities] object: the six known names, each an optional
 * command-or-list. Shared by the live config (prefaulted) AND the document
 * (optional), so both — and the generated JSON Schema — derive from one shape. */
const capabilitiesObject = z.strictObject({
  format: commandOrList.optional().describe(
    "fix stage — a formatter/codemod (mutating; runs first, serially).",
  ),
  build: commandOrList.optional().describe(
    "build stage — produce artifacts later stages read (compile, bundle).",
  ),
  lint: commandOrList.optional().describe(
    "check stage — read-only static analysis.",
  ),
  typecheck: commandOrList.optional().describe(
    "check stage — read-only type checking.",
  ),
  test: commandOrList.optional().describe("test stage — the test suite."),
  smoke: commandOrList.optional().describe(
    "test stage — a fast, side-effect-light check that the app boots in THIS checkout (a framework's inspire/about, a CLI --version, a config-load-and-exit); proves viability wherever the gate runs, including inside a worktree. Not an e2e suite.",
  ),
});

const capabilitiesSection = capabilitiesObject.prefault({}).describe(
  "The core commands the gate runs, one per known capability; each maps to a gate stage automatically. The set is CLOSED — for custom work use a [checks.<name>] table with an explicit stage. OMIT a capability you don't have.",
);

const checksSection = z.record(z.string().regex(NAME_RE), checkValue).default(
  {},
)
  .describe(
    "[checks.<name>] — custom, non-standard gate work that isn't a known capability. `stage` (required) is one of fix|build|check|test; `run` the command (or list); `provides` an optional label. A name also wired under [capabilities] is rejected: the gate keys each job's result by its label, so the two would collide.",
  );

const scopesSection = z.record(z.string().regex(NAME_RE), scopeValue).default(
  {},
)
  .describe(
    "[scopes.<name>] — named regions of the repo. `paths` globs define a scope; the optional flags tune the gate for changes there. Classification fails OPEN: a path matching no scope counts as a real code change.",
  );

const resourceValue = z.strictObject({
  create: z.string().default("").describe(
    "Command run once at worktree setup (skipped when the resource is already provisioned). Author it idempotent and cwd-independent. An empty command is a clean no-op.",
  ),
  destroy: z.string().default("").describe(
    "Command run once at teardown. Author it idempotent (it may re-run via worktree prune) and cwd-independent.",
  ),
  ensure: z.string().default("").describe(
    "Optional: reconcile drift / re-readiness at session start.",
  ),
  required: z.boolean().default(true).describe(
    "false: a create failure is non-fatal (does not abort setup).",
  ),
  retries: z.number().default(0).describe(
    "Retry create/destroy this many times.",
  ),
  gc: z.boolean().default(true).describe(
    "false: never orphan-prune it (teardown-only; for data-loss-sensitive ones).",
  ),
});

/**
 * The Zod entry schema for each record-table family — the single source of truth
 * for the knobs a `[ratchets.<name>]` / `[checks.<name>]` / `[scopes.<name>]` /
 * `[worktree.resources.<name>]` table accepts. Keyed by record family so the
 * managed-banner guard (ADR 0107) can assert every knob is documented in that
 * family's banner — the only channel by which a newly-added knob reaches an
 * existing install. A field added here auto-enrols in that check.
 */
export const RECORD_ENTRY_SCHEMAS = {
  checks: checkValue,
  scopes: scopeValue,
  ratchets: ratchetValue,
  "worktree.resources": resourceValue,
} as const;

const worktreeSection = z.strictObject({
  root: z.string().default("").describe(
    'Where per-worktree checkouts are created (a <name> dir is made under it). Empty (the default) ⇒ a sibling of the repo, "<repo>.worktrees" — visible and adjacent, never nested inside the checkout. A relative path resolves against the repo root (".claude/worktrees" nests them inside the repo); an absolute path is used as-is.',
  ),
  port: z.boolean().default(false).describe(
    "Give each worktree a deterministic dev-server port (hashed from its id) so concurrent worktrees never collide. Derived identity, not a resource — it provisions nothing.",
  ),
  ignored_file_drift: z.boolean().default(true).describe(
    "Track ignored files at worktree setup and report top-level ignored paths that changed before the worktree is removed. Disable for projects whose ignored outputs churn too much to be useful.",
  ),
  inherit_env: z.array(z.string()).default([]).describe(
    "Environment values copied from the main checkout's env files into a new worktree's (secrets a fresh worktree needs but that aren't in version control). The worktree's env file is created when absent, so a declared value always arrives.",
  ),
  env_files: z.array(z.string()).default([".env", ".env.local"]).describe(
    "The env files the worktree lifecycle reads and writes, in precedence order: when reading, the last listed file that defines a value wins (the dotenv override convention); a newly written value lands in the first. `inherit_env` reads these in the main checkout and writes the worktree's copy; the deterministic port and resource handles are recorded into them too.",
  ),
  resources: z.record(z.string().regex(NAME_RE), resourceValue).default({})
    .describe(
      "[worktree.resources.<name>] — per-worktree external resources (a database, an emulator, a container, a queue). Created top-to-bottom and destroyed bottom-to-top.",
    ),
  setup: z.strictObject({
    steps: z.array(z.string()).default([]).describe(
      "Commands run ONCE at worktree creation (one-shot scaffolding — create a database, seed fixtures). Run in order after the resources are created; not re-run.",
    ),
    ensure: z.array(z.string()).default([]).describe(
      "Commands run on EVERY setup pass — at creation, on session-start re-entry, and on `discern update` — to converge the worktree on the current tree (install dependencies, build). Run in order. Author them idempotent: they re-run routinely.",
    ),
  }).prefault({}).describe(
    "Worktree setup commands: one-shot `steps` (creation only) and convergent `ensure` (re-run every pass).",
  ),
}).prefault({}).describe(
  "The isolated-worktree workflow. The git mechanics are generic; everything project-specific is a RESOURCE you declare.",
);

const ratchetsSection = z.record(z.string().regex(NAME_RE), ratchetValue)
  .default(
    {},
  ).describe(
    "[ratchets.<name>] — never-loosen quality floors, enforced on demand by `discern ratchets` (slow, so NOT part of `discern done`). A ratchet is a number you only ever want to improve. If the number grows just because the project grew (alerts, TODOs, type errors over a growing tree), ratchet a rate, not the raw count: add `per` so growth alone never breaches it.",
  );

const gateSection = z.strictObject({
  stream: z.boolean().default(false).describe(
    "Stream each job's output live (line-prefixed) instead of buffering it until the stage finishes. Off by default (grouped).",
  ),
  fail_fast: z.boolean().default(true).describe(
    "Cancel the in-flight sibling commands the moment one fails. ON by default — an agent-driven gate wants a fast abort. Set false to run every job and see all failures in one pass.",
  ),
  timeout: z.number().default(600).describe(
    "Per-command time budget in SECONDS, applied to every job the gate runs (each capability, check, and scope gate). A command that does not exit within it is tree-killed and the stage fails with a plain-language timeout diagnostic — so the gate can never hang. One generous global budget (default 600 = 10 minutes): long enough for a real test suite, short enough that a stuck command (a watch-mode runner or a dev server wired without its single-run form) is caught within minutes rather than never. Set to 0 to disable the limit (not recommended — the gate can then hang indefinitely).",
  ),
}).prefault({}).describe(
  "Ergonomics for the parallel gate stages (and scope gates). These affect how `discern done` runs its concurrent jobs.",
);

const couplingSection = z.strictObject({
  in_gate: z.boolean().default(false).describe(
    "Surface the co-change advisory during the gate too — both `discern done` and the fast inner loop `discern prepare` (as hints, at the tail), so the nudge meets a change while it is hot. Off by default; purely advisory, it never affects pass/fail.",
  ),
}).prefault({}).describe(
  "Co-change coupling detection — a zero-config, read-only advisory that mines git history for files that change together, so a touched file's habitual sibling isn't forgotten. It self-calibrates to your repo, so there are no thresholds to tune; the only setting is whether it also rides along with the gate. Read it on demand with `discern coupling`. Purely advisory: it points at where to look and never blocks.",
);

const recipesSection = z.strictObject({
  dir: z.string().default(SOURCE_PATHS.recipes.defaultPath).describe(
    'Where your recipes live, relative to the project root. The default works with no config; point it elsewhere (e.g. "tools/") if you prefer.',
  ),
}).prefault({}).describe(
  "Your own `discern` commands. Drop an executable carrying a `# desc: ...` line into the directory below and it becomes a first-class `discern <name>` command.",
);

/** The canonical live-`discern.toml` schema. Every section carries a default, so
 * an empty `{}` validates to a fully-defaulted object. Strict throughout: an
 * unknown section or key is a typo worth catching at load, not silently ignoring. */
export const configSchema = z.strictObject({
  meta: metaSection,
  project: projectSection,
  guidance: guidanceSection,
  skills: skillsSection,
  docs: docsSection,
  capabilities: capabilitiesSection,
  checks: checksSection,
  scopes: scopesSection,
  worktree: worktreeSection,
  ratchets: ratchetsSection,
  gate: gateSection,
  coupling: couplingSection,
  recipes: recipesSection,
});

/** The fully-typed, fully-defaulted live config the engine reads. Internal alias
 * of the inferred Zod type — never part of the package's exported API. */
export type DiscernConfig = z.infer<typeof configSchema>;

/**
 * The provider names to emit guidance / materialize skills for: the configured
 * `[guidance].agents`, else the legacy `[project].agents`, else {@link
 * DEFAULT_AGENTS}. The single resolver shared by the compiler, the worktree
 * dispatcher, AND the skills currency check — so "which agents are configured" is
 * answered identically everywhere, never re-derived per call-site. Pure: reads only
 * the passed config.
 *
 * `[guidance].agents` is OPTIONAL, so an absent key (undefined) and an explicit
 * empty list are distinct: absent falls through to the legacy key and then the
 * default pair, while an explicit `agents = []` is an author's deliberate "emit for
 * no agents" and is honored verbatim. Conflating the two — the historic behaviour —
 * made "no agents, please" impossible to express.
 */
export function resolveConfiguredAgents(config: DiscernConfig): string[] {
  if (config.guidance.agents !== undefined) {
    return config.guidance.agents;
  }
  const legacy = config.project.agents ?? [];
  return legacy.length > 0 ? legacy : [...DEFAULT_AGENTS];
}

/** One `[checks.<name>]` entry, fully defaulted. */
export type CheckConfig = z.infer<typeof checkValue>;
/** One `[scopes.<name>]` entry, fully defaulted. */
export type ScopeConfig = z.infer<typeof scopeValue>;
/** One `[ratchets.<name>]` entry, fully defaulted. */
export type RatchetConfig = z.infer<typeof ratchetValue>;
/** One `[worktree.resources.<name>]` entry, fully defaulted. */
export type ResourceConfig = z.infer<typeof resourceValue>;

// ── the declarative config *document* (setup --config / presets) ────────────────

/**
 * The config-document major version this build understands. A document may omit
 * `version` (assumed current) or carry a matching major; a different major is a
 * breaking shape this build refuses rather than misreads.
 */
export const CONFIG_DOC_VERSION = "2";

/** The document's gate-config tables reuse the *same* building blocks as the live
 * config, so the document shape can never diverge from what the engine reads. The
 * base fields (name/slug/brief/source_globs/agents) are install inputs the
 * document layer maps onto the live sections.
 *
 * Strict here drives a STRICT generated editor JSON Schema (so a typo'd key is
 * flagged while authoring a preset / config doc). The *runtime* loader stays
 * lenient — `loadConfigDoc` parses + version-checks, and `applyConfigDoc` reads
 * only the fields it applies — so a newer field within the same major never
 * breaks an older reader (ADR 0005). */
export const configDocSchema = z.strictObject({
  $schema: z.string().optional().describe(
    "Editor-only pointer to this schema; ignored by discern.",
  ),
  version: z.union([z.string(), z.number()]).optional().describe(
    `Document major version. Omit (assumed current) or use a matching major; this build understands version ${CONFIG_DOC_VERSION}.`,
  ),
  name: z.string().optional().describe("Project name (free text)."),
  slug: z.string().optional().describe(
    "Project slug: lowercase letters, digits and dashes, starting with a letter or digit.",
  ),
  branch_prefix: z.string().optional().describe(
    'Branch prefix for worktrees, e.g. "agent/".',
  ),
  source_globs: z.array(z.string()).optional().describe(
    'Primary source globs, e.g. ["src/**"].',
  ),
  brief: z.string().optional().describe(
    "Free-text description of what the project is.",
  ),
  agents: z.array(z.enum(AGENT_NAMES)).optional().describe(
    "Which agent integrations to enable: claude_code -> CLAUDE.md, gemini -> GEMINI.md, codex / cursor / copilot -> AGENTS.md.",
  ),
  description: z.string().optional().describe(
    "Preset metadata, shown when listing presets; ignored by `setup --config`.",
  ),
  docs: docsSection.optional().describe(
    "[docs] settings — chiefly the project-relative directory holding discern's agent documentation tree.",
  ),
  capabilities: capabilitiesObject.optional().describe(
    "[capabilities] fills — a known capability name mapped to a command (or list). The gate stage is derived from the name; the set is closed.",
  ),
  checks: z.record(z.string().regex(NAME_RE), checkValue).optional().describe(
    "[checks.<name>] fills — custom gate work outside the known capability vocabulary.",
  ),
  scopes: z.record(z.string().regex(NAME_RE), scopeValue).optional().describe(
    "[scopes.<name>] tables — a named region defined by `paths`, with optional attributes.",
  ),
  ratchets: z.record(z.string().regex(NAME_RE), ratchetValue).optional()
    .describe(
      "[ratchets.<name>] tables. Coverage is just a conventional name.",
    ),
}).describe(
  "The declarative config shape consumed by `discern setup --config <file>` and by a preset's `preset.json`. Its capabilities/checks/scopes/ratchets are written into a project's discern.toml via the comment-preserving editor. Every field is optional.",
);

/** The config-document shape — the *input* view (what an author writes, before
 * defaults), so optional attributes (a scope's `neutral`, a ratchet's
 * `direction`) stay optional. Internal alias of the inferred Zod type. */
export type DiscernConfigDoc = z.input<typeof configDocSchema>;

// ── parse / validate / load ────────────────────────────────────────────────────

/** One schema-validation problem: a dotted path and a human message. */
export interface ConfigIssue {
  /** Dotted path to the offending value, e.g. `ratchets.coverage.limit`. */
  path: string;
  /** What is wrong, phrased for a human reading it next to their config. */
  message: string;
}

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
  const lines = issues.map((i) =>
    i.path === "" ? `  - ${i.message}` : `  - ${i.path}: ${i.message}`
  );
  return `discern.toml is invalid:\n${lines.join("\n")}`;
}

/** Turn one Zod issue into a {@link ConfigIssue}, with discern-specific hints for
 * the closed [capabilities] vocabulary and dead worktree adapters. */
function toConfigIssue(issue: z.core.$ZodIssue): ConfigIssue {
  const path = issue.path.map((p) => String(p)).join(".");
  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.join(", ");
    if (path === "capabilities") {
      return {
        path,
        message: `unknown capability ${keys} — rename to a known capability (${
          Object.keys(KNOWN_CAPABILITIES).join(", ")
        }) or move it under [checks.<name>] with a stage.`,
      };
    }
    if (path === "worktree" && issue.keys.includes("enabled")) {
      return {
        path,
        message:
          `dead config ${keys} — the worktree workflow is core now, not a toggle; run \`discern upgrade\` to drop it.`,
      };
    }
    if (path === "worktree" && issue.keys.includes("graduate_to")) {
      return {
        path,
        message:
          `dead config ${keys} — \`discern accept\` always lands on the trunk now (there is one landing target); run \`discern upgrade\` to drop the key.`,
      };
    }
    if (path === "worktree") {
      return {
        path,
        message:
          `dead config ${keys} — the engine reads [worktree.resources.<name>] now; run \`discern upgrade\` to migrate it.`,
      };
    }
    if (path === "" && issue.keys.includes("features")) {
      return {
        path,
        message:
          "dead config [features] — the subsystem toggles were retired (every subsystem is core now); run `discern upgrade` to drop the section.",
      };
    }
    return {
      path: path === "" ? keys : `${path}.${keys}`,
      message: path === ""
        ? `unknown section(s): ${keys}`
        : `unknown key(s) in [${path}]: ${keys}`,
    };
  }
  // A boolean value written as a quoted string is the most common type trip
  // (`fail_fast = "false"`, `docs = "yes"`); the raw Zod message ("expected
  // boolean, received string") doesn't hint the fix.
  if (issue.code === "invalid_type" && issue.expected === "boolean") {
    return {
      path,
      message:
        "expected a boolean — use a bare `true` or `false` (not a quoted string).",
    };
  }
  return { path, message: issue.message };
}

/**
 * The names declared under BOTH `[capabilities]` and `[checks.<name>]` — a
 * cross-section rule the per-section schemas can't express. The gate keys every
 * job result by its LABEL, and a capability job and a check job each carry their
 * bare name, so a shared name makes one job's result silently overwrite the
 * other's — destroying the failing job's captured output and diagnostics. The
 * other label namespaces are disjoint by construction (scope gates are prefixed
 * `scope:`, list-expansion labels carry `#`; neither character is in NAME_RE),
 * leaving this pair as the only possible collision.
 */
export function capabilityCheckNameCollisions(cfg: {
  capabilities: Record<string, unknown>;
  checks: Record<string, unknown>;
}): string[] {
  const wired = new Set(
    Object.entries(cfg.capabilities)
      .filter(([, value]) => value !== undefined)
      .map(([name]) => name),
  );
  return Object.keys(cfg.checks).filter((name) => wired.has(name));
}

/** The {@link ConfigIssue}s for every capability/check name collision. */
function collisionIssues(config: DiscernConfig): ConfigIssue[] {
  return capabilityCheckNameCollisions(config).map((name) => ({
    path: `checks.${name}`,
    message:
      `shares its name with [capabilities].${name} — the gate keys each job's result by its label, so one job's outcome would silently overwrite the other's. Rename the check, or fold its command into the capability.`,
  }));
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
    throw new ConfigParseError(tomlSyntaxHint(err));
  }
  const result = configSchema.safeParse(parsed);
  if (result.success) {
    const collisions = collisionIssues(result.data);
    if (collisions.length > 0) {
      return { config: undefined, issues: collisions };
    }
    return { config: result.data, issues: [] };
  }
  return { config: undefined, issues: result.error.issues.map(toConfigIssue) };
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
 * Load, parse, and validate the install config (`discern.toml`, or a legacy
 * `.discern/config.toml`) from under a project `root`, returning the fully-typed
 * object. Throws on a missing file, a syntax error, or a schema violation.
 */
export async function loadConfig(root: string): Promise<DiscernConfig> {
  const rel = (await installedConfigRel(root)) ?? CONFIG_REL;
  return parseConfigOrThrow(await Deno.readTextFile(join(root, rel)));
}

/** True for a non-null, non-array object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The live schema as a JSON Schema, computed once for path checks. */
let liveJsonSchema: Record<string, unknown> | undefined;
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

/**
 * Walk the live JSON Schema along a dotted key. `found` is whether every segment
 * resolved (a record section — `checks`, `scopes`, `ratchets`,
 * `worktree.resources` — accepts a `<name>` segment matching the section's
 * `propertyNames.pattern`, descending into the value shape); `node` is the schema
 * node the path lands on. The ONE walk behind both {@link isSettableConfigPath}
 * and {@link settableConfigValueKind}, so "does this path exist" and "what does it
 * hold" can never disagree.
 *
 * The record-key pattern is enforced here so the walker refuses exactly the
 * `<name>` shapes the runtime `z.record` key schema would refuse — otherwise
 * `config set` would accept a key (a space, a slash, non-ASCII) it then writes as
 * a `[checks.<bad name>]` header the next load rejects.
 */
function settableSchemaNode(
  dotted: string,
): { found: boolean; node: Record<string, unknown> | undefined } {
  let node: Record<string, unknown> | undefined = liveSchemaJson();
  for (const seg of dotted.split(".")) {
    if (node === undefined) {
      return { found: false, node: undefined };
    }
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
 * valid-but-incomplete path (e.g. `ratchets.coverage.limit` before its `run` is
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
 * - `mixed` — a union (a command-or-list, a ratchet `per`): no single required
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

export function settableConfigValueKind(
  dotted: string,
): ConfigValueKind | undefined {
  const { found, node } = settableSchemaNode(dotted);
  if (!found) {
    return undefined;
  }
  if (node === undefined) {
    return { kind: "mixed" }; // unreachable for Zod-emitted schemas; stay lenient
  }
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
 * (`[checks.<n>]`, `[scopes.<n>]`, `[ratchets.<n>]`, `[worktree.resources.<n>]`)
 * — the one shape a programmatic write tolerates, because incremental table
 * construction is legitimate (`config set ratchets.cov.limit 80` before its
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
  const result = configSchema.safeParse(parsed);
  if (result.success) {
    return [];
  }
  return result.error.issues
    .filter((issue) => !isIncompleteRecordEntry(parsed, issue.path))
    .map(toConfigIssue);
}

/**
 * Normalise a command-or-list config value into the engine's job list: a scalar
 * becomes a one-element list, an absent value an empty list, and empty / `:`
 * no-op items are dropped (the long-standing `config_array` semantics).
 */
export function toCommandList(value: string | string[] | undefined): string[] {
  const items = value === undefined
    ? []
    : Array.isArray(value)
    ? value
    : [value];
  return items.filter((s) => s !== "" && s !== ":");
}

/** A command-or-list rendered as one shell command: list items joined with ` && `,
 * empties/`:` dropped. `""` when nothing real remains. Mirrors how a multi-command
 * value runs as a single job (e.g. a scope gate). */
export function toCommand(value: string | string[] | undefined): string {
  return toCommandList(value).join(" && ");
}
