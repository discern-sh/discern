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

/** Render the full plan as a per-file listing under a heading (used by --dry-run). */
export function renderPlan(log: Logger, plan: Plan, heading: string): void {
  log.heading(heading);
  for (const op of plan.ops) {
    const label = DISPOSITION_LABEL[op.disposition];
    const note = op.note ? log.dim(` — ${op.note}`) : "";
    const flag = op.managed ? log.dim(" [managed]") : "";
    log.line(`  ${label.padEnd(9)} ${op.targetRel}${flag}${note}`);
  }
}

/** One labelled row in the summary: a path and a dim description. */
function row(log: Logger, path: string, desc: string): string {
  return `    ${path.padEnd(22)} ${log.dim(desc)}`;
}

/**
 * Render a calm, grouped "what will change" review. Rather than a flat wall of
 * every file, it names the handful the user actually tunes, collapses the engine
 * / skills / docs bulk to counts, and calls out the integration files merged
 * into the project. The full list is one `--dry-run` away.
 */
export function renderReview(log: Logger, plan: Plan, destDir: string): void {
  const ops = plan.ops;
  const pick = (pred: (o: PlanOp) => boolean) => ops.filter(pred);

  const hasConfig = ops.some((o) => o.targetRel === "icculus.toml");
  const hasRunner = ops.some((o) => o.targetRel === "bin/agent");
  const guidance = pick((o) => o.targetRel.startsWith(".ai/guidelines/"));
  const skills = pick((o) => o.targetRel.startsWith(".ai/skills/"));
  const docs = pick((o) =>
    o.targetRel.startsWith("docs/") || o.targetRel === "TODO.md"
  );
  const engine = pick((o) => o.targetRel.startsWith(".icculus/"));
  // The integration files land at the project root / .claude and may merge or
  // append into ones you already have — grouped together regardless of how.
  const integration = pick((o) =>
    o.targetRel === ".gitignore" || o.targetRel.startsWith(".claude/")
  );

  const accountedFor = new Set<PlanOp>([
    ...ops.filter((o) =>
      o.targetRel === "icculus.toml" || o.targetRel === "bin/agent"
    ),
    ...guidance,
    ...skills,
    ...docs,
    ...engine,
    ...integration,
  ]);
  const other = ops.filter((o) => !accountedFor.has(o));

  // Distinct skill directories, not the file count (one skill can ship helpers).
  const skillCount = new Set(skills.map((o) => o.targetRel.split("/")[2])).size;
  const docFileCount =
    docs.filter((o) => o.targetRel.startsWith("docs/")).length;

  log.heading(`icculus will set up its harness in ${destDir}`);
  log.line(
    log.dim(
      `  ${ops.length} files. It never overwrites anything you already have.`,
    ),
  );

  if (hasConfig || hasRunner) {
    log.line(`\n  ${log.bold("Config & runner")}`);
    if (hasConfig) {
      log.line(
        row(
          log,
          "icculus.toml",
          "the one file you tune — slots, scopes, worktree",
        ),
      );
    }
    if (hasRunner) {
      log.line(
        row(
          log,
          "bin/agent",
          "the per-project task runner (./bin/agent finish, …)",
        ),
      );
    }
  }

  if (guidance.length > 0 || skillCount > 0) {
    log.line(
      `\n  ${log.bold("Agent guidance")} ${
        log.dim("— yours to fill in (via /bootstrap)")
      }`,
    );
    for (const op of guidance) {
      log.line(`    ${op.targetRel}`);
    }
    if (skillCount > 0) {
      log.line(row(log, ".ai/skills/", `${skillCount} portable skills`));
    }
  }

  if (docs.length > 0) {
    log.line(`\n  ${log.bold("Docs scaffold")}`);
    if (docFileCount > 0) {
      log.line(
        row(
          log,
          "docs/",
          `${docFileCount} files — orientation, ADRs, gate gotchas`,
        ),
      );
    }
    if (docs.some((o) => o.targetRel === "TODO.md")) {
      log.line(`    TODO.md`);
    }
  }

  if (engine.length > 0) {
    log.line(
      `\n  ${log.bold("Engine")} ${
        log.dim("— managed; `icculus upgrade` refreshes it, never your edits")
      }`,
    );
    log.line(
      row(
        log,
        ".icculus/",
        `${engine.length} files — the generic shell engine + manifest`,
      ),
    );
  }

  if (other.length > 0) {
    log.line(`\n  ${log.bold("Other")}`);
    for (const op of other) {
      log.line(`    ${op.targetRel}${op.note ? log.dim(` — ${op.note}`) : ""}`);
    }
  }

  if (integration.length > 0) {
    log.line(
      `\n  ${log.bold("Git & agent settings")} ${
        log.dim("— merged into your project, never overwritten")
      }`,
    );
    for (const op of integration) {
      const what = op.disposition === "merge"
        ? "merged into your existing settings"
        : op.disposition === "append"
        ? "the harness section appended to your .gitignore"
        : "created";
      log.line(row(log, op.targetRel, what));
    }
  }

  log.line();
  log.line(log.dim("  See every file with:  icculus init --dry-run"));

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
