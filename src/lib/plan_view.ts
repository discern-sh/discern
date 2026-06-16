/**
 * Presentation of a `Plan`: the review-and-confirm screen, the dry-run listing,
 * and the post-apply change summary. Kept apart from `fs_plan.ts` so planning
 * stays pure and printing stays in one place, shared by `init` and `upgrade`.
 */

import type { Logger } from "./log.ts";
import type { OpDisposition, Plan, PlanOp } from "./fs_plan.ts";

/** A short, human label + symbol for each disposition. */
const DISPOSITION_LABEL: Record<OpDisposition, string> = {
  create: "create",
  overwrite: "update",
  skip: "skip",
  new: "new file",
  merge: "merge",
  append: "append",
};

/** Group ops by disposition for a compact summary. */
function groupByDisposition(ops: PlanOp[]): Map<OpDisposition, PlanOp[]> {
  const groups = new Map<OpDisposition, PlanOp[]>();
  for (const op of ops) {
    const list = groups.get(op.disposition) ?? [];
    list.push(op);
    groups.set(op.disposition, list);
  }
  return groups;
}

/** Render the full plan as a per-file listing under a heading. */
export function renderPlan(log: Logger, plan: Plan, heading: string): void {
  log.heading(heading);
  for (const op of plan.ops) {
    const label = DISPOSITION_LABEL[op.disposition];
    const note = op.note ? log.dim(` — ${op.note}`) : "";
    const flag = op.managed ? log.dim(" [managed]") : "";
    log.line(`  ${label.padEnd(9)} ${op.targetRel}${flag}${note}`);
  }
}

/** Render a compact "what will change" review (counts + the non-skip paths). */
export function renderReview(log: Logger, plan: Plan): void {
  log.heading("This will write the following into the current directory:");
  const groups = groupByDisposition(plan.ops);
  const order: OpDisposition[] = [
    "create",
    "merge",
    "append",
    "overwrite",
    "new",
    "skip",
  ];
  for (const disposition of order) {
    const ops = groups.get(disposition);
    if (!ops || ops.length === 0) {
      continue;
    }
    log.line(
      `\n  ${log.bold(DISPOSITION_LABEL[disposition])} (${ops.length}):`,
    );
    for (const op of ops) {
      const note = op.note ? log.dim(` — ${op.note}`) : "";
      log.line(`    ${op.targetRel}${note}`);
    }
  }

  if (plan.unknownTokens.size > 0) {
    log.line();
    for (const [path, tokens] of plan.unknownTokens) {
      log.warn(
        `unknown token(s) left untouched in ${path}: ${tokens.join(", ")}`,
      );
    }
  }
}

/** Render the post-apply change summary used by `upgrade`. */
export function renderUpgradeSummary(
  log: Logger,
  refreshed: PlanOp[],
  preserved: PlanOp[],
  newFiles: PlanOp[],
): void {
  log.heading("Upgrade summary");
  log.ok(`refreshed: ${refreshed.length}`);
  for (const op of refreshed) {
    log.detail(op.targetRel);
  }
  if (preserved.length > 0) {
    log.info(`already up to date: ${preserved.length}`);
    for (const op of preserved) {
      log.detail(op.targetRel);
    }
  }
  if (newFiles.length > 0) {
    log.warn(
      `preserved your edits; new versions written alongside: ${newFiles.length}`,
    );
    for (const op of newFiles) {
      log.detail(
        `${op.targetRel}  (review and merge into ${
          op.targetRel.replace(/\.new$/, "")
        })`,
      );
    }
  }
}

/** A JSON-friendly shape for one op (used by `--json`). */
export interface PlanOpJson {
  path: string;
  action: OpDisposition;
  managed: boolean;
  note?: string;
}

/** Reduce a plan to its JSON-friendly op list. */
export function planToJson(plan: Plan): PlanOpJson[] {
  return plan.ops.map((op) => ({
    path: op.targetRel,
    action: op.disposition,
    managed: op.managed,
    note: op.note,
  }));
}
