/**
 * `discern improvement` — the continuous-improvement coach. It scores a project's
 * objective baseline against the {@link CATEGORIES} catalog, keeps qualitative
 * reviews visibly open, and identifies the single highest-value next action.
 *
 * Like every verb it computes one {@link DiscernResult} (ADR 0028); its human
 * report, its `--json`, and the MCP tool are three renderings of the same evaluated
 * {@link ImprovementReport}. {@link improvementResult} is the unrendered core the MCP
 * server calls; {@link runImprovement} is the CLI, which adds a human report and — on a
 * TTY — an interactive drill-down into each weak area.
 *
 * Deterministic rules are scored now; subjective rules are surfaced as review items
 * the agent judges against the cited material. The score is therefore an honest
 * floor ("here is what is mechanically missing"), and the reviews are the ceiling
 * ("here is what still needs judgement").
 */

import { loadConfig } from "../../shared/config_schema.ts";
import {
  renderCommandCli,
  renderDiagnosticCli,
  renderMeterCli,
  renderProcedureCli,
  renderResultSummaryCli,
  renderResultSummaryGroupCli,
  type ResultSummaryCliProps,
  type ResultSummaryGroupCliItem,
} from "discern-design-system/cli";
import type { DiscernResult } from "../../shared/result.ts";
import type { ImprovementData } from "../../shared/result_schemas.ts";
import type { PatternsFinding } from "../../shared/patterns_vocabulary.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  failureRecoveryHintTexts,
  fire,
  HINTS,
  hintTexts,
} from "../../shared/hints.ts";
import { addAdvisoryHints } from "../logbook/routing.ts";
import { makeOut, type Out } from "../output.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import { buildContext, CATEGORIES, isDeterministic } from "./rules.ts";
import {
  boundaryGuardsByQuestion,
  boundaryLine,
  checkpointRecommendations,
} from "./checkpoint_loop.ts";
import type {
  BoundaryGuard,
  Category,
  CategoryResult,
  CheckpointRecommendation,
  ImprovementContext,
  ImprovementReport,
  NextAction,
  ReviewResult,
  RuleResult,
  RuleStatus,
} from "./types.ts";
import {
  canInteract,
  groupedSelectionEntries,
  isInteractionCancelled,
  requestSelection,
} from "../../lib/terminal_interaction.ts";

// ── evaluation ──────────────────────────────────────────────────────────────

/** The fractional credit a status earns toward its rule's weight. */
function credit(status: RuleStatus): number {
  return status === "pass" ? 1 : status === "partial" ? 0.5 : 0;
}

/** Evaluate one category's rules against the gathered context. `guards` marks
 * a review whose canonical question a configured checkpoint also serves —
 * the flow is guarded at the gate; the review audits what already exists. */
function evaluateCategory(
  cat: Category,
  ctx: ImprovementContext,
  guards: ReadonlyMap<string, BoundaryGuard[]>,
): CategoryResult {
  const rules: RuleResult[] = [];
  const reviews: ReviewResult[] = [];
  let passWeight = 0;
  let totalWeight = 0;
  let weak = 0;
  for (const rule of cat.rules) {
    if (isDeterministic(rule)) {
      const v = rule.evaluate(ctx);
      passWeight += credit(v.status) * rule.weight;
      totalWeight += rule.weight;
      if (v.status !== "pass") {
        weak++;
      }
      rules.push({
        id: rule.id,
        title: rule.title,
        status: v.status,
        weight: rule.weight,
        detail: v.detail,
        teach: rule.teach,
        ...(v.status === "pass" ? {} : { fix: rule.fix }),
      });
    } else {
      const against = rule.against(ctx);
      const boundary = guards.get(rule.id);
      reviews.push({
        id: rule.id,
        title: rule.title,
        ask: rule.ask,
        teach: rule.teach,
        ...(against !== undefined ? { against } : {}),
        ...(boundary !== undefined && boundary.length > 0 ? { boundary } : {}),
      });
    }
  }
  reviews.push(...(cat.dynamicReviews?.(ctx) ?? []));
  const score = totalWeight === 0
    ? 100
    : Math.round((passWeight / totalWeight) * 100);
  return {
    name: cat.name,
    title: cat.title,
    score,
    weight: totalWeight,
    weak,
    rules,
    reviews,
  };
}

/**
 * Evaluate the catalog into a ranked report. `only` restricts evaluation to a
 * single category slug. The
 * overall score is weighted over EVERY evaluated deterministic rule, and the
 * categories are sorted weakest-first (then by most weak rules, then most reviews).
 */
export function evaluateReport(
  ctx: ImprovementContext,
  only?: string,
): ImprovementReport {
  const guards = boundaryGuardsByQuestion(ctx.config);
  const categories: CategoryResult[] = [];
  for (const cat of CATEGORIES) {
    if (only !== undefined && cat.name !== only) {
      continue;
    }
    categories.push(evaluateCategory(cat, ctx, guards));
  }

  let passWeight = 0;
  let totalWeight = 0;
  let weak = 0;
  let reviews = 0;
  for (const c of categories) {
    for (const r of c.rules) {
      passWeight += credit(r.status) * r.weight;
      totalWeight += r.weight;
    }
    weak += c.weak;
    reviews += c.reviews.length;
  }
  const score = totalWeight === 0
    ? 100
    : Math.round((passWeight / totalWeight) * 100);

  const recommendations = checkpointRecommendations(ctx.config, {
    findings: ctx.historicalFindings ?? [],
    varied: ctx.variedCheckpoints ?? [],
  });
  const nextAction = selectNextAction(categories, recommendations);
  categories.sort((a, b) =>
    a.score - b.score ||
    b.weak - a.weak ||
    b.reviews.length - a.reviews.length ||
    a.title.localeCompare(b.title)
  );
  return { score, weak, reviews, nextAction, recommendations, categories };
}

/**
 * Choose one action before display sorting mutates catalog order. Objective gaps
 * lead, ranked by recoverable weighted credit; ties keep the catalog's deliberate
 * coaching order. With a clear baseline, an evidence-backed owner decision from
 * the checkpoint loop outranks the standing reviews (it cites project-local
 * observations; a review is a standing question). Then the first review leads.
 */
function selectNextAction(
  categories: readonly CategoryResult[],
  recommendations: readonly CheckpointRecommendation[],
): NextAction {
  let best:
    | { action: NextAction; recoverableWeight: number }
    | undefined;
  for (const category of categories) {
    for (const rule of category.rules) {
      if (rule.status === "pass") {
        continue;
      }
      const recoverableWeight = rule.weight * (1 - credit(rule.status));
      if (best === undefined || recoverableWeight > best.recoverableWeight) {
        best = {
          recoverableWeight,
          action: {
            kind: "fix",
            category: category.name,
            id: rule.id,
            title: rule.title,
            action: rule.fix ?? rule.title,
            why: rule.teach,
          },
        };
      }
    }
  }
  if (best !== undefined) {
    return best.action;
  }
  const recommendation = recommendations[0];
  if (recommendation !== undefined) {
    return {
      kind: "decide",
      category: "checkpoints",
      id: recommendation.id,
      title: recommendation.title,
      action: recommendation.action,
      why: recommendation.why,
      against: recommendation.evidence,
    };
  }
  for (const category of categories) {
    const review = category.reviews[0];
    if (review !== undefined) {
      return {
        kind: "review",
        category: category.name,
        id: review.id,
        title: review.title,
        action: review.ask,
        why: review.teach,
        ...(review.against !== undefined ? { against: review.against } : {}),
      };
    }
  }
  return {
    kind: "review",
    category: "all",
    id: "improvement.qualitative-review",
    title: "Review the practices qualitatively",
    action:
      "Review whether the configured practices are effective, not merely present.",
    why:
      "Automated practice health covers only facts discern can prove mechanically; a clear score is not the same as being done.",
  };
}

// ── the category filter (shared validation) ─────────────────────────────────

/** Whether a `--category` slug names a catalog category. */
function isKnownCategory(name: string): boolean {
  return CATEGORIES.some((c) => c.name === name);
}

/** Options accepted by the improvement core and CLI. */
export interface ImprovementOptions {
  /** Restrict to one category slug. */
  category?: string | undefined;
  /** Fail (exit 1 / `ok:false`) when the overall score is below this floor. */
  minScore?: number | undefined;
}

/**
 * Build the report or an error envelope — the shared core behind the CLI and the
 * MCP tool. A bad `--category` becomes a clean error DiscernResult rather than a
 * thrown exception.
 */
async function buildReport(
  root: string,
  opts: ImprovementOptions,
): Promise<
  | { report: ImprovementReport; historicalFindings: PatternsFinding[] }
  | { error: DiscernResult<never> }
> {
  const config = await loadConfig(root);
  if (opts.category !== undefined && !isKnownCategory(opts.category)) {
    const known = CATEGORIES.map((c) => c.name).join(", ");
    return {
      error: {
        ok: false,
        verb: "improvement",
        error: "unknown_category",
        message:
          `unknown category "${opts.category}" — known categories: ${known}.`,
        hints: failureRecoveryHintTexts("improvement"),
      },
    };
  }
  const ctx = await buildContext(root, config);
  return {
    report: evaluateReport(ctx, opts.category),
    historicalFindings: ctx.historicalFindings ?? [],
  };
}

/** Reduce an {@link ImprovementReport} to the verb's `data` payload. Typed as the
 * schema-inferred {@link ImprovementData} (the SSOT in `result_schemas.ts`), so a drift
 * between this mapping and the advertised MCP `outputSchema` is a compile error. */
function reportData(
  report: ImprovementReport,
  historicalFindings: PatternsFinding[],
): ImprovementData {
  return {
    score: report.score,
    weak: report.weak,
    open_reviews: report.reviews,
    next_action: {
      kind: report.nextAction.kind,
      category: report.nextAction.category,
      id: report.nextAction.id,
      title: report.nextAction.title,
      action: report.nextAction.action,
      why: report.nextAction.why,
      ...(report.nextAction.against !== undefined
        ? { against: report.nextAction.against }
        : {}),
    },
    ...(report.recommendations.length === 0
      ? {}
      : { recommendations: report.recommendations }),
    categories: report.categories.map((c) => ({
      name: c.name,
      title: c.title,
      score: c.score,
      weight: c.weight,
      weak: c.weak,
      rules: c.rules,
      reviews: c.reviews,
    })),
    history: { findings: historicalFindings },
  };
}

/**
 * Compute the `improvement` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders. `ok` is true for a completed review; when
 * `minScore`
 * is set and the overall score is below it, `ok` flips to false with a
 * `below_min_score` error (the CI/agent enforcement signal).
 */
export async function improvementResult(
  root: string,
  opts: ImprovementOptions = {},
): Promise<DiscernResult<ImprovementData>> {
  const built = await buildReport(root, opts);
  if ("error" in built) {
    return built.error;
  }
  const { report, historicalFindings } = built;
  const belowMin = opts.minScore !== undefined && report.score < opts.minScore;
  const fields = {
    verb: "improvement",
    data: reportData(report, historicalFindings),
  };
  const result: DiscernResult<ImprovementData> = belowMin
    ? {
      ok: false,
      error: "below_min_score",
      message:
        `automated practice health ${report.score}/100 is below the required minimum score of ${opts.minScore}.`,
      hints: hintTexts([fire(HINTS["improvement-follow-next-action"])]),
      ...fields,
    }
    : { ok: true, ...fields };
  const config = await loadConfig(root);
  if (!config.project.logbook) {
    addAdvisoryHints(result, [fire(HINTS["improvement-logbook-off"])]);
  }
  return result;
}

// ── human rendering ─────────────────────────────────────────────────────────

/** Give package renderers one explicit, bounded view of the shared context. */
function presentationFacts(out: Out): {
  readonly presenter: Out["terminal"]["presenter"];
  readonly width: number;
} {
  const width = Math.max(20, Math.min(104, out.terminal.size.columns));
  return {
    presenter: out.terminal.presenter,
    width,
  };
}

/** Exhaustive objective-rule adaptation into package result semantics. */
export const IMPROVEMENT_RULE_RESULT_STATE = {
  pass: "passed",
  partial: "changed",
  fail: "failed",
} as const satisfies Readonly<
  Record<RuleStatus, ResultSummaryCliProps["state"]>
>;

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

/** Render an open qualitative review as one evidence-preserving procedure. A
 * boundary-guarded review names its checkpoints, keeping stock and flow
 * distinct: the gate stops new violations; the review audits what already exists. */
function renderReviewUnit(
  out: Out,
  review: {
    title: string;
    ask: string;
    teach: string;
    against?: ReviewResult["against"];
    boundary?: ReviewResult["boundary"];
  },
): void {
  const { presenter, width } = presentationFacts(out);
  const evidence = review.against === undefined
    ? undefined
    : `${review.against.source}: ${review.against.excerpt}`;
  const boundary = review.boundary === undefined || review.boundary.length === 0
    ? undefined
    : boundaryLine(review.boundary);
  out.raw(`${
    presenter.present(renderProcedureCli, {
      title: terminalLine(review.title),
      description: terminalMultiline(
        `${review.teach}${
          evidence === undefined ? "" : `\nEvidence: ${evidence}`
        }${boundary === undefined ? "" : `\n${boundary}`}`,
      ),
      steps: [{
        title: terminalLine("Conduct the qualitative review."),
        status: "active",
      }],
      completion: terminalMultiline(review.ask),
      completionLabel: terminalLine("Review question"),
      register: "brand",
      maxWidth: width,
    })
  }\n`);
}

/** Render one evidence-backed owner decision from the checkpoint loop. */
function renderRecommendationUnit(
  out: Out,
  recommendation: CheckpointRecommendation,
): void {
  const { presenter, width } = presentationFacts(out);
  out.raw(`${
    presenter.present(renderProcedureCli, {
      title: terminalLine(recommendation.title),
      description: terminalMultiline(
        `${recommendation.why}\nEvidence: ${recommendation.evidence.source}: ${recommendation.evidence.excerpt}`,
      ),
      steps: [{
        title: terminalLine("Take the decision to the owner."),
        status: "active",
      }],
      completion: terminalMultiline(recommendation.action),
      completionLabel: terminalLine("Decide"),
      register: "brand",
      maxWidth: width,
    })
  }\n`);
}

/** Render the checkpoint loop's owner decisions as their own group. */
function renderRecommendations(
  out: Out,
  recommendations: readonly CheckpointRecommendation[],
): void {
  if (recommendations.length === 0) {
    return;
  }
  renderGroup(out, "recommendations", "Owner decisions");
  for (const recommendation of recommendations) {
    renderRecommendationUnit(out, recommendation);
  }
}

/** Render the top summary: overall score then a weakest-first one-line-per-category list. */
function renderSummary(
  out: Out,
  report: ImprovementReport,
  slug: string,
): void {
  const { presenter, width } = presentationFacts(out);
  out.heading(terminalLine(`discern improvement${slug ? ` · ${slug}` : ""}`));
  renderGroup(out, "health", "Health");
  out.raw(`${
    presenter.present(renderMeterCli, {
      kind: "determinate-progress",
      label: terminalLine("Automated practice health"),
      lifecycle: { status: "active" },
      completed: report.score,
      total: 100,
      reading: terminalLine(`${report.score}/100`),
      tone: "neutral",
      width: Math.min(48, width),
    })
  }\n`);
  out.raw(`${
    presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: terminalLine("The score covers objective rules only."),
      counts: [
        {
          label: terminalLine("Objectively weak"),
          value: terminalLine(String(report.weak)),
        },
        {
          label: terminalLine("Reviews open"),
          value: terminalLine(String(report.reviews)),
        },
      ],
      maxWidth: width,
    })
  }\n`);
  renderGroup(out, "next-action", "Next action");
  if (report.nextAction.kind === "review") {
    renderReviewUnit(out, {
      title: report.nextAction.title,
      ask: report.nextAction.action,
      teach: report.nextAction.why,
      ...(report.nextAction.against !== undefined
        ? { against: report.nextAction.against }
        : {}),
    });
  } else {
    const decide = report.nextAction.kind === "decide";
    const evidence = report.nextAction.against;
    out.raw(`${
      presenter.present(renderProcedureCli, {
        title: terminalLine(report.nextAction.title),
        description: terminalMultiline(
          `${report.nextAction.why}${
            decide && evidence !== undefined
              ? `\nEvidence: ${evidence.source}: ${evidence.excerpt}`
              : ""
          }`,
        ),
        steps: [{
          title: terminalLine(
            decide
              ? "Take the decision to the owner."
              : "Apply the recommended change.",
          ),
          status: "active",
        }],
        completion: terminalMultiline(report.nextAction.action),
        completionLabel: terminalLine(decide ? "Decide" : "Do"),
        register: "brand",
        maxWidth: width,
      })
    }\n`);
  }
  renderGroup(out, "category-summary", "Areas");
  for (const cat of report.categories) {
    out.raw(`${
      presenter.present(renderMeterCli, {
        kind: "determinate-progress",
        label: terminalLine(cat.title),
        lifecycle: { status: "active" },
        completed: cat.score,
        total: 100,
        reading: terminalLine(
          `${cat.score}/100 · ${cat.weak} to fix · ${cat.reviews.length} to review`,
        ),
        tone: "neutral",
        width: Math.min(48, width),
      })
    }\n`);
  }
}

/** Render one category in full: each deterministic rule (with fix + teach when not
 * passing) and each subjective review item (ask + evidence + teach). */
function renderCategory(out: Out, cat: CategoryResult): void {
  const { presenter, width } = presentationFacts(out);
  renderGroup(
    out,
    `category:${cat.name}`,
    `${cat.title} · ${cat.score}/100`,
  );
  let summaries: ResultSummaryGroupCliItem[] = [];
  const flushSummaries = (): void => {
    if (summaries.length === 0) return;
    out.raw(`${
      presenter.present(renderResultSummaryGroupCli, {
        // Keep every product string visibly enrolled in the terminal-safety
        // guard at the package call, even though the queue already stores only
        // adapted values.
        items: summaries.map((summary) => ({
          state: summary.state,
          fact: terminalMultiline(summary.fact),
          ...(summary.nextAction === undefined
            ? {}
            : { nextAction: terminalMultiline(summary.nextAction) }),
        })),
        maxWidth: width,
      })
    }\n`);
    summaries = [];
  };
  for (const r of cat.rules) {
    const state = IMPROVEMENT_RULE_RESULT_STATE[r.status];
    if (r.status === "fail") {
      flushSummaries();
      out.raw(`${
        presenter.present(renderDiagnosticCli, {
          title: terminalLine(r.title),
          impact: terminalMultiline(r.detail),
          correction: terminalMultiline(r.fix ?? r.title),
          evidence: terminalMultiline(r.teach),
          severity: "failure",
          maxWidth: width,
        })
      }\n`);
      continue;
    }
    summaries.push({
      state,
      fact: terminalMultiline(`${r.title}: ${r.detail}`),
      ...(r.status === "pass" || r.fix === undefined
        ? {}
        : { nextAction: terminalMultiline(`${r.fix} ${r.teach}`) }),
    });
  }
  flushSummaries();
  for (const rv of cat.reviews) {
    renderReviewUnit(out, rv);
  }
}

/** Render the project-scope findings as a separate, unscored advisory group. */
function renderHistory(out: Out, findings: PatternsFinding[]): void {
  if (findings.length === 0) {
    return;
  }
  const { presenter, width } = presentationFacts(out);
  renderGroup(out, "history", "From the logbook");
  for (const finding of findings) {
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalMultiline(`${finding.detector}: ${finding.observed}`),
        nextAction: terminalMultiline(finding.next_step),
        maxWidth: width,
      })
    }\n`);
  }
}

/** Whether an interactive drill-down may run (a real TTY both ways). */
/** Drive the interactive drill-down: pick a category to expand, repeat until done. */
async function interactiveDrilldown(
  out: Out,
  report: ImprovementReport,
): Promise<void> {
  const ALL = "\u0000all";
  const DONE = "\u0000done";
  for (;;) {
    const options = groupedSelectionEntries<string>([
      {
        id: "areas",
        label: "Areas",
        items: report.categories.map((cat) => ({
          name:
            `${cat.title} — ${cat.score}/100 (${cat.weak} to fix, ${cat.reviews.length} to review)`,
          value: cat.name,
        })),
      },
      {
        id: "report-actions",
        label: "Report",
        items: [
          { name: "Show every category in full", value: ALL },
          { name: "Done", value: DONE },
        ],
      },
    ]);
    let choice: string;
    try {
      choice = await requestSelection({
        message: "Drill into an area",
        options,
        search: false,
      });
    } catch (error) {
      if (!isInteractionCancelled(error)) throw error;
      return;
    }
    if (choice === DONE) {
      return;
    }
    if (choice === ALL) {
      for (const cat of report.categories) {
        renderCategory(out, cat);
      }
      continue;
    }
    const cat = report.categories.find((x) => x.name === choice);
    if (cat !== undefined) {
      renderCategory(out, cat);
    }
  }
}

/** Print the closing hints after a human improvement review. */
function renderFooter(
  out: Out,
  report: ImprovementReport,
  filtered: boolean,
): void {
  if (report.reviews === 0 && filtered) return;
  const { presenter, width } = presentationFacts(out);
  renderGroup(out, "report-actions", "Commands");
  if (report.reviews > 0) {
    out.raw(`${
      presenter.present(renderCommandCli, {
        command: terminalLine("discern improvement --json"),
        explanation: terminalLine(
          "Give an agent the cited review evidence in the structured result.",
        ),
        maxWidth: width,
      })
    }\n`);
  }
  if (!filtered) {
    out.raw(`${
      presenter.present(renderCommandCli, {
        command: terminalLine("discern improvement --category <name>"),
        explanation: terminalLine("Focus the report on one catalogue area."),
        maxWidth: width,
      })
    }\n`);
    out.raw(`${
      presenter.present(renderCommandCli, {
        command: terminalLine("discern improvement --min-score <n>"),
        explanation: terminalLine(
          "Require an automated-practice-health floor for this run.",
        ),
        maxWidth: width,
      })
    }\n`);
  }
}

/** Options accepted by the improvement CLI. */
export interface RunImprovementOptions extends ImprovementOptions {
  json: boolean;
  /** Explicit human presentation facts; CLI callers use the installed context. */
  terminal?: TerminalContext;
  /** Injectable writers retained for deterministic human-entrypoint coverage. */
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** Run `discern improvement`. Returns a process exit code (0 = ok / above the floor). */
export async function runImprovement(
  root: string,
  opts: RunImprovementOptions,
): Promise<number> {
  // --json: the single envelope, computed by the shared core.
  if (opts.json) {
    const result = await improvementResult(root, opts);
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const built = await buildReport(root, opts);
  const terminal = opts.terminal ?? terminalContext();
  const out = makeOut(terminal.color, {
    terminal,
    ...(opts.stdout === undefined ? {} : { stdout: opts.stdout }),
    ...(opts.stderr === undefined ? {} : { stderr: opts.stderr }),
  });
  if ("error" in built) {
    out.error(built.error.message ?? "improvement failed.");
    return 1;
  }
  const { report, historicalFindings } = built;
  const config = await loadConfig(root);
  const filtered = opts.category !== undefined;

  if (filtered) {
    // A single-category run is already focused — render its detail directly.
    for (const cat of report.categories) {
      renderCategory(out, cat);
    }
  } else {
    renderSummary(out, report, config.project.slug);
    const interactive = canInteract(false);
    if (interactive) {
      await interactiveDrilldown(out, report);
    } else {
      // Non-interactive (pipe, --plain, CI): print every detail so
      // nothing is hidden behind an interaction that will never be answered.
      for (const cat of report.categories) {
        renderCategory(out, cat);
      }
    }
  }
  if (!filtered || opts.category === "checkpoints") {
    renderRecommendations(out, report.recommendations);
  }
  renderHistory(out, historicalFindings);
  if (!config.project.logbook) {
    const { presenter, width } = presentationFacts(out);
    out.raw(`${
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: terminalLine("Logbook coaching is unavailable."),
        nextAction: terminalMultiline(
          fire(HINTS["improvement-logbook-off"]).text,
        ),
        maxWidth: width,
      })
    }\n`);
  }
  renderFooter(out, report, filtered);

  const belowMin = opts.minScore !== undefined && report.score < opts.minScore;
  if (belowMin) {
    out.error(
      `automated practice health ${report.score}/100 is below the required minimum score of ${opts.minScore}.`,
    );
    return 1;
  }
  return 0;
}
