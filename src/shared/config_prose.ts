/**
 * The config prose registry — the one source of the teaching prose that the
 * `discern.toml` template, the manual's config reference, and `discern config
 * explain` all render (ADR 0363).
 *
 * The Zod schema (`config_schema.ts`) owns every key's one-line description
 * and reads each section's `what` from here for its own description. This
 * registry owns what a runtime schema should not carry: why a section
 * matters, worked examples, seeded entries, and the few per-key hints the
 * scaffold shows beside a value. Every documented unit of the schema — a
 * fixed section, a named-table family, or a nested table — has exactly one
 * entry here. `configProseUnits()` (in `config_codegen.ts`) derives that set
 * from the schema and the registry guard holds the two equal, so a new
 * section cannot ship undocumented and a retired one cannot keep stale prose.
 *
 * Prose here is product copy: present tense, canonical terms, one idea per
 * sentence. It ships verbatim to every project, so it names no domain and no
 * repository-internal record. This module imports no schema, so the schema
 * may import it.
 */

import { LOGBOOK_POWERED } from "./logbook_powered.ts";
import { TEMPLATE_OMITTED_META_KEYS } from "./config_metadata.ts";
import {
  WORKTREE_TOKEN_DESCRIPTIONS,
  WORKTREE_TOKENS,
} from "../engine/worktree/tokens.ts";
import { PROOF_NOTES_REF } from "./git_conventions.ts";

/** Prose attached to one key of a documented unit. */
export interface ConfigKeyProse {
  /** An illustrative value rendered after the live value as `# e.g. …`. */
  readonly hint?: string;
  /** The value a commented-out key shows; required when the key has no
   * schema default, since the scaffold has nothing else to render. */
  readonly example?: string;
  /** Extra comment lines rendered beneath the key's description, in the
   * scaffold and the manual alike. */
  readonly detail?: readonly string[];
  /** Keep the key out of the scaffold. The manual still documents it. */
  readonly render?: "omit";
}

/** One worked example: a lead sentence and the TOML it introduces. */
export interface ConfigExample {
  /** One line of context above the example, without a trailing period. */
  readonly lead: string;
  /** The live TOML fragment. The scaffold renders it commented out; a test
   * validates it against the schema so an example can never be wrong. */
  readonly toml: string;
}

/** One entry seeded live into a fresh config's named-table family. The TOML
 * may carry scaffold tokens (`{{name}}`), so it is validated after
 * substitution. */
export interface ConfigSeed {
  /** The comment rendered above the seeded table. */
  readonly comment: string;
  /** The live TOML for the seeded table. */
  readonly toml: string;
}

/** The prose for one documented unit of the config. */
export interface ConfigUnitProse {
  /** What the unit governs: one sentence. */
  readonly what: string;
  /** Why it matters and what it advertises: one or two sentences. */
  readonly why: string;
  /** Verbatim comment lines rendered after the why paragraph — a table the
   * prose cannot carry inline. Indent continuation lines with two spaces. */
  readonly detail?: readonly string[];
  /** Live entries a fresh config seeds into a named-table family. */
  readonly seeds?: readonly ConfigSeed[];
  /** Worked examples. The scaffold renders the first; the manual and
   * `discern config explain` render every one. */
  readonly examples?: readonly ConfigExample[];
  /** Per-key prose, keyed by the bare key name. */
  readonly keys?: Readonly<Record<string, ConfigKeyProse>>;
}

/** The runtime-token table `[worktree.resources.<name>]` documents. */
function worktreeTokenDetail(): string[] {
  const width = Math.max(...WORKTREE_TOKENS.map((t) => t.length)) + 2;
  return [
    "Runtime tokens, expanded per worktree when a command runs:",
    ...WORKTREE_TOKENS.map((token) =>
      `  ${`@${token}@`.padEnd(width)}  ${WORKTREE_TOKEN_DESCRIPTIONS[token]}`
    ),
  ];
}

/**
 * The registry. Keys are documented-unit paths; the guard holds the key set
 * equal to the schema's unit set. Typed by its literal keys so the schema can
 * name a section's prose directly; {@link configUnitProse} is the
 * string-keyed lookup.
 */
export const CONFIG_PROSE = {
  project: {
    what: "The project's identity and the paths discern keeps for it.",
    why:
      "The name and slug appear in worktree, branch, and site names and in every compiled instruction file, so agents and humans see one identity everywhere.",
    keys: {
      logbook: {
        detail: [
          "Recording on is recommended. History cannot be recorded after the fact,",
          "and while recording is off this project goes without:",
          ...LOGBOOK_POWERED.map((member) => `  - ${member.phrase}`),
        ],
      },
    },
  },
  repository: {
    what: "Policy every checkout of this repository shares.",
    why:
      "The trunk is where accepted work lands and where the gate compares from. Branch naming and convergence commands keep the main checkout and every linked worktree usable after their tracked tree changes.",
    keys: {
      proof_notes: {
        detail: [
          "`local` adds no transport; `fetch` manages a fetch-only mapping per remote.",
          "Publish only when the owner chooses:",
          `  \`git push <remote> ${PROOF_NOTES_REF}\`.`,
        ],
      },
    },
  },
  map: {
    what: "Where the project map lives.",
    why:
      "The map is the documentation tree agents maintain and `discern map` browses. Its location also feeds the `${map.dir}` reference other sections use.",
  },
  instructions: {
    what: "The instruction sources discern compiles into each agent's file.",
    why:
      "You write instructions once. `discern refresh` compiles discern's built-in instructions plus your sources into one generated file per agent, committed so every agent reads the same page and no generated file is edited by hand.",
  },
  skills: {
    what: "Where your authored skills live, and which skills to leave out.",
    why:
      "A skill is a focused, reusable playbook. discern materializes its bundled skills plus yours into each agent's skills directory; a skill of yours with the same name as a built-in replaces it.",
    detail: [
      "  discern skills list          the effective set, and your overrides",
      "  discern skills eject <name>  copy a built-in here to customize it",
    ],
  },
  jobs: {
    what: "The commands the gate runs, in one namespace.",
    why:
      "A known name derives its stage; a custom `[jobs.<name>]` table declares one. `discern done` runs the fix stage, then build, then check and test in parallel, and reports what each command returned, so done means the project's own bar was met.",
    detail: [
      "A value is one command, a list run in order, or a table giving the job",
      'its own time budget: test = { run = "npm test", timeout = 1200 }.',
      "Leave a known job unwired until its command exists; `discern setup` has",
      "your coding agent fill these from repository evidence.",
    ],
    keys: {
      format: {
        detail: [
          "Keep `discern tidy` last: it formats the map, instructions, TODO, and",
          "this file. Put the project's own formatter before it, for example",
          'format = ["prettier --write .", "discern tidy"].',
        ],
      },
      build: { example: '"npm run build"' },
      lint: { example: '"eslint ."' },
      typecheck: { example: '"tsc --noEmit"' },
      test: { example: '"npm test"' },
      smoke: { example: '"your-app --version"' },
    },
    examples: [
      {
        lead: "A custom job: any name, an explicit stage, and its command",
        toml: `[jobs.licenses]
stage    = "check"
run      = "./scripts/check-licenses.sh"
provides = "license-audit"`,
      },
    ],
  },
  setup: {
    what: "Known jobs that do not apply to this project.",
    why:
      "Setup measures how many applicable known jobs are wired. A lifecycle the project does not have is declared here, so the measure counts what exists; the gate's schedule still comes from [jobs].",
    detail: [
      "  discern config set-job build --not-applicable   declare one",
      "  discern config set-job build --applicable       restore it",
    ],
  },
  scopes: {
    what: "Named regions of the repository.",
    why:
      "A change inside a scope can skip the gate, run its own gate, or offer a preview. A path that matches no scope counts as code and runs every stage.",
    seeds: [
      {
        comment:
          "Documentation the agents maintain. No Gate; landing may be pre-authorized.",
        toml: `[scopes.map]
paths   = [{{scopes_neutral}}]
neutral = true`,
      },
      {
        comment:
          "Instruction sources and skills. No Gate; landing stays owner-reviewed.",
        toml: `[scopes.instructions]
paths   = [{{scopes_instructions}}]
neutral = true`,
      },
    ],
    examples: [
      {
        lead:
          "A sub-component with its own self-contained gate and a read-only preview",
        toml: `[scopes.native]
paths   = ["native/**"]
gate    = "make -C native check"
preview = "make -C native preview"`,
      },
    ],
  },
  generated: {
    what: "Committed artifacts that one generator owns.",
    why:
      "`discern prepare` and `discern done` rerun each generator and fail when the committed bytes differ, so a generated file cannot drift from its source and nobody edits it by hand.",
    examples: [
      {
        lead:
          "A reference written from source; the same tree yields the same bytes",
        toml: `[generated.reference]
paths = ["reference/**"]
run   = "tool write-reference --source source/ --output reference/"`,
      },
    ],
  },
  acceptance: {
    what: "Standing grants for landing without a conversation.",
    why:
      "Landing needs the owner's acceptance in the conversation unless a scope is named here. Widening a named scope widens its grant; the example grants documentation alone and keeps agent instructions owner-reviewed.",
    keys: {
      pre_authorized: { hint: '["map"]' },
    },
  },
  worktree: {
    what: "The isolated-worktree workflow.",
    why:
      "Each effort runs in its own checkout, so parallel agents never collide. The git mechanics are generic; the resources and setup commands below are what make a fresh worktree ready for this project.",
    keys: {
      inherit_env: { hint: '["APP_KEY", "OPENAI_API_KEY"]' },
    },
  },
  "worktree.resources": {
    what: "External resources provisioned per worktree.",
    why:
      "Give each worktree a deterministic database, emulator, container, or queue handle. Resources are created top to bottom and destroyed bottom to top. discern records intent before create, cleans uncertain partial state before retry, and lets `discern worktree prune` reclaim a vanished worktree's recorded state.",
    detail: worktreeTokenDetail(),
    examples: [
      {
        lead: "A per-worktree database, so test runs never clash",
        toml: `[worktree.resources.db]
create  = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"`,
      },
      {
        lead:
          "A per-worktree dev-server site: a container vhost, a tunnel, a proxy entry",
        toml: `[worktree.resources.dev_server]
create  = "link-site @site@ @port@"
destroy = "unlink-site @site@"`,
      },
    ],
  },
  "worktree.setup": {
    what: "Commands that ready a linked worktree.",
    why:
      "`steps` run once at creation. `ensure` runs on every pass, including session start and `discern update`, so each command must be idempotent. Checkout-generic installs belong in [repository].ensure so acceptance converges the trunk too.",
    keys: {
      steps: { hint: '["seed-fixtures"]' },
      ensure: { hint: '["ready-worktree-resource"]' },
    },
  },
  standards: {
    what: "Quality numbers that can never get worse.",
    why:
      "Every `discern done` measures each standard beside the tests and refuses a limit looser than the trunk's, so a branch can neither regress a metric nor lower its bar. Hold a raw count for an invariant, a rate through `per` for a quality that scales, and give a total that grows with the product a `margin`.",
    detail: [
      "A run reports its number with one line: DISCERN_METRIC <name> <number>",
      "Lock in a gain with `discern standards --pin`; a hand-edited limit cannot",
      "tell a gain from a loosening.",
    ],
    examples: [
      {
        lead: "Line coverage at or above a rising floor",
        toml: `[standards.coverage]
direction = "up"
limit     = 80
run       = "your-coverage-tool"  # DISCERN_METRIC coverage <percent>`,
      },
      {
        lead:
          "A bundle-size budget: shipped bytes are a true budget, so a raw count is right",
        toml: `[standards.bundle]
metric    = "bundle_bytes"
direction = "down"
limit     = 500000
run       = "printf 'DISCERN_METRIC bundle_bytes %s\\\\n' \\"$(wc -c < dist/app.js)\\""`,
      },
      {
        lead:
          "Lint density: a rate, so clean code can be added without breaching it",
        toml: `[standards.lint_density]
metric    = "warnings"
direction = "down"
per       = { lines = "src/**" }   # discern counts the lines itself
scale     = 1000                   # warnings per 1,000 lines
limit     = 5
run       = "your-linter --count"  # DISCERN_METRIC warnings <count>`,
      },
    ],
  },
  checkpoints: {
    what: "Change-triggered review rules.",
    why:
      "A deterministic trigger decides when a change makes a question relevant; the agent answers the question and the answer travels with the Proof. The configuration at an effort's merge-base governs, so editing these tables on a branch never changes that branch's own gate.",
    detail: [
      "Naming a shipped checkpoint enables it with its built-in trigger, mode,",
      "and question; a field set beneath it overrides the built-in. Delete or",
      "comment out an entry to disable it.",
    ],
    examples: [
      {
        lead:
          "Regions the owner watches; `stop` holds `discern done` for a stated risk",
        toml: `[checkpoints.sensitive-paths]
paths = ["src/auth/**", "migrations/**"]
question = """
This change touches a region the owner marked sensitive. What could break
or leak if this is wrong, what protects against that, and what should a
reviewer look at first?
"""`,
      },
      {
        lead:
          "A new dependency is a liability the owner carries; point paths at the manifest",
        toml: `[checkpoints.new-dependency]
paths = ["package.json"]
mode  = "advise"
question = """
This change edits a dependency manifest. For each dependency added or
upgraded: is it worth the liability it adds, against writing the small part
you need? State what it buys.
"""`,
      },
      {
        lead: "A deleted or skipped test is a lowered guard",
        toml: `[checkpoints.shrinking-tests]
paths             = ["tests/**"]
deletion_dominant = true
mode              = "advise"
question = """
This change removes clearly more test than it adds. Is every removed or
skipped case re-covered elsewhere, or is the narrowed protection intended?
Say which in the commit body.
"""`,
      },
      {
        lead:
          "An interface changed; its contract docs moved too, or were judged unaffected",
        toml: `[checkpoints.interface-review]
paths          = ["src/api/**"]
unless_changed = ["docs/api/**"]
question = """
A changed interface is described in its docs before it lands: new entry
points state their failure modes; changed contracts note what callers must
revisit.
"""`,
      },
    ],
  },
  gate: {
    what: "How `discern done` runs its parallel stages.",
    why:
      "Fail-fast, a per-command time budget, and a cap on concurrent test runs keep the gate fast for one agent and fair across a fleet of worktrees sharing one machine.",
  },
  coupling: {
    what: "Co-change detection from git history.",
    why:
      "Files that habitually change together point at a sibling the current change may be missing. Coupling is read-only advice that calibrates itself to the repository, with no thresholds to tune; `discern coupling` reads it on demand.",
  },
  scripts: {
    what: "Where your executable project scripts live.",
    why:
      "`discern scripts <name>` resolves the name literally, runs it from the project root with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK`, and forwards every argument. Other config stays available through `discern config get`.",
  },
  meta: {
    what: "Installer bookkeeping.",
    why:
      "discern writes these keys while setting up or upgrading the project. They record schema and setup evidence; nothing here needs hand-editing.",
    keys: Object.fromEntries(
      TEMPLATE_OMITTED_META_KEYS.map((key) => [key, { render: "omit" }]),
    ),
  },
} satisfies Readonly<Record<string, ConfigUnitProse>>;

/** The prose for one documented unit, or undefined for an unknown path. */
export function configUnitProse(path: string): ConfigUnitProse | undefined {
  const table: Readonly<Record<string, ConfigUnitProse>> = CONFIG_PROSE;
  return Object.hasOwn(table, path) ? table[path] : undefined;
}
