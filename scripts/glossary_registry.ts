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
import { annotateProse, slugify } from "./canon_editor/annotation.ts";

/** A place a retired phrase may still legally appear, and why. */
export interface RetiredException {
  /** Repo-relative path prefix (for example, "README.md"). */
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

/**
 * A term's plain-register rendering (ADR 0228, ADR 0235) — translated to a
 * plain phrase, or kept with the reason it is already plain. Beyond the
 * register guard, these renderings are the translation canon: site copy,
 * tooltips, and future plain surfaces read them instead of re-deciding how a
 * concept is said to a non-technical reader.
 */
export type GlossaryPlainRendering =
  | {
    /** The plain phrase the register uses in place of the term. */
    phrase: string;
    /**
     * How the register guard matches the term in plain prose. Omitted: the
     * entry's own match phrases (`matches ?? [term]`), word-bounded and
     * case-insensitive. A regex source narrows or widens that (an
     * inflection family, a plural-only ban for a term whose singular is
     * ordinary English). `false`: the term reads as ordinary English too
     * often to police mechanically — the translation still stands, and
     * review owns it.
     */
    match?: string | false;
  }
  | {
    /** Why the term stays untranslated: it is already plain English. */
    keep: string;
  };

/** One glossary entry: the canonical term and its display and matching data. */
export interface GlossaryEntry {
  /** The canonical name, exactly as the entry's heading renders it. */
  term: string;
  /**
   * The one-sentence hover-card copy. When absent, the definition's first
   * sentence is the summary so short definitions are not authored twice.
   */
  summary?: string;
  /**
   * Phrases whose prose mentions receive a hover card. Defaults to the term;
   * an empty list opts the entry out of automatic matching.
   */
  matches?: readonly string[];
  /**
   * The plain register's rendering of this term. Required, so a new term
   * cannot enter the product's vocabulary without its plain-language
   * rendering being decided in the same change — enrolment at the typecheck
   * stage (ADR 0235).
   */
  plain: GlossaryPlainRendering;
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

/** The authored summary, or the definition's first sentence by default. */
export function glossarySummary(
  entry: Pick<GlossaryEntry, "term" | "summary" | "definition">,
): string {
  if (entry.summary !== undefined) return entry.summary;
  const firstSentence = entry.definition.match(/^.*?[.!?](?=\s|$)/u)?.[0];
  if (firstSentence === undefined) {
    throw new Error(`glossary entry has no summary sentence: ${entry.term}`);
  }
  return firstSentence;
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
    plain: { phrase: "move finished work onto the main shared version" },
    // "accept" is also an HTTP header and an ordinary verb in the manual.
    matches: ["discern accept"],
    definition:
      "What `discern accept` does: land a worktree's reviewed branch on the [trunk](#trunk) as a clean fast-forward, then tear the worktree down — resources destroyed, directory removed, the merged branch deleted ([ADR 0110](../_adr/0110-the-landing-model.md)). Covered in [worktrees](../30-worktrees/).",
  },
  {
    term: "Advisory",
    plain: {
      phrase: "helpful advice that never blocks work",
      match: String.raw`\badvisor(?:y|ies)\b`,
    },
    definition:
      "A read-only finding surface: [coupling](../20-quality-gate/coupling.md), [patterns](../20-quality-gate/patterns.md), [impact](../70-reference/cli-reference.md#discern-impact), and [improvement](../20-quality-gate/improvement.md) point to work and never block. The [gate](#gate) and [standards](#standard) are the only enforcement surfaces.",
  },
  {
    term: "discern version",
    plain: { phrase: "the version of the Discern program itself" },
    definition:
      "The `discern` binary's semantic version, shown by `discern --version`. A newer binary arrives by re-running the installer; `discern upgrade` then brings the _project_ into line with the binary it runs from.",
    retired: [
      {
        phrase: "binary version",
        pattern: String.raw`\bbinary\s+versions?\b`,
      },
    ],
  },
  {
    term: "Gate job",
    plain: {
      phrase: "a named piece of work in the final check",
      match: String.raw`\bgate\s+jobs?\b`,
    },
    definition:
      `A labeled unit of work scheduled by the gate. A project declares its jobs under \`[jobs]\`: the ${
        countWord(Object.keys(KNOWN_JOBS).length)
      } known names ${
        codeList(Object.keys(KNOWN_JOBS), "and")
      } derive their [stage](#stage), while a custom name declares one. The run also schedules fired [scope](#scope) gates and [standard](#standard) measurements as labeled jobs. Covered in [the quality gate](../20-quality-gate/).`,
  },
  {
    term: "Coupling",
    plain: { phrase: "files that usually change together" },
    definition:
      "What `discern coupling` reports: files that historically change together, pointing out a sibling the current change may be missing. It is [advisory](#advisory) only and self-calibrates to the repo's own commit history ([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)). Covered in [coupling](../20-quality-gate/coupling.md).",
    retired: [
      {
        phrase: "co-change advisory",
        pattern: String.raw`\bco-change\s+advisor(?:y|ies)\b`,
      },
    ],
  },
  {
    term: "Shared file",
    plain: {
      keep:
        "'shared' says exactly what it means; the register keeps the phrase",
    },
    definition:
      "A tracked file discern shares with the project: `discern.toml` and the marked block in `.gitignore`. Your values and comments stay yours; `discern upgrade` restores missing fixed scaffold and managed banners from the current template ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)).",
    retired: [
      {
        phrase: "co-managed seed",
        pattern: String.raw`\bco-managed\s+seeds?\b`,
      },
    ],
  },
  {
    term: "Agent file",
    plain: {
      phrase: "a coding agent's instruction file",
      match: String.raw`\bagent\s+files?\b`,
    },
    definition:
      "`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`: per-agent instruction files generated by `discern refresh` from discern's built-in instructions plus your [instruction source](#instruction-source). Committed so a bare clone hands every agent the same page; `AGENTS.md` is the canonical copy the others import ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Covered in [agent instructions](../40-agent-instructions/).",
    retired: [
      {
        phrase: "compiled agent file",
        pattern: String.raw`\bcompiled\s+agent\s+files?\b`,
      },
    ],
  },
  {
    term: "Desk",
    plain: {
      keep:
        "an everyday word for the person-in-charge's one-screen view; kept as the product says it",
    },
    definition:
      "The human's interactive surface over the worktree [fleet](#fleet), opened from the main checkout with bare `discern` or `discern desk`. It starts new tasks, opens configured coding-agent CLIs from `PATH`, and offers each worktree's valid actions. Covered in [the desk](../30-worktrees/the-desk.md).",
  },
  {
    term: "discern",
    plain: {
      keep:
        "the product's name — a name, not jargon; the plain register capitalises it as Discern",
    },
    definition:
      "The tool itself: one self-contained binary that scaffolds the system into a repository (setup, upgrade, doctor) and runs it day to day (the gate, worktrees, the docs surfaces).",
    retired: [
      {
        // The pattern covers the inflection family a single phrase can't.
        phrase: "harness",
        pattern: String.raw`\bharness(?:es|ing)?\b`,
        // The category carriers: each keeps exactly one use, asserted (against
        // the DISCERN_CATEGORY constant) by the companion carrier test — a new
        // carrier must register here to pass the scan, and registering here
        // enrols it in that assertion.
        allowed: [
          {
            path: "src/shared/brand.ts",
            reason: "declares the category constant every carrier quotes",
          },
          {
            path: "README.md",
            reason:
              "keeps exactly one searchable category use, asserted separately",
          },
          {
            path: "site/pages/assets/og-card.svg",
            reason: "the social card's single category tag line",
          },
        ],
      },
    ],
  },
  {
    term: "Engine",
    plain: {
      phrase: "the working core of the program",
      match: String.raw`\bengines?\b`,
    },
    definition:
      "The stack-neutral logic behind the run-time verbs (`done`, `prepare`, `status`, `update`, `accept`, …), written in TypeScript and compiled into the binary. It ships no command from the project's stack; its verbs run the jobs, scopes, standards, and worktree settings a project declares, while its embedded [tidy](#tidy) formatter is limited to discern-owned surfaces. Contributors: see [engine internals](../50-engine-internals/).",
  },
  {
    term: "File ownership",
    plain: { keep: "ownership of files is everyday English" },
    definition:
      "The operational buckets that decide what `discern upgrade` may touch: [project-owned](#project-owned-file), [shared](#shared-file), and [generated](#generated-file). [Files & ownership](../70-reference/artifact-ownership.md) is the user-facing account; the [install surface](../80-development/install-surface.md) is the exhaustive inventory.",
    retired: [
      {
        phrase: "file dispositions",
        pattern: String.raw`\bfile\s+dispositions?\b`,
      },
    ],
  },
  {
    term: "Fleet",
    plain: {
      phrase: "all the work in progress, viewed together",
      match: String.raw`\bfleets?\b`,
    },
    definition:
      "The set of worktrees the [desk](#desk) surveys and `discern status` reports from the main checkout. Covered in [worktrees](../30-worktrees/).",
  },
  {
    term: "Gate",
    plain: { phrase: "the final quality check", match: String.raw`\bgates?\b` },
    definition:
      "The project's full quality check, run with `discern done`: its preconditions, the declared [jobs](#gate-job) by [stage](#stage), any [scope](#scope) gates that fired, and the [standards](#standard). Every job is labeled, so a failure names its exact command. Covered in [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Generated file",
    plain: {
      phrase: "a file made automatically from a source the project owns",
      match: String.raw`\bgenerated\s+files?\b`,
    },
    definition:
      "An [agent file](#agent-file) or materialized skill that discern produces and re-produces. It is safe to overwrite because you edit its reviewable sources instead. Drift between a generated file and its source fails the gate ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)).",
    retired: [
      {
        phrase: "the binary's files",
        pattern: String.raw`\bthe\s+binary(?:'s|’s)\s+files?\b`,
      },
    ],
  },
  {
    term: "Generated artifact",
    plain: {
      phrase:
        "a committed file a command rebuilds from the project's own sources",
      match: String.raw`\bgenerated\s+artifacts?\b`,
    },
    definition:
      "A committed file wholly derived from the rest of the tree, declared under `[generated.<name>]` in `discern.toml` beside the deterministic command that rewrites it. The [gate](#gate) reruns each group in the build stage and fails on drift, `discern update` resolves conflicts confined to declared paths by regenerating instead of refusing, and [coupling](#coupling) keeps declared paths out of its evidence ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)). The [agent files](#agent-file) and other [generated files](#generated-file) discern itself rebuilds form the built-in group, needing no declaration. Covered in [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Instruction source",
    plain: {
      phrase: "the project's own instruction text for coding agents",
      match: String.raw`\binstructions\s+sources?\b`,
    },
    definition:
      `Your own agent instructions, at the paths named by \`[instructions].sources\` (default \`${
        sourcePathDefault("instructions")
      }\`). Additive: discern's built-in instructions are always prepended, so your sources extend it rather than replace it. Covered in [agent instructions](../40-agent-instructions/).`,
    retired: [
      {
        phrase: "guidance",
        pattern: String.raw`\bguid(?:ance|elines?)\b`,
        allowed: [
          {
            path: "project/map/_internal/registry-atlas.md",
            reason:
              "the generated distribution-vocabulary inventory lists the retired config key",
          },
        ],
      },
    ],
  },
  {
    term: "Installer",
    plain: { keep: "an everyday computing word" },
    definition:
      "The verbs that install and maintain discern in a project: `setup`, `upgrade`, [doctor](../70-reference/cli-reference.md#discern-doctor), `config`, and `preset`. Some inspect and some write; all run and exit, and discern is never a runtime dependency of the project. Covered in [Getting started](../10-getting-started/).",
  },
  {
    term: "Landing authority",
    plain: {
      phrase: "recorded permission to add work to the main shared version",
      match: String.raw`\blanding\s+authorit(?:y|ies)\b`,
    },
    definition:
      "Verified evidence that an owner authorized one worktree to land: consent from the current conversation, a standing scope grant recorded on the [trunk](#trunk), or a one-worktree effort grant from the [desk](#desk). A green [proof](#proof) alone grants nothing. Covered in [worktrees](../30-worktrees/landing-authority.md).",
  },
  {
    term: "Logbook",
    plain: { phrase: "the activity record", match: String.raw`\blogbooks?\b` },
    definition:
      "The local record of discern's own use. With recording on and a readable `discern.toml`, it adds one metadata-only line for each CLI verb run and each Model Context Protocol (MCP) invocation resolved to that project. The repository's worktrees share the lines under `.git` ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). The logbook never leaves your machine, and a test in discern's own gate keeps its code free of any network path. `[project].logbook = false` stops all writes. Covered in [The logbook](../70-reference/the-logbook.md).",
  },
  {
    term: "Map",
    plain: { phrase: "the project guide", match: String.raw`\bmaps?\b` },
    definition:
      `The documentation tree discern maintains at \`[map].dir\` (default \`${
        sourcePathDefault("map")
      }\`): written by agents, kept current under the gate, and read by humans both as documentation and as an audit of what their agents understand. \`publish: false\` in a page's frontmatter withholds it from every published surface ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). Pointing \`[map].dir\` at existing docs is explicit consent to manage them ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).`,
  },
  {
    term: "Migration",
    plain: {
      phrase: "a numbered update step between settings versions",
      match: String.raw`\bmigrations?\b`,
    },
    definition:
      "One idempotent step that brings an install from [schema version](#schema-version) `N` to `N+1`. `discern upgrade` runs every pending step in order, validates the migrated config, then re-stamps the version ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). Covered in [Upgrade discern](../10-getting-started/upgrade-discern.md).",
  },
  {
    term: "Namespace",
    plain: {
      phrase: "a clearly separated naming area",
      match: String.raw`\bnamespaces?\b`,
    },
    definition:
      `The visible \`${NAMESPACE_DIR}\` directory: the default home for the [map](#map), your [instruction source](#instruction-source), authored [skills](#skill), [project scripts](#project-script), the project brief, and the \`TODO.md\` ledger. Nothing generated is ever written inside it, and every configurable source has a key that points it anywhere ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).`,
  },
  {
    term: "Patterns",
    plain: { phrase: "the recurring-behaviour report" },
    summary:
      "Findings `discern patterns` mines from the [logbook](#logbook) about behavior loops, gate fit, funnel flow, and standard trajectories.",
    // "patterns" also names ordinary testing and design patterns in the manual.
    matches: ["discern patterns"],
    definition:
      "What `discern patterns` reports: findings mined from the [logbook](#logbook) by a registry of named detectors (behavior loops, gate fit, funnel flow, and each [standard](#standard)'s trajectory), each stated in plain counts with a recommended next step ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). It is [advisory](#advisory) only, and below a detector's evidence threshold it reports insufficient evidence instead of guessing. Covered in [practice patterns](../20-quality-gate/patterns.md).",
  },
  {
    term: "Placement is consent",
    plain: {
      phrase: "putting a file somewhere is permission to write there",
    },
    definition:
      "The rule deciding what discern and its agents may write: a file at its namespace default carries an implicit write-license, a config key you pointed elsewhere is an explicit one, and any other path is untouchable — enforced by an architectural test ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). See [design principles](design-principles.md).",
  },
  {
    term: "Practice",
    plain: {
      keep:
        "an everyday word for a way of working; kept as the product says it",
    },
    // "practice" also reads as ordinary English ("best practices"); the
    // canonical sense is the definite form product surfaces use.
    matches: ["the practice"],
    definition:
      "The connected way of working discern installs and the project carries, enumerated as tenets in the practice canon ([ADR 0284](../_adr/0284-the-practice-canon-enumerates-the-tenets.md)). The engine holds the loop: one [worktree](#worktree) per effort, a deterministic [gate](#gate) verdict, [standards](#standard) that only tighten, [proof](#proof) bound to the exact change, [landing authority](#landing-authority) that stays human. The bundled [skills](#skill) teach the rest: whole delegated pieces, retained lessons, cured bug classes, one authority per fact. Its conduct holds too: every result names the next action, and every effect runs planned. The human owns the practice; agents operate it. Covered in [the practice](the-practice.md).",
  },
  {
    term: "Preset",
    plain: { phrase: "a reusable starter collection of settings" },
    // "preset" also names component and design-system presets in the manual.
    matches: ["discern preset"],
    definition:
      "A reusable overlay applied with `discern preset <name>`: scaffolded files plus config fills. Fills are fill-if-absent — a value the project already sets stands, and every key is disclosed as filled or kept ([ADR 0118](../_adr/0118-preset-fills-never-overwrite.md)).",
  },
  {
    term: "Project script",
    plain: {
      phrase: "the project's own runnable instruction",
      match: String.raw`\bproject\s+scripts?\b`,
    },
    definition:
      `A project's own language-agnostic executable under \`[scripts].dir\` (default \`${
        sourcePathDefault("scripts")
      }\`), run as \`discern scripts <name>\` with \`DISCERN_*\` exported. Scripts occupy their own namespace, so built-in verb names stay legal ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)).`,
    retired: [
      {
        // The singular invocation. Typed input folds to `scripts` silently
        // (an accepted grammatical variant, not a retired command), but every
        // surface discern WRITES — help, docs, examples — spells the plural;
        // this ban holds the written surfaces to it.
        phrase: "discern script",
        pattern: String.raw`\bdiscern\s+script\b`,
      },
    ],
  },
  {
    term: "Proof",
    matches: ["proof line"],
    plain: {
      phrase: "proof that the finished change passed the project's checks",
      match: false,
    },
    definition:
      "The review claim `discern done` emits after a clean, committed worktree passes the full [gate](#gate). It includes the proof line the agent ends its report with and a full page with check results, held [standards](#standard), and the diffstat for the branch's exact `HEAD`. The owner reads the page with `discern status --verbose`; `discern accept` can reuse it while the commit and worktree remain unchanged. Covered in [The proof](../20-quality-gate/the-proof.md).",
    retired: [
      {
        phrase: "receipt",
        pattern: String.raw`\breceipts?\b`,
      },
    ],
  },
  {
    term: "Proof note",
    plain: {
      phrase:
        "a saved copy of the proof, attached to the project's shared history",
    },
    definition:
      "The repository-resident JSON record of a landed [proof](#proof), attached to the immutable [trunk](#trunk) commit under `refs/notes/discern`. Its Dead Simple Signing Envelope (DSSE) boundary binds the full commit and preserves the payload bytes for future signatures. Current notes use discern's empty-array unsigned extension. Local recording is default-on, fetch transport is opt-in, and publication stays an explicit Git push. Covered in [Proof notes](../20-quality-gate/proof-notes.md).",
    retired: [
      {
        phrase: "receipt note",
        pattern: String.raw`\breceipt\s+notes?\b`,
      },
    ],
  },
  {
    term: "Schema version",
    plain: {
      phrase: "the settings-format version number",
      match: String.raw`\bschema\s+versions?\b`,
    },
    definition:
      "The integer in `[meta].schema_version` that anchors the [migration](#migration) chain. It bumps only when installed projects need a migration to stay correct, so most releases leave it untouched.",
  },
  {
    term: "Scope",
    plain: {
      phrase: "a named area of the project",
      match: String.raw`\bscopes?\b`,
    },
    definition:
      "A named region of the repository, declared as `[scopes.<name>]` with path globs and an optional `gate` command run only when that region changed. Classification fails open: a path matching no scope counts as a real code change ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)). `discern map --export <name>` also reads a scope as a reading list, concatenating the map pages it names in declared order ([ADR 0246](../_adr/0246-map-export-reads-scopes-as-reading-lists.md)). Covered in [the quality gate](../20-quality-gate/).",
    retired: [
      {
        // The seeded documentation scope's retired name (now [scopes.map]).
        phrase: "scopes.docs",
        pattern: String.raw`\[scopes\.docs\b|\bscopes\.docs\b`,
      },
    ],
  },
  {
    term: "Skill",
    plain: {
      phrase: "a reusable how-to guide",
      match: String.raw`\bskills?\b`,
    },
    definition:
      "A focused agent playbook shipped as a `SKILL.md`: discern's bundled built-ins (all prefixed `discern-`) plus any you author under `[skills].dir`, yours overriding a built-in of the same name. `discern refresh` materializes the set into each agent's skills directory; `discern skills list` shows it; `[skills].exclude` drops named ones. Covered in [Skills](../45-skills/).",
  },
  {
    term: "Stage",
    plain: {
      phrase: "a group in the final check's run order",
      match: String.raw`\bstages?\b`,
    },
    definition: `The scheduling bucket gate work runs in: ${
      codeList(STAGES, "or")
    }. Derived from a known [job](#gate-job)'s name; declared explicitly for a custom one.`,
  },
  {
    term: "Standard",
    plain: {
      phrase: "a quality rule",
      // The singular is ordinary English ("the standard example"), so only the
      // plural — the subsystem's name — is mechanically policed.
      match: String.raw`\bstandards\b`,
    },
    definition:
      'A quality number that can never get worse: a floor or ceiling declared under `[standards]` and held against the [trunk](#trunk) on every gate run ([ADR 0003](../_adr/0003-named-metric-standards.md), [ADR 0133](../_adr/0133-standards-join-the-gate.md)). Untouched `inputs` replay the recorded value, while `measure = "on-demand"` defers measurement to `discern standards`; the never-loosen limit check alone is unconditional. `discern standards --pin` captures a gain. Covered in [standards](../20-quality-gate/standards.md).',
  },
  {
    term: "Trunk",
    plain: {
      phrase: "the main shared version",
      match: String.raw`\btrunks?\b`,
    },
    definition:
      "The shared branch accepted work lands on: `[repository].trunk`, usually `main`. Worktrees bring it in with `discern update` and land back on it with `discern accept`.",
    retired: [
      { phrase: "integration branch" },
      {
        // The retired per-invocation override env var (now DISCERN_TRUNK).
        phrase: "DISCERN_MAIN_BRANCH",
        pattern: String.raw`\bDISCERN_MAIN_BRANCH\b`,
      },
      {
        // The retired setup error slug (now not_on_trunk).
        phrase: "not_on_integration_branch",
        pattern: String.raw`\bnot_on_integration_branch\b`,
      },
    ],
  },
  {
    term: "Tidy",
    plain: {
      keep:
        "discern's own plain-English verb name; the register uses tidy and tidying freely",
    },
    matches: ["discern tidy"],
    definition:
      "What `discern tidy` does: canonically format the configured [map](#map), deferred-work ledger, and [instruction sources](#instruction-source) as Markdown, plus the root `discern.toml` as TOML. Fresh installs invoke it through the [format job](#gate-job); removing that command is the opt-out. Covered in [Format discern-owned surfaces](../20-quality-gate/tidy.md).",
  },
  {
    term: "Tip",
    plain: {
      keep:
        "an everyday word for a short piece of practical advice; kept as the product says it",
    },
    // "tip" is also a branch tip and ordinary English across the manual.
    matches: ["desk tip"],
    definition:
      "One teaching line directly below the [desk](#desk) root status. Its `Tip` label is yellow and its text stays secondary. The desk chooses it once per session by deterministic rules and records the shown id in the [logbook](#logbook). A tip addresses the person at the desk; agent-facing advice stays in result envelopes. Covered in [desk tips](../30-worktrees/desk-tips.md).",
  },
  {
    term: "Update",
    plain: {
      keep:
        "an everyday word; the concept is explained in place and `discern update` stays quoted",
    },
    // "update" is also an ordinary editing instruction throughout the manual.
    matches: ["discern update"],
    definition:
      "What `discern update` does: merge the latest trunk into the current worktree's branch and refresh the generated files, in one step ([ADR 0055](../_adr/0055-update-verb.md)). It is the move the gate's merge check points a behind branch at, and the complement of [accept](#accept): update brings trunk into the branch; accept lands the branch on trunk.",
  },
  {
    term: "Worktree",
    plain: {
      phrase: "a separate working copy",
      match: String.raw`\bworktrees?\b`,
    },
    definition:
      "A separate checkout and branch for one effort, created by `discern start`, so agents never work in the main checkout. Review feedback and resumed sessions stay in that checkout. Each gets a deterministic dev-server port and any declared [resources](#worktree-resource). Covered in [worktrees](../30-worktrees/).",
  },
  {
    term: "Worktree resource",
    plain: {
      phrase: "a supporting service set up for one working copy",
      match: String.raw`\bworktree\s+resources?\b`,
    },
    definition:
      "An external thing a worktree needs in isolation (a database, an emulator, a container), declared as `[worktree.resources.<name>]` with a `create` and a `destroy` command. Created once per worktree, destroyed at teardown, and reclaimed by `discern worktree prune` if orphaned ([ADR 0025](../_adr/0025-worktree-resources.md)).",
  },
  {
    term: "Project-owned file",
    plain: {
      keep: "'project-owned' reads literally; the register uses it as-is",
    },
    definition:
      "A file discern may seed once, then leaves for the project to edit in place. `discern upgrade` does not overwrite it. It includes the [namespace](#namespace) content, the [map](#map), the ledger, and authored skills.",
  },
];

/**
 * Closed-set members deliberately NOT in the glossary, each with the reason.
 * Keys are namespaced `<set>:<member>` — `verb:docs`, `job:lint` — so
 * same-named members of different sets stay distinct.
 *
 * The enrolment guard (tests/glossary_enrolment_test.ts) holds every
 * known job, stage, and top-level verb to exactly one of: named by the
 * glossary, or recorded here. A new member fails the gate until someone
 * decides which — vocabulary at birth, not by accretion — and a record whose
 * member the glossary later names fails as stale.
 */
export const DELIBERATELY_ABSENT: Readonly<Record<string, string>> = {
  "verb:await":
    "blocks until a sibling branch is green, its work has landed, or the trunk has moved; a read-only coordination verb the CLI reference and the worktree docs document, not a term of art",
  "verb:doctor":
    "checks an installation without changing it; the Installer entry carries the subsystem and the CLI reference documents the verb",
  "verb:docs":
    "browses discern's bundled manual; a utility verb with no concept behind it — the CLI reference documents it",
  "verb:help":
    "prints CLI reference information; a utility verb with no concept behind it — the CLI reference documents it",
  "verb:identity":
    "reads a worktree's provisioned values from inside it; a verb the CLI reference and built-in instructions document, not a term of art",
  "verb:impact":
    "read-only advisory of what a change touches; no page uses it as a term of art",
  "verb:improvement":
    "read-only advisory of the ranked next action; no page uses it as a term of art",
  "verb:licenses":
    "prints first-party licenses and third-party notices; a utility verb with no concept behind it",
  "verb:mcp":
    "starts the MCP server; transport plumbing documented by the CLI and MCP references, not a product concept",
  "verb:queue":
    "wraps a shell command with the configured concurrent test-run cap; the quality-gate guide and CLI reference document it, not a separate term of art",
  "verb:test":
    "runs the configured test stage on its own; the Gate job and Stage entries carry the concepts, and the CLI reference documents the verb",
  "verb:triangle":
    "draws the project mark as terminal art; a deliberate surprise with no concept behind it, hidden from the CLI reference on purpose",
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
 * The word-bounded regex source a display phrase is matched with: spaces
 * match any whitespace, so hard-wrapped prose can't hide a multi-word phrase
 * behind a line break. One derivation, shared by the retired-synonym drift
 * guard and the plain-register jargon guard.
 */
export function phrasePatternSource(phrase: string): string {
  return String.raw`\b${
    phrase
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(String.raw`\s+`)
  }\b`;
}

/**
 * The matcher a retired synonym is policed with: its explicit `pattern`, or
 * the case-insensitive {@link phrasePatternSource} form of the phrase. One
 * derivation, shared by the drift guard and its positive controls.
 */
export function retiredPattern(synonym: RetiredSynonym): RegExp {
  return new RegExp(
    synonym.pattern ?? phrasePatternSource(synonym.phrase),
    "gi",
  );
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
  const sections = entries.map((e) => {
    const entry = slugify(e.term);
    const term = annotateProse(e.term, {
      registry: "glossary",
      entry,
      field: "term",
    });
    const definition = annotateProse(e.definition, {
      registry: "glossary",
      entry,
      field: "definition",
    });
    return `### ${term}\n\n${definition}`;
  });
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
    "These names are canonical — every page uses them identically, no synonyms ([ADR 0169](../_adr/0169-the-launch-glossary-canon.md)). For how they relate, read [concepts](concepts.md).",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}
