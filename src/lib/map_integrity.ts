/**
 * Read-only integrity of current map pages and instruction sources.
 * Current supporting pages, including `_internal`, keep the same currency
 * contract. Historical ADR bodies and private drafts are outside this account;
 * the maintained ADR index has its own refresh guard. Publication policy belongs
 * to the publishing corpus, not a project's local links.
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
import { discoverDocs, type DocEntry } from "./docs.ts";
import { mapPageKind } from "./map_policy.ts";
import { frontmatterShapeIssues } from "./frontmatter.ts";
import {
  resolveInstructionSources,
  resolveMapDir,
  resolveScriptsDir,
} from "./paths.ts";
import { resolveEffectiveSkills } from "./skills.ts";
import { discoverProjectScripts } from "../engine/project_scripts.ts";
import {
  directoryExists,
  fileExists,
  targetExists,
} from "../shared/fs_presence.ts";

/** The rules the documentation preflight enforces. */
export const DOCS_INTEGRITY_RULES = [
  "dead-link",
  "dead-anchor",
  "frontmatter",
  "stale-command",
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
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    // discern-best-effort: map-link-uri-decode-fallback
    return undefined;
  }
}

/** The Markdown file a link target names: itself, or its README when it is a
 * directory. Undefined when the target is not a Markdown page (an anchor on a
 * source file — `#L10` — has no heading contract to check). */
async function asMarkdownPage(abs: string): Promise<string | undefined> {
  if (abs.toLowerCase().endsWith(".md")) return abs;
  if (await directoryExists(abs)) {
    const readme = join(abs, "README.md");
    return await fileExists(readme) ? readme : undefined;
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

/** The per-page local link and anchor findings. */
async function linkFindings(
  rel: string,
  entry: DocEntry,
  text: string,
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
      if (!(await targetExists(abs))) {
        findings.push({
          file: rel,
          line,
          rule: "dead-link",
          detail: `dead link "${target}" — no such file`,
        });
        continue;
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
export function fencedCommandFindings(
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
  const discovered = await discoverDocs({
    cwd: root,
    dir: mapAbs,
    includeInternal: true,
  });
  const tree = discovered === undefined ? undefined : {
    ...discovered,
    entries: discovered.entries.filter((entry) =>
      mapPageKind(entry.relToDocs) === "current"
    ),
  };
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
        ...await linkFindings(rel, entry, text, anchors),
      );
      findings.push(...fencedCommandFindings(rel, text, cli, extraVerbs));
      findings.push(...citationFindings(rel, text, knownSkills));
    }
  }

  for (const sourceAbs of await resolveInstructionSources(root, config)) {
    const text = await Deno.readTextFile(sourceAbs);
    const rel = relative(root, sourceAbs);
    findings.push(...fencedCommandFindings(rel, text, cli, extraVerbs));
    findings.push(...citationFindings(rel, text, knownSkills));
  }

  return findings;
}
