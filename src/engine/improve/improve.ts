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
import { colorEnabled, makeOut, type Out, type Palette } from "../output.ts";
import { buildContext, CATEGORIES, isDeterministic } from "./rules.ts";
import type {
  Category,
  CategoryResult,
  ImprovementContext,
  ImprovementReport,
  NextAction,
  ReviewResult,
  RuleResult,
  RuleStatus,
} from "./types.ts";
import {
  canPrompt,
  groupedSelectOptions,
  selectPrompt,
} from "../../lib/prompts.ts";

// ── evaluation ──────────────────────────────────────────────────────────────

/** The fractional credit a status earns toward its rule's weight. */
function credit(status: RuleStatus): number {
  return status === "pass" ? 1 : status === "partial" ? 0.5 : 0;
}

/** Evaluate one category's rules against the gathered context. */
function evaluateCategory(
  cat: Category,
  ctx: ImprovementContext,
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
      reviews.push({
        id: rule.id,
        title: rule.title,
        ask: rule.ask,
        teach: rule.teach,
        ...(against !== undefined ? { against } : {}),
      });
    }
  }
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
  const categories: CategoryResult[] = [];
  for (const cat of CATEGORIES) {
    if (only !== undefined && cat.name !== only) {
      continue;
    }
    categories.push(evaluateCategory(cat, ctx));
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

  const nextAction = selectNextAction(categories);
  categories.sort((a, b) =>
    a.score - b.score ||
    b.weak - a.weak ||
    b.reviews.length - a.reviews.length ||
    a.title.localeCompare(b.title)
  );
  return { score, weak, reviews, nextAction, categories };
}

/**
 * Choose one action before display sorting mutates catalog order. Objective gaps
 * lead, ranked by recoverable weighted credit; ties keep the catalog's deliberate
 * coaching order. Once the baseline is clear, the first qualitative review leads.
 */
function selectNextAction(categories: readonly CategoryResult[]): NextAction {
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
  const result: DiscernResult<ImprovementData> = {
    ok: !belowMin,
    verb: "improvement",
    data: reportData(report, historicalFindings),
    ...(belowMin
      ? {
        error: "below_min_score",
        message:
          `automated practice health ${report.score}/100 is below the required minimum score of ${opts.minScore}.`,
        hints: hintTexts([fire(HINTS["improvement-follow-next-action"])]),
      }
      : {}),
  };
  const config = await loadConfig(root);
  if (!config.project.logbook) {
    addAdvisoryHints(result, [fire(HINTS["improvement-logbook-off"])]);
  }
  return result;
}

// ── human rendering ─────────────────────────────────────────────────────────

/** A 10-cell score bar, coloured by band (red < 50, yellow < 80, green ≥ 80). */
function bar(score: number, c: Palette, color: boolean): string {
  const cells = 10;
  const filled = Math.max(
    0,
    Math.min(cells, Math.round((score / 100) * cells)),
  );
  const col = score >= 80 ? c.green : score >= 50 ? c.yellow : c.red;
  const on = "█".repeat(filled);
  const off = "░".repeat(cells - filled);
  return color ? `${col}${on}${c.reset}${c.dim}${off}${c.reset}` : on + off;
}

/** The status glyph + colour for a deterministic rule outcome. */
function statusGlyph(status: RuleStatus, c: Palette): string {
  switch (status) {
    case "pass":
      return `${c.green}✓${c.reset}`;
    case "partial":
      return `${c.yellow}◐${c.reset}`;
    case "fail":
      return `${c.red}✗${c.reset}`;
  }
}

/** Wrap `text` to `width`, prefixing the first line with `label` and continuation
 * lines with matching indentation, as a single string with trailing newline. */
function wrapLabelled(label: string, text: string, indent: string): string {
  const width = 78;
  const avail = Math.max(24, width - indent.length - label.length);
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line === "") {
      line = w;
    } else if (line.length + 1 + w.length <= avail) {
      line += ` ${w}`;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  const pad = indent + " ".repeat(label.length);
  return lines
    .map((l, i) => (i === 0 ? `${indent}${label}${l}` : `${pad}${l}`))
    .join("\n") + "\n";
}

/**
 * Render a qualitative review as one indivisible unit. Both the prioritized
 * next-action block and category expansion come through here, so its question,
 * citation, and teaching cannot drift apart on one human surface.
 */
function renderReviewUnit(
  out: Out,
  review: {
    title: string;
    ask: string;
    teach: string;
    against?: ReviewResult["against"];
  },
  mode: "next-action" | "category",
): void {
  const c = out.c;
  if (mode === "next-action") {
    out.raw(`  ${c.bold}${review.title}${c.reset}\n`);
    out.raw(wrapLabelled("ask:   ", review.ask, "  "));
  } else {
    out.raw(
      `  ${c.cyan}?${c.reset} ${review.title} ${c.dim}(review)${c.reset}\n`,
    );
    out.raw(wrapLabelled("ask:   ", review.ask, "      "));
  }
  if (review.against !== undefined) {
    out.raw(
      wrapLabelled(
        "look:  ",
        `${review.against.source} — ${review.against.excerpt}`,
        mode === "next-action" ? "  " : "      ",
      ),
    );
  }
  out.raw(
    wrapLabelled(
      mode === "next-action" ? "why:   " : "teach: ",
      review.teach,
      mode === "next-action" ? "  " : "      ",
    ),
  );
}

/** Render the top summary: overall score then a weakest-first one-line-per-category list. */
function renderSummary(
  out: Out,
  report: ImprovementReport,
  slug: string,
): void {
  const c = out.c;
  out.heading(`discern improvement${slug ? ` · ${slug}` : ""}`);
  out.group("health", "Health");
  out.raw(
    `  Automated practice health  ${
      bar(report.score, c, out.color)
    }  ${c.bold}${report.score}/100${c.reset}\n`,
  );
  out.raw(`  ${report.weak} objectively weak\n`);
  out.raw(`  ${c.cyan}${report.reviews} improvement reviews open${c.reset}\n`);
  out.group("next-action", "Next action");
  if (report.nextAction.kind === "review") {
    renderReviewUnit(out, {
      title: report.nextAction.title,
      ask: report.nextAction.action,
      teach: report.nextAction.why,
      ...(report.nextAction.against !== undefined
        ? { against: report.nextAction.against }
        : {}),
    }, "next-action");
  } else {
    out.raw(`  ${c.bold}${report.nextAction.title}${c.reset}\n`);
    out.raw(wrapLabelled("do:    ", report.nextAction.action, "  "));
    out.raw(wrapLabelled("why:   ", report.nextAction.why, "  "));
  }
  out.group("category-summary", "Areas");
  out.raw(`  ${c.dim}weakest first${c.reset}\n`);
  const widest = Math.max(...report.categories.map((x) => x.title.length), 0);
  for (const cat of report.categories) {
    const title = cat.title.padEnd(widest);
    const note = cat.weak > 0
      ? `${c.dim}${cat.weak} to fix${c.reset}`
      : cat.reviews.length > 0
      ? `${c.dim}${cat.reviews.length} to review${c.reset}`
      : `${c.green}clear${c.reset}`;
    out.raw(
      `  ${title}  ${bar(cat.score, c, out.color)}  ${
        String(cat.score).padStart(3)
      }/100  ${note}\n`,
    );
  }
}

/** Render one category in full: each deterministic rule (with fix + teach when not
 * passing) and each subjective review item (ask + evidence + teach). */
function renderCategory(out: Out, cat: CategoryResult): void {
  const c = out.c;
  out.group(
    `category:${cat.name}`,
    `${cat.title}  ${bar(cat.score, c, out.color)}  ${cat.score}/100`,
  );
  for (const r of cat.rules) {
    out.raw(
      `  ${
        statusGlyph(r.status, c)
      } ${r.title} ${c.dim}— ${r.detail}${c.reset}\n`,
    );
    if (r.status !== "pass" && r.fix !== undefined) {
      out.raw(wrapLabelled("fix:   ", r.fix, "      "));
      out.raw(wrapLabelled("teach: ", r.teach, "      "));
    }
  }
  for (const rv of cat.reviews) {
    renderReviewUnit(out, rv, "category");
  }
}

/** Render the project-scope findings as a separate, unscored advisory group. */
function renderHistory(out: Out, findings: PatternsFinding[]): void {
  if (findings.length === 0) {
    return;
  }
  const c = out.c;
  out.group("history", "From the logbook");
  for (const finding of findings) {
    out.raw(
      `  ${c.cyan}?${c.reset} ${finding.observed} ${c.dim}(${finding.detector})${c.reset}\n`,
    );
    out.raw(wrapLabelled("next: ", finding.next_step, "      "));
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
    const options = groupedSelectOptions<string>([
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
    const choice = await selectPrompt({
      message: "Drill into an area",
      options,
      search: false,
    });
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
  const c = out.c;
  out.group("report-actions", "Commands");
  if (report.reviews > 0) {
    out.raw(
      `  ${c.dim}? items need judgement — an agent can evaluate them against the cited material via${c.reset} discern improvement --json${c.dim}.${c.reset}\n`,
    );
  }
  if (!filtered) {
    out.raw(
      `  ${c.dim}Focus one area:${c.reset} discern improvement --category <name>${c.dim} · gate a build:${c.reset} discern improvement --min-score <n>\n`,
    );
  }
}

/** Options accepted by the improvement CLI. */
export interface RunImprovementOptions extends ImprovementOptions {
  json: boolean;
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
  const color = colorEnabled();
  const out = makeOut(color);
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
    const interactive = canPrompt(false);
    if (interactive) {
      await interactiveDrilldown(out, report);
    } else {
      // Non-interactive (pipe, --plain, CI): print every detail so
      // nothing is hidden behind a prompt that will never be answered.
      for (const cat of report.categories) {
        renderCategory(out, cat);
      }
    }
  }
  renderHistory(out, historicalFindings);
  if (!config.project.logbook) {
    const c = out.c;
    out.raw(
      `  ${c.dim}${fire(HINTS["improvement-logbook-off"]).text}${c.reset}\n`,
    );
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
