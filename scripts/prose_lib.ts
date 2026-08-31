/**
 * Shared staging for the prose surfaces: Vale must measure PROSE, never
 * metadata, and it has no native way to skip Markdown frontmatter (its
 * BlockIgnores apply only to non-Markdown formats). So both prose surfaces —
 * the `[jobs.prose]` gate job and the `[standards.prose]` metric — lint a
 * staged mirror of the map instead of the tree itself:
 *
 *  - every `.md` file is copied with its frontmatter block replaced by the
 *    same number of blank lines, so Vale's line numbers still point at the
 *    real file;
 *  - `_private/` is skipped outright (it is unshipped and carries no prose
 *    contract — the same exclusion `.vale.ini` declares by glob, re-applied
 *    here because staged paths never match that glob).
 *
 * Callers map Vale's output paths back through {@link restoreStagePaths} so a
 * diagnostic names the real file. The tooling temp capability owns teardown.
 */

import { walk } from "@std/fs";
import { dirname, join, relative, resolve } from "@std/path";
import { z } from "@zod/zod";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { decodeJson } from "../src/shared/runtime_decode.ts";
import { withToolTempDir } from "./temp_dir.ts";

const valeCoordinate = z.number().int().positive();

/** One Vale JSON alert, tolerant of fields no discern caller consumes. */
export const valeAlertSchema = z.looseObject({
  Severity: z.enum(["error", "warning", "suggestion"]),
  Check: z.string().optional(),
  Message: z.string().optional(),
  Line: valeCoordinate.optional(),
  Span: z.tuple([valeCoordinate, valeCoordinate]).optional(),
});

/** Vale's path-to-alert-list JSON report. */
export const valeReportSchema = z.record(z.string(), z.array(valeAlertSchema));

/** One validated Vale JSON report. */
export type ValeReport = z.output<typeof valeReportSchema>;

/** Decode Vale JSON before a metric, gate, or editor consumes its alerts. */
export function decodeValeReport(text: string, source: string): ValeReport {
  return decodeJson(valeReportSchema, text, source);
}

export interface StagedProseInput {
  readonly dir: string;
  readonly words: number;
}

/** One exact source-backed file to place in a temporary prose corpus. */
export interface ProseStageFile {
  readonly stagePath: string;
  readonly source: string;
  readonly prose: string;
}

/** Frontmatter replaced by an equal number of blank lines (line-stable). */
export function blankFrontmatter(text: string): string {
  const { body } = parseFrontmatter(text);
  if (body === text) return text;
  const total = text.split("\n").length;
  const kept = body.split("\n").length;
  return "\n".repeat(Math.max(0, total - kept)) + body;
}

/** Count lexical words in the same text Vale receives. */
export function proseWordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.length ?? 0;
}

/** Stage exact prose files and retain every authored-source coordinate. */
export async function stageProseFiles(
  dir: string,
  files: readonly ProseStageFile[],
): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  for (const file of files) {
    const destination = join(dir, file.stagePath);
    await Deno.mkdir(dirname(destination), { recursive: true });
    await Deno.writeTextFile(destination, file.prose);
    sources.set(resolve(destination), resolve(file.source));
  }
  return sources;
}

/**
 * Run `fn` with a frontmatter-blanked, `_private`-free mirror of `docsDir`.
 * The callback may return ordinary data, but the staged path ends with it.
 */
export async function withStagedProseInput<T>(
  docsDir: string,
  fn: (stage: StagedProseInput) => T | Promise<T>,
): Promise<T> {
  return await withToolTempDir("map-prose-stage", async (dir) => {
    let words = 0;
    for await (
      const entry of walk(docsDir, {
        exts: [".md"],
        includeDirs: false,
        skip: [/(^|\/)_private(\/|$)/],
      })
    ) {
      const rel = relative(docsDir, entry.path);
      const dest = join(dir, rel);
      const prose = blankFrontmatter(await Deno.readTextFile(entry.path));
      await Deno.mkdir(dirname(dest), { recursive: true });
      await Deno.writeTextFile(dest, prose);
      words += proseWordCount(prose);
    }
    return await fn({ dir, words });
  });
}

/** Point Vale's staged paths back at the real tree for readable diagnostics. */
export function restoreStagePaths(
  output: string,
  stage: string,
  docsDir: string,
): string {
  return output.replaceAll(
    `${stage}/`,
    docsDir.endsWith("/") ? docsDir : `${docsDir}/`,
  )
    .replaceAll(stage, docsDir);
}

/** Whether one Vale check belongs to discern's authored voice styles. */
function isDiscernVoiceCheck(check: unknown): boolean {
  return typeof check === "string" && check.startsWith("Discern");
}

/**
 * Select the alerts that block the prose job: every error across the linted
 * map, plus every discern-authored voice alert throughout the staged corpus.
 * Microsoft, Vale, and proselint advisories below error remain density signals.
 */
export function selectProseGateAlerts(
  vale: unknown,
): Record<string, unknown[]> {
  const selected: Record<string, unknown[]> = {};
  if (vale === null || typeof vale !== "object" || Array.isArray(vale)) {
    return selected;
  }
  for (const [path, value] of Object.entries(vale)) {
    if (!Array.isArray(value)) continue;
    const alerts = value.filter((alert) => {
      if (alert === null || typeof alert !== "object") return false;
      const fields = alert as Record<string, unknown>;
      return fields.Severity === "error" ||
        isDiscernVoiceCheck(fields.Check);
    });
    if (alerts.length > 0) selected[path] = alerts;
  }
  return selected;
}

/** Count alerts in a Vale path-to-alerts projection. */
export function valeAlertCount(vale: Record<string, unknown[]>): number {
  return Object.values(vale).reduce(
    (total, alerts) => total + alerts.length,
    0,
  );
}

/** One SARIF result row, as the gate's diagnostic normalization reads it. */
export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: [{
    physicalLocation: {
      artifactLocation: { uri: string };
      region: { startLine?: number; startColumn?: number };
    };
  }];
}

/** The minimal SARIF 2.1.0 log the `[jobs.prose]` gate command emits. */
export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: [{ tool: { driver: { name: string } }; results: SarifResult[] }];
}

const VALE_SARIF_LEVELS: Record<string, SarifResult["level"]> = {
  error: "error",
  warning: "warning",
  suggestion: "note",
};

/**
 * Project `vale --output=JSON` (a path → alert-list map) into a SARIF 2.1.0 log,
 * so the gate normalizes each finding into a file/line/rule diagnostic instead
 * of one opaque output blob. `mapPath` points a staged path back at the real
 * tree ({@link restoreStagePaths} on one path). Defensive throughout: a
 * malformed entry is skipped, never thrown — a conversion crash would replace
 * every finding with a stack trace.
 */
export function valeJsonToSarif(
  vale: unknown,
  mapPath: (path: string) => string,
): SarifLog {
  const results: SarifResult[] = [];
  if (vale !== null && typeof vale === "object" && !Array.isArray(vale)) {
    for (const [path, alerts] of Object.entries(vale)) {
      if (!Array.isArray(alerts)) {
        continue;
      }
      for (const alert of alerts) {
        if (alert === null || typeof alert !== "object") {
          continue;
        }
        const a = alert as Record<string, unknown>;
        const severity = typeof a.Severity === "string" ? a.Severity : "";
        const region: { startLine?: number; startColumn?: number } = {};
        if (
          typeof a.Line === "number" && Number.isInteger(a.Line) && a.Line > 0
        ) {
          region.startLine = a.Line;
        }
        const col = Array.isArray(a.Span) ? a.Span[0] : undefined;
        if (typeof col === "number" && Number.isInteger(col) && col > 0) {
          region.startColumn = col;
        }
        results.push({
          ruleId: typeof a.Check === "string" && a.Check !== ""
            ? a.Check
            : "vale",
          level: VALE_SARIF_LEVELS[severity] ?? "error",
          message: {
            text: typeof a.Message === "string" && a.Message !== ""
              ? a.Message
              : "(no message)",
          },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: mapPath(path) },
              region,
            },
          }],
        });
      }
    }
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{ tool: { driver: { name: "vale" } }, results }],
  };
}
