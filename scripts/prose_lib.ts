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
