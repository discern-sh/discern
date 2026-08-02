/**
 * Frontmatter-contracted Markdown trees stay outside `deno fmt`.
 *
 * `deno fmt` rewrites YAML frontmatter through an error-tolerant parser: fed a
 * block that is not valid YAML (an unquoted `: ` inside a value), it re-indents
 * the following flush-left keys so they nest under the broken value — the block
 * is restructured into differently invalid YAML instead of being preserved or
 * refused. The trees whose frontmatter the gate contracts (the map via
 * `validateFrontmatter`, skills via `skillFrontmatterIssues`) must therefore
 * never sit inside `deno fmt`'s walk: the map is owned by `discern tidy`,
 * whose formatter parses frontmatter strictly and refuses rather than
 * rewrites (ADR 0158, ADR 0178), and skill Markdown is formatted by nothing.
 *
 * The universe is derived from the live resolvers and the provider registry,
 * so a renamed configured directory or a new provider enrols automatically; a
 * hand-kept list here would relocate the gap instead of closing it.
 */

import { assert } from "@std/assert";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  resolveBundledSkillsDir,
  resolveMapDir,
  resolveSkillsDir,
} from "../src/lib/paths.ts";
import { PROVIDERS } from "../src/lib/providers.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));

/** Return the fmt exclude. */
async function fmtExclude(): Promise<string[]> {
  const denoJson = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  ) as { fmt?: { exclude?: string[] } };
  return denoJson.fmt?.exclude ?? [];
}

/** True when the repo-relative directory sits inside an excluded entry. */
function coveredBy(exclude: string[], dir: string): boolean {
  const norm = `${dir.replace(/\/+$/, "")}/`;
  return exclude.some((entry) => {
    const prefix = `${entry.replace(/\*+$/, "").replace(/\/+$/, "")}/`;
    return norm === prefix || norm.startsWith(prefix);
  });
}

Deno.test("frontmatter-contracted source trees are excluded from deno fmt", async () => {
  const config = await loadConfig(REPO_ROOT);
  const exclude = await fmtExclude();
  const trees = [
    resolveMapDir(REPO_ROOT, config).rel,
    resolveSkillsDir(REPO_ROOT, config).rel,
    relative(REPO_ROOT, await resolveBundledSkillsDir()),
  ];
  for (const tree of trees) {
    assert(
      coveredBy(exclude, tree),
      `deno fmt formats "${tree}", a tree whose Markdown carries contracted ` +
        "frontmatter; add it to fmt.exclude in deno.json so an invalid block " +
        "is preserved for the gate to reject instead of being restructured",
    );
  }
});

Deno.test("provider skills directories stay hidden from deno fmt", async () => {
  const exclude = await fmtExclude();
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const dir = provider.skillsDir?.path;
    if (dir === undefined) continue;
    assert(
      dir.startsWith(".") || coveredBy(exclude, dir),
      `provider ${name} materializes skills into "${dir}", which deno fmt ` +
        "would walk; keep the directory dot-hidden or add it to fmt.exclude",
    );
  }
});
