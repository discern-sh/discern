/**
 * The glossary registry and the generated glossary page — the canonical term
 * list as DATA, rendered into the map's committed glossary the same way the
 * config reference and CLI reference render from their sources (the discipline
 * of `config_codegen.ts` / `cli_reference_codegen.ts`).
 *
 * Two consumers:
 *  - `scripts/codegen.ts` renders {@link renderGlossaryDoc} into the map's
 *    committed glossary page; a sync test asserts the committed file equals the
 *    generator output, so a term change that isn't regenerated fails the gate.
 *  - anything that needs the canonical vocabulary programmatically (search
 *    aliases, lookups, future term surfaces) reads {@link GLOSSARY} instead of
 *    parsing Markdown.
 *
 * Definitions whose prose states a fact another registry owns interpolate it
 * from that single source of truth — the known-job vocabulary from
 * `KNOWN_JOBS`, the stage names from `STAGES`, the authored-source
 * default paths from `SOURCE_PATHS` — so adding a member or moving a default
 * updates the glossary in the same change; the page cannot silently disagree
 * with the engine.
 *
 * This module lives under `scripts/`, not `src/`: its strings are map prose,
 * whose internal ADR citations the vocab guard rightly bans from the binary's
 * own source tree (ADR 0164).
 */

import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import {
  NAMESPACE_DIR,
  sourcePathDefault,
} from "../src/shared/paths_registry.ts";

/** A place a retired phrase may still legally appear, and why. */
export interface RetiredException {
  /** Repo-relative path prefix ("README.md", "mockups/landing/previous-homepage-"). */
  path: string;
  /** Why the phrase stays legal there — dated record, searchability, etc. */
  reason: string;
}

/**
 * A synonym the canon retired in favour of the entry's term. The
 * vocabulary-drift guard (tests/vocab_drift_test.ts) bans every retired phrase
 * from the live prose surfaces, and the renderer emits each as a search alias
 * so a search for a retired phrase lands on the canonical term.
 */
export interface RetiredSynonym {
  /** The retired wording, in display form ("integration branch"). */
  phrase: string;
  /**
   * Regex source overriding the matcher {@link retiredPattern} derives from
   * the phrase — for inflection families a single phrase can't express.
   */
  pattern?: string;
  /** Paths where the phrase remains legal, each with its reason. */
  allowed?: readonly RetiredException[];
}

/** One glossary entry: the canonical term and its definition. */
export interface GlossaryEntry {
  /** The canonical name, exactly as the entry's heading renders it. */
  term: string;
  /**
   * The definition: one Markdown paragraph, with links written relative to the
   * glossary's own directory (`00-orientation/`). Intra-page term links use
   * the term's heading anchor (`[trunk](#trunk)`); the map-integrity guard
   * validates every link and anchor against the shared renderer.
   */
  definition: string;
  /** Synonyms retired in favour of this term, policed by the drift guard. */
  retired?: readonly RetiredSynonym[];
}

/** Small counts spelled out, the way the prose voice writes them. */
function countWord(n: number): string {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  return words[n] ?? String(n);
}

/** `a`, `b`, and `c` — backticked names joined with an Oxford conjunction. */
function codeList(names: readonly string[], conjunction: string): string {
  const coded = names.map((n) => `\`${n}\``);
  if (coded.length <= 1) return coded.join("");
  if (coded.length === 2) return coded.join(` ${conjunction} `);
  return `${coded.slice(0, -1).join(", ")}, ${conjunction} ${coded.at(-1)}`;
}

/**
 * Every discern term, defined once. Order here is authoring order; the
 * renderer alphabetizes. Definitions are the canonical prose — the map page is
 * generated from this list, never edited by hand.
 */
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "Accept",
    definition:
      "What `discern accept` does: land a worktree's reviewed branch on the [trunk](#trunk) as a clean fast-forward, then tear the worktree down — resources destroyed, directory removed, the merged branch deleted ([ADR 0110](../_adr/0110-the-landing-model.md)). Covered in [worktrees](../30-worktrees/).",
  },
  {
    term: "The binary's files",
    definition:
      "Artifacts the binary re-publishes and may always overwrite, because you never edit them: the materialized skills (gitignored) and the [compiled agent files](#compiled-agent-file) (committed). The reviewable source is always yours; drift between a generated copy and its source fails the gate ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)).",
  },
  {
    term: "Binary version",
    definition:
      "The `discern` binary's semantic version, shown by `discern --version`. A newer binary arrives by re-running the installer; `discern upgrade` then brings the _project_ into line with the binary it runs from.",
  },
  {
    term: "Gate job",
    definition:
      `A labeled unit of work scheduled by the gate. A project declares its jobs under \`[jobs]\`: the ${
        countWord(Object.keys(KNOWN_JOBS).length)
      } known names ${
        codeList(Object.keys(KNOWN_JOBS), "and")
      } derive their [stage](#stage), while a custom name declares one. The run also schedules fired [scope](#scope) gates and [standard](#standard) measurements as labeled jobs. Covered in [the quality gate](../20-quality-gate/).`,
  },
  {
    term: "Co-change advisory",
    definition:
      "What `discern coupling` reports: files that historically change together, so a change is pointed at the sibling it may be missing. Advisory only — it never blocks, and it self-calibrates to the repo's own commit history ([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)). Covered in [coupling](../20-quality-gate/coupling.md).",
  },
  {
    term: "Co-managed seed",
    definition:
      "A tracked file discern shares with the project: `discern.toml` and the marked block in `.gitignore`. Your values and comments stay yours; `discern upgrade` restores missing fixed scaffold and managed banners from the current template ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)).",
  },
  {
    term: "Compiled agent file",
    definition:
      "`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`: per-agent instruction files generated by `discern refresh` from discern's built-in guidance plus your [guidance source](#guidance-source). Committed so a bare clone hands every agent the same page; `AGENTS.md` is the canonical copy the others import ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Covered in [agent guidance](../40-agent-guidance/).",
  },
  {
    term: "Desk",
    definition:
      "The human's interactive surface over the worktree fleet, opened from the main checkout with bare `discern` or `discern desk`. It starts new tasks, opens configured coding-agent CLIs from `PATH`, and offers each worktree's valid actions. Covered in [the desk](../30-worktrees/the-desk.md).",
  },
  {
    term: "discern",
    definition:
      "The tool itself: one self-contained binary that scaffolds the system into a repository (setup, upgrade, doctor) and runs it day to day (the gate, worktrees, the docs surfaces).",
    retired: [
      {
        // The pattern covers the inflection family a single phrase can't.
        phrase: "harness",
        pattern: String.raw`\bharness(?:es|ing)?\b`,
        allowed: [
          {
            path: "README.md",
            reason:
              "keeps exactly one searchable category use, asserted separately",
          },
          {
            path: "mockups/landing/previous-homepage-",
            reason:
              "archived shipped homepages are dated records and keep the vocabulary they went live with",
          },
        ],
      },
    ],
  },
  {
    term: "Engine",
    definition:
      "The stack-neutral logic behind the run-time verbs (`done`, `prepare`, `status`, `update`, `accept`, …), written in TypeScript and compiled into the binary. It ships no stack commands of its own; its verbs run the jobs, scopes, standards, and worktree settings a project declares. Contributors: see [engine internals](../50-engine-internals/).",
  },
  {
    term: "File dispositions",
    definition:
      "The ownership buckets that decide what `discern upgrade` may touch: [yours](#your-files--yours), [co-managed](#co-managed-seed), and [the binary's](#the-binarys-files). [Files & ownership](../70-reference/artifact-ownership.md) is the user-facing account; the [install surface](../80-development/install-surface.md) is the exhaustive inventory.",
  },
  {
    term: "Gate",
    definition:
      "The project's full quality check, run with `discern done`: its preconditions, the declared [jobs](#gate-job) by [stage](#stage), any [scope](#scope) gates that fired, and the [standards](#standard). Every job is labeled, so a failure names its exact command. Covered in [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Generated file",
    definition:
      "A file a `discern` command produces and re-produces: to change one, you edit its source and rebuild. The [compiled agent files](#compiled-agent-file) and the materialized skills are the set; the gate's currency check flags one that has drifted from its source ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).",
  },
  {
    term: "Guidance source",
    definition:
      `Your own agent instructions, at the paths named by \`[guidance].sources\` (default \`${
        sourcePathDefault("guidance")
      }\`). Additive: discern's built-in guidance is always prepended, so your sources extend it rather than replace it. Covered in [agent guidance](../40-agent-guidance/).`,
  },
  {
    term: "Installer",
    definition:
      "The scaffolding verbs of the binary: `setup`, `upgrade`, `doctor`, `config`, `preset`. Build-time work — they write or refresh a project's files and exit, and are never a runtime dependency of the project. Covered in [Getting started](../10-getting-started/).",
  },
  {
    term: "Logbook",
    definition:
      "The local record of discern's own use: one metadata-only line per verb run, appended under `.git` and shared by a repository's worktrees ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). It never leaves your machine, and a test in discern's own gate keeps its code free of any network path. `[project].logbook = false` stops all writes. Covered in [The logbook](../70-reference/the-logbook.md).",
  },
  {
    term: "Map",
    definition:
      `The documentation tree discern maintains at \`[map].dir\` (default \`${
        sourcePathDefault("map")
      }\`): written by agents, kept current under the gate, and read by humans both as documentation and as an audit of what their agents understand. \`publish: false\` in a page's frontmatter withholds it from every published surface ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). Pointing \`[map].dir\` at existing docs is explicit consent to manage them ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)).`,
  },
  {
    term: "Migration",
    definition:
      "One idempotent step that brings an install from [schema version](#schema-version) `N` to `N+1`. `discern upgrade` runs every pending step in order, validates the migrated config, then re-stamps the version ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). Covered in [Upgrade discern](../10-getting-started/upgrade-discern.md).",
  },
  {
    term: "Namespace",
    definition:
      `The visible \`${NAMESPACE_DIR}\` directory: the default home for your [guidance source](#guidance-source), authored [skills](#skill), [project scripts](#project-script), the project brief, and the \`TODO.md\` ledger. Nothing generated is ever written inside it, and every source has a config key that points it anywhere ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).`,
  },
  {
    term: "Patterns",
    definition:
      "What `discern patterns` reports: findings mined from the [logbook](#logbook) by a registry of named detectors (behaviour loops, gate fit, funnel flow, and each [standard](#standard)'s trajectory), each stated in plain counts with a recommended next step ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Advisory only: it never blocks, and below a detector's evidence threshold it reports insufficient evidence instead of guessing. Covered in [practice patterns](../20-quality-gate/patterns.md).",
  },
  {
    term: "Placement is consent",
    definition:
      "The rule deciding what discern and its agents may write: a file at its namespace default carries an implicit write-license, a config key you pointed elsewhere is an explicit one, and any other path is untouchable — enforced by an architectural test ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). See [design principles](design-principles.md).",
  },
  {
    term: "Preset",
    definition:
      "A reusable overlay applied with `discern preset <name>`: scaffolded files plus config fills. Fills are fill-if-absent — a value the project already sets stands, and every key is disclosed as filled or kept ([ADR 0118](../_adr/0118-preset-fills-never-overwrite.md)).",
  },
  {
    term: "Project script",
    definition:
      `A project's own language-agnostic executable under \`[scripts].dir\` (default \`${
        sourcePathDefault("scripts")
      }\`), run as \`discern script <name>\` with \`DISCERN_*\` exported. Scripts occupy their own namespace, so built-in verb names stay legal ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)).`,
  },
  {
    term: "Readiness",
    definition:
      "`discern doctor`'s judgment of whether the gate is meaningfully wired. The closed set of known [gate job](#gate-job) names makes an omitted known job knowably absent rather than unknown, so the report is exact ([ADR 0017](../_adr/0017-capabilities-model.md)).",
  },
  {
    term: "Receipt",
    definition:
      "The review summary `discern done` emits after a clean, committed worktree passes the full gate. It identifies the branch and exact `HEAD`, lists the commits, changed files, check results, and held [standards](#standard), and can be reused by `discern accept` while the commit and worktree remain unchanged. Covered in [The receipt](../20-quality-gate/the-receipt.md).",
  },
  {
    term: "Schema version",
    definition:
      "The integer in `[meta].schema_version` that anchors the [migration](#migration) chain. It bumps only when installed projects need a migration to stay correct, so most releases leave it untouched.",
  },
  {
    term: "Scope",
    definition:
      "A named region of the repository, declared as `[scopes.<name>]` with path globs and an optional `gate` command run only when that region changed. Classification fails open: a path matching no scope counts as a real code change ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)). Covered in [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Skill",
    definition:
      "A focused agent playbook shipped as a `SKILL.md`: discern's bundled built-ins (all prefixed `discern-`) plus any you author under `[skills].dir`, yours overriding a built-in of the same name. `discern refresh` materializes the set into each agent's skills directory; `discern skills list` shows it; `[skills].exclude` drops named ones. Covered in [Skills](../45-skills/).",
  },
  {
    term: "Stage",
    definition: `The scheduling bucket gate work runs in: ${
      codeList(STAGES, "or")
    }. Derived from a known [job](#gate-job)'s name; declared explicitly for a custom one.`,
  },
  {
    term: "Standard",
    definition:
      "A quality number that can never get worse: a floor or ceiling declared under `[standards]`, measured by a command you write and held against the [trunk](#trunk) on every `discern done` run ([ADR 0003](../_adr/0003-named-metric-standards.md), [ADR 0133](../_adr/0133-standards-join-the-gate.md)). `discern standards` is the on-demand pass; `--pin` captures a gain. Covered in [standards](../20-quality-gate/standards.md).",
  },
  {
    term: "Surface",
    definition:
      "A named interface or boundary where discern accepts input, presents output, or writes files. The modifier is part of the term (command-line surface, MCP surface, write surface); bare “surface” names no component.",
  },
  {
    term: "Test",
    definition:
      "A command that exercises the project's behavior and returns success or failure. `[jobs.test]` declares the project's main test command; `discern test` runs the configured test [stage](#stage) on its own, while `discern done` includes it in the full [gate](#gate). A failure returns its command and captured output in `diagnostics[]`. Covered in [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Trunk",
    definition:
      "The shared branch accepted work lands on: `[repository].trunk`, usually `main`. Worktrees bring it in with `discern update` and land back on it with `discern accept`.",
    retired: [{ phrase: "integration branch" }],
  },
  {
    term: "Update",
    definition:
      "What `discern update` does: merge the latest trunk into the current worktree's branch and refresh the generated files, in one step ([ADR 0055](../_adr/0055-update-verb.md)). It is the move the gate's merge check points a behind branch at, and the inverse of [accept](#accept).",
  },
  {
    term: "Worktree",
    definition:
      "A separate checkout and branch for one change, created by `discern start`, so agents never work in the main checkout. Each gets a deterministic dev-server port and any declared [resources](#worktree-resource). Covered in [worktrees](../30-worktrees/).",
  },
  {
    term: "Worktree resource",
    definition:
      "An external thing a worktree needs in isolation (a database, an emulator, a container), declared as `[worktree.resources.<name>]` with a `create` and a `destroy` command. Created once per worktree, destroyed at teardown, and reclaimed by `discern worktree prune` if orphaned ([ADR 0025](../_adr/0025-worktree-resources.md)).",
  },
  {
    term: "Worktree settings",
    definition:
      "The checkout-local configuration the engine calls but does not implement: `[worktree.resources.*]` plus the `inherit_env`, `port`, and `setup` keys. Identity-dependent, they never run in the main checkout; checkout-generic convergence belongs in `[repository].ensure`. A fresh install declares none ([ADR 0011](../_adr/0011-adopt-worktree-workflow.md)).",
  },
  {
    term: "Your files / Yours",
    definition:
      "Files written once and then the project's: committed, edited in place, and left alone by `upgrade`. The [namespace](#namespace) content, the [map](#map), the ledger, and the provider settings merged into files you already had at setup.",
  },
];

/**
 * Closed-set members deliberately NOT in the glossary, each with the reason.
 * Keys are namespaced `<set>:<member>` — `verb:help`, `job:lint` — so
 * same-named members of different sets stay distinct.
 *
 * The enrolment guard (tests/glossary_enrolment_test.ts) holds every
 * known job, stage, and top-level verb to exactly one of: named by the
 * glossary, or recorded here. A new member fails the gate until someone
 * decides which — vocabulary at birth, not by accretion — and a record whose
 * member the glossary later names fails as stale.
 */
export const DELIBERATELY_ABSENT: Readonly<Record<string, string>> = {
  "verb:help":
    "prints the manual; a utility verb with no concept behind it — the CLI reference documents it",
  "verb:identity":
    "reads a worktree's provisioned values from inside it; a verb the CLI reference and built-in guidance document, not a term of art",
  "verb:impact":
    "read-only advisory of what a change touches; no page uses it as a term of art",
  "verb:improvement":
    "read-only advisory of the ranked next action; no page uses it as a term of art",
  "verb:licenses":
    "prints the third-party notices; a utility verb with no concept behind it",
  "verb:mcp":
    "starts the MCP server; the Surface entry names the MCP surface, and the verb is its plumbing",
  "verb:uninstall":
    "removes what setup laid down; the Installer entry carries the concept, the CLI reference the verb",
};

/** Every retired synonym, paired with the canonical term that replaced it. */
export function retiredSynonyms(): Array<
  { term: string; synonym: RetiredSynonym }
> {
  return GLOSSARY.flatMap((entry) =>
    (entry.retired ?? []).map((synonym) => ({ term: entry.term, synonym }))
  );
}

/**
 * The matcher a retired synonym is policed with: its explicit `pattern`, or a
 * word-bounded, case-insensitive form of the phrase whose spaces match any
 * whitespace — so hard-wrapped prose can't hide a multi-word phrase behind a
 * line break. One derivation, shared by the drift guard and its positive
 * controls.
 */
export function retiredPattern(synonym: RetiredSynonym): RegExp {
  const source = synonym.pattern ?? String.raw`\b${
    synonym.phrase
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(String.raw`\s+`)
  }\b`;
  return new RegExp(source, "gi");
}

/** The banner stamped atop the generated glossary page. */
const DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the term registry (scripts/glossary_registry.ts) — do NOT edit by hand. Change an entry there and regenerate. -->";

/** The sort key an entry alphabetizes under: lowercased, leading "The " dropped. */
function sortKey(term: string): string {
  return term.toLowerCase().replace(/^the /, "");
}

/** The registry alphabetized, the order the page renders in. */
export function sortedGlossary(): GlossaryEntry[] {
  return [...GLOSSARY].sort((a, b) =>
    sortKey(a.term) < sortKey(b.term) ? -1 : 1
  );
}

/**
 * Render the map's glossary page from the term registry: every entry under its
 * own heading, alphabetized, with each term also emitted as a search alias so
 * `discern map <term>` reaches the page without a hand-maintained synonym list
 * (the same move the CLI reference makes with command paths).
 */
export function renderGlossaryDoc(): string {
  const entries = sortedGlossary();
  // Retired synonyms are aliases too: a search for a retired phrase should
  // land on the canonical term.
  const aliases = [
    "terms",
    "definitions",
    "vocabulary",
    "dictionary",
    ...entries.map((e) => e.term.toLowerCase()),
    ...entries.flatMap((e) =>
      (e.retired ?? []).map((r) => r.phrase.toLowerCase())
    ),
  ];
  const sections = entries.map((e) => `### ${e.term}\n\n${e.definition}`);
  return [
    "---",
    "title: Glossary",
    "description: Every discern term, defined once — the canonical names the rest of the manual uses identically everywhere.",
    "order: 60",
    "aliases:",
    ...aliases.map((alias) => `  - ${alias}`),
    "---",
    "",
    DOCS_BANNER,
    "",
    "# Glossary",
    "",
    "_Every discern term, defined once and alphabetized. Each entry links the section that covers the mechanism in depth._",
    "",
    "These names are canonical — every page uses them identically, no synonyms. For how they relate, read [concepts](concepts.md).",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
