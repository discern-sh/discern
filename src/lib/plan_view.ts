/**
 * Presentation of a `Plan`: the review-and-confirm screen and the dry-run
 * listing. Kept apart from `fs_plan.ts` so planning stays pure and printing stays
 * in one place, shared by `setup` and `preset`.
 */

import type { Logger } from "./log.ts";
import type { OpDisposition, Plan, PlanOp } from "./fs_plan.ts";
import { agentIntegrationPrefixes } from "./providers.ts";

/** A short, human label for each disposition. */
const DISPOSITION_LABEL: Record<OpDisposition, string> = {
  create: "create",
  skip: "skip",
  merge: "merge",
  append: "append",
  remove: "remove",
};

/** Render the full plan as a per-file listing under a heading (used by --dry-run). */
export function renderPlan(log: Logger, plan: Plan, heading: string): void {
  log.heading(heading);
  for (const op of plan.ops) {
    const label = DISPOSITION_LABEL[op.disposition];
    const note = op.note ? log.dim(` — ${op.note}`) : "";
    log.line(`  ${label.padEnd(9)} ${op.targetRel}${note}`);
  }
}

/** One labelled row in the summary: a path and a dim description. */
function row(log: Logger, path: string, desc: string): string {
  return `    ${path.padEnd(22)} ${log.dim(desc)}`;
}

/**
 * Render a calm, grouped "what will change" review. The footprint is small now
 * (the dissolved layout seeds just `discern.toml`, optionally a brief, and the
 * integration files), so it names the config, lists any other seeds, and calls
 * out the integration files merged into the project. The full list is one
 * `--dry-run` away.
 */
export function renderReview(log: Logger, plan: Plan, destDir: string): void {
  const ops = plan.ops;
  const pick = (pred: (o: PlanOp) => boolean) => ops.filter(pred);

  const hasConfig = ops.some((o) => o.targetRel === "discern.toml");
  // The integration files land at the project root / each agent's config dir and may
  // merge or append into ones you already have — grouped together regardless of how.
  // The agent-dir prefixes are registry-derived (.claude/, .agents/, …), so a new
  // agent's seeded config is grouped here without editing this view.
  const agentPrefixes = agentIntegrationPrefixes();
  const integration = pick((o) =>
    o.targetRel === ".gitignore" || o.targetRel === ".gitattributes" ||
    o.targetRel === ".mcp.json" ||
    agentPrefixes.some((p) => o.targetRel.startsWith(p))
  );
  const integrationSet = new Set(integration);
  // Anything else that is seeded (e.g. brief.md) — not the config or integration.
  const other = ops.filter((o) =>
    o.targetRel !== "discern.toml" && !integrationSet.has(o)
  );

  log.heading(`discern will set itself up in ${destDir}`);
  log.line(
    log.dim(
      `  ${ops.length} files. It never overwrites anything you already have.`,
    ),
  );

  if (hasConfig) {
    log.group("config");
    log.line(`  ${log.bold("Config")}`);
    log.line(
      row(
        log,
        "discern.toml",
        "the whole footprint — jobs, scopes, worktree",
      ),
    );
  }

  if (other.length > 0) {
    log.group("project-content");
    log.line(`  ${log.bold("Your content")}`);
    for (const op of other) {
      log.line(`    ${op.targetRel}${op.note ? log.dim(` — ${op.note}`) : ""}`);
    }
  }

  if (integration.length > 0) {
    log.group("integration");
    log.line(
      `  ${log.bold("Git & agent settings")} ${
        log.dim("— merged or reconciled into your project")
      }`,
    );
    for (const op of integration) {
      const what = op.disposition === "merge"
        ? "merged into your existing settings"
        : op.disposition === "append"
        ? op.targetRel === ".gitignore"
          ? "the discern section reconciled in your .gitignore"
          : `the discern section reconciled in ${op.targetRel}`
        : op.disposition === "remove"
        ? "the empty managed file removed"
        : "created";
      log.line(row(log, op.targetRel, what));
    }
  }

  log.group("full-plan-pointer");
  log.line(log.dim("  See every file by re-running with --dry-run."));

  if (plan.unknownTokens.size > 0) {
    log.group("unknown-tokens");
    for (const [path, tokens] of plan.unknownTokens) {
      log.warn(
        `unknown token(s) left untouched in ${path}: ${tokens.join(", ")}`,
      );
    }
  }
}

/** A JSON-friendly shape for one op (used by `--json`). */
export interface PlanOpJson {
  path: string;
  action: OpDisposition;
  note?: string | undefined;
}

/** Reduce a plan to its JSON-friendly op list. */
export function planToJson(plan: Plan): PlanOpJson[] {
  return plan.ops.map((op) => ({
    path: op.targetRel,
    action: op.disposition,
    note: op.note,
  }));
}
