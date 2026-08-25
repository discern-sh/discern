/**
 * The map & instructions integrity check — the gate's documentation preflight.
 *
 * A project's map and instruction sources carry references that go stale silently:
 * links to files that moved, anchors to headings that were reworded, fenced
 * `discern …` examples quoting a retired verb or flag, metadata blocks the
 * lenient reader would swallow, published pages linking into the internal
 * trees, and skill citations naming a skill absent from the effective set (a
 * rename, or a `[skills].exclude` entry). Each is a defect a reader only
 * discovers by following the reference and failing — so the gate finds them
 * first.
 *
 * PURE observation: `(root, config, cli) → findings`, reads only. The corpus is
 * the CURRENT configured map — every doc outside `_`-prefixed subtrees, root
 * docs included, discovered live so a new page auto-enrols — plus the
 * `[instructions].sources` files for the command and citation checks (instructions are
 * prose for agents, not a page tree: no link, anchor, metadata, or audience
 * checks there). The `_`-trees are exempt by design: decision records are
 * dated (their examples describe the CLI as it stood), and the internal and
 * private trees carry no currency contract.
 *
 * Consumers: the gate precondition in engine/gate/finish.ts (blocking, like
 * the other generated-artifact preflights) and this repo's own corpus tests.
 * The scanners live in docs_integrity.ts; the per-rule remedies live here so
 * every surface phrases the fix one way.
 */

import { dirname, join, relative, resolve } from "@std/path";
import type { DiscernConfig } from "../shared/config_schema.ts";
import type { CliCommand } from "../shared/cli_reference_codegen.ts";
import {
  extractDocLinks,
  extractFencedCommands,
  extractSkillCitations,
  headingAnchors,
  validateFencedCommand,
} from "./docs_integrity.ts";
import { discoverDocs, type DocEntry, isPublicDoc } from "./docs.ts";
import { frontmatterShapeIssues } from "./frontmatter.ts";
import {
  resolveInstructionSources,
  resolveMapDir,
  resolveScriptsDir,
} from "./paths.ts";
import { resolveEffectiveSkills } from "./skills.ts";
import { discoverProjectScripts } from "../engine/project_scripts.ts";

/** The rules the documentation preflight enforces. */
export const DOCS_INTEGRITY_RULES = [
  "dead-link",
  "dead-anchor",
  "frontmatter",
  "stale-command",
  "audience-boundary",
  "skill-citation",
] as const;

/** One rule id ({@link DOCS_INTEGRITY_RULES}). */
export type DocsIntegrityRule = (typeof DOCS_INTEGRITY_RULES)[number];

/**
 * The remedy each rule's findings share — rendered once per rule group in the
 * gate diagnostic, so the fix is stated at the point of failure and phrased
 * one way everywhere.
 */
export const DOCS_INTEGRITY_REMEDIES: Record<DocsIntegrityRule, string> = {
  "dead-link": "Repoint or remove the link, or restore the file it names.",
  "dead-anchor":
    "Update the link's #fragment to a heading the target page carries, or restore the heading it names.",
  "frontmatter":
    "Fix the metadata block so every reader parses it: close the `---` fence, keep the block a valid YAML mapping, and give the named keys values of the required shape.",
  "stale-command":
    "Update the example to a command the current CLI accepts (`discern --help` and `discern <command> --help` show the live set), or correct the command's declaration.",
  "audience-boundary":
    "A page published projections serve must not link into `_internal/` or `_private/`. Remove or repoint the link, or withhold the page with `publish: false`.",
  "skill-citation":
    "Make the citation name a skill that exists: fix the name, restore or stop excluding the skill, or reword the span so it is not a bare skill-shaped token.",
};

/** One documentation-integrity finding. */
export interface DocsIntegrityFinding {
  /** Project-relative path of the offending file. */
  file: string;
  /** 1-based source line (0 when the offence cannot be located). */
  line: number;
  /** Which rule fired. */
  rule: DocsIntegrityRule;
  /** What is wrong, self-contained for the diagnostic. */
  detail: string;
}

/** A link target with an external scheme (`https:`, `mailto:`, `//…`) or a
 * root-relative path (`/x` — a map published to a site legitimately uses
 * site-absolute routes the checkout cannot resolve). */
function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") ||
    target.startsWith("/");
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

/** True when `path` exists (any file type). */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The Markdown file a link target names: itself, or its README when it is a
 * directory. Undefined when the target is not a Markdown page (an anchor on a
 * source file — `#L10` — has no heading contract to check). */
async function asMarkdownPage(abs: string): Promise<string | undefined> {
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
}

/** Renderer-derived heading anchors per absolute path, read at most once. */
class AnchorCache {
  private cache = new Map<string, Set<string>>();

  seed(absPath: string, text: string): void {
    if (!this.cache.has(absPath)) {
      this.cache.set(absPath, headingAnchors(text));
    }
  }

  async anchorsOf(absPath: string): Promise<Set<string>> {
    const cached = this.cache.get(absPath);
    if (cached !== undefined) return cached;
    const anchors = headingAnchors(await Deno.readTextFile(absPath));
    this.cache.set(absPath, anchors);
    return anchors;
  }
}

/** The per-page link and anchor findings, plus the audience boundary for a
 * published page (`_internal`/`_private` targets inside the map). */
async function linkFindings(
  rel: string,
  entry: DocEntry,
  text: string,
  mapAbs: string,
  anchors: AnchorCache,
): Promise<DocsIntegrityFinding[]> {
  const findings: DocsIntegrityFinding[] = [];
  for (const { target, line } of extractDocLinks(text)) {
    if (isExternalTarget(target)) continue;
    const hash = target.indexOf("#");
    const path = hash === -1 ? target : target.slice(0, hash);
    const fragment = hash === -1 ? "" : target.slice(hash + 1);

    let abs = entry.absPath;
    if (path !== "") {
      const resolved = resolveTarget(entry.absPath, path);
      if (resolved === undefined) {
        findings.push({
          file: rel,
          line,
          rule: "dead-link",
          detail: `unresolvable link "${target}"`,
        });
        continue;
      }
      abs = resolved;
      if (!(await exists(abs))) {
        findings.push({
          file: rel,
          line,
          rule: "dead-link",
          detail: `dead link "${target}" — no such file`,
        });
        continue;
      }
      // The audience boundary: a page the published projections serve must
      // not hand its reader a path those projections exclude.
      if (isPublicDoc(entry)) {
        const inMap = relative(mapAbs, abs);
        const crossed = inMap.startsWith("..") ? undefined : inMap
          .split("/")
          .find((seg) => seg === "_internal" || seg === "_private");
        if (crossed !== undefined) {
          findings.push({
            file: rel,
            line,
            rule: "audience-boundary",
            detail:
              `links "${target}" — a published page must not link into ${crossed}/`,
          });
          continue;
        }
      }
    }

    if (fragment === "") continue;
    const page = await asMarkdownPage(abs);
    if (page === undefined) continue;
    if (!(await anchors.anchorsOf(page)).has(fragment)) {
      findings.push({
        file: rel,
        line,
        rule: "dead-anchor",
        detail: `dead anchor "${target}" — the target page has no heading ` +
          `anchor "${fragment}"`,
      });
    }
  }
  return findings;
}

/** The fenced `discern …` example findings for one file. */
function commandFindings(
  rel: string,
  text: string,
  cli: CliCommand,
  extraVerbs: ReadonlySet<string>,
): DocsIntegrityFinding[] {
  const findings: DocsIntegrityFinding[] = [];
  for (const { line, command } of extractFencedCommands(text)) {
    const reason = validateFencedCommand(command, cli, extraVerbs);
    if (reason !== undefined) {
      findings.push({
        file: rel,
        line,
        rule: "stale-command",
        detail: `\`${command}\` — ${reason}`,
      });
    }
  }
  return findings;
}

/** The skill-citation findings for one file: every backticked citation must
 * name a skill in the effective set — `[skills].exclude` included, so an
 * excluded skill cannot stay recommended by live prose. */
function citationFindings(
  rel: string,
  text: string,
  knownSkills: ReadonlySet<string>,
): DocsIntegrityFinding[] {
  const findings: DocsIntegrityFinding[] = [];
  for (const { line, name } of extractSkillCitations(text)) {
    if (!knownSkills.has(name)) {
      findings.push({
        file: rel,
        line,
        rule: "skill-citation",
        detail:
          `cites \`${name}\`, which is not an available skill (\`discern ` +
          `skills list\` shows the effective set)`,
      });
    }
  }
  return findings;
}

/**
 * Check the configured map and instruction sources for integrity defects. Pure
 * and read-only; returns every finding in corpus order (map pages first, then
 * instruction sources), empty when the documentation is sound. A project with no
 * map directory and no instruction sources has nothing to check and returns
 * empty — the preflight never invents work for a docs-less project.
 */
export async function checkDocsIntegrity(
  root: string,
  config: DiscernConfig,
  cli: CliCommand,
): Promise<DocsIntegrityFinding[]> {
  const findings: DocsIntegrityFinding[] = [];
  const scripts = await discoverProjectScripts(
    resolveScriptsDir(root, config).abs,
  );
  const extraVerbs = new Set(scripts.map((s) => s.name));
  const knownSkills = new Set(
    (await resolveEffectiveSkills(root, config)).map((e) => e.name),
  );

  const { abs: mapAbs } = resolveMapDir(root, config);
  const tree = await discoverDocs({ cwd: root, dir: mapAbs });
  if (tree !== undefined) {
    const anchors = new AnchorCache();
    const texts = new Map<string, string>();
    for (const entry of tree.entries) {
      const text = await Deno.readTextFile(entry.absPath);
      texts.set(entry.absPath, text);
      anchors.seed(entry.absPath, text);
    }
    for (const entry of tree.entries) {
      const text = texts.get(entry.absPath) ?? "";
      const rel = relative(root, entry.absPath);
      for (const issue of frontmatterShapeIssues(text)) {
        findings.push({
          file: rel,
          line: 1,
          rule: "frontmatter",
          detail: issue,
        });
      }
      findings.push(
        ...await linkFindings(rel, entry, text, tree.docsDir, anchors),
      );
      findings.push(...commandFindings(rel, text, cli, extraVerbs));
      findings.push(...citationFindings(rel, text, knownSkills));
    }
  }

  for (const sourceAbs of await resolveInstructionSources(root, config)) {
    const text = await Deno.readTextFile(sourceAbs);
    const rel = relative(root, sourceAbs);
    findings.push(...commandFindings(rel, text, cli, extraVerbs));
    findings.push(...citationFindings(rel, text, knownSkills));
  }

  return findings;
}
