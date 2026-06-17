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
  remove: "remove",
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

  // Managed files we are NOT replacing because the on-disk copy is yours (a hand
  // edit or a same-named foreign file): the kit's version is written alongside
  // as `<path>.new`. Surfaced as its own honest group so the user sees, before
  // confirming, exactly what will not be overwritten.
  const preservedNew = pick((o) => o.disposition === "new");
  const preservedSet = new Set(preservedNew);

  const hasConfig = ops.some((o) => o.targetRel === "icculus.toml");
  const hasRunner = ops.some((o) =>
    o.targetRel === "bin/agent" && !preservedSet.has(o)
  );
  const guidance = pick((o) =>
    o.targetRel.startsWith(".ai/guidelines/") && !preservedSet.has(o)
  );
  const skills = pick((o) =>
    o.targetRel.startsWith(".ai/skills/") && !preservedSet.has(o)
  );
  const docs = pick((o) =>
    (o.targetRel.startsWith("docs/") || o.targetRel === "TODO.md") &&
    !preservedSet.has(o)
  );
  const engine = pick((o) =>
    o.targetRel.startsWith(".icculus/") && !preservedSet.has(o)
  );
  // The integration files land at the project root / .claude and may merge or
  // append into ones you already have — grouped together regardless of how.
  const integration = pick((o) =>
    o.targetRel === ".gitignore" || o.targetRel.startsWith(".claude/")
  );

  const integrationSet = new Set(integration);
  const accountedFor = new Set<PlanOp>([
    ...ops.filter((o) =>
      (o.targetRel === "icculus.toml" || o.targetRel === "bin/agent") &&
      !preservedSet.has(o)
    ),
    ...guidance,
    ...skills,
    ...docs,
    ...engine,
    ...integration,
    ...preservedNew,
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

  if (preservedNew.length > 0) {
    const n = preservedNew.length;
    const subject = n === 1
      ? "1 managed file already here is kept"
      : `${n} managed files already here are kept`;
    log.line(
      `\n  ${log.bold("Kept your versions")} ${
        log.dim(
          `— ${subject}; the kit's copy is written alongside as <file>.new`,
        )
      }`,
    );
    for (const op of preservedNew) {
      const canonical = op.targetRel.replace(/\.new$/, "");
      log.line(
        row(log, canonical, `kept; kit version → ${op.targetRel}`),
      );
    }
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

/**
 * Report the managed files preserved with a `.new` sibling, with the count and
 * where they landed. Shared by `init` and `upgrade` so both phrase the outcome
 * identically: the user is told exactly which files were kept and the path of
 * the kit copy they can diff against. No-op when nothing was preserved.
 */
export function renderNewFilesSummary(
  log: Logger,
  newFiles: PlanOp[],
  opts: { dryRun?: boolean } = {},
): void {
  if (newFiles.length === 0) {
    return;
  }
  const dry = opts.dryRun ?? false;
  log.warn(
    `${
      dry ? "would keep" : "kept"
    } your version of ${newFiles.length} managed ${
      newFiles.length === 1 ? "file" : "files"
    }; the kit's copy ${dry ? "would be" : "was"} written alongside:`,
  );
  for (const op of newFiles) {
    log.detail(
      `${op.targetRel}  (review, then merge into ${
        op.targetRel.replace(/\.new$/, "")
      } or delete)`,
    );
  }
}

/**
 * Render the grouped change summary for `upgrade`. The same renderer drives the
 * post-apply summary and the `--dry-run` preview (`opts.dryRun` only switches the
 * heading and verb tense), so a dry run reads exactly like the real thing.
 *
 * Order is deliberate: the unchanged ("already up to date") bulk comes first, so
 * the files that actually changed — refreshed, removed, kept-as-`.new` — land at
 * the bottom of the output, where the developer's eye already is.
 */
export function renderUpgradeSummary(
  log: Logger,
  refreshed: PlanOp[],
  preserved: PlanOp[],
  newFiles: PlanOp[],
  removed: PlanOp[] = [],
  opts: { dryRun?: boolean } = {},
): void {
  const dry = opts.dryRun ?? false;
  log.heading(dry ? "Dry run — `upgrade` would perform:" : "Upgrade summary");
  if (preserved.length > 0) {
    log.info(`already up to date: ${preserved.length}`);
    for (const op of preserved) {
      log.detail(op.targetRel);
    }
  }
  log.ok(`${dry ? "would refresh" : "refreshed"}: ${refreshed.length}`);
  for (const op of refreshed) {
    log.detail(op.targetRel);
  }
  if (removed.length > 0) {
    log.info(
      `${
        dry ? "would remove" : "removed"
      } (no longer shipped): ${removed.length}`,
    );
    for (const op of removed) {
      log.detail(op.targetRel);
    }
  }
  renderNewFilesSummary(log, newFiles, { dryRun: dry });
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
