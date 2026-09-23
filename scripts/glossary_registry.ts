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
      "`discern accept` lands a finished change on your project's shared branch once the change has permission to land. Your agent runs it from the task's worktree, where it first records the task's [submission](#submission): the exact commit that passed the gate. From your main checkout, your agent names the task with `--target`, and discern lands its recorded submission. The change lands on the [trunk](#trunk) if you approved it in the conversation or a grant covers it. Without permission, nothing lands, and the submission waits for you. If other work landed after the change's Proof and the submitted commit doesn't include it, discern combines the two in an [integration worktree](#integration-worktree). It checks the combined code and lands exactly what passed. If another landing is already running, this one waits its turn and then carries on by itself. With `--target`, discern then keeps landing queued tasks that a grant covers, in order, until one needs you. After landing, discern records the Proof note, updates your main checkout, and removes the task's worktree, resources, and branch. The worktree stays if it holds uncommitted files or its branch has newer commits. See [worktrees](../30-worktrees/) and [landing authority](../30-worktrees/landing-authority.md).",
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
      "A temporary copy of the project where discern checks a change combined with newer work before landing it. discern creates this [worktree](#worktree) during a landing when other work has reached the [trunk](#trunk) since the [submission](#submission)'s Proof, and the submitted commit doesn't include it. The copy starts from the submitted commit, with the same setup and resources a task worktree gets, and merges in the current trunk. discern runs the full gate on the combined code and lands exactly what passed. If the combined code fires a checkpoint, your agent answers it with `discern accept`, and the same landing carries on. If the changes conflict or a combined check fails, nothing lands. discern removes the copy and hands the problem back to the task's agent. After a landing, discern removes the copy, its resources, and its `integration/` branch. discern records that it owns each copy, so an agent must never adopt one as its own task. If the process that owns a copy dies, `discern worktree prune` cleans it up, and it leaves copies still in use alone. See [worktrees](../30-worktrees/).",
  },
  {
    term: "Advisory",
    runningCase: "lowercase",
    plain: {
      phrase: "helpful advice that never blocks work",
      match: String.raw`\badvisor(?:y|ies)\b`,
    },
    definition:
      "Advice from discern about where to look, which never blocks your work. [Coupling](../20-quality-gate/coupling.md), [patterns](../20-quality-gate/patterns.md), [impact](https://discern.sh/docs/reference/cli-reference#discern-impact), and [improvement](../20-quality-gate/improvement.md) all give advice, and so do `advise` checkpoints. A finding can prompt your agent to investigate, and it never fails a [gate](#gate) check. In discern's results, advice arrives in `hints`. The separate `advisories` field lists problems a command worked around while still succeeding.",
  },
  {
    term: "discern version",
    runningCase: "lowercase",
    plain: { phrase: "the version of the Discern program itself" },
    definition:
      "The version of discern you're running, shown by `discern --version`. `discern releases` opens discern's release notes in your browser, or prints their address, so you can see what's new and whether an upgrade is available. discern never checks the network for updates, and never updates itself. To upgrade, run the [installer](#installer) again, then restart your coding agent's sessions so they use the new program. `discern upgrade` then updates your project's setup to match.",
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
      `One named step the [gate](#gate) runs, such as your tests or your linter. Your project lists its jobs under \`[jobs]\` in \`discern.toml\`. Every job runs as part of every \`discern done\`, whatever the change touches. A job that declares its inputs can reuse an earlier result when none of them changed. A job named ${
        codeList(Object.keys(KNOWN_JOBS), "or")
      } gets its [stage](#stage) from its name. Any other name makes a custom job, which declares its own stage. The gate also adds labeled jobs of its own: each \`[generated.<name>]\` command, the \`gate\` command of each [scope](#scope) the change touches, and each [standard](#standard)'s measurement. See [the quality gate](../20-quality-gate/).`,
  },
  {
    term: "Checkpoint",
    runningCase: "lowercase",
    plain: {
      phrase: "a judgment stop",
      match: String.raw`\bcheckpoints?\b`,
    },
    definition:
      "A review question your project asks your agent whenever a certain kind of change happens. Each `[checkpoints.<id>]` table pairs a trigger, which picks out the changes it applies to, with a [question](#question) for your agent to judge. A `stop` checkpoint makes `discern done` refuse to run the [gate](#gate) until your agent records its answer: [declared met](#declared-met) or [declared unmet](#declared-unmet). An `advise` checkpoint offers its question as advice and blocks nothing. After an unmet answer the checks still run, but the change can't land until you approve a [variance](#variance). discern reads the checkpoints from the trunk as it was when the task started, or when the task last ran `discern update`. So a task can't rewrite the questions it has to answer. `discern checkpoints` shows which checkpoints apply and where each question stands, and changes nothing. See [checkpoints](../20-quality-gate/checkpoints.md).",
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
      "Something discern asks your agent to judge, about a change or about the project as a whole. [Checkpoints](#checkpoint) ask questions when a change matches their triggers, and your agent records each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The [improvement review](../20-quality-gate/improvement.md) asks questions about work that already exists, and leaves them open for you and your agent to weigh. A question can carry a `teach` note that says why it matters. Proof keeps checkpoint answers apart from the results of the checks discern runs. See [checkpoints](../20-quality-gate/checkpoints.md).",
  },
  {
    term: "Open question",
    runningCase: "lowercase",
    plain: { phrase: "a record that a judgment stop fired" },
    definition:
      "discern's record that a stop checkpoint has asked your agent a question about a task. `discern done` opens one when a `stop` [checkpoint](#checkpoint) fires, and so does `discern accept` when the combined code fires one during a landing. The record names the checkpoint and the files it matched, and tracks each later [declaration](#declaration) or reopening. Its state is waiting for an answer, declared met, declared unmet, or reopened. Once it's open, the question still needs an answer even if the trigger stops matching. discern keeps the record in the worktree's Git administration folder, so it survives a session restart and goes away with the worktree. `discern checkpoints` shows its state without changing it. See [checkpoint state and declarations](../70-reference/checkpoint-state.md).",
  },
  {
    term: "Declaration",
    runningCase: "lowercase",
    plain: {
      phrase: "the agent's recorded answer",
      match: false,
    },
    definition:
      "Your agent's recorded answer to a checkpoint [question](#question). For a question it judges satisfied, your agent runs `discern done --met <id>` with the checkpoint's id. For one that isn't, it runs `discern done --unmet <id> --why \"…\"` with a one-paragraph reason. discern accepts an answer only for a `stop` checkpoint whose question is open. The answer covers the checkpoint's question and the files it matched. If the question or those files change, discern asks again, and unrelated edits leave the answer standing. Changing an answer makes the [Proof](#proof) stale, even on the same commit. Proof shows each answer as [declared met](#declared-met) or [declared unmet](#declared-unmet). The gate checks that every required answer exists. It doesn't check whether the judgment is right.",
  },
  {
    term: "Declared met",
    runningCase: "lowercase",
    plain: { phrase: "the agent's recorded yes" },
    definition:
      "Your agent's recorded answer that this change satisfies a checkpoint question. This [declaration](#declaration) covers the question and the matched files as they stood when your agent answered, and a change to either reopens it. The answer is your agent's judgment. discern records it but doesn't check whether it's right. A met answer needs no decision from you before the change lands.",
  },
  {
    term: "Declared unmet",
    runningCase: "lowercase",
    plain: { phrase: "the agent's recorded no, with the reason" },
    definition:
      "Your agent's recorded answer that this change doesn't satisfy a checkpoint question, with its reason. The [gate](#gate) still runs. [Proof](#proof) carries the reason for you to review, and the change can't land until you approve a [variance](#variance). The reason stays in the Proof and, after landing, in the [Proof note](#proof-note), so it must hold no secrets. discern keeps the reason out of the [logbook](#logbook). If your agent fixes the problem, it can replace the answer with met.",
  },
  {
    term: "Variance",
    runningCase: "lowercase",
    plain: {
      phrase: "the owner's recorded OK to land it anyway",
      match: String.raw`\bvariances?\b`,
    },
    definition:
      "Your permission to land a change even though your agent answered a checkpoint question unmet. Only you can approve one, in the current conversation. General permission to land doesn't cover it, and neither does any grant. Your agent records your approval with `discern accept --confirmed --variance <id>`, naming every unmet checkpoint. The variance covers that exact [declaration](#declaration), its reason, and the commit that lands. The checkpoint keeps asking its question of later work. See [checkpoints](../20-quality-gate/checkpoints.md).",
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
      "The setting that decides whether a [checkpoint](#checkpoint) waits for an answer or only gives advice. With `stop`, `discern done` refuses to run the [gate](#gate) until your agent records its answer. With `advise`, the question appears as a notice in `discern prepare`, `discern done`, and `discern status`, blocks nothing, and takes no answer. A checkpoint you write stops unless it says otherwise. A built-in checkpoint keeps the mode discern gives it. The built-ins that watch code changes advise, and the ones that watch project knowledge, such as the map, instructions, and skills, stop. After a [declared unmet](#declared-unmet) answer the checks still run, but the change needs your [variance](#variance) before it lands.",
  },
  {
    term: "Coupling",
    runningCase: "lowercase",
    plain: { phrase: "files that usually change together" },
    definition:
      "Files that have often changed together in your project's Git history. If a change edits one file but not its usual partner, discern names the partner. Your agent then checks whether the partner needs a change too. discern does this after a passing `discern prepare` or `discern done`, unless you set `[coupling].report_in_gate = false`. `discern coupling` runs the same check on demand, and given a file name, it lists that file's usual partners. The finding is [advisory](#advisory) and never blocks, so your agent decides whether it matters. See [coupling](../20-quality-gate/coupling.md).",
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
      "A file where discern maintains some parts and your project owns the rest. discern's ownership registry classifies as shared any registered path where discern maintains a marked region, named entries, or a fixed outline. discern leaves your content around them alone. Examples include discern's block in `.gitignore`, its entries in a coding agent's settings, and `discern.toml`, where `discern upgrade` adds any missing sections and keys. The [registered project paths](https://discern.sh/docs/reference/files-and-ownership#registered-project-paths) table lists every one.",
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
      "An instruction file your coding agent reads when it works on your project. `discern refresh` writes one for each coding agent listed in `[project].agents`. Claude Code reads `CLAUDE.md`, Gemini reads `GEMINI.md`, and Codex, Cursor, and GitHub Copilot share `AGENTS.md`. Without that key, discern writes the files for Claude Code and Codex. Each file holds discern's built-in instructions, followed by your [instruction source](#instruction-source). When discern writes `AGENTS.md`, the other files import it instead of repeating it. Git tracks the files by default, so anyone who clones the project gets the same instructions. To change them, edit your instruction source and run `discern refresh`. The gate fails if an agent file no longer matches its source. See [agent instructions](../40-agent-instructions/).",
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
      "The interactive view that opens when you run `discern` in your main checkout. It shows every task in progress and what you can do with each. `discern desk` opens it too, and both need an interactive terminal. Run from a task's worktree, either command points you back to the main checkout instead. From the desk you can see the [fleet](#fleet), start a task, and act on the selected worktree. You can also open any configured coding agent installed on your `PATH`. Actions that can't run yet appear as unavailable, with the reason. The desk is the only place you can pre-authorize a task to land once green, or revoke that grant. See [the desk](../30-worktrees/the-desk.md).",
  },
  {
    term: "discern",
    runningCase: "lowercase",
    plain: {
      keep:
        "the product's name — a name, not jargon; the plain register capitalises it as Discern",
    },
    definition:
      "A tool that lets you hand real work to coding agents and still decide what joins your project. It gives each task its own [worktree](#worktree) and runs your project's [gate](#gate) before a change counts as finished. It holds your quality limits, keeps what the project learns for later sessions, and lands a change only with permission. It's one self-contained program that needs only Git, and it has no AI model of its own. Your coding agent does the thinking and runs discern's commands.",
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
      "The part of discern that runs the everyday workflow inside a project. Its commands include `discern done`, `discern prepare`, `discern status`, `discern update`, and `discern accept`. The [installer](#installer) commands set a project up, and the engine's commands work inside it. Both parts are TypeScript, compiled into one program. The engine runs the jobs, scopes, standards, and worktree settings your project declares, so it works with any language or framework. It includes discern's formatter, [tidy](#tidy). See [engine internals](../50-engine-internals/).",
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
      "The rules that decide which files, and which parts of files, discern may change in your project. Each file discern writes is [project-owned](#project-owned-file), [shared](#shared-file), or [generated](#generated-file). The category decides what setup, `discern refresh`, `discern upgrade`, and uninstalling may do to that file. A file a coding agent creates for itself, such as its local settings, sits outside these categories. discern never writes it, and only keeps it out of Git. See [files and ownership](../70-reference/artifact-ownership.md). The [install surface](../80-development/install-surface.md) lists every file.",
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
      "One task, carried from its first edit through review until it lands. A [worktree](#worktree), its branch, and its [submission](#submission) all belong to one effort. discern's results give each effort's id and branch, and its messages name the branch. An effort keeps the same worktree through review fixes and later sessions. The landing queue lists efforts by their submissions, and `discern accept` lands the selected effort's submission on the [trunk](#trunk). An effort can land more than once. If its branch has newer commits when a landing finishes, the worktree stays, and a later submission lands them.",
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
      "All the task [worktrees](#worktree) in your project. The [desk](#desk) and `discern status` show the fleet from your main checkout, and `discern status --all` shows it from inside a task's worktree. The list also includes the main checkout and any integration worktree discern is using for a landing, each labeled. Each task worktree still belongs to its own effort when it's idle or has no changes. See [worktrees](../30-worktrees/).",
  },
  {
    term: "Gate",
    runningCase: "lowercase",
    plain: { phrase: "the final quality check", match: String.raw`\bgates?\b` },
    definition:
      "The full set of checks your project requires before a change counts as finished. `discern done` runs it on the task's committed work. It refuses to start while the worktree has uncommitted changes. It also stops if the branch is behind the trunk, or if a stop checkpoint is waiting for an answer. Then it runs discern's own checks, such as whether the agent files still match their source, and every one of your project's [jobs](#gate-job). It also runs the `gate` command of each [scope](#scope) the change touches, and measures every [standard](#standard). When something fails, the result names the check and gives a command that reproduces it. A pass means those checks passed on that commit, and nothing more. It doesn't give the change permission to land. See [the quality gate](../20-quality-gate/).",
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
      "A file discern builds for your coding agents: an agent file or a skill folder. discern builds them from your own sources, such as your instruction source and skills, and from the instructions and skills it ships with. `discern refresh`, `discern upgrade`, and `discern prepare` rebuild them, so a direct edit gets replaced. The [gate](#gate) fails if a generated file no longer matches its source. To change one, edit its source instead. By default, Git tracks agent files and ignores the skill folders. See [agent files](#agent-file) and [skills](#skill).",
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
      "A committed file that your project rebuilds from its own sources with a command. You declare its `paths` and its `run` command under `[generated.<name>]` in `discern.toml`. The command must produce the same bytes from the same sources. `discern prepare` runs it, so the files are current before the commit. `discern done` runs it too, and fails if that changes any committed file. When `discern update` hits a merge conflict only in declared generated paths, it resolves the conflict by running the command again. [Coupling](#coupling) leaves these paths out of its history. discern handles its own [generated files](#generated-file) the same way, so you don't declare them. See [the quality gate](../20-quality-gate/).",
  },
  {
    term: "Instruction source",
    runningCase: "lowercase",
    plain: {
      phrase: "the project's own instruction text for coding agents",
      match: String.raw`\binstructions\s+sources?\b`,
    },
    definition:
      `The file where your project writes its own instructions for coding agents. \`[instructions].sources\` lists it, and the default is \`${
        sourcePathDefault("instructions")
      }\`. The list can name several files or glob patterns, and discern skips any file that's missing. When discern builds the [agent files](#agent-file), it puts its built-in instructions first and yours after them, and yours win where the two conflict. See [agent instructions](../40-agent-instructions/).`,
  },
  {
    term: "Installer",
    runningCase: "lowercase",
    plain: { keep: "an everyday computing word" },
    definition:
      "The script that downloads the discern program, checks it, and installs it on your machine. Run it again to update the program. The same word also covers the commands that set discern up in a project and look after it. They include `discern setup`, `discern upgrade`, `discern config`, and [doctor](https://discern.sh/docs/reference/cli-reference#discern-doctor), which checks an installation without changing it. Each one runs and exits, and the software you build never needs discern to run. See [getting started](../10-getting-started/).",
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
      "Permission for a change to land on the [trunk](#trunk), your project's shared branch. You can give it in the current conversation, and your agent records your yes with `discern accept --confirmed`. A standing grant gives it in advance: the trunk's `[acceptance].pre_authorized` names scopes, such as documentation, whose changes may land without asking. A standing grant covers a change only when every file the change touches falls inside a granted scope. A grant for one task, which you record from the [desk](#desk), covers every file in that task. It still covers the task after review fixes, once its agent submits the new version, and landing uses it up. Until then you can revoke it from the desk, and it disappears with the worktree. No grant covers a [variance](#variance), a change to a [standard](#standard)'s limit, or an emergency landing. A passing [Proof](#proof) shows which checks passed, and never gives permission to land. See [landing authority](../30-worktrees/landing-authority.md).",
  },
  {
    term: "Logbook",
    runningCase: "lowercase",
    plain: { phrase: "the activity record", match: String.raw`\blogbooks?\b` },
    definition:
      "discern's local record of what each command did and how long it took. Recording is on by default. While it's on, and discern can read `discern.toml`, each discern command adds an entry. So does each tool call through the Model Context Protocol (MCP). An entry holds details such as timing and outcome, and names such as the branch and file paths. It never holds your code or command output. All worktrees share one logbook inside `.git`, and discern has no way to send it anywhere else. Set `[project].record_logbook = false` to stop recording. See [the logbook](../70-reference/the-logbook.md).",
  },
  {
    term: "Map",
    runningCase: "lowercase",
    plain: { phrase: "the project guide", match: String.raw`\bmaps?\b` },
    definition:
      `Your project's own guide to how its software works and why, which your agents write and keep current. It lives in \`[map].dir\`, which defaults to \`${
        sourcePathDefault("map")
      }\`, and \`discern map\` browses, reads, and searches it. Read it to understand the project, and correct anything the agents got wrong. The gate checks the map's mechanics, such as its links, headings, and command examples. What the pages say is up to the people and agents who write them. A page with \`publish: false\` in its frontmatter stays out of every published copy ([ADR 0140](../_adr/0140-validated-frontmatter-and-the-publish-predicate.md)). \`discern map\` and your agents can still read it. Pointing \`[map].dir\` at docs you already have gives discern permission to manage them ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).`,
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
      "A numbered step that updates your project's discern setup to a newer format. A step can change `discern.toml`, rename or remove files, or merge a coding agent's settings files. `discern upgrade` runs any pending migrations in order, one [schema version](#schema-version) at a time. Running a migration again doesn't repeat its effect. discern checks that the updated configuration is valid before it records the new version. `discern upgrade` refuses to run with uncommitted changes unless you pass `--allow-dirty`, so Git can undo an upgrade. See [upgrading discern](../10-getting-started/upgrade-discern.md).",
  },
  {
    term: "Namespace",
    runningCase: "lowercase",
    plain: {
      phrase: "a clearly separated naming area",
      match: String.raw`\bnamespaces?\b`,
    },
    definition:
      `The folder that holds your project's own discern content, \`${NAMESPACE_DIR}\` by default. It holds the [map](#map), your [instruction source](#instruction-source), your own [skills](#skill) and [project scripts](#project-script), the project brief from setup, and the \`TODO.md\` list of deferred work. Everything in it belongs to your project. Configuration can move each of these except the brief, which stays at \`${
        sourcePathDefault("brief")
      }\` ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). \`discern.toml\` stays at the project root.`,
  },
  {
    term: "Patterns",
    runningCase: "lowercase",
    plain: { phrase: "the recurring-behaviour report" },
    // "patterns" also names ordinary testing and design patterns in the manual.
    matches: ["discern patterns"],
    definition:
      "discern's report on what keeps happening in your project's work, read from its local history. `discern patterns` reads the [logbook](#logbook) for patterns such as repeated gate failures, avoidable steps, slow checks, and changes in [standard](#standard) measurements. Each finding gives its counts, with the total they came from, and a next step. When the logbook doesn't hold enough evidence, the report says so. `discern patterns --stats` shows what went well instead. The report is [advisory](#advisory), and it has nothing to report when the project doesn't record a logbook. See [practice patterns](../20-quality-gate/patterns.md).",
  },
  {
    term: "Improvement review",
    runningCase: "lowercase",
    plain: { phrase: "the project-wide quality review" },
    matches: ["improvement review", "improvement audit"],
    definition:
      "A review of your project as it stands, which finds the most useful next improvement. `discern improvement` scores the project's setup on a set of health checks and names one next action. It also lists [questions](#question) about existing work for you and your agent to judge, outside the score. They can find weaknesses a [checkpoint](#checkpoint) never sees, because checkpoints look only at new changes. The review is [advisory](#advisory) and never blocks `discern done` or `discern accept`. Its `--min-score` option makes the command fail when the score falls below a floor you choose. See [improvement](../20-quality-gate/improvement.md).",
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
      "The rule that putting content where discern manages it gives discern and your agents permission to maintain it. The default locations carry that permission, and your agents treat anything stale there as a problem to fix. Pointing a configuration key at another location grants it explicitly, because you chose the path. The rule covers only the content discern manages. Your agent's other work and your project's jobs run under their own permissions. See [design principles](design-principles.md) and [files and ownership](../70-reference/artifact-ownership.md).",
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
      "The way of working discern sets up in your project, which carries over from one session to the next. Each session starts with the project's instructions. Each task gets its own [worktree](#worktree), passes your project's [gate](#gate), meets your [standards](#standard), and finishes with [Proof](#proof) of which checks passed. Nothing lands without [landing authority](#landing-authority) that you control. Bundled [skills](#skill) guide your agents as they delegate work, keep what the project learns, and fix problems at their cause. You set the direction and make the decisions that matter, and your agents run the workflow. See [the practice](the-practice.md).",
  },
  {
    term: "Project script",
    runningCase: "lowercase",
    plain: {
      phrase: "the project's own runnable instruction",
      match: String.raw`\bproject\s+scripts?\b`,
    },
    definition:
      `A procedure your project provides for its agents and maintainers to run. Each script is an executable file in any language, placed directly in \`[scripts].dir\`, which defaults to \`${
        sourcePathDefault("scripts")
      }\`. \`discern scripts\` lists them, and \`discern scripts <name>\` runs one from the project root. discern gives each script its own \`DISCERN_*\` values, such as \`DISCERN_ROOT\` and \`DISCERN_TRUNK\`, and removes any it inherited. Scripts have a command of their own, so a script can share its name with a built-in discern command ([ADR 0137](../_adr/0137-project-scripts-live-under-the-script-command.md)).`,
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
      "A short code, such as `R1-XXXX-XXXX-XX`, that lets your agent read back a long-running command after losing track of it. discern records one for each long operation, such as `discern done` or `discern accept`. `discern progress <handle>`, or the `discern_progress` tool, shows that operation's phase, the counts and failures known so far, and its result once it finishes. An MCP client that asks for progress updates gets the handle first. Terminal output, `--json`, and `--markdown` don't show it. Without a handle, `discern progress` reads the latest operation in the current checkout. Reading progress starts, repeats, and cancels nothing. To resume a wait, your agent uses the `C1` continuation that `discern await` returns. See [progress and reconnect](../70-reference/progress-and-reconnect.md).",
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
      "discern's record of which of your project's checks passed, on exactly which commit. `discern done` records it when every check passes on the latest commit in the task's worktree, with nothing left uncommitted. It holds the check results, the [standards](#standard) that held, and your agent's checkpoint answers. The Proof line sums it up, and `discern status --verbose` shows the full record. Any later edit makes the Proof stale, and so does a changed checkpoint answer or limit proposal. The new version then needs its own `discern done`. A newer trunk doesn't make Proof stale. A check whose inputs haven't changed can reuse its earlier result. Proof shows what passed, and it never gives a change [landing authority](#landing-authority). See [how to read a Proof](../20-quality-gate/the-proof.md).",
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
      "A copy of a landed change's [Proof](#proof), stored with its commit in Git. When a change lands, discern writes its Proof as a Git note on the landed commit, under `refs/notes/discern`. The note also records who allowed the landing, including any [variance](#variance) and its reason. Anyone with the repository can later look up which checks passed for that commit. The note is a JSON record in a Dead Simple Signing Envelope (DSSE). Its payload names the full commit, and the envelope keeps the exact payload bytes so a future version can add signatures. discern doesn't sign notes yet, so their list of signatures is empty. Notes stay in your local repository. Setting `[repository].proof_notes_mode = \"fetch\"` also fetches them from your remotes, and only an explicit `git push` shares them. An emergency landing writes an exception record there instead of Proof. See [Proof notes](../20-quality-gate/proof-notes.md).",
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
