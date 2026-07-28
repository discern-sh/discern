/**
 * Structural census of Deno lint suppression directives.
 *
 * Deno recognizes line-scoped `deno-lint-ignore` and file-scoped
 * `deno-lint-ignore-file` comments. Both are migration debt in this repository.
 * This detector reads comment tokens rather than raw text, so examples inside
 * strings, template bodies, regex literals, and block comments do not count.
 */

import { join } from "@std/path";
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
