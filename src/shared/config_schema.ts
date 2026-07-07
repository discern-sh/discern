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

/** TOML bare-key shape, enforced for check/scope/ratchet/resource names. */
const NAME_RE = /^[A-Za-z0-9_-]+$/;

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

/** A git pathspec, or a list of them — the extent a built-in `per` measures over. */
const globOrList = z.union([z.string(), z.array(z.string())]);

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
  paths: z.array(z.string()).describe("The globs that define the scope."),
  neutral: z.boolean().default(false).describe(
    "true: changes here need no gate (docs, agent guidance).",
  ),
  previewable: z.boolean().default(false).describe(
    "true: a person could see changes here — worth a preview link.",
  ),
  gate: commandOrList.optional().describe(
    "A command discern finish runs when this scope changed (a sub-component with its own self-contained gate).",
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
    "The integration branch the gate merges into and worktrees graduate onto. Override per-invocation with the MAIN_BRANCH env var.",
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
      "Your guideline source file(s), relative to the project root. Globs allowed. Read only if present; the built-in harness guidance is always prepended.",
    ),
  agents: z.array(z.string()).default([]).describe(
    "Which agent integrations to enable: claude_code -> CLAUDE.md, gemini -> GEMINI.md, codex / cursor / copilot -> AGENTS.md.",
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
    "[checks.<name>] — custom, non-standard gate work that isn't a known capability. `stage` (required) is one of fix|build|check|test; `run` the command (or list); `provides` an optional label.",
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

/** Where `discern graduate` lands the branch. A role, not a literal branch name —
 * `"trunk"` means whatever `[project].main_branch` is (`main`, `master`, …).
 * `"branch"`: leave the work on its own branch checked out in the main repo for
 * review (the worktree branch is preserved). `"trunk"`: fast-forward the trunk to
 * the branch tip, check the trunk out, and delete the now-merged branch. */
export const GRADUATE_TARGETS = ["branch", "trunk"] as const;
export type GraduateTarget = (typeof GRADUATE_TARGETS)[number];

const worktreeSection = z.strictObject({
  root: z.string().default("").describe(
    'Where per-worktree checkouts are created (a <name> dir is made under it). Empty (the default) ⇒ a sibling of the repo, "<repo>.worktrees" — visible and adjacent, never nested inside the checkout. A relative path resolves against the repo root (".claude/worktrees" nests them inside the repo); an absolute path is used as-is.',
  ),
  port: z.boolean().default(false).describe(
    "Give each worktree a deterministic dev-server port (hashed from its id) so concurrent worktrees never collide. Derived identity, not a resource — it provisions nothing.",
  ),
  graduate_to: z.enum(GRADUATE_TARGETS).default("branch").describe(
    'Where `discern graduate` lands by default. "branch" (the safe default) leaves the work on its own branch, checked out in the main repo for review — the branch is preserved. "trunk" fast-forwards the trunk to the branch tip, checks the trunk out, and deletes the now-merged branch (the gate already guarantees the branch contains the trunk, so this is always a clean fast-forward). "trunk" is a role: it resolves to `[project].main_branch` (`main`, `master`, …) — not a literal branch named "main". Override per-run with `--to branch|trunk`.',
  ),
  ignored_file_drift: z.boolean().default(true).describe(
    "Track ignored files at worktree setup and report top-level ignored paths that changed before the worktree is removed. Disable for projects whose ignored outputs churn too much to be useful.",
  ),
  inherit_env: z.array(z.string()).default([]).describe(
    "Environment values copied from the main checkout's .env into a new worktree's .env (secrets a fresh worktree needs but that aren't in version control).",
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
      "Commands run on EVERY setup pass — at creation, on session-start re-entry, and on `discern integrate` — to converge the worktree on the current tree (install dependencies, build). Run in order. Author them idempotent: they re-run routinely.",
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
    "[ratchets.<name>] — never-loosen quality floors, enforced on demand by `discern ratchets` (slow, so NOT part of `discern finish`). A ratchet is a number you only ever want to improve. If the number grows just because the project grew (alerts, TODOs, type errors over a growing tree), ratchet a rate, not the raw count: add `per` so growth alone never breaches it.",
  );

const gateSection = z.strictObject({
  stream: z.boolean().default(false).describe(
    "Stream each job's output live (line-prefixed) instead of buffering it until the stage finishes. Off by default (grouped).",
  ),
  fail_fast: z.boolean().default(true).describe(
    "Cancel the in-flight sibling commands the moment one fails. ON by default — an agent-driven gate wants a fast abort. Set false to run every job and see all failures in one pass.",
  ),
}).prefault({}).describe(
  "Ergonomics for the parallel gate stages (and scope gates). These affect how `discern finish` runs its concurrent jobs.",
);

const couplingSection = z.strictObject({
  in_gate: z.boolean().default(false).describe(
    "Surface the co-change advisory during the gate too — both `discern finish` and the fast inner loop `discern prepare` (as hints, at the tail), so the nudge meets a change while it is hot. Off by default; purely advisory, it never affects pass/fail.",
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
 */
export function resolveConfiguredAgents(config: DiscernConfig): string[] {
  if (config.guidance.agents.length > 0) {
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
          "dead config [features] — the subsystem toggles were retired (every subsystem is core now; ADR 0101); run `discern upgrade` to drop the section.",
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

/**
 * Whether a dotted key is a writable path in the schema — so `discern config set`
 * can refuse a typo (`project.frobnicate`, `gate.bogus`) at WRITE time rather
 * than leave a config the next read rejects. A record section (`checks`, `scopes`,
 * `ratchets`, `worktree.resources`) accepts any `<name>` segment, then matches the
 * value shape's keys. This deliberately permits a valid-but-incomplete path (e.g.
 * `ratchets.coverage.limit` before its `run` is set) — incremental table
 * construction is legitimate; only an UNKNOWN key/section is rejected.
 */
export function isSettableConfigPath(dotted: string): boolean {
  let node: Record<string, unknown> | undefined = liveSchemaJson();
  for (const seg of dotted.split(".")) {
    if (node === undefined) {
      return false;
    }
    const props: Record<string, unknown> | undefined = isRecord(node.properties)
      ? node.properties
      : undefined;
    const child: unknown = props?.[seg];
    if (props !== undefined && Object.hasOwn(props, seg)) {
      node = isRecord(child) ? child : undefined;
    } else if (isRecord(node.additionalProperties)) {
      // A record table: `seg` is a `<name>`; descend into the value shape.
      node = node.additionalProperties;
    } else {
      return false; // not a known key, and not a repeatable-name table
    }
  }
  return true;
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
