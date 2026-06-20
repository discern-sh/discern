/**
 * Presentation of a `Plan`: the review-and-confirm screen and the dry-run
 * listing. Kept apart from `fs_plan.ts` so planning stays pure and printing stays
 * in one place, shared by `init` and `add-preset`.
 */

import type { Logger } from "./log.ts";
import type { OpDisposition, Plan, PlanOp } from "./fs_plan.ts";

/** A short, human label for each disposition. */
const DISPOSITION_LABEL: Record<OpDisposition, string> = {
  create: "create",
  skip: "skip",
  merge: "merge",
  append: "append",
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
 * Render a calm, grouped "what will change" review. Rather than a flat wall of
 * every file, it names the handful the user actually tunes, collapses the skills
 * / docs bulk to counts, and calls out the integration files merged into the
 * project. The full list is one `--dry-run` away.
 */
export function renderReview(log: Logger, plan: Plan, destDir: string): void {
  const ops = plan.ops;
  const pick = (pred: (o: PlanOp) => boolean) => ops.filter(pred);

  const hasConfig = ops.some((o) => o.targetRel === ".icculus/config.toml");
  const guidance = pick((o) => o.targetRel.startsWith(".icculus/guidelines/"));
  const skills = pick((o) => o.targetRel.startsWith(".icculus/skills/"));
  const docs = pick((o) =>
    o.targetRel.startsWith("docs/") || o.targetRel === "TODO.md"
  );
  // Other .icculus/ machinery (the brief, recipes) — but not config, guidance,
  // or skills grouped above.
  const harness = pick((o) =>
    o.targetRel.startsWith(".icculus/") &&
    o.targetRel !== ".icculus/config.toml" &&
    !o.targetRel.startsWith(".icculus/guidelines/") &&
    !o.targetRel.startsWith(".icculus/skills/")
  );
  // The integration files land at the project root / .claude and may merge or
  // append into ones you already have — grouped together regardless of how.
  const integration = pick((o) =>
    o.targetRel === ".gitignore" || o.targetRel.startsWith(".claude/")
  );

  const integrationSet = new Set(integration);
  const accountedFor = new Set<PlanOp>([
    ...ops.filter((o) => o.targetRel === ".icculus/config.toml"),
    ...guidance,
    ...skills,
    ...docs,
    ...harness,
    ...integration,
  ]);
  const other = ops.filter((o) =>
    !accountedFor.has(o) && !integrationSet.has(o)
  );

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

  if (hasConfig) {
    log.line(`\n  ${log.bold("Config")}`);
    log.line(
      row(
        log,
        ".icculus/config.toml",
        "the one file you tune — capabilities, scopes, worktree",
      ),
    );
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
      log.line(row(log, ".icculus/skills/", `${skillCount} portable skills`));
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

  if (harness.length > 0) {
    log.line(`\n  ${log.bold("Harness")}`);
    log.line(
      row(log, ".icculus/", `${harness.length} files — your brief and recipes`),
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
