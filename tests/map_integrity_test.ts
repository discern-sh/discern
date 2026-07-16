/**
 * Map integrity guards — the gate holds the documentation to the same change
 * discipline as the code, so doc drift is a build failure, not a review
 * finding:
 *
 *  1. every fenced `discern …` example validates against the LIVE verb and
 *     flag registry (a renamed verb or removed flag fails the docs, not the
 *     user);
 *  2. every intra-map link resolves to a real file;
 *  3. every heading anchor a link names exists — per the shared renderer's
 *     own slugging, duplicate-suffixing included;
 *  4. no PUBLISHED page links into `_internal/` or `_private/` (the audience
 *     boundary: a public reader must never be handed a dead or leaking path).
 *
 * The corpus is the CURRENT map — every doc outside `_`-prefixed subtrees,
 * root docs included — discovered live, so a new page auto-enrols. The
 * `_`-trees are exempt by design: ADRs are dated records (their examples
 * describe the CLI as it stood), and `_internal`/`_private` carry no currency
 * contract. The scanners themselves are proven to bite in
 * tests/docs_integrity_test.ts; project-script names enrol from the live
 * scripts directory, and the CLI model from the live registry — no hand lists.
 */

import { dirname, join, relative, resolve } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import {
  extractDocLinks,
  extractFencedCommands,
  headingAnchors,
  validateFencedCommand,
} from "../src/lib/docs_integrity.ts";
import { discoverDocs, type DocEntry, isPublicDoc } from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { discoverProjectScripts } from "../src/engine/project_scripts.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

/** The current-map corpus: every non-`_` doc, discovered live. */
async function currentDocs(): Promise<DocEntry[]> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
  });
  assert(tree !== undefined, "the configured map exists");
  return tree.entries;
}

/** Whether an entry renders on published surfaces: a published-tier section
 * (or a root-level doc) that the page-level predicate admits. */
function isPublishedPage(entry: DocEntry): boolean {
  const publishedTier = entry.section === "" ||
    BUNDLED_PUBLIC_DOC_DIRS.includes(entry.section);
  return publishedTier && isPublicDoc(entry);
}

/** A link target with an external scheme (`https:`, `mailto:`, …). */
function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

/** Resolve a link's path part against its source file, tolerating URL
 * escapes. Returns undefined for an unresolvable escape sequence. */
function resolveTarget(from: string, path: string): string | undefined {
  try {
    return resolve(dirname(from), decodeURIComponent(path));
  } catch {
    return undefined;
  }
}

Deno.test("every fenced `discern …` example in the current map validates against the live registry", async () => {
  const model = cliCommandModel(buildCli(false) as unknown as Command);
  const scripts = await discoverProjectScripts(REPO_AUTHORED_PATHS.scripts);
  const extraVerbs = new Set(scripts.map((s) => s.name));

  const failures: string[] = [];
  for (const entry of await currentDocs()) {
    const text = await Deno.readTextFile(entry.absPath);
    for (const { line, command } of extractFencedCommands(text)) {
      const reason = validateFencedCommand(command, model, extraVerbs);
      if (reason !== undefined) {
        failures.push(
          `${relative(REPO_ROOT, entry.absPath)}:${line} \`${command}\` — ${reason}`,
        );
      }
    }
  }
  assertEquals(
    failures,
    [],
    "fenced examples must match the live CLI — update the example (or the " +
      "command registry) so readers are never handed a command that fails",
  );
});

Deno.test("every intra-map link in the current map resolves, and every named anchor exists", async () => {
  const docs = await currentDocs();
  const anchorCache = new Map<string, Set<string>>();
  const anchorsOf = async (absPath: string): Promise<Set<string>> => {
    const cached = anchorCache.get(absPath);
    if (cached !== undefined) return cached;
    const anchors = headingAnchors(await Deno.readTextFile(absPath));
    anchorCache.set(absPath, anchors);
    return anchors;
  };
  /** The Markdown file a target names: itself, or its README when it is a
   * directory. Undefined when the target is not a Markdown page. */
  const asMarkdownPage = async (
    abs: string,
  ): Promise<string | undefined> => {
    if (abs.toLowerCase().endsWith(".md")) return abs;
    try {
      if ((await Deno.stat(abs)).isDirectory) {
        const readme = join(abs, "README.md");
        await Deno.stat(readme);
        return readme;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  const failures: string[] = [];
  for (const entry of docs) {
    const text = await Deno.readTextFile(entry.absPath);
    const rel = relative(REPO_ROOT, entry.absPath);
    for (const { target, line } of extractDocLinks(text)) {
      if (isExternal(target)) continue;
      const hash = target.indexOf("#");
      const path = hash === -1 ? target : target.slice(0, hash);
      const fragment = hash === -1 ? "" : target.slice(hash + 1);

      let abs = entry.absPath;
      if (path !== "") {
        const resolved = resolveTarget(entry.absPath, path);
        if (resolved === undefined) {
          failures.push(`${rel}:${line} unresolvable link "${target}"`);
          continue;
        }
        abs = resolved;
        try {
          await Deno.stat(abs);
        } catch {
          failures.push(
            `${rel}:${line} dead link "${target}" — no such file`,
          );
          continue;
        }
      }

      if (fragment === "") continue;
      const page = await asMarkdownPage(abs);
      if (page === undefined) continue; // a non-page anchor (#L10 on source)
      if (!(await anchorsOf(page)).has(fragment)) {
        failures.push(
          `${rel}:${line} dead anchor "${target}" — the renderer emits no ` +
            `heading id "${fragment}" there`,
        );
      }
    }
  }
  assertEquals(
    failures,
    [],
    "intra-map links and anchors must resolve — repoint the link, or restore " +
      "the heading/file it names",
  );
});

Deno.test("no published page links into _internal/ or _private/", async () => {
  const failures: string[] = [];
  for (const entry of await currentDocs()) {
    if (!isPublishedPage(entry)) continue;
    const text = await Deno.readTextFile(entry.absPath);
    for (const { target, line } of extractDocLinks(text)) {
      if (isExternal(target)) continue;
      const path = target.split("#")[0] ?? "";
      if (path === "") continue;
      const abs = resolveTarget(entry.absPath, path);
      if (abs === undefined) continue;
      const inMap = relative(REPO_AUTHORED_PATHS.map, abs);
      if (inMap.startsWith("..")) continue;
      const crossed = inMap.split("/").find(
        (seg) => seg === "_internal" || seg === "_private",
      );
      if (crossed !== undefined) {
        failures.push(
          `${relative(REPO_ROOT, entry.absPath)}:${line} links "${target}" — ` +
            `a published page must not link into ${crossed}/`,
        );
      }
    }
  }
  assertEquals(
    failures,
    [],
    "published pages may cite decisions (_adr) but never the internal or " +
      "private trees — remove or repoint the link",
  );
});
