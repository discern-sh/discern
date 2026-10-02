/**
 * Structural census of Deno lint suppression directives.
 *
 * Deno recognizes line-scoped `deno-lint-ignore` and file-scoped
 * `deno-lint-ignore-file` comments. Neither is permitted in authored source
 * in this repository.
 * This detector reads comment tokens rather than raw text, so examples inside
 * strings, template bodies, regex literals, and block comments do not count.
 */

import { globToRegExp, join } from "@std/path";
import { parseDenoExclusions, sectionExclusions } from "./deno_exclusions.ts";
import { extractSourceComments } from "./source_comments.ts";

export type DenoLintSuppressionDirective =
  | "deno-lint-ignore"
  | "deno-lint-ignore-file";

export interface SourceLintSuppression {
  /** 1-based source line. */
  line: number;
  /** The Deno directive found on that line. */
  directive: DenoLintSuppressionDirective;
}

export interface FileLintSuppression extends SourceLintSuppression {
  /** Repository-relative path. */
  file: string;
}

/** One configured lint exclusion that removes at least one authored source. */
export interface EffectiveLintExclusion {
  /** The exact path or pattern from `deno.json`. */
  readonly pattern: string;
  /** Authored Deno sources the exclusion removes, in deterministic order. */
  readonly files: readonly string[];
}

const DIRECTIVE = /^(deno-lint-ignore(?:-file)?)(?=\s|$)/;

/** Every Deno lint suppression directive in one source string. */
export function lintSuppressionsInSource(
  source: string,
): SourceLintSuppression[] {
  const findings: SourceLintSuppression[] = [];
  for (const comment of extractSourceComments(source)) {
    if (comment.kind !== "line") continue;
    for (let offset = 0; offset < comment.lines.length; offset++) {
      const text = (comment.lines[offset] ?? "").trim();
      const directive = text.match(DIRECTIVE)?.[1];
      if (
        directive !== "deno-lint-ignore" &&
        directive !== "deno-lint-ignore-file"
      ) {
        continue;
      }
      findings.push({
        line: comment.startLine + offset,
        directive,
      });
    }
  }
  return findings;
}

/** Scan a deterministic, repository-relative source-file universe. */
export async function lintSuppressionsInFiles(
  root: string,
  files: readonly string[],
): Promise<FileLintSuppression[]> {
  const findings: FileLintSuppression[] = [];
  for (const file of files) {
    const source = await Deno.readTextFile(join(root, file));
    for (const finding of lintSuppressionsInSource(source)) {
      findings.push({ file, ...finding });
    }
  }
  return findings;
}

/** Normalize one config path to the repository-relative form Git returns. */
function normalizedExclusion(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** Whether one Deno lint exclusion removes one authored repository path. */
function exclusionMatches(pattern: string, file: string): boolean {
  const normalized = normalizedExclusion(pattern);
  if (normalized.endsWith("/")) return file.startsWith(normalized);
  if (!/[?*\[\]{]/.test(normalized)) {
    return file === normalized || file.startsWith(`${normalized}/`);
  }
  return globToRegExp(normalized, {
    extended: true,
    globstar: true,
  }).test(file);
}

/**
 * Decode every exclusion `deno lint` applies — the top-level list and the
 * lint section's own — refusing malformed census input.
 */
function configuredLintExclusions(configText: string): string[] {
  return sectionExclusions(parseDenoExclusions(configText), "lint");
}

/**
 * Return only exclusions that actually remove a member of the authored Deno
 * universe. Gitignored products and inert fixture paths are not source-policy
 * exceptions, even when the same config excludes them from the Deno command.
 */
export function effectiveLintExclusions(
  configText: string,
  authoredFiles: readonly string[],
): EffectiveLintExclusion[] {
  return configuredLintExclusions(configText).flatMap((pattern) => {
    const files = authoredFiles.filter((file) =>
      exclusionMatches(pattern, file)
    );
    return files.length === 0 ? [] : [{ pattern, files }];
  });
}
