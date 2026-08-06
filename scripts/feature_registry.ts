/**
 * The feature registry and the generated feature canon — the product's
 * features and benefits as DATA, rendered into the maintainer canon page the
 * same way the glossary renders from its term registry (ADR 0175, following
 * the discipline of `glossary_registry.ts`).
 *
 * Three consumers:
 *  - `scripts/codegen.ts` renders {@link renderFeatureCanonDoc} into the map's
 *    committed `_internal/feature-canon.md` and
 *    {@link renderFeatureCanonPlainDoc} into its plain-language twin
 *    `_internal/feature-canon-plain.md`; a sync test asserts each committed
 *    file equals the generator output, so a feature change that isn't
 *    regenerated fails the gate.
 *  - the enrolment guards (`tests/feature_canon_enrolment_test.ts`) hold every
 *    member of the product's closed sets — verbs, known jobs, stages, config
 *    tables, bundled skills, agent providers — to a claim in this tree, so the
 *    feature account can never lag the product.
 *  - creative, technical, and marketing work reads {@link FEATURE_CANON} (or
 *    the generated page) instead of re-deriving the feature list by hand.
 *
 * Statements whose facts another registry owns interpolate from that single
 * source — the known-job vocabulary from `KNOWN_JOBS`, the stage names from
 * `STAGES`, the provider names from `AGENT_NAMES` — so adding a member updates
 * the canon's prose in the same change.
 *
 * This module lives under `scripts/`, not `src/`: its strings are map prose,
 * whose internal ADR citations the vocab guard rightly bans from the binary's
 * own source tree (ADR 0164), and no part of the shipped binary reads it.
 */

import { join } from "@std/path";
import { KNOWN_JOBS, STAGES } from "../src/shared/capabilities.ts";
import { AGENT_NAMES } from "../src/shared/agent_catalogue.ts";
import { GLOSSARY, phrasePatternSource } from "./glossary_registry.ts";

/**
 * The plain-language reading of one node — the same feature retold for a
 * non-technical owner, in the register the plain canon page renders (ADR
 * 0228). The register's rules: NAMES ARE QUOTED, CONCEPTS ARE TRANSLATED.
 * Command names, config keys, and file names stay verbatim in code spans;
 * every concept around them is translated per the glossary's plain
 * renderings ({@link GLOSSARY}, `plain` on each entry — one plain phrase per
 * term, used identically everywhere). Say "coding agent",
 * never "agent"; "the person in charge" for the owner; explain a kept name on
 * first use ("the computer's standard installed-program list, called
 * `PATH`"). Full sentences, everyday words, no unexplained initialisms. The
 * register guard (tests/feature_canon_plain_register_test.ts) polices the
 * vocabulary; the reading-grade standard holds the register's simplicity.
 */
export interface PlainAccount {
  /** Display name in the plain register; a literal name may ride a code span. */
  title: string;
  /** The `what`, retold: what it is or does, in everyday words. */
  what: string;
  /** The `why`, retold — present exactly when the node states a `why`. */
  why?: string;
  /**
   * The agent-facing benefit, retold — present exactly when the node states
   * an `agent` account. Describe the resulting experience, not a procedure.
   */
  agent?: string;
}

/**
 * One node of the feature canon. Depth is resolution: top-level nodes are the
 * pillars, leaves are the finest-grained behaviors, and every cut in between
 * is a legitimate reading of the product.
 */
export interface FeatureNode {
  /** Stable kebab-case id, unique across the whole tree. */
  id: string;
  /** Canonical display name — glossary vocabulary, used identically. */
  title: string;
  /**
   * Marks a node whose statement is value rather than mechanism — an abstract
   * benefit the product delivers, with no single implementation surface.
   */
  kind?: "benefit";
  /** What it is or does: one or two plain sentences, present tense. */
  what: string;
  /** What it buys the user — the benefit, stated factually. */
  why?: string;
  /**
   * The agent-facing benefit — what the feature lets the agent avoid, notice,
   * or trust as a result (ADR 0179). Describe the resulting experience, not
   * operating instructions. Present only where that account is distinct from
   * the owner's reading in `why`.
   */
  agent?: string;
  /**
   * Registered hint ids this node's account leans on — soft references: the
   * enrolment guard fails a citation of an id the hint registry does not
   * carry, but no hint demands a citation.
   */
  hints?: readonly string[];
  /**
   * The plain-language reading — required on every node, so a feature cannot
   * enter the canon without its non-technical account. `deno check` is the
   * enrolment guard's front line: a node authored without `plain` fails the
   * gate's typecheck before any test runs.
   */
  plain: PlainAccount;
  /**
   * Explicit claims on closed-set members, written `set:member` — e.g.
   * `verb:done`, `job:test`, `stage:fix`, `config:standards`,
   * `skill:discern-cure-a-bug`, `agent:codex`. The enrolment guard holds every
   * live member to a claim here (or a recorded deliberate absence), and every
   * claim to a live member.
   */
  surfaces?: readonly string[];
  /** Finer-resolution children. */
  children?: readonly FeatureNode[];
}

/** The closed sets the canon claims members of. */
export const SURFACE_SETS = [
  "verb",
  "job",
  "stage",
  "config",
  "skill",
  "agent",
] as const;
export type SurfaceSet = (typeof SURFACE_SETS)[number];

/** `a`, `b`, and `c` — backticked names joined with an Oxford conjunction. */
function codeList(names: readonly string[], conjunction: string): string {
  const coded = names.map((n) => `\`${n}\``);
  if (coded.length <= 1) return coded.join("");
  if (coded.length === 2) return coded.join(` ${conjunction} `);
  return `${coded.slice(0, -1).join(", ")}, ${conjunction} ${coded.at(-1)}`;
}

/**
 * The canon. Pillar order is narrative order — the gate first, foundations
 * last; the renderer preserves it. Every pillar states its `why`.
 */
export const FEATURE_CANON: readonly FeatureNode[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "gate",
    title: "The quality gate",
    what:
      "One command — `discern done` — runs the project's full quality check: the declared jobs by stage, any scope gates the change woke, and the standards, with every job labeled and every failure carrying the command that produced it.",
    why:
      "The repo, not the agent, decides what done means. An agent's confidence has no vote; the gate's verdict is a command result.",
    agent:
      "An agent can run the gate as often as it needs at no cost in trust: the verdict is recomputed each time, and a red one carries the commands that make it green.",
    plain: {
      title: "The final quality check",
      what:
        "One instruction, `discern done`, runs every check the project requires. It runs the listed pieces of work in their proper order, any extra checks for the parts of the project the change touched, and every stated quality rule. Each piece has a name, and every failure includes the exact instruction that produced it.",
      why:
        "The project itself, not the coding agent, decides when the work counts as finished. However confident the coding agent feels, the result of the check decides.",
      agent:
        "The coding agent can run the check as often as it needs without asking anyone to trust an old result. Discern works the answer out afresh every time, and a failed result includes the instructions that make it pass.",
    },
    surfaces: ["verb:done", "verb:queue", "config:jobs", "config:gate"],
    children: [
      {
        id: "jobs-table",
        title: "Declared jobs",
        what:
          `A project declares its commands once, under \`[jobs]\`. The known names ${
            codeList(Object.keys(KNOWN_JOBS), "and")
          } derive their stage; a custom \`[jobs.<name>]\` table declares one, with an optional \`provides\` label.`,
        why:
          "Every agent and every human runs the same commands, read from one file.",
        plain: {
          title: "Work the project has declared",
          what:
            `A project lists its instructions once, in the part of its settings called \`[jobs]\`. The familiar names ${
              codeList(Object.keys(KNOWN_JOBS), "and")
            } automatically go in the right group; any additional named item goes under \`[jobs.<name>]\`, states its own group, and may add a \`provides\` label saying what it supplies.`,
          why:
            "Every person and every coding agent runs the same instructions, taken from the same file.",
        },
        children: [
          {
            id: "job-format",
            title: "format",
            what:
              "The fix-stage job: a formatter or codemod that may rewrite files. It runs first and serially, so mutations never race read-only checks.",
            plain: {
              title: "`format`",
              what:
                "The first, tidying step: a tool that may rewrite files to keep them consistent or to update an old pattern. It runs before everything else, and alone, so it can never change a file another check is reading.",
            },
            surfaces: ["job:format"],
          },
          {
            id: "job-build",
            title: "build",
            what:
              "Produces the artifacts later stages read — compile, bundle, codegen.",
            plain: {
              title: "`build`",
              what:
                "Prepares the files later steps need — the ready-to-run form of the program, a combined package, or files made automatically from a master source.",
            },
            surfaces: ["job:build"],
          },
          {
            id: "job-lint",
            title: "lint",
            what: "Read-only static analysis at the check stage.",
            plain: {
              title: "`lint`",
              what: "Looks for likely mistakes, without changing any files.",
            },
            surfaces: ["job:lint"],
          },
          {
            id: "job-typecheck",
            title: "typecheck",
            what: "Read-only type checking at the check stage.",
            plain: {
              title: "`typecheck`",
              what:
                "Checks, without changing any files, that the program uses every value in a way that fits its shape.",
            },
            surfaces: ["job:typecheck"],
          },
          {
            id: "job-test",
            title: "test",
            what:
              "The test suite, with an optional per-job `timeout` for a slow suite.",
            plain: {
              title: "`test`",
              what:
                "Runs the project's full set of trials. A slow set can take its own `timeout` time limit.",
            },
            surfaces: ["job:test"],
          },
          {
            id: "job-smoke",
            title: "smoke",
            what:
              "A fast, side-effect-light readiness check: the app boots and its essential shared runtime works in this checkout. It runs in the same fail-fast group as `test`, so a quick smoke failure cancels slower siblings.",
            plain: {
              title: "`smoke`",
              what:
                "A quick, light-touch readiness trial: does the app start, and do the essential shared parts it depends on work in this particular copy? It runs alongside `test`, so a fast basic failure stops the slower work early.",
            },
            surfaces: ["job:smoke"],
          },
        ],
      },
      {
        id: "staged-pipeline",
        title: "The staged pipeline",
        what: `Gate work runs in ${
          codeList(STAGES, "then")
        } order: stages run serially, and the jobs inside a stage run in parallel.`,
        why:
          "Mutating fixers can never race read-only checks, and independent checks never wait on each other.",
        plain: {
          title: "The ordered run",
          what: `Work in the final check happens in ${
            codeList(STAGES, "then")
          } order: one group finishes before the next starts, and the pieces inside a group run at the same time.`,
          why:
            "A step that changes files can never clash with a step that is only reading them, and independent checks never wait for one another.",
        },
        surfaces: STAGES.map((s) => `stage:${s}`),
        children: [
          {
            id: "fail-fast",
            title: "Fail-fast cancellation",
            what:
              "`[gate].fail_fast` (on by default) tree-kills the in-flight sibling jobs the moment one fails, including their grandchild processes. Set it false to collect every failure in one pass.",
            why: "An agent iterating on a red gate gets its answer sooner.",
            plain: {
              title: "Stopping quickly after a failure",
              what:
                "`[gate].fail_fast` (on unless the project turns it off) stops the other pieces still running the moment one fails, including anything those pieces started. Turn it off to collect every failure in one pass.",
              why:
                "A coding agent working through a failing check gets its answer sooner.",
            },
          },
          {
            id: "job-timeouts",
            title: "Job time budgets",
            what:
              "`[gate].timeout` bounds every command the gate runs; a job that needs more takes its own `timeout`. A command that overruns is tree-killed and fails with a plain-language diagnostic.",
            why:
              "The gate can never hang on a watch-mode test runner or a stuck dev server.",
            agent:
              "The watchdog reclassifies a command that daemonized and returned as a failure even when its exit code read zero, so a forked background server cannot buy a false green.",
            plain: {
              title: "Time limits for each piece of work",
              what:
                "`[gate].timeout` limits how long every instruction may run; an unusually slow one can carry its own `timeout`. Discern stops an instruction that runs over, along with everything it started, and fails it with an explanation in everyday language.",
              why:
                "The final quality check can never wait forever for a trial runner that keeps watching for changes, or for a stuck preview server.",
              agent:
                "Discern treats an instruction that left a background service running behind it as a failure, even when the instruction itself claimed success — a hidden background service cannot buy a false pass.",
            },
          },
          {
            id: "capture-environment",
            title: "The capture environment",
            what:
              "Every job runs with `CI=1`, `NO_COLOR=1`, and `TERM=dumb`, which flips the common watch-mode test runners into single-run form and keeps tool output plain enough to parse.",
            why:
              "The most frequent gate hang is prevented at spawn, minutes before a timeout would catch it.",
            plain: {
              title: "A controlled setting for captured output",
              what:
                "Every piece of work runs with three widely used settings — `CI=1`, `NO_COLOR=1`, and `TERM=dumb` — which make the common trial-running tools run once instead of waiting for more changes, and keep their printed words plain enough to read mechanically.",
              why:
                "The most common cause of a never-ending check is prevented at the start, minutes before a time limit would have caught it.",
            },
          },
          {
            id: "gate-streaming",
            title: "Live or grouped output",
            what:
              "`[gate].stream` switches between grouped per-job output (the default) and live line-prefixed streaming for watching a slow build.",
            plain: {
              title: "Results shown live or kept together",
              what:
                "`[gate].stream` chooses between keeping each piece's output together (the usual choice) and showing every new line as it happens, labelled with the piece's name — useful when watching a slow preparation step.",
            },
          },
          {
            id: "strand-detection",
            title: "Strand detection",
            what:
              "`discern done` fails any stage that leaves uncommitted changes behind, instead of letting a fixer's rewrites sit in the tree without review.",
            why:
              "What the gate verified and what gets committed are the same tree.",
            plain: {
              title: "Catching changes left behind",
              what:
                "`discern done` fails any group that changed files but did not save those changes into the project's history, instead of letting a tidying tool's rewrites sit unnoticed.",
              why:
                "The exact files the check passed are the files that get saved.",
            },
          },
        ],
      },
      {
        id: "tidy",
        title: "Canonical formatting for discern surfaces",
        what:
          "`discern tidy [md|toml]` canonically formats the configured map, TODO and guidance sources, plus the root `discern.toml`, using formatters embedded in the offline binary. Bare `discern tidy` runs both types; a parse failure leaves every file unchanged. Fenced box-drawing diagrams in those Markdown targets must stay column-aligned; a fence tagged `freeform` is exempt.",
        why:
          "Agent-maintained prose and frequently edited config stop accumulating formatting churn, even when the project's stack has no formatter of its own.",
        plain: {
          title: "Consistent tidying of Discern's own files",
          what:
            "`discern tidy [md|toml]` tidies the project guide, the to-do list, the instruction text for coding agents, and the root `discern.toml` settings file, using tidying tools carried inside the program — no internet connection needed. Bare `discern tidy` covers both kinds of file, and Discern leaves a file it cannot make sense of entirely alone. Drawn diagrams in those files must keep their columns lined up; one marked `freeform` is exempt.",
          why:
            "Writing maintained by coding agents, and settings edited often, stop collecting pointless layout churn — even when the project's own tools include no tidier.",
        },
        surfaces: ["verb:tidy"],
      },
      {
        id: "gate-preconditions",
        title: "Fail-fast preconditions",
        what:
          "Before any job runs, the gate checks the branch's merge state against the trunk and the generated files' currency, and points a behind or drifted tree at the one command that fixes it.",
        why:
          "A ten-minute test run never ends in a merge-conflict surprise it could have named up front.",
        plain: {
          title: "Checking the obvious before slow work begins",
          what:
            "Before running anything, the final check confirms that the task's copy is up to date with the main shared version and that automatically made files still match their sources — and when either is not true, it names the instruction that fixes it.",
          why:
            "A ten-minute set of trials never ends in a clashing-changes surprise Discern could have named up front.",
        },
      },
      {
        id: "write-preflight",
        title: "Write authority proven first",
        what:
          "Before project work, the gate performs the smallest real write of each class it will later need — a create/rename/remove round-trip in the Git admin area, an open-for-write on an existing marker — because sandbox permission metadata can approve an operation the sandbox then denies. A denial is a structured failure naming the blocked path, with a reproduce command.",
        why:
          "A sandbox denial costs a few filesystem operations up front instead of a discarded gate run at the end.",
        agent:
          "The agent learns about a missing permission while retrying is still cheap: one re-run with escalated authority, and no half-recorded state to clean up. In the engine, a branded authority token means a state writer cannot compile without the probe.",
        plain: {
          title: "Proving permission to write first",
          what:
            "Before the real work, the check tries the smallest genuine example of every kind of file change it will later need — briefly creating, renaming, and removing something in the version history's housekeeping area, and opening an existing marker file for writing — because a permission list can say yes and the computer can still say no. A refusal becomes a clear failure naming the blocked place, with an instruction that reproduces it.",
          why:
            "A denied permission costs a few tiny file actions up front instead of a whole thrown-away run at the end.",
          agent:
            "The coding agent learns about a missing permission while trying again is still cheap: one re-run with stronger permission, and no half-recorded state to clean up. Inside Discern's own construction, a part that writes saved state will not even build without proof that this check ran.",
        },
      },
      {
        id: "scope-gates",
        title: "Scopes",
        what:
          "`[scopes.<name>]` names a region of the repository by path globs. A scope can be `neutral` (changes there need no gate), `previewable` (worth a preview link), or carry its own `gate` command that runs only when the region changed.",
        why:
          "A docs edit doesn't pay for a compile, and a sub-component's own checks fire only when it moved.",
        plain: {
          title: "Areas of the project",
          what:
            "`[scopes.<name>]` names one part of the project by the file locations it covers. An area can be `neutral` (changes there need no check), `previewable` (a person could usefully preview it), or carry its own `gate` instruction that runs only when that area changed.",
          why:
            "A change to written guidance does not pay the cost of preparing the whole app, and a smaller part's private checks run only when that part moved.",
        },
        surfaces: ["config:scopes"],
        children: [
          {
            id: "fail-open-classification",
            title: "Fail-open classification",
            what:
              "A path matching no scope counts as a real code change, so an unknown path runs more gates, never fewer.",
            why:
              "Misconfiguration errs toward checking too much, never too little.",
            plain: {
              title: "Choosing safety when a file is unknown",
              what:
                "A file matching no named area counts as a real program change, so an unknown file causes more checking.",
              why: "A settings mistake errs toward checking too much.",
            },
          },
        ],
      },
      {
        id: "generated-artifact-declarations",
        title: "Generated artifact declarations",
        what:
          "`[generated.<name>]` declares scope-style path globs for the committed artifacts one generator owns, the deterministic `run` command that rewrites them, and an optional `timeout`. The generator removes artifacts it no longer emits.",
        why:
          "Artifact ownership and regeneration live in one machine-readable record, so consumers read the same paths and command.",
        agent:
          "A coding agent can resolve an artifact path to its named generator group and read the command that rebuilds it. The declaration also says which tool must remove an orphaned artifact.",
        plain: {
          title: "Files made by a tool",
          what:
            "`[generated.<name>]` records which saved files one tool makes, the instruction that makes them again, and an optional `timeout` time limit. Given the same project files, the instruction must write the same contents and remove old files the tool no longer makes.",
          why:
            "Each reader gets the file list and the instruction that makes it from one settings entry.",
          agent:
            "A coding agent can find which named entry owns a file and read the instruction that makes it again.",
        },
        surfaces: ["config:generated"],
      },
      {
        id: "prepare",
        title: "The fast inner loop",
        what:
          "`discern prepare` runs the fix-stage jobs then the check-stage jobs, and never builds or tests — the quick pass while iterating, before the full `discern done`.",
        why: "Cheap feedback while the change is still moving.",
        plain: {
          title: "The quick check while work is still moving",
          what:
            "`discern prepare` runs the tidying steps and then the read-only checks, and never prepares the app or runs the trials — the fast pass to use while working, before the complete `discern done`.",
          why: "Cheap feedback while the change is still taking shape.",
        },
        surfaces: ["verb:prepare"],
      },
      {
        id: "test-verb",
        title: "Tests on their own",
        what:
          "`discern test` runs the configured test job (and `smoke`) outside the full gate, and reports a trivial pass with a note when no test command is configured.",
        plain: {
          title: "Running the trials by themselves",
          what:
            "`discern test` runs the project's listed trials (and the quick `smoke` readiness trial) outside the complete check, and reports a simple pass with a note when the project has no trial instruction set up.",
        },
        surfaces: ["verb:test"],
      },
      {
        id: "diagnostics",
        title: "Normalized diagnostics",
        what:
          "A failed job returns structured diagnostics: the tool, file and line when available, the message, and the exact command to reproduce it. Oversized captured output is normalized and offloaded to a file instead of flooding the result.",
        why:
          "The fix starts at the cause; nothing needs re-running to see what failed.",
        agent:
          "The capture window keeps the head and the tail of oversized output, so the first compiler error and the final summary both survive, and the full text offloads to a named file only when the inline view was clipped. A failure a configured fixer might resolve is flagged as such, and a job that passed while printing error-like lines fires a hint naming its output.",
        hints: ["gate-job-loud-success"],
        plain: {
          title: "Clear and consistent failure reports",
          what:
            "A failed piece of work reports the tool involved, the file and line when known, the message, and the exact instruction that reproduces the failure. Discern tidies output too long to show whole into a named file instead of flooding the result.",
          why:
            "Work on the fix starts at the cause, and nothing needs re-running to see what went wrong.",
          agent:
            "When output runs long, the beginning and the end are both kept, so the first error and the final summary survive — the complete text goes to a separate named file only when the short view lost lines. Discern marks a failure that a listed tidying tool might fix, and a piece of work that claimed success while printing error-like lines produces an advice note naming those lines.",
        },
      },
      {
        id: "gotchas-pointer",
        title: "The gotchas pointer",
        what:
          "When a stage fails, the gate prints a pasteable `discern map <target> --json` fetch when `[project].gotchas_doc` lives in the map, and the file path otherwise. A trap entry annotated with a fenced `gotcha-match` block (a stage and/or an evidence pattern) goes further: a failure matching it carries the entry's own prose inline in the failure output, on the terminal and in the result envelope alike, and the pointer prints only when nothing matches.",
        why:
          "Hard-won failure lore reaches the agent at the moment it applies — a matched trap without even a fetch.",
        agent:
          "Matching reads the failure's `failed_stage` and diagnostic evidence against the doc's entries in document order; the first match wins and the inlined entry keeps the map fetch as the route to the full page. A malformed matcher warns by entry name whenever the doc is consulted, and a project that never adds matchers keeps the pointer unchanged.",
        hints: ["gate-failure-gotcha-matched", "gotchas-matcher-invalid"],
        plain: {
          title: "A pointer to known traps",
          what:
            "When a group of work fails, Discern points at the project's own record of known traps — as a ready-to-paste `discern map` fetch when that record lives in the project guide, or as the file's location otherwise. An entry there can also carry a small matching rule (which group failed, or what the failure's text looks like): a failure that matches brings the entry's own advice straight into the failure report, and the pointer appears only when nothing matched.",
          why:
            "A lesson learned the hard way reaches the coding agent at the exact moment it applies — and a matched trap needs no looking up at all.",
          agent:
            "Matching compares the failed group and the failure's details with the record's entries, in order; the first match wins, and the advice it carries still names where the full page lives. A malformed matching rule produces a warning naming its entry whenever Discern consults the record, and a project that never adds matching rules keeps the plain pointer unchanged.",
        },
      },
      {
        id: "receipt",
        title: "The receipt",
        what:
          "A green `discern done` over a clean, committed tree ahead of the trunk emits a review summary: the branch and the pinned `HEAD`, the commits, changed files, check results, and held standards. `discern accept` can reuse it while that commit and worktree stand; a later commit invalidates it. The same green run fires a registered hint to exercise the real artifact along the changed paths before offering the receipt.",
        why:
          "The owner reviews a verified claim that names the tree it vouches for.",
        agent:
          "A commit made while the gate ran can never earn the receipt: the tree is pinned before the first job and re-checked at stamp time. When a green run cannot record one because the tree is dirty, the refusal names the blocking paths, and at the moment done is about to be claimed a hint reminds the agent that a green gate is necessary but not sufficient — exercise the artifact, then relay the receipt and wait.",
        hints: ["gate-prove-it-works", "gate-relay-receipt"],
        plain: {
          title: "The proof-of-completion summary",
          what:
            "When `discern done` passes on clean, saved work that is ahead of the main shared version, it produces a review summary: the task, the exact saved point it checked (called `HEAD` by the version-history system), the saved changes, the changed files, the check results, and the quality rules still held. `discern accept` may reuse that proof while the same saved point and working copy stand; saving a later change makes it invalid. The same passing run also reminds the coding agent to try the real result along the routes the change touched before offering the summary.",
          why:
            "The person in charge reviews a verified claim that names the exact work it vouches for.",
          agent:
            "A change saved while the check was running can never earn the proof: Discern pins the exact state before the first piece of work runs and checks it again at the moment of stamping. When a passing run cannot record a proof because unsaved edits remain, the refusal names the blocking files — and at the moment of claiming done, an advice note reminds the coding agent that a passing check is necessary but not sufficient: try the real result, pass on the proof, and wait.",
        },
      },
      {
        id: "unchanged-tree-rerun",
        title: "A rerun on an unchanged tree is attested",
        what:
          "Each completed `discern done` records the exact tree it judged — `HEAD` plus a fingerprint of everything uncommitted — and the verdict, in the worktree's Git admin area. Asked to run again on that identical tree, `done` refuses read-only before the fix stage can touch a file; `discern done --confirmed` re-runs it as an attested, recorded probe. Any change to the tree runs as normal, and so does `--dry-run`.",
        why:
          "An unchanged tree expects an unchanged verdict. A green rerun pays full gate time for a receipt `discern status` already shows; a red one retried until it passes teaches that red is negotiable.",
        agent:
          "The refusal names the verdict that already stands and both recoveries: change the tree, or attest the probe. A confirmed rerun lands in the logbook as a flag the patterns reader watches, so a flaky suite surfaces as evidence — the flake detector names the tree whose verdict flipped, and routine `--confirmed` is itself a finding.",
        hints: ["done-unchanged-tree-red", "done-unchanged-tree-green"],
        plain: {
          title: "A repeat check on unchanged work is a recorded choice",
          what:
            "Each completed `discern done` records what it judged — the saved point plus a fingerprint of every unsaved edit — and the verdict, in the version history's housekeeping area. Asked to run again on identical work, `done` refuses without touching anything; `discern done --confirmed` runs it anyway as a recorded probe. Any change to the files runs as normal, and so does `--dry-run`.",
          why:
            "Unchanged work should expect an unchanged verdict. Repeating a pass spends the full running time on an answer `discern status` already shows, and retrying a failure until it passes teaches that a failure is negotiable.",
          agent:
            "The refusal names the verdict that already stands and both ways forward: change the files, or confirm the probe. A confirmed re-run lands in the activity record, where the recurring-behaviour report watches for it — so an unreliable trial suite surfaces as evidence, the detector names the exact work whose verdict flipped, and routine use of `--confirmed` is itself a finding.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "standards",
    title: "Standards",
    what:
      "Named quality numbers held under `[standards]`: each declares a metric, a direction, and a limit, and every gate run verifies no limit loosened versus the trunk.",
    why:
      "Quality limits move in one direction. A floor may only rise, a ceiling may only fall, and a branch that loosens either fails the gate.",
    plain: {
      title: "Quality rules",
      what:
        "Named quality measurements the project keeps under `[standards]`: each states what to measure, which direction is better, and the current limit. Every run of the final check makes sure no limit has become weaker than the main shared version's.",
      why:
        "Quality limits move in one direction only. A minimum may only rise, a maximum may only fall, and a change that weakens either one fails.",
    },
    surfaces: ["verb:standards", "config:standards"],
    children: [
      {
        id: "standards-direction",
        title: "Floors and ceilings",
        what:
          '`direction = "up"` holds a floor (coverage may only rise); `direction = "down"` holds a ceiling (a size budget may only fall). The comparison is against the trunk\'s limit, so loosening on a branch fails the gate.',
        plain: {
          title: "Minimums and maximums",
          what:
            '`direction = "up"` protects a minimum, which may only rise — such as the share of the program covered by trials. `direction = "down"` protects a maximum, which may only fall — such as a size allowance. The comparison uses the main shared version\'s limit, so a task cannot weaken a rule.',
        },
      },
      {
        id: "standards-metric-protocol",
        title: "One-line metric protocol",
        what:
          "A standard's `run` is any command that prints `DISCERN_METRIC <name> <number>`; the last such line wins. Any tool in any language can feed a standard.",
        why:
          "No plugin API to write. If it can print a line, it can be a standard.",
        plain: {
          title: "A one-line way to report a measurement",
          what:
            "A quality rule's `run` is any instruction that prints `DISCERN_METRIC <name> <number>`; when more than one such line appears, the last one counts. A measuring tool written in any programming language can feed a rule.",
          why:
            "There is no special add-on to build. If a tool can print one line, it can feed a quality rule.",
        },
      },
      {
        id: "standards-rates",
        title: "Rates, not raw counts",
        what:
          "`per` divides the metric by a second metric or by a built-in extent discern measures itself — files, lines, words, or bytes over a pathspec — and `scale` makes the rate read in human units.",
        why:
          "A number normalized to project size doesn't rise because the project grew, so the standard survives legitimate growth.",
        plain: {
          title: "Rates instead of bare totals",
          what:
            "`per` divides the measurement by a second measurement, or by a size Discern counts itself — files, lines, words, or bytes in a chosen part of the project — and `scale` presents the rate in comfortable units.",
          why:
            "A number adjusted for the project's size does not get worse merely because the project grew, so the rule survives healthy growth.",
        },
      },
      {
        id: "standards-margin",
        title: "Pin headroom",
        what:
          "`margin` is the headroom a pin leaves when tightening a limit, for metrics that drift on unrelated commits.",
        plain: {
          title: "Leaving a little breathing room",
          what:
            "`margin` is the spare room a pin leaves when tightening a limit to a newly measured value, for measurements that drift a little on unrelated changes.",
        },
      },
      {
        id: "standards-replay",
        title: "Input-keyed replay",
        what:
          "`inputs` names the paths a metric reads. When nothing under them changed since the last recorded measurement, the gate replays the recorded value instead of re-measuring.",
        why:
          "A docs-only change pays seconds for a coverage standard, and the never-loosen check still runs.",
        agent:
          "A fresh worktree inherits its measurement baseline from the trunk's receipt, so the first gate run replays what an untouched metric already proved.",
        plain: {
          title: "Reusing a measurement when nothing it reads has changed",
          what:
            "`inputs` names the files a measurement reads. When nothing under them has changed since the last recorded measurement, the check reuses the recorded value instead of measuring again.",
          why:
            "A change that only touches written guidance pays seconds for a trial-coverage rule, and the check against weakening still runs.",
          agent:
            "A fresh working copy inherits its starting measurements from the main shared version's proof-of-completion summary, so its first check reuses what unchanged work already proved.",
        },
      },
      {
        id: "standards-on-demand",
        title: "On-demand measurement",
        what:
          '`measure = "on-demand"` defers a metric too slow for every gate run to `discern standards`; the limit check itself has no off switch.',
        plain: {
          title: "Measuring only when asked",
          what:
            '`measure = "on-demand"` moves a measurement too slow for every run into `discern standards`; the check that a limit was not weakened has no off switch.',
        },
      },
      {
        id: "standards-pin",
        title: "Capturing a gain",
        what:
          "`discern standards --pin` tightens each improved limit to the value just measured and commits the change on its own, carrying the gate receipt across the pin commit. It measures once: a green check records a measurement receipt the pin replays.",
        why:
          "Tightening is mechanical and provable; a hand-edit can't tell a real gain from a quiet loosening.",
        plain: {
          title: "Saving an improvement",
          what:
            "`discern standards --pin` tightens each improved limit to the newly measured value, and saves that change on its own, carrying the proof-of-completion summary across the save. It measures once: a passing check records the measurement, and the pin reuses it.",
          why:
            "Tightening is mechanical and provable; a hand-edited number cannot show whether it was a real gain or a quiet weakening.",
        },
      },
      {
        id: "standards-escalation",
        title: "Breach escalation",
        what:
          "A limit the work itself breached is an owner decision: the built-in guidance has agents cut waste they added and report genuine growth, rather than move a limit to pass.",
        plain: {
          title: "When the work itself crosses a limit",
          what:
            "A limit the work itself crossed is a decision for the person in charge: Discern's built-in guidance tells coding agents to remove waste they added and to report genuine growth, rather than to move a limit so the work passes.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "worktrees",
    title: "Isolated worktrees",
    what:
      "Every task gets its own linked git worktree: a separate checkout and branch forked from the trunk, provisioned with its own port, env values, and declared resources.",
    why:
      "Parallel agents cannot collide — with each other, or with the human's own checkout.",
    agent:
      "The agent works in a checkout it never has to reason about: identity, port, env values, and resources were provisioned before its session started, and nothing a parallel agent does can reach them.",
    plain: {
      title: "Separate working copies",
      what:
        "Every task gets its own separate, linked copy of the project with its own line of saved changes. The copy starts from the main shared version and comes prepared with its own network number, private settings, and any supporting services the project declares.",
      why:
        "Several coding agents can work at the same time without interfering with one another — or with the copy the person in charge is using.",
      agent:
        "The coding agent works in a copy it never has to think about: its identity, network number, private settings, and supporting services all stood ready before the session began. Nothing another coding agent does can reach them.",
    },
    surfaces: ["config:worktree", "config:repository"],
    children: [
      {
        id: "start",
        title: "Start",
        what:
          "`discern start` creates the worktree from the main checkout — forked from the trunk regardless of the branch the checkout sits on — and returns its path. `--name` is normalized to a branch-safe slug; omit it for a random codename.",
        agent:
          "Whatever the agent passes as a name is reduced to something branch-safe, and a name that reduces to nothing falls back to a codename with a note saying so — a cosmetic field can never fail the start. The derived port is re-rolled against live siblings before a collision is accepted.",
        plain: {
          title: "Start",
          what:
            "`discern start` makes the separate working copy from the main project copy — always starting from the main shared version, whatever the main copy happens to be showing — and returns the new copy's location. `--name` turns a supplied name into a safe one; leave it out for a random nickname.",
          agent:
            "Discern reduces whatever name the coding agent supplies to something safe, and a name that reduces to nothing falls back to a nickname with a note saying so — a purely cosmetic field can never stop the start. Discern compares the suggested network number with the other live copies and re-chooses it rather than accepting a clash.",
        },
        surfaces: ["verb:start"],
      },
      {
        id: "update",
        title: "Update",
        what:
          "`discern update` merges the latest trunk into the branch and refreshes the generated files in one idempotent step, reporting what changed beneath the branch and which of your files the incoming trunk also touched.",
        why:
          "Staying current is one verb, and the overlap report names the files to re-check after a clean merge.",
        agent:
          "Idempotent means callable: the agent runs the verb instead of checking git state first, and a refusal returns one structured result naming the next step.",
        plain: {
          title: "Update",
          what:
            "`discern update` brings the latest main shared work into the task's copy and remakes the automatically made files, in one step that is safe to repeat. It reports what changed underneath the task, and which of the task's own files the incoming work also touched.",
          why:
            "Staying current is one instruction, and the overlap report names the files worth re-checking even after a clean join.",
          agent:
            "Safe to repeat means callable: the coding agent runs the instruction instead of examining the project's state first, and a refusal returns one clear result naming the next step.",
        },
        surfaces: ["verb:update"],
      },
      {
        id: "accept",
        title: "Accept",
        what:
          "`discern accept` lands the reviewed branch on the trunk as a clean fast-forward, validates the exact tree it lands (fast-pathed by the receipt), tears down resources, removes the worktree and branch, refreshes the landing checkout, and runs `[repository].ensure` and `smoke` after landing. Authority comes from a fresh `--confirmed` conversation attestation or a machine-checked standing or effort grant.",
        why:
          "Landing is atomic and consented: the tree the owner reviewed is the tree that lands, and nothing of the task is left behind.",
        agent:
          "What lands is the sha the gate validated; a branch that moved during a slow run is refused rather than landed untested. The trunk fast-forwards before any teardown begins, so losing a race with another landing leaves the worktree and its resources intact for the standard recovery — update, then done, then accept again.",
        plain: {
          title: "Accept",
          what:
            "`discern accept` adds the reviewed task to the main shared version as a clean forward step, checks the exact work it is adding (quickly, when the proof-of-completion summary still stands), closes the task's supporting services, removes the separate copy and its task name, refreshes the main copy, and runs `[repository].ensure` and `smoke` afterwards. Permission comes from a fresh `--confirmed` confirmation in the conversation, or from a permission the person in charge recorded in advance.",
          why:
            "The move is agreed and all-or-nothing: the work the person in charge reviewed is the work that becomes shared, and nothing of the task is left behind.",
          agent:
            "What joins the main shared version is the exact saved point the final check approved; Discern refuses a task that moved during a slow run rather than adding it untested. The main shared version moves forward before any cleanup begins, so losing a race with another task leaves this copy and its services untouched — the ordinary recovery is update, then the full check, then accept again.",
        },
        surfaces: ["verb:accept"],
      },
      {
        id: "compose-below-trunk",
        title: "Composing unlanded work",
        what:
          "`start` and `update` both take a `from` ref, so work can build on another branch's unlanded changes; only `accept` lands on the trunk.",
        why:
          "Stacked efforts stay possible without ever making the trunk a merge scratchpad.",
        plain: {
          title: "Building on unfinished work",
          what:
            "`start` and `update` both accept a `from` choice, so one task can build on another task's not-yet-shared changes; only `accept` changes the main shared version.",
          why:
            "Related tasks can be stacked without the main shared copy ever becoming a mixing bowl for unfinished changes.",
        },
      },
      {
        id: "worktree-identity",
        title: "Deterministic identity",
        what:
          "Each worktree carries stable derived values — id, branch, site name, database name, and a dev-server port hashed from its id — readable with `discern identity` and exported into its env files.",
        why:
          "Concurrent dev servers and test databases never fight over a name.",
        plain: {
          title: "A stable identity",
          what:
            "Every separate working copy carries stable values worked out from its identity — its own identifying name, task name, site name, information-store name, and a preview-server network number — readable with `discern identity` and placed into its private settings files.",
          why:
            "Preview servers and trial information stores running at the same time never fight over a name.",
        },
        surfaces: ["verb:identity"],
      },
      {
        id: "worktree-resources",
        title: "Per-worktree resources",
        what:
          "`[worktree.resources.<name>]` declares an external thing a worktree needs in isolation — a database, an emulator, a container — as a `create` and a `destroy` command with optional `ensure`, `required`, `retries`, and `gc`. Resources are created top-to-bottom, destroyed bottom-to-top, and expanded with `@…@` identity tokens.",
        why:
          "Isolation extends past the checkout to everything the checkout touches.",
        agent:
          "A transient failure from an external manager retries with backoff, and an empty command is a clean no-op.",
        plain: {
          title: "Separate supporting services for each copy",
          what:
            "`[worktree.resources.<name>]` declares an outside thing a working copy needs for itself — an information store, a stand-in device, an isolated packaged app — as a `create` instruction and a `destroy` instruction, with the optional choices `ensure`, `required`, `retries`, and `gc`. Discern creates services top to bottom, removes them bottom to top, and fills placeholders written `@…@` with the copy's real identity.",
          why:
            "Separation covers not just the project's files but everything those files use.",
          agent:
            "Discern tries a short-lived failure from an outside manager again with growing pauses, and an empty instruction is a clean do-nothing.",
        },
      },
      {
        id: "crash-safe-provisioning",
        title: "Crash-safe provisioning",
        what:
          "The lifecycle writes its intent before acting on it: a resource's ledger entry — its destroy command already fully expanded — lands before `create` runs, a ready marker records the moment the non-repeatable phases finished, and a failure after the checkout was added discards the partial worktree rather than leaving it registered.",
        why:
          "A crash leaves a working worktree or a reclaimable one, and a plausible-looking half-checkout is discarded at the moment of failure.",
        agent:
          "A re-fired create hook skips the phases that already ran instead of aborting on their already-exists errors, and the fleet flags a checkout whose creation never completed as broken rather than listing it as workable.",
        hints: ["status-fleet-member-broken"],
        plain: {
          title: "Safe setup even when interrupted",
          what:
            "The setup writes down what it intends before acting on it: it saves a service's cleanup entry, with its removal instruction already filled in, before `create` runs; a ready marker records the moment the one-time steps finished; and a failure after registering the copy discards the partial copy rather than leaving it looking usable.",
          why:
            "A crash leaves either a working copy or one that can be reclaimed — and a convincing-looking half-copy is thrown away at the moment of failure.",
          agent:
            "A setup step fired again skips the parts that already ran instead of failing because they already exist, and the overview marks a copy whose creation never finished as broken rather than offering it as workable.",
        },
      },
      {
        id: "worktree-prune",
        title: "Orphan reclamation",
        what:
          "`discern worktree prune` finds resources whose worktree vanished without a clean teardown and runs their `destroy` commands — the GC safety net behind the lifecycle verbs (`setup`, `ensure`, `teardown`, `drop`).",
        why: "A crashed session can't leak databases forever.",
        agent:
          "Destroy commands are frozen at create time with identity fully expanded, because after the worktree is gone there is nothing left to re-derive — and a frozen command still carrying an unresolved token is refused rather than half-run. Before each destroy, the ledger entry is re-validated against disk, so parallel agents cannot reclaim each other's live resources.",
        plain: {
          title: "Cleaning up leftovers",
          what:
            "`discern worktree prune` finds supporting services whose working copy vanished without an orderly cleanup and runs their saved removal instructions — the safety net behind the routine `setup`, `ensure`, `teardown`, and `drop` steps.",
          why:
            "A crashed session cannot leave forgotten information stores running forever.",
          agent:
            "Discern completes and freezes removal instructions at the moment it creates a service, because once the copy has vanished, nothing remains to work the details out from — and it refuses a frozen instruction still carrying an unfilled placeholder rather than half-run it. Before each removal, it compares the saved entry with the computer's real state, so a coding agent can never reclaim live services that belong to a different task.",
        },
        surfaces: ["verb:worktree"],
      },
      {
        id: "env-inheritance",
        title: "Env inheritance",
        what:
          "`[worktree].inherit_env` copies named values from the main checkout's env files into a new worktree's — the secrets a fresh checkout needs that version control doesn't carry.",
        plain: {
          title: "Passing private values into a new copy",
          what:
            "`[worktree].inherit_env` copies named values from the main copy's private settings files into a new working copy's — the secrets a fresh copy needs that stay out of the version history.",
        },
      },
      {
        id: "ignored-drift",
        title: "Ignored-file drift",
        what:
          "The lifecycle fingerprints ignored files at setup and reports top-level ignored paths that changed before the worktree is removed.",
        why:
          "Work hiding outside version control gets named before teardown deletes it.",
        plain: {
          title: "Noticing changes outside the saved history",
          what:
            "At setup, Discern fingerprints the files the version history ignores, and before removing the working copy it reports the top-level ignored places that changed.",
          why:
            "Work hiding outside the version history gets named before cleanup deletes it.",
        },
      },
      {
        id: "fleet",
        title: "The fleet view",
        what:
          "From the main checkout, `discern status` reports a row per worktree: branch, clean state, ahead/behind, last activity, a broken flag for a checkout whose creation never completed, and cross-worktree changed-file collisions.",
        why:
          "The human steers parallel work without visiting each checkout, and two efforts touching the same file get named before either lands.",
        agent:
          "Each row is another effort in flight, and a hint states the ownership rule: a clean tree is not a free workspace. The broken flag marks a checkout whose creation never completed, so the agent is told which siblings are workable at a glance.",
        hints: ["fleet-ownership"],
        plain: {
          title: "The overview of all work in progress",
          what:
            "From the main project copy, `discern status` shows one row for every separate working copy: its task, whether its files are clean, whether it is ahead of or behind the main shared version, its latest activity, a broken mark for a copy whose creation never finished, and any files two tasks have both changed.",
          why:
            "The person in charge steers several pieces of work without opening each copy, and two tasks touching the same file are named before either becomes shared.",
          agent:
            "Each row is someone else's work in progress, and an advice note states the ownership rule: a clean copy is not a free workspace. The broken mark shows which copy never finished setting up, so workable and unworkable neighbours are clear at a glance.",
        },
      },
      {
        id: "await",
        title: "Awaiting a fleet condition",
        what:
          "`discern await` blocks until a sibling branch is green, a branch has work whose latest observed tip has landed on the trunk, or the trunk has moved. Git refs, landed receipt notes, and gate receipts decide the condition; logbook appends only wake it, with a polling fallback. Omit the timeout to use the configured client's longest reliable call. If that call ends first, a 15-character repository-local continuation handle preserves the branch transition or trunk baseline across the next call.",
        why:
          "A dependent agent spends one bounded call waiting for the work it builds on instead of guessing poll intervals or asking a human.",
        agent:
          "Dependent work can wait without choosing a poll interval, filling the chat with unchanged status, or asking the user to relay readiness. When the condition holds, the result identifies the correct worktree action.",
        plain: {
          title: "Waiting for a condition across the tasks",
          what:
            "`discern await` waits until a chosen thing becomes true: a sibling task has passed the final check, a task's work has joined the main shared version, or the main shared version has moved. It uses the longest reliable request the connected tool supports. If that request must return first, a continuation keeps the original question intact so a change between requests is not missed.",
          why:
            "A coding agent that depends on another task makes one bounded request instead of guessing how often to check or asking a person.",
          agent:
            "Waiting for another task no longer requires the person in charge to keep checking it. The conversation stays free of repeated status messages, and the result identifies the next step when the dependency is ready.",
        },
        surfaces: ["verb:await"],
        hints: ["await-not-yet"],
      },
      {
        id: "desk",
        title: "The desk",
        what:
          "Bare `discern` opens the operator's desk: an interactive surface over the fleet that starts tasks, runs Project Scripts from the main checkout or a selected worktree, opens configured coding-agent CLIs found on `PATH`, links to the online manual, pre-authorizes one effort to land once green, and offers each worktree its valid next actions, owning the child sessions it launches.",
        why:
          "The human's day-to-day surface is one screen, and every action on it is one keypress.",
        plain: {
          title: "The desk",
          what:
            "Running `discern` on its own opens the desk for the person in charge: one interactive view over all the work in progress. It starts tasks, runs the project's own tools from the main or a separate working copy, opens the online manual, opens any of the recognised coding-agent programs found in the computer's standard installed-program list (called `PATH`), records permission in advance for one task to join the main shared version once it passes, and offers each working copy its valid next actions — staying responsible for the sessions it starts.",
          why:
            "The person in charge works from one screen, and every action on it is one keypress.",
        },
        surfaces: ["verb:desk"],
        children: [
          {
            id: "tips",
            title: "Desk tips",
            what:
              "The desk puts one tip directly below the root status per session. Its `Tip` label is yellow and the teaching text stays secondary. Selection is deterministic over a curriculum registry (new-in-release entries first, then contextual relevance, then authored order, then rotation), the line wraps at the terminal width, and each shown id is recorded in the logbook.",
            why:
              "Capability reaches the person at the desk one calm line at a time, and the shown ids accumulate in the logbook from day one, ready for adoption reading.",
            plain: {
              title: "Desk tips",
              what:
                "The desk puts one short tip below the project status for each session. The choice follows fixed rules, the line wraps to fit the window, and the tip's name goes into the activity record.",
              why:
                "The person in charge learns one ability at a time without reading a manual, and the record can later show whether the teaching was used.",
            },
          },
        ],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "guidance",
    title: "Agent guidance",
    what:
      "One authored guidance source compiles into every configured agent's instruction file. discern's built-in operating guidance is always prepended, so your sources extend it rather than replace it.",
    why:
      "Author once; every agent — cloud agents included — reads the same page.",
    plain: {
      title: "Instructions for coding agents",
      what:
        "Discern compiles one project-written set of instructions into the instruction file of every chosen coding agent. Its own built-in operating advice always comes first, so the project's words add to it rather than replace it.",
      why:
        "Write the instructions once, and every coding agent (including one working on another computer) reads the same page.",
    },
    surfaces: ["config:guidance", "verb:refresh"],
    children: [
      {
        id: "guidance-compile",
        title: "Author once, compile everywhere",
        what:
          "`discern refresh` compiles the built-in guidance plus `[guidance].sources` into one generated file per provider. The outputs are committed, and a generated file that drifts from its sources fails the gate.",
        why:
          "A bare clone hands every agent current instructions, and stale copies cannot survive review.",
        plain: {
          title: "Write once, produce every copy",
          what:
            "`discern refresh` compiles Discern's built-in advice plus `[guidance].sources` into one finished instruction file per kind of coding agent. The finished files live with the project, and a finished file that no longer matches its sources fails the final check.",
          why:
            "A freshly copied project hands every coding agent current instructions, and a stale copy cannot survive review.",
        },
      },
      {
        id: "guidance-conditionals",
        title: "Config-aware guidance",
        what:
          "The built-in guidance is templated on the project's config, so a project without worktree resources or standards never ships agents instructions about them.",
        why: "Agents read guidance about the project they're in, nothing else.",
        plain: {
          title: "Instructions that match this project",
          what:
            "The project's own settings shape the built-in advice, so a project with no separate supporting services or quality rules never hands its coding agents instructions about them.",
          why:
            "Coding agents read guidance about the project in front of them, nothing else.",
        },
      },
      {
        id: "providers",
        title: "Agent providers",
        what: `The native providers — ${
          codeList([...AGENT_NAMES], "and")
        } — each get their integration files from one typed registry: guidance target, settings seed, hooks, and MCP wiring.`,
        why:
          "Supporting an agent is registry data; parity guards keep every provider surface complete.",
        plain: {
          title: "Kinds of coding agent",
          what: `The directly supported kinds — ${
            codeList([...AGENT_NAMES], "and")
          } — each get their connection files from one master list: where the instructions go, which starter settings and automatic actions they need, and how they connect to Discern.`,
          why:
            "Supporting a coding agent is a matter of filling in one master list, and automatic checks keep every kind's support complete.",
        },
        children: [
          {
            id: "provider-claude-code",
            title: "Claude Code",
            what:
              "Reads the generated `CLAUDE.md`; discern seeds `.claude/settings.json` with session-start and worktree lifecycle hooks and wires the MCP server into `.mcp.json`.",
            plain: {
              title: "Claude Code",
              what:
                "Reads the made-for-it `CLAUDE.md`; Discern seeds `.claude/settings.json` with session-start and working-copy actions and adds its connection to `.mcp.json`.",
            },
            surfaces: ["agent:claude_code"],
          },
          {
            id: "provider-codex",
            title: "Codex",
            what:
              "Reads `AGENTS.md` — the canonical agent file the other AGENTS.md-native providers reuse; discern co-manages its config, hooks, rules, and worktree environment files.",
            plain: {
              title: "Codex",
              what:
                "Reads `AGENTS.md` — the main instruction file, reused by the other coding agents that understand that name; Discern shares responsibility for its settings, automatic actions, rules, and per-copy private-value files.",
            },
            surfaces: ["agent:codex"],
          },
          {
            id: "provider-gemini",
            title: "Gemini",
            what:
              "Reads the generated `GEMINI.md`, with settings and MCP wiring under `.gemini/`.",
            plain: {
              title: "Gemini",
              what:
                "Reads the made-for-it `GEMINI.md`, with its settings and Discern connection kept under `.gemini/`.",
            },
            surfaces: ["agent:gemini"],
          },
          {
            id: "provider-cursor",
            title: "Cursor",
            what:
              "Reuses the canonical `AGENTS.md` and gets its own hooks and MCP wiring under `.cursor/`.",
            plain: {
              title: "Cursor",
              what:
                "Reuses the main `AGENTS.md` and keeps its own automatic actions and Discern connection under `.cursor/`.",
            },
            surfaces: ["agent:cursor"],
          },
          {
            id: "provider-copilot",
            title: "GitHub Copilot",
            what:
              "Reuses the canonical `AGENTS.md`, with hook wiring under `.github/`, sharing the co-owned `.mcp.json` through one writer.",
            plain: {
              title: "GitHub Copilot",
              what:
                "Reuses the main `AGENTS.md`, keeps its automatic actions under `.github/`, and shares the jointly owned `.mcp.json` connection file through one agreed writer.",
            },
            surfaces: ["agent:copilot"],
          },
        ],
      },
      {
        id: "session-hooks",
        title: "Session and lifecycle hooks",
        what:
          "Provider hooks run `discern worktree ensure` at session start — idempotent re-readiness plus a reminder while setup is unfinished — and hand worktree create/remove events to the binary, with no `jq` or shell parsing in between.",
        why:
          "A session starts ready, or says what's missing, before any work begins.",
        plain: {
          title: "Automatic actions when a session starts",
          what:
            "A supported coding agent runs `discern worktree ensure` when its session begins — safely making the working copy ready again, with a reminder while setup remains unfinished — and hands working-copy creation and removal events straight to Discern, with no extra translator and no home-made command text between them.",
          why:
            "A session starts ready, or says what is missing, before any work begins.",
        },
      },
      {
        id: "agent-autodetect",
        title: "Detection at setup",
        what:
          "A fresh install resolves its default agent set from each provider's declared installation evidence: terminal launchers, editor commands, and conventional application locations. The desk still offers only terminal agents it can launch from `PATH`, while a separate identity catalogue recognizes the agent driving a session as advisory logbook evidence.",
        plain: {
          title: "Finding the installed coding agents at setup",
          what:
            "A fresh installation chooses its starting set of coding agents from each kind's declared signs of being installed: command-window launchers, editor commands, and the usual application locations. The desk still offers only the coding agents it can start from the computer's standard installed-program list (called `PATH`), and a separate recognition list identifies the coding agent driving a session — used only as non-binding evidence in the activity record.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "skills",
    title: "Skills",
    what:
      "Focused, reusable task playbooks shipped as `SKILL.md` files: discern's bundled built-ins plus any the project authors under `[skills].dir`, materialized into each agent's skills directory.",
    why:
      "Procedures that took a hard session to learn become one file every future session inherits.",
    plain: {
      title: "Reusable how-to guides",
      what:
        "Focused, reusable instructions for recurring kinds of task, saved as `SKILL.md` files. The set is Discern's bundled built-in guides plus any the project writes under `[skills].dir`, placed where each coding agent expects to find them.",
      why:
        "A method that took one hard session to learn becomes a single file every future session inherits.",
    },
    surfaces: ["config:skills", "verb:skills"],
    children: [
      {
        id: "skills-materialization",
        title: "Materialization",
        what:
          "`discern refresh` materializes the effective set into each agent's gitignored skills directory: built-ins copied, authored skills symlinked so edits stay live. An authored skill overrides a built-in of the same name, `[skills].exclude` drops named ones, and `discern skills eject <name>` copies a built-in into the project to customize.",
        why:
          "The skill set is declared once and identical for every agent, and customizing never forks the distribution.",
        plain: {
          title: "Putting the guides in place",
          what:
            "`discern refresh` places the effective set into each coding agent's own guides folder, which the version history leaves out: it copies the built-in guides and links project-written guides to their originals, so edits take effect immediately. A project guide with the same name replaces a built-in one, `[skills].exclude` drops named ones, and `discern skills eject <name>` copies a built-in into the project for customising.",
          why:
            "The set is declared once and identical for every coding agent, and customising never creates a second diverging copy of the collection.",
        },
      },
      {
        id: "skills-curation",
        title: "A curated bundled set",
        what:
          "The built-ins ship the practice discern teaches — prefixed `discern-`, listed by `discern skills list`, and held to a bar: a bundled skill must teach what a frontier model wouldn't do unprompted. A playbook whose trigger is a conversational ask ships as a skill; a discipline whose trigger is a verb moment ships as a registered hint fired at that moment.",
        why:
          "Every description spends context in every session, so the set stays small and each member earns its keep.",
        plain: {
          title: "A small, carefully chosen built-in set",
          what:
            "The built-in guides teach Discern's preferred way of working — their names begin with `discern-`, `discern skills list` shows them, and each must clear a bar: it must teach something even the most capable coding agent would not reliably do unasked. A method prompted by an ordinary request ships as a guide; advice tied to a particular Discern instruction ships as a registered advice note shown at that moment.",
          why:
            "Every guide's description takes up part of every session's limited reading space, so the collection stays small and each member earns its keep.",
        },
        children: [
          {
            id: "skill-cure-a-bug",
            title: "Cure a bug",
            what:
              "One bug discipline with three routed modes: prove the cause (reproduce the failure and falsify hypotheses before any fix), cure the class (fix every instance and leave a permanent guard), and audit existing guards for coverage that guards less than it appears to.",
            plain: {
              title: "Cure a bug",
              what:
                "One careful bug method with three routes: prove the cause (make the failure happen and rule out wrong explanations before changing anything), cure the family (fix every occurrence and leave a permanent protection), and inspect existing protections for cover that protects less than it appears to.",
            },
            surfaces: ["skill:discern-cure-a-bug"],
          },
          {
            id: "skill-set-the-standard",
            title: "Set the standard",
            what:
              "Put a quality metric behind a standard — a defendable number, wired into `[standards]`, limited at today's value — with a drive-to-zero mode that outlaws a legacy pattern: a detector, a falling ceiling, then a permanent gate rule at zero.",
            plain: {
              title: "Set the standard",
              what:
                "Put a quality measurement behind a standing rule — a defendable number, added under `[standards]`, with its first limit set at today's value — including a drive-to-zero route that outlaws an unwanted old pattern: a detector, a steadily falling maximum, then a permanent rule at zero.",
            },
            surfaces: ["skill:discern-set-the-standard"],
          },
          {
            id: "skill-clear-the-decks",
            title: "Clear the decks",
            what:
              "Sweep out the clutter agent-built codebases accumulate — duplicated helpers, dead code from abandoned approaches, one-caller indirection, leftover scaffolding — every cut proven safe, landed as small behavior-preserving commits, with the entropy capped by a standard.",
            plain: {
              title: "Clear the decks",
              what:
                "Sweep out the clutter that projects built by coding agents tend to collect — small helpers written twice, dead code from abandoned approaches, layers used from only one place, leftover starter material — every removal proved safe and saved as a small behaviour-preserving step, with a quality rule capping the mess afterwards.",
            },
            surfaces: ["skill:discern-clear-the-decks"],
          },
          {
            id: "skill-delegate-work",
            title: "Delegate work",
            what:
              "Turn the work under discussion into complete, self-contained prompts for fresh agents in their own worktrees — one handoff, a parallel fan-out, or staged briefs — then review what lands adversarially.",
            plain: {
              title: "Delegate work",
              what:
                "Turn the work under discussion into complete, self-contained briefs for fresh coding agents in their own separate working copies — one hand-off, several at once, or staged briefs — then review what comes back with a sceptical eye.",
            },
            surfaces: ["skill:discern-delegate-work"],
          },
          {
            id: "skill-document-subsystem",
            title: "Document a subsystem",
            what:
              "Write or refresh one subsystem's subtree of the map from the real code, following the documenter brief that `discern setup` seeds under the map's `_internal/` scaffolding.",
            plain: {
              title: "Document a part of the project",
              what:
                "Write or refresh one part's section of the project guide from the real code, following the documenter brief that `discern setup` places in the guide's `_internal/` starter area.",
            },
            surfaces: ["skill:discern-document-subsystem"],
          },
          {
            id: "skill-teach-the-project",
            title: "Teach the project",
            what:
              "Route a session's lesson into the project's own surfaces — a guidance line, an authored skill, a project script, a doc, or a decision record — so every future session inherits it.",
            plain: {
              title: "Teach the project",
              what:
                "Save a lesson from the current session in the right lasting place — a line of instruction text, a project-written how-to guide, a project-specific instruction, a page of the project guide, or a decision record — so every future session inherits it.",
            },
            surfaces: ["skill:discern-teach-the-project"],
          },
          {
            id: "skill-write-adr",
            title: "Write an ADR",
            what:
              "Guide recording a significant decision — context, decision, consequences, alternatives — from the canonical template and format guide every install carries.",
            plain: {
              title: "Write a decision record",
              what:
                "Help record an important choice — the situation, the decision, its consequences, and the other options considered — using the standard example and writing guide included with every installation.",
            },
            surfaces: ["skill:discern-write-adr"],
          },
          {
            id: "skill-write-it-once",
            title: "Write it once",
            what:
              "The practices discern builds itself with, as a stack-neutral survey plus two deep procedures: one authority per shared fact with bound consumers, guards that enroll future members, declared universes for broad rules, planned effects with convergent reruns, comment discipline — and the ties recorded in a canonical-sets page in the project's map.",
            plain: {
              title: "Write it once",
              what:
                "The practices Discern builds itself with, explained for any kind of project: one authoritative home for every shared fact, protections that automatically cover future additions, declared lists of what a broad rule applies to, changes planned before they run and safe to run again, restraint with code comments — and the connections recorded on one page of the project guide.",
            },
            surfaces: ["skill:discern-write-it-once"],
          },
        ],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "map",
    title: "The map",
    what:
      "The agent-maintained documentation tree at `[map].dir`: agents write it and keep it current under the gate; humans read it as documentation and as an audit of what their agents understand.",
    why:
      "Documentation stops being the thing nobody updates: staleness fails the gate, and reading the map shows the owner what the agents believe.",
    plain: {
      title: "The project guide",
      what:
        "The project's written guide, kept at `[map].dir` and maintained by coding agents: they write it and keep it current under the final quality check, and people read it both as documentation and as a way to inspect what their coding agents understand.",
      why:
        "Written guidance stops being the thing nobody updates: an out-of-date guide fails the check, and reading it shows the person in charge what the coding agents believe.",
    },
    surfaces: ["config:map", "verb:map"],
    children: [
      {
        id: "map-browser",
        title: "The map browser",
        what:
          "`discern map` lists, searches, and renders the tree in the terminal — frontmatter search aliases included — and `--export` writes a public, full, or selected projection to one file. Naming a configured scope instead exports the map pages its paths list, in their declared order.",
        plain: {
          title: "Reading and searching the guide",
          what:
            "`discern map` lists, searches, and displays the guide's pages in the typed-command window, including the alternative search names stored at the top of each page. `--export` writes the public pages, everything, a chosen selection, or the pages a named area of the project lists — in its listed order — into one file.",
        },
        surfaces: ["verb:map"],
      },
      {
        id: "discovery-funnel",
        title: "The discovery funnel",
        what:
          "Agent document discovery runs regions, then search, then canonical targets: compiled guidance lists each top-level region by exact target, `search` takes a query in task language, and every result returns a snippet plus a target that feeds back into the same tool. Search returns at most 5 ranked documents, and query values are never written to the logbook.",
        why:
          "Documentation growth never churns the tracked agent files and never spends context before a page is needed.",
        agent:
          "Discovery starts from names already in the agent's instructions and ends one call later on the full page — no index download, no slug guessing.",
        plain: {
          title: "Finding the right page",
          what:
            "A coding agent narrows in three steps: named regions, then a search, then the exact page. The compiled instructions list every top-level region by its exact destination, `search` accepts the ordinary words of the task at hand, and every result returns a short sample plus a destination that feeds straight back into the same tool. At most five pages come back, best match first, and search words are never written to the activity record.",
          why:
            "As the guide grows, the saved instruction files never churn, and no reading space is spent on a page before it is needed.",
          agent:
            "Discovery starts from names already in the coding agent's instructions and ends one request later on the full page — no index to download, no page-name guessing.",
        },
      },
      {
        id: "docs-integrity",
        title: "The docs integrity preflight",
        what:
          "Every `discern done` validates the map's substance before the jobs run: intra-map links and heading anchors against the shared renderer, fenced `discern` examples against the live verb and flag registry (Project Scripts included), frontmatter blocks against the readers' shape rules, published pages against the `_internal`/`_private` audience boundary, and skill citations against the effective skill set.",
        why:
          "A rename breaks the docs loudly, in the same change, instead of quietly a month later — and an excluded skill cannot stay recommended by live prose.",
        agent:
          "A red `map_integrity` stage lists every finding as file:line with its rule and remedy — one edit loop clears it.",
        plain: {
          title: "Checking that the guide still works",
          what:
            "Every `discern done` examines the guide's substance before the work runs. It checks that links between pages and to their sections resolve, and that examples containing `discern` match the real list of instructions and choices (the project's own instructions included). It also checks that the small details at the top of each page follow their agreed shape, that published pages respect the rule of who may read `_internal` and `_private` material, and that mentions of how-to guides match the set now in force.",
          why:
            "A renamed thing breaks the written guidance loudly, in the same change, instead of quietly a month later — and a withdrawn how-to guide cannot stay recommended by live text.",
          agent:
            "A failed guide check lists every finding as a file and line with its rule and its remedy — one editing pass clears it.",
        },
      },
      {
        id: "map-freshness",
        title: "File-linked freshness",
        what:
          "Map freshness ships as file-linked facts — which source files a page covers and when they moved — rather than verdicts.",
        plain: {
          title: "Facts about freshness, tied to real files",
          what:
            "The guide's freshness ships as checkable facts — which project files each page covers, and when those files last moved — rather than as a verdict pretending to judge the writing.",
        },
      },
      {
        id: "publish-predicate",
        title: "Publication control",
        what:
          "`publish: false` in a page's frontmatter withholds it from every published surface, and underscore-prefixed trees (`_internal`, `_private`) never ship; decision records are the one semi-public exception, served by `discern docs --adr` and the site's history pages.",
        why: "One predicate answers what ships, everywhere it could ship.",
        plain: {
          title: "Control over what ships",
          what:
            "Writing `publish: false` at the top of a page keeps it off every published surface, and folders whose names begin with an underscore (`_internal`, `_private`) never ship. Decision records are a partly public exception, served by `discern docs --adr` and the site's history pages.",
          why: "One rule answers what ships, everywhere it could ship.",
        },
      },
      {
        id: "adr-discipline",
        title: "Decision records",
        what:
          "Architecture Decision Records live under `_adr/`, numbered continuously, with a canonical template and format guide scaffolded into every install. `discern refresh` maintains the marker-delimited record index in the ADR README, and the gate refuses one that drifts from the files. Citations take one strippable form, removed at render time on human surfaces.",
        why:
          "The why behind the code survives the sessions that wrote it — findable from one self-maintaining index, without leaking internal numbering into shipped prose.",
        plain: {
          title: "Decision records",
          what:
            "Records of significant design choices live under `_adr/`, numbered in one unbroken sequence, with a standard example and writing guide placed in every installation. `discern refresh` maintains the index in their `README`, the final check refuses an index that no longer matches the files, and references to the records take one removable form, hidden when an ordinary reader views the page.",
          why:
            "The reasons behind the code outlive the sessions that decided them — findable from one self-maintaining index, without internal numbering leaking into published writing.",
        },
      },
      {
        id: "bundled-docs",
        title: "discern's own manual",
        what:
          "The binary carries its own public documentation: `discern docs` browses it offline in any install, over the same renderer the map uses, and customer binaries carry only the public projection.",
        why:
          "Every install can answer how discern works with no network and no wiki.",
        plain: {
          title: "Discern's own handbook",
          what:
            "The program carries its own public documentation: `discern docs` browses it offline in any installation, using the same page display as the project guide, and copies supplied to customers carry only the public material.",
          why:
            "Every installation can explain how Discern works with no internet connection and no separate website.",
        },
        surfaces: ["verb:docs"],
      },
      {
        id: "cli-help",
        title: "CLI help",
        what:
          "`discern help` prints the root command reference, while `discern help <command>` prints that command's reference — the same information as `discern --help` and `discern <command> --help`.",
        why:
          "Help always means command syntax; the product manual has its own `docs` name.",
        plain: {
          title: "Typed-command help",
          what:
            "`discern help` shows the complete list of instructions, and `discern help <command>` shows one instruction's reference — the same information as `discern --help` and `discern <command> --help`.",
          why:
            "Help always means how to type an instruction; the handbook has its own name, `docs`.",
        },
        surfaces: ["verb:help"],
      },
      {
        id: "glossary-canon",
        title: "The vocabulary canon",
        what:
          "The glossary compiles from a term registry: one definition per term, every term a search alias, retired synonyms policed out of live prose, and closed-set members enrolled the moment they exist.",
        why: "Every page and every agent uses one name per concept.",
        plain: {
          title: "One agreed vocabulary",
          what:
            "The glossary comes from a master list of terms: one meaning per term, every term usable as a search word, retired wordings kept out of current writing, and every member of a fixed list added the moment it exists.",
          why: "Every page and every coding agent uses one name per idea.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "insight",
    title: "Advisories and the logbook",
    what:
      "Read-only surfaces that point at work and never block: the gate and standards are the only enforcement, and everything else reports.",
    why:
      "Signal without new failure modes — an advisory can be wrong without stopping anyone.",
    agent:
      "Advice arrives inside results the agent is already reading, as a hint array on the envelope it already parses — there is no second channel to poll and no document to remember to re-open.",
    plain: {
      title: "Helpful advice and the activity record",
      what:
        "Read-only surfaces that point at useful work and never block it: the final quality check and the quality rules are the only enforcement, and everything else reports.",
      why:
        "Signal without new ways to fail — a piece of advice can be wrong without stopping anyone.",
      agent:
        "Advice arrives inside results the coding agent is already reading, as a list of advice notes on the same result package. There is no second channel to watch and no document to remember to re-open.",
    },
    surfaces: ["config:coupling"],
    children: [
      {
        id: "status",
        title: "Status",
        what:
          "`discern status` projects one read-only result as a width-capped human dashboard or a structured JSON and MCP envelope. The main-checkout dashboard leads with the fleet's derived attention states, complete identities, receipt evidence, activity, divergence, collisions, and concrete next steps.",
        why:
          "Orientation is one cheap read-only call, for agents and humans alike.",
        agent:
          "The structured result retains location, gate inputs, resources, configured standards, generated-file currency, and advisory hints. Every readable fleet worktree carries its complete receipt check and landing authority, while the honored-only receipt fields remain compatible.",
        hints: [
          "status-start-on-trunk",
          "status-start-off-trunk",
          "silent-worktree-divergence",
          "status-ready-for-review",
        ],
        plain: {
          title: "Current state",
          what:
            "`discern status` presents one read-only answer as a responsive dashboard for people or structured data for tools. From the main copy, the dashboard leads with the work that has failed, is running, has fallen behind, overlaps another change, or is ready for review.",
          why:
            "Getting one's bearings is one cheap, read-only call, for coding agents and people alike.",
          agent:
            "The structured answer keeps the project location, checks, supporting services, quality rules, generated-file state, and advice. Each readable separate working copy in the overview says whether its proof is honored, missing, stale, blocked by local changes, unavailable, or unreadable.",
        },
        surfaces: ["verb:status"],
      },
      {
        id: "impact",
        title: "Impact",
        what:
          "`discern impact` names the scopes the current change wakes, and `--has <scope>` answers it as an exit code for scripts.",
        plain: {
          title: "What the current change touches",
          what:
            "`discern impact` names the areas of the project the current change wakes up, and `--has <scope>` answers yes or no in a form other instructions can use.",
        },
        surfaces: ["verb:impact"],
      },
      {
        id: "coupling",
        title: "Coupling",
        what:
          "`discern coupling` mines the repo's own commit history for files that change together: what your change set is missing, one file's habitual partners, or the shared history of two files. Zero-config and self-calibrating; `[coupling].in_gate` surfaces it as gate-tail hints.",
        why:
          "The sibling file everyone forgets gets named while the change is still open.",
        plain: {
          title: "Files that usually change together",
          what:
            "`discern coupling` reads the project's own saved history for files that habitually change together: what the current change is missing, one file's usual partners, or the shared history of two files. It needs no setup and adjusts itself to the project, and `[coupling].in_gate` surfaces its findings as advice notes at the end of the final check.",
          why:
            "The companion file everyone forgets is named while the change is still open.",
        },
        surfaces: ["verb:coupling"],
      },
      {
        id: "improvement",
        title: "Improvement",
        what:
          "`discern improvement` ranks the highest-value next action from deterministic rules and subjective reviews across the gate, setup, guidance, map, worktrees, standards, and skills, scoring project health 0–100.",
        why:
          "A coach with a ranked list, for the question 'what should we fix next?'.",
        plain: {
          title: "The best next improvement",
          what:
            "`discern improvement` ranks the most valuable next action, using firm rules plus informed reviews across the final check, the setup, the instructions for coding agents, the project guide, the separate working copies, the quality rules, and the how-to guides — scoring the project's health from 0 to 100.",
          why:
            "A coach with a ranked list, for the question 'what should we fix next?'.",
        },
        surfaces: ["verb:improvement"],
      },
      {
        id: "logbook",
        title: "The logbook",
        what:
          "With recording on and a readable `discern.toml`, each CLI verb run and each MCP invocation resolved to that project adds one metadata-only line under `.git`, shared by the repository's worktrees. Lines carry timings, outcomes, names, and fired hint IDs. They contain no code or command output. The logbook never leaves the machine (a gate test keeps its code free of network paths), rotates by age, and `[project].logbook = false` stops all writes.",
        why:
          "The practice becomes measurable evidence without anything leaving the building.",
        agent:
          "The identity of the agent driving a session is recorded as advisory evidence, so the practice can be read per agent — with no code, no output, and no query values in the record.",
        plain: {
          title: "The activity record",
          what:
            "With recording on and readable settings, every instruction run — typed, or made through the coding-agent connection — adds one line of basic facts to a private record kept in the version history's housekeeping area (the `.git` folder) and shared by the project's working copies. Lines carry timings, outcomes, names, and which advice notes appeared — never code, and never printed output. The record never leaves the machine (a test in the final check keeps its code free of any internet route), old lines age out, and `[project].logbook = false` stops all writes.",
          why:
            "The way of working becomes measurable evidence, without anything leaving the building.",
          agent:
            "Discern records the kind of coding agent driving a session as non-binding evidence, so the record can show working habits per kind of coding agent — with no code, no output, and no search words in the record.",
        },
      },
      {
        id: "patterns",
        title: "Patterns",
        what:
          "`discern patterns` mines the logbook with a registry of named detectors across behavior loops, gate fit, funnel flow, and standard trajectories — done-thrash, refusal loops, ignored update advice, abandoned worktrees, duration creep, and their kin — each finding stated in plain counts with a next step. Below a detector's evidence threshold it reports insufficient evidence, and `patterns reset` deletes the recorded history. `patterns --stats` reads the same logbook for what went well — changes accepted and their scale, green-gate streaks, start-to-accept cycle times, standards trends, attributed agent cohorts — and reports practice stats in the same plain counts, for the owner to share; nothing is scored or compared.",
        why:
          "Recurring workflow failures surface as counted findings instead of anecdotes.",
        plain: {
          title: "Recurring patterns in the practice",
          what:
            "`discern patterns` reads the activity record with a master list of named detectors — repeated checks without progress, refusal loops, ignored update advice, abandoned working copies, runs that keep getting slower, and their kin — each finding stated in plain counts with a next step. Below a detector's evidence bar it says there is not enough evidence, and `patterns reset` deletes the recorded history. `patterns --stats` reads the same activity record for what went well — finished changes moved onto the main shared version, unbroken runs of passing final checks, task turnaround times, tightened quality rules and how their numbers moved, and which coding agents drove the runs — and answers in the same plain counts, for the person in charge to share; nothing is scored or compared.",
          why:
            "Recurring workflow failures surface as counted findings instead of anecdotes.",
        },
        surfaces: ["verb:patterns"],
      },
      {
        id: "hints",
        title: "Registered hints",
        what:
          "Every advisory hint the engine can emit is an entry in one typed registry — id, category, audience, family, and a parameterized template — with a generated inventory page, command references validated against the live verb registry, and fired ids recorded in the logbook.",
        why:
          "Advice stays current mechanically, and whether advice gets followed is measurable.",
        agent:
          "A hint is delivered inside the result of the verb that made it relevant, at the moment it applies. `audience` marks entries whose instruction only an agent can execute: every envelope carries them, and interactive human rendering alone drops them, through one registry projection every renderer uses.",
        plain: {
          title: "Registered advice notes",
          what:
            "Every piece of advice Discern can give is an entry in one master list — an identifying name, a subject, an intended reader, a family, and a fill-in-the-blanks message — with an inventory page made from the list, instruction names inside the advice matched to the real instruction list, and the names of advice notes that appeared recorded in the activity record.",
          why:
            "Advice stays current mechanically, and whether advice gets followed is measurable.",
          agent:
            "An advice note arrives inside the result of the instruction that made it relevant, at the moment it applies. The intended-reader field marks advice only a coding agent can act on: every result package carries it, and only the interactive person-facing view drops it, through one shared rule every display uses.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "install",
    title: "Install and lifecycle",
    what:
      "One binary installs, verifies, upgrades, and removes the system, and a project's entire footprint is one root file: `discern.toml`.",
    why:
      "Adopting discern is one file in the diff, and leaving is one command — the exit is as clean as the entrance.",
    plain: {
      title: "Setting up, updating, and removing Discern",
      what:
        "One program installs, verifies, updates, and removes the system, and a project's entire tracked footprint is one root file: `discern.toml`.",
      why:
        "Adopting Discern is one file in the change, and leaving is one instruction — the exit is as clean as the entrance.",
    },
    surfaces: ["config:meta", "config:project"],
    children: [
      {
        id: "setup",
        title: "Agent-driven setup",
        what:
          "`discern setup` is a staged, consent-driven handshake the coding agent completes: it verifies write authority, detects the default branch (offering git init on a bare directory), sniffs the repo to fill `[jobs]`, proves the project runs in a worktree, and lands the finished configuration with `setup accept`. Each step serves ready-to-relay messages, a fresh scaffold requires a `--confirmed` attestation, and installing a dependency is its own consent point.",
        why:
          "Tell your agent to run setup and answer its questions; the configuration engine is the agent, and every irreversible step asks first.",
        agent:
          "The read-only verify step surfaces the failure-prone facts — the repo's real default branch, whether a git commit identity resolves — before anything mutates. A missing `--confirmed` is answered by re-serving the full consent moment with the command to continue, and completion is recorded last, after the proofs, so a resumed session never inherits a false done.",
        hints: ["setup-run-coach"],
        plain: {
          title: "Setup led by the coding agent",
          what:
            "`discern setup` is a staged, permission-first conversation the coding agent completes: it proves it may make changes, finds the project's main shared line of work (offering to begin version history in a bare folder), examines the project to fill in `[jobs]`, proves the project runs in a separate working copy, and completes the settings with `setup accept`. Every step serves a message ready to pass to the person in charge, starting from nothing requires `--confirmed`, and installing any extra software is its own permission moment.",
          why:
            "Tell your coding assistant to run setup and answer its questions; the assistant supplies the judgment, and every hard-to-undo step asks first.",
          agent:
            "The read-only verify step surfaces the failure-prone facts — the project's real main shared line, whether a name for saved changes resolves — before anything changes. Discern answers a missing `--confirmed` by re-serving the full permission moment with the instruction to continue, and it records completion last, after the proofs, so a resumed session never inherits a false done.",
        },
        surfaces: ["verb:setup"],
      },
      {
        id: "setup-observability",
        title: "Observable incompleteness",
        what:
          "An unfinished setup is a machine-readable state, reported by `discern status` and the session-start hook until the handshake completes.",
        why:
          "A half-installed project says so itself; nobody discovers it mid-task.",
        agent:
          "Progress is derived from the tree itself (which scaffolded files still carry their markers, which jobs are wired), so a second session resumes where the first stopped and cannot fake completion by deleting a marker. An abandoned setup branch routes to resume rather than to a fresh scaffold that would overwrite the first session's work.",
        plain: {
          title: "Clearly showing unfinished setup",
          what:
            "An unfinished setup is a state tools can read, reported by `discern status` and by the automatic session-start action until the conversation completes.",
          why:
            "A half-installed project says so itself; nobody discovers it in the middle of other work.",
          agent:
            "Discern works progress out from the project itself — which starter files still carry their fill-this-in marks, which pieces of work already connect — so a second session resumes where the first stopped, and deleting a mark cannot fake completion. Discern routes an abandoned setup back to resuming it, never to a fresh start that would overwrite the first session's work.",
        },
      },
      {
        id: "relay-messages",
        title: "Ready-to-relay messages",
        what:
          "At the consent and completion moments, setup serves the message to forward to the human — first-person prose, with each fact that must survive as its own list item — rather than instructions about a message. The identical text is carried in the human render and in the JSON envelope's guidance field.",
        why:
          "A courier that only pastes still delivers a complete, warm, accurate conversation.",
        agent:
          "The agent relays instead of composing: authored prose survives final-answer compression, where stage directions would be squeezed into a checklist.",
        plain: {
          title: "Messages ready to pass on",
          what:
            "At the permission and completion moments, setup serves the exact message to forward to the person — first-person writing, with each fact that must survive as its own list item — rather than instructions about a message. The identical words travel in the person-facing view and in the tool-readable result.",
          why:
            "A courier that only pastes still delivers a complete, warm, accurate conversation.",
          agent:
            "The coding agent passes the message on instead of composing its own: authored writing survives the squeeze of a final answer, where behind-the-scenes directions would flatten into a bare checklist.",
        },
      },
      {
        id: "consent-attestations",
        title: "Landing authority is proved per invocation",
        what:
          "Scaffolding a fresh install requires a `--confirmed` conversation attestation. Landing accepts either that fresh attestation or a machine-checked grant recorded on the trunk or at the desk; absent both, it refuses read-only. Every successful landing records which source authorized it.",
        why:
          "Consent comes from evidence at the landing boundary, never from an agent's memory of an earlier conversation.",
        agent:
          "The same resolver feeds `start`, `status`, green `done`, and the acceptance boundary. An uncovered agent is routed back into the conversation; a covered one proceeds only after discern verifies the recorded grant against the exact changed paths.",
        plain: {
          title: "Fresh proof of permission, every time",
          what:
            "Starting a fresh installation requires `--confirmed` in that same instruction. Adding finished work to the main shared version accepts either that fresh confirmation, or a permission the person in charge recorded earlier — on the main shared version, or at the desk; with neither, Discern refuses and changes nothing. Every successful addition records which permission allowed it.",
          why:
            "Permission comes from evidence at the moment of action, never from a coding agent's memory of an earlier conversation.",
          agent:
            "The same permission check feeds `start`, `status`, a passing `done`, and the moment work joins the main shared version. Discern sends a coding agent without cover back to the conversation; one with recorded cover proceeds only after Discern verifies that cover on the exact files that changed.",
        },
        surfaces: ["config:acceptance"],
      },
      {
        id: "doctor",
        title: "Doctor",
        what:
          "`discern doctor` verifies the installation without changing it — config validity, schema version, job commands on `PATH`, git and shell prerequisites, guidance sources, skills, worktree automation, resource commands — and prints each verb's execution model: which steps are the project's and which are discern's.",
        why:
          "Facts before judgments, and a misconfigured install names its own fix.",
        agent:
          "Every remedy points at a command that can help from the state the reader is in: an older config is sent to `discern upgrade`, and a config newer than the binary is not, because upgrade refuses that state — the fix it names is a newer binary.",
        plain: {
          title: "Health check",
          what:
            "`discern doctor` verifies the installation without changing it — that the settings make sense and match the expected format version, that the declared instructions exist in the computer's standard installed-program list (called `PATH`), that the version-history and command-running basics are present, along with the instruction text, the how-to guides, the working-copy automation, and the supporting-service instructions — and explains, for every instruction, which steps are the project's and which are Discern's.",
          why:
            "Facts before judgments, and a misconfigured installation names its own fix.",
          agent:
            "Every remedy points at an instruction that can help from the state the reader is in: older settings go to `discern upgrade`, and settings newer than the program do not — because upgrade refuses that state, the fix it names is a newer Discern.",
        },
        surfaces: ["verb:doctor"],
      },
      {
        id: "upgrade",
        title: "Upgrade and migrations",
        what:
          "`discern upgrade` brings the project in line with the binary that runs it: versioned, idempotent config migrations that validate before the schema version is stamped, refusal of configs newer than the binary, and reconciliation of the fixed `discern.toml` scaffold and the marked `.gitignore` block. `--check` previews without touching anything.",
        why:
          "Updating never means re-reading a changelog; the binary carries its own path forward and refuses to guess.",
        agent:
          "The schema version is stamped only after migrations validate and reconciliation succeeds, so an interrupted upgrade leaves a coherent, re-runnable install rather than one marked current over a half-migrated config.",
        plain: {
          title: "Updating between versions",
          what:
            "`discern upgrade` brings the project in line with the program that runs it: numbered, repeat-safe settings updates that Discern checks before recording the new format version, refusal of settings written by a newer Discern, and repair of the fixed parts of `discern.toml` and the marked Discern section of `.gitignore`. `--check` previews without touching anything.",
          why:
            "Updating never means re-reading release notes; the program carries its own path forward and refuses to guess.",
          agent:
            "Discern records the format version only after the updates check out and the shared parts agree, so an interrupted update leaves a coherent, re-runnable installation — never one marked current over half-changed settings.",
        },
        surfaces: ["verb:upgrade"],
      },
      {
        id: "ownership-buckets",
        title: "File ownership",
        what:
          "Every file discern touches is project-owned (seeded once, then left alone), shared (discern maintains only its declared entries or regions), or generated (rebuilt from reviewable sources). These are edit and overwrite rules, not copyright claims. Upgrade honors the buckets, and the removal set derives from the same registry.",
        why: "What an upgrade may touch is a lookup, never a judgment call.",
        plain: {
          title: "Who owns each file",
          what:
            "Every file Discern touches is in one of three groups: project-owned (created once, then left alone), shared (Discern maintains only its listed entries or marked parts), or made automatically from text you can review. The groups say who may edit or replace a file, not who holds copyright. Updates honour the groups, and what removal covers comes from the same list.",
          why: "What an update may touch is a lookup, never a judgment call.",
        },
      },
      {
        id: "placement-consent",
        title: "Placement is consent",
        what:
          "discern and its agents write only where placement licenses it: a file at its namespace default carries an implicit write-license, a config key you pointed elsewhere is an explicit one, and any other path is untouchable — enforced by an architectural test.",
        plain: {
          title: "Putting a file somewhere is permission to write there",
          what:
            "Discern and its coding agents write only where the chosen placement gives permission: a file at its usual named location carries built-in permission, a setting you pointed elsewhere gives explicit permission for that place, and every other location is off-limits — enforced by a broad design test.",
        },
        surfaces: ["config:scripts"],
      },
      {
        id: "uninstall",
        title: "Uninstall",
        what:
          "`discern uninstall` removes the wiring discern laid down — derived from the ownership registry — and keeps `discern.toml`, your guidance, and the map.",
        why: "Leaving costs one command and loses no authored work.",
        plain: {
          title: "Removal",
          what:
            "`discern uninstall` removes the wiring Discern laid down — worked out from the same ownership list — and keeps `discern.toml`, your instruction text, and the project guide.",
          why: "Leaving costs one instruction and loses no authored work.",
        },
        surfaces: ["verb:uninstall"],
      },
      {
        id: "presets",
        title: "Presets",
        what:
          "`discern preset <name>` applies a reusable overlay: scaffolded files plus config fills that never overwrite a value the project already sets, each key disclosed as filled or kept.",
        plain: {
          title: "Reusable starter collections",
          what:
            "`discern preset <name>` applies a reusable overlay: starter files plus settings fills that never overwrite a value the project already sets, with every setting disclosed as filled or kept.",
        },
        surfaces: ["verb:preset"],
      },
      {
        id: "config-command",
        title: "Config without a parser",
        what:
          "`discern config` edits `discern.toml` while preserving comments and layout — `set`, `set-job`, `set-scope`, `set-standard` — and reads it back raw with `get`, `array`, `has`, `subsections`, and `keys`, so scripts and agents never parse TOML themselves.",
        agent:
          "Every edit re-validates the whole rendered file before touching disk, a renamed key is refused with its successor named, and value types come from the schema rather than the value's spelling — a scripted edit cannot leave behind a config the next command rejects.",
        plain: {
          title: "Changing settings without interpreting the file",
          what:
            "`discern config` edits `discern.toml` while keeping its comments and layout — `set`, `set-job`, `set-scope`, and `set-standard` — and reads it back with `get`, `array`, `has`, `subsections`, and `keys`, so other instructions and coding agents never have to work out the file's special writing rules themselves.",
          agent:
            "Every edit checks the complete resulting file before touching the disk. Discern refuses a renamed setting and names its successor, and a value's kind comes from the agreed settings guide rather than from how the value happens to look — an automated edit cannot leave behind settings the next instruction rejects.",
        },
        surfaces: ["verb:config"],
      },
      {
        id: "licenses",
        title: "Licenses and notices",
        what:
          "`discern licenses` prints discern's software license, the Apache-2.0 license for discern-authored project payloads, its notice, and bundled third-party notices. The first-party texts derive from one legal-document registry; the third-party set derives from the compile graph.",
        plain: {
          title: "Licenses and notices",
          what:
            "`discern licenses` prints Discern's own terms, the separate Apache-2.0 terms for material it writes into a project, and the required notices for other people's work carried inside Discern. The program builds those answers from its real legal files and included components instead of a hand-kept list.",
        },
        surfaces: ["verb:licenses"],
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "interfaces",
    title: "Interfaces and contracts",
    what:
      "Every verb speaks human and machine: one result envelope, a first-class MCP surface, and published schemas for both config and results.",
    why:
      "Agents integrate against typed contracts, and the human output is a rendering of the same object the machine gets.",
    plain: {
      title: "Ways to use Discern and consistent results",
      what:
        "Every instruction speaks to people and to tools alike. There is one consistent result package, a first-class connection for coding agents, and a published exact description of both the settings and the results.",
      why:
        "Coding agents build on precise, agreed shapes, and what a person sees is a readable rendering of the same result the machine gets.",
    },
    surfaces: ["verb:mcp"],
    children: [
      {
        id: "result-envelope",
        title: "One result envelope",
        what:
          "A verb returns one structured result — status, message, steps, data, hints, diagnostics — and `--json` serializes it; the human renderer draws from the same envelope, so no surface carries prose another lacks.",
        agent:
          "Behavioral guidance is carried as one verbatim prose string in the JSON lane rather than decomposed into fields, because field-decomposed instructions weaken under summarization — the agent receives the same message a human reader would, at full strength.",
        plain: {
          title: "One consistent result package",
          what:
            "Every instruction returns one structured result — whether it succeeded, a message, suggested steps, useful facts, advice notes, and failure details — and `--json` writes it in a widely understood tool-readable form. The person-facing view draws from the same package, so no way of using Discern carries wording another lacks.",
          agent:
            "Advice about how to behave travels as one complete passage of writing in the tool-readable result, not split across little boxes — split-up instructions weaken when a result is later summarised, and one passage reaches the coding agent at the same full strength a person would read.",
        },
      },
      {
        id: "plan-apply",
        title: "Plan and apply",
        what:
          "Every effectful verb computes a pure, read-only plan a thin executor applies, which is what makes `--dry-run` a faithful preview on `done`, `standards`, `tidy`, `start`, `update`, `accept`, `setup`, `upgrade`, `uninstall`, and the worktree lifecycle.",
        why: "Any mutating operation can be rehearsed before it happens.",
        plain: {
          title: "Work out the change, then carry it out",
          what:
            "Every instruction that changes something first works out a complete read-only plan, which a small separate part then carries out — and that is what makes `--dry-run` a faithful rehearsal for `done`, `standards`, `tidy`, `start`, `update`, `accept`, `setup`, `upgrade`, `uninstall`, and the working-copy setup and cleanup steps.",
          why: "Any change can be rehearsed before it happens.",
        },
      },
      {
        id: "idempotent-verbs",
        title: "Idempotent by contract",
        what:
          "The convergent verbs — `discern update`, `discern refresh`, `discern worktree ensure` — re-run safely, perform their own precondition checks, and refuse with the next step named when one fails.",
        why: "Calling the verb replaces pre-checking it.",
        agent:
          "The cheapest correct move is to call the verb: a refusal costs one structured result naming the way forward, where a hand-rolled precondition check costs tool calls and can still be wrong.",
        plain: {
          title: "Safe to repeat, by agreement",
          what:
            "The instructions whose job is to bring things to a ready state — `discern update`, `discern refresh`, and `discern worktree ensure` — run again safely, check their own starting conditions, and when one is not met, refuse while naming the next step.",
          why: "Running the instruction replaces checking for it by hand.",
          agent:
            "The cheapest correct move is to run it: a refusal costs one clear result naming the way forward, where a home-made advance check costs extra steps and can still be wrong.",
        },
      },
      {
        id: "mcp-surface",
        title: "The MCP server",
        what:
          "`discern mcp` serves the verbs as tools over stdio on the official SDK — self-describing schemas derived from the typed result contracts, strict argument validation, a tracked working root that `discern_start` re-aims at the new worktree, and read-only resources for status, impact, config, docs, and the map.",
        why:
          "MCP-native agents call structured tools; the CLI and the tools can never disagree because they share one core per verb.",
        agent:
          "After `discern_start`, a hint walks the agent through re-rooting its own file operations while the tools re-aim themselves, and undeclared arguments are refused — a mistyped parameter fails loudly instead of being dropped.",
        hints: ["start-mcp-re-root"],
        plain: {
          title: "The standard connection for coding agents",
          what:
            "`discern mcp` offers the instructions as tools over the standard coding-agent connection (called `MCP`), built on the official kit: self-describing input shapes drawn from the same agreed result descriptions, strict checking of every input, a remembered working location that `discern_start` re-aims at the new copy, and read-only access to the current state, the affected areas, the settings, the handbook, and the project guide.",
          why:
            "Coding agents built for this connection call well-described tools — and the typed commands and the tools can never disagree, because each instruction has one shared core.",
          agent:
            "After `discern_start`, an advice note walks the coding agent through re-aiming its own file work while the tools re-aim themselves, and Discern refuses an undeclared input — a mistyped setting fails loudly instead of vanishing without a trace.",
        },
      },
      {
        id: "published-contracts",
        title: "Published contracts",
        what:
          "The config schema and every verb's result shape publish as generated JSON Schemas and TypeScript declarations, regenerated by the build and drift-guarded in the gate.",
        plain: {
          title: "Published exact descriptions",
          what:
            "Discern publishes the settings format and every instruction's result shape as exact, automatically made descriptions in two standard tool-readable forms (called JSON Schema and TypeScript declarations), remade by the normal preparation step, with the final check catching any drift.",
        },
      },
      {
        id: "project-scripts",
        title: "Project scripts",
        what:
          "Any executable dropped under `[scripts].dir` becomes `discern scripts <name>`: language-agnostic, `DISCERN_*` environment exported, arguments forwarded unchanged, and an optional `# desc:` line for the listing. Scripts occupy their own namespace, so built-in verb names stay legal.",
        why:
          "The project's own tooling gets discern's context — root, config, worktree identity — without wrapper boilerplate.",
        plain: {
          title: "The project's own instructions",
          what:
            "Any runnable file placed under `[scripts].dir` becomes `discern scripts <name>`: written in any language, handed the `DISCERN_*` facts about the project, with extra choices passed through unchanged and an optional `# desc:` line for the listing. These names live in their own clearly marked area, so built-in instruction names stay legal.",
          why:
            "The project's own tooling gets Discern's knowledge — the project's location, settings, and working-copy identity — without repeated setup code in every file.",
        },
        surfaces: ["verb:scripts"],
      },
      {
        id: "forgiving-cli",
        title: "A forgiving command line",
        what:
          "Retired command names refuse with their successor named, synonyms suggest the canonical verb, grammatical variants normalize, and unknown commands get a did-you-mean built from the live verb set.",
        why: "Vocabulary changes never strand a user or an agent mid-habit.",
        agent:
          "A synonym table maps the words other tools taught — init, sync, land — to the canonical verb, a project script is only ever suggested in its namespaced form, and the verb is resolved flag-first before any routing decision, so flag placement cannot smuggle an invocation past a guardrail.",
        plain: {
          title: "A forgiving way to type instructions",
          what:
            "A retired instruction name refuses with its successor named, familiar words from other tools suggest the official instruction, Discern corrects small grammatical differences, and an unknown word gets a did-you-mean built from the live instruction list.",
          why:
            "Changes in vocabulary never strand a person or a coding agent mid-habit.",
          agent:
            "A table connects the words other tools taught — init, sync, land — to the official instruction, a project-specific instruction is only ever suggested with its `scripts` prefix, and Discern works out the intended instruction before any routing decision, so the position of a choice cannot sneak an instruction past a safety rule.",
        },
      },
      {
        id: "output-discipline",
        title: "Terminal discipline",
        what:
          "`--no-color` and `NO_COLOR` are honored, non-TTY output drops decoration, `--plain` suppresses prompts and paging for CI, and the pager respects `PAGER`.",
        plain: {
          title: "Clean behaviour in the command window",
          what:
            "Discern honours `--no-color` and the `NO_COLOR` setting, output sent to another tool drops decoration, `--plain` switches off questions and page-by-page viewing for unattended runs, and the page-by-page viewer respects the computer's `PAGER` choice.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "foundations",
    title: "Foundations",
    what:
      "The properties the rest of the product stands on — each one a design commitment, not a configuration.",
    why:
      "The guarantees hold everywhere because they are structural: no optional subsystem, no partial install, no second copy of anything.",
    plain: {
      title: "Basic promises",
      what:
        "The properties the rest of the product stands on — each one a permanent design choice.",
      why:
        "The promises hold everywhere because Discern builds them in: no optional major part, no half-installation, no second copy of anything.",
    },
    children: [
      {
        id: "agent-is-user",
        kind: "benefit",
        title: "The agent is the user",
        what:
          "Humans install discern and review its receipts; nearly every other surface — the verbs, the tools, the hints, the compiled guidance — is read by an agent, and the interaction design aims at that reader.",
        why:
          "The happy path is the one agents take by default, whether or not they notice the steering.",
        agent:
          "Messages arrive at the moment they apply, refusals carry the next command, and wasted work is designed out — none of it asks for the agent's attention in order to work.",
        plain: {
          title: "The coding agent is the main user",
          what:
            "People install Discern and review its proof-of-completion summaries; a coding agent reads nearly every other surface — the instructions, the tools, the advice notes, the compiled instruction text — and the design aims at that reader.",
          why:
            "Coding agents take the intended path by default, whether they notice the steering or not.",
          agent:
            "Messages arrive at the moment they apply, refusals carry the next instruction, and wasted work never enters the design — none of it asks for the coding agent's attention to work.",
        },
      },
      {
        id: "context-budget",
        kind: "benefit",
        title: "Context is a budget",
        what:
          "Result surfaces are sized for a context window: oversized diagnostics keep head and tail inline and offload the full text to a named file, search returns at most 5 ranked documents, compiled guidance lists regions rather than leaves, provisioning output appears only on failure, and logbook lines are metadata-only.",
        why:
          "An agent's context is the scarcest resource at the table, and discern spends it like money.",
        agent:
          "Bounded views with pointers to the rest: the agent reads what it needs and fetches the full text only when it chooses to.",
        plain: {
          title: "Reading space is scarce",
          what:
            "Discern sizes results for how much a coding agent can hold in mind at once: long failure output keeps its beginning and end with the full text in a named file, search returns at most five best-matching pages, compiled instructions list regions rather than every page, setup output appears only on failure, and activity-record lines carry basic facts only.",
          why:
            "A coding agent's reading space is the scarcest thing at the table, and Discern spends it like money.",
          agent:
            "Bounded views with pointers to the rest: the coding agent reads what it needs and fetches the full text only when it chooses to.",
        },
      },
      {
        id: "single-binary",
        kind: "benefit",
        title: "One self-contained binary",
        what:
          "Installer and engine are one program with no runtime dependencies; every verb runs and exits, and discern is never a runtime dependency of the project.",
        why:
          "Nothing to babysit: no daemon, no lockfile entry, no version skew between components.",
        plain: {
          title: "One complete, self-contained program",
          what:
            "The installer and the working core are one program that needs nothing else installed; every instruction runs and exits, and the finished app never needs Discern to run.",
          why:
            "Nothing to babysit: no always-on background service, no extra entry in the project's dependency list, no version mismatch between separate pieces.",
        },
      },
      {
        id: "one-file-footprint",
        kind: "benefit",
        title: "A one-file footprint",
        what:
          "A project's entire configuration is the root `discern.toml`; everything else is bundled, config-pointed, or generated output.",
        why: "Reviewing what discern does to a repo is reading one file.",
        plain: {
          title: "Only one tracked settings file",
          what:
            "A project's entire configuration is the root `discern.toml`; everything else ships inside the program, comes from a settings pointer, or regenerates automatically.",
          why: "Reviewing what Discern does to a project is reading one file.",
        },
      },
      {
        id: "stack-neutral",
        kind: "benefit",
        title: "Stack-neutral",
        what:
          "The engine ships none of the project's stack tools: the gate, scopes, standards, and resources run whatever commands the project declares, in any language. Its embedded formatter is limited to the Markdown and TOML surfaces whose convention discern defines.",
        why: "One system serves the polyglot reality instead of one ecosystem.",
        plain: {
          title: "Works with any kind of project",
          what:
            "Discern ships none of the project's own build tools: the final check, the named areas, the quality rules, and the supporting services run whatever instructions the project declares, in any language. Its built-in tidier covers only the writing and settings files whose house style Discern itself defines.",
          why:
            "One system serves the many-technology reality instead of belonging to one family.",
        },
      },
      {
        id: "no-model-inside",
        kind: "benefit",
        title: "No model inside",
        what:
          "discern contains no LLM and needs no API key. Verdicts come from the project's own commands; the agent supplies the intelligence and discern supplies the judgment infrastructure.",
        why:
          "The gate's answer is reproducible and free, however many times it runs.",
        plain: {
          title: "No AI model inside",
          what:
            "Discern contains no AI model and needs no paid access key. Verdicts come from the project's own instructions; the coding agent supplies the intelligence, and Discern supplies the judgment infrastructure.",
          why:
            "The final check's answer is reproducible and free, however many times it runs.",
        },
      },
      {
        id: "local-evidence",
        kind: "benefit",
        title: "Evidence stays local",
        what:
          "The logbook and every advisory reader run entirely on the machine; recording is on by default because local metadata costs nothing to keep and everything to lose.",
        plain: {
          title: "Evidence stays on the computer",
          what:
            "The activity record and every advice reader run entirely on the machine; recording is on unless turned off, because local basic facts cost nothing to keep and everything to lose.",
        },
      },
      {
        id: "all-subsystems-core",
        kind: "benefit",
        title: "Every subsystem is core",
        what:
          "There are no feature toggles: every verb attaches unconditionally, and configuration tunes behavior rather than enabling it.",
        why:
          "Every install is the same product, so guidance, docs, and habits transfer between projects verbatim.",
        plain: {
          title: "Every major part is always present",
          what:
            "There are no on-off switches for whole features: every instruction is always attached, and settings tune behaviour rather than enabling it.",
          why:
            "Every installation is the same product, so guidance, written explanations, and habits carry between projects unchanged.",
        },
      },
      {
        id: "forcing-functions",
        kind: "benefit",
        title: "Forcing-function parity",
        what:
          "Every canonical set — verbs, tools, jobs, providers, config schema, terms, hints, features — is tied to its satellites by guards that fail the gate when a member is added without its counterparts.",
        why: "The system cannot disagree with itself and stay green.",
        plain: {
          title: "Master lists cannot disagree with their uses",
          what:
            "Checks tie every official fixed list — instructions, tools, kinds of work, kinds of coding agent, settings, terms, advice notes, features — to everything that depends on it, and they fail the final check when a member arrives without its counterparts.",
          why: "The system cannot disagree with itself and still pass.",
        },
        children: [
          {
            id: "canonical-sets",
            title: "The closed set of closed sets",
            what:
              "A meta-registry records every canonical set — its single source, its guard tests, its generated artifacts, and its enrolment in the glossary and this canon — and convention sweeps fail the gate when a guard test or generated artifact belongs to no declared set.",
            why:
              "The registry discipline is itself a checked invariant: a new closed set cannot arrive without declaring who guards it and where it is documented.",
            plain: {
              title: "The master list of master lists",
              what:
                "A higher-level list records every official fixed list — its single home, the checks that protect it, the files made from it, and its place in the glossary and in this guide — and broad sweeps fail the final check when a protecting check or an automatically made file belongs to no declared list.",
              why:
                "The list-keeping habit is itself a checked promise: a new fixed list cannot arrive without saying who guards it and where readers can find it.",
            },
          },
        ],
      },
      {
        id: "dogfooding",
        kind: "benefit",
        title: "Run on itself",
        what:
          "The discern repository develops under its own gate, worktrees, standards, map, and logbook; a regression in the engine surfaces in discern's own `discern done`.",
        why: "The vendor feels every sharp edge before a user does.",
        plain: {
          title: "Discern runs on itself",
          what:
            "The Discern project itself develops under its own final check, separate working copies, quality rules, project guide, and activity record; a fault in Discern surfaces in Discern's own `discern done`.",
          why: "The maker feels every sharp edge before a customer does.",
        },
      },
      {
        id: "interruption-safety",
        kind: "benefit",
        title: "Clean under interruption",
        what:
          "A signal stops and reaps every engine-spawned child tree — gate jobs, worktree lifecycle commands, launched scripts — temp output artifacts are reaped by age from one registry, and orphaned worktree resources are reclaimed by prune.",
        why: "A killed session leaves a machine you'd still want to work on.",
        agent:
          "Job groups are detached so a kill reaches grandchildren, a reference-counted signal watcher re-raises with conventional status once children are reaped, and pipe drains give up after a grace window — an escaped daemon holding the write end cannot stall the cancellation.",
        plain: {
          title: "Clean even when interrupted",
          what:
            "A stop request halts and clears away every piece of work Discern started — check work, working-copy setup and cleanup instructions, launched project-specific instructions — one list removes temporary output files by age, and the cleanup step reclaims supporting services left behind by vanished copies.",
          why:
            "A stopped session leaves a machine you would still want to work on.",
          agent:
            "Discern starts related work in groups so a stop reaches even the tasks that other tasks started, and one shared stop-watcher waits until the children have gone before reporting the usual stopped state. Readers of a task's output give up after a short grace period, so an escaped background service holding its output open cannot stall the cancellation.",
        },
      },
    ],
  },
];

/**
 * Closed-set members deliberately NOT claimed by any feature node, each with
 * the reason. Keys are namespaced `<set>:<member>`, exactly as `surfaces`
 * claims are. The enrolment guard holds every member to exactly one of:
 * claimed in the tree, or recorded here.
 */
export const FEATURES_DELIBERATELY_ABSENT: Readonly<Record<string, string>> = {
  "verb:triangle":
    "an Easter egg, not a feature: it draws the project mark and changes " +
    "nothing, and a feature canon that documents a surprise has spent it",
};

/**
 * General software jargon the plain register translates — vocabulary the
 * glossary does not own (it is not discern's to define) but that agents
 * editing the registry most naturally leak. Every entry is policed; a general
 * word too ambiguous to police simply is not listed, and the table grows a
 * row whenever the register needs a new translation. This is a ratchet, not a
 * promise of completeness: review still owns the register's voice.
 */
export const PLAIN_GENERAL_JARGON: Readonly<
  Record<string, { readonly plain: string; readonly match: string }>
> = {
  "agent": {
    plain: "coding agent",
    match: String.raw`\b(?<!coding )(?<!coding-)agents?\b`,
  },
  "hint": { plain: "an advice note", match: String.raw`\bhints?\b` },
  "commit": {
    plain: "a saved change",
    match: String.raw`\bcommit(?:s|ted|ting)?\b`,
  },
  "branch": {
    plain: "a task's own line of saved changes",
    match: String.raw`\bbranch(?:es|ed|ing)?\b`,
  },
  "merge": {
    plain: "joining changes together",
    match: String.raw`\bmerg(?:e|es|ed|ing)\b`,
  },
  "repository": {
    plain: "the project",
    match: String.raw`\brepo(?:s|sitor(?:y|ies))?\b`,
  },
  "lint": {
    plain: "a check for likely mistakes",
    match: String.raw`\blint(?:s|er|ers|ed|ing)?\b`,
  },
  "database": {
    plain: "an information store",
    match: String.raw`\bdatabases?\b`,
  },
  "port": { plain: "a network number", match: String.raw`\bports?\b` },
  "daemon": { plain: "a background service", match: String.raw`\bdaemons?\b` },
  "resource": {
    plain: "a supporting service",
    match: String.raw`\bresources?\b`,
  },
  "idempotent": {
    plain: "safe to repeat",
    match: String.raw`\bidempoten(?:t|ce|cy)\b`,
  },
  "frontmatter": {
    plain: "the small details at the top of a page",
    match: String.raw`\bfrontmatter\b`,
  },
  "metadata": { plain: "basic facts", match: String.raw`\bmetadata\b` },
  "parse": {
    plain: "work out a file's special writing rules",
    match: String.raw`\bpars(?:e|es|ed|ing|er|ers)\b`,
  },
  "codebase": {
    plain: "the project's files",
    match: String.raw`\bcodebases?\b`,
  },
  "glob": { plain: "a file-location pattern", match: String.raw`\bglobs?\b` },
  "token": { plain: "a placeholder", match: String.raw`\btokens?\b` },
  "flag": {
    plain: "a mark — or, on a command, a choice",
    match: String.raw`\bflags?\b`,
  },
  "CLI": {
    plain: "the typed-command window",
    match: String.raw`\bCLIs?\b`,
  },
  "config": { plain: "settings", match: String.raw`\bconfigs?\b` },
  "runtime": {
    plain: "the shared parts a program needs while it runs",
    match: String.raw`\bruntimes?\b`,
  },
  "env": { plain: "private settings", match: String.raw`\benvs?\b` },
};

/**
 * One policed plain-register matcher, derived from the glossary's plain
 * renderings and the general-jargon table.
 */
export interface PlainPolicedTerm {
  /** The glossary term or general-jargon key it enforces. */
  name: string;
  /** The compiled matcher, applied to code-span-stripped plain prose. */
  matcher: RegExp;
  /** The plain rendering to use instead. */
  plain: string;
}

/**
 * Every matcher the plain-register guard applies: translated glossary terms
 * (each entry's own `plain` rendering, default matcher derived from its
 * `matches` phrases) plus the general-jargon table. `keep` and `match: false`
 * entries police nothing.
 */
export function plainPolicedTerms(): PlainPolicedTerm[] {
  const out: PlainPolicedTerm[] = [];
  for (const entry of GLOSSARY) {
    const rendering = entry.plain;
    if ("keep" in rendering) continue;
    if (rendering.match === false) continue;
    const source = rendering.match ??
      (entry.matches ?? [entry.term])
        .map((phrase) => phrasePatternSource(phrase))
        .join("|");
    out.push({
      name: entry.term,
      matcher: new RegExp(source, "gi"),
      plain: rendering.phrase,
    });
  }
  for (const [name, entry] of Object.entries(PLAIN_GENERAL_JARGON)) {
    out.push({
      name,
      matcher: new RegExp(entry.match, "gi"),
      plain: entry.plain,
    });
  }
  return out;
}

/**
 * Prose with inline code spans blanked — names are quoted in the plain
 * register, so backticked command names, config keys, and file names are
 * always legal and never scanned.
 */
export function stripCodeSpans(text: string): string {
  return text.replace(/`[^`]*`/g, " ");
}

/** One flattened node with its position in the tree. */
export interface FlattenedFeature {
  node: FeatureNode;
  /** 0 for a pillar. */
  depth: number;
  /** The parent node's id, absent for a pillar. */
  parent?: string;
}

/** Every node in authoring order, flattened with depth and parent. */
export function allFeatureNodes(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): FlattenedFeature[] {
  const out: FlattenedFeature[] = [];
  const walk = (
    nodes: readonly FeatureNode[],
    depth: number,
    parent?: string,
  ): void => {
    for (const node of nodes) {
      out.push(
        parent === undefined ? { node, depth } : { node, depth, parent },
      );
      walk(node.children ?? [], depth + 1, node.id);
    }
  };
  walk(tree, 0);
  return out;
}

/** Every node carrying an agent-experience account, flattened. */
export function agentExperienceNodes(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): FlattenedFeature[] {
  return allFeatureNodes(tree).filter(({ node }) => node.agent !== undefined);
}

/** One cited hint id with the node citing it. */
export interface HintCitation {
  id: string;
  /** The citing node's id. */
  citedBy: string;
}

/** Every hint citation in the tree, in authoring order. */
export function allHintCitations(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): HintCitation[] {
  const out: HintCitation[] = [];
  for (const { node } of allFeatureNodes(tree)) {
    for (const id of node.hints ?? []) {
      out.push({ id, citedBy: node.id });
    }
  }
  return out;
}

/** A parsed `set:member` surface claim. */
export interface SurfaceClaim {
  set: SurfaceSet;
  member: string;
  /** The claiming node's id. */
  claimedBy: string;
}

/** Split a `set:member` key, or return undefined when it has no colon. */
export function parseSurfaceKey(
  key: string,
): { set: string; member: string } | undefined {
  const at = key.indexOf(":");
  if (at === -1) return undefined;
  return { set: key.slice(0, at), member: key.slice(at + 1) };
}

/**
 * Every surface claim in the tree, in authoring order. Malformed keys throw:
 * the registry is data the guards depend on, so a bad key fails loudly at
 * read time rather than passing unparsed.
 */
export function allSurfaceClaims(
  tree: readonly FeatureNode[] = FEATURE_CANON,
): SurfaceClaim[] {
  const claims: SurfaceClaim[] = [];
  for (const { node } of allFeatureNodes(tree)) {
    for (const key of node.surfaces ?? []) {
      const parsed = parseSurfaceKey(key);
      if (parsed === undefined) {
        throw new Error(`malformed surface key on ${node.id}: ${key}`);
      }
      if (!(SURFACE_SETS as readonly string[]).includes(parsed.set)) {
        throw new Error(`unknown surface set on ${node.id}: ${key}`);
      }
      claims.push({
        set: parsed.set as SurfaceSet,
        member: parsed.member,
        claimedBy: node.id,
      });
    }
  }
  return claims;
}

/** Where the generated canon page lives inside the map. */
export const FEATURE_CANON_PAGE_REL: string = join(
  "_internal",
  "feature-canon.md",
);

/** Where the generated plain-language canon page lives inside the map. */
export const FEATURE_CANON_PLAIN_PAGE_REL: string = join(
  "_internal",
  "feature-canon-plain.md",
);

/** The banner stamped atop the generated canon page. */
const DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the feature registry (scripts/feature_registry.ts) — do NOT edit by hand. Change a node there and regenerate. -->";

/** The banner stamped atop the generated plain-language canon page. */
const PLAIN_DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the feature registry (scripts/feature_registry.ts) — do NOT edit by hand. Change a node's `plain` account there and regenerate. -->";

/** The inline agent-experience segment: labeled account plus hint citations. */
function agentSegment(node: FeatureNode, separator: string): string {
  if (node.agent === undefined) return "";
  const cited = node.hints ?? [];
  const refs = cited.length === 0
    ? ""
    : ` (hints: ${cited.map((h) => `\`${h}\``).join(", ")})`;
  return `${separator}**Agent:** *${node.agent}*${refs}`;
}

/** Render one node as a bullet at the given indent depth. */
function renderNode(node: FeatureNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const marker = node.kind === "benefit" ? " *(benefit)*" : "";
  const why = node.why === undefined ? "" : ` *${node.why}*`;
  const lines = [
    `${indent}- **${node.title}**${marker} — ${node.what}${why}${
      agentSegment(node, " ")
    }`,
  ];
  for (const child of node.children ?? []) {
    lines.push(...renderNode(child, depth + 1));
  }
  return lines;
}

/** Every claim grouped by set, then member — shared by both canon renderers. */
function claimsBySet(): Map<SurfaceSet, Map<string, string[]>> {
  const bySet = new Map<SurfaceSet, Map<string, string[]>>();
  for (const claim of allSurfaceClaims()) {
    const members = bySet.get(claim.set) ?? new Map<string, string[]>();
    const ids = members.get(claim.member) ?? [];
    ids.push(claim.claimedBy);
    members.set(claim.member, ids);
    bySet.set(claim.set, members);
  }
  return bySet;
}

/** Render the coverage appendix: every claim, grouped by set then member. */
function renderCoverage(): string[] {
  const bySet = claimsBySet();
  const lines: string[] = ["## Closed-set coverage", ""];
  lines.push(
    "Every member of the product's closed sets, with the node that claims it. The enrolment guard (`tests/feature_canon_enrolment_test.ts`) holds this mapping complete and live.",
    "",
  );
  for (const set of SURFACE_SETS) {
    const members = bySet.get(set);
    if (members === undefined) continue;
    lines.push(`### \`${set}\``, "");
    for (const member of [...members.keys()].sort()) {
      const ids = members.get(member) ?? [];
      lines.push(`- \`${member}\` — ${ids.join(", ")}`);
    }
    lines.push("");
  }
  const absent = Object.entries(FEATURES_DELIBERATELY_ABSENT);
  lines.push("### Recorded absences", "");
  if (absent.length === 0) {
    lines.push("- None: every closed-set member is claimed by a node.", "");
  } else {
    for (const [key, reason] of absent) {
      lines.push(`- \`${key}\` — ${reason}`);
    }
    lines.push("");
  }
  return lines;
}

/** The header-line stat for agent-experience accounts, empty while none exist. */
function agentStat(): string {
  const count = agentExperienceNodes().length;
  return count === 0 ? "" : ` · ${count} agent-experience accounts`;
}

/** The agent's-eye index: which nodes carry an account, grouped by pillar. */
function renderAgentsEyeView(): string[] {
  if (agentExperienceNodes().length === 0) return [];
  const lines = [
    "## The agent's-eye view",
    "",
    "_The nodes carrying an agent-experience account — the interaction design an agent meets directly. Each account renders inline at its node, marked **Agent:**._",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    const carriers = agentExperienceNodes([pillar]).map(({ node }) =>
      node.id === pillar.id ? "the pillar itself" : node.title
    );
    if (carriers.length === 0) continue;
    lines.push(`- **${pillar.title}** — ${carriers.join(" · ")}`);
  }
  lines.push("");
  return lines;
}

/**
 * Render the maintainer canon page: the at-a-glance pillar list, the
 * agent's-eye index, the full tree at every resolution, and the closed-set
 * coverage appendix.
 */
export function renderFeatureCanonDoc(): string {
  const flattened = allFeatureNodes();
  const benefits = flattened.filter(({ node }) => node.kind === "benefit");
  const claims = allSurfaceClaims();
  const lines: string[] = [
    DOCS_BANNER,
    "",
    "# Feature canon",
    "",
    "_Every product feature and benefit, enumerated once, at every resolution. Creative, technical, and marketing work reads this canon (or `scripts/feature_registry.ts`, which it compiles from) instead of re-deriving the feature list. The same canon in plain language is [feature-canon-plain.md](feature-canon-plain.md)._",
    "",
    `${FEATURE_CANON.length} pillars · ${flattened.length} nodes · ${benefits.length} benefit statements${agentStat()} · ${claims.length} closed-set claims. Depth is resolution: the pillars are the one-breath account, the leaves are the exhaustive one.`,
    "",
    "## At a glance",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    lines.push(`- **${pillar.title}** — ${pillar.why ?? pillar.what}`);
  }
  lines.push("");
  lines.push(...renderAgentsEyeView());
  for (const pillar of FEATURE_CANON) {
    lines.push(`## ${pillar.title}`, "");
    lines.push(pillar.what, "");
    if (pillar.why !== undefined) lines.push(`*${pillar.why}*`, "");
    const pillarAgent = agentSegment(pillar, "");
    if (pillarAgent !== "") lines.push(pillarAgent, "");
    for (const child of pillar.children ?? []) {
      lines.push(...renderNode(child, 0));
    }
    lines.push("");
  }
  lines.push(...renderCoverage());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * The plain-register display name for each closed set — exhaustive over
 * {@link SURFACE_SETS}, so adding a set forces a plain name at compile time.
 */
const PLAIN_SET_TITLES: Readonly<Record<SurfaceSet, string>> = {
  verb: "Discern instruction",
  job: "Named kind of project work",
  stage: "Group in the final check",
  config: "Main settings section",
  skill: "Reusable how-to guide",
  agent: "Kind of coding agent",
};

/** The plain register calls a cited hint an advice note: `(advice note: …)`. */
function plainAdviceNoteRefs(node: FeatureNode): string {
  const cited = node.hints ?? [];
  if (cited.length === 0) return "";
  const label = cited.length === 1 ? "advice note" : "advice notes";
  return ` (${label}: ${cited.map((h) => `\`${h}\``).join(", ")})`;
}

/** The inline plain agent-experience segment, marked for the plain reader. */
function plainAgentSegment(node: FeatureNode, separator: string): string {
  if (node.plain.agent === undefined) return "";
  return `${separator}**Coding agent:** _${node.plain.agent}_${
    plainAdviceNoteRefs(node)
  }`;
}

/** Render one node's plain account as a bullet at the given indent depth. */
function renderPlainNode(node: FeatureNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const marker = node.kind === "benefit" ? " _(benefit)_" : "";
  const why = node.plain.why === undefined ? "" : ` _${node.plain.why}_`;
  const lines = [
    `${indent}- **${node.plain.title}**${marker} — ${node.plain.what}${why}${
      plainAgentSegment(node, " ")
    }`,
  ];
  for (const child of node.children ?? []) {
    lines.push(...renderPlainNode(child, depth + 1));
  }
  return lines;
}

/** The plain coverage appendix: the same mapping, under translated headings. */
function renderPlainCoverage(): string[] {
  const bySet = claimsBySet();
  const lines: string[] = ["## Coverage of every fixed list", ""];
  lines.push(
    "Every member of the product's official fixed lists appears below beside the feature entry that covers it. The automatic check in `tests/feature_canon_enrolment_test.ts` keeps this mapping complete and current.",
    "",
  );
  for (const set of SURFACE_SETS) {
    const members = bySet.get(set);
    if (members === undefined) continue;
    lines.push(`### ${PLAIN_SET_TITLES[set]} (\`${set}\`)`, "");
    for (const member of [...members.keys()].sort()) {
      const ids = members.get(member) ?? [];
      lines.push(`- \`${member}\` — ${ids.join(", ")}`);
    }
    lines.push("");
  }
  const absent = Object.entries(FEATURES_DELIBERATELY_ABSENT);
  lines.push("### Missing entries", "");
  if (absent.length === 0) {
    lines.push(
      "- None. A feature entry covers every member of every fixed list.",
      "",
    );
  } else {
    for (const [key, reason] of absent) {
      lines.push(`- \`${key}\` — ${reason}`);
    }
    lines.push("");
  }
  return lines;
}

/** The plain index of agent-experience carriers, grouped by main area. */
function renderPlainAgentsEyeView(): string[] {
  if (agentExperienceNodes().length === 0) return [];
  const lines = [
    "## What the coding agent sees",
    "",
    "_The entries below directly describe what a coding agent experiences. Each full account also appears beside the feature it belongs to, marked **Coding agent:**._",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    const carriers = agentExperienceNodes([pillar]).map(({ node }) =>
      node.id === pillar.id ? "the main area itself" : node.plain.title
    );
    if (carriers.length === 0) continue;
    lines.push(`- **${pillar.plain.title}** — ${carriers.join(" · ")}`);
  }
  lines.push("");
  return lines;
}

/**
 * Render the plain-language canon page: the same tree as
 * {@link renderFeatureCanonDoc}, retold entirely from each node's `plain`
 * account for a non-technical reader (ADR 0228). One tree, two pages: this
 * renderer owns the plain chrome — headings, the **Coding agent:** marker,
 * advice notes for hints, and translated fixed-list titles — and nothing here is
 * authored anywhere but the registry.
 */
export function renderFeatureCanonPlainDoc(): string {
  const flattened = allFeatureNodes();
  const benefits = flattened.filter(({ node }) => node.kind === "benefit");
  const claims = allSurfaceClaims();
  const agentCount = agentExperienceNodes().length;
  const agentStat = agentCount === 0
    ? ""
    : ` · ${agentCount} accounts of what the coding agent experiences`;
  const lines: string[] = [
    PLAIN_DOCS_BANNER,
    "",
    "# The complete feature guide",
    "",
    "_Every feature and benefit appears here once, in plain language, at every level of detail. Anyone writing, building, or promoting the product reads this guide (or the master list in `scripts/feature_registry.ts`, where every entry sits beside its technical twin) instead of making a new feature list. The same guide in technical language is [feature-canon.md](feature-canon.md)._",
    "",
    `${FEATURE_CANON.length} main areas · ${flattened.length} detailed entries · ${benefits.length} statements of benefit${agentStat} · ${claims.length} claims about lists with a fixed membership. The top level gives the shortest account, and the deepest level gives the fullest one.`,
    "",
    "## At a glance",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    lines.push(
      `- **${pillar.plain.title}** — ${pillar.plain.why ?? pillar.plain.what}`,
    );
  }
  lines.push("");
  lines.push(...renderPlainAgentsEyeView());
  for (const pillar of FEATURE_CANON) {
    lines.push(`## ${pillar.plain.title}`, "");
    lines.push(pillar.plain.what, "");
    if (pillar.plain.why !== undefined) {
      lines.push(`_${pillar.plain.why}_`, "");
    }
    const pillarAgent = plainAgentSegment(pillar, "");
    if (pillarAgent !== "") lines.push(pillarAgent, "");
    for (const child of pillar.children ?? []) {
      lines.push(...renderPlainNode(child, 0));
    }
    lines.push("");
  }
  lines.push(...renderPlainCoverage());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
