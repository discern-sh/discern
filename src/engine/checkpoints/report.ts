/**
 * `discern checkpoints` — the checkpoint contract's read surface. One
 * read-only report answers, from a single command: which checkpoints govern
 * this effort (question, trigger, mode, and the policy identity), what state
 * each open question is in (awaiting a declaration, declared met, declared unmet —
 * variance required, or reopened), and what the current change would fire — a
 * structural preview beside the same strict obligation `prepare`, `status`,
 * `done --dry-run`, and bare `done` consume.
 *
 * Like every result verb it computes one {@link DiscernResult}; the human
 * report, `--json`/`--markdown`, and the MCP tool are renderings of the same
 * evaluated data. {@link checkpointsResult} is the unrendered core the MCP
 * server calls; {@link runCheckpoints} is the CLI.
 *
 * Read-only means READ-ONLY: no `when` command runs (a pending one is
 * reported honestly as undecided), no open question is created or touched, and
 * every uncertainty fails open into an advisory — never a refusal.
 */

import { loadConfig } from "../../shared/config_schema.ts";
import {
  renderResultSummaryCli,
  type ResultSummaryCliProps,
} from "discern-design-system/cli";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  CheckpointEconomics,
  CheckpointEconomicsRow,
  CheckpointReportData,
  CheckpointsData,
  CheckpointTriggerPreviewData,
  OpenQuestionData,
  OpenQuestionState,
  RelatedCheckpointEvidenceData,
  UngovernedOpenQuestionData,
} from "../../shared/result_schemas.ts";
import type {
  CheckpointObligationState,
  TriggerVeto,
} from "../../shared/checkpoints.ts";
import { RELATED_CHECKPOINT_KIND_LABELS } from "../../shared/checkpoints.ts";
import { emitResult } from "../../shared/emit.ts";
import { checkpointDropAccounts } from "../../shared/checkpoint_drops.ts";
import { fire, type FiredHint, HINTS, hintTexts } from "../../shared/hints.ts";
import { interactiveHintTexts } from "../../shared/hints.ts";
import { makeOut, type Out } from "../output.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import type { OpenQuestion } from "./open_questions.ts";
import { checkpointEconomicsOf } from "../logbook/checkpoint_economics.ts";
import { buildStreamFacts } from "../logbook/detectors.ts";
import { readLogbookStream } from "../logbook/read.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import {
  activeOpenQuestionState,
  type CheckpointInspection,
  inspectCheckpointObligations,
} from "./inspection.ts";
import type { ResolvedCheckpoint, StructuralTriggerOutcome } from "./types.ts";
import { relatedCheckpointData } from "./related.ts";

// ── the trigger summary ─────────────────────────────────────────────────────

/** Longest `when` command text shown before elision. */
const WHEN_SUMMARY_MAX = 48;

/** Cap a glob list for one summary line. */
function capList(items: readonly string[], max: number): string {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, +${items.length - max} more` : shown;
}

/** One-line deterministic summary of a resolved trigger — what makes this
 * checkpoint relevant, readable at a glance beside its question. */
export function triggerSummary(def: ResolvedCheckpoint): string {
  const parts: string[] = [];
  if (def.selector === undefined) {
    parts.push("any change");
  } else if (def.selector.scope !== undefined) {
    parts.push(`scope ${def.selector.scope}`);
  } else {
    parts.push(`paths ${capList(def.selector.globs, 3)}`);
  }
  parts.push(def.includeGenerated ? "including generated" : "authored only");
  if (def.excludePaths.length > 0) {
    parts.push(`excluding ${capList(def.excludePaths, 2)}`);
  }
  if (def.unlessChanged.length > 0) {
    parts.push(`unless ${capList(def.unlessChanged, 2)} changed`);
  }
  if (def.kinds.length > 0) parts.push(`kinds ${def.kinds.join(", ")}`);
  if (def.addsMatching.length > 0) {
    parts.push(`added-line literals ${def.addsMatching.length}`);
  }
  if (def.removesMatching.length > 0) {
    parts.push(`removed-line literals ${def.removesMatching.length}`);
  }
  if (def.newDirectory) parts.push("new directory");
  if (def.binary !== undefined) {
    parts.push(def.binary ? "binary files" : "text files");
  }
  if (def.minChangedFiles !== undefined) {
    parts.push(`≥${def.minChangedFiles} files`);
  }
  if (def.minChangedLines !== undefined) {
    parts.push(`≥${def.minChangedLines} changed lines`);
  }
  if (def.deletionDominant) {
    parts.push("deletion-dominant");
  }
  if (def.similarNewFile) {
    parts.push("similar new file");
  }
  if (def.minCommits !== undefined) parts.push(`≥${def.minCommits} commits`);
  if (def.when !== undefined) {
    const command = def.when.length > WHEN_SUMMARY_MAX
      ? `${def.when.slice(0, WHEN_SUMMARY_MAX)}…`
      : def.when;
    parts.push(`when: ${command}`);
  }
  return parts.join(" · ");
}

// ── projections ─────────────────────────────────────────────────────────────

/** Project one structural outcome onto the wire preview shape. */
function triggerPreviewData(
  outcome: StructuralTriggerOutcome,
): CheckpointTriggerPreviewData {
  if (!outcome.holds) {
    return { holds: false, vetoed_by: outcome.vetoedBy };
  }
  return {
    holds: true,
    ...(outcome.whenPending ? { when_pending: true } : {}),
    matched: [...outcome.matched],
    ...(outcome.related.length === 0
      ? {}
      : { related: relatedCheckpointData(outcome.related) }),
  };
}

/** Project one stored openQuestion onto the wire shape. The canonical
 * obligation supplies the currency state strict `done` would act on; for an
 * ungoverned stored record, the store's own binding remains the account. */
function openQuestionData(
  openQuestion: OpenQuestion,
  stop: boolean,
  obligation?: CheckpointObligationState,
): OpenQuestionData {
  const declaration = openQuestion.declaration;
  const projected = obligation === "awaiting_declaration" ||
      obligation === "reopened" || obligation === "declared_met" ||
      obligation === "declared_unmet"
    ? obligation
    : activeOpenQuestionState(openQuestion);
  const state: OpenQuestionState = projected;
  const current = declaration !== undefined &&
    (state === "declared_met" || state === "declared_unmet");
  return {
    state,
    definition_hash: openQuestion.definitionHash,
    subject: openQuestion.subject,
    matched: [...openQuestion.matchedPaths],
    ...(openQuestion.relatedPaths.length === 0
      ? {}
      : { related: relatedCheckpointData(openQuestion.relatedPaths) }),
    opened_at: openQuestion.openedAt,
    ...(openQuestion.reopenedAt === undefined
      ? {}
      : { reopened_at: openQuestion.reopenedAt }),
    ...(declaration === undefined ? {} : {
      declaration: {
        conclusion: declaration.conclusion,
        ...(declaration.conclusion === "unmet" ? { why: declaration.why } : {}),
        declared_at: declaration.declaredAt,
        current,
      },
    }),
    ...(stop &&
        (obligation === "declared_unmet" ||
          (obligation === undefined && state === "declared_unmet"))
      ? { variance_required: true }
      : {}),
  };
}

/**
 * Observed per-checkpoint economics from the local Logbook: the shared
 * economics reader over the same tolerant stream `patterns` analyzes, bounded
 * and local. Advisory by construction — the read can only add an `economics`
 * block to an always-ok report, and any trouble (no repository, an unreadable
 * Logbook) degrades to "no observed history yet", never a refusal.
 */
export async function observedCheckpointEconomics(
  root: string,
): Promise<CheckpointEconomics | undefined> {
  try {
    const config = await loadConfig(root);
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir === undefined) {
      return undefined;
    }
    const stream = await readLogbookStream(commonGitDir);
    return checkpointEconomicsOf(
      buildStreamFacts(stream.events, config.repository.trunk),
    );
  } catch {
    return undefined;
  }
}

// ── the core ────────────────────────────────────────────────────────────────

/** What the assembled report routes the caller toward. */
interface ReportRouting {
  /** Stop questions awaiting the caller's conclusion at `done`. */
  awaiting: string[];
  /** Current declared-unmet conclusions — owner variance required to land. */
  varianceRequired: string[];
}

/** Assemble the report rows plus the routing facts the hints fire from. */
function assembleReport(
  inspection: CheckpointInspection,
): {
  rows: CheckpointReportData[];
  ungoverned: UngovernedOpenQuestionData[];
  routing: ReportRouting;
} {
  const routing: ReportRouting = { awaiting: [], varianceRequired: [] };
  const rows = inspection.entries.map((entry): CheckpointReportData => {
    const def = entry.definition;
    const stop = def.mode === "stop";
    const outcome = entry.outcome;
    const openQuestion = entry.openQuestion;
    const data = openQuestion === undefined
      ? undefined
      : openQuestionData(openQuestion, stop, entry.obligation.state);
    if (stop) {
      switch (entry.obligation.state) {
        case "will_open":
        case "awaiting_declaration":
        case "reopened":
          routing.awaiting.push(def.id);
          break;
        case "declared_unmet":
          routing.varianceRequired.push(def.id);
          break;
      }
    }
    return {
      id: def.id,
      mode: def.mode,
      question: def.question,
      ...(def.teach === undefined ? {} : { teach: def.teach }),
      ...(def.reference === undefined ? {} : { reference: def.reference }),
      trigger: triggerSummary(def),
      obligation: entry.obligation.state,
      ...(outcome === undefined
        ? {}
        : { preview: triggerPreviewData(outcome) }),
      ...(data === undefined ? {} : { open_question: data }),
    };
  });
  const governed = new Set(inspection.checkpoints.map((def) => def.id));
  const ungoverned = Object.values(inspection.openQuestions)
    .filter((openQuestion) => !governed.has(openQuestion.checkpoint))
    .map((openQuestion): UngovernedOpenQuestionData => ({
      id: openQuestion.checkpoint,
      open_question: openQuestionData(openQuestion, false),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { rows, ungoverned, routing };
}

/**
 * Compute the `checkpoints` {@link DiscernResult} without printing or exiting
 * — the entry point the MCP server renders and the CLI serializes. Always
 * `ok`: this is an account of state, and every uncertainty (an unresolvable
 * policy, an unreadable diff or store) degrades to an advisory.
 */
export async function checkpointsResult(
  root: string,
): Promise<DiscernResult<CheckpointsData>> {
  const config = await loadConfig(root);
  const inspection = await inspectCheckpointObligations(root, config);
  const advisories = checkpointDropAccounts(inspection.drops);
  const { rows, ungoverned, routing } = assembleReport(inspection);
  const economics = await observedCheckpointEconomics(root);
  const data: CheckpointsData = {
    ...(inspection.policyCommit === undefined
      ? {}
      : { policy: inspection.policyCommit }),
    checkpoints: rows,
    ...(ungoverned.length === 0 ? {} : { ungoverned }),
    ...(economics === undefined ? {} : { economics }),
    ...(inspection.drops.length === 0 ? {} : { drops: [...inspection.drops] }),
    ...(advisories.length === 0 ? {} : { advisories: [...advisories] }),
  };

  const hints: FiredHint[] = advisories.map((advisory) =>
    fire(HINTS["checkpoint-advisory"], { advisory })
  );
  if (routing.awaiting.length > 0) {
    hints.push(fire(HINTS["checkpoints-declare"], { ids: routing.awaiting }));
  }
  if (routing.varianceRequired.length > 0) {
    hints.push(
      fire(HINTS["checkpoints-variance-review"], {
        ids: routing.varianceRequired,
      }),
    );
  }

  return {
    ok: true,
    verb: "checkpoints",
    data,
    ...(hints.length > 0 ? { hints: hintTexts(hints) } : {}),
  };
}

// ── human rendering ─────────────────────────────────────────────────────────

/** The one attention scale the terminal rows map onto. A declaration row
 * never takes the `passed` state: the renderer prints the state as the row's
 * label, and "Passed" is machine-verdict vocabulary — agent evidence reads
 * "declared met" through the fact, on a neutral state whose label is also
 * literally true (a current declaration means its subject is unchanged since
 * it was judged). */
const ROW_STATES = {
  idle: "unchanged",
  fires: "changed",
  awaiting: "changed",
  declaredMet: "unchanged",
  declaredUnmet: "changed",
} as const satisfies Readonly<Record<string, ResultSummaryCliProps["state"]>>;

/** The human wording for a veto — why an idle trigger did not hold. */
const VETO_WORDING: Readonly<Record<TriggerVeto, string>> = {
  empty_matched_set: "no matched change",
  generated_only: "only generated selector matches",
  excluded_only: "all authored selector matches were explicitly excluded",
  kinds: "no selected change has an admitted kind",
  adds_matching: "no added line contains a configured literal",
  removes_matching: "no removed line contains a configured literal",
  new_directory: "no addition creates a new directory",
  binary: "no change has the selected binary/text kind",
  unless_changed: "its unless_changed counterpart also changed",
  min_changed_files: "below its file threshold",
  min_changed_lines: "below its changed-line threshold",
  deletion_dominant: "the change is not deletion-dominant",
  similar_new_file: "no name-similar new file",
  min_commits: "below its commit threshold",
};

/** One row's state sentence plus its visual weight. */
function rowPresentation(row: CheckpointReportData): {
  state: ResultSummaryCliProps["state"];
  fact: string;
  attention: boolean;
} {
  const openQuestion = row.open_question;
  switch (row.obligation) {
    case "declared_met":
      return {
        state: ROW_STATES.declaredMet,
        fact: `Declared met (${openQuestion?.declaration?.declared_at ?? ""}).`,
        attention: false,
      };
    case "declared_unmet":
      return {
        state: ROW_STATES.declaredUnmet,
        fact: openQuestion?.variance_required === true
          ? "Declared unmet — owner variance required to land."
          : "Declared unmet.",
        attention: true,
      };
    case "reopened":
      return {
        state: ROW_STATES.awaiting,
        fact: `Reopened — a relevant change unbound the declared ` +
          `${openQuestion?.declaration?.conclusion ?? ""} conclusion; ` +
          "declare again.",
        attention: true,
      };
    case "awaiting_declaration":
      return {
        state: ROW_STATES.awaiting,
        fact: "Awaiting a declared conclusion.",
        attention: true,
      };
    case "unknown":
      return {
        state: ROW_STATES.idle,
        fact:
          "Unknown — checkpoint state failed open rather than being guessed.",
        attention: true,
      };
    case "none":
    case "will_open":
      break;
  }
  const preview = row.preview;
  if (preview === undefined) {
    return {
      state: ROW_STATES.idle,
      fact: "Unknown — the effort diff could not be read.",
      attention: false,
    };
  }
  if (!preview.holds) {
    const veto = preview.vetoed_by;
    return {
      state: ROW_STATES.idle,
      fact: `Idle (${veto === undefined ? "no fire" : VETO_WORDING[veto]}).`,
      attention: false,
    };
  }
  const matched = preview.matched?.length ?? 0;
  if (preview.when_pending === true) {
    return {
      state: ROW_STATES.fires,
      fact: `May fire at done — its when command decides (${matched} matched).`,
      attention: true,
    };
  }
  return {
    state: ROW_STATES.fires,
    fact: row.mode === "advise"
      ? `Would serve its advisory at done (${matched} matched).`
      : `Would fire at done — a declared conclusion will be required (${matched} matched).`,
    attention: true,
  };
}

/** A compact human duration from seconds: `42s`, `12m`, `1.5h`. */
function humanSeconds(seconds: number): string {
  if (seconds < 90) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 5_400) {
    return `${Math.round(seconds / 60)}m`;
  }
  return `${Math.round(seconds / 360) / 10}h`;
}

/** One observed-economics row as two plain-count lines: the serving footprint
 * with its effort denominator, then how its open questions concluded. Observation
 * vocabulary only — counts beside denominators, never a verdict. */
function economicsLines(
  row: CheckpointEconomicsRow,
  efforts: number,
): { fact: string; detail?: string } {
  const fact = `${row.id} — fired on ${row.efforts_fired} of ${efforts} ` +
    `efforts · ${row.fires} serving${row.fires === 1 ? "" : "s"}`;
  const conclusions: string[] = [];
  if (row.declared > 0) {
    const split: string[] = [];
    if (row.declared_unchanged > 0) {
      split.push(`${row.declared_unchanged} on an unchanged subject`);
    }
    if (row.declared_unmet > 0) {
      split.push(`${row.declared_unmet} unmet`);
    }
    conclusions.push(
      `Declared ${row.declared}${
        split.length === 0 ? "" : ` (${split.join(", ")})`
      }.`,
    );
  }
  if (row.median_declare_s !== undefined) {
    conclusions.push(
      `Median time to declare: ${humanSeconds(row.median_declare_s)}.`,
    );
  }
  const lifecycle: string[] = [];
  if (row.reopened > 0) {
    lifecycle.push(`${row.reopened} reopened`);
  }
  if (row.variances > 0) {
    lifecycle.push(
      `${row.variances} authorized variance${row.variances === 1 ? "" : "s"} ` +
        `(${row.efforts_landed} of its efforts landed)`,
    );
  }
  if (row.abandoned > 0) {
    lifecycle.push(`${row.abandoned} abandoned`);
  }
  if (lifecycle.length > 0) {
    conclusions.push(`${lifecycle.join(" · ")}.`);
  }
  return {
    fact,
    ...(conclusions.length === 0 ? {} : { detail: conclusions.join(" ") }),
  };
}

/** Bounded evidence line for a row's matched paths. */
function matchedLine(paths: readonly string[] | undefined): string | undefined {
  if (paths === undefined || paths.length === 0) {
    return undefined;
  }
  const shown = paths.slice(0, 4).join(", ");
  const more = paths.length > 4 ? `, +${paths.length - 4} more` : "";
  return `Changed: ${shown}${more}.`;
}

/** Total human wording for every typed related-evidence kind. Dynamic paths
 * cross `terminalMultiline` at the rendering boundary below. */
const RELATED_WORDING: Readonly<
  Record<
    RelatedCheckpointEvidenceData["kind"],
    (relation: RelatedCheckpointEvidenceData) => string
  >
> = {
  similar_existing: (relation) =>
    `${
      RELATED_CHECKPOINT_KIND_LABELS[relation.kind]
    }: ${relation.path} resembles ${relation.for_path}.`,
};

/** Render typed related evidence beside, but distinct from, changed paths. */
function relatedLines(
  related: readonly RelatedCheckpointEvidenceData[] | undefined,
): string[] {
  return (related ?? []).map((relation) =>
    RELATED_WORDING[relation.kind](relation)
  );
}

/** Presentation facts for the package renderers (mirrors the verb peers). */
function presentationFacts(out: Out): {
  readonly presenter: Out["terminal"]["presenter"];
  readonly width: number;
} {
  const width = Math.max(20, Math.min(104, out.terminal.size.columns));
  return { presenter: out.terminal.presenter, width };
}

/** Preserve the stable human-output group id while the package owns its rule. */
function renderGroup(out: Out, id: string, label: string): void {
  const { presenter, width } = presentationFacts(out);
  out.group(id);
  out.raw(`${
    presenter.motifSectionRule(terminalLine(label), {
      register: "brand",
      width,
    })
  }\n`);
}

/** Render one governing checkpoint's full serving. */
function renderRow(out: Out, row: CheckpointReportData): void {
  const { presenter, width } = presentationFacts(out);
  const { state, fact, attention } = rowPresentation(row);
  const evidence = matchedLine(
    row.open_question?.matched ?? row.preview?.matched,
  );
  const related = relatedLines(
    row.open_question?.related ?? row.preview?.related,
  );
  const why = row.open_question?.declaration?.why;
  const detail = [
    attention ? `Question: ${row.question.trim()}` : undefined,
    attention && row.teach !== undefined && row.teach.trim() !== ""
      ? `Teach: ${row.teach.trim()}`
      : undefined,
    why === undefined ? undefined : `Rationale: ${why}`,
    attention ? evidence : undefined,
    ...(attention ? related : []),
  ].filter((line): line is string => line !== undefined);
  out.raw(`${
    presenter.present(renderResultSummaryCli, {
      state,
      fact: terminalMultiline(
        `${row.id} (${row.mode}) · ${row.trigger}\n${fact}`,
      ),
      ...(detail.length === 0
        ? {}
        : { nextAction: terminalMultiline(detail.join("\n")) }),
      maxWidth: width,
    })
  }\n`);
}

/** Options accepted by the checkpoints CLI. */
export interface RunCheckpointsOptions {
  json: boolean;
  /** Explicit human presentation facts; CLI callers use the installed context. */
  terminal?: TerminalContext;
  /** Injectable writers retained for deterministic human-entrypoint coverage. */
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** Run `discern checkpoints`. Returns a process exit code (0 = reported). */
export async function runCheckpoints(
  root: string,
  opts: RunCheckpointsOptions,
): Promise<number> {
  const result = await checkpointsResult(root);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const terminal = opts.terminal ?? terminalContext();
  const out = makeOut(terminal.color, {
    terminal,
    ...(opts.stdout === undefined ? {} : { stdout: opts.stdout }),
    ...(opts.stderr === undefined ? {} : { stderr: opts.stderr }),
  });
  const config = await loadConfig(root);
  const data = result.data ?? { checkpoints: [] };
  const { presenter, width } = presentationFacts(out);

  out.heading(
    terminalLine(
      `discern checkpoints${
        config.project.slug ? ` · ${config.project.slug}` : ""
      }`,
    ),
  );
  renderGroup(out, "policy", "Governing checkpoints");
  if (data.checkpoints.length === 0) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine("No checkpoint governs this effort."),
        maxWidth: width,
      })
    }\n`);
  } else {
    for (const row of data.checkpoints) {
      renderRow(out, row);
    }
    if (data.policy !== undefined) {
      out.raw(`${
        presenter.present(renderResultSummaryCli, {
          state: "unchanged",
          fact: terminalLine(
            `Policy identity: ${
              data.policy.slice(0, 12)
            } (the merge-base configuration governs).`,
          ),
          maxWidth: width,
        })
      }\n`);
    }
  }
  if (data.ungoverned !== undefined && data.ungoverned.length > 0) {
    renderGroup(out, "ungoverned", "Outside the governing policy");
    for (const entry of data.ungoverned) {
      out.raw(`${
        presenter.present(renderResultSummaryCli, {
          state: "unchanged",
          fact: terminalMultiline(
            `${entry.id} — its openQuestion stands (${entry.open_question.state}), but ` +
              `the current governing policy does not contain it.`,
          ),
          maxWidth: width,
        })
      }\n`);
    }
  }
  if (data.checkpoints.length > 0) {
    renderGroup(out, "history", "Observed history");
    const economics = data.economics;
    if (economics === undefined) {
      out.raw(`${
        presenter.present(renderResultSummaryCli, {
          state: "unchanged",
          fact: terminalLine("No observed checkpoint history yet."),
          maxWidth: width,
        })
      }\n`);
    } else {
      for (const row of economics.rows) {
        const lines = economicsLines(row, economics.efforts);
        out.raw(`${
          presenter.present(renderResultSummaryCli, {
            state: "unchanged",
            fact: terminalMultiline(lines.fact),
            ...(lines.detail === undefined
              ? {}
              : { nextAction: terminalMultiline(lines.detail) }),
            maxWidth: width,
          })
        }\n`);
      }
      if (economics.omitted > 0) {
        out.raw(`${
          presenter.present(renderResultSummaryCli, {
            state: "unchanged",
            fact: terminalLine(
              `${economics.omitted} more checkpoint${
                economics.omitted === 1 ? "" : "s"
              } with observed history — counted, not listed.`,
            ),
            maxWidth: width,
          })
        }\n`);
      }
    }
  }
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
  return result.ok ? 0 : 1;
}
