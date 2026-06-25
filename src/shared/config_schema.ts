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
 *     `init --config` and presets, a derived subset so it cannot diverge.
 *
 * The inferred Zod types stay internal (re-exported as plain aliases); they never
 * surface in the package's exported API, so `no-slow-types` has nothing to chew.
 */

import { z } from "@zod/zod";
import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "./env.ts";
import { KNOWN_CAPABILITIES, STAGES } from "./capabilities.ts";

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
 * again miss one — the historical gemini-shaped staleness bug), AND the
 * installer's `KNOWN_AGENTS` (re-exported from `lib/config.ts`). */
export const AGENT_NAMES = ["claude_code", "codex", "gemini"] as const;

/** A capability/check/gate/ratchet value: one command, or a list run in order. */
const commandOrList = z.union([z.string(), z.array(z.string())]).describe(
  "A single command, or a list of commands run in order.",
);

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
});

// ── the live `discern.toml` schema ─────────────────────────────────────────────

const metaSection = z.strictObject({
  schema_version: z.number().int().optional().describe(
    "The install schema version — managed by discern (bumped by `discern upgrade`). Don't edit by hand.",
  ),
  bootstrapped: z.boolean().default(false).describe(
    "Whether `discern setup` has completed — retires the one-time setup redirect.",
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
  agents: z.array(z.string()).optional().describe(
    "Deprecated: providers now live under [guidance].agents. Read only as a pre-migration fallback.",
  ),
}).prefault({}).describe("Project identity and integration settings.");

const featuresSection = z.strictObject({
  worktrees: z.boolean().default(true).describe(
    "The isolated git-worktree workflow (worktree / worktree:* verbs).",
  ),
  ratchets: z.boolean().default(true).describe(
    "Never-loosen metric floors (the `ratchets` verb).",
  ),
  guidance: z.boolean().default(true).describe(
    "Compile agent files from built-in + your sources.",
  ),
  skills: z.boolean().default(true).describe(
    "Bundled + authored skills, materialized into .claude/skills/.",
  ),
  docs: z.boolean().default(true).describe(
    "The `docs` browser over your docs/ tree.",
  ),
  mcp: z.boolean().default(true).describe(
    "The MCP integration: the `discern mcp` server, and wiring it into each configured agent's project config (disable to remove it on the next refresh).",
  ),
}).prefault({}).describe(
  "Toggle whole discern subsystems on/off. Every feature defaults to ON; set one to false to remove it coherently. NOTE: a *feature* is NOT a *capability* — [capabilities] is the gate's command table; [features] toggles subsystems.",
);

const guidanceSection = z.strictObject({
  sources: z.array(z.string()).default(["guidance.md"]).describe(
    "Your guideline source file(s), relative to the project root. Globs allowed. Read only if present; the built-in harness guidance is always prepended.",
  ),
  agents: z.array(z.string()).default([]).describe(
    'Which provider files to emit: "claude_code" -> CLAUDE.md, "codex" -> AGENTS.md, "gemini" -> GEMINI.md.',
  ),
}).prefault({}).describe(
  "The author-once → compile-everywhere agent-instruction pipeline. `discern refresh` compiles discern's built-in guidance plus your sources into one generated file per provider.",
);

const skillsSection = z.strictObject({
  dir: z.string().default("skills").describe(
    "Where your authored skills live, relative to the project root. Read only if present, so a project with no skills/ dir simply uses the built-ins.",
  ),
}).prefault({}).describe(
  "Focused, reusable task playbooks. The effective set is discern's bundled built-ins plus your authored skills under the directory below, where yours override a built-in of the same name.",
);

/** The closed [capabilities] object: the five known names, each an optional
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
    "Command run once at teardown. Author it idempotent (it may re-run via worktree:prune) and cwd-independent.",
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

const worktreeSection = z.strictObject({
  enabled: z.boolean().default(false).describe(
    "Run the idempotent worktree setup automatically at session start.",
  ),
  port: z.boolean().default(false).describe(
    "Give each worktree a deterministic dev-server port (hashed from its id) so concurrent worktrees never collide. Derived identity, not a resource — it provisions nothing.",
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
      "Commands run once after a worktree's resources are created (install deps, run migrations, warm caches). Run in order; skipped once the worktree is configured. Author each idempotent so a recovered partial setup re-runs safely.",
    ),
  }).prefault({}).describe("Post-create setup steps."),
}).prefault({}).describe(
  "The isolated-worktree workflow. The git mechanics are generic; everything project-specific is a RESOURCE you declare. Inert when [features].worktrees = false.",
);

const ratchetsSection = z.record(z.string().regex(NAME_RE), ratchetValue)
  .default(
    {},
  ).describe(
    "[ratchets.<name>] — never-loosen quality floors, enforced on demand by `discern ratchets` (slow, so NOT part of `discern finish`). A ratchet is a number you only ever want to improve.",
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

const recipesSection = z.strictObject({
  dir: z.string().default("recipes").describe(
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
  features: featuresSection,
  guidance: guidanceSection,
  skills: skillsSection,
  capabilities: capabilitiesSection,
  checks: checksSection,
  scopes: scopesSection,
  worktree: worktreeSection,
  ratchets: ratchetsSection,
  gate: gateSection,
  recipes: recipesSection,
});

/** The fully-typed, fully-defaulted live config the engine reads. Internal alias
 * of the inferred Zod type — never part of the package's exported API. */
export type DiscernConfig = z.infer<typeof configSchema>;

/** One `[checks.<name>]` entry, fully defaulted. */
export type CheckConfig = z.infer<typeof checkValue>;
/** One `[scopes.<name>]` entry, fully defaulted. */
export type ScopeConfig = z.infer<typeof scopeValue>;
/** One `[ratchets.<name>]` entry, fully defaulted. */
export type RatchetConfig = z.infer<typeof ratchetValue>;
/** One `[worktree.resources.<name>]` entry, fully defaulted. */
export type ResourceConfig = z.infer<typeof resourceValue>;

// ── the declarative config *document* (init --config / presets) ────────────────

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
    "Which agent instruction files to compile (claude_code, codex, gemini).",
  ),
  description: z.string().optional().describe(
    "Preset metadata, shown when listing presets; ignored by `init --config`.",
  ),
  features: z.record(z.string(), z.boolean()).optional().describe(
    "[features] toggles — a feature name mapped to a boolean (default true).",
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
    if (path === "worktree") {
      return {
        path,
        message:
          `dead config ${keys} — the engine reads [worktree.resources.<name>] now; run \`discern upgrade\` to migrate it.`,
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
 * can refuse a typo (`project.frobnicate`, `features.bogus`) at WRITE time rather
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
