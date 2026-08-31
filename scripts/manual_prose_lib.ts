/** Canonical published-manual prose projection for voice and complexity. */

import { join, resolve } from "@std/path";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection, type ManualPage } from "../src/lib/manual.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { MANUAL_KIND_REGISTRY } from "../src/shared/manual.ts";
import {
  countProse,
  fleschKincaidGrade,
  type ProseCounts,
} from "./plain_reading_grade_lib.ts";
import {
  blankFrontmatter,
  decodeValeReport,
  selectProseGateAlerts,
  stageProseFiles,
  valeAlertCount,
  type ValeReport,
  valeReportSchema,
} from "./prose_lib.ts";
import { withToolTempDir } from "./temp_dir.ts";
import { runVale } from "./vale_lib.ts";

/** One published manual page and the exact prose projections it supplies. */
export interface ManualProsePage {
  readonly page: ManualPage;
  readonly source: string;
  /** Line-stable Markdown for Vale; metadata is blank and code remains fenced. */
  readonly valeMarkdown: string;
  /** Metadata and code removed for word and reading-complexity measures. */
  readonly measuredProse: string;
}

/** The temporary product-voice corpus and its exact source mapping. */
export interface StagedManualProse {
  readonly dir: string;
  readonly pages: readonly ManualProsePage[];
  readonly sources: ReadonlyMap<string, string>;
}

/** The shared Manual prose-policy verdict used by the gate and Canon Editor. */
export interface ManualProseCheckResult {
  readonly code: number;
  readonly alerts: ValeReport;
  readonly raw: string;
  readonly stderr: string;
  readonly issue?: string;
}

/** Remove code and comments while retaining every reader-visible prose line. */
export function measuredManualProse(markdown: string): string {
  const { body } = parseFrontmatter(markdown);
  const visible: string[] = [];
  let fence: "```" | "~~~" | undefined;
  let inComment = false;
  for (const raw of body.split(/\r?\n/u)) {
    const marker = raw.match(/^\s*(```|~~~)/u)?.[1] as
      | "```"
      | "~~~"
      | undefined;
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker === fence) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    let line = raw;
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) continue;
      line = line.slice(end + 3);
      inComment = false;
    }
    while (true) {
      const start = line.indexOf("<!--");
      if (start < 0) break;
      const end = line.indexOf("-->", start + 4);
      if (end < 0) {
        line = line.slice(0, start);
        inComment = true;
        break;
      }
      line = `${line.slice(0, start)}${line.slice(end + 3)}`;
    }
    visible.push(
      line
        .replace(/`+[^`]*`+/gu, " ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1"),
    );
  }
  return visible.join("\n");
}

/** Load the strict published projection once, then derive every prose page. */
export async function projectManualProse(
  repoRoot: string,
  sources?: readonly string[],
): Promise<ManualProsePage[]> {
  const manualDir = resolveRepositoryManualDir(repoRoot).abs;
  const tree = await discoverDocs({ cwd: repoRoot, dir: manualDir });
  if (tree === undefined) throw new Error(`no product manual at ${manualDir}`);
  const manual = await buildManualProjection(tree.entries);
  const requested = sources === undefined
    ? undefined
    : new Set(sources.map((source) => resolve(source)));
  const selected = requested === undefined
    ? manual.pages
    : manual.pages.filter((page) => requested.has(resolve(page.entry.absPath)));
  if (requested !== undefined) {
    const enrolled = new Set(
      selected.map((page) => resolve(page.entry.absPath)),
    );
    const missing = [...requested].filter((source) => !enrolled.has(source));
    if (missing.length > 0) {
      throw new Error(
        `not a published Manual page: ${missing.join(", ")}`,
      );
    }
  }
  return await Promise.all(selected.map(async (page) => {
    const markdown = await Deno.readTextFile(page.entry.absPath);
    return {
      page,
      source: page.entry.absPath,
      valeMarkdown: blankFrontmatter(markdown),
      measuredProse: measuredManualProse(markdown),
    };
  }));
}

/** Run with the exact published manual staged under its product-style tier. */
export async function withStagedManualProse<T>(
  repoRoot: string,
  fn: (stage: StagedManualProse) => T | Promise<T>,
  sourceFilter?: readonly string[],
): Promise<T> {
  const pages = await projectManualProse(repoRoot, sourceFilter);
  const files = pages.map((projected) => ({
    stagePath: join("_manual-product", projected.page.entry.relToDocs),
    source: projected.source,
    prose: projected.valeMarkdown,
  }));
  return await withToolTempDir("manual-prose-stage", async (dir) => {
    const sources = await stageProseFiles(dir, files);
    return await fn({ dir, pages, sources });
  });
}

/**
 * Run the Manual's gate-authoritative product-voice policy over the published
 * corpus, or over exact published source pages. Both callers share the same
 * projection, staging, Vale severity, alert selection, and source mapping.
 */
export async function checkManualProse(
  repoRoot: string,
  sources?: readonly string[],
): Promise<ManualProseCheckResult> {
  return await withStagedManualProse(repoRoot, async (stage) => {
    const run = await runVale(repoRoot, [
      "--minAlertLevel",
      "suggestion",
      "--output=JSON",
      stage.dir,
    ]);
    const decoder = new TextDecoder();
    const raw = decoder.decode(run.stdout);
    const stderr = decoder.decode(run.stderr);
    let parsed: ValeReport;
    try {
      parsed = decodeValeReport(raw, "Vale output for the manual prose gate");
    } catch (error) {
      return {
        code: run.code === 0 ? 1 : run.code,
        alerts: {},
        raw,
        stderr,
        issue: error instanceof Error ? error.message : String(error),
      };
    }
    const selected = valeReportSchema.parse(selectProseGateAlerts(parsed));
    const mapped: ValeReport = {};
    for (const [path, alerts] of Object.entries(selected)) {
      const source = manualProseSource(path, stage);
      mapped[source] ??= [];
      mapped[source].push(...alerts);
    }
    const rawHasAlerts = Object.values(parsed).some((alerts) =>
      alerts.length > 0
    );
    const code = run.code !== 0 && !rawHasAlerts
      ? run.code
      : valeAlertCount(mapped) > 0
      ? 1
      : 0;
    return { code, alerts: mapped, raw, stderr };
  }, sources);
}

/** Map one staged Vale path back to the exact authored manual source. */
export function manualProseSource(
  path: string,
  stage: StagedManualProse,
): string {
  return stage.sources.get(resolve(path)) ?? path;
}

/**
 * Reading grade for human-facing purpose kinds. Reference remains in voice,
 * terminology, links, and exactness checks but does not enter this measure.
 */
export function manualReadingGrade(
  pages: readonly ManualProsePage[],
): number {
  const measuredKinds = new Set(
    MANUAL_KIND_REGISTRY.filter((entry) => entry.measuresReadingComplexity)
      .map((entry) => entry.kind),
  );
  const total: ProseCounts = { sentences: 0, words: 0, syllables: 0 };
  for (const page of pages) {
    if (!measuredKinds.has(page.page.kind)) continue;
    const counts = countProse(page.measuredProse);
    total.sentences += counts.sentences;
    total.words += counts.words;
    total.syllables += counts.syllables;
  }
  return fleschKincaidGrade(total);
}
