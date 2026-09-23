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
    "Tokens discern replaces with this worktree's values in these commands:",
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
    what:
      "The project's name, its coding agents, and a few project-wide settings.",
    why:
      "The name heads every compiled instruction file, and the slug names each worktree's site, database, and resources, so people and agents see one identity everywhere.",
    keys: {
      record_logbook: {
        detail: [
          "Keep recording on: history can't be recorded later, and while it's off",
          "this project goes without:",
          ...LOGBOOK_POWERED.map((member) => `  - ${member.phrase}`),
        ],
      },
      agents: {
        detail: [
          "Each gets an instruction file, skills, discern's MCP tools, and a",
          "session-start hook. Removing an agent leaves its files in place.",
        ],
      },
    },
  },
  repository: {
    what: "Git settings that every checkout of this repository shares.",
    why:
      "The trunk is the branch finished work lands on and the gate checks against. The branch prefix names each task's branch, and `ensure` commands keep every checkout ready to use after its files change.",
    keys: {
      proof_notes_mode: {
        detail: [
          "`local` changes nothing on your remotes; `fetch` adds a fetch-only rule",
          "for each remote. To publish notes, the owner runs:",
          `  \`git push <remote> ${PROOF_NOTES_REF}\`.`,
        ],
      },
      ensure: {
        detail: [
          "They run when discern sets up a worktree, at each session start, after",
          "`discern update`, and in the main checkout after each landing.",
        ],
      },
    },
  },
  map: {
    what: "Where the project map lives.",
    why:
      "The map is the documentation your agents keep about how the project works, and `discern map` browses it. Other settings can refer to its folder as `${map.dir}`, which ends in `/`, as in `${map.dir}**`.",
  },
  instructions: {
    what: "The instruction files discern compiles into each agent's file.",
    why:
      "You write your instructions once. `discern refresh` combines discern's built-in instructions with yours into one generated file per agent. Those files are committed, so every agent reads the same instructions, and the gate fails if one is edited by hand.",
  },
  skills: {
    what: "Where your own skills live, and which skills to leave out.",
    why:
      "A skill is a reusable playbook your agents follow for one kind of task. discern copies its built-in skills into each agent's skills folder and links yours there, so edits to yours apply at once. A skill of yours with the same name as a built-in one replaces it.",
    detail: [
      "  discern skills list          see which skills your agents get",
      "  discern skills eject <name>  copy a built-in here so you can edit it",
    ],
  },
  jobs: {
    what: "The commands the gate runs to check a change.",
    why:
      "A known name, such as `test`, has a fixed stage; a custom `[jobs.<name>]` table sets its own. `discern done` runs the fix stage, then build, then the check and test stages side by side. It reports what each command returned, so a pass means your project's own checks passed.",
    detail: [
      "Give a job one command, a list of commands run in order, or a table with",
      'its own settings, such as test = { run = "npm test", timeout = 1200 }.',
      "A long command can report its progress by printing lines such as",
      'DISCERN_PROGRESS {"units":{"kind":"files","completed":3,"total":8}}',
      "and discern shows the counts, and any failures reported, as it runs.",
      "Leave a known job out until the project has that command. During setup,",
      "your coding agent fills these in from what the repository already uses.",
    ],
    keys: {
      format: {
        detail: [
          "Keep `discern tidy` last: it formats the map, instructions, TODO list,",
          "and this file. Put your own formatter first, for example",
          'format = ["prettier --write .", "discern tidy"].',
        ],
      },
      build: { example: '"npm run build"' },
      lint: { example: '"eslint ."' },
      typecheck: { example: '"tsc --noEmit"' },
      test: { example: '"npm test"' },
      smoke: {
        example: '"your-app --version"',
        detail: [
          "With `[gate].fail_fast`, a quick failure stops the slower tests. It",
          "also runs in the main checkout after each landing.",
        ],
      },
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
    what: "Known jobs this project doesn't have.",
    why:
      "Setup counts how many of the known jobs that apply to this project are configured. List a job here when the project has no such step, so setup doesn't count it as missing. The gate still runs only what `[jobs]` lists.",
    detail: [
      "  discern config set-job build --not-applicable   mark a job as absent",
      "  discern config set-job build --applicable       count it again",
    ],
  },
  scopes: {
    what: "Named regions of the repository.",
    why:
      "A scope can run its own gate command when a change touches it, offer a preview, or mark its changes as neutral, meaning not code. Landing grants, checkpoints, and `discern impact` refer to scopes by name. A path that matches no scope counts as code.",
    seeds: [
      {
        comment:
          "Documentation your agents maintain. Neutral, and you can pre-approve it to land.",
        toml: `[scopes.map]
paths   = [{{scopes_neutral}}]
neutral = true`,
      },
      {
        comment:
          "Instructions, the project brief, and skills. Neutral; you review each change.",
        toml: `[scopes.instructions]
paths   = [{{scopes_instructions}}]
neutral = true`,
      },
    ],
    examples: [
      {
        lead: "A component with its own gate command and a read-only preview",
        toml: `[scopes.native]
paths   = ["native/**"]
gate    = "make -C native check"
preview = "make -C native preview"`,
      },
    ],
  },
  generated: {
    what: "Committed files that one command generates.",
    why:
      "`discern prepare` reruns each generator and leaves the new files for you to commit. `discern done` reruns them too, and fails when the committed files differ from what they produce. A generated file can't drift from its source, and nobody needs to edit it by hand.",
    examples: [
      {
        lead:
          "A generated reference: the same source always gives the same bytes",
        toml: `[generated.reference]
paths = ["reference/**"]
run   = "tool write-reference --source source/ --output reference/"`,
      },
    ],
  },
  acceptance: {
    what:
      "Standing grants: scopes whose changes can land without asking you each time.",
    why:
      "Without a grant, landing needs your approval in the conversation, or a grant you give one task from the desk. Widening a granted scope's paths widens its grant. The example grants documentation only, so you still review changes to agent instructions.",
    keys: {
      pre_authorized: {
        hint: '["map"]',
        detail: [
          "discern reads this list, and those scopes' paths, from the trunk, so a",
          "branch can't grant itself.",
        ],
      },
    },
  },
  worktree: {
    what: "How discern creates and prepares task worktrees.",
    why:
      "Each task runs in its own checkout, so agents working side by side don't collide. The Git steps are the same for every project; the resources and setup commands below make a new worktree ready for this one.",
    keys: {
      root: {
        detail: ["An absolute path is used as written."],
      },
      inherit_env: {
        hint: '["APP_KEY", "OPENAI_API_KEY"]',
        detail: [
          "A placeholder is the value in the first env file's `.example` copy.",
          "discern creates the first env file if it's missing, readable only by",
          "you (mode 0600), and leaves existing files' permissions alone.",
        ],
      },
      env_files: {
        detail: [
          "Only `inherit_env` creates a file. One comment line at the top of each",
          "file marks the values discern manages.",
        ],
      },
      export_port: {
        detail: [
          "When true, discern also avoids giving a new worktree a port another",
          "checkout uses, warns about a clash, and shows the port in",
          "`discern status`.",
        ],
      },
      track_ignored_drift: {
        detail: [
          "Turn it off when ignored files change too often for the list to help.",
        ],
      },
    },
  },
  "worktree.resources": {
    what: "Outside resources that each worktree gets its own copy of.",
    why:
      "Each worktree can have its own database, emulator, container, or queue, with a stable name. discern creates resources in the order listed and destroys them in reverse. It records how to destroy each one before creating it, so it can clean up a half-finished create, and `discern worktree prune` can clean up after a worktree deleted without discern.",
    detail: worktreeTokenDetail(),
    examples: [
      {
        lead: "A database for each worktree, so test runs never clash",
        toml: `[worktree.resources.db]
create  = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"`,
      },
      {
        lead:
          "A development site for each worktree, such as a container host, tunnel, or proxy entry",
        toml: `[worktree.resources.dev_server]
create  = "link-site @site@ @port@"
destroy = "unlink-site @site@"`,
      },
    ],
  },
  "worktree.setup": {
    what: "Commands that prepare a task worktree for work.",
    why:
      "`steps` run once, when discern creates the worktree; `ensure` commands run on every pass, so each must be safe to repeat. Neither gets `@token@` replacement. Put installs that every checkout needs, such as dependencies, in `[repository].ensure`, so the main checkout gets them after a landing too.",
    keys: {
      steps: {
        hint: '["seed-fixtures"]',
        detail: ["Steps you add later don't run in existing worktrees."],
      },
      ensure: {
        hint: '["ready-worktree-resource"]',
        detail: [
          "They run at creation, at each session start, after `discern update`,",
          "and when `discern worktree setup` runs again. Only a failure at",
          "creation stops anything.",
        ],
      },
    },
  },
  standards: {
    what:
      "Limits on measured numbers, such as test coverage or bundle size, that the gate holds.",
    why:
      "Every `discern done` needs a current measurement for each standard. A branch can tighten a limit but can't loosen, redefine, or delete a standard the trunk has. discern reuses a measurement only while its inputs, commands, toolchain, and environment match. Hold a raw count for a number that should stay fixed, a rate through `per` for one that grows with the project, and give a total that drifts a `margin`.",
    detail: [
      "The measuring command prints each reading as: DISCERN_METRIC <name> <number>",
      "Set run to measure with a command, or producer to reuse a job's output.",
      "An extract command reads that output, or the named artifact, on stdin.",
      "Lock in a gain with `discern standards --pin`: it tightens the limit to",
      "the measured value, keeping the margin as headroom, and commits it.",
    ],
    examples: [
      {
        lead: "Line coverage held at or above a floor that only rises",
        toml: `[standards.coverage]
direction = "up"
limit     = 80
run       = "your-coverage-tool"  # DISCERN_METRIC coverage <percent>`,
      },
      {
        lead:
          "A bundle-size budget: shipped bytes are a real budget, so a raw count fits",
        toml: `[standards.bundle]
metric    = "bundle_bytes"
direction = "down"
limit     = 500000
run       = "printf 'DISCERN_METRIC bundle_bytes %s\\\\n' \\"$(wc -c < dist/app.js)\\""`,
      },
      {
        lead:
          "Lint warnings per 1,000 lines: a rate, so adding clean code never breaks it",
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
    what:
      "Review questions your agent answers when a change matches a trigger.",
    why:
      "A trigger, such as a change to certain paths, decides when a question applies. Your agent answers it, and the answer goes into the Proof. A branch follows the checkpoint rules from the commit it started from, so editing these tables on a branch never changes that branch's own gate.",
    detail: [
      "Name a built-in checkpoint here to turn it on with its own trigger, mode,",
      "and question. A field you set under it replaces the built-in value.",
      "Delete or comment out an entry to turn it off.",
    ],
    examples: [
      {
        lead:
          "Paths the owner watches: `stop` holds `discern done` until the agent answers",
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
          "A new dependency is a cost the owner carries: point paths at the manifest",
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
        lead:
          "A change that removes far more test code than it adds lowers protection",
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
          "An interface changed: its docs change with it, or the agent judges them unaffected",
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
    what:
      "How discern runs jobs, in `discern done` and the other commands that run them.",
    why:
      "Stopping at the first failure and a time limit for each job keep checks quick. A cap on test runs at once keeps them fair to every worktree of this repository.",
    keys: {
      stream_output: {
        detail: ["A live terminal always shows a live view instead."],
      },
      fail_fast: {
        detail: [
          "A job that depends on a failed fix or build step still doesn't run,",
          "and `discern standards` ignores this setting.",
        ],
      },
      timeout: {
        detail: [
          "A job's list of commands shares one limit. discern stops a job that",
          "runs over, with every process it started, and fails its stage with a",
          "timeout message, so a command stuck in watch mode can't hang the gate.",
        ],
      },
      concurrent_test_runs: {
        detail: [
          "Test jobs, standard measurements, `discern test`, `discern standards`,",
          "and `discern queue -- <command>` each wait for a free slot.",
        ],
      },
    },
  },
  coupling: {
    what: "Files that usually change together, found from Git history.",
    why:
      "When a change leaves out a file that usually changes with the ones it touches, discern names it. The finding is advice only, it adjusts to the repository's own history, and there are no thresholds to set. `discern coupling` shows it on demand.",
  },
  scripts: {
    what: "Where your project's scripts live.",
    why:
      "`discern scripts <name>` runs the script with that name from the project root, with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK` set, and passes every argument through. A script can read other settings with `discern config get`.",
  },
  meta: {
    what: "A record of this project's setup and upgrades.",
    why:
      "discern writes these keys when it sets up or upgrades the project. They record the config format version and how setup went, so you never need to edit them.",
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
