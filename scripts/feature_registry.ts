/**
 * The feature registry and the generated feature canon — the product's
 * features and benefits as DATA, rendered into the maintainer canon page the
 * same way the glossary renders from its term registry (ADR 0175, following
 * the discipline of `glossary_registry.ts`).
 *
 * Four projections:
 *  - `scripts/codegen.ts` renders {@link renderFeatureCanonDoc} into the map's
 *    committed `_internal/feature-canon.md` and
 *    {@link renderFeatureCanonPlainDoc} into its plain-language twin
 *    `_internal/feature-canon-plain.md`; the human- and agent-benefit
 *    transpositions compile from the same feature identities into their own
 *    generated pages. Sync tests hold every committed projection to its
 *    renderer.
 *  - the enrollment guards (`tests/feature_canon_enrolment_test.ts`) hold every
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
import { HINTS } from "../src/shared/hints.ts";
import { CLAIMS, type ClaimSlug } from "./brand/claims.ts";
import { annotateProse } from "./canon_editor/annotation.ts";

// discern-canon-section: feature

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
   * The plain-language reading — required on every node, so a feature cannot
   * enter the canon without its non-technical account. `deno check` is the
   * enrollment guard's front line: a node authored without `plain` fails the
   * gate's typecheck before any test runs.
   */
  plain: PlainAccount;
  /**
   * Explicit claims on closed-set members, written `set:member` — e.g.
   * `verb:done`, `job:test`, `stage:fix`, `config:standards`,
   * `skill:discern-cure-a-bug`, `agent:codex`. The enrollment guard holds every
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
      "The `discern done` command runs the project's full quality check: the declared jobs by stage, any scope gates the change woke, and the standards. Every job is labeled, and every failure carries the command that produced it.",
    why:
      "The project's command result is the authority on whether work is done. An agent's confidence remains advisory.",
    plain: {
      title: "The final quality check",
      what:
        "One instruction, `discern done`, runs every check the project requires. It runs the listed pieces of work in their proper order, any extra checks for the parts of the project the change touched, and every stated quality rule. Each piece has a name, and every failure includes the exact instruction that produced it.",
      why:
        "The result of the project's check decides when the work counts as finished. The coding agent's confidence remains advice rather than evidence.",
    },
    surfaces: [
      "verb:done",
      "verb:queue",
      "config:jobs",
      "config:gate",
    ],
    children: [
      {
        id: "jobs-table",
        title: "Declared jobs",
        what:
          `A project declares its commands once, under \`[jobs]\`. The known names ${
            codeList(Object.keys(KNOWN_JOBS), "and")
          } derive their stage and accept an ordered command list; a custom \`[jobs.<name>]\` table declares one, with an optional \`provides\` label.`,
        why:
          "Every agent and every human runs the same commands, read from one file.",
        plain: {
          title: "Work the project has declared",
          what:
            `A project lists its instructions once, in the part of its settings called \`[jobs]\`. The familiar names ${
              codeList(Object.keys(KNOWN_JOBS), "and")
            } automatically go in the right group and can contain an ordered list; any additional named item goes under \`[jobs.<name>]\`, states its own group, and may add a \`provides\` label saying what it supplies.`,
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
            plain: {
              title: "Time limits for each piece of work",
              what:
                "`[gate].timeout` limits how long every instruction may run; an unusually slow one can carry its own `timeout`. discern stops an instruction that runs over, along with everything it started, and fails it with an explanation in everyday language.",
              why:
                "The final quality check can never wait forever for a trial runner that keeps watching for changes, or for a stuck preview server.",
            },
          },
          {
            id: "capture-environment",
            title: "The capture environment",
            what:
              "Every job runs with `CI=1`, `NO_COLOR=1`, and `TERM=dumb`, which flips the common watch-mode test runners into single-run form and keeps tool output plain enough to parse.",
            why:
              "The capture environment prevents watch-mode hangs at process start, before the timeout becomes relevant.",
            plain: {
              title: "A controlled setting for captured output",
              what:
                "Every piece of work runs with three widely used settings — `CI=1`, `NO_COLOR=1`, and `TERM=dumb` — which make the common trial-running tools run once instead of waiting for more changes, and keep their printed words plain enough to read mechanically.",
              why:
                "These settings prevent watch-mode hangs when the process starts, before the time limit becomes relevant.",
            },
          },
          {
            id: "gate-streaming",
            title: "Live frame and static transcript",
            what:
              "A live-capable terminal always combines stable Gate progress with a bounded job-output tail. On static surfaces, `[gate].stream` switches between grouped per-job output (the default) and line-prefixed streaming.",
            plain: {
              title: "Live progress with a bounded output tail",
              what:
                "A live terminal shows what is running and what it is saying together. For CI, pipes, plain output, or terminals without cursor control, `[gate].stream` chooses whether output appears immediately with labels or stays grouped by job.",
            },
          },
          {
            id: "strand-detection",
            title: "Strand detection",
            what:
              "Ordinary `discern done` starts from a clean committed tree and fails any stage that leaves uncommitted changes behind. If fix/build changes that tree, it stops before checks and tests. Explicit `--standalone` diagnostics can run on dirty paths without reusable Proof.",
            why:
              "What the gate verified and what gets committed are the same tree.",
            plain: {
              title: "Catching changes left behind",
              what:
                "Ordinary `discern done` starts from work saved in the project's history, with no pending edits. If an early step changes those files, it stops before later tests. Explicit `--standalone` can check unsaved edits but produces no reusable evidence.",
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
          "`discern tidy [md|toml]` canonically formats the configured map, TODO and instruction sources, plus the root `discern.toml`, using formatters embedded in the offline binary. Bare `discern tidy` runs both types; a parse failure leaves every file unchanged. Box-drawing diagrams in fenced or indented code blocks must stay column-aligned; a fenced block tagged `freeform` is exempt.",
        why:
          "Agent-maintained prose and frequently edited config stop accumulating formatting churn, even when the project's stack has no formatter of its own.",
        plain: {
          title: "Consistent tidying of discern's own files",
          what:
            "`discern tidy [md|toml]` tidies the project guide, the to-do list, the instruction text for coding agents, and the root `discern.toml` settings file, using tidying tools carried inside the program — no internet connection needed. Bare `discern tidy` covers both kinds of file, and discern leaves a file it cannot make sense of entirely alone. Drawn diagrams in those files must keep their columns lined up; one marked `freeform` is exempt.",
          why:
            "Writing maintained by coding agents, and settings edited often, stop collecting pointless layout churn — even when the project's own tools include no tidier.",
        },
        surfaces: ["verb:tidy"],
      },
      {
        id: "gate-preconditions",
        title: "Fail-fast preconditions",
        what:
          "Before any job runs, the gate checks the branch's merge state against the trunk and the generated files' currency, and names the recovery command for a behind or drifted tree.",
        why:
          "A behind or drifted tree is reported before slow project work begins.",
        plain: {
          title: "Checking the obvious before slow work begins",
          what:
            "Before running anything, the final check confirms that the task's copy is up to date with the main shared version and that automatically made files still match their sources — and when either is not true, it names the instruction that fixes it.",
          why:
            "A working copy that is behind or has drifted is reported before slow project work begins.",
        },
      },
      {
        id: "write-preflight",
        title: "Git write authority proven first",
        what:
          "Before an applied command performs a discern-owned Git write, the shared CLI and MCP boundary performs a create/write/rename/remove round trip in the common Git administration directory and any checkout surface that command may mutate. Gate, setup, Standards, and worktree creation supplement that broad proof with their exact planned targets. Read-only commands and dry runs never probe. A denial is a structured `write_access` failure naming the blocked path and reproducing the invocation.",
        why:
          "A sandbox denial costs a few filesystem operations up front instead of partial lifecycle state or a discarded slow run.",
        plain: {
          title: "Proving Git permission before changing anything",
          what:
            "Before a command changes Git-managed project state, discern briefly creates, writes, renames, and removes a temporary entry in each version-history housekeeping area that command may need. Commands that know narrower later writes check those places too. Read-only checks and previews stay read-only. A refusal names the blocked place and includes the instruction to retry.",
          why:
            "A denied permission costs a few tiny file actions up front instead of a half-finished project change or a whole thrown-away run.",
        },
      },
      {
        id: "scope-gates",
        title: "Scopes",
        what:
          "`[scopes.<name>]` names a region of the repository by path globs. A scope can be `neutral` (changes there need no gate), declare a read-only `preview` command an agent can run from the worktree, or carry its own `gate` command that runs only when the region changed.",
        why:
          "A docs edit doesn't pay for a compile, and a sub-component's own checks fire only when it moved.",
        plain: {
          title: "Areas of the project",
          what:
            "`[scopes.<name>]` names one part of the project by the file locations it covers. An area can be `neutral` (changes there need no check), declare a read-only `preview` instruction a coding agent can run from the working copy, or carry its own `gate` instruction that runs only when that area changed.",
          why:
            "A change to written instructions does not pay the cost of preparing the whole app, and a smaller part's private checks run only when that part moved.",
        },
        surfaces: ["config:scopes"],
        children: [
          {
            id: "fail-open-classification",
            title: "Fail-open classification",
            what:
              "A path matching no scope counts as a real code change, so an unknown path runs the full applicable gates.",
            why:
              "Misconfiguration adds checks and preserves the conservative failure boundary.",
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
        plain: {
          title: "Files made by a tool",
          what:
            "`[generated.<name>]` records which saved files one tool makes, the instruction that makes them again, and an optional `timeout` time limit. Given the same project files, the instruction must write the same contents and remove old files the tool no longer makes.",
          why:
            "Each reader gets the file list and the instruction that makes it from one settings entry.",
        },
        surfaces: ["config:generated"],
      },
      {
        id: "prepare",
        title: "The fast inner loop",
        what:
          "`discern prepare` runs the fix-stage jobs, regenerates every `[generated]` group, then runs the check-stage jobs — never build jobs or tests — the quick pass while iterating, before the full `discern done`.",
        why: "Cheap feedback while the change is still moving.",
        plain: {
          title: "The quick check while work is still moving",
          what:
            "`discern prepare` runs the tidying steps, remakes the files made by a tool, and then the read-only checks, and never prepares the app or runs the trials — the fast pass to use while working, before the complete `discern done`.",
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
        plain: {
          title: "Clear and consistent failure reports",
          what:
            "A failed piece of work reports the tool involved, the file and line when known, the message, and the exact instruction that reproduces the failure. discern tidies output too long to show whole into a named file instead of flooding the result.",
          why:
            "Work on the fix starts at the cause, and nothing needs re-running to see what went wrong.",
        },
      },
      {
        id: "gotchas-pointer",
        title: "The gotchas pointer",
        what:
          "When a stage fails, the gate prints a pasteable `discern map <target> --json` fetch when `[project].gotchas_doc` lives in the map, and the file path otherwise. A trap entry annotated with a fenced `gotcha-match` block (a stage and/or an evidence pattern) goes further: a failure matching it carries the entry's own prose inline in the failure output, on the terminal and in the result envelope alike, and the pointer prints only when nothing matches.",
        why:
          "Matched failure instructions appears with the failure that made it relevant, without a separate fetch.",
        plain: {
          title: "A pointer to known traps",
          what:
            "When a group of work fails, discern points at the project's own record of known traps — as a ready-to-paste `discern map` fetch when that record lives in the project guide, or as the file's location otherwise. An entry there can also carry a small matching rule (which group failed, or what the failure's text looks like): a failure that matches brings the entry's own advice straight into the failure report, and the pointer appears only when nothing matched.",
          why:
            "Matched failure instructions appears with the relevant failure, so the coding agent does not need a separate lookup.",
        },
      },
      {
        id: "proof",
        title: "Proof",
        what:
          "A green `discern done` over a clean committed tree emits Proof: the tested commit and tree, source inputs, changed files, check results, and held Standards. An integrated landing retains the submitted source separately from the combined result it proved. Proof never covers later edits; the same green run serves a hint to exercise the real application before calling it finished.",
        why:
          "The owner reviews a verified claim that names the tree it vouches for.",
        plain: {
          title: "Evidence that every required check passed (Proof)",
          what:
            "When the project's full check passes on saved work with no pending edits, discern returns Proof: a record of the version checked, the work it came from, the changed files, the results, and the limits that held. When work is joined before sharing, the record names the submitted work and the checked result separately. Later edits need their own evidence.",
          why:
            "The person in charge reviews a verified claim that names the exact work it vouches for.",
        },
        children: [
          {
            id: "proof-notes",
            title: "Durable proof notes",
            what:
              'After a landing, `discern accept` writes the structured Proof to the landed trunk commit as a Git note in a versioned envelope ready for later signing, adding no commit to trunk history. `[repository].proof_notes = "fetch"` carries notes through ordinary fetches; publishing them stays an explicit push.',
            why:
              "The review evidence outlives the worktree's removal and travels with the exact commit it vouches for.",
            plain: {
              title: "A lasting note of the evidence",
              what:
                "After finished work joins the main shared version, `discern accept` attaches the evidence that every required check passed (Proof) to that exact saved change, as a note kept beside the version history — adding nothing to the project's timeline. A setting lets other copies of the project receive these notes during their ordinary updates; sending them out remains a separate step.",
              why:
                "The evidence outlives the removed working copy and stays with the exact saved change it vouches for.",
            },
          },
        ],
      },
      {
        id: "producer-evidence",
        title: "Producer evidence on every validation result",
        what:
          "`discern done`, `discern test`, and `discern standards` list each producer the run executed or reused, whether its input closure is declared or bound to the exact candidate, the reason, and for reused evidence the evidence id and the commit it came from. Setup and doctor name candidate-bound producers and the remedy: declare `inputs`.",
        why:
          "Reuse is visible per producer instead of inferred from timings, and the cost of an undeclared closure is named where it is paid.",
        plain: {
          title: "Seeing which checks ran and which were reused",
          what:
            "Every final check lists the commands it actually ran and the results it reused from an earlier saved change, with the reason for each. When a command runs again only because it has not said what it reads, the result says so and names the fix.",
          why:
            "You can tell reuse from repetition without measuring it yourself.",
        },
        surfaces: ["verb:done", "verb:test", "verb:standards"],
      },
      {
        id: "unchanged-tree-rerun",
        title: "Current green Proof composes; red reruns stay explicit",
        what:
          "Ordinary `discern done` requires a clean committed tree before selection or producers. Explicit `--standalone` diagnostics remain transient. Completion records its exact subject and verdict in the worktree's Git admin area. On that identical tree, an ordinary `done` returns a valid current green Proof with `gate_ran: false` and runs no Gate step. An unchanged red verdict, or a green marker without valid current Proof, still refuses read-only; `discern done --rerun` measures again and records that explicit probe. A changed clean commit can be evaluated, while `--dry-run` only previews.",
        why:
          "A wrapper can compose with an answer the Gate has already proved without paying for it twice, while a failed tree cannot become green by repetition.",
        plain: {
          title: "Reuse a current pass; make a repeated failure explicit",
          what:
            "Ordinary `discern done` requires the intended work to be saved in the project's history with no pending edits before checks begin. Explicit `--standalone` provides feedback without reusable evidence. On identical work, an ordinary repeat returns the same still-valid passing evidence without running any check again. A recorded failure, or passing history whose evidence is missing or no longer exact, still refuses without touching anything; `discern done --rerun` runs it again and records that explicit choice. Changed work with no pending edits can be checked, while `--dry-run` only previews.",
          why:
            "Another instruction can reuse an answer already proved without paying twice, while repeated failures never turn into passes by themselves.",
        },
      },
      {
        id: "checkpoints",
        title: "Checkpoints",
        what:
          "Change-triggered judgment stops under `[checkpoints]`: a deterministic trigger (a scope or path selector, `unless_changed`, thresholds, delta-shape predicates, or an executable `when` condition) pairs a semantic question with the change that makes it relevant. A fired `stop` checkpoint refuses `discern done` before any gate job until the agent judges the question and records a conclusion — `--met`, or `--unmet` with a one-paragraph rationale — bound to the exact definition and content it judged; `advise` mode serves the question without blocking. The governing definitions are read at the effort's merge-base with the trunk — a branch's own edit takes effect only after it lands — and a declared-unmet conclusion lands only after the owner authorizes that variance at `discern accept` in the current conversation. `discern checkpoints` reports, read-only: the governing policy, each open question's declaration state, and a structural preview of what the current change would fire; `prepare`/`status` serve each coming question early.",
        why:
          "The review moments that need judgment arrive while the change is being made, and every recorded conclusion stays qualified as the agent's declared judgment — never presented as machine-verified.",
        plain: {
          title: "Judgment stops",
          what:
            "Rules the project keeps under `[checkpoints]`. Each rule watches for a certain kind of change and carries a written question that matters for it. When a change matches a stopping rule, the final check refuses to start until the coding agent weighs the question and records its answer: satisfied (`--met`), or not satisfied (`--unmet`) with a short reason. A notice-only rule shows its question without stopping anything. The rules come from the main shared version, not from the task's own edits, and a not-satisfied answer can join the main shared version only after the person in charge allows that named exception at `discern accept`. `discern checkpoints` shows the rules, each recorded answer, and what the current change would set off, without changing anything; `discern prepare` and `discern status` show each coming question early.",
          why:
            "The moments that need judgment arrive while the change is being made, and every recorded answer is presented as the coding agent's own judgment — never as something a machine proved.",
        },
        surfaces: ["verb:checkpoints", "config:checkpoints"],
        children: [
          {
            id: "checkpoint-ci-report",
            title: "Checkpoint report mode in continuous integration",
            what:
              "`discern done --ci` runs the machine Gate while reporting every checkpoint question that awaits review. It writes no open question or declaration, and its report-only Proof cannot authorize acceptance; an ordinary local `discern done` remains required before landing.",
            why:
              "Continuous integration can expose judgment still owed without counterfeiting an agent's review or preventing the machine checks from running.",
            plain: {
              title: "Automated checks report questions without answering them",
              what:
                "`discern done --ci` runs the automated quality checks and reports every judgment question that still needs review. It records no answer, and its report-only evidence cannot be used to move work onto the main shared version; the ordinary local final check is still required first.",
              why:
                "Automated checks can show the judgment still owed without pretending that a coding agent considered it or withholding the machine results.",
            },
          },
          {
            id: "checkpoint-drops",
            title: "Checkpoint drops remain Proof evidence",
            what:
              "Every fail-open checkpoint uncertainty becomes a typed checkpoint-drop record carrying the available policy identity, reason, and a bounded account. Gate, Proof, status, acceptance review, and signed-envelope projections all derive their account from that record.",
            why:
              "A green machine verdict cannot erase the fact that a judgment rule was not enforced.",
            plain: {
              title: "A skipped judgment rule stays visible in the evidence",
              what:
                "Whenever uncertainty makes a judgment rule continue instead of stop, discern records why, which shared rule applied when known, and a short account. The final evidence, current state, and release review all repeat that same record.",
              why:
                "A passing automated result cannot hide that a judgment rule was not enforced.",
            },
          },
          {
            id: "checkpoint-question-files",
            title: "Repository-authored checkpoint questions",
            what:
              "A project checkpoint may set one inline `question` or one project-relative `question_file`. Question files are bounded, UTF-8 Git blobs read from the governing policy tree, so substantial review questions can be authored once without letting branch-local edits change their own obligation.",
            why:
              "A detailed judgment question can live as reviewable project prose while retaining the same governing-policy and subject-fingerprint contract as an inline question.",
            plain: {
              title: "Detailed judgment questions can live in project files",
              what:
                "A project judgment rule may contain one short question in the settings or point to one tracked project file. discern reads that bounded text from the shared version governing the task, so a task cannot rewrite its own question before answering it.",
              why:
                "A detailed review question can be written once as ordinary project prose while remaining tied to the shared rule that governs the task.",
            },
          },
        ],
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
            "`per` divides the measurement by a second measurement, or by a size discern counts itself — files, lines, words, or bytes in a chosen part of the project — and `scale` presents the rate in comfortable units.",
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
        plain: {
          title: "Reusing a measurement when nothing it reads has changed",
          what:
            "`inputs` names the files a measurement reads. When nothing under them has changed since the last recorded measurement, the check reuses the recorded value instead of measuring again.",
          why:
            "A change that only touches written instructions pays seconds for a trial-coverage rule, and the check against weakening still runs.",
        },
      },
      {
        id: "standards-complete-evidence",
        title: "Complete measurement evidence",
        what:
          "`done` requires each declared measurement context. Shared producers and applicable recorded evidence avoid repeated work; standalone `standards` uses the same planner.",
        plain: {
          title: "Requiring every measurement",
          what:
            "Completion requires all configured measurements. Tests and measurements share work, and valid recorded results can be reused.",
        },
      },
      {
        id: "standards-pin",
        title: "Capturing a gain",
        what:
          "`discern standards --pin` tightens each improved limit and commits the change on its own, carrying Proof across the pin commit. It reuses available values from the same clean commit and runs missing selected measurements. Named measurement narrows after Gate Proof validates the complete tree.",
        why:
          "Tightening is mechanical and provable; a hand-edit can't tell a real gain from a quiet loosening.",
        plain: {
          title: "Saving an improvement",
          what:
            "`discern standards --pin` tightens each improved limit and saves that change on its own, carrying Proof across the save. It reuses available values from the same clean version and runs any selected measurements still missing. Named measurement narrows after the full version has passed its checks.",
          why:
            "Tightening is mechanical and provable; a hand-edited number cannot show whether it was a real gain or a quiet weakening.",
        },
      },
      {
        id: "standards-escalation",
        title: "Breach escalation",
        what:
          "A limit the work itself breached becomes a visible owner decision. After the intended tree is committed, the proposal command measures that Standard and records the value, reason, and responsible paths for Proof and acceptance.",
        plain: {
          title: "When the work itself crosses a limit",
          what:
            "When the work itself crosses a limit, the person responsible decides whether it should move. After the intended version is saved as a change, discern measures that quality again and carries the value, reason, and responsible files into the final review.",
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
      "Each parallel task has a separate checkout, identity, and declared resources, including the maintainer's main checkout.",
    plain: {
      title: "Separate working copies",
      what:
        "Every task gets its own separate, linked copy of the project with its own line of saved changes. The copy starts from the main shared version and comes prepared with its own network number, private settings, and any supporting services the project declares.",
      why:
        "Each simultaneous task has its own project copy, identity, network number, private settings, and supporting services, separate from the copy used by the person in charge.",
    },
    surfaces: ["config:worktree", "config:repository"],
    children: [
      {
        id: "start",
        title: "Start",
        what:
          "`discern start` creates the worktree from the main checkout — forked from the trunk regardless of the branch the checkout sits on — and returns its path. `--name` is normalized to a branch-safe slug; omit it for a random codename.",
        plain: {
          title: "Start",
          what:
            "`discern start` makes the separate working copy from the main project copy — always starting from the main shared version, whatever the main copy happens to be showing — and returns the new copy's location. `--name` turns a supplied name into a safe one; leave it out for a random nickname.",
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
        plain: {
          title: "Update",
          what:
            "`discern update` brings the latest main shared work into the task's copy and remakes the automatically made files, in one step that is safe to repeat. It reports what changed underneath the task, and which of the task's own files the incoming work also touched.",
          why:
            "Staying current is one instruction, and the overlap report names the files worth re-checking even after a clean join.",
        },
        surfaces: ["verb:update"],
      },
      {
        id: "accept",
        title: "Accept",
        what:
          "`discern accept` freezes the submitted revision and its Proof, then lands under conversation consent, a standing scope grant, or a recorded effort grant. If the submission contains the current trunk, it lands directly; otherwise discern combines and proves it in an owned integration worktree. Acceptance rechecks authority, advances the trunk to the proven result, records its Proof note, and cleans up the effort when no newer work remains. `--dry-run` previews the queue; `--target` selects an effort and then considers the remaining submissions under their own grants.",
        why:
          "Finished work can land as the shared project moves, with evidence and authority checked for the result that becomes shared.",
        plain: {
          title: "Accept",
          what:
            "`discern accept` shares a finished task only with your permission or a grant you recorded. It keeps the saved version you submitted. If the shared project has moved, discern joins and checks the work in a temporary copy first. It then shares the checked result and cleans up, keeping the task's copy when newer work remains.",
          why:
            "The project can keep moving while finished work finds its way into the shared version.",
        },
        surfaces: ["verb:accept"],
        children: [
          {
            id: "submission-only",
            title: "Join the landing queue",
            what:
              "`discern accept --queue-only` records a clean, proven revision without running checks, taking the landing turn, consuming a grant, or starting a walk. Its read-only plan names the exact revision and authority. Applying rechecks both and preserves the order of an unchanged submission. An ordinary grant never authorizes a checkpoint variance or standard proposal.",
            why:
              "The owner can queue green work after its agent has stopped, with submission, Proof, and permission remaining separate facts.",
            plain: {
              title: "Queue checked work",
              what:
                "Choose Join the landing queue in the desk, or run `discern accept --queue-only` from the task's copy, to record the version you want shared. This does not start a background job. An active or later Accept can pick it up with the required permission.",
              why:
                "Finished work can wait visibly without restarting its coding agent or repeating its checks.",
            },
          },
          {
            id: "integration-landings",
            title: "Integration worktrees",
            what:
              "When a submitted revision does not contain the current trunk, acceptance creates a disposable worktree with the project's setup and resources, merges the trunk, regenerates artifacts, and runs the Gate on the combined committed tree. Proof identifies the submitted source and the tested result separately. A conflict or failed combined check returns the author to update, resolve, commit, and prove the work before retrying.",
            why:
              "The combined result is checked before it becomes shared, while the author's worktree keeps its own revision.",
            plain: {
              title: "Checking the joined work in a temporary copy",
              what:
                "If the shared project moved while a task was being checked, discern makes a temporary copy and joins the changes there. It checks that result before sharing it. A conflict or failed check returns the problem to the task's coding agent to fix.",
              why:
                "Work is checked together before people build on it, and the task's own copy stays in place.",
            },
          },
          {
            id: "landing-turn",
            title: "Waiting for a landing turn",
            what:
              "A second `accept` waits on the dedicated acceptance boundary and reports the current landing with its progress handle. The submitted revision is frozen before the wait, and the call resumes automatically when its turn arrives. Long integration checks leave the short completion-publication boundary available to sibling work.",
            why:
              "Concurrent acceptance calls take turns without making the person relay readiness or replace the work being accepted.",
            plain: {
              title: "Taking turns to share finished work",
              what:
                "When another task is being shared, the next request waits, says what it is waiting for, and continues when its turn comes. It keeps the saved version chosen before the wait, even if the task has newer work by then.",
              why:
                "Sharing requests can wait for each other while coding agents keep finishing their own work.",
            },
          },
          {
            id: "landing-queue-walk",
            title: "Landing after a selected submission",
            what:
              "With `--target`, acceptance lands the selected submission first, then walks the remaining queue in its canonical order. Each later submission needs current Proof and its own standing or effort grant; the selected submission's conversation consent does not cover it. The walk stops at the first refusal or failure, and `data.landings` reports each attempt.",
            why:
              "An owner can start from the work they chose and let already-authorized submissions follow with an account of each result.",
            plain: {
              title: "Sharing the permitted work that follows",
              what:
                "After sharing the task selected with `--target`, discern considers the other waiting tasks in order. Each needs its own permission and current check results. The first problem stops the sequence, and the result says which tasks were shared.",
              why:
                "Work already allowed to join the project can follow the task you selected.",
            },
          },
        ],
      },
      {
        id: "compose-below-trunk",
        title: "Composing unlanded work",
        what:
          "`start` and `update` both take a `from` ref or unambiguous worktree id or path, so work can build on another branch's unlanded changes; only `accept` lands on the trunk.",
        why:
          "Stacked efforts stay possible without ever making the trunk a merge scratchpad.",
        plain: {
          title: "Building on unfinished work",
          what:
            "`start` and `update` both accept a `from` choice, so one task can build on another task's not-yet-shared changes; only `accept` changes the main shared version.",
          why:
            "Related tasks can remain stacked while unfinished changes stay off the main shared version.",
        },
      },
      {
        id: "worktree-identity",
        title: "Deterministic identity",
        what:
          "Each worktree carries stable derived values — id, branch, site name, database name, and a dev-server port hashed from its id — readable with `discern identity` in that checkout or by selecting it with an exact id, path, local branch, or full local ref, and exported into its env files.",
        why:
          "Concurrent development servers and test databases receive distinct derived names.",
        plain: {
          title: "A stable identity",
          what:
            "Every separate working copy carries stable values worked out from its identity — its own identifying name, task name, site name, information-store name, and a preview-server network number — readable with `discern identity` and placed into its private settings files.",
          why:
            "Preview servers and trial information stores running at the same time receive distinct derived names.",
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
        plain: {
          title: "Separate supporting services for each copy",
          what:
            "`[worktree.resources.<name>]` declares an outside thing a working copy needs for itself — an information store, a stand-in device, an isolated packaged app — as a `create` instruction and a `destroy` instruction, with the optional choices `ensure`, `required`, `retries`, and `gc`. discern creates services top to bottom, removes them bottom to top, and fills placeholders written `@…@` with the copy's real identity.",
          why:
            "Separation covers not just the project's files but everything those files use.",
        },
      },
      {
        id: "crash-safe-provisioning",
        title: "Crash-safe provisioning",
        what:
          "The lifecycle writes its intent before acting on it: a resource's ledger entry — its destroy command already fully expanded — lands before `create` runs, a ready marker records the moment the non-repeatable phases finished, and a failure after the checkout was added discards the partial worktree rather than leaving it registered.",
        why:
          "A crash leaves a working worktree or a reclaimable one, and a plausible-looking half-checkout is discarded at the moment of failure.",
        plain: {
          title: "Safe setup even when interrupted",
          what:
            "The setup writes down what it intends before acting on it: it saves a service's cleanup entry, with its removal instruction already filled in, before `create` runs; a ready marker records the moment the one-time steps finished; and a failure after registering the copy discards the partial copy rather than leaving it looking usable.",
          why:
            "A crash leaves either a working copy or one that can be reclaimed — and a convincing-looking half-copy is thrown away at the moment of failure.",
        },
      },
      {
        id: "drop-recovery",
        title: "Bounded drop recovery",
        what:
          "Before `discern worktree drop` deletes a branch, it keeps the committed tip under `refs/discern/recovery/`, prints that ref, and atomically limits the repository to the newest 32 retained tips.",
        why:
          "A mistaken drop has a direct route back to committed work without turning destructive cleanup into an unbounded archive.",
        plain: {
          title: "A way back from a mistaken removal",
          what:
            "Before discern removes a task's saved-change name, it keeps that task's latest saved point in a local recovery list, shows the exact entry, and limits the project to its 32 newest entries.",
          why:
            "An accidental removal has a direct route back to saved work without allowing recovery history to grow forever.",
        },
        surfaces: ["verb:worktree"],
      },
      {
        id: "worktree-prune",
        title: "Owned worktree reclamation",
        what:
          "`discern worktree prune` reclaims merged worktrees, stale state, reappeared paths, and resources only when recorded identity proves discern ownership. It also reclaims an abandoned integration copy from its durable ownership record while preserving copies with a live owner. Teardown succeeds only after both Git registration and the filesystem path are absent.",
        why:
          "A crashed session can be cleaned up without treating unrelated branches or neighboring directories as disposable.",
        plain: {
          title: "Cleaning up only discern's leftovers",
          what:
            "`discern worktree prune` removes finished or abandoned copies and their supporting services only when saved records prove discern owns them. This includes a temporary joining copy whose owning process has ended. Cleanup succeeds only when both the copy and its registration are gone.",
          why:
            "An interrupted session can be cleaned up without treating unrelated saved work or nearby directories as disposable.",
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
            "At setup, discern fingerprints the files the version history ignores, and before removing the working copy it reports the top-level ignored places that changed.",
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
        plain: {
          title: "The overview of all work in progress",
          what:
            "From the main project copy, `discern status` shows one row for every separate working copy: its task, whether its files are clean, whether it is ahead of or behind the main shared version, its latest activity, a broken mark for a copy whose creation never finished, and any files two tasks have both changed.",
          why:
            "The person in charge steers several pieces of work without opening each copy, and two tasks touching the same file are named before either becomes shared.",
        },
      },
      {
        id: "worktree-shell-picker",
        title: "Cwd-equivalent worktree shells",
        what:
          "In an interactive terminal, `discern enter` shows the fleet's branches and Git state, then opens `$SHELL` in a selected checkout at the invoking directory's project-relative equivalent. If that directory is absent, it reports and opens the nearest existing ancestor.",
        why:
          "The maintainer moves between parallel tasks without finding the checkout path or retracing the project directory tree.",
        plain: {
          title: "Open another working copy in the same place",
          what:
            "In an interactive terminal, `discern enter` shows each separate working copy's task and file state, then opens the chosen copy at the matching place in the project. If that place does not exist there, discern says so and opens the nearest folder that does.",
          why:
            "The person in charge moves between simultaneous tasks without finding the copy's location or retracing folders through the project.",
        },
        surfaces: ["verb:enter"],
      },
      {
        id: "await",
        title: "Awaiting a fleet condition",
        what:
          "`discern await` selects a sibling by exact worktree id, path, local branch, or full local ref, then blocks until it is green, its latest observed work has landed on the trunk, or the trunk has moved. Git refs, landed Proof notes, and Gate Proof records decide the condition; logbook appends only wake it, with a polling fallback. Omit the timeout to use the configured client's longest reliable call. If that call ends first, a 15-character repository-local continuation handle preserves the branch transition or trunk baseline across the next call.",
        why:
          "A dependent agent spends one bounded call waiting for the work it builds on instead of guessing poll intervals or asking a human.",
        plain: {
          title: "Waiting for a condition across the tasks",
          what:
            "`discern await` waits until a chosen thing becomes true: a sibling task has passed the final check, a task's work has joined the main shared version, or the main shared version has moved. It uses the longest reliable request the connected tool supports. If that request must return first, a continuation keeps the original question intact so a change between requests is not missed.",
          why:
            "A coding agent that depends on another task makes one bounded request instead of guessing how often to check or asking a person.",
        },
        surfaces: ["verb:await"],
      },
      {
        id: "progress",
        title: "Progress and reconnect",
        what:
          "Every long operation — `done`, `test`, `standards`, `accept`, and an MCP `await` — reports typed progress facts while it runs (the phase, a composed sentence, producer-reported counts, each failure the moment it is established, and what happens next) and records the same facts behind a short `R1` handle in a bounded journal under the common Git directory. A producer reports its own counts by printing `DISCERN_PROGRESS` lines. `discern progress [handle]` reads an operation back after a lost call: its phase, the counts and failures known so far, named timing boundaries, and the retained final result; with no handle it reads the calling checkout's most recent operation and names any other checkout's operation instead of substituting it. The journal is advisory: it carries no validation or landing authority, and reading it changes nothing.",
        why:
          "A minutes-long check is never silent, and a closed terminal or timed-out tool call loses nothing: the same account is read back afterwards instead of re-running the work to recover its output.",
        plain: {
          title:
            "See progress while checks run, and read it back after a lost connection",
          what:
            "While a long command runs, discern says what it is doing in plain sentences: which step is running, how many parts are done, any failure the moment it is known, and what happens next. It also writes the same facts to a short record with a handle. If the terminal closes or the tool call times out, `discern progress` with that handle shows the same account, including the final result, without running anything again. With no handle it shows the latest command run from this working copy.",
          why:
            "Waiting on a long check is never a silent gamble, and a lost connection never means running the whole thing again to find out what happened.",
        },
        surfaces: ["verb:progress"],
      },
      {
        id: "desk",
        title: "The desk",
        what:
          "Bare `discern` opens the operator's desk: an interactive surface over the fleet that starts tasks, runs Project Scripts from the main checkout or a selected worktree, opens configured coding-agent CLIs found on `PATH`, opens the offline manual, pre-authorizes one effort to land once green, and keeps task controls reachable while observations refresh, owning the child sessions it launches.",
        why:
          "The maintainer can inspect and act on the fleet from one interactive surface.",
        plain: {
          title: "The desk",
          what:
            "Running `discern` on its own opens the desk for the person in charge: one interactive view over all the work in progress. It starts tasks, runs the project's own tools from the main or a separate working copy, opens the offline manual, opens any of the recognized coding-agent programs found in the computer's standard installed-program list (called `PATH`), records permission in advance for one task to join the main shared version once it passes, and keeps each task's controls reachable while work changes — staying responsible for the sessions it starts.",
          why:
            "The person in charge can inspect and act on every task from one interactive view.",
        },
        surfaces: ["verb:desk"],
        children: [
          {
            id: "tips",
            title: "Desk tips",
            what:
              "The desk reserves one quiet tip per session. Selection is deterministic over a curriculum registry (new-in-release entries first, then contextual relevance, then authored order, then rotation). The package fits the line within the viewport; Read this Tip opens the full text. Each shown id is recorded once in the logbook.",
            why:
              "The desk presents one tip per session and records its id in the logbook for later adoption analysis.",
            plain: {
              title: "Desk tips",
              what:
                "The desk keeps one short tip for each session. The choice follows fixed rules, the line fits the window, and Read this Tip opens its full text. The tip's name goes into the activity record.",
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
    id: "instructions",
    title: "Agent instructions",
    what:
      "One authored instruction source compiles into every configured agent's instruction file. discern's built-in operating instructions are always prepended, so your sources extend it rather than replace it.",
    why:
      "Every provider reads one authored instruction body, including cloud agents.",
    plain: {
      title: "Instructions for coding agents",
      what:
        "discern compiles one project-written set of instructions into the instruction file of every chosen coding agent. Its own built-in operating advice always comes first, so the project's words add to it rather than replace it.",
      why:
        "Write the instructions once, and every coding agent (including one working on another computer) reads the same page.",
    },
    surfaces: ["config:instructions", "verb:refresh"],
    children: [
      {
        id: "instructions-compile",
        title: "Author once, compile everywhere",
        what:
          "`discern refresh` compiles the built-in instructions plus `[instructions].sources` into one generated file per provider. The outputs are committed, and a generated file that drifts from its sources fails the gate.",
        why:
          "A bare clone hands every agent current instructions, and stale copies cannot survive review.",
        plain: {
          title: "Write once, produce every copy",
          what:
            "`discern refresh` compiles discern's built-in advice plus `[instructions].sources` into one finished instruction file per kind of coding agent. The finished files live with the project, and a finished file that no longer matches its sources fails the final check.",
          why:
            "A freshly copied project hands every coding agent current instructions, and a stale copy cannot survive review.",
        },
      },
      {
        id: "instructions-conditionals",
        title: "Config-aware instructions",
        what:
          "The built-in instructions are templated on the project's config, so a project without worktree resources or standards never ships agent instructions about them.",
        why:
          "Agents read instructions about the project they're in, nothing else.",
        plain: {
          title: "Instructions that match this project",
          what:
            "The project's own settings shape the built-in advice, so a project with no separate supporting services or quality rules never hands its coding agent instructions about them.",
          why:
            "Coding agents read instructions about the project in front of them, nothing else.",
        },
      },
      {
        id: "providers",
        title: "Agent providers",
        what: `The native providers — ${
          codeList([...AGENT_NAMES], "and")
        } — each get their integration files from one typed registry: instruction target, settings seed, hooks, and MCP wiring.`,
        why:
          "Supporting an agent is registry data; parity guards keep every provider surface complete.",
        plain: {
          title: "Kinds of coding agent",
          what: `The directly supported kinds — ${
            codeList([...AGENT_NAMES], "and")
          } — each get their connection files from one master list: where the instructions go, which starter settings and automatic actions they need, and how they connect to discern.`,
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
                "Reads the made-for-it `CLAUDE.md`; discern seeds `.claude/settings.json` with session-start and working-copy actions and adds its connection to `.mcp.json`.",
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
                "Reads `AGENTS.md` — the main instruction file, reused by the other coding agents that understand that name; discern shares responsibility for its settings, automatic actions, rules, and per-copy private-value files.",
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
                "Reads the made-for-it `GEMINI.md`, with its settings and discern connection kept under `.gemini/`.",
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
                "Reuses the main `AGENTS.md` and keeps its own automatic actions and discern connection under `.cursor/`.",
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
            "A supported coding agent runs `discern worktree ensure` when its session begins — safely making the working copy ready again, with a reminder while setup remains unfinished — and hands working-copy creation and removal events straight to discern, with no extra translator and no home-made command text between them.",
          why:
            "A session starts ready, or says what is missing, before any work begins.",
        },
      },
      {
        id: "agent-autodetect",
        title: "Detection at setup",
        what:
          "A fresh install resolves its default agent set from each provider's declared installation evidence: terminal launchers, editor commands, and conventional application locations. The desk still offers only terminal agents it can launch from `PATH`, while a separate identity catalog recognizes the agent driving a session as advisory logbook evidence.",
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
      "A reusable procedure becomes one file available to every future session.",
    plain: {
      title: "Reusable how-to guides",
      what:
        "Focused, reusable instructions for recurring kinds of task, saved as `SKILL.md` files. The set is discern's bundled built-in guides plus any the project writes under `[skills].dir`, placed where each coding agent expects to find them.",
      why:
        "A reusable method becomes one file available to every future session.",
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
            "`discern refresh` places the effective set into each coding agent's own guides folder, which the version history leaves out: it copies the built-in guides and links project-written guides to their originals, so edits take effect immediately. A project guide with the same name replaces a built-in one, `[skills].exclude` drops named ones, and `discern skills eject <name>` copies a built-in into the project for customizing.",
          why:
            "The set is declared once and identical for every coding agent, and customizing never creates a second diverging copy of the collection.",
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
            "The built-in guides teach discern's preferred way of working — their names begin with `discern-`, `discern skills list` shows them, and each must clear a bar: it must teach something even the most capable coding agent would not reliably do unasked. A method prompted by an ordinary request ships as a guide; advice tied to a particular discern instruction ships as a registered advice note shown at that moment.",
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
            id: "skill-place-a-checkpoint",
            title: "Place a checkpoint",
            what:
              "Walk from a recurring review judgment to a wired `[checkpoints.<id>]` entry: place the rule on the placement ladder, choose a deterministic trigger and the stop or advise mode, write a short question with a real unmet answer, verify it governs from the trunk, and review its observed economics later.",
            plain: {
              title: "Set up a judgment stop",
              what:
                "Turn a point a reviewer keeps raising into a rule the project keeps. Choose which changes set it off, and whether it stops work or only advises. Write the short question the coding agent must answer, check the rule is in force, and review later how often it fires and how it was answered.",
            },
            surfaces: ["skill:discern-place-a-checkpoint"],
          },
          {
            id: "skill-clear-the-decks",
            title: "Clear the decks",
            what:
              "Sweep out the clutter agent-built codebases accumulate — duplicated helpers, dead code from abandoned approaches, one-caller indirection, leftover scaffolding — every cut proven safe, landed as small behavior-preserving commits, with the entropy capped by a standard.",
            plain: {
              title: "Clear the decks",
              what:
                "Sweep out the clutter that projects built by coding agents tend to collect — small helpers written twice, dead code from abandoned approaches, layers used from only one place, leftover starter material — every removal proved safe and saved as a small behavior-preserving step, with a quality rule capping the mess afterwards.",
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
                "Turn the work under discussion into complete, self-contained briefs for fresh coding agents in their own separate working copies — one hand-off, several at once, or staged briefs — then review what comes back with a skeptical eye.",
            },
            surfaces: ["skill:discern-delegate-work"],
          },
          {
            id: "skill-await-the-fleet",
            title: "Await the fleet",
            what:
              "Wait for another effort with one blocking `discern_await` call — a sibling green, its work landed, or the trunk moved — choosing the condition from the need, awaiting an exact returned worktree selector, then following the met hint to compose what arrived.",
            plain: {
              title: "Wait for another task",
              what:
                "Wait for another line of work with one bounded request — a sibling task passing its final check, its work joining the main shared version, or the main shared version moving — choosing the right condition, waiting on the exact task name, then following the returned next step to build on what arrived.",
            },
            surfaces: ["skill:discern-await-the-fleet"],
          },
          {
            id: "skill-teach-the-project",
            title: "Teach the project",
            what:
              "Route a session's lesson into the project's own surfaces — an instruction line, an authored skill, a project script, a doc, or a decision record — so every future session inherits it.",
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
                "The practices discern builds itself with, explained for any kind of project: one authoritative home for every shared fact, protections that automatically cover future additions, declared lists of what a broad rule applies to, changes planned before they run and safe to run again, restraint with code comments — and the connections recorded on one page of the project guide.",
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
      "The agent-maintained documentation tree at `[map].dir`: agents maintain explanations with evidence and review them as the project changes; humans read it as documentation and as an audit of what their agents understand.",
    why:
      "The gate checks links and examples; source evidence and checkpoints guide review. The map gives the owner an account of agent understanding.",
    plain: {
      title: "The project guide",
      what:
        "The project's written guide, kept at `[map].dir` and maintained by coding agents: they explain the project and review the guide as work changes it, and people read it both as documentation and as a way to inspect what their coding agents understand.",
      why:
        "The final check catches broken links and examples. Changes to linked files help coding agents find pages to review, and people can inspect what those coding agents understand.",
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
          "Agent document discovery runs regions, then search, then canonical targets: compiled instructions lists each top-level region by exact target, `search` takes a query in task language, and every result returns a snippet plus a target that feeds back into the same tool. Search returns at most 5 ranked documents, and query values are never written to the logbook.",
        why:
          "Documentation growth never churns the tracked agent files and never spends context before a page is needed.",
        plain: {
          title: "Finding the right page",
          what:
            "A coding agent narrows in three steps: named regions, then a search, then the exact page. The compiled instructions list every top-level region by its exact destination, `search` accepts the ordinary words of the task at hand, and every result returns a short sample plus a destination that feeds straight back into the same tool. At most five pages come back, best match first, and search words are never written to the activity record.",
          why:
            "As the guide grows, the saved instruction files never churn, and no reading space is spent on a page before it is needed.",
        },
      },
      {
        id: "docs-integrity",
        title: "The docs integrity preflight",
        what:
          "Every `discern done` checks the map's structural integrity before the jobs run: intra-map links and heading anchors against the shared renderer, fenced `discern` examples against the live verb and flag registry (Project Scripts included), optional frontmatter blocks against the readers' shape rules and skill citations against the effective skill set.",
        why:
          "A rename breaks the docs loudly, in the same change, instead of quietly a month later — and an excluded skill cannot stay recommended by live prose.",
        plain: {
          title: "Checking that the guide still works",
          what:
            "Every `discern done` checks the guide's references before the work runs. It checks that links between pages and to their sections resolve, and that examples containing `discern` match the real list of instructions and choices (the project's own instructions included). It also checks that optional basic facts at the top of a page has the expected shape and that mentions of how-to guides match the set now in force.",
          why:
            "A renamed thing breaks the written instructions loudly, in the same change, instead of quietly a month later — and a withdrawn how-to guide cannot stay recommended by live text.",
        },
      },
      {
        id: "map-freshness",
        title: "File-linked freshness",
        what:
          "Each page has its own source links and Git baseline. The map reports later commits to those sources, identifies affected pages, and leaves currency for review. Missing links or history mean unknown coverage; an unrelated page edit cannot reset the evidence.",
        plain: {
          title: "Facts about freshness, tied to real files",
          what:
            "Each page links to the files behind its account. Changes to those files point to pages that may need review. Editing a different page does not clear that signal. Without links or a saved history, discern cannot tell; reading the page decides whether it is still true.",
        },
      },
      {
        id: "publish-predicate",
        title: "Publication control",
        what:
          "Public map exports honor publication metadata and omit underscore directories. Local map discovery includes current supporting pages without requiring metadata. discern's own manual and website retain a separate publication policy; the site map directory links to repository files.",
        why:
          "Publication choices do not decide which current project explanations agents can find.",
        plain: {
          title: "Control over what ships",
          what:
            "Public copies of the project guide omit folders whose names start with an underscore and pages marked private for publication. Coding agents can still find the current supporting pages locally. discern has its own rules for its handbook and website, where guide entries link to the source files.",
          why:
            "The choice to publish a page is separate from finding it during project work.",
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
          title: "discern's own handbook",
          what:
            "The program carries its own public documentation: `discern docs` browses it offline in any installation, using the same page display as the project guide, and copies supplied to customers carry only the public material.",
          why:
            "Every installation can explain how discern works with no internet connection and no separate website.",
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
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "insight",
    title: "Advisories and the logbook",
    what:
      "Read-only surfaces that point at work and never block: the gate and standards are the only enforcement, and everything else reports.",
    why: "Advisories remain informational and do not change the gate verdict.",
    plain: {
      title: "Helpful advice and the activity record",
      what:
        "Read-only surfaces that point at useful work and never block it: the final quality check and the quality rules are the only enforcement, and everything else reports.",
      why:
        "Advice remains informational and does not change the result of the final quality check.",
    },
    surfaces: ["config:coupling"],
    children: [
      {
        id: "status",
        title: "Status",
        what:
          "`discern status` projects one read-only result as a width-capped terminal dashboard, authored Markdown, or a structured JSON and MCP envelope. The main-checkout dashboard leads with the fleet's derived attention states, complete identities, Proof evidence, activity, divergence, collisions, and concrete next steps.",
        why:
          "Orientation is one cheap read-only call, for agents and humans alike.",
        plain: {
          title: "Current state",
          what:
            "`discern status` presents one read-only answer as a responsive dashboard for people or structured data for tools. From the main copy, the dashboard leads with the work that has failed, is running, has fallen behind, overlaps another change, or is ready for review.",
          why:
            "Getting one's bearings is one cheap, read-only call, for coding agents and people alike.",
        },
        surfaces: ["verb:status"],
        children: [
          {
            id: "bounded-status-projection",
            title: "Bounded status projection",
            what:
              "Structured status caps repeated collections while retaining exact totals and an omitted-count inventory. `discern status --verbose --json` and `discern_status` with `verbose: true` explicitly request the full structured projection.",
            why:
              "Routine orientation has a stable context cost even when unrelated fleet state grows, while full evidence remains one explicit request away.",
            plain: {
              title: "The usual current-state answer stays a predictable size",
              what:
                "The structured current-state answer shows bounded samples of repeated lists, the exact total for each, and how much was left out. A detailed request returns the complete structured view.",
              why:
                "A coding agent can get its bearings without unrelated work in progress consuming its working context, while the full detail remains available when needed.",
            },
          },
          {
            id: "owner-attention",
            title: "Owner-attention channel",
            what:
              "Cross-effort lifecycle judgments use the registered `owner-attention` hint category, separate from the current caller's `next-step`. Authored Markdown presents owner attention before other actions and closes with the current effort's next valid action.",
            why:
              "An agent can see another effort's condition without mistaking it for authority to land, discard, or adopt that effort.",
            plain: {
              title: "Decisions for the person in charge stay separate",
              what:
                "Conditions in another task that need the person in charge appear in their own attention section, separate from the coding agent's next action for its current task.",
              why:
                "A coding agent can notice another task's condition without treating it as permission to take over, release, or discard that work.",
            },
          },
        ],
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
          "Frequently co-changed files are named while the change is still open.",
        plain: {
          title: "Files that usually change together",
          what:
            "`discern coupling` reads the project's own saved history for files that habitually change together: what the current change is missing, one file's usual partners, or the shared history of two files. It needs no setup and adjusts itself to the project, and `[coupling].in_gate` surfaces its findings as advice notes at the end of the final check.",
          why:
            "Files that frequently change together are named while the change is still open.",
        },
        surfaces: ["verb:coupling"],
      },
      {
        id: "improvement",
        title: "Improvement",
        what:
          "`discern improvement` ranks the highest-value next action from deterministic rules and subjective reviews across the gate, setup, instructions, map, worktrees, standards, and skills, scoring project health 0–100.",
        why:
          "The maintainer receives a ranked next action with the evidence used to select it.",
        plain: {
          title: "The best next improvement",
          what:
            "`discern improvement` ranks the most valuable next action, using firm rules plus informed reviews across the final check, the setup, the instructions for coding agents, the project guide, the separate working copies, the quality rules, and the how-to guides — scoring the project's health from 0 to 100.",
          why:
            "The person in charge receives a ranked next action with the evidence used to select it.",
        },
        surfaces: ["verb:improvement"],
      },
      {
        id: "logbook",
        title: "The logbook",
        what:
          "With recording on and a readable `discern.toml`, CLI verbs and MCP invocations resolved to that project record metadata under `.git`, shared by the repository's worktrees. Invocation and completion observations carry durable identities, timings, outcomes, names, and fired hint IDs. They contain no code or command output. The logbook never leaves the machine (a gate test keeps its code free of network paths), rotates by age, and `[project].record_logbook = false` stops all writes.",
        why:
          "The practice becomes measurable evidence without anything leaving the building.",
        plain: {
          title: "The activity record",
          what:
            "With recording on and readable settings, each instruction run — typed, or made through the coding-agent connection — records basic facts in the version history's housekeeping area (the `.git` folder), shared by the project's working copies. These facts identify each operation and carry timings, outcomes, names, and which advice notes appeared — never code, and never printed output. The record never leaves the machine (a test in the final check keeps its code free of any internet route), old lines age out, and `[project].record_logbook = false` stops all writes.",
          why:
            "The way of working becomes measurable evidence, without anything leaving the building.",
        },
      },
      {
        id: "patterns",
        title: "Patterns",
        what:
          "`discern patterns` reads the active logbook or one selected sealed archive. Named detectors report repeated validation, canary gaps, comparable duration trends and other workflow observations with counts, evidence limits and a next step. Completion accounting distinguishes producer work, reused evidence, extraction, validation and time waiting for a test-run slot; counts name their denominator. Missing facts remain unknown. Findings cannot change policy, grant Proof or rank agents. `patterns --stats` reports accepted changes, green streaks, cycle times and standard trends. Terminal-confirmed owner actions can reset or archive local history.",
        why:
          "The owner can inspect where time goes and test a specific improvement without mistaking coordination for an author's failure.",
        plain: {
          title: "Recurring patterns in the practice",
          what:
            "`discern patterns` reads this project's local activity record or one sealed copy. It reports repeated checks, gaps in early tests and runs that keep getting slower under comparable settings. Each finding gives counts, limits and a next step. It separates work done from results used again and time spent waiting for a free test slot. Missing facts stay unknown. The report cannot change settings, approve a change or rank coding agents. `patterns --stats` shows accepted changes, passing streaks, turnaround times and quality trends. Only confirmed owner actions reset or archive the local record.",
          why:
            "The person in charge can see where time goes and choose an improvement without blaming an author for time spent waiting.",
        },
        surfaces: ["verb:patterns"],
        children: [
          {
            id: "patterns-investigations",
            title: "Patterns investigations",
            what:
              "Patterns composes compatible source findings into bounded investigations with stable ids, preserved observations and denominators, one interpretation, one diagnostic action, and a falsifier. Missing, mixed, or conflicting evidence suppresses the synthesis without removing any raw finding.",
            why:
              "Related workflow symptoms can yield one traceable diagnostic path without being promoted into a score, causal claim, or automatic configuration change.",
            plain: {
              title:
                "Related practice findings form one testable investigation",
              what:
                "When several compatible findings point toward one workflow problem, discern keeps every original count and joins them into one limited investigation: what the evidence may mean, what to inspect next, and what would disprove that reading. Missing or conflicting evidence prevents the combined account.",
              why:
                "Related symptoms can lead to one traceable diagnostic path without becoming a score, a claimed cause, or an automatic settings change.",
            },
          },
        ],
      },
      {
        id: "hints",
        title: "Registered hints",
        what:
          "Every advisory hint the engine can emit is an entry in one typed registry — id, category, audience, family, and a parameterized template — with a generated inventory page, command references validated against the live verb registry, and fired ids recorded in the logbook.",
        why:
          "Advice stays current mechanically, and whether advice gets followed is measurable.",
        plain: {
          title: "Registered advice notes",
          what:
            "Every piece of advice discern can give is an entry in one master list — an identifying name, a subject, an intended reader, a family, and a fill-in-the-blanks message — with an inventory page made from the list, instruction names inside the advice matched to the real instruction list, and the names of advice notes that appeared recorded in the activity record.",
          why:
            "Advice stays current mechanically, and whether advice gets followed is measurable.",
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
      "A project adopts discern through one tracked root file and can remove its wiring with one command while retaining authored work.",
    plain: {
      title: "Setting up, updating, and removing discern",
      what:
        "One program installs, verifies, updates, and removes the system, and a project's entire tracked footprint is one root file: `discern.toml`.",
      why:
        "A project adopts discern through one tracked root file and can remove its wiring with one instruction while retaining authored work.",
    },
    surfaces: ["config:meta", "config:project"],
    children: [
      {
        id: "setup",
        title: "Agent-driven setup",
        what:
          "`discern setup` is a staged, consent-driven handshake the coding agent completes. It recommends the strongest suitable reasoning model and explains that the model authors the Gate, worktree policy, Map, and instructions later sessions inherit. It verifies the project read-only, detects the default branch (offering git init on a bare directory), configures `[jobs]` and records which known lifecycles do not apply, proves the project in a worktree, and leaves the finished configuration for review and `setup accept`. Predictable writes are probed before each effectful command. Completion explains the primary subsystem, principles, instructions, protections, and open items beside derived inventories and exact Proof. Landing precedes fresh-session activation.",
        why:
          "One careful repository study creates useful working conditions for later sessions while consequential choices and landing remain with the owner.",
        plain: {
          title: "Setup led by the coding agent",
          what:
            "`discern setup` is a staged, permission-first conversation led by the coding assistant. It recommends a strong reasoning model and explains why: this one careful study of the project creates the checks, separate-copy rules, project guide, and instructions later sessions use. It previews before writing, preserves existing work, proves the project in a separate copy, and explains the project understanding and protections it created before asking whether to add them to the main shared version. Only then does a fresh session check that the integration loaded.",
          why:
            "One careful study of the project gives later coding sessions better working conditions, while every consequential choice remains yours.",
        },
        surfaces: ["verb:setup", "config:setup"],
      },
      {
        id: "setup-observability",
        title: "Observable incompleteness",
        what:
          "An unfinished setup is a machine-readable state, reported by `discern status` and the session-start hook until the handshake completes.",
        why:
          "Status and session-start results keep unfinished setup visible until completion.",
        plain: {
          title: "Clearly showing unfinished setup",
          what:
            "An unfinished setup is a state tools can read, reported by `discern status` and by the automatic session-start action until the conversation completes.",
          why:
            "Current-state and session-start results keep unfinished setup visible until completion.",
        },
      },
      {
        id: "setup-activation",
        title: "Provider-aware activation recovery",
        what:
          "Setup phase state is resumable through `discern setup` and `discern status`. An unlanded completion stops at Proof and the owner's landing choice. After landing, the provider registry serves one exact fresh-session activation check for each configured agent, one local recovery step when it fails, and `discern status --json` as the CLI fallback. Generated files alone never prove that a fresh session loaded the integration; optional improvement follows successful activation.",
        why:
          "An interrupted setup or a provider restart boundary has one bounded continuation instead of a sequence of improvised low-level mutations.",
        plain: {
          title: "One restart check and one way to continue",
          what:
            "Setup resumes from its recorded point. A finished setup stays at review until you land it. After landing, each configured coding assistant receives one exact check for a fresh session, one local recovery step, and the same command-line fallback. Seeing a file made automatically from a source the project owns does not prove the new session loaded it, and optional improvement waits for a successful check.",
          why:
            "An interrupted setup or a restart has one limited continuation instead of a string of improvised low-level changes.",
        },
      },
      {
        id: "relay-messages",
        title: "Complete owner moments",
        what:
          "Welcome, consent, progress, genuine owner decisions, completion, landing, and activation use enrolled human-moment contracts. Each explains the owner outcome, reason, current action, authority, reversibility, and recovery. A decision also carries one recommendation, option consequences, separate owner and agent actions, and an explicit wait boundary. Consent protects each must-survive fact and numbered confirmation; every result representation derives from the same authority.",
        why:
          "A first-time owner understands why a choice matters, what each option changes, and whether the agent is waiting instead of receiving mechanically correct but incomplete prompts.",
        plain: {
          title: "Complete explanations at every choice",
          what:
            "From the welcome through activation, setup explains what each important moment means for you. A real choice includes its recommendation, what every option changes, what you need to do, what the coding assistant will do, and whether it is waiting. The permission conversation protects every required fact and numbered answer from being shortened away.",
          why:
            "You can make an informed choice on your first encounter without already knowing how discern works.",
        },
      },
      {
        id: "consent-attestations",
        title: "Landing authority is proved per invocation",
        what:
          "Scaffolding a fresh install requires a `--confirmed` conversation attestation. Landing checks an explicit source attestation or a recorded applicable grant. An attestation remains bound to the unchanged source and composition procedure across continuations; absent authority, landing refuses. Every successful landing records which source authorized it.",
        why:
          "Consent comes from evidence at the landing boundary, never from an agent's memory of an earlier conversation.",
        plain: {
          title: "Fresh proof of permission, every time",
          what:
            "Starting a fresh installation requires `--confirmed` in that same instruction. Sharing finished work requires the owner's confirmation for that source or an applicable recorded permission. The same unchanged source can continue after review without another confirmation. Each earlier task still needs its own permission. Every successful addition records which permission allowed it.",
          why:
            "Permission comes from evidence at the moment of action, never from a coding agent's memory of an earlier conversation.",
        },
        surfaces: ["config:acceptance"],
      },
      {
        id: "doctor",
        title: "Doctor",
        what:
          "`discern doctor` verifies the installation without changing project state: config validity, schema version, job commands on `PATH`, Git recovery retention, commit identity and signing programs, index visibility, worktree-config placement, repository ownership, instructions, skills, automation, resource commands, and Logbook configuration. An enabled but empty Logbook is healthy on a new install; disabled, invalid, and write-denied states remain distinct. Historical lifecycle gaps do not affect the storage-health result. An environment-denied advisory recording write warns that recording is disabled for this process. The warning does not block setup. Doctor also explains producer coverage and evidence reuse under the `[gate].concurrent_test_runs` cap — which producers standards share or duplicate and which are candidate-bound — and reads the durable completion records: readability, outstanding emergency validation, and records a newer discern wrote, each with its next action and none of them changed. Doctor also prints each verb's execution model: which steps are the project's and which are discern's.",
        why:
          "Facts before judgments, and a misconfigured install names its own fix.",
        plain: {
          title: "Health check",
          what:
            "`discern doctor` verifies the installation without changing project state: that the settings make sense and match the expected format version; that declared instructions exist in the computer's standard installed-program list (called `PATH`); that recovery history, saved-change identity, signing tools, hidden-file state, separate-copy settings, and project ownership are safe; and that instruction text, how-to guides, working-copy automation, supporting-service instructions, and the local activity record are connected. A new empty activity record is healthy. If the environment refuses that optional record, doctor warns and disables recording for this process without blocking setup. It also says how many whole test runs can happen at once, which checks share one run and which repeat for every change, and whether any recorded check results need attention, without changing any of them. It also explains, for every instruction, which steps are the project's and which are discern's.",
          why:
            "Facts before judgments, and a misconfigured installation names its own fix.",
        },
        surfaces: ["verb:doctor"],
      },
      {
        id: "upgrade",
        title: "Upgrade and migrations",
        what:
          "`discern upgrade` updates discern's project files for the version you're running. Preview the changes with `--dry-run`, then apply them while keeping your authored instructions and skills.",
        why:
          "Teams can keep their project setup current and see when they need to update discern.",
        plain: {
          title: "Updating between versions",
          what:
            "After installing an update, ask your coding agent to preview and apply it to your project. discern keeps the instructions and how-to guides you've written.",
          why: "Teammates see when they need to update discern.",
        },
        surfaces: ["verb:upgrade"],
      },
      {
        id: "ownership-buckets",
        title: "File ownership",
        what:
          "Every file discern touches is project-owned (seeded once, then left alone), shared (discern maintains only its declared entries or regions), or generated (rebuilt from reviewable sources). These groups define edit and overwrite authority. Copyright follows the applicable license terms. Upgrade honors the groups, and the removal set derives from the same registry.",
        why: "The ownership registry determines which files upgrade may touch.",
        plain: {
          title: "Who owns each file",
          what:
            "Every file discern touches is in one of three groups: project-owned (created once, then left alone), shared (discern maintains only its listed entries or marked parts), or made automatically from text you can review. The groups say who may edit or replace a file. Copyright follows the terms that apply to that file. Updates honor the groups, and what removal covers comes from the same list.",
          why: "The ownership list determines which files an update may touch.",
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
            "discern and its coding agents write only where the chosen placement gives permission: a file at its usual named location carries built-in permission, a setting you pointed elsewhere gives explicit permission for that place, and every other location is off-limits — enforced by a broad design test.",
        },
        surfaces: ["config:scripts"],
      },
      {
        id: "uninstall",
        title: "Uninstall",
        what:
          "`discern uninstall` removes the wiring discern laid down — derived from the ownership registry — and keeps `discern.toml`, your instructions, and the map.",
        why: "Leaving costs one command and loses no authored work.",
        plain: {
          title: "Removal",
          what:
            "`discern uninstall` removes the wiring discern laid down — worked out from the same ownership list — and keeps `discern.toml`, your instruction text, and the project guide.",
          why: "Leaving costs one instruction and loses no authored work.",
        },
        surfaces: ["verb:uninstall"],
      },
      {
        id: "config-command",
        title: "Config without a parser",
        what:
          "`discern config` edits `discern.toml` while preserving comments and layout — `set`, `set-job`, `set-scope`, `set-standard` — and reads it back raw with `get`, `array`, `has`, `subsections`, and `keys`, so scripts and agents never parse TOML themselves.",
        plain: {
          title: "Changing settings without interpreting the file",
          what:
            "`discern config` edits `discern.toml` while keeping its comments and layout — `set`, `set-job`, `set-scope`, and `set-standard` — and reads it back with `get`, `array`, `has`, `subsections`, and `keys`, so other instructions and coding agents never have to work out the file's special writing rules themselves.",
        },
        surfaces: ["verb:config"],
      },
      {
        id: "release-awareness",
        title: "Release information when requested",
        what:
          "`discern releases` and the desk's Check for updates action open release notes in your browser, showing what changed and whether an upgrade is available. A local reminder prompts you to check every couple of weeks. You choose when to install.",
        plain: {
          title: "Choose when to check releases",
          what:
            "See what's new and check for updates from the terminal or desk. A local reminder prompts you every couple of weeks. You choose when to install.",
        },
        surfaces: ["verb:releases"],
      },
      {
        id: "licenses",
        title: "Licenses and notices",
        what:
          "`discern licenses` prints discern's software license, the Apache-2.0 license for discern-authored project payloads, its notice, and bundled third-party notices. The first-party texts derive from one legal-document registry; the third-party set derives from the compile graph.",
        plain: {
          title: "Licenses and notices",
          what:
            "`discern licenses` prints discern's own terms, the separate Apache-2.0 terms for material it writes into a project, and the required notices for other people's work carried inside discern. The program builds those answers from its real legal files and included components instead of a hand-kept list.",
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
      "Every verb projects one result envelope into terminal, JSON, Markdown, and MCP presentations, with published schemas for both config and results.",
    why:
      "People, coding agents, scripts, and tools can choose the representation that suits the task without changing the underlying verdict.",
    plain: {
      title: "Ways to use discern and consistent results",
      what:
        "Every instruction can present one consistent result package in the terminal, as JSON or Markdown, or through a first-class coding-agent connection, with a published exact description of both the settings and the results.",
      why:
        "People, coding agents, scripts, and tools can choose the form that suits their task without changing what discern decided.",
    },
    surfaces: ["verb:mcp"],
    children: [
      {
        id: "result-envelope",
        title: "One result envelope",
        what:
          "A verb returns one structured result — status, message, steps, data, hints, diagnostics. `--json` serializes it, `--markdown` presents it as prioritized prose, and the terminal and MCP renderers draw from the same envelope.",
        plain: {
          title: "One consistent result package",
          what:
            "Every instruction returns one structured result — whether it succeeded, a message, suggested steps, useful facts, advice notes, and failure details. JSON writes its exact fields, Markdown presents prioritized prose, and the terminal and coding-agent connection draw from the same package.",
        },
        children: [
          {
            id: "authored-markdown-results",
            title: "Authored Markdown results",
            what:
              "Every registered result contract selects an authored Markdown presenter for CLI `--markdown` and MCP text content. It orders current state, bounded evidence, authority or stop boundary, and the next valid action; structured JSON remains the complementary validated projection.",
            why:
              "Text-only and structured-first agent hosts each receive an action-complete result without paying for two copies of the same JSON syntax.",
            plain: {
              title: "A coding agent receives a concise written result",
              what:
                "Every result has an authored Markdown form for the command line and the coding-agent connection. It presents the current state, enough evidence, any authority boundary, and the next valid action, while the structured form remains available for exact field access.",
              why:
                "A coding agent receives a complete, prioritized answer whether its host favors text or structured data, without duplicate payloads consuming its working context.",
            },
          },
          {
            id: "failure-recovery-contract",
            title: "Failure-recovery contract",
            what:
              "Every canonical error family is classified as supporting evidence-bound generic recovery or requiring a tailored registered next-step hint. The public serialization boundary rejects a failed result that cannot supply the recovery its classification promises.",
            why:
              "A failure cannot reach an agent with a fabricated retry or an instruction that ignores the actual evidence and choice required to continue.",
            plain: {
              title: "Every failure carries a truthful way forward",
              what:
                "Each known kind of failure is recorded as either safe to correct from the stated evidence or needing its own specific next step. Before a failed result reaches a coding agent, discern checks that the promised recovery is present.",
              why:
                "A coding agent is not stranded with a vague failure or sent toward a retry that cannot solve the actual problem.",
            },
          },
        ],
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
        plain: {
          title: "Safe to repeat, by agreement",
          what:
            "The instructions whose job is to bring things to a ready state — `discern update`, `discern refresh`, and `discern worktree ensure` — run again safely, check their own starting conditions, and when one is not met, refuse while naming the next step.",
          why: "Running the instruction replaces checking for it by hand.",
        },
      },
      {
        id: "mcp-surface",
        title: "The Model Context Protocol (MCP) server",
        what:
          "`discern mcp` serves the verbs as tools over stdio on the official software development kit (SDK) — self-describing schemas derived from the typed result contracts, strict argument validation, a tracked working root that `discern_start` re-aims at the new worktree, and read-only resources for status, impact, config, docs, and the map.",
        why:
          "MCP-native agents call structured tools; the CLI and the tools can never disagree because they share one core per verb.",
        plain: {
          title: "The standard connection for coding agents",
          what:
            "`discern mcp` offers the instructions as tools over the standard coding-agent connection (called `MCP`), built on the official kit: self-describing input shapes drawn from the same agreed result descriptions, strict checking of every input, a remembered working location that `discern_start` re-aims at the new copy, and read-only access to the current state, the affected areas, the settings, the handbook, and the project guide.",
          why:
            "Coding agents built for this connection call well-described tools — and the typed commands and the tools can never disagree, because each instruction has one shared core.",
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
            "discern publishes the settings format and every instruction's result shape as exact, automatically made descriptions in two standard tool-readable forms (called JSON Schema and TypeScript declarations), remade by the normal preparation step, with the final check catching any drift.",
        },
      },
      {
        id: "project-scripts",
        title: "Project scripts",
        what:
          "Any executable dropped under `[scripts].dir` becomes `discern scripts <name>`: its direct filename is resolved literally, it runs from the project root with four supported `DISCERN_*` variables, arguments are forwarded unchanged, and an optional `# desc:` line supplies the listing text. Scripts occupy their own namespace, so built-in verb names stay legal.",
        why:
          "The project's own tooling gets the project root, active config, scripts directory, and resolved trunk without wrapper boilerplate or ambient discern capabilities.",
        plain: {
          title: "The project's own instructions",
          what:
            "Any runnable file placed under `[scripts].dir` becomes `discern scripts <name>`: its direct filename is taken literally, it runs from the project's root with four named project facts, and extra choices pass through unchanged. An optional `# desc:` line supplies its listing text. These names live in their own clearly marked area, so built-in instruction names stay legal.",
          why:
            "The project's own tooling gets the project location, active settings file, scripts directory, and main shared version without repeated setup code or hidden capabilities in every file.",
        },
        surfaces: ["verb:scripts"],
      },
      {
        id: "forgiving-cli",
        title: "A forgiving command line",
        what:
          "Retired command names refuse with their successor named, synonyms suggest the canonical verb, grammatical variants normalize, and unknown commands get a did-you-mean built from the live verb set.",
        why: "Vocabulary changes never strand a user or an agent mid-habit.",
        plain: {
          title: "A forgiving way to type instructions",
          what:
            "A retired instruction name refuses with its successor named, familiar words from other tools suggest the official instruction, discern corrects small grammatical differences, and an unknown word gets a did-you-mean built from the live instruction list.",
          why:
            "Changes in vocabulary never strand a person or a coding agent mid-habit.",
        },
      },
      {
        id: "output-discipline",
        title: "Terminal discipline",
        what:
          "`--no-color` and `NO_COLOR` are honored, non-TTY output drops decoration, `--plain` suppresses interactive input and paging for CI, and the pager respects `PAGER`.",
        plain: {
          title: "Clean behavior in the command window",
          what:
            "discern honors `--no-color` and the `NO_COLOR` setting, output sent to another tool drops decoration, `--plain` switches off questions and page-by-page viewing for unattended runs, and the page-by-page viewer respects the computer's `PAGER` choice.",
        },
      },
    ],
  },
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "foundations",
    title: "Foundations",
    what:
      "The properties below are structural design commitments for the rest of the product.",
    why:
      "The guarantees hold everywhere because they are structural: no optional subsystem, no partial install, no second copy of anything.",
    plain: {
      title: "Basic promises",
      what:
        "The properties the rest of the product stands on — each one a permanent design choice.",
      why:
        "The promises hold everywhere because discern builds them in: no optional major part, no half-installation, no second copy of anything.",
    },
    children: [
      {
        id: "agent-is-user",
        kind: "benefit",
        title: "The agent is the user",
        what:
          "Humans install discern and review its Proof; nearly every other surface — the verbs, the tools, the hints, the compiled instructions — is read by an agent, and the interaction design aims at that reader.",
        why:
          "Agents take the intended path by default, whether or not they notice the steering.",
        plain: {
          title: "The coding agent is the main user",
          what:
            "People install discern and review its Proof; a coding agent reads nearly every other surface — the instructions, the tools, the advice notes, the compiled instruction text — and the design aims at that reader.",
          why:
            "Coding agents take the intended path by default, whether they notice the steering or not.",
        },
      },
      {
        id: "context-budget",
        kind: "benefit",
        title: "Context is a budget",
        what:
          "Result surfaces are sized for a context window: oversized diagnostics keep head and tail inline and offload the full text to a named file, search returns at most 5 ranked documents, compiled instructions lists regions rather than leaves, provisioning output appears only on failure, and logbook lines are metadata-only.",
        why:
          "Bounded results preserve the agent's limited context for the work that requires it.",
        plain: {
          title: "Reading space is scarce",
          what:
            "discern sizes results for how much a coding agent can hold in mind at once: long failure output keeps its beginning and end with the full text in a named file, search returns at most five best-matching pages, compiled instructions list regions rather than every page, setup output appears only on failure, and activity-record lines carry basic facts only.",
          why:
            "Bounded results preserve the coding agent's limited reading space for the work that requires it.",
        },
      },
      {
        id: "single-binary",
        kind: "benefit",
        title: "One self-contained binary",
        what:
          "Installer and engine are one program with no runtime dependencies; every verb runs and exits, and discern is never a runtime dependency of the project.",
        why:
          "The installation adds no daemon, project lockfile entry, or separately versioned component.",
        plain: {
          title: "One complete, self-contained program",
          what:
            "The installer and the working core are one program that needs nothing else installed; every instruction runs and exits, and the finished app never needs discern to run.",
          why:
            "The installation adds no always-on service, project dependency, or separately versioned component.",
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
          why: "Reviewing what discern does to a project is reading one file.",
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
            "discern ships none of the project's own build tools: the final check, the named areas, the quality rules, and the supporting services run whatever instructions the project declares, in any language. Its built-in tidier covers only the writing and settings files whose house style discern itself defines.",
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
            "discern contains no AI model and needs no paid access key. Verdicts come from the project's own instructions; the coding agent supplies the intelligence, and discern supplies the judgment infrastructure.",
          why:
            "The final check's answer is reproducible and free, however many times it runs.",
        },
      },
      {
        id: "local-evidence",
        kind: "benefit",
        title: "Evidence stays local",
        what:
          "The logbook and every advisory reader run entirely on the machine. Recording is on by default and can be disabled in project configuration.",
        plain: {
          title: "Evidence stays on the computer",
          what:
            "The activity record and every advice reader run entirely on the machine. Recording is on by default and can be turned off in the project settings.",
        },
      },
      {
        id: "all-subsystems-core",
        kind: "benefit",
        title: "Every subsystem is core",
        what:
          "There are no feature toggles: every verb attaches unconditionally, and configuration tunes behavior rather than enabling it.",
        why:
          "Every install is the same product, so instructions, docs, and habits transfer between projects verbatim.",
        plain: {
          title: "Every major part is always present",
          what:
            "There are no on-off switches for whole features: every instruction is always attached, and settings tune behavior rather than enabling it.",
          why:
            "Every installation is the same product, so instructions, written explanations, and habits carry between projects unchanged.",
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
              "A meta-registry records every canonical set — its single source, its guard tests, its generated artifacts, and its enrollment in the glossary and this canon — and convention sweeps fail the gate when a guard test or generated artifact belongs to no declared set.",
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
        why:
          "Running the product on its own repository exposes engine regressions before release.",
        plain: {
          title: "discern runs on itself",
          what:
            "The discern project itself develops under its own final check, separate working copies, quality rules, project guide, and activity record; a fault in discern surfaces in discern's own `discern done`.",
          why:
            "Running the product on its own project exposes faults before release.",
        },
      },
      {
        id: "interruption-safety",
        kind: "benefit",
        title: "Clean under interruption",
        what:
          "A signal stops and reaps every engine-spawned child tree — gate jobs, worktree lifecycle commands, launched scripts — temp output artifacts are reaped by age from one registry, and orphaned worktree resources are reclaimed by prune.",
        why: "A killed session leaves a machine you'd still want to work on.",
        plain: {
          title: "Clean even when interrupted",
          what:
            "A stop request halts and clears away every piece of work discern started — check work, working-copy setup and cleanup instructions, launched project-specific instructions — one list removes temporary output files by age, and the cleanup step reclaims supporting services left behind by vanished copies.",
          why:
            "A stopped session leaves a machine you would still want to work on.",
        },
      },
    ],
  },
];

/**
 * Closed-set members deliberately NOT claimed by any feature node, each with
 * the reason. Keys are namespaced `<set>:<member>`, exactly as `surfaces`
 * claims are. The enrollment guard holds every member to exactly one of:
 * claimed in the tree, or recorded here.
 */
export const FEATURES_DELIBERATELY_ABSENT: Readonly<Record<string, string>> = {
  "verb:triangle": "intentionally enigmatic, and shrouded in mystery",
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

/**
 * Route one technical-register field through Canon Editor's provenance
 * channel; outside Canon Editor the text passes through unchanged.
 */
function featureProse(node: FeatureNode, field: string, text: string): string {
  return annotateProse(text, { registry: "feature", entry: node.id, field });
}

/** Render one node as a bullet at the given indent depth. */
function renderNode(node: FeatureNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const marker = node.kind === "benefit" ? " *(benefit)*" : "";
  const why = node.why === undefined
    ? ""
    : ` *${featureProse(node, "why", node.why)}*`;
  const lines = [
    `${indent}- **${featureProse(node, "title", node.title)}**${marker} — ${
      featureProse(node, "what", node.what)
    }${why}`,
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
    "Every member of the product's closed sets, with the node that claims it. The enrollment guard (`tests/feature_canon_enrolment_test.ts`) holds this mapping complete and live.",
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

/** The outcome-first coding-agent summary, with the full account linked. */
function renderAgentBenefitSummary(): string[] {
  const lines = [
    "## What the coding agent gains",
    "",
    "_The [Agent Benefit Canon](feature-canon-agent-benefits.md) composes these outcomes from the feature identities below and carries their boundaries, agent hints, and public-claim traceability._",
    "",
  ];
  for (const cluster of AGENT_BENEFIT_CANON) {
    lines.push(
      `- **${agentBenefitProse(cluster.id, "title", cluster.title)}** — ${
        agentBenefitProse(cluster.id, "promise", cluster.promise)
      }`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * Render the maintainer canon page: the at-a-glance pillar list, the
 * coding-agent outcome summary, the full tree at every resolution, and the
 * closed-set coverage appendix.
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
    "_Every product feature and benefit, enumerated once, at every resolution. Creative and technical work reads this canon (or `scripts/feature_registry.ts`, which it compiles from) instead of re-deriving the feature list. The same tree appears in [plain language](feature-canon-plain.md); the [Human Benefit Canon](feature-canon-human-benefits.md) composes commercial human value, and the [Agent Benefit Canon](feature-canon-agent-benefits.md) composes coding-agent outcomes._",
    "",
    "The [Readiness Canon](brand/readiness-canon.md) approaches these mechanisms through the questions people ask before shipping, with routes back to the features and benefits that help answer them.",
    "",
    `${FEATURE_CANON.length} pillars · ${flattened.length} nodes · ${benefits.length} benefit statements · ${AGENT_BENEFIT_CANON.length} agent-benefit clusters · ${claims.length} closed-set claims. Depth is resolution: the pillars provide the shortest account, and the leaves provide the exhaustive one.`,
    "",
    "## At a glance",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    const glance = pillar.why === undefined
      ? featureProse(pillar, "what", pillar.what)
      : featureProse(pillar, "why", pillar.why);
    lines.push(`- **${pillar.title}** — ${glance}`);
  }
  lines.push("");
  lines.push(...renderAgentBenefitSummary());
  for (const pillar of FEATURE_CANON) {
    lines.push(`## ${featureProse(pillar, "title", pillar.title)}`, "");
    lines.push(featureProse(pillar, "what", pillar.what), "");
    if (pillar.why !== undefined) {
      lines.push(`*${featureProse(pillar, "why", pillar.why)}*`, "");
    }
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
  verb: "discern instruction",
  job: "Named kind of project work",
  stage: "Group in the final check",
  config: "Main settings section",
  skill: "Reusable how-to guide",
  agent: "Kind of coding agent",
};

/** Render one node's plain account as a bullet at the given indent depth. */
function renderPlainNode(node: FeatureNode, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const marker = node.kind === "benefit" ? " _(benefit)_" : "";
  const why = node.plain.why === undefined
    ? ""
    : ` _${featureProse(node, "plain.why", node.plain.why)}_`;
  const lines = [
    `${indent}- **${
      featureProse(node, "plain.title", node.plain.title)
    }**${marker} — ${featureProse(node, "plain.what", node.plain.what)}${why}`,
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

/**
 * Render the plain-language canon page: the same tree as
 * {@link renderFeatureCanonDoc}, retold entirely from each node's `plain`
 * account for a non-technical reader (ADR 0228). One tree, two pages: this
 * renderer owns the plain chrome and translated fixed-list titles. Coding-agent
 * outcomes live in their own total transposition rather than a partial twin on
 * this human-readable feature account.
 */
export function renderFeatureCanonPlainDoc(): string {
  const flattened = allFeatureNodes();
  const benefits = flattened.filter(({ node }) => node.kind === "benefit");
  const claims = allSurfaceClaims();
  const lines: string[] = [
    PLAIN_DOCS_BANNER,
    "",
    "# The complete feature guide",
    "",
    "_Every feature and benefit appears here once, in plain language, at every level of detail. Anyone writing, building, or promoting the product reads this guide (or the master list in `scripts/feature_registry.ts`, where every entry sits beside its technical twin) instead of making a new feature list. The same guide in technical language is [feature-canon.md](feature-canon.md); the outcome-first accounts are the [Human Benefit Canon](feature-canon-human-benefits.md) and [Agent Benefit Canon](feature-canon-agent-benefits.md)._",
    "",
    `${FEATURE_CANON.length} main areas · ${flattened.length} detailed entries · ${benefits.length} statements of benefit · ${claims.length} claims about lists with a fixed membership. The top level gives the shortest account, and the deepest level gives the fullest one.`,
    "",
    "## At a glance",
    "",
  ];
  for (const pillar of FEATURE_CANON) {
    const glance = pillar.plain.why === undefined
      ? featureProse(pillar, "plain.what", pillar.plain.what)
      : featureProse(pillar, "plain.why", pillar.plain.why);
    lines.push(`- **${pillar.plain.title}** — ${glance}`);
  }
  lines.push("");
  for (const pillar of FEATURE_CANON) {
    lines.push(
      `## ${featureProse(pillar, "plain.title", pillar.plain.title)}`,
      "",
    );
    lines.push(featureProse(pillar, "plain.what", pillar.plain.what), "");
    if (pillar.plain.why !== undefined) {
      lines.push(
        `_${featureProse(pillar, "plain.why", pillar.plain.why)}_`,
        "",
      );
    }
    for (const child of pillar.children ?? []) {
      lines.push(...renderPlainNode(child, 0));
    }
    lines.push("");
  }
  lines.push(...renderPlainCoverage());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ────────────────────────────────────────────────────────────────────────────
// discern-canon-section: human-benefit
// The human benefit canon — the commercially ordered, outcome-first
// transposition of the feature canon (ADRs 0268 and 0270). Commercial value and the reason it
// follows are separate fields, so the canon can brief persuasive work without
// mixing the benefit with claim-review qualifications. The guards hold
// coverage in both directions: every feature node is cited or recorded absent,
// and every claims-ledger slug is carried by a benefit.
// ────────────────────────────────────────────────────────────────────────────

/** The job one cluster performs in the commercial story. */
export type HumanBenefitCommercialRole =
  | "lead promise"
  | "conversion benefit"
  | "core value"
  | "durable value"
  | "differentiator"
  | "adoption benefit"
  | "trust assurance";

/** The primary readers a benefit cluster may serve, in display order. */
export const HUMAN_BENEFIT_AUDIENCES = [
  "experienced engineers",
  "new consequential builders",
] as const;

/** A primary reader whose situation makes a benefit cluster especially useful. */
export type HumanBenefitAudience = (typeof HUMAN_BENEFIT_AUDIENCES)[number];

/** One benefit: a commercial outcome composed from cited feature nodes. */
export interface HumanBenefitEntry {
  /** Stable kebab-case id, unique across clusters, entries, and feature nodes. */
  id: string;
  /** The human outcome in ordinary language — no trailing period. */
  title: string;
  /** What improves for the user and why that improvement has practical value. */
  value: string;
  /** The factual or deductive chain from product behavior to the stated value. */
  whyItFollows: string;
  /** Feature-node ids this benefit composes — explicit citations, the same discipline as `surfaces`. */
  drawsOn: readonly string[];
  /** Public-claims-ledger slugs this benefit backs (compile-time checked against the ledger). */
  claims?: readonly ClaimSlug[];
}

/** One cluster: a commercially ranked family of human outcomes. */
export interface HumanBenefitCluster {
  /** Stable kebab-case id, unique across the Human Benefit Canon and feature tree. */
  id: string;
  /** The outcome family in ordinary language — no trailing period. */
  title: string;
  /** The cluster's job in the commercial story. */
  role: HumanBenefitCommercialRole;
  /** The readers for whom this cluster is most immediately valuable. */
  primaryFor: readonly HumanBenefitAudience[];
  /** The human promise shared by the cluster's entries. */
  promise: string;
  /** Why the cluster matters in time, capacity, confidence, continuity, or control. */
  commercialValue: string;
  readonly benefits: readonly HumanBenefitEntry[];
}

/** The category that gives the commercial benefits a literal product context. */
export const HUMAN_BENEFIT_CANON_CATEGORY =
  "discern is an engineering practice for agent-built software, installed in the project.";

/** The Human Benefit Canon's master promise. */
export const HUMAN_BENEFIT_CANON_PROMISE =
  "discern lets one person give coding agents substantial, complete pieces of work without personally coordinating every task, repeating the project context, or reconstructing which checks passed.";

/** The practical value created when the master promise is true. */
export const HUMAN_BENEFIT_CANON_COMMERCIAL_VALUE =
  "More of the backlog can move at once. The person spends less time running the workflow, and completed changes return with the evidence needed to decide what ships.";

/**
 * The Human Benefit Canon. Cluster order is commercial order: lead with ambition and
 * returned attention, establish confidence and compounding value, then support
 * adoption, differentiation, and trust.
 */
export const HUMAN_BENEFIT_CANON: readonly HumanBenefitCluster[] = [
  {
    id: "build-further",
    title: "Take the project further",
    role: "lead promise",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "discern helps one person direct more substantial agent work while the project carries the coordination required to keep that work separate and moving.",
    commercialValue:
      "More of a backlog can progress at once without adding the same amount of scheduling, workspace administration, and message relaying to the human's day.",
    benefits: [
      {
        id: "shape-substantial-work",
        title: "Turn a large objective into work agents can carry",
        value:
          "A broad goal can become complete handoffs, parallel streams, or a staged program. One person can move more of the backlog while each agent receives enough context and a clear boundary to do meaningful work.",
        whyItFollows:
          "The Delegate Work Skill identifies real seams, writes self-contained briefs, records dependencies and authority, and requires independent review; `discern start` gives each resulting task a prepared worktree.",
        drawsOn: ["skill-delegate-work", "start"],
        claims: ["shaped-delegation"],
      },
      {
        id: "parallel-work-on-one-machine",
        title: "Keep several tasks moving at the same time",
        value:
          "Agents can work concurrently without overwriting the same checkout or competing for the same declared port, site, database, or resource. Parallel work becomes practical on one machine instead of creating a workspace administration job.",
        whyItFollows:
          "Each worktree receives a separate checkout and deterministic identity, inherits declared environment values, provisions its own declared resources, and appears in a fleet view that reports overlapping source files before integration. The worktree shell picker moves between those checkouts at the same project-relative directory.",
        drawsOn: [
          "worktree-identity",
          "worktree-resources",
          "env-inheritance",
          "fleet",
          "worktree-shell-picker",
        ],
        claims: ["no-checkout-collisions"],
      },
      {
        id: "wait-without-relay",
        title: "Stop playing messenger between your agents",
        value:
          "A later task can pause until a sibling is proven, its work lands, or the trunk changes. The person does not have to poll sessions or carry status updates between agents.",
        whyItFollows:
          "`discern await` blocks on an authoritative repository condition and returns a continuation when the reliable call window ends; the Await the Fleet Skill makes that wait the agent's operating procedure.",
        drawsOn: ["await", "skill-await-the-fleet"],
      },
      {
        id: "compose-staged-work",
        title: "Start the next task before the last one lands",
        value:
          "A dependent task can build from a proven sibling commit while the earlier branch waits for acceptance. Several branches can be assembled and checked as one combined tree before anything reaches the trunk, while each landing decision remains separate.",
        whyItFollows:
          "`discern start` and `discern update` accept a source ref, so an integration effort can fork from one precise commit, pull in sibling branches, and run the ordinary Gate over their combined tree; only `discern accept` can move the trunk.",
        drawsOn: ["compose-below-trunk", "update", "gate", "accept"],
      },
      {
        id: "land-finished-work-as-the-project-moves",
        title: "Keep finished work moving as the project moves",
        value:
          "Another task landing first does not have to send yours back through a routine handoff. discern can join the changes, check them together, and land the result while the author keeps working in the same place.",
        whyItFollows:
          "Acceptance retains the submitted revision, waits its turn, and creates an integration worktree when the trunk moved. The combined Gate and authority check precede landing; conflicts and failed checks return to the author.",
        drawsOn: [
          "integration-landings",
          "landing-turn",
          "landing-queue-walk",
          "submission-only",
          "accept",
        ],
      },
      {
        id: "resume-later",
        title: "Walk away mid-task and pick up where you left off",
        value:
          "A task can outlive one agent session. Whoever returns can recover the worktree, setup state, and next action instead of reconstructing the task from conversation history.",
        whyItFollows:
          "Worktrees persist, lifecycle hooks re-ready a resumed checkout, unfinished setup remains machine-readable, idempotent verbs converge on the intended state, `discern status` supplies a fresh orientation in one call, and `discern progress` reads a long run back after a closed terminal or a timed-out call instead of running it again.",
        drawsOn: [
          "status",
          "progress",
          "session-hooks",
          "setup-observability",
          "setup-activation",
          "idempotent-verbs",
        ],
      },
    ],
  },
  {
    id: "return-human-attention",
    title: "Spend more time on the product",
    role: "conversion benefit",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "discern handles routine checking, status, and tool operation around agent work so the responsible person can focus on behavior, design, priorities, risk, and what ships.",
    commercialValue:
      "Each additional agent task demands less status chasing, check verification, and workspace administration from the person responsible for the project.",
    benefits: [
      {
        id: "reduce-routine-review",
        title: "Review less, knowing what already passed",
        value:
          "Proof removes a category of review work: reconstructing whether the declared checks ran, whether they passed, and which change they covered. Review time can move to behavior, design, risk, and the decision to ship.",
        whyItFollows:
          "The Gate runs the project's declared checks and Standards before Proof records the result against the clean committed tree, so the check status arrives as inspectable evidence rather than an unsupported completion message.",
        drawsOn: ["gate", "proof", "standards", "producer-evidence"],
        claims: ["reduced-review-burden"],
      },
      {
        id: "judgment-at-the-change",
        title: "Ask the judgment questions when the change happens",
        value:
          "The review questions that need a person's kind of judgment are asked at the moment a matching change exists, and the recorded answer travels with the evidence — qualified as the agent's declared judgment, with the final say on an unmet one held by the responsible person.",
        whyItFollows:
          "A checkpoint pairs a deterministic trigger with a question; a fired stop checkpoint refuses the Gate until a conclusion is declared, the Proof carries declared conclusions separately from machine results, and a declared-unmet conclusion lands only under an owner-authorized variance.",
        drawsOn: [
          "checkpoints",
          "checkpoint-ci-report",
          "checkpoint-drops",
          "checkpoint-question-files",
          "skill-place-a-checkpoint",
        ],
      },
      {
        id: "decisions-in-one-view",
        title: "See which tasks need a decision",
        value:
          "One view shows work in flight grouped by the decision it needs and offers the actions that are valid in the current state. The person can return at decision points instead of opening every session to ask for status.",
        whyItFollows:
          "The Desk presents current tasks in a stable order while observations refresh, and its tips teach relevant capabilities without requiring a separate tour of the command line.",
        drawsOn: [
          "desk",
          "tips",
          "bounded-status-projection",
          "owner-attention",
        ],
      },
      {
        id: "useful-failures-sooner",
        title: "Get useful failures sooner",
        value:
          "When work is not ready, the agent receives a focused failure, the relevant output, and a reproducing command as early as the pipeline can provide them. Shorter feedback loops mean less time waiting on doomed runs and less context lost to diagnosis.",
        whyItFollows:
          "`discern prepare` supplies the fast fix-and-check loop; staging, cancellation, time budgets, strand detection, write preflight, captured diagnostics, live output, focused tests, and explicit reruns stop or explain failed work at the earliest reliable point.",
        drawsOn: [
          "prepare",
          "test-verb",
          "staged-pipeline",
          "fail-fast",
          "job-timeouts",
          "capture-environment",
          "gate-streaming",
          "strand-detection",
          "diagnostics",
          "failure-recovery-contract",
          "unchanged-tree-rerun",
          "write-preflight",
        ],
      },
      {
        id: "catch-related-files",
        title: "Catch related files before the change closes",
        value:
          "The project can point out files that usually change together while the task is still open. That lowers the chance of discovering a missing companion during review or after the branch has moved on.",
        whyItFollows:
          "`discern coupling` mines the repository's own co-change history, attaches the evidence behind each suggestion, and reports habitual partners missing from the current change.",
        drawsOn: ["coupling"],
      },
      {
        id: "run-relevant-checks",
        title: "Run the checks relevant to this change",
        value:
          "A focused change can avoid unrelated scope gates and repeated measurements while every check classified as relevant still runs. Agents get faster feedback without turning optimization into a bypass.",
        whyItFollows:
          "Scopes wake checks from the changed paths, classification fails open when uncertain, `discern impact` explains the decision, and input-keyed replay reuses a Standard measurement only when its declared inputs are unchanged.",
        drawsOn: [
          "scope-gates",
          "fail-open-classification",
          "impact",
          "standards-replay",
        ],
      },
      {
        id: "context-for-the-task",
        title: "Use agent context on the task itself",
        value:
          "Agents receive bounded results, task-ranked documentation, curated procedures, and relevant advice at the moment it applies. Less context is spent rediscovering the tool, leaving more for understanding and changing the project.",
        whyItFollows:
          "discern treats the agent as its principal operator, budgets every returned surface, curates the Skill set, and delivers advisories inside results the agent already needs to read.",
        drawsOn: [
          "agent-is-user",
          "context-budget",
          "authored-markdown-results",
          "skills-curation",
          "insight",
        ],
        claims: ["agent-as-operator"],
      },
    ],
  },
  {
    id: "know-what-is-ready",
    title: "Know what is ready",
    role: "core value",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "discern turns completion from a conversational assertion into inspectable evidence about one committed change.",
    commercialValue:
      "The user can make faster, better-informed release decisions because the status of the declared checks and the scope of the evidence are already clear.",
    benefits: [
      {
        id: "project-defined-completion",
        title: "Know when the project's own checks have passed",
        value:
          "Finished work comes with the result of the checks this project chose to require. The user does not have to infer readiness from the agent's confidence or ask which routine commands were run.",
        whyItFollows:
          "`discern done` runs the declared format, build, lint, typecheck, test, and smoke jobs by stage, wakes the scope gates touched by the change, and measures the configured Standards before it can report a pass.",
        drawsOn: [
          "gate",
          "jobs-table",
          "job-format",
          "job-build",
          "job-lint",
          "job-typecheck",
          "job-test",
          "job-smoke",
        ],
      },
      {
        id: "evidence-for-this-change",
        title: "Get proof of what passed, tied to the commit it passed on",
        value:
          "A Proof names the version checked and the evidence behind it. If other work lands first, discern checks the combined result before sharing it and retains the submitted version in that result's history. The person can see what passed for the work that actually joined the project.",
        whyItFollows:
          "The Gate pins and checks a committed tree. Acceptance freezes the submission before waiting, reuses its Proof for a direct landing, or obtains Proof for the combined tree in an integration worktree. The final record distinguishes the submitted source from the tested result.",
        drawsOn: ["integration-landings", "proof", "accept"],
        claims: ["proof-exact-tree"],
      },
      {
        id: "evidence-that-lasts",
        title: "Keep the completion record with the code",
        value:
          "The evidence survives after the temporary task environment is removed. A future maintainer can recover what was checked for the landed commit instead of depending on an old chat transcript.",
        whyItFollows:
          "Acceptance writes the structured Proof onto the trunk commit as a durable Git note tied to the identity of that commit.",
        drawsOn: ["proof-notes"],
      },
      {
        id: "explicit-release-decision",
        title: "Keep the final say over what ships",
        value:
          "Passing checks makes a change ready for a decision. The responsible person, or a grant they recorded, still decides whether that exact change becomes shared. They can hold or withdraw it and revise its order without discarding valid evidence.",
        whyItFollows:
          "`discern accept` checks conversational consent or a recorded grant against the actual landing diff, including a combined result. An explicitly selected queue walk checks each later submission's own authority; consent for the selected work never spreads to the rest.",
        drawsOn: ["consent-attestations", "accept"],
        claims: ["gate-grants-no-authority"],
      },
      {
        id: "bounded-standing-permission",
        title: "Pre-approve routine changes within clear boundaries",
        value:
          "A person can pre-authorize a tightly defined scope, such as documentation, and route everything outside that scope for fresh review. Repeated low-risk approvals disappear while permission remains bounded by the files that changed.",
        whyItFollows:
          "The acceptance policy records allowed scopes on the trunk, the Desk can record one effort's grant, and every acceptance recalculates coverage from the final changed paths.",
        drawsOn: ["consent-attestations", "desk"],
      },
      {
        id: "unfinished-work-stays-isolated",
        title: "Keep unfinished work away from the shared branch",
        value:
          "Each discern task can change, fail, and recover in its own checkout and branch. When discern lands that work, the shared branch moves only after the task is accepted.",
        whyItFollows:
          "`discern start` creates an isolated worktree, and acceptance keeps any combined checking in its own integration copy. The trunk advances only to the exact authorized result whose checks passed.",
        drawsOn: ["worktrees", "start", "accept"],
        claims: ["isolated-worktrees"],
      },
      {
        id: "recover-interrupted-operations",
        title: "Preview changes and recover cleanly",
        value:
          "Before a command changes the project, its planned effects can be inspected without applying them. If an operation is interrupted, enough state remains to resume or repair it without guessing which effects happened. Less time is lost to avoidable surprises and incomplete states.",
        whyItFollows:
          "Effectful verbs compute a read-only plan before a thin executor applies it; `--dry-run` renders that plan and applies nothing. Provisioning intent and transition state are recorded before acting, and cleanup and recovery paths handle interruptions.",
        drawsOn: [
          "plan-apply",
          "crash-safe-provisioning",
          "interruption-safety",
        ],
      },
    ],
  },
  {
    id: "make-improvement-accumulate",
    title: "Keep the gains the project earns",
    role: "durable value",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "discern turns hard-won improvements into conditions future work must preserve.",
    commercialValue:
      "The codebase can become easier to trust and maintain over time because later branches start from retained gains instead of renegotiating them.",
    benefits: [
      {
        id: "retain-measured-gains",
        title: "Keep measurable quality gains from slipping backward",
        value:
          "Once a configured measure improves, a later branch cannot weaken its limit merely to make new work pass. The project keeps the ground it has already earned.",
        whyItFollows:
          "Every Gate compares each Standard with the trunk's committed limit and rejects a floor that fell or a ceiling that rose.",
        drawsOn: ["standards", "standards-direction"],
        claims: ["standards-cannot-loosen"],
      },
      {
        id: "pin-new-baseline",
        title: "Make today's improvement tomorrow's starting point",
        value:
          "A measured gain can become the baseline every future branch inherits. Improvements stop being encouraging moments in a report and become part of the project's working conditions.",
        whyItFollows:
          "`discern standards --pin` tightens an improved limit to the measured value, applies the configured margin, and commits that limit change on its own.",
        drawsOn: ["standards-pin", "standards-margin"],
        claims: ["pin-measured-gains"],
      },
      {
        id: "standards-that-scale",
        title: "Use standards that stay useful as the project grows",
        value:
          "Quality measures can remain meaningful without making every small change pay the full measurement cost or treating healthy project growth as regression. A genuine breach caused by the work reaches the person responsible for the limit.",
        whyItFollows:
          "Rates scale with project size, replay keys measurements to declared inputs, complete evidence joins required measurements and limit verification, any one-line metric can participate, and breach escalation refuses to move the limit automatically.",
        drawsOn: [
          "standards-rates",
          "standards-replay",
          "standards-complete-evidence",
          "standards-escalation",
          "standards-metric-protocol",
        ],
      },
      {
        id: "remove-bug-class",
        title: "Remove the cause and guard every instance of the bug class",
        value:
          "A repair can cover every current instance and automatically enroll future members in the same protection. The same defect cannot pass that guard in another member, so review and debugging time are not spent on a repeat that should have been eliminated.",
        whyItFollows:
          "The Cure a Bug Skill requires a proven cause, a class-wide fix, and a guard driven from the canonical membership source; forcing-function and canonical-set checks make new members join that guard.",
        drawsOn: ["skill-cure-a-bug", "forcing-functions", "canonical-sets"],
      },
      {
        id: "retire-old-pattern",
        title: "Retire an old pattern across the codebase",
        value:
          "A migration gains a measurable finish line, the remaining count can only fall, and new uses are blocked once the count reaches zero. The old way stops reappearing behind the work already completed.",
        whyItFollows:
          "The Set the Standard Skill pairs a repository-wide detector with a falling ceiling, then replaces the temporary ceiling with a permanent zero rule.",
        drawsOn: ["skill-set-the-standard"],
      },
      {
        id: "keep-clutter-down",
        title: "Keep maintenance clutter from growing back",
        value:
          "Cleanup can reduce duplicated helpers, dead code, stale scaffolding, and format churn while a measured ceiling prevents the remaining count from rising. The codebase does not have to repeat the same cleanup campaign every few months.",
        whyItFollows:
          "The Clear the Decks Skill requires proven-safe cleanup commits and a Standard over what remains; `discern tidy` gives discern-owned prose and configuration one convergent format.",
        drawsOn: ["skill-clear-the-decks", "tidy"],
      },
      {
        id: "catch-documentation-breakage",
        title: "Catch broken project documentation before it lands",
        value:
          "Broken links, stale generated pages, invalid command examples, and malformed optional metadata can fail alongside code. Agents and people spend less time following instructions whose mechanics no longer work.",
        whyItFollows:
          "The Map preflight validates links, anchors, commands, optional metadata, and Skill references. Generated-artifact declarations and fail-fast preconditions catch drift in configured outputs. Agents review whether the explanations remain true.",
        drawsOn: [
          "docs-integrity",
          "generated-artifact-declarations",
          "gate-preconditions",
          "publish-predicate",
        ],
        claims: ["map-mechanically-checked"],
      },
      {
        id: "improve-practice-from-evidence",
        title: "Improve the way the agents work from real evidence",
        value:
          "Recurring friction, slow stages, adoption gaps, and quality trends become counted findings rather than anecdotes. The person can improve instructions, configuration, or checks where the local evidence says the practice is losing time.",
        whyItFollows:
          "The local Logbook records metadata about discern's use, `discern patterns` analyzes comparable events and cohorts with denominators, and `discern improvement` ranks the next supported action without grading individual agents.",
        drawsOn: [
          "patterns",
          "patterns-investigations",
          "improvement",
          "logbook",
        ],
        claims: ["patterns-compare-cohorts"],
      },
    ],
  },
  {
    id: "keep-project-knowledge-working",
    title: "Keep project knowledge available",
    role: "durable value",
    primaryFor: [
      "experienced engineers",
      "new consequential builders",
    ],
    promise:
      "discern stores decisions, expectations, and working methods in project-owned forms every future session can use.",
    commercialValue:
      "Each task begins with more accumulated context, reducing repeated explanation, rediscovery, and dependence on one person's memory.",
    benefits: [
      {
        id: "teach-project-once",
        title: "Teach the project once",
        value:
          "A lesson captured after one task can guide later sessions and every configured agent provider. Repeated explanation becomes a reusable project asset instead of a recurring cost paid in prompts and corrections.",
        whyItFollows:
          "One authored instruction source compiles into every provider's instruction file, reusable Skills carry procedures, conditional instructions keep the result project-specific, and the Teach the Project Skill routes each lesson into its smallest durable home.",
        drawsOn: [
          "instructions",
          "instructions-compile",
          "instructions-conditionals",
          "skills",
          "skill-teach-the-project",
        ],
        claims: ["one-instruction-source"],
      },
      {
        id: "inspect-agent-understanding",
        title: "See what agents understand about the project",
        value:
          "The human can inspect a readable account of the architecture, conventions, and subsystem knowledge agents are using. Project understanding no longer has to remain hidden inside session history.",
        whyItFollows:
          "Agents maintain the Map using compiled instructions, setup examples, and checkpoints. Page-specific source evidence identifies explanations to review; the owner can inspect the account agents work from.",
        drawsOn: ["map", "map-freshness"],
      },
      {
        id: "preserve-decision-reasons",
        title: "Preserve why a decision was made",
        value:
          "Future agents and maintainers can recover the context and trade-offs behind a significant choice. They are less likely to reopen a settled question or repeat an alternative already rejected for a good reason.",
        whyItFollows:
          "The decision-record discipline stores context, decision, consequences, and alternatives in a canonical project location, and the Write an ADR Skill guides the author through the threshold and format.",
        drawsOn: ["adr-discipline", "skill-write-adr"],
      },
      {
        id: "instructions-at-failure",
        title: "Put the right instructions beside the failure",
        value:
          "An agent can meet a known recovery procedure at the moment the matching problem appears. Recurring knowledge does not depend on somebody remembering the relevant note or searching for it under pressure.",
        whyItFollows:
          "Matched gotchas and registered hints are inserted into the same structured result that reports the failure or state that made them relevant.",
        drawsOn: ["gotchas-pointer", "hints"],
      },
      {
        id: "orient-new-session",
        title: "Bring a new session up to speed quickly",
        value:
          "A fresh agent can find the project's current state, the right documentation, and the canonical command without receiving the entire manual in its prompt. Less time is lost at the beginning of resumed or reassigned work.",
        whyItFollows:
          "The discovery funnel ranks pages from task language, the bundled manual works offline, generated help mirrors the live command tree, and forgiving command parsing redirects renamed or synonymous requests.",
        drawsOn: [
          "discovery-funnel",
          "bundled-docs",
          "cli-help",
          "forgiving-cli",
        ],
      },
      {
        id: "export-project-briefing",
        title: "Export the right project briefing for the next reader",
        value:
          "A new person or agent can receive the relevant project pages in a defined order instead of a documentation dump. Briefings become repeatable and easier to tailor to the work ahead.",
        whyItFollows:
          "`discern map --export` writes the public projection, an explicit selection, or a named scope's ordered reading list into one portable file.",
        drawsOn: ["map-browser"],
      },
      {
        id: "reuse-engineering-discipline",
        title: "Carry proven engineering practices between projects",
        value:
          "A project can adopt disciplines for shared facts, growing canonical sets, and safe effects without inventing each method from scratch. Good construction practice becomes portable knowledge.",
        whyItFollows:
          "The Write It Once Skill packages discern's own discipline around one authority per fact, automatic enrollment for future members, and planning effects before execution in a stack-neutral playbook.",
        drawsOn: ["skill-write-it-once"],
      },
    ],
  },
  {
    id: "put-practice-in-place",
    title: "Put a serious practice in place",
    role: "adoption benefit",
    primaryFor: ["new consequential builders", "experienced engineers"],
    promise:
      "A coding agent can study the repository and establish discern's working practice, while the person supplies the intent and decisions the code cannot reveal.",
    commercialValue:
      "Adoption does not require the human to become the integration engineer for a new platform, and the project proves the setup before treating it as ready.",
    benefits: [
      {
        id: "agent-commissioning",
        title: "Have your agent set up the practice for this project",
        value:
          "The human can add a project-specific engineering practice without manually configuring every check, instruction file, and worktree condition. Their effort goes into intent and consequential choices while the agent handles repository study and implementation.",
        whyItFollows:
          "The setup agent detects installed providers, studies the repository before asking one concise batch of questions, configures the project's real jobs and instructions, relays consent points clearly, and refuses completion until the Gate and a throwaway worktree probe pass.",
        drawsOn: [
          "setup",
          "relay-messages",
          "agent-autodetect",
        ],
        claims: [
          "installs-a-practice",
          "no-manual-configuration",
          "setup-proves-worktree",
        ],
      },
      {
        id: "small-installation-footprint",
        title: "Adopt discern without running another service",
        value:
          "discern arrives as one self-contained binary and keeps project-specific settings in one root file.",
        whyItFollows:
          "The installer lays down the binary and integration surfaces, while the one-file footprint points to authored or generated project assets.",
        drawsOn: [
          "install",
          "one-file-footprint",
          "single-binary",
        ],
        claims: ["one-config-file"],
      },
      {
        id: "inspect-live-example",
        title: "Inspect discern working under its own practice",
        value:
          "discern's own repository is a complete internal working example. Its changes use the same Gate, worktrees, Standards, Map, and Logbook it asks other projects to adopt.",
        whyItFollows:
          "The discern repository is configured as a discern project and runs development work through the product's own lifecycle and quality conditions.",
        drawsOn: ["dogfooding"],
        claims: ["runs-on-itself"],
      },
      {
        id: "clean-abandoned-environments",
        title: "Clean up abandoned tasks without a cliff edge",
        value:
          "Recent committed work from a mistaken task removal still has a direct route back, while positively identified worktrees and resources can be reclaimed without treating unrelated refs or untracked work as disposable. Long-running use does not have to leave ports, databases, directories, and hidden edits accumulating on the machine.",
        whyItFollows:
          "Before drop removes an owned branch, discern keeps its committed tip in a bounded local recovery list. `discern worktree prune` requires recorded ownership, verifies path and Git-registration absence, plans orphan resource cleanup, and reports ignored-file drift before removal can proceed.",
        drawsOn: ["drop-recovery", "worktree-prune", "ignored-drift"],
      },
    ],
  },
  {
    id: "change-tools-without-starting-over",
    title: "Change tools without starting over",
    role: "differentiator",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "The project's way of working belongs to the project, so agents, stacks, and surrounding tooling can change without taking accumulated practice with them.",
    commercialValue:
      "Provider switching costs fall, subscriptions and capacity become easier to juggle, and investment in instructions and quality remains useful as the market changes.",
    benefits: [
      {
        id: "switch-providers",
        title: "Switch coding agents without re-teaching the project",
        value:
          "A provider change does not require the project explanation, working methods, and quality conditions to be rebuilt from scratch. The accumulated investment remains useful when preferences, model quality, quotas, or subscriptions change.",
        whyItFollows:
          "Agent instructions, Skills, Map, Gate, Standards, and worktree practice remain project-owned, while the provider registry generates each configured agent's instruction file, Skill materialization, hooks, and MCP wiring.",
        drawsOn: [
          "providers",
          "provider-claude-code",
          "provider-codex",
          "provider-gemini",
          "provider-cursor",
          "provider-copilot",
          "skills-materialization",
          "mcp-surface",
        ],
        claims: ["switch-without-reteaching"],
      },
      {
        id: "practice-across-stacks",
        title: "Use the same working practice across different stacks",
        value:
          "The habits, instructions, documentation discipline, and acceptance model can move between projects that use different languages and tools. Learning the practice creates value beyond one codebase.",
        whyItFollows:
          "discern ships none of the project's stack tools, runs the commands each project declares, and keeps every subsystem available through the same stack-neutral foundation.",
        drawsOn: ["stack-neutral", "all-subsystems-core", "foundations"],
      },
      {
        id: "build-on-published-contracts",
        title: "Build integrations against published contracts",
        value:
          "A project can automate or extend discern without scraping terminal prose or depending on hidden internal state. The same structured result can support humans, agents, scripts, and custom tooling.",
        whyItFollows:
          "One result envelope backs terminal, JSON, Markdown, and MCP presentations; generated schemas and TypeScript declarations publish from the build; project scripts receive a declared environment; output follows automation conventions; and local commands expose configuration and license facts.",
        drawsOn: [
          "interfaces",
          "result-envelope",
          "published-contracts",
          "project-scripts",
          "output-discipline",
          "config-command",
          "licenses",
        ],
      },
      {
        id: "planned-upgrades",
        title: "Choose when to upgrade",
        value:
          "Choose a convenient time to update, review what will change, and bring teammates along.",
        whyItFollows:
          "Release notes show what's new, upgrade previews show the project changes, and discern tells teammates when their version needs updating.",
        drawsOn: ["upgrade", "doctor", "release-awareness"],
      },
      {
        id: "retain-work-after-uninstall",
        title: "Uninstall cleanly and keep everything you wrote",
        value:
          "Agent instructions, project knowledge, Skills, scripts, and configuration remain ordinary files the project can continue to use. Trying discern does not turn that investment into hostage data or disposable setup work.",
        whyItFollows:
          "`discern uninstall` derives the removable integration wiring from the ownership registry and leaves the project's authored files at the paths it chose.",
        drawsOn: ["uninstall", "ownership-buckets"],
      },
    ],
  },
  {
    id: "keep-control",
    title: "Keep control of the project",
    role: "trust assurance",
    primaryFor: ["experienced engineers", "new consequential builders"],
    promise:
      "discern runs locally, acts only through explicit authority, and keeps its operating boundaries inspectable.",
    commercialValue:
      "The practice can support serious work without introducing a hosted control plane, another model, or an opaque decision-maker.",
    benefits: [
      {
        id: "local-without-another-model",
        title: "Run discern locally without another model or API key",
        value:
          "Using discern adds no model call or API-key requirement of its own. Its activity record stays on the machine, contains metadata rather than code or command output, and can be turned off.",
        whyItFollows:
          "discern is a deterministic local binary with no network interfaces in its code path, while the Logbook and its analysis use repository-local evidence and have an explicit disable switch.",
        drawsOn: ["no-model-inside", "local-evidence", "logbook"],
        claims: ["no-model-inside", "local-logbook"],
      },
      {
        id: "explicit-write-authority",
        title: "Make write authority explicit",
        value:
          "An agent or integration can call discern knowing that the operation must prove it is allowed to write where it intends. The person retains a visible boundary around effects that change the project or machine.",
        whyItFollows:
          "Effectful verbs verify placement and transcript consent before writing, an architectural test keeps destructive operations outside locations that have not licensed them, and discern-owned Git writers prove the process can write their declared Git boundary before entering the command body.",
        drawsOn: ["placement-consent", "write-preflight"],
      },
    ],
  },
];

/**
 * Feature nodes deliberately cited by NO benefit, each with the reason. The
 * coverage guard holds every feature node to exactly one of: cited in a
 * benefit's `drawsOn`, or recorded here. Empty at introduction — every
 * feature node carries at least one human benefit — and staying empty is the
 * aspiration, not a requirement: infrastructure with no distinct owner
 * outcome belongs here rather than behind a strained citation.
 */
export const HUMAN_BENEFIT_COVERAGE_ABSENCES: Readonly<Record<string, string>> =
  {};

/** One flattened benefit entry with its cluster. */
export interface FlattenedHumanBenefit {
  cluster: HumanBenefitCluster;
  entry: HumanBenefitEntry;
}

/** Every benefit entry in authoring order, flattened with its cluster. */
export function allHumanBenefitEntries(
  canon: readonly HumanBenefitCluster[] = HUMAN_BENEFIT_CANON,
): FlattenedHumanBenefit[] {
  const out: FlattenedHumanBenefit[] = [];
  for (const cluster of canon) {
    for (const entry of cluster.benefits) out.push({ cluster, entry });
  }
  return out;
}

/** Where the generated Human Benefit Canon page lives inside the map. */
export const FEATURE_CANON_HUMAN_BENEFITS_PAGE_REL: string = join(
  "_internal",
  "feature-canon-human-benefits.md",
);

/** The banner stamped atop the generated Human Benefit Canon page. */
const HUMAN_BENEFITS_DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the feature registry (scripts/feature_registry.ts) — do NOT edit by hand. Change a benefit entry there and regenerate. -->";

/**
 * Route one human-benefit field through Canon Editor's provenance channel;
 * outside Canon Editor the text passes through unchanged.
 */
function humanBenefitProse(entry: string, field: string, text: string): string {
  return annotateProse(text, { registry: "benefit", entry, field });
}

/** The feature-node titles by id, for resolving `drawsOn` citations loudly. */
function featureTitlesById(): Map<string, string> {
  return new Map(
    allFeatureNodes().map(({ node }) => [node.id, node.title]),
  );
}

/** Resolve one cited feature id to its title, or throw on a stranded citation. */
function citedTitle(titles: Map<string, string>, id: string): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`Human Benefit Canon cites unknown feature node: ${id}`);
  }
  return title;
}

/**
 * Render the Human Benefit Canon: the commercial center, ranked clusters,
 * human value, reasons each value follows, and the traceability appendix.
 */
export function renderFeatureCanonHumanBenefitsDoc(): string {
  const titles = featureTitlesById();
  const flattened = allHumanBenefitEntries();
  const citedIds = new Set(
    flattened.flatMap(({ entry }) => [...entry.drawsOn]),
  );
  const claimSlugs = new Set(
    flattened.flatMap(({ entry }) => [...(entry.claims ?? [])]),
  );
  const nodeCount = allFeatureNodes().length;
  const ledgerCount = Object.keys(CLAIMS).length;
  const lines: string[] = [
    HUMAN_BENEFITS_DOCS_BANNER,
    "",
    "# Human Benefit Canon",
    "",
    "_discern's internal commercial account of what the product gives people. It is designed to brief strategy, marketing, sales, and copywriting work. Each benefit states the human value first and then explains why that value follows from product facts. It is source material rather than finished public copy. The [feature canon](feature-canon.md) owns the mechanism account; the [Agent Benefit Canon](feature-canon-agent-benefits.md) owns the corresponding coding-agent outcomes; the [claims ledger](brand/claims-and-evidence.md) owns the boundaries of exact public claims._",
    "",
    "Start from a concern in the [Readiness Canon](brand/readiness-canon.md) when the reader recognizes a release question before they know the product. Its feature routes introduce the relevant human value here.",
    "",
    `${HUMAN_BENEFIT_CANON.length} clusters · ${flattened.length} benefits · ${citedIds.size} of ${nodeCount} feature nodes cited · ${claimSlugs.size} of ${ledgerCount} public claims carried.`,
    "",
    "## How to use this canon",
    "",
    "- Start with the value or commercial value. Use the product mechanism only when the reader needs a reason to believe it.",
    "- Follow the Role and Audience labels. Lead promises create desire; conversion benefits make the purchase useful now; durable value, differentiators, adoption benefits, and trust assurances support the decision.",
    "- Treat a reasoned consequence as real value when its premises are product facts and its conclusion stays within what those facts establish. Population claims and quantified results still require the appropriate customer evidence. Direct causal consequences stand on the product facts that produce them.",
    "- Check the claims ledger before publishing exact claim language. Keep its qualification work out of the benefit unless the proposed public line crosses that boundary.",
    "- Select the smallest set of benefits that serves the audience and surface. Build the page around its own audience and argument.",
    "",
    "## Commercial center",
    "",
    `**Category:** ${HUMAN_BENEFIT_CANON_CATEGORY}`,
    "",
    `> ${HUMAN_BENEFIT_CANON_PROMISE}`,
    "",
    HUMAN_BENEFIT_CANON_COMMERCIAL_VALUE,
    "",
    "## At a glance",
    "",
    "| Role | Benefit territory | Audience | Commercial value |",
    "| --- | --- | --- | --- |",
  ];
  // The at-a-glance table stays unannotated: the formatter pads every cell
  // to the column's widest content, so an in-cell marker would widen the
  // committed layout. Each cell's field is editable at its cluster section.
  for (const cluster of HUMAN_BENEFIT_CANON) {
    lines.push(
      `| ${cluster.role} | **${cluster.title}** | ${
        cluster.primaryFor.join(", ")
      } | ${cluster.commercialValue} |`,
    );
  }
  lines.push("");
  for (const cluster of HUMAN_BENEFIT_CANON) {
    lines.push(
      `## ${humanBenefitProse(cluster.id, "title", cluster.title)}`,
      "",
      `* **Role:** ${cluster.role}`,
      `* **Promise:** ${
        humanBenefitProse(cluster.id, "promise", cluster.promise)
      }`,
      `* **Commercial value:** ${
        humanBenefitProse(
          cluster.id,
          "commercialValue",
          cluster.commercialValue,
        )
      }`,
      `* **Audience:** ${cluster.primaryFor.join(", ")}`,
      "",
    );
    for (const entry of cluster.benefits) {
      const drawn = entry.drawsOn
        .map((id) => citedTitle(titles, id))
        .join(" · ");
      lines.push(
        `### ${humanBenefitProse(entry.id, "title", entry.title)}`,
        "",
        `* **Value:** ${humanBenefitProse(entry.id, "value", entry.value)}`,
        `* **Mechanism:** ${
          humanBenefitProse(entry.id, "whyItFollows", entry.whyItFollows)
        }`,
        `* **Product basis:** ${drawn}.`,
        "",
      );
    }
  }
  lines.push("## Coverage and claim traceability", "");
  const absences = Object.entries(HUMAN_BENEFIT_COVERAGE_ABSENCES);
  lines.push(
    `Every feature node is cited by a benefit or recorded absent below; every public claim in the ledger has a benefit-shaped home. The guard (\`tests/feature_canon_human_benefit_test.ts\`) holds both directions. Claim evidence classes and wording boundaries remain in the claims ledger so they cannot dilute the commercial account above.`,
    "",
    "### Recorded absences",
    "",
  );
  if (absences.length === 0) {
    lines.push("- None: every feature node is cited by at least one benefit.");
  } else {
    for (const [id, reason] of absences) {
      lines.push(`- \`${id}\` — ${reason}`);
    }
  }
  lines.push("", "### Claim homes", "");
  for (const slug of Object.keys(CLAIMS) as ClaimSlug[]) {
    const carriers = flattened
      .filter(({ entry }) => (entry.claims ?? []).includes(slug))
      .map(({ entry }) => entry.id);
    lines.push(`- \`${slug}\` — ${carriers.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// ────────────────────────────────────────────────────────────────────────────
// discern-canon-section: agent-benefit
// The agent benefit canon — the outcome-first transposition of the feature
// canon for the coding agent operating discern. It owns the answer to “what
// does this buy the agent?”, while FEATURE_CANON owns product identity and the
// human benefit canon owns commercial value for people (ADR 0311).
// ────────────────────────────────────────────────────────────────────────────

/** One registered agent-only hint id. */
export type AgentHintId = keyof typeof HINTS;

/** One coding-agent outcome composed from product facts. */
export interface AgentBenefitEntry {
  /** Stable kebab-case id, unique across both benefit canons and the feature tree. */
  id: string;
  /** The agent outcome in ordinary language — no trailing period. */
  title: string;
  /** What improves for the coding agent, stated before the mechanism. */
  value: string;
  /** The factual chain from product behavior to the stated agent value. */
  whyItFollows: string;
  /** The precise limit beyond which the benefit must not be inferred. */
  boundary: string;
  /** Feature identities that directly produce this outcome. */
  drawsOn: readonly string[];
  /** Infrastructure that enables the outcome without being its direct source. */
  supportedBy?: readonly string[];
  /** Agent-only operational hints delivered where this outcome becomes actionable. */
  hints?: readonly AgentHintId[];
  /** Public claims whose agent or shared reading this outcome carries. */
  claims?: readonly ClaimSlug[];
}

/** One ordered family of coding-agent outcomes. */
export interface AgentBenefitCluster {
  /** Stable kebab-case id, unique across both benefit canons and the feature tree. */
  id: string;
  /** The outcome family in agent-facing language — no trailing period. */
  title: string;
  /** The complete coding-agent promise shared by the cluster's entries. */
  promise: string;
  readonly benefits: readonly AgentBenefitEntry[];
}

/**
 * The coding-agent canon. Cluster order follows an agent's workflow: orient,
 * own the effort, spend context, prove completion, respect authority, recover
 * project knowledge, apply procedures, learn from evidence, and stay portable.
 */
export const AGENT_BENEFIT_CANON: readonly AgentBenefitCluster[] = [
  {
    id: "know-the-state-and-next-move",
    title: "Know the state and next move",
    promise:
      "A coding agent can orient from one bounded result and continue from an evidence-backed next action instead of reconstructing workflow state.",
    benefits: [
      {
        id: "orient-from-one-bounded-result",
        title: "Orient from one bounded result",
        value:
          "A coding agent can learn the current effort state, the important evidence, and the next valid action without loading an unbounded fleet account.",
        whyItFollows:
          "Status observes complete state once, projects bounded collections with exact totals, and presents one result envelope as complementary structured data and prioritized authored Markdown.",
        boundary:
          "The default projection is intentionally sampled; the agent must request verbose structured status when a decision needs every row or full landing history.",
        drawsOn: [
          "insight",
          "status",
          "bounded-status-projection",
          "hints",
          "result-envelope",
          "authored-markdown-results",
        ],
        hints: [
          "status-start-on-trunk",
          "status-start-off-trunk",
          "status-ready-for-review",
          "status-continue-own-effort",
          "status-full-structured-detail",
        ],
      },
      {
        id: "recover-from-a-truthful-refusal",
        title: "Recover from a truthful refusal",
        value:
          "A coding agent receives a failure that names usable evidence and a recovery appropriate to the actual error family, so it can correct the condition instead of guessing or retrying blindly.",
        whyItFollows:
          "Diagnostics carry a reproducing command, the error-slug registry classifies generic versus tailored recovery, the public boundary rejects a failed result that does not satisfy that classification, and a denied Git-write probe stops the command with the blocked path before its body runs.",
        boundary:
          "The contract identifies the next valid workflow action; it does not diagnose arbitrary failures inside the project's own commands beyond the evidence those commands return.",
        drawsOn: [
          "diagnostics",
          "gotchas-pointer",
          "failure-recovery-contract",
          "forgiving-cli",
          "write-preflight",
        ],
      },
      {
        id: "see-the-change-discern-sees",
        title: "See the change discern sees",
        value:
          "A coding agent can see which project concerns its change wakes and can treat uncertain classification as visible evidence instead of a false clean bill of health.",
        whyItFollows:
          "Impact derives scopes from the current diff, scope gates select work from those scopes, and classification failures widen safely while disclosing the uncertainty.",
        boundary:
          "Scope classification describes configured change impact; it does not prove that an undeclared project relationship cannot exist.",
        drawsOn: ["impact", "scope-gates", "fail-open-classification"],
      },
    ],
  },
  {
    id: "keep-one-effort-mine",
    title: "Keep one effort mine",
    promise:
      "A coding agent can keep one durable, isolated effort across sessions and compose with other work without taking ownership of it.",
    benefits: [
      {
        id: "own-one-isolated-effort",
        title: "Own one isolated effort",
        value:
          "A coding agent receives a separate working tree with a durable identity and provisioned resources, so its edits, evidence, and authority stay attached to one effort.",
        whyItFollows:
          "Start creates a linked worktree and identity, resource provisioning follows that identity, and environment and ignored-drift contracts preserve the boundaries needed to resume it.",
        boundary:
          "Isolation keeps checkout contents separate. Semantic overlap can still occur, so the agent must act on reported upstream and cross-effort conflicts.",
        drawsOn: [
          "worktrees",
          "start",
          "worktree-identity",
          "worktree-resources",
          "env-inheritance",
          "ignored-drift",
        ],
        hints: ["silent-worktree-divergence", "start-mcp-re-root"],
        claims: ["isolated-worktrees", "no-checkout-collisions"],
      },
      {
        id: "compose-without-adopting-sibling-work",
        title: "Compose without adopting sibling work",
        value:
          "A coding agent can update its own effort, build on an explicit ref, or wait for a named dependency while leaving sibling ownership and lifecycle decisions with their rightful owner.",
        whyItFollows:
          "Update performs its own merge preconditions, compose-below-trunk accepts an explicit base, Fleet reports identity and overlap, Await blocks on a named condition, and owner-attention stays separate from the caller's next step.",
        boundary:
          "Seeing a sibling as idle, green, or authorized does not grant the current agent permission to adopt, land, prune, or discard it.",
        drawsOn: [
          "update",
          "compose-below-trunk",
          "fleet",
          "await",
          "owner-attention",
        ],
        hints: ["fleet-ownership", "status-fleet-authorized-landings"],
      },
      {
        id: "resume-after-interruption",
        title: "Resume after interruption",
        value:
          "A coding agent can continue a durable effort after a process, session, or provisioning interruption without inventing a new workspace or losing partial state without an account.",
        whyItFollows:
          "Provisioning records recoverable state, drop repairs interrupted lifecycle operations, prune reconciles positively identified abandoned worktrees through an explicit action, effectful workflows are designed for interruption safety, and every long operation journals its progress facts and retained result behind a handle so a lost call is read back rather than re-run.",
        boundary:
          "Recovery preserves and explains known lifecycle state; it cannot reconstruct external resources whose provider destroyed them outside discern's recorded contract.",
        drawsOn: [
          "crash-safe-provisioning",
          "drop-recovery",
          "worktree-prune",
          "interruption-safety",
          "progress",
        ],
      },
    ],
  },
  {
    id: "spend-context-on-the-change",
    title: "Spend context on the change",
    promise:
      "A coding agent can spend its attention on the changed behavior while discern schedules, bounds, and explains the routine validation work.",
    benefits: [
      {
        id: "run-the-relevant-gate-efficiently",
        title: "Run the relevant Gate efficiently",
        value:
          "A coding agent can ask one project-defined Gate to run independent work concurrently, stop dependent work when its premise fails, and report stalls before they consume more runtime.",
        whyItFollows:
          "The jobs table feeds a staged runner with fail-fast dependencies, per-job timeouts, captured environment, live streaming, and process-strand detection.",
        boundary:
          "discern schedules the commands the project declares; it does not make a missing, flaky, or semantically weak project check sufficient.",
        drawsOn: [
          "gate",
          "jobs-table",
          "staged-pipeline",
          "fail-fast",
          "job-timeouts",
          "capture-environment",
          "gate-streaming",
          "strand-detection",
        ],
        supportedBy: [
          "job-format",
          "job-build",
          "job-lint",
          "job-typecheck",
          "job-test",
          "job-smoke",
        ],
        hints: ["gate-prove-it-works"],
      },
      {
        id: "use-a-fast-inner-loop",
        title: "Use a fast inner loop",
        value:
          "A coding agent can fix generated or formatting drift, exercise targeted tests, and discover final-gate preconditions before paying for the complete Gate.",
        whyItFollows:
          "Prepare runs the fix and check stages, the test verb exposes project tests, tidy removes declared waste, and generated declarations provide regeneration authority. Together they expose relevant drift and checks before the complete Gate.",
        boundary:
          "Prepare and targeted tests accelerate iteration but do not produce the exact-tree Proof required for completion.",
        drawsOn: [
          "tidy",
          "gate-preconditions",
          "generated-artifact-declarations",
          "prepare",
          "test-verb",
        ],
      },
      {
        id: "load-only-the-context-needed",
        title: "Load only the context needed",
        value:
          "A coding agent can retrieve project-defined tools and bounded output without carrying wrapper boilerplate or terminal decoration through its working context.",
        whyItFollows:
          "The context-budget principle shapes projections, project scripts receive discern's resolved environment, and output discipline removes interactive presentation from machine-oriented calls.",
        boundary:
          "Bounded projections retain the evidence needed to act and omit other observed facts; exact integration detail remains in the structured or verbose surface named by the result.",
        drawsOn: ["context-budget", "project-scripts", "output-discipline"],
      },
    ],
  },
  {
    id: "know-what-finished-means",
    title: "Know what finished means",
    promise:
      "A coding agent can distinguish iteration from completion and return Proof, judgment evidence, and retained quality limits for the exact tree it finished.",
    benefits: [
      {
        id: "prove-the-exact-tree",
        title: "Prove the exact tree",
        value:
          "A coding agent can return one durable Proof bound to the clean committed tree the Gate judged, so completion cannot drift away from its evidence.",
        whyItFollows:
          "Done records the tested tree and its source inputs. An integrated landing adds its composition marker while retaining the submitted source; Proof notes preserve the tested result after landing. Current green evidence can be reused, while an unchanged red tree needs an explicit rerun.",
        boundary:
          "Proof establishes the configured machine checks and recorded declarations for one tree; it is not release authority and says nothing about later edits.",
        drawsOn: [
          "integration-landings",
          "proof",
          "proof-notes",
          "unchanged-tree-rerun",
          "producer-evidence",
        ],
        hints: ["gate-relay-proof"],
        claims: ["proof-exact-tree", "gate-grants-no-authority"],
      },
      {
        id: "carry-judgment-as-judgment",
        title: "Carry judgment as judgment",
        value:
          "A coding agent is stopped at relevant semantic questions, can record what it concluded, and returns that conclusion separately from machine verification.",
        whyItFollows:
          "Checkpoint triggers serve governed questions before Gate jobs, report mode exposes them without answering, question files preserve substantial criteria, and typed drops retain every fail-open uncertainty in Proof.",
        boundary:
          "A declared-met conclusion records the agent's judgment; machine verification does not establish its truth. Declared-unmet work still requires the owner's explicit variance before acceptance.",
        drawsOn: [
          "checkpoints",
          "checkpoint-ci-report",
          "checkpoint-drops",
          "checkpoint-question-files",
        ],
      },
      {
        id: "retain-earned-quality",
        title: "Retain earned quality",
        value:
          "A coding agent can improve a measurable quality limit knowing later work cannot weaken the gain, and can ask the owner to make a measured improvement the new baseline.",
        whyItFollows:
          "Standards declare direction and metric protocols, normalize rates and margins, reuse complete applicable evidence, share expensive producers, pin gains, and route genuine growth to owner escalation instead of weakening a limit.",
        boundary:
          "A Standard preserves its declared metric. Other aspects of quality remain outside that measure, and changing a limit when the work legitimately grows the number remains an owner decision.",
        drawsOn: [
          "standards",
          "standards-direction",
          "standards-metric-protocol",
          "standards-rates",
          "standards-margin",
          "standards-replay",
          "standards-complete-evidence",
          "standards-pin",
          "standards-escalation",
        ],
        claims: ["standards-cannot-loosen", "pin-measured-gains"],
      },
    ],
  },
  {
    id: "act-inside-explicit-authority",
    title: "Act inside explicit authority",
    promise:
      "A coding agent can preview effects, distinguish Proof from permission, and stop at the exact owner decision an operation still needs.",
    benefits: [
      {
        id: "preview-and-retry-effects-safely",
        title: "Preview and retry effects safely",
        value:
          "A coding agent can inspect a faithful plan before a write and repeat convergent operations without building its own fragile preflight sequence.",
        whyItFollows:
          "Effectful verbs separate pure planning from application, convergent verbs own their preconditions, placement is checked, and consent attestations bind the approved operation and facts.",
        boundary:
          "A dry run predicts discern's planned effects at that moment; external state may still change before application, so execution checks its preconditions again.",
        drawsOn: [
          "plan-apply",
          "idempotent-verbs",
          "placement-consent",
          "consent-attestations",
        ],
      },
      {
        id: "land-only-with-release-authority",
        title: "Land only with release authority",
        value:
          "A coding agent can submit its proven work, wait its landing turn, and let discern check it with a moved trunk under applicable consent. A conflict, failed check, or missing authority returns a concrete next action.",
        whyItFollows:
          "Acceptance freezes the submission, serializes landings, proves a needed combination in an owned worktree, and rechecks authority before moving the trunk. An explicitly selected queue walk records each attempt and stops at the first refusal.",
        boundary:
          "Authority is scoped and current: a prior grant, a sibling's authority, or a green result never covers an unmet checkpoint variance or newly uncovered path.",
        drawsOn: [
          "landing-turn",
          "landing-queue-walk",
          "submission-only",
          "accept",
          "relay-messages",
          "ownership-buckets",
        ],
        hints: [
          "status-land-under-verified-authority",
          "status-ready-uncovered-authority",
          "status-proven-behind",
          "gate-land-under-verified-authority",
          "gate-relay-uncovered-authority",
          "accept-relay-landing-proof",
          "start-landing-authority",
        ],
      },
      {
        id: "manage-the-installation-lifecycle",
        title: "Manage the installation lifecycle",
        value:
          "A coding agent can set up, verify, diagnose, upgrade, configure, and remove discern with a preview of the changes. It gets a clear next step when its discern version is older than the project's.",
        whyItFollows:
          "Lifecycle commands share configuration and file ownership rules. Upgrade records the discern version in the project; an older version directs the agent to check releases before changing managed files.",
        boundary:
          "Lifecycle verbs manage discern's declared footprint and provider integrations, not arbitrary project files or provider state outside their ownership contract.",
        drawsOn: [
          "install",
          "setup",
          "setup-observability",
          "setup-activation",
          "doctor",
          "release-awareness",
          "upgrade",
          "uninstall",
          "config-command",
          "licenses",
        ],
        hints: [
          "release-check-sequence",
          "ensure-main-worktree-first",
          "setup-improvement-after-activation",
        ],
        claims: [
          "installs-a-practice",
          "one-config-file",
          "setup-proves-worktree",
        ],
      },
    ],
  },
  {
    id: "carry-project-context-across-sessions",
    title: "Carry project context across sessions",
    promise:
      "A coding agent can recover the project's current instructions, map, vocabulary, and decision boundaries without depending on the memory of a previous session.",
    benefits: [
      {
        id: "inherit-current-agent-instructions",
        title: "Inherit current agent instructions",
        value:
          "A coding agent can start with one authored project instruction source compiled into its host's expected surface and refreshed when the source changes.",
        whyItFollows:
          "The instruction compiler combines built-in and project sources, applies explicit conditionals, installs session hooks, and detects the active provider where integration requires it.",
        boundary:
          "Compilation keeps supported provider outputs aligned; it cannot make two hosts interpret identical prose or tool capabilities identically.",
        drawsOn: [
          "instructions",
          "instructions-compile",
          "instructions-conditionals",
          "session-hooks",
          "agent-autodetect",
        ],
        claims: ["one-instruction-source"],
      },
      {
        id: "recover-the-project-mental-model",
        title: "Recover the project mental model",
        value:
          "A coding agent can search from task language into a maintained map, follow checked links and commands, recover canonical vocabulary, and inspect the reasons behind durable architectural boundaries.",
        whyItFollows:
          "The map browser finds current project explanations and their evidence. The gate checks links and command examples; checkpoints prompt judgment about changed knowledge. ADRs preserve decision reasons, bundled docs explain discern, and CLI help reflects live commands.",
        boundary:
          "The map explains behavior, intent, boundaries, and navigation with links to evidence. Useful implementation summaries belong here; copied inventories do not. Structural checks cannot establish that the explanation is true.",
        drawsOn: [
          "map",
          "map-browser",
          "discovery-funnel",
          "docs-integrity",
          "map-freshness",
          "publish-predicate",
          "adr-discipline",
          "bundled-docs",
          "cli-help",
        ],
        claims: ["map-mechanically-checked"],
      },
    ],
  },
  {
    id: "use-proven-procedures",
    title: "Use proven procedures",
    promise:
      "A coding agent can invoke focused project procedures that carry quality disciplines into the work instead of rediscovering them in each prompt.",
    benefits: [
      {
        id: "invoke-curated-project-procedures",
        title: "Invoke curated project procedures",
        value:
          "A coding agent can discover only the procedures the project chose to materialize, with each procedure carrying a bounded workflow for the task it matches.",
        whyItFollows:
          "The skill registry controls materialization and curation, while the bundled procedures cover defect-class cures, Standards, checkpoints, cleanup, delegation, fleet waits, durable teaching, ADRs, and single-authority design.",
        boundary:
          "A skill supplies a procedure and decision points; it does not grant permissions the current task lacks or replace the project's own facts and tests.",
        drawsOn: [
          "skills",
          "skills-materialization",
          "skills-curation",
          "skill-cure-a-bug",
          "skill-set-the-standard",
          "skill-place-a-checkpoint",
          "skill-clear-the-decks",
          "skill-delegate-work",
          "skill-await-the-fleet",
          "skill-teach-the-project",
          "skill-write-adr",
          "skill-write-it-once",
        ],
        claims: ["shaped-delegation"],
      },
      {
        id: "let-new-members-enrol-themselves",
        title: "Let new members enrol themselves",
        value:
          "A coding agent adding to a closed product set is forced toward every required projection and guard instead of relying on memory to update copied lists.",
        whyItFollows:
          "Forcing functions derive satellites from canonical sets, and structural tests fail when a new member lacks a required handler, document, schema, or coverage account.",
        boundary:
          "Enrollment guards prove declared structural completeness; they cannot prove that the authored prose or behavior is the right product decision without the relevant review.",
        drawsOn: ["forcing-functions", "canonical-sets"],
      },
    ],
  },
  {
    id: "learn-from-local-practice-evidence",
    title: "Improve practice from evidence",
    promise:
      "A coding agent can use local workflow evidence to investigate recurring friction and improve the practice without turning advisories into enforcement or surveillance.",
    benefits: [
      {
        id: "diagnose-workflow-friction-locally",
        title: "Diagnose workflow friction locally",
        value:
          "A coding agent can inspect co-change history, ranked improvement evidence, and bounded recurring-pattern investigations without sending code or command output away from the repository.",
        whyItFollows:
          "Coupling mines Git history, Improvement ranks deterministic and reviewed opportunities, the metadata-only Logbook records local outcomes, and Patterns preserves raw findings while synthesizing only compatible evidence.",
        boundary:
          "These surfaces advise from available local evidence; they do not score people, infer causes through missing evidence, change the Gate verdict, or mutate configuration automatically.",
        drawsOn: [
          "coupling",
          "improvement",
          "logbook",
          "patterns",
          "patterns-investigations",
          "local-evidence",
        ],
        claims: ["local-logbook"],
      },
      {
        id: "operate-without-a-hidden-model",
        title: "Operate without a hidden model",
        value:
          "A coding agent can reason about discern as deterministic project tooling rather than an unseen second agent whose calls, judgment, or network state must be inferred.",
        whyItFollows:
          "discern has no model or network path in its engine, runs its own practice against its source, and exposes its behavior through local evidence and ordinary project contracts.",
        boundary:
          "The coding agent using discern may itself depend on a remote model or host; the guarantee applies to discern's own execution path.",
        drawsOn: ["no-model-inside", "dogfooding"],
        claims: ["no-model-inside", "runs-on-itself"],
      },
    ],
  },
  {
    id: "carry-practice-across-tools-and-stacks",
    title: "Carry practice across tools and stacks",
    promise:
      "A coding agent can use the same project-owned practice through supported hosts and technology stacks while relying on one local contract surface.",
    benefits: [
      {
        id: "operate-as-the-primary-user",
        title: "Operate as the primary user",
        value:
          "A coding agent can call discern through typed tools or commands designed around agent constraints, with published result and configuration contracts available for exact integration.",
        whyItFollows:
          "Interfaces share one result contract, MCP exposes the same verb cores, and generated schemas publish the configuration and result shapes; the product's foundation treats the agent as its primary operator.",
        boundary:
          "Published shapes stabilize discern's contract, not the capabilities, context policies, or interface behavior of every agent host.",
        drawsOn: [
          "interfaces",
          "mcp-surface",
          "published-contracts",
          "foundations",
          "agent-is-user",
        ],
        claims: ["agent-as-operator"],
      },
      {
        id: "switch-supported-agent-hosts",
        title: "Switch supported agent hosts",
        value:
          "A coding agent can enter a project through its host's native instruction and skill surfaces while inheriting the same authored project practice.",
        whyItFollows:
          "One provider registry maps the compiled instruction and materialized skill outputs for each supported host, while the authored sources remain provider-neutral.",
        boundary:
          "Provider parity covers the surfaces discern declares; host-specific tools, sandbox boundaries, and model behavior remain properties of the host.",
        drawsOn: ["providers"],
        supportedBy: [
          "provider-claude-code",
          "provider-codex",
          "provider-gemini",
          "provider-cursor",
          "provider-copilot",
        ],
        claims: ["switch-without-reteaching"],
      },
      {
        id: "apply-one-practice-to-any-stack",
        title: "Apply one practice to any stack",
        value:
          "A coding agent can apply the same gate, worktree, instruction, map, and skill disciplines in a project without teaching discern that project's programming language or framework.",
        whyItFollows:
          "A single self-contained binary reads one root configuration file, every subsystem is core, and stack-specific behavior stays in project-declared commands and files.",
        boundary:
          "Stack neutrality means discern does not sniff or prescribe a stack; the project must still declare commands and authored context appropriate to its own technology.",
        drawsOn: [
          "single-binary",
          "one-file-footprint",
          "stack-neutral",
          "all-subsystems-core",
        ],
      },
    ],
  },
];

/** Human-only feature nodes with no distinct coding-agent outcome. */
export const AGENT_BENEFIT_COVERAGE_ABSENCES: Readonly<Record<string, string>> =
  {
    desk:
      "The Desk is the person's interactive fleet surface; agents receive the same observable state through status and structured tools without its human action controls.",
    tips:
      "Tips teach the person using the Desk; agent instructions are owned by registered hints, generated instructions, and authored skills instead.",
    "worktree-shell-picker":
      "The worktree shell picker is a person's interactive terminal route; agents keep one effort and inspect the fleet through status and structured tools.",
  };

/** Agent-only hints deliberately outside the Agent Benefit Canon, with reasons. */
export const AGENT_HINT_COVERAGE_ABSENCES: Partial<
  Readonly<Record<AgentHintId, string>>
> = {};

/** One flattened coding-agent benefit with its cluster. */
export interface FlattenedAgentBenefit {
  cluster: AgentBenefitCluster;
  entry: AgentBenefitEntry;
}

/** Every coding-agent benefit entry in authoring order. */
export function allAgentBenefitEntries(
  canon: readonly AgentBenefitCluster[] = AGENT_BENEFIT_CANON,
): FlattenedAgentBenefit[] {
  const out: FlattenedAgentBenefit[] = [];
  for (const cluster of canon) {
    for (const entry of cluster.benefits) out.push({ cluster, entry });
  }
  return out;
}

/** Where the generated coding-agent benefit canon lives inside the map. */
export const FEATURE_CANON_AGENT_BENEFITS_PAGE_REL: string = join(
  "_internal",
  "feature-canon-agent-benefits.md",
);

/** The banner stamped atop the generated coding-agent benefit canon. */
const AGENT_BENEFITS_DOCS_BANNER =
  "<!-- GENERATED by `deno task codegen` from the agent benefit registry (scripts/feature_registry.ts) — do NOT edit by hand. Change an agent benefit entry there and regenerate. -->";

/** Route one agent-benefit field through Canon Editor provenance. */
function agentBenefitProse(entry: string, field: string, text: string): string {
  return annotateProse(text, { registry: "agent-benefit", entry, field });
}

/** Resolve a cited feature title with an agent-specific diagnostic. */
function citedAgentFeatureTitle(
  titles: Map<string, string>,
  id: string,
): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`agent benefit canon cites unknown feature node: ${id}`);
  }
  return title;
}

/** Render the exhaustive outcome-first account for coding agents. */
export function renderFeatureCanonAgentBenefitsDoc(): string {
  const titles = featureTitlesById();
  const flattened = allAgentBenefitEntries();
  const directIds = new Set(
    flattened.flatMap(({ entry }) => [...entry.drawsOn]),
  );
  const supportingIds = new Set(
    flattened.flatMap(({ entry }) => [...(entry.supportedBy ?? [])]),
  );
  const citedHints = new Set(
    flattened.flatMap(({ entry }) => [...(entry.hints ?? [])]),
  );
  const citedClaims = new Set(
    flattened.flatMap(({ entry }) => [...(entry.claims ?? [])]),
  );
  const lines: string[] = [
    AGENT_BENEFITS_DOCS_BANNER,
    "",
    "# Agent Benefit Canon",
    "",
    "_discern's canonical account of what the product gives the coding agent operating it. Each entry leads with the agent outcome, explains the product mechanism, states the boundary, and cites the feature identities, agent-only hints, and public claims that make the account checkable. The [feature canon](feature-canon.md) owns product identity; the [Human Benefit Canon](feature-canon-human-benefits.md) owns value for people._",
    "",
    "The [Readiness Canon](brand/readiness-canon.md) connects release questions to these outcomes and their existing feature mechanisms. Use its approaches to select work appropriate to the project and change.",
    "",
    `${AGENT_BENEFIT_CANON.length} workflow clusters · ${flattened.length} agent benefits · ${directIds.size} direct feature roles · ${supportingIds.size} supporting feature roles · ${citedHints.size} agent-only hints · ${citedClaims.size} agent or shared claims carried.`,
    "",
    "## How to use this canon",
    "",
    "- Start with **Agent value**. Use **Why it follows** when the agent needs the mechanism or a reason to trust the outcome.",
    "- Preserve **Boundary** whenever shortening an entry. It marks the authority, evidence, or scope limit beyond which the value would become misleading.",
    "- Treat **Direct product basis** as the features that produce the outcome and **Supporting product basis** as infrastructure that enables it. The coverage guard keeps those roles exhaustive and disjoint.",
    "- Use cited hints for instructions at the moment of action. The canon explains value; a hint names the next valid move in live state.",
    "",
    "## At a glance",
    "",
  ];
  for (const cluster of AGENT_BENEFIT_CANON) {
    lines.push(
      `- **${agentBenefitProse(cluster.id, "title", cluster.title)}** — ${
        agentBenefitProse(cluster.id, "promise", cluster.promise)
      }`,
    );
  }
  lines.push("");
  for (const cluster of AGENT_BENEFIT_CANON) {
    lines.push(
      `## ${agentBenefitProse(cluster.id, "title", cluster.title)}`,
      "",
      agentBenefitProse(cluster.id, "promise", cluster.promise),
      "",
    );
    for (const entry of cluster.benefits) {
      const direct = entry.drawsOn
        .map((id) => citedAgentFeatureTitle(titles, id))
        .join(" · ");
      const supporting = (entry.supportedBy ?? [])
        .map((id) => citedAgentFeatureTitle(titles, id))
        .join(" · ");
      lines.push(
        `### ${agentBenefitProse(entry.id, "title", entry.title)}`,
        "",
        `* **Agent value:** ${
          agentBenefitProse(entry.id, "value", entry.value)
        }`,
        `* **Why it follows:** ${
          agentBenefitProse(entry.id, "whyItFollows", entry.whyItFollows)
        }`,
        `* **Boundary:** ${
          agentBenefitProse(entry.id, "boundary", entry.boundary)
        }`,
        `* **Direct product basis:** ${direct}.`,
      );
      if (supporting !== "") {
        lines.push(`* **Supporting product basis:** ${supporting}.`);
      }
      if ((entry.hints ?? []).length > 0) {
        lines.push(
          `* **Agent hints:** ${
            (entry.hints ?? []).map((id) => `\`${id}\``).join(" · ")
          }.`,
        );
      }
      if ((entry.claims ?? []).length > 0) {
        lines.push(
          `* **Public claims:** ${
            (entry.claims ?? []).map((id) => `\`${id}\``).join(" · ")
          }.`,
        );
      }
      lines.push("");
    }
  }
  lines.push(
    "## Coverage and traceability",
    "",
    "Every feature node has one global role: direct, supporting, or recorded absent. Every registered agent-only hint is cited or recorded absent, and every coding-agent or shared public claim has an agent-benefit home. The guard (`tests/feature_canon_agent_benefit_test.ts`) holds all three directions.",
    "",
    "### Recorded feature absences",
    "",
  );
  for (const [id, reason] of Object.entries(AGENT_BENEFIT_COVERAGE_ABSENCES)) {
    lines.push(`- \`${id}\` — ${reason}`);
  }
  lines.push("", "### Supporting-only feature roles", "");
  for (const id of [...supportingIds].sort()) {
    const title = citedAgentFeatureTitle(titles, id);
    const homes = flattened
      .filter(({ entry }) => (entry.supportedBy ?? []).includes(id))
      .map(({ entry }) => entry.id);
    lines.push(`- \`${id}\` (${title}) — ${homes.join(", ")}`);
  }
  lines.push("", "### Agent-hint homes", "");
  const agentHintIds = Object.values(HINTS)
    .filter((hint) => hint.audience === "agent")
    .map((hint) => hint.id as AgentHintId)
    .sort();
  for (const id of agentHintIds) {
    const homes = flattened
      .filter(({ entry }) => (entry.hints ?? []).includes(id))
      .map(({ entry }) => entry.id);
    const absence = AGENT_HINT_COVERAGE_ABSENCES[id];
    lines.push(
      `- \`${id}\` — ${homes.length > 0 ? homes.join(", ") : absence}`,
    );
  }
  lines.push("", "### Agent and shared claim homes", "");
  for (const slug of Object.keys(CLAIMS) as ClaimSlug[]) {
    const claim = CLAIMS[slug];
    if (claim.audience === "human") continue;
    const homes = flattened
      .filter(({ entry }) => (entry.claims ?? []).includes(slug))
      .map(({ entry }) => entry.id);
    lines.push(`- \`${slug}\` — ${homes.join(", ")}`);
  }
  lines.push("");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
