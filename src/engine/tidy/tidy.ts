/**
 * `discern tidy` — canonical formatting for the project surfaces whose
 * convention discern owns: the configured Markdown sources and root
 * `discern.toml`.
 *
 * The read-only planner resolves every target and formats every byte before the
 * thin executor writes anything. A parse failure therefore aborts the whole
 * invocation without a partial Markdown/TOML sweep. The plan carries concrete
 * before/after bytes privately and projects them onto the shared `EnginePlan`
 * vocabulary for `--dry-run` and the public result envelope.
 */

import { walk } from "@std/fs";
import { isAbsolute, join, relative } from "@std/path";
import { loadConfig } from "../../shared/config_schema.ts";
import { emitResult } from "../../shared/emit.ts";
import { CONFIG_REL } from "../../shared/env.ts";
import {
  type Diagnostic,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepResult,
} from "../../shared/result.ts";
import { observeResult } from "../../shared/result_capture.ts";
import {
  resolveBriefPath,
  resolveGuidanceSources,
  resolveMapDir,
  resolveSkillsDir,
  resolveTodoPath,
} from "../../lib/paths.ts";
import { colorEnabled } from "../output.ts";
import { makeOut, outSink } from "../output.ts";
import { formatMarkdownText, formatTomlText } from "../../lib/tidy_format.ts";

/** The explicit selectors accepted after `discern tidy`. */
export const TIDY_TYPES = ["md", "toml"] as const;
export type TidyType = (typeof TIDY_TYPES)[number];

interface TidyChange {
  type: TidyType;
  abs: string;
  display: string;
  before: string;
  after: string;
}

/** The complete read-only plan; only changed files become operations. */
export interface TidyPlan {
  types: readonly TidyType[];
  changes: readonly TidyChange[];
}

/** A target failed while the planner was reading or parsing it. */
export class TidyPlanError extends Error {
  constructor(
    readonly type: TidyType,
    readonly display: string,
    message: string,
  ) {
    super(message);
    this.name = "TidyPlanError";
  }
}

class InvalidTidyTypeError extends Error {
  constructor(type: string) {
    super(
      `unknown tidy type "${type}"; use ` +
        "`discern tidy`, `discern tidy md`, or `discern tidy toml`",
    );
    this.name = "InvalidTidyTypeError";
  }
}

function selectedTypes(type: string | undefined): readonly TidyType[] {
  if (type === undefined) {
    return TIDY_TYPES;
  }
  if ((TIDY_TYPES as readonly string[]).includes(type)) {
    return [type as TidyType];
  }
  throw new InvalidTidyTypeError(type);
}

function displayPath(root: string, abs: string): string {
  const rel = relative(root, abs);
  if (rel === "") {
    return ".";
  }
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel;
}

async function statOrMissing(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

function isWithin(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function markdownTargets(root: string): Promise<string[]> {
  const config = await loadConfig(root);
  const map = resolveMapDir(root, config);
  const todo = resolveTodoPath(root, config).abs;
  const brief = resolveBriefPath(root).abs;
  const skills = resolveSkillsDir(root, config).abs;
  const configPath = join(root, CONFIG_REL);
  const targets = new Set<string>();

  const include = (path: string): void => {
    if (
      path !== configPath && path !== brief && !isWithin(path, skills)
    ) {
      targets.add(path);
    }
  };

  const mapInfo = await statOrMissing(map.abs);
  if (mapInfo !== undefined) {
    if (!mapInfo.isDirectory) {
      throw new TidyPlanError(
        "md",
        displayPath(root, map.abs),
        "the configured map path is not a directory",
      );
    }
    for await (
      const entry of walk(map.abs, {
        includeDirs: false,
        includeSymlinks: false,
        followSymlinks: false,
        exts: [".md"],
      })
    ) {
      include(entry.path);
    }
  }

  const todoInfo = await statOrMissing(todo);
  if (todoInfo !== undefined) {
    if (!todoInfo.isFile) {
      throw new TidyPlanError(
        "md",
        displayPath(root, todo),
        "the configured TODO path is not a file",
      );
    }
    include(todo);
  }

  for (const source of await resolveGuidanceSources(root, config)) {
    include(source);
  }
  return [...targets].sort();
}

async function formatTarget(
  root: string,
  type: TidyType,
  abs: string,
): Promise<TidyChange | undefined> {
  const display = displayPath(root, abs);
  try {
    const before = await Deno.readTextFile(abs);
    const after = type === "md"
      ? await formatMarkdownText(abs, before)
      : await formatTomlText(abs, before);
    return before === after ? undefined : { type, abs, display, before, after };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TidyPlanError(type, display, detail);
  }
}

/** Build the complete read-only tidy plan. No write is reachable from here. */
export async function planTidy(
  root: string,
  type?: string,
): Promise<TidyPlan> {
  const types = selectedTypes(type);
  const changes: TidyChange[] = [];
  if (types.includes("md")) {
    for (const target of await markdownTargets(root)) {
      const change = await formatTarget(root, "md", target);
      if (change !== undefined) {
        changes.push(change);
      }
    }
  }
  if (types.includes("toml")) {
    const configPath = join(root, CONFIG_REL);
    if (await statOrMissing(configPath) !== undefined) {
      const change = await formatTarget(root, "toml", configPath);
      if (change !== undefined) {
        changes.push(change);
      }
    }
  }
  return { types, changes };
}

/** Project a private byte plan onto the shared serializable plan vocabulary. */
export function tidyPlanToEngine(plan: TidyPlan): EnginePlan {
  return {
    title: "Tidy plan",
    details: [
      `types: ${plan.types.join(", ")}`,
      `${plan.changes.length} file${
        plan.changes.length === 1 ? "" : "s"
      } would change`,
    ],
    steps: plan.changes.map((change) => ({
      kind: "tidy",
      label: change.display,
      disposition: "run",
      group: change.type === "md" ? "Markdown" : "TOML",
    })),
  };
}

function tidyDiagnostic(
  type: TidyType,
  display: string,
  message: string,
): Diagnostic {
  return {
    tool: `tidy ${type}`,
    severity: "error",
    message: `Could not format ${display}: ${message}`,
    reproduce_cmd: `discern tidy ${type}`,
    file: display,
  };
}

/** Apply only the precomputed changed bytes. Parsing never occurs in this layer. */
export async function applyTidyPlan(
  plan: TidyPlan,
): Promise<DiscernResult> {
  const steps: StepResult[] = [];
  const diagnostics: Diagnostic[] = [];
  let stopped = false;
  for (const change of plan.changes) {
    const step = {
      kind: "tidy" as const,
      label: change.display,
      disposition: "run" as const,
      group: change.type === "md" ? "Markdown" : "TOML",
    };
    if (stopped) {
      steps.push({ step, outcome: "skipped" });
      continue;
    }
    try {
      await Deno.writeTextFile(change.abs, change.after);
      steps.push({ step, outcome: "ok" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({ step, outcome: "failed" });
      diagnostics.push(tidyDiagnostic(change.type, change.display, detail));
      stopped = true;
    }
  }
  return {
    ok: diagnostics.length === 0,
    verb: "tidy",
    steps,
    ...(diagnostics.length > 0
      ? {
        diagnostics,
        error: "tidy_write_failed",
        message: "Tidy stopped after a file could not be written.",
      }
      : {}),
  };
}

/** Compute the one public result envelope behind every tidy surface. */
export async function tidyResult(
  root: string,
  opts: { type?: string; dryRun?: boolean } = {},
): Promise<DiscernResult> {
  let plan: TidyPlan;
  try {
    plan = await planTidy(root, opts.type);
  } catch (error) {
    if (error instanceof TidyPlanError) {
      const diagnostic = tidyDiagnostic(
        error.type,
        error.display,
        error.message,
      );
      return {
        ok: false,
        verb: "tidy",
        error: "tidy_parse_failed",
        message:
          "Tidy could not build a complete plan, so it left every file unchanged.",
        diagnostics: [diagnostic],
      };
    }
    if (error instanceof InvalidTidyTypeError) {
      return {
        ok: false,
        verb: "tidy",
        error: "invalid_tidy_type",
        message: error.message,
      };
    }
    throw error;
  }
  if (opts.dryRun ?? false) {
    return previewResult("tidy", tidyPlanToEngine(plan));
  }
  return await applyTidyPlan(plan);
}

/** Run and render `discern tidy`. */
export async function runTidy(
  root: string,
  opts: { type?: string; dryRun?: boolean; json?: boolean } = {},
): Promise<number> {
  const result = await tidyResult(root, opts);
  observeResult(result);
  if (opts.json ?? false) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }

  const out = makeOut(colorEnabled());
  if (result.plan !== undefined) {
    renderPlan(outSink(out), result.plan);
  } else if (result.steps !== undefined) {
    renderStepResults(outSink(out), {
      title: "Tidy results",
      steps: result.steps,
    });
    if (result.steps.length === 0) {
      out.ok("The selected files are already tidy.");
    }
  }
  if (!result.ok && result.message !== undefined) {
    out.error(result.message);
  }
  for (const diagnostic of result.diagnostics ?? []) {
    out.error(diagnostic.message);
  }
  return result.ok ? 0 : 1;
}
