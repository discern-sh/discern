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
 * diagnostic names the real file, then remove the stage directory.
 */

import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";

export interface StagedProseInput {
  dir: string;
  words: number;
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

/**
 * Stage a frontmatter-blanked, `_private`-free mirror of `docsDir` for Vale.
 * Returns the stage directory and its word count; the caller owns removal.
 */
export async function stageProseInput(
  docsDir: string,
): Promise<StagedProseInput> {
  const dir = await Deno.makeTempDir({ prefix: "discern-prose-" });
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
  return { dir, words };
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
