/**
 * Gate hints: `discern done`, `discern prepare`, and `discern test` results,
 * checkpoints, Proof, and the remedy for each failed stage. Entries are
 * registered here and fired only through `HINTS` in `../hints.ts`.
 */

import type { LandingConsentSource } from "../consent.ts";
import { MET_FLAG, UNMET_FLAG, WHY_FLAG } from "../declarations.ts";
import { markdownCodeSpan } from "../markdown_code.ts";
import {
  type CommandRef,
  discernCommand,
  flag,
  positional,
} from "../command_reference.ts";
import { productSentence } from "../product_sentence.ts";
import {
  RELATED_CHECKPOINT_KIND_LABELS,
  RELATED_CHECKPOINT_KIND_VERBS,
  type RelatedCheckpointKind,
} from "../checkpoints.ts";
import {
  boundedNameSummary,
  CHECKPOINT_DECLARATION_FOLLOW_THROUGH,
  CMD,
  defineGateFailureRemedyHint,
  defineHint,
  GATE_CHECK_TEST_REMEDY_CORE,
  GATE_PREPARE_REMEDY_CORE,
  GATE_REPRODUCE_REMEDY_CORE,
  GATE_TEST_REMEDY_CORE,
  type GeneratedDriftRemedyParams,
  type GeneratedUndercoverageRemedyParams,
  OWNER_STATUS_VERBOSE,
  reasonSuffix,
  setupUnfinishedHint,
} from "./define.ts";

/** The gate catalog, keyed by hint id. */
export const GATE_HINTS = {
  /**
   * Gate context for the shared unfinished-setup action. Gate verbs run during
   * setup, but their output is not the final project verdict yet.
   */
  "setup-unfinished-gate": defineHint({
    id: "setup-unfinished-gate",
    category: "guardrail",
    audience: "all",
    when: "A gate verb runs before setup has completed.",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        `Gate commands are useful during setup, but their output is provisional. Only ${CMD.setupDone} validates the gate and records setup completion.`,
      ),
  }),

  /** A successful job emitted enough error-like output to warrant inspection. */
  "gate-job-loud-success": defineHint<{
    label: string;
    errorLikeLines: number;
    outputLines: number;
    outputPath: string | undefined;
  }>({
    id: "gate-job-loud-success",
    category: "notice",
    audience: "all",
    when: "A gate job passes after producing substantial error-like output.",
    example: {
      label: "lint",
      errorLikeLines: 12,
      outputLines: 80,
      outputPath: "/tmp/discern-job-my-app-wt-feature-1a2b3c.log",
    },
    template: ({ label, errorLikeLines, outputLines, outputPath }): string => {
      const where = outputPath === undefined
        ? "captured output"
        : `output at ${outputPath}`;
      return `Review ${label}'s ${where}. It passed but printed ` +
        `${errorLikeLines} error-like line${
          errorLikeLines === 1 ? "" : "s"
        } across ${outputLines} output line${outputLines === 1 ? "" : "s"}.`;
    },
  }),

  /** A trivial test pass when no test-stage job is wired. */
  "test-job-not-configured": defineHint({
    id: "test-job-not-configured",
    category: "notice",
    audience: "all",
    when: "`test` runs with no configured test-stage job.",
    example: undefined,
    template: (): string =>
      'Set [jobs].test = "<command>" in discern.toml to run tests. No test job is configured.',
  }),

  "gate-test-run-queued": defineHint<{
    cap: number;
    inFlight: string | undefined;
    typical: string | undefined;
    logbookOff: boolean;
  }>({
    id: "gate-test-run-queued",
    category: "notice",
    audience: "all",
    when:
      "A test-stage run arrives with every [gate].concurrent_test_runs slot held.",
    example: {
      cap: 1,
      inFlight: "done on agent/fix-upload-retry",
      typical: "3m",
      logbookOff: false,
    },
    template: ({ cap, inFlight, typical, logbookOff }): string => {
      const queued =
        `This run waited for shared test capacity: ${cap} of ${cap} concurrent runs ` +
        `were in use when it entered the wait ` +
        `([gate].concurrent_test_runs).`;
      const flight = inFlight === undefined
        ? ""
        : ` Other operations active at that time: ${inFlight}${
          typical === undefined
            ? ""
            : `; historical duration for the first operation's command: ~${typical}`
        }.`;
      const estimate = logbookOff
        ? " Other operation activity was not recorded ([project].record_logbook = false)."
        : " These observations do not establish queue order or an estimated start time.";
      return `${queued}${flight}${estimate}`;
    },
  }),

  "gate-test-slots-unavailable": defineHint<{ reason: string }>({
    id: "gate-test-slots-unavailable",
    category: "notice",
    audience: "all",
    when:
      "[gate].concurrent_test_runs is set but the slot files under .git could not be prepared.",
    example: { reason: "could not create the slot directory" },
    template: ({ reason }): string =>
      `${
        productSentence(
          `The concurrent test-run cap is not enforced for this run: ${reason}`,
        )
      } ` +
      `The tests run uncapped.`,
  }),

  "gate-standards-limits-unverified": defineHint<{
    reason: string;
    trunk: string;
  }>({
    id: "gate-standards-limits-unverified",
    category: "next-step",
    audience: "all",
    when: "The gate cannot compare standard limits with the trunk.",
    family: "standards-limits-unverified",
    example: { reason: "the local branch is missing", trunk: "main" },
    template: ({ reason, trunk }): string =>
      `Standards limits are UNVERIFIED. Fetch the trunk where the gate runs so ` +
      `the limits can be verified. In CI, ` +
      `run \`git fetch origin ${trunk}:${trunk}\`. The never-loosen check could ` +
      `not read the trunk (${reason}).`,
  }),

  "emergency-outstanding": defineHint<{ commit: string }>({
    id: "emergency-outstanding",
    category: "notice",
    audience: "all",
    when: "An integrated emergency has no later complete validation receipt.",
    example: { commit: "0123abcd4567" },
    template: ({ commit }): string =>
      `The emergency landing at ${commit} still has its skipped checks outstanding. Run discern done --rerun on the trunk, or on a change that contains it; the emergency record stays in the history.`,
  }),

  "completion-uncommitted": defineHint({
    id: "completion-uncommitted",
    category: "next-step",
    audience: "all",
    when:
      "Ordinary completion refuses an uncommitted subject before selection.",
    example: undefined,
    template: (): string =>
      `Run ${CMD.prepare}, review and commit the intended changes, then run ` +
      `${CMD.done}. For diagnostics before committing, use ${CMD.test} or ` +
      `${
        discernCommand("done", flag("standalone"))
      }; standalone results are transient.`,
  }),

  "completion-pending": defineHint<{ action: string }>({
    id: "completion-pending",
    category: "next-step",
    audience: "all",
    when: "Complete candidate validation has a pending obligation.",
    example: {
      action:
        "Resolve the failed validation, then use discern done --rerun to request a new attempt.",
    },
    template: ({ action }): string => action,
  }),

  "gate-strand-check-unavailable": defineHint({
    id: "gate-strand-check-unavailable",
    category: "notice",
    audience: "all",
    when: "A gate run cannot read every strand-detection snapshot.",
    example: {},
    template: (): string => "Restore Git status access; rerun.",
  }),

  "gate-proof-skipped-dirty": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-skipped-dirty",
    category: "next-step",
    audience: "all",
    when:
      "Explicit standalone feedback passed on a dirty tree and records no Proof.",
    family: "gate-proof",
    example: {
      reason:
        "Standalone feedback does not issue Proof. A full run does, and it needs a clean committed tree; this tree was not clean when the run began — uncommitted: notes.md.",
    },
    template: ({ reason }): string =>
      `Use ${CMD.prepare} or ${CMD.test} while iterating. Then commit ` +
      `the intended final tree and run ${CMD.done} on the clean HEAD for ` +
      `Proof before handoff or acceptance.${
        reason === undefined ? "" : ` ${reason}`
      }`,
  }),

  /** A declared setting that is inert must say so on the daily surfaces. */
  "gate-proof-head-moved": defineHint<{ reason: string | undefined }>({
    id: "gate-proof-head-moved",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot record Proof because the branch tip moved.",
    family: "gate-proof",
    example: { reason: "HEAD changed from a1b2c3d to d4e5f6a" },
    template: ({ reason }): string =>
      `Re-run ${CMD.done} on the final commit before handoff or acceptance. ` +
      `The gate passed but recorded no Proof because HEAD moved while it ran${
        reasonSuffix(reason)
      }. A Proof can vouch only for the exact tree the gate tested.`,
  }),

  "gate-proof-record-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-record-failed",
    category: "next-step",
    audience: "all",
    when: "A green gate cannot write Proof.",
    family: "gate-proof",
    example: { reason: "the Proof file could not be written" },
    template: ({ reason }): string =>
      `Run ${CMD.done} again later to record Proof. The gate passed, ` +
      `but discern could not record one${reasonSuffix(reason)}. Until then, ` +
      `${CMD.accept} will re-run the gate.`,
  }),

  "gate-proof-unavailable": defineHint<{ reason: string | undefined }>({
    id: "gate-proof-unavailable",
    category: "notice",
    audience: "all",
    when: "A green gate cannot prepare Proof state.",
    family: "gate-proof",
    example: { reason: "write authority was not established" },
    template: ({ reason }): string =>
      `Gate passed, but discern could not prepare Proof${
        reasonSuffix(reason)
      }. ${CMD.accept} may need to re-run the gate.`,
  }),

  "gate-proof-clear-failed": defineHint<{
    reason: string | undefined;
  }>({
    id: "gate-proof-clear-failed",
    category: "next-step",
    audience: "all",
    when: "The gate cannot clear obsolete Proof.",
    family: "gate-proof",
    example: { reason: "the Proof file could not be removed" },
    template: ({ reason }): string =>
      `Fix the failure, then re-run ${CMD.done}. discern could not clear the ` +
      `previous Proof${reasonSuffix(reason)}.`,
  }),

  "done-unchanged-tree-red": defineHint({
    id: "done-unchanged-tree-red",
    category: "next-step",
    audience: "all",
    when:
      "`done` is asked to re-run on the exact tree it last judged red, without `--rerun`.",
    family: "done-rerun",
    example: undefined,
    template: (): string =>
      "Fix the failure the last run reported with its reproduce command or " +
      `${CMD.prepare}, then re-run ${CMD.done}. Nothing ` +
      "changed since it judged this exact tree red, so an identical rerun " +
      "expects the identical verdict. Use the explicit rerun only to probe " +
      `for a flaky verdict: ${
        discernCommand("done", flag("rerun"))
      } does that, and ` +
      "records the rerun as a probe.",
  }),

  "done-unchanged-tree-green": defineHint({
    id: "done-unchanged-tree-green",
    category: "next-step",
    audience: "all",
    when:
      "`done` found a last-green marker but no complete current Proof to reuse, without `--rerun`.",
    family: "done-rerun",
    example: undefined,
    template: (): string =>
      `Run ${CMD.status} — this exact tree already passed ${CMD.done}, ` +
      "and status shows whether Proof remains valid without re-running anything. " +
      `To re-run the full gate on it anyway, run ${
        discernCommand("done", flag("rerun"))
      }.`,
  }),

  "checkpoint-declare": defineHint<{ ids: string[] }>({
    id: "checkpoint-declare",
    category: "next-step",
    audience: "all",
    when:
      "`done` refuses because a governing stop checkpoint has no current conclusion.",
    family: "checkpoint-declaration",
    followThrough: CHECKPOINT_DECLARATION_FOLLOW_THROUGH,
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Judge each question above against its changed paths, then record your ` +
      `conclusion and re-run the gate in one step: ${
        discernCommand("done", flag("met", "<id>"))
      } (repeatable) for a question your change satisfies, or ${
        discernCommand("done", flag("unmet", "<id>"))
      } with its required one-paragraph rationale (${WHY_FLAG}, one per ` +
      `invocation) to record that it is not satisfied — the gate still runs, ` +
      `and the owner decides at landing. Awaiting: ${ids.join(", ")}.`,
  }),

  "checkpoint-ci-recovery": defineHint({
    id: "checkpoint-ci-recovery",
    category: "next-step",
    audience: "all",
    when:
      "Strict done refuses for an awaiting checkpoint while a conventional CI marker is active.",
    example: undefined,
    template: (): string =>
      `Use ${CMD.doneCi} for machine checks with report-only checkpoint ` +
      `review. Run ordinary ${CMD.done} in a stateful worktree when ` +
      "checkpoint declarations must be enforced.",
  }),

  "checkpoint-preview": defineHint<
    {
      id: string;
      question: string;
      questionFile?: string;
      reference?: string;
      matched: string[];
      related: {
        kind: RelatedCheckpointKind;
        for_path: string;
        path: string;
      }[];
      state: "will_open" | "awaiting_declaration" | "reopened" | "when_pending";
    }
  >({
    id: "checkpoint-preview",
    category: "notice",
    audience: "all",
    when:
      "A previewing surface (`prepare`, `status`) finds a stop checkpoint holding an obligation against the current effort; the question is served early, without blocking.",
    family: "checkpoint-preview",
    example: {
      id: "api-review",
      question:
        "A changed API surface is described in its docs before it lands.",
      matched: ["src/api/surface.ext"],
      related: [],
      state: "will_open",
    },
    template: ({
      id,
      question,
      questionFile,
      reference,
      matched,
      related,
      state,
    }): string => {
      const shown = matched.slice(0, 4).map(markdownCodeSpan).join(", ");
      const more = matched.length > 4 ? `, +${matched.length - 4} more` : "";
      // Total over the projected states this hint serves; a new routed state
      // fails here until its claim exists.
      const claim = {
        will_open: "will require a declared conclusion",
        awaiting_declaration: "already awaits a declared conclusion",
        reopened: "requires a fresh declared conclusion",
        when_pending:
          "may require a declared conclusion (its when command decides)",
      }[state];
      const relations = related.map((relation) =>
        ` ${RELATED_CHECKPOINT_KIND_LABELS[relation.kind]}: ${
          markdownCodeSpan(relation.path)
        } ${RELATED_CHECKPOINT_KIND_VERBS[relation.kind]} ${
          markdownCodeSpan(relation.for_path)
        }.`
      ).join("");
      const pointers = [
        questionFile === undefined
          ? undefined
          : `Question source: ${markdownCodeSpan(questionFile)}.`,
        reference === undefined
          ? undefined
          : `Reference: ${markdownCodeSpan(reference)}.`,
      ].filter((value): value is string => value !== undefined).join(" ");
      return `Checkpoint '${id}' ${claim} at ${CMD.done}: ${question} ` +
        (pointers === "" ? "" : `${pointers} `) +
        `Changed: ${shown}${more}.${relations}`;
    },
  }),

  "checkpoint-advise": defineHint<
    {
      id: string;
      question: string;
      questionFile?: string;
      reference?: string;
      matched: string[];
      related: {
        kind: RelatedCheckpointKind;
        for_path: string;
        path: string;
      }[];
    }
  >({
    id: "checkpoint-advise",
    category: "notice",
    audience: "all",
    when:
      "An advise-mode checkpoint's trigger fired; its question is served without blocking.",
    family: "checkpoint-advise",
    example: {
      id: "deletion-heavy-change",
      question: "Is the cut proven dead, and recovery bounded?",
      matched: ["src/deprecated_module.ext"],
      related: [],
    },
    template: ({
      id,
      question,
      questionFile,
      reference,
      matched,
      related,
    }): string => {
      const shown = matched.slice(0, 4).map(markdownCodeSpan).join(", ");
      const more = matched.length > 4 ? `, +${matched.length - 4} more` : "";
      const relations = related.map((relation) =>
        ` ${RELATED_CHECKPOINT_KIND_LABELS[relation.kind]}: ${
          markdownCodeSpan(relation.path)
        } ${RELATED_CHECKPOINT_KIND_VERBS[relation.kind]} ${
          markdownCodeSpan(relation.for_path)
        }.`
      ).join("");
      const pointers = [
        questionFile === undefined
          ? undefined
          : `Question source: ${markdownCodeSpan(questionFile)}.`,
        reference === undefined
          ? undefined
          : `Reference: ${markdownCodeSpan(reference)}.`,
      ].filter((value): value is string => value !== undefined).join(" ");
      return `Checkpoint '${id}' (advisory — nothing blocks): ${question} ` +
        (pointers === "" ? "" : `${pointers} `) +
        `Changed: ${shown}${more}.${relations}`;
    },
  }),

  "checkpoint-advisory": defineHint<{ advisory: string }>({
    id: "checkpoint-advisory",
    category: "notice",
    audience: "all",
    when:
      "A checkpoint could not govern or fire (unreadable state, a failing when command) and failed open.",
    example: {
      advisory:
        "checkpoint 'api-review': the when command did not finish within 10s; the trigger fails open and did not fire.",
    },
    template: ({ advisory }): string => `Checkpoint fail-open: ${advisory}`,
  }),

  "gate-checkpoint-review-reported": defineHint({
    id: "gate-checkpoint-review-reported",
    category: "next-step",
    audience: "all",
    when:
      "An explicit done --ci run completed and its Proof cannot authorize acceptance.",
    example: undefined,
    template: (): string =>
      `Checkpoint review was reported and was not enforced. Run ${CMD.done} ` +
      `in a stateful worktree before ${CMD.accept}.`,
  }),

  "gate-variance-required": defineHint<{ ids: string[] }>({
    id: "gate-variance-required",
    category: "notice",
    audience: "all",
    when:
      "The gate passed while a declared-unmet checkpoint conclusion stands.",
    family: "checkpoint-variance",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `A declared-unmet conclusion stands on: ${ids.join(", ")}. The gate is ` +
      `green, but landing needs the owner to authorize each variance in the ` +
      `current conversation — recorded grants never cover one. Relay the ` +
      `Proof and the rationale; the decision is served at ${CMD.accept}.`,
  }),

  "accept-declarations-stale": defineHint<{ ids: string[] }>({
    id: "accept-declarations-stale",
    category: "next-step",
    audience: "all",
    when:
      "`accept` finds a governing stop checkpoint whose conclusion is missing or no longer current.",
    family: "checkpoint-declaration",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Run ${CMD.done} — it serves each checkpoint's question and evidence ` +
      `and records your conclusion (${MET_FLAG}, or ${UNMET_FLAG} with ` +
      `${WHY_FLAG}). Missing or stale: ${ids.join(", ")}.`,
  }),

  /** The integration judgment continuation — never an author-side rebuild. */
  "accept-integration-judgment": defineHint<{ ids: string[] }>({
    id: "accept-integration-judgment",
    category: "next-step",
    audience: "all",
    when:
      "An integration landing's combined result fires a checkpoint question.",
    family: "checkpoint-declaration",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Judge each served question against the combined result, then continue this landing from your own worktree: ${CMD.accept} ${MET_FLAG} when a question is satisfied, or ${CMD.accept} ${UNMET_FLAG} with ${WHY_FLAG} when it is not. Awaiting: ${
        ids.join(", ")
      }.`,
  }),

  "accept-requires-strict-proof": defineHint({
    id: "accept-requires-strict-proof",
    category: "next-step",
    audience: "all",
    when: "Acceptance finds a Proof from the explicit CI report lane.",
    example: undefined,
    template: (): string =>
      `Run ordinary ${CMD.done} in this stateful worktree. A ${CMD.doneCi} ` +
      "Proof reports checkpoint review and cannot authorize acceptance.",
  }),

  "accept-authorize-variance": defineHint<{ ids: string[] }>({
    id: "accept-authorize-variance",
    category: "next-step",
    audience: "all",
    when:
      "`accept` refuses because a current declared-unmet conclusion has no owner-authorized variance.",
    family: "checkpoint-variance",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Relay each question and rationale above to the owner. Once the owner ` +
      `accepts the landing AND each named variance in the current ` +
      `conversation, re-run ${
        discernCommand(
          "accept",
          flag("confirmed"),
          ...ids.map((id) => flag("variance", id)),
        )
      }. Recorded standing and effort grants never authorize a variance.`,
  }),

  "progress-handle-required": defineHint({
    id: "progress-handle-required",
    category: "next-step",
    audience: "all",
    when:
      "A progress read names a damaged handle, a handle no record carries, or finds only another checkout's operation.",
    family: "progress-reconnect",
    example: undefined,
    template: (): string =>
      `Pass the handle the operation announced: ${
        discernCommand("progress", positional("handle", "<handle>"))
      }. With no handle it reads this checkout's most recently started operation.`,
  }),

  "progress-nothing-recorded": defineHint({
    id: "progress-nothing-recorded",
    category: "next-step",
    audience: "all",
    when: "A progress read finds no long operation recorded in the repository.",
    family: "progress-reconnect",
    example: undefined,
    template: (): string =>
      `Every ${discernCommand("done")}, ${discernCommand("test")}, ${
        discernCommand("standards")
      }, and ${
        discernCommand("accept")
      } run announces a handle to read back; run one from this checkout first.`,
  }),

  "progress-record-unreadable": defineHint({
    id: "progress-record-unreadable",
    category: "next-step",
    audience: "all",
    when:
      "A progress read finds the journal store or the record unreadable, or written by a newer discern.",
    family: "progress-reconnect",
    example: undefined,
    template: (): string =>
      "The operation itself is unaffected. Run it again to produce a fresh record, or read another handle.",
  }),

  "progress-outside-repository": defineHint({
    id: "progress-outside-repository",
    category: "next-step",
    audience: "all",
    when: "A progress read runs where no repository is reachable.",
    family: "progress-reconnect",
    example: undefined,
    template: (): string =>
      "Run it inside the repository whose operation you are reconnecting to.",
  }),

  "checkpoints-declare": defineHint<{ ids: string[] }>({
    id: "checkpoints-declare",
    category: "next-step",
    audience: "all",
    when:
      "The checkpoints report finds a stop question awaiting the caller's conclusion — a trigger that holds, or an open question without a current declaration.",
    family: "checkpoint-declaration",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `Judge each question above against its changed paths, then record ` +
      `your conclusion at the gate: ${
        discernCommand("done", flag("met", "<id>"))
      } (repeatable) for a question your change satisfies, or ${
        discernCommand("done", flag("unmet", "<id>"))
      } with its required one-paragraph rationale (${WHY_FLAG}, one per ` +
      `invocation) to record that it is not satisfied — the gate still runs, ` +
      `and the owner decides at landing. Awaiting: ${ids.join(", ")}.`,
  }),

  "checkpoints-variance-review": defineHint<{ ids: string[] }>({
    id: "checkpoints-variance-review",
    category: "notice",
    audience: "all",
    when:
      "The checkpoints report finds a current declared-unmet conclusion standing.",
    family: "checkpoint-variance",
    example: { ids: ["api-review"] },
    template: ({ ids }): string =>
      `A declared-unmet conclusion stands on: ${ids.join(", ")}. Landing ` +
      `requires the owner to authorize each variance in the current ` +
      `conversation — recorded standing and effort grants never cover one. ` +
      `Relay each question and rationale above to the owner; the decision ` +
      `is served at ${CMD.accept}.`,
  }),

  "gate-failure-gotchas": defineHint<
    { command: CommandRef; path?: never } | { path: string; command?: never }
  >({
    id: "gate-failure-gotchas",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure occurs, the project configures a gotchas document, and no trap matcher matches the failure.",
    family: "gotchas-doc",
    example: {
      command: discernCommand(
        "map",
        positional("target", "80-development/done-gate-gotchas"),
        flag("json"),
      ),
    },
    template: (reference): string =>
      reference.command !== undefined
        ? `If the result message and diagnostics do not explain the failure, run ${reference.command} to read this project's known gate failures and their fixes.`
        : `If the result message and diagnostics do not explain the failure, read this project's known gate failures and fixes in \`${reference.path}\`.`,
  }),

  /**
   * The inlined trap (ADR 0189): a matcher in the gotchas doc recognized this
   * failure, so the entry's own prose replaces the generic pointer — the fix
   * arrives inside the failure instead of one fetch away. The body is bounded
   * by the gotchas surface before firing.
   */
  "gate-failure-gotcha-matched": defineHint<
    & { title: string; body: string }
    & ({ command: CommandRef; path?: never } | {
      path: string;
      command?: never;
    })
  >({
    id: "gate-failure-gotcha-matched",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure matches a trap matcher in the configured gotchas document.",
    family: "gotchas-doc",
    example: {
      title: "A command hangs, then fails with a timeout",
      body:
        "**Symptom.** The gate sits on a stage with no output, then fails it after the timeout.\n\n**Fix.** Wire the command in its single-run form.",
      command: discernCommand(
        "map",
        positional("target", "80-development/done-gate-gotchas"),
        flag("json"),
      ),
    },
    template: ({ title, body, ...reference }): string =>
      `This failure matches "${title}", a documented trap in this project's gate gotchas:\n\n${body}\n\n` +
      (reference.command !== undefined
        ? `Read the full page with ${reference.command}.`
        : `The full page is \`${reference.path}\`.`),
  }),

  /**
   * A malformed trap matcher, surfaced whenever the doc is consulted: a bad
   * block must warn by entry name, never skip without a trace (ADR 0189).
   */
  "gotchas-matcher-invalid": defineHint<{ entry: string; problem: string }>({
    id: "gotchas-matcher-invalid",
    category: "next-step",
    audience: "all",
    when:
      "A gate failure consults a gotchas document carrying a malformed trap matcher.",
    family: "gotchas-doc",
    example: {
      entry: "A command hangs, then fails with a timeout",
      problem: '`stage` is "timeout", which is not a gate stage',
    },
    template: ({ entry, problem }): string =>
      `${
        productSentence(
          `Fix the \`gotcha-match\` block in the gotchas entry "${entry}": ${problem}`,
        )
      } Until it parses, the entry cannot match failures.`,
  }),

  /** The diagnostic-driven remedy for a failed fix stage, which prepare re-runs. */
  "gate-failure-fix": defineGateFailureRemedyHint({
    id: "gate-failure-fix",
    category: "next-step",
    audience: "all",
    when: "The gate's fix stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_PREPARE_REMEDY_CORE,
  }),

  /** The build-stage remedy: prepare never builds, so the loop is the
   * diagnostic's own reproduce command. */
  "gate-failure-build": defineHint({
    id: "gate-failure-build",
    category: "next-step",
    audience: "all",
    when: "The gate's build stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_REPRODUCE_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone check-stage failure. */
  "gate-failure-check": defineGateFailureRemedyHint({
    id: "gate-failure-check",
    category: "next-step",
    audience: "all",
    when: "A standalone gate check fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_PREPARE_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for a standalone test-stage failure. */
  "gate-failure-test": defineHint({
    id: "gate-failure-test",
    category: "next-step",
    audience: "all",
    when: "A standalone test run fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_TEST_REMEDY_CORE,
  }),

  /** The diagnostic-driven remedy for the full gate's combined check/test stage. */
  "gate-failure-check-test": defineHint({
    id: "gate-failure-check-test",
    category: "next-step",
    audience: "all",
    when: "The full gate's combined check and test stage fails.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string => GATE_CHECK_TEST_REMEDY_CORE,
  }),

  /** The changed-scope remedy: a scope gate's check runs only in the full
   * gate, so the loop is the diagnostic's own reproduce command. */
  "gate-failure-scope-gates": defineHint({
    id: "gate-failure-scope-gates",
    category: "next-step",
    audience: "all",
    when: "One or more changed-scope gates fail.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `${GATE_REPRODUCE_REMEDY_CORE} One or more scope gates failed.`,
  }),

  /** A gate stage changed a committed-clean tracked file. */
  "gate-failure-tree-drift": defineHint({
    id: "gate-failure-tree-drift",
    category: "next-step",
    audience: "all",
    when: "A gate stage changes a tracked file from a committed-clean tree.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Review and commit the gate-produced tracked changes named by the diagnostics, then re-run the current discern command.",
  }),

  /** A declared generator changed one or more artifacts it owns. */
  "gate-failure-generated-drift": defineHint<GeneratedDriftRemedyParams>({
    id: "gate-failure-generated-drift",
    category: "next-step",
    audience: "all",
    when:
      "A declared generator changes one or more committed artifacts it owns.",
    family: "gate-failure-remedy",
    example: {
      group: "reference",
      run: "tool write-reference --source source/ --output reference/",
    },
    template: ({ group, run }): string =>
      `Generated group ${
        markdownCodeSpan(`[generated.${group}]`)
      } drifted. Run ${
        markdownCodeSpan(run)
      }, commit the regeneration, then re-run ${CMD.done}. If the tree goes dirty again immediately after you commit that regeneration, the generator is nondeterministic: the same tree did not produce the same bytes. Fix the generator before re-running.`,
  }),

  /** A tracked artifact would change under the current refresh plan. */
  "gate-failure-refresh-drift": defineHint({
    id: "gate-failure-refresh-drift",
    category: "next-step",
    audience: "all",
    when: "The read-only tracked-refresh plan finds an uncommitted effect.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, review and commit the tracked artifacts named by the diagnostics, then re-run the current discern command.`,
  }),

  /** A generated command changed paths outside every declared ownership glob. */
  "gate-failure-generated-undercoverage": defineHint<
    GeneratedUndercoverageRemedyParams
  >({
    id: "gate-failure-generated-undercoverage",
    category: "next-step",
    audience: "all",
    when: "Build changes paths that no generated group declares.",
    family: "gate-failure-remedy",
    example: { groups: ["reference", "schemas"] },
    template: ({ groups }): string =>
      `Generated output escaped every declared glob. Widen the responsible group's paths to include the files named by the diagnostic, commit the regeneration, then re-run ${CMD.done}. Candidate groups: ${
        boundedNameSummary(
          groups.length,
          groups.map((group) => markdownCodeSpan(`[generated.${group}]`)),
        )
      }.`,
  }),

  /** discern-managed ignored output was committed to the repository. */
  "gate-failure-tracked-artifacts": defineHint({
    id: "gate-failure-tracked-artifacts",
    category: "next-step",
    audience: "all",
    when: "The gate finds tracked discern-managed ignored artifacts.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Remove the discern-managed ignored artifacts named by the diagnostics from the Git index, run ${CMD.refresh}, then re-run the current discern command.`,
  }),

  /** Compiled agent instructions differ from their authored sources. */
  "gate-failure-instructions": defineHint({
    id: "gate-failure-instructions",
    category: "next-step",
    audience: "all",
    when: "The gate finds compiled instruction drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, then re-run the current discern command. If the instructions must change, edit \`[instructions].sources\`. Refresh overwrites agent files.`,
  }),

  /** Materialized skills differ from the effective authored set. */
  "gate-failure-skills": defineHint({
    id: "gate-failure-skills",
    category: "next-step",
    audience: "all",
    when: "The gate finds materialized skill drift.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh}, then re-run the current discern command. If a skill must change, edit its source in \`[skills].dir\`. Refresh overwrites materialized copies.`,
  }),

  /** An effective skill cannot be read by supported agent runtimes. */
  "gate-failure-skill-frontmatter": defineHint({
    id: "gate-failure-skill-frontmatter",
    category: "next-step",
    audience: "all",
    when: "The gate finds invalid frontmatter in an effective skill.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each SKILL.md source named by the diagnostics, then re-run the current discern command. Coding-agent runtimes cannot read invalid frontmatter.",
  }),

  /** Two ADR records claim the same number. */
  "gate-failure-adr-numbers": defineHint({
    id: "gate-failure-adr-numbers",
    category: "next-step",
    audience: "all",
    when: "Two or more ADR records in the tree claim the same number.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Renumber the newer of the duplicated ADR records named by the diagnostics to the next free number (update its filename, title, and any references to it), then re-run the current discern command. An ADR number identifies one decision forever — records that landed first, and superseded records, keep theirs.",
  }),

  /** The maintained ADR index drifted from (or cannot be derived from) the records. */
  "gate-failure-adr-index": defineHint({
    id: "gate-failure-adr-index",
    category: "next-step",
    audience: "all",
    when:
      "The maintained ADR index is out of date, or a record defeats its derivation.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.refresh} to regenerate the ADR index, commit the rewritten README, then re-run the current discern command. If the diagnostic says the index cannot be derived, first fix the named record heading or incomplete marker pair. Then refresh again.`,
  }),

  /** The map or a instruction source carries a reference readers cannot follow. */
  "gate-failure-map-integrity": defineHint({
    id: "gate-failure-map-integrity",
    category: "next-step",
    audience: "all",
    when:
      "The gate finds a broken reference or stale example in the map or a instruction source.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Fix each documentation finding named by the diagnostics: repoint dead links and anchors, repair the metadata block, update stale `discern` examples, keep published pages out of the internal trees, and make skill citations name skills that exist. Then re-run the current discern command.",
  }),

  /** The worktree branch does not contain the current trunk. */
  "gate-failure-merge": defineHint({
    id: "gate-failure-merge",
    category: "next-step",
    audience: "all",
    when: "The worktree branch does not contain the current trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      `Run ${CMD.update} to bring the trunk into this branch and re-materialize, then re-run ${CMD.done}.`,
  }),

  /** A branch attempted to weaken a standard held by the trunk. */
  "gate-failure-standards": defineHint({
    id: "gate-failure-standards",
    category: "next-step",
    audience: "all",
    when: "The branch weakens a standard limit held by the trunk.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Follow the standards diagnostics and restore any unauthorized limit change. Try reasonable remedies within the task before asking the owner to change a limit. After owner agreement, follow the measured proposal procedure; general landing permission does not approve a limit change.",
  }),

  /** The gate cannot persist its discern-owned state. */
  "gate-failure-write-denied": defineHint({
    id: "gate-failure-write-denied",
    category: "next-step",
    audience: "all",
    when: "The gate cannot write discern-owned state.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Allow the current invocation to write the path named by the diagnostics, then re-run the discern command. A successful probe confirms only point-in-time write authority; discern does not grant or persist host permission.",
  }),

  /** The declared input closure could not be observed, so no producer ran. */
  "gate-failure-validation-inputs": defineHint({
    id: "gate-failure-validation-inputs",
    category: "next-step",
    audience: "all",
    when: "The gate cannot observe a declared validation input.",
    family: "gate-failure-remedy",
    example: undefined,
    template: (): string =>
      "Resolve the validation input named by the diagnostics: commit or reconcile a nested repository, replace a non-regular file, or restore read access. Then re-run the current discern command.",
  }),

  /** Proof covers the configured checks and leaves artifact verification to
   * the agent. Fired on a green run that emitted Proof before completion is
   * claimed. Carries the discipline of the retired
   * prove-it-works bundled skill (ADR 0173) at the moment it applies. */
  "gate-prove-it-works": defineHint({
    id: "gate-prove-it-works",
    category: "guardrail",
    audience: "agent",
    when: "A green gate emits Proof before the agent reports completion.",
    example: undefined,
    template: (): string =>
      "Proof covers the gate's configured checks. Before reporting completion, exercise the real artifact along the paths the change enables, then report what you ran and what you observed.",
  }),

  /** The owner-consent step after a green gate. Agent-audience: reporting to an
   * owner and waiting is an agent's move — a person running `done` at a
   * terminal IS the owner, with nobody further to report to. The composition
   * contract (account first, one-line Proof last, page stays with discern)
   * is ADR 0188's. */
  "gate-relay-proof": defineHint({
    id: "gate-relay-proof",
    category: "next-step",
    audience: "agent",
    when: "A successful gate records Proof ready for owner review.",
    example: undefined,
    template: (): string =>
      "If this completes the task, report the change, trade-offs, and artifact checks to your owner. End with the result's Proof line verbatim and stop. Your owner can retrieve the full Proof with " +
      `${OWNER_STATUS_VERBOSE}. Run ${CMD.accept} only after they accept.`,
  }),

  /** A green Proof whose exact tree the authority resolver covered. */
  "gate-land-under-verified-authority": defineHint<{
    source: LandingConsentSource;
    scopes: readonly string[];
  }>({
    id: "gate-land-under-verified-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records Proof for a tree with machine-verified landing authority.",
    family: "landing-authority",
    example: { source: "standing-grant", scopes: ["map"] },
    template: ({ source, scopes }): string =>
      source === "effort-grant"
        ? `The owner pre-authorized this landing at the desk, and Proof covers the clean HEAD. Run ${CMD.accept} now to land it; acceptance rechecks the grant before the fast-forward. Report the landing with its Proof line afterward.`
        : `The clean HEAD named by Proof is covered by the standing grant for ${
          scopes.join(", ")
        }. Run ${CMD.accept} now to land it; acceptance rechecks every changed path before the fast-forward. Report the landing with its Proof line afterward.`,
  }),

  /** A green Proof whose recorded authority left changed paths uncovered. */
  "gate-relay-uncovered-authority": defineHint({
    id: "gate-relay-uncovered-authority",
    category: "next-step",
    audience: "agent",
    when:
      "A successful gate records Proof but recorded authority does not cover its tree.",
    family: "landing-authority",
    example: undefined,
    template: (): string =>
      `Report this task to your owner in your own words, end with the ` +
      `result's Proof line verbatim, and stop: the recorded grant does not ` +
      `cover this landing. Your owner can retrieve the full Proof with ${OWNER_STATUS_VERBOSE}.`,
  }),

  "gate-update-docs": defineHint({
    id: "gate-update-docs",
    category: "next-step",
    audience: "all",
    when: "A gate run succeeds.",
    example: undefined,
    template: (): string =>
      "Before reporting completion, compare the changed behavior with the map pages that cover the edited files. Update every page whose facts changed.",
  }),

  "gate-previewable-change": defineHint({
    id: "gate-previewable-change",
    category: "next-step",
    audience: "all",
    when: "A successful gate includes a change that has a configured preview.",
    example: { scope: "site", command: "./scripts/preview-site.sh" },
    template: ({ scope, command }): string =>
      `Preview the changed \`${scope}\` scope by running \`${command}\` from ` +
      "this worktree. The gate reports this configured read-only action; it did not run it.",
  }),
} as const;
