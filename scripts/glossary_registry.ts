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
 * from the live prose surfaces. Retired wording is internal guard data, not a
 * search alias: public compatibility names belong on an explicit migration
 * surface if a future release needs them.
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

/** How the term is cased when it names the product concept in running prose. */
export type RunningProseCase = "lowercase" | "proof-family";

/** One glossary entry: the canonical term and its display and matching data. */
export interface GlossaryEntry {
  /** The canonical name, exactly as the entry's heading renders it. */
  term: string;
  /** Required casing choice for prose outside headings and sentence starts. */
  runningCase: RunningProseCase;
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

/** One registry-derived casing rule shared by Vale and source-string tests. */
export interface RunningProseCaseRule {
  readonly term: string;
  readonly expected: string;
  readonly pattern: string;
}

/** Escape a display term for a regular-expression source. */
function regexLiteral(value: string): string {
  return value.split(/\s+/).map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join(String.raw`\s+`);
}

/**
 * Derive enforceable running-prose casing from every glossary entry. Headings
 * and true sentence starts retain title/sentence case. Any immediately
 * preceding word identifies a term inside running prose; restricting that word
 * to lowercase mistakes title-cased sentence openers such as "The Gate" for a
 * sentence-initial use of the term itself.
 */
export function runningProseCaseRules(
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): RunningProseCaseRule[] {
  const context = String.raw`(?:\b|_)[A-Za-z][\w-]*\s+`;
  const rules: RunningProseCaseRule[] = [];
  for (const entry of glossary) {
    if (entry.runningCase === "proof-family") {
      if (entry.term === "Proof") {
        rules.push({
          term: entry.term,
          expected: "Proof line or Proof note",
          // Bare proof also has an ordinary English meaning. Only these
          // unambiguous product forms support an automatic casing verdict.
          pattern: String.raw`\bproof\s+(?:line|note)(?:s|['’]s)?\b`,
        });
      }
      continue;
    }
    const lower = entry.term.charAt(0).toLowerCase() + entry.term.slice(1);
    const titled = entry.term.charAt(0).toUpperCase() + entry.term.slice(1);
    if (lower.startsWith("discern")) continue;
    if (lower === titled) continue;
    const plural = /[A-Za-z]$/.test(titled) && !titled.endsWith("s")
      ? "s?"
      : "";
    rules.push({
      term: entry.term,
      expected: lower,
      pattern: `${context}${regexLiteral(titled)}${plural}\\b`,
    });
  }
  return rules;
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
    runningCase: "lowercase",
    plain: { phrase: "move finished work onto the main shared version" },
    // "accept" is also an HTTP header and an ordinary verb in the manual.
    matches: ["discern accept"],
    definition:
      "Land validated, authorized work on the [trunk](#trunk), the project's shared branch. From an effort's worktree, `discern accept` records the effort's [submission](#submission), the exact proven commit, and lands it when conversation consent or a recorded grant authorizes it: it fast-forwards the trunk, records the Proof note, converges the main checkout, and removes the worktree, its resources, and its branch when the branch holds nothing beyond the landed submission. When the trunk moved after the Proof, the landing composes and checks the combined code in an [integration worktree](#integration-worktree) and lands that exact proven commit; a second accept waits its turn and resumes on its own. Without authority it refuses, and the submission waits for the owner. See [worktrees](../30-worktrees/) and [landing authority](../30-worktrees/landing-authority.md).",
    retired: [
      {
        phrase: "queue reconciliation",
        // The queue engine's noun for recording an outside integration into
        // its ledger, and its `--reconcile` flag. A retry completes or rolls
        // back the recorded transaction; gitignore, config, skills, and
        // Proof-note-fetch reconciliation stay legal because the pattern needs
        // the queue, landing, or acceptance subject.
        pattern: String
          .raw`\b(?:queue|landing|acceptance)\s+reconciliations?\b|\breconcil(?:e[sd]?|ing)\s+(?:an?\s+|the\s+)?(?:queue|landing|acceptance)s?\b|--reconcile\b`,
      },
    ],
  },
  {
    term: "Integration worktree",
    runningCase: "lowercase",
    plain: {
      phrase: "a throwaway copy where finished work is combined and re-checked",
    },
    definition:
      "A disposable [worktree](#worktree) a landing creates for itself when the [trunk](#trunk) moved after a [submission](#submission)'s Proof. discern creates it from the exact submitted commit through the same setup a task worktree gets, brings the trunk in, proves the combined committed tree with the full gate, lands that exact proven commit, and removes the copy, its resources, and its `integration/` branch. It is discern-owned — never an effort an agent may adopt — with its ownership and exact input recorded, not inferred from its name. A conflict or red combined check removes the copy and returns to the author with nothing landed; a copy whose owning process died is reclaimed by `discern worktree prune`, which never touches a live one. See [worktrees](../30-worktrees/).",
  },
  {
    term: "Advisory",
    runningCase: "lowercase",
    plain: {
      phrase: "helpful advice that never blocks work",
      match: String.raw`\badvisor(?:y|ies)\b`,
    },
    definition:
      "A finding that suggests attention without blocking work. [Coupling](../20-quality-gate/coupling.md), [patterns](../20-quality-gate/patterns.md), [impact](https://discern.sh/docs/reference/cli-reference#discern-impact), and [improvement](../20-quality-gate/improvement.md) provide advice. The finding can prompt investigation; it is not itself a failed [gate](#gate) check.",
  },
  {
    term: "discern version",
    runningCase: "lowercase",
    plain: { phrase: "the version of the Discern program itself" },
    definition:
      "The version of discern you are running, shown by `discern --version`. Use `discern releases` to see what's new and check for updates. The installer updates the program; `discern upgrade` updates the project's setup to match.",
    retired: [
      {
        phrase: "binary version",
        pattern: String.raw`\bbinary\s+versions?\b`,
      },
    ],
  },
  {
    term: "Gate job",
    runningCase: "lowercase",
    plain: {
      phrase: "a named piece of work in the final check",
      match: String.raw`\bgate\s+jobs?\b`,
    },
    definition:
      `A named check or operation scheduled by the [gate](#gate). A project declares its jobs under \`[jobs]\`: the ${
        countWord(Object.keys(KNOWN_JOBS).length)
      } known names ${
        codeList(Object.keys(KNOWN_JOBS), "and")
      } derive their [stage](#stage), while a custom name declares one. The run also schedules fired [scope](#scope) gates and [standard](#standard) measurements as labeled jobs. Covered in [the quality gate](../20-quality-gate/).`,
  },
  {
    term: "Checkpoint",
    runningCase: "lowercase",
    plain: {
      phrase: "a judgment stop",
      match: String.raw`\bcheckpoints?\b`,
    },
    definition:
      "A review question presented when a relevant kind of change occurs. A rule under `[checkpoints]` pairs a mechanical trigger with a question for the agent. In `stop` mode, the [gate](#gate) waits for a [declared met](#declared-met) or [declared unmet](#declared-unmet) conclusion; `advise` mode does not block it. An unmet conclusion needs an owner-authorized [variance](#variance) before landing. Committed policy preceding the change governs the question, including the recorded predecessor during candidate completion. `discern checkpoints` reports the applicable policy and question states. See [checkpoints](../20-quality-gate/checkpoints.md).",
  },
  {
    term: "Question",
    runningCase: "lowercase",
    plain: {
      // The term is ordinary English; the register guard cannot police it
      // mechanically without banning the word everywhere. Review owns it.
      phrase: "the question the agent judges",
      match: false,
    },
    matches: ["question", "questions"],
    retired: [
      {
        // The launch-era working name for the judgment prose. Singular only:
        // plural "criteria" stays ordinary English (acceptance criteria,
        // removal criteria) on unrelated surfaces.
        phrase: "criterion",
      },
    ],
    definition:
      "Something the agent is asked to judge about the project or a change. [Checkpoints](#checkpoint) present questions when changes match their triggers; the [improvement review](../20-quality-gate/improvement.md) asks them about existing work. A question can have a stable id and a `teach` note explaining why it matters. A checkpoint answer is [declared met](#declared-met) or [declared unmet](#declared-unmet), kept separate from machine-verified results. See [checkpoints](../20-quality-gate/checkpoints.md).",
  },
  {
    term: "Open question",
    runningCase: "lowercase",
    plain: { phrase: "a record that a judgment stop fired" },
    definition:
      "The record created when a stop checkpoint asks for judgment on an effort. It keeps the question and its current answer or unanswered state. `discern done` creates the record when a `stop` [checkpoint](#checkpoint) fires. The record lives in the worktree's Git administrative area, survives session restarts, and tracks any later [declaration](#declaration) or reopening. `discern checkpoints` reports its current state without changing it. See [checkpoint state and declarations](../70-reference/checkpoint-state.md).",
  },
  {
    term: "Declaration",
    runningCase: "lowercase",
    plain: {
      phrase: "the agent's recorded answer",
      match: false,
    },
    definition:
      'The agent\'s recorded answer to a checkpoint [question](#question). The agent uses `discern done --met <id>` for a satisfied question, or `--unmet <id> --why "…"` for an unmet question with a reason. The answer applies to the resolved question and matched content; a relevant change reopens it. [Proof](#proof) labels the answer [declared met](#declared-met) or [declared unmet](#declared-unmet). The gate verifies that a required answer exists, not that the judgment is correct.',
  },
  {
    term: "Declared met",
    runningCase: "lowercase",
    plain: { phrase: "the agent's recorded yes" },
    definition:
      "The agent has judged that the checkpoint question is satisfied for this change. This [declaration](#declaration) applies to the question and content the agent examined. A relevant change reopens it. The conclusion is recorded judgment, not independent machine verification.",
  },
  {
    term: "Declared unmet",
    runningCase: "lowercase",
    plain: { phrase: "the agent's recorded no, with the reason" },
    definition:
      "The agent has judged that a checkpoint question is not satisfied and has recorded why. The [gate](#gate) can still run. [Proof](#proof) carries the reason for the owner to review, while landing waits for an authorized [variance](#variance). The rationale is kept out of the [logbook](#logbook).",
  },
  {
    term: "Variance",
    runningCase: "lowercase",
    plain: {
      phrase: "the owner's recorded OK to land it anyway",
      match: String.raw`\bvariances?\b`,
    },
    definition:
      "The owner's permission to land a change despite a stated unmet checkpoint. It covers the exact current [declaration](#declaration) and landed commit, without changing the policy for future work. The agent records the owner's explicit current-conversation approval with `discern accept --confirmed --variance <id>`. Standing and effort grants do not cover variances. See [checkpoints](../20-quality-gate/checkpoints.md).",
  },
  {
    term: "Stop / advise",
    runningCase: "lowercase",
    matches: [
      "stop checkpoint",
      "advise checkpoint",
      "stop mode",
      "advise mode",
    ],
    plain: {
      phrase: "a stopping rule or a notice-only one",
      match: false,
    },
    definition:
      "How a [checkpoint](#checkpoint) presents its question. `stop` waits for a recorded conclusion before the [gate](#gate) runs; `advise` presents the question without blocking. Stop is the default mode. Heuristic built-in triggers use advise. A [declared unmet](#declared-unmet) answer allows checks to run, but still needs the owner's [variance](#variance) before landing.",
  },
  {
    term: "Coupling",
    runningCase: "lowercase",
    plain: { phrase: "files that usually change together" },
    definition:
      "Files that have often changed together in the project's history. `discern coupling` uses that history to suggest related files the current change may have missed. The finding is [advisory](#advisory): past co-change is a reason to investigate, not proof that another file must change. See [coupling](../20-quality-gate/coupling.md).",
    retired: [
      {
        phrase: "co-change advisory",
        pattern: String.raw`\bco-change\s+advisor(?:y|ies)\b`,
      },
    ],
  },
  {
    term: "Shared file",
    runningCase: "lowercase",
    plain: {
      keep:
        "'shared' says exactly what it means; the register keeps the phrase",
    },
    definition:
      "A file with parts maintained by discern and parts maintained by the project. The ownership registry classifies as shared any registered path where discern manages a delimited region or fixed scaffold while preserving project content around it. The [registered project paths](https://discern.sh/docs/reference/files-and-ownership#registered-project-paths) table contains the complete inventory.",
    retired: [
      {
        phrase: "co-managed seed",
        pattern: String.raw`\bco-managed\s+seeds?\b`,
      },
    ],
  },
  {
    term: "Agent file",
    runningCase: "lowercase",
    plain: {
      phrase: "a coding agent's instruction file",
      match: String.raw`\bagent\s+files?\b`,
    },
    definition:
      "An instruction file a coding agent reads when it works on the project. `discern refresh` generates `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` from the built-in instructions and your [instruction source](#instruction-source). These files are committed so a clone carries the instructions; `AGENTS.md` is the canonical copy the others import. Edit the authored source, then refresh the generated files. See [agent instructions](../40-agent-instructions/).",
    retired: [
      {
        phrase: "compiled agent file",
        pattern: String.raw`\bcompiled\s+agent\s+files?\b`,
      },
    ],
  },
  {
    term: "Desk",
    runningCase: "lowercase",
    plain: {
      keep:
        "an everyday word for the person-in-charge's one-screen view; kept as the product says it",
    },
    definition:
      "An interactive view of the project's tasks and the actions available for them. Open it from the main checkout with bare `discern` or `discern desk`. It surveys the [fleet](#fleet), starts tasks, opens configured coding-agent CLIs found on `PATH`, and offers valid actions for the selected worktree. See [the desk](../30-worktrees/the-desk.md).",
  },
  {
    term: "discern",
    runningCase: "lowercase",
    plain: {
      keep:
        "the product's name — a name, not jargon; the plain register capitalises it as Discern",
    },
    definition:
      "A tool that installs and runs an agent development practice in a project. One self-contained program handles setup and maintenance, isolated task [worktrees](#worktree), configured [gate](#gate) checks, project knowledge, and the completion and landing workflow.",
    retired: [
      {
        // The pattern covers the inflection family a single phrase can't.
        phrase: "harness",
        pattern: String.raw`\bharness(?:es|ing)?\b`,
        allowed: [{
          path: "project/map/_internal/registry-atlas.md",
          reason:
            "the generated public-route inventory preserves historical ADR URL slugs",
        }],
      },
    ],
  },
  {
    term: "Engine",
    runningCase: "lowercase",
    plain: {
      phrase: "the working core of the program",
      match: String.raw`\bengines?\b`,
    },
    definition:
      "The part of discern that runs its workflow commands. Commands such as `done`, `prepare`, `status`, `update`, and `accept` use this TypeScript implementation, compiled into the program. It runs the jobs, scopes, standards, and worktree settings the project declares without prescribing a language or framework. The embedded [tidy](#tidy) formatter operates on discern-owned surfaces. See [engine internals](../50-engine-internals/).",
    retired: [
      {
        // The retired state-read error slug (now read_failed: operations
        // that fail take the _failed suffix).
        phrase: "read_error",
      },
    ],
  },
  {
    term: "File ownership",
    runningCase: "lowercase",
    plain: { keep: "ownership of files is everyday English" },
    definition:
      "The rules for which parts of a file discern may maintain. The categories are [project-owned](#project-owned-file), [shared](#shared-file), and [generated](#generated-file), and they determine what `discern upgrade` may change. See [files and ownership](../70-reference/artifact-ownership.md); the [install surface](../80-development/install-surface.md) lists the complete inventory.",
    retired: [
      {
        phrase: "file dispositions",
        pattern: String.raw`\bfile\s+dispositions?\b`,
      },
    ],
  },
  {
    term: "Effort",
    runningCase: "lowercase",
    plain: { keep: "an everyday English word for one piece of work" },
    definition:
      "One task carried through implementation and review: the work a [worktree](#worktree), its branch, and its [submission](#submission) all belong to. Results name an effort by its branch. An effort keeps one worktree across feedback and resumed sessions; the landing queue lists efforts by their submissions, and `discern accept` lands the selected effort's submitted commit on the [trunk](#trunk).",
    retired: [{
      phrase: "queue prefix",
      // The queue-walk noun: results once counted "prefixes landed" and told
      // owners "the next prefix needs authority". Owner-facing sentences say
      // "effort"; the record vocabulary stays in the schema. The pattern bans
      // the sentence shapes of that sense while leaving branch, path, and
      // command prefixes alone.
      pattern: String
        .raw`\b(?:queue|next|eligible|landed|pending|earlier|authori[sz]ed|approved|unrelated|remaining|requested|another)\s+prefix(?:es)?\b|\bprefix(?:es)?\s+(?:landed|lands|landing|advance[sd]?|(?:can|cannot)\s+advance|has\s+its|have\s+their|needs\s+its)\b|\b\d+\s+prefix(?:es)?\b|\bper-prefix\b`,
    }, {
      phrase: "queue admission",
      // The queue engine's lifecycle nouns: work admitted to, withdrawn
      // from, reserved in, or retired from a durable queue, and its
      // provisional positions. The derived view has no such transitions;
      // the test-slot queue keeps its own admission sense, so every arm
      // needs the queue-engine subject.
      pattern: String
        .raw`\bqueue\s+(?:admission|withdrawal|retirement)s?\b|\b(?:queue|capacity|completion)\s+reservations?\b|\bprovisional\s+positions?\b`,
    }],
  },
  {
    term: "Fleet",
    runningCase: "lowercase",
    plain: {
      phrase: "all the work in progress, viewed together",
      match: String.raw`\bfleets?\b`,
    },
    definition:
      "The project's collection of task [worktrees](#worktree). The [desk](#desk) and `discern status` show it from the main checkout; `discern status --all` includes it from a task worktree. A listed worktree still belongs to its effort even when it is idle or clean. See [worktrees](../30-worktrees/).",
  },
  {
    term: "Gate",
    runningCase: "lowercase",
    plain: { phrase: "the final quality check", match: String.raw`\bgates?\b` },
    definition:
      "The configured checks a change must satisfy for ordinary completion. `discern done` runs this workflow: preconditions, declared [jobs](#gate-job), applicable [scope](#scope) gates, required [standards](#standard), and required checkpoint declarations. Failures identify the check and the next action. Passing establishes the stated checks for the validated change, not permission to land it. See [the quality gate](../20-quality-gate/).",
    retired: [
      {
        phrase: "done --confirmed",
      },
      {
        // The retired write-preflight error slug and failed stage (now
        // write_denied: it names the refusal, not the capability probed).
        phrase: "write_access",
      },
    ],
  },
  {
    term: "Generated file",
    runningCase: "lowercase",
    plain: {
      phrase: "a file made automatically from a source the project owns",
      match: String.raw`\bgenerated\s+files?\b`,
    },
    definition:
      "An agent instruction file or materialized skill that discern builds from an authored source. Edit the source and regenerate; direct edits to the generated copy can be replaced. The [gate](#gate) checks these outputs against their sources. See [agent files](#agent-file) and [skills](#skill).",
    retired: [
      {
        phrase: "the binary's files",
        pattern: String.raw`\bthe\s+binary(?:'s|’s)\s+files?\b`,
      },
    ],
  },
  {
    term: "Generated artifact",
    runningCase: "lowercase",
    plain: {
      phrase:
        "a committed file a command rebuilds from the project's own sources",
      match: String.raw`\bgenerated\s+artifacts?\b`,
    },
    definition:
      "A committed file that a declared command rebuilds from the project's sources. Declare its paths and deterministic generator under `[generated.<name>]` in `discern.toml`. The [gate](#gate) checks for drift. `discern update` resolves conflicts confined to declared generated paths by regenerating, and [coupling](#coupling) excludes those paths from its evidence. discern's own [generated files](#generated-file) form a built-in group and need no separate declaration. See [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Instruction source",
    runningCase: "lowercase",
    plain: {
      phrase: "the project's own instruction text for coding agents",
      match: String.raw`\binstructions\s+sources?\b`,
    },
    definition:
      `The project's authored instructions for coding agents. Their paths are named by \`[instructions].sources\` (default \`${
        sourcePathDefault("instructions")
      }\`). discern prepends its built-in instructions when compiling the agent files; your project instructions follow them. Covered in [agent instructions](../40-agent-instructions/).`,
  },
  {
    term: "Installer",
    runningCase: "lowercase",
    plain: { keep: "an everyday computing word" },
    definition:
      "The commands that set up and maintain discern in a project. They include `setup`, `upgrade`, [doctor](https://discern.sh/docs/reference/cli-reference#discern-doctor), and `config`. Some inspect and some change files; each runs and exits. The application does not need discern to run. See [getting started](../10-getting-started/).",
    retired: [
      {
        // The retired root-discovery error slug (now no_project).
        phrase: "not_initialized",
      },
      {
        // The retired pre-setup gating slug (now setup_unfinished, matching
        // the status field of the same name).
        phrase: "not_set_up",
      },
      {
        // The retired out-of-range setup-step error slug (now unknown_step).
        phrase: "no_such_step",
      },
      {
        // The retired config-edit error slug (now edit_failed: operations
        // that fail take the _failed suffix).
        phrase: "edit_error",
      },
    ],
  },
  {
    term: "Landing authority",
    runningCase: "lowercase",
    plain: {
      phrase: "recorded permission to add work to the main shared version",
      match: String.raw`\blanding\s+authorit(?:y|ies)\b`,
    },
    definition:
      "Permission for a particular change to join the [trunk](#trunk). It can come from the current conversation, a standing scope grant on the trunk, or an effort grant recorded from the [desk](#desk), which covers the effort's branch so any later green `done` on it is covered once its agent submits it. Acceptance checks the permission against the changed paths of the submitted commit. A passing [Proof](#proof) is evidence, not permission. See [landing authority](../30-worktrees/landing-authority.md).",
  },
  {
    term: "Logbook",
    runningCase: "lowercase",
    plain: { phrase: "the activity record", match: String.raw`\blogbooks?\b` },
    definition:
      "The local record of the project's use of discern. With recording enabled and a readable `discern.toml`, each CLI verb run and project-resolved Model Context Protocol (MCP) invocation adds metadata such as timing and outcome. It does not record code or command output. Worktrees share the record under `.git`; discern has no network path that sends it elsewhere. `[project].record_logbook = false` stops recording. See [the logbook](../70-reference/the-logbook.md).",
  },
  {
    term: "Map",
    runningCase: "lowercase",
    plain: { phrase: "the project guide", match: String.raw`\bmaps?\b` },
    definition:
      `The project's account of how its software works and why. Agents maintain this documentation at \`[map].dir\` (default \`${
        sourcePathDefault("map")
      }\`). You can read it to understand the project and correct what agents have recorded. The gate checks configured documentation requirements; authors remain responsible for its meaning. \`publish: false\` in a page's frontmatter withholds it from every published surface ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). Pointing \`[map].dir\` at existing docs is explicit consent to manage them ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).`,
    retired: [
      {
        // The retired unresolved-target error slug (now unknown_target,
        // joining the unknown_* family: docs, patterns, progress, await).
        phrase: "not_found",
      },
    ],
  },
  {
    term: "Migration",
    runningCase: "lowercase",
    plain: {
      phrase: "a numbered update step between settings versions",
      match: String.raw`\bmigrations?\b`,
    },
    definition:
      "A numbered step that updates a project's discern configuration format. `discern upgrade` runs the pending steps in order from one [schema version](#schema-version) to the next. Each step can be repeated without duplicating its intended effect. The command validates the updated configuration before recording the new version. See [Upgrade discern](../10-getting-started/upgrade-discern.md).",
  },
  {
    term: "Namespace",
    runningCase: "lowercase",
    plain: {
      phrase: "a clearly separated naming area",
      match: String.raw`\bnamespaces?\b`,
    },
    definition:
      `The default directory for the project's authored discern content. The visible \`${NAMESPACE_DIR}\` directory holds the [map](#map), your [instruction source](#instruction-source), authored [skills](#skill), [project scripts](#project-script), the project brief, and the \`TODO.md\` ledger. Its contents are authored sources; configuration can place them elsewhere ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).`,
  },
  {
    term: "Patterns",
    runningCase: "lowercase",
    plain: { phrase: "the recurring-behaviour report" },
    // "patterns" also names ordinary testing and design patterns in the manual.
    matches: ["discern patterns"],
    definition:
      "Findings about recurring behavior in the project's recorded use of discern. `discern patterns` reads the [logbook](#logbook) for such patterns as repeated gate failures, avoidable workflow steps, and changes in [standard](#standard) measurements. Each finding states its supporting counts and a next step. It is [advisory](#advisory); when evidence is insufficient, it says so. See [practice patterns](../20-quality-gate/patterns.md).",
  },
  {
    term: "Improvement review",
    runningCase: "lowercase",
    plain: { phrase: "the project-wide quality review" },
    matches: ["improvement review", "improvement audit"],
    definition:
      "A review of the project as it exists now, using questions the agent judges. `discern improvement` serves these [questions](#question) alongside rules for where project knowledge belongs. It can uncover existing weaknesses that a new-change [checkpoint](#checkpoint) would not reach. The findings are [advisory](#advisory). See [improvement](../20-quality-gate/improvement.md).",
    retired: [
      {
        // The launch-era name for the review's object ("estate review",
        // "the knowledge estate"). Live surfaces now say the improvement
        // review / audit and the knowledge surfaces instead.
        phrase: "estate",
        pattern: String.raw`\bestates?\b`,
      },
    ],
  },
  {
    term: "Placement is consent",
    runningCase: "lowercase",
    plain: {
      phrase: "putting a file somewhere is permission to write there",
    },
    definition:
      "Choosing a managed source location authorizes discern to maintain that content. The default source locations carry that permission; pointing a configuration key at another location gives it explicitly. This governs discern's managed content, not every command an agent or project job may run. See [design principles](design-principles.md) and [files and ownership](../70-reference/artifact-ownership.md).",
  },
  {
    term: "Practice",
    runningCase: "lowercase",
    plain: {
      keep:
        "an everyday word for a way of working; kept as the product says it",
    },
    // "practice" also reads as ordinary English ("best practices"); the
    // canonical sense is the definite form product surfaces use.
    matches: ["the practice"],
    definition:
      "The connected way of working discern installs and the project carries between sessions. Tasks use separate [worktrees](#worktree), configured [gate](#gate) checks, held [standards](#standard), exact completion [Proof](#proof), and owner-controlled [landing authority](#landing-authority). Bundled [skills](#skill) guide delegation, lasting project knowledge, and improvements that address a problem's cause. You direct the work and make the consequential decisions; your agents operate the workflow. See [the practice](the-practice.md).",
  },
  {
    term: "Project script",
    runningCase: "lowercase",
    plain: {
      phrase: "the project's own runnable instruction",
      match: String.raw`\bproject\s+scripts?\b`,
    },
    definition:
      `A runnable procedure the project supplies for its agents and maintainers. It lives under \`[scripts].dir\` (default \`${
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
    term: "Progress handle",
    runningCase: "lowercase",
    plain: {
      keep:
        "the short code that reads a long command back after a lost connection",
    },
    definition:
      "The short `R1-XXXX-XXXX-XX` code recorded for a long operation and announced to MCP callers. `discern progress <handle>`, or the `discern_progress` tool, reads that operation back after a lost call: its phase, the counts and failures known so far, and the retained result. Human command output omits the startup announcement; `discern progress` without a handle finds the latest operation. It only reads; the `C1` continuation that `discern await` returns is what resumes a wait. See [progress and reconnect](../70-reference/progress-and-reconnect.md).",
  },
  {
    term: "Proof",
    runningCase: "proof-family",
    matches: ["proof line"],
    plain: {
      phrase: "the finished change passed the project's checks",
      match: false,
    },
    definition:
      "discern's completion evidence for the exact committed change it validated. `discern done` records machine results, held [standards](#standard), and declared checkpoint judgments for the committed tip of the invoking worktree. The Proof line summarizes that evidence; `discern status --verbose` retrieves the full page. Evidence whose inputs are unchanged can be reused, but a later commit needs current validation. Proof does not grant [landing authority](#landing-authority). See [the Proof](../20-quality-gate/the-proof.md).",
  },
  {
    term: "Proof note",
    runningCase: "proof-family",
    plain: {
      phrase:
        "a saved copy of the Proof, attached to the project's shared history",
      match: String.raw`\bproof\s+notes?\b`,
    },
    definition:
      "A durable copy of landed [Proof](#proof), attached to the commit in Git. The JSON record lives under `refs/notes/discern`. Its Dead Simple Signing Envelope (DSSE) binds the full commit and preserves the payload bytes for future signatures; current notes use an unsigned extension with an empty signatures array. Recording is local by default, fetching is opt-in, and publishing requires an explicit Git push. See [Proof notes](../20-quality-gate/proof-notes.md).",
  },
  {
    term: "Schema version",
    runningCase: "lowercase",
    plain: {
      phrase: "the settings-format version number",
      match: String.raw`\bschema\s+versions?\b`,
    },
    definition:
      "The version number of the project's discern configuration format. `[meta].schema_version` identifies the current step in the [migration](#migration) sequence. It changes when an installation needs a format migration; a new discern release does not necessarily change it.",
  },
  {
    term: "Scope",
    runningCase: "lowercase",
    plain: {
      phrase: "a named area of the project",
      match: String.raw`\bscopes?\b`,
    },
    definition:
      "A named set of project paths used to select work or policy. A `[scopes.<name>]` entry declares path patterns and can provide a `gate` command for changes in that area. Unclassified paths still count as code changes, so missing classification does not skip them. `discern map --export <name>` can also use a scope as an ordered reading list. See [the quality gate](../20-quality-gate/).",
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
    runningCase: "lowercase",
    plain: {
      phrase: "a reusable how-to guide",
      match: String.raw`\bskills?\b`,
    },
    definition:
      "A reusable playbook that tells an agent how to handle a particular kind of task. Skills use `SKILL.md` files. discern ships bundled skills prefixed `discern-`; you can add your own under `[skills].dir` or override a bundled skill with the same name. `discern refresh` makes the selected set available to configured agents, `discern skills list` shows it, and `[skills].exclude` omits named skills. See [skills](../45-skills/).",
  },
  {
    term: "Stage",
    runningCase: "lowercase",
    plain: {
      phrase: "a group in the final check's run order",
      match: String.raw`\bstages?\b`,
    },
    definition:
      `A group in the order the [gate](#gate) runs work. The stages are ${
        codeList(STAGES, "or")
      }. A known [job](#gate-job)'s name determines its stage; a custom job declares one explicitly.`,
  },
  {
    term: "Standard",
    runningCase: "lowercase",
    plain: {
      phrase: "a quality rule",
      // The singular is ordinary English ("the standard example"), so only the
      // plural — the subsystem's name — is mechanically policed.
      match: String.raw`\bstandards\b`,
    },
    definition:
      "A held limit for a repeatable project measurement. A `[standards]` entry sets a floor that may rise or a ceiling that may fall. The gate checks the limit and protected measurement definition against the preceding committed policy; an ordinary branch cannot weaken or delete them. Completion requires every standard, using applicable evidence or a new measurement. `discern standards --pin` captures a gain; `discern prepare` requests no measurements. A weaker limit needs the separate owner-approved proposal process. See [standards](../20-quality-gate/standards.md).",
  },
  {
    term: "Trunk",
    runningCase: "lowercase",
    plain: {
      phrase: "the main shared version",
      match: String.raw`\btrunks?\b`,
    },
    definition:
      "The shared branch that accepted work joins, usually `main`. `[repository].trunk` selects it. Tasks bring its changes into their own worktrees with `discern update`; `discern accept` fast-forwards it to a submitted, proven, authorized commit.",
    retired: [
      { phrase: "integration branch" },
      {
        // The retired per-invocation override env var (now DISCERN_TRUNK).
        phrase: "DISCERN_MAIN_BRANCH",
      },
      {
        // The retired setup error slug (now not_on_trunk).
        phrase: "not_on_integration_branch",
      },
      {
        // The retired missing-trunk error slug (now no_trunk).
        phrase: "no_target",
      },
    ],
  },
  {
    term: "Submission",
    runningCase: "lowercase",
    plain: {
      phrase: "the agent's request to land one exact finished version",
    },
    definition:
      "An effort's recorded request to land one exact commit. `discern accept queue` records it without starting a landing; `discern accept` records it and starts landing. Both select the effort from its worktree or with `--target`, naming its branch, the committed revision, and the [Proof](#proof) that covers it, and store the submission beside the effort grant under the worktree's Git administration so no branch can forge it. A later explicit submission from the same effort replaces it; a later commit or Proof alone does not. A landing consumes it, and dropping the worktree removes it. The landing queue lists submissions with honored [Proof](#proof) that have not landed, pre-authorized ones first; a green run its agent never submitted is absent and lands only by the owner's explicit act. See [landing authority](../30-worktrees/landing-authority.md).",
    retired: [{
      phrase: "early validation",
      // Checking an effort before its predecessor lands. Nothing validates
      // ahead of the queue any more: a submission is proven at its own tip.
      pattern: String.raw`\bearly\s+validation\b`,
    }, {
      phrase: "lookahead",
      // The retired [completion] knob that enabled early validation.
    }],
  },
  {
    term: "Tidy",
    runningCase: "lowercase",
    plain: {
      keep:
        "discern's own plain-English verb name; the register uses tidy and tidying freely",
    },
    matches: ["discern tidy"],
    definition:
      "discern's formatter for its configured Markdown and TOML surfaces. `discern tidy` formats the [map](#map), deferred-work ledger, and [instruction sources](#instruction-source) as Markdown, and `discern.toml` as TOML. Fresh installations run it through the format [job](#gate-job); removing that command opts out. See [format discern-owned surfaces](../20-quality-gate/tidy.md).",
  },
  {
    term: "Tip",
    runningCase: "lowercase",
    plain: {
      keep:
        "an everyday word for a short piece of practical advice; kept as the product says it",
    },
    // "tip" is also a branch tip and ordinary English across the manual.
    matches: ["desk tip"],
    definition:
      "A short practical suggestion shown below the [desk](#desk) status. The desk chooses a tip once per session and records its id in the [logbook](#logbook). The yellow `Tip` label distinguishes it from task status; its advice does not change what the selected task may do. Advice delivered to agents remains in command results. See [desk tips](../30-worktrees/desk-tips.md).",
  },
  {
    term: "Update",
    runningCase: "lowercase",
    plain: {
      keep:
        "an everyday word; the concept is explained in place and `discern update` stays quoted",
    },
    // "update" is also an ordinary editing instruction throughout the manual.
    matches: ["discern update"],
    definition:
      "Bring newer work into the current task's [worktree](#worktree). `discern update` merges the latest [trunk](#trunk) into the task branch and refreshes generated files. With `--from <ref>`, it can bring in another explicit source, including unlanded work. The result names overlapping files for the agent to re-read, because a successful merge does not prove the combined behavior is right. See [worktrees](../30-worktrees/).",
  },
  {
    term: "Worktree",
    runningCase: "lowercase",
    plain: {
      phrase: "a separate working copy",
      match: String.raw`\bworktrees?\b`,
    },
    definition:
      "A separate working copy and branch for one effort. `discern start` creates it so task edits stay apart from the main checkout and other efforts. Review and resumed sessions continue the same effort; a worktree changes only through the operation run in it, and no operation installs another revision into it. A landing removes the worktree, its resources, and its branch when the branch holds nothing beyond the landed [submission](#submission). Each worktree has a derived port and declared [resources](#worktree-resource); `discern enter` opens a child shell in a selected checkout. See [worktrees](../30-worktrees/).",
    retired: [
      {
        phrase: "borrowed checkout",
        // The borrowed-validation substrate: installing another revision into
        // an authoring checkout. Ordinary-English borrowing away from a
        // checkout stays legal because the pattern needs both words close.
        pattern: String
          .raw`\bborrow(?:s|ed|ing)?\b[^.\n]{0,40}\b(?:checkout|worktree)s?\b|\b(?:checkout|worktree)s?\b[^.\n]{0,40}\bborrow(?:s|ed|ing)?\b`,
      },
      {
        phrase: "released checkout",
        // Handing a checkout to an executor. Releasing software or a lock
        // stays legal; the pattern needs the checkout object.
        pattern: String
          .raw`\breleas(?:e[sd]?|ing)\s+(?:an?\s+|the\s+|its\s+|this\s+|that\s+|your\s+|each\s+|every\s+)?(?:checkout|worktree)s?\b|\b(?:checkout|worktree)\s+releases?\b|--release-checkout\b|\brelease_checkout\b`,
      },
      {
        phrase: "retained checkout",
        // Keeping authoring control under the retired flags, and the
        // checkout-retirement noun. Retaining a lock ("checkout exclusion")
        // and worktree-local caches stay legal via the lookahead exclusion.
        pattern: String
          .raw`--retain-checkout\b|\bretain_checkout\b|\bretain(?:s|ed|ing)?\s+(?:an?\s+|the\s+|its\s+)?(?:checkout|worktree)s?\b(?![-\s]+(?:exclusion|local))|\b(?:checkout|worktree)\s+retirements?\b`,
      },
      {
        phrase: "execution environment",
        // The declared environment a candidate was validated in.
        pattern: String.raw`\bexecution\s+environments?\b`,
      },
      {
        phrase: "candidate installation",
        // Installing a composed candidate into a checkout for validation.
        pattern: String
          .raw`\bcandidate\s+installations?\b|\binstall(?:s|ed|ing)?\s+a\s+candidate\b`,
      },
      {
        // The retired worktree-identity error slug (now identity_failed:
        // operations that fail take the _failed suffix).
        phrase: "identity_error",
      },
    ],
  },
  {
    term: "Worktree resource",
    runningCase: "lowercase",
    plain: {
      phrase: "a supporting service set up for one working copy",
      match: String.raw`\bworktree\s+resources?\b`,
    },
    definition:
      "A supporting service or other resource prepared separately for one worktree. Examples include a test database, emulator, or container. `[worktree.resources.<name>]` declares its `create` and `destroy` commands. Worktree setup ensures the declared resource exists, and lifecycle cleanup removes it when appropriate. `discern worktree prune` can reclaim positively identified orphaned resources. See [worktree resources](../30-worktrees/the-resources.md).",
  },
  {
    term: "Project-owned file",
    runningCase: "lowercase",
    plain: {
      keep: "'project-owned' reads literally; the register uses it as-is",
    },
    definition:
      "A file whose ongoing contents belong to the project. discern may create an initial copy, but `discern upgrade` does not overwrite it. Examples include authored [map](#map) pages, instructions, the deferred-work ledger, and skills in the [namespace](#namespace).",
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
  "verb:licenses":
    "prints first-party licenses and third-party notices; a utility verb with no concept behind it",
  "verb:mcp":
    "starts the MCP server; transport plumbing documented by the CLI and MCP references, not a product concept",
  "verb:queue":
    "wraps a shell command with the configured concurrent test-run cap; the quality-gate guide and CLI reference document it, not a separate term of art",
  "verb:test":
    "runs the configured test stage on its own; the Gate job and Stage entries carry the concepts, and the CLI reference documents the verb",
  "verb:triangle":
    "intentionally enigmatic and omitted from the glossary; its name is enough for those who find it",
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
  "<!-- This reference is generated from the product-term registry. -->";

/** The sort key an entry alphabetizes under: lowercased, leading "The " dropped. */
function sortKey(term: string): string {
  return term.toLowerCase().replace(/^the /, "");
}

/** The registry alphabetized, the order the page renders in. */
export function sortedGlossary(
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): GlossaryEntry[] {
  return [...glossary].sort((a, b) =>
    sortKey(a.term) < sortKey(b.term) ? -1 : 1
  );
}

/**
 * Render the map's glossary page from the term registry: every entry under its
 * own heading, alphabetized, with each term also emitted as a search alias so
 * `discern map <term>` reaches the page without a hand-maintained synonym list
 * (the same move the CLI reference makes with command paths).
 */
function renderGlossaryDocument(
  manual: boolean,
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): string {
  const entries = sortedGlossary(glossary);
  const aliases = [
    "terms",
    "definitions",
    "vocabulary",
    "dictionary",
    ...entries.map((e) => e.term.toLowerCase()),
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
  const alphabet = entries.filter((entry, index) =>
    index === 0 ||
    sortKey(entry.term).charAt(0) !==
      sortKey(entries[index - 1]?.term ?? "").charAt(0)
  ).map((entry) =>
    `[${sortKey(entry.term).charAt(0).toUpperCase()}](#${slugify(entry.term)})`
  ).join(" · ");
  return [
    "---",
    "title: Glossary",
    "description: Look up discern terms, understand their meaning, and find the next useful explanation.",
    "order: 70",
    "aliases:",
    ...aliases.map((alias) => `  - ${alias}`),
    "---",
    "",
    DOCS_BANNER,
    "",
    "# Glossary",
    "",
    manual
      ? "If a result or guide uses an unfamiliar word, start here. Each definition explains its meaning and links to more detail."
      : "Look up a term used in the project or its documentation. Each definition links to the explanation or reference behind it.",
    "",
    manual
      ? "Entries are alphabetical. Use the letters below or search this page for the word you need."
      : "These names are canonical — every page uses them identically, no synonyms ([ADR 0169](../_adr/0169-the-launch-glossary-canon.md)); running prose capitalizes Proof and its family only ([ADR 0373](../_adr/0373-proof-alone-carries-product-concept-capitals.md)). For how they relate, read [concepts](concepts.md).",
    "",
    `Jump to: ${alphabet}`,
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/** Render the established Map projection. */
export function renderGlossaryDoc(
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): string {
  return renderGlossaryDocument(false, glossary);
}

/** Render the public-manual projection from the same term registry. */
export function renderManualGlossaryDoc(
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): string {
  return renderGlossaryDocument(true, glossary);
}
