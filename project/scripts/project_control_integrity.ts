/**
 * Repository control-document integrity.
 *
 * This is deliberately project-owned rather than part of the shipped Map
 * preflight. The public Map checker excludes `_private` by contract; this
 * command gives discern's own programmes, backlog, and documenter manifests
 * the narrower repository-local contracts they need.
 *
 * Pure observation: every check is a deterministic predicate over `root`.
 * The optional private overlay contributes planning checks when present and is
 * otherwise a silent no-op.
 */

import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "@std/path";
import {
  directoryExists,
  fileExists,
  targetExists,
} from "../../src/shared/fs_presence.ts";
import {
  extractDocLinks,
  headingAnchors,
} from "../../src/lib/docs_integrity.ts";

const PLANNING_REL = "project/map/_private/planning";

/** Stable rule ids printed by the command and asserted by its fixtures. */
export const PROJECT_CONTROL_RULES = [
  "planning-link",
  "planning-anchor",
  "planned-output",
  "planning-readme-table",
  "planning-brief-key",
  "planning-worktree",
  "planning-dependency",
  "planning-state",
  "planning-transient-state",
] as const;

/** One project-control rule id. */
export type ProjectControlRule = (typeof PROJECT_CONTROL_RULES)[number];

/** One actionable repository-control finding. */
export interface ProjectControlFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: ProjectControlRule;
  readonly detail: string;
  readonly repair: string;
}

interface MarkdownSource {
  readonly abs: string;
  readonly rel: string;
  readonly text: string;
}

interface Programme {
  readonly abs: string;
  readonly rel: string;
  readonly readme: MarkdownSource;
  readonly files: readonly MarkdownSource[];
}

interface PlannedOutput {
  readonly source: MarkdownSource;
  readonly line: number;
  readonly rawPath: string;
  readonly targetAbs: string | undefined;
  valid: boolean;
  referenced: boolean;
}

interface MarkdownTableRow {
  readonly cells: readonly string[];
  readonly line: number;
}

interface MarkdownTable {
  readonly headers: readonly string[];
  readonly rows: readonly MarkdownTableRow[];
}

interface BriefFile {
  readonly source: MarkdownSource;
  readonly key: string;
  readonly done: boolean;
}

interface BriefRow {
  readonly key: string;
  readonly pathAbs: string;
  readonly pathRaw: string;
  readonly done: boolean;
  readonly line: number;
}

/** Build one finding without letting diagnostics drift across call sites. */
function finding(
  file: string,
  line: number,
  rule: ProjectControlRule,
  detail: string,
  repair: string,
): ProjectControlFinding {
  return { file, line, rule, detail, repair };
}

/** Whether `candidate` is `root` or a descendant of it. */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** External and site-root targets have no checkout-relative file contract. */
function isExternalTarget(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("//") || target.startsWith("/");
}

/** Remove a query and fragment, retaining the fragment separately. */
function targetParts(target: string): { path: string; fragment: string } {
  const hash = target.indexOf("#");
  const beforeHash = hash < 0 ? target : target.slice(0, hash);
  const query = beforeHash.indexOf("?");
  return {
    path: query < 0 ? beforeHash : beforeHash.slice(0, query),
    fragment: hash < 0 ? "" : target.slice(hash + 1),
  };
}

/** Resolve one encoded relative target, or undefined when decoding fails. */
function resolveRelativeTarget(
  sourceAbs: string,
  rawPath: string,
): string | undefined {
  try {
    return resolve(dirname(sourceAbs), decodeURIComponent(rawPath));
  } catch {
    return undefined;
  }
}

/** Recursively enumerate Markdown files in stable path order. */
async function markdownPaths(root: string): Promise<string[]> {
  if (!(await directoryExists(root))) return [];
  const found: string[] = [];
  /** Visit one discovered directory and enroll its Markdown descendants. */
  async function visit(dir: string): Promise<void> {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        await visit(path);
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        found.push(path);
      }
    }
  }
  await visit(root);
  return found;
}

/** Read every Markdown source below a root once. */
async function markdownSources(
  projectRoot: string,
  directory: string,
): Promise<MarkdownSource[]> {
  const sources: MarkdownSource[] = [];
  for (const abs of await markdownPaths(directory)) {
    sources.push({
      abs,
      rel: relative(projectRoot, abs),
      text: await Deno.readTextFile(abs),
    });
  }
  return sources;
}

/** Discover programme roots from live README files, never a copied registry. */
async function discoverProgrammes(root: string): Promise<Programme[]> {
  const planningAbs = join(root, PLANNING_REL);
  const sources = await markdownSources(root, planningAbs);
  const readmes = sources.filter((source) =>
    basename(source.abs) === "README.md" &&
    !relative(planningAbs, source.abs).split("/").includes("_done")
  );
  return readmes.map((readme) => {
    const abs = dirname(readme.abs);
    return {
      abs,
      rel: relative(root, abs),
      readme,
      files: sources.filter((source) => isWithin(abs, source.abs)),
    };
  }).sort((a, b) => a.rel.localeCompare(b.rel));
}

/** Split a Markdown table row while respecting escaped pipes. */
function tableCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of trimmed.slice(1, -1)) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      current += char;
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Whether a cell is a Markdown table alignment separator. */
function isTableSeparator(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

/** Parse ordinary pipe tables with source row lines. */
function markdownTables(text: string): MarkdownTable[] {
  const lines = text.split("\n");
  const tables: MarkdownTable[] = [];
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const headers = tableCells(lines[index] ?? "");
    const separators = tableCells(lines[index + 1] ?? "");
    if (
      headers === undefined || separators === undefined ||
      headers.length !== separators.length ||
      !separators.every(isTableSeparator)
    ) {
      continue;
    }
    const rows: MarkdownTableRow[] = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const cells = tableCells(lines[cursor] ?? "");
      if (cells === undefined || cells.length !== headers.length) break;
      rows.push({ cells, line: cursor + 1 });
      cursor += 1;
    }
    tables.push({ headers, rows });
    index = cursor - 1;
  }
  return tables;
}

/** Human text of a table header or key cell. */
function plainCell(cell: string): string {
  return cell
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the one Markdown-file path a brief cell names. */
function briefCellPaths(cell: string): string[] {
  const paths = new Set<string>();
  for (const match of cell.matchAll(/\]\(([^)]+\.md(?:#[^)]*)?)\)/g)) {
    const value = match[1];
    if (value !== undefined) paths.add(targetParts(value).path);
  }
  for (const match of cell.matchAll(/`([^`]+\.md)`/g)) {
    const value = match[1];
    if (value !== undefined) paths.add(value);
  }
  return [...paths];
}

/** The stable key encoded by a numbered brief filename. */
function briefKey(path: string): string | undefined {
  return basename(path).match(/^(\d+[a-z])-.*\.md$/i)?.[1]?.toUpperCase();
}

/** Every numbered brief file in this programme, derived from disk. */
function briefFiles(programme: Programme): BriefFile[] {
  const files: BriefFile[] = [];
  for (const source of programme.files) {
    const key = briefKey(source.abs);
    if (key === undefined) continue;
    files.push({
      source,
      key,
      done: relative(programme.abs, source.abs).split("/").includes("_done"),
    });
  }
  return files;
}

/** Parse and validate each README table that declares brief rows. */
async function checkReadmeTables(
  programme: Programme,
  files: readonly BriefFile[],
): Promise<{
  findings: ProjectControlFinding[];
  rows: BriefRow[];
}> {
  const findings: ProjectControlFinding[] = [];
  const rows: BriefRow[] = [];
  const knownKeys = new Set(files.map((file) => file.key));
  const seenRowKeys = new Map<string, number>();

  for (const table of markdownTables(programme.readme.text)) {
    const headers = table.headers.map((header) =>
      plainCell(header).toLowerCase()
    );
    const keyIndex = headers.findIndex((header) => header === "key");
    const briefIndex = headers.findIndex((header) => header.includes("brief"));
    if (keyIndex < 0 || briefIndex < 0) continue;
    const stateIndex = headers.findIndex((header) =>
      /^(state|status|delivery)$/.test(header)
    );
    const dependencyIndexes = headers.flatMap((header, index) =>
      header.includes("depends") || header.includes("dispatch condition")
        ? [index]
        : []
    );
    const claimsActive = headers[briefIndex]?.includes("active") === true;

    for (const row of table.rows) {
      const rawKey = plainCell(row.cells[keyIndex] ?? "").toUpperCase();
      if (!/^\d+[A-Z]$/.test(rawKey)) continue;
      const pathValues = briefCellPaths(row.cells[briefIndex] ?? "");
      if (pathValues.length !== 1) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-readme-table",
          "brief row " + rawKey + " names " + pathValues.length +
            " Markdown paths; exactly one is required",
          "Point the row at its one live brief file, using a relative link or code span.",
        ));
        continue;
      }
      const rawPath = pathValues[0] ?? "";
      const pathAbs = resolveRelativeTarget(programme.readme.abs, rawPath);
      if (pathAbs === undefined || !isWithin(programme.abs, pathAbs)) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-readme-table",
          "brief row " + rawKey + " escapes its programme with " + rawPath,
          "Point the row at a Markdown brief inside " + programme.rel + ".",
        ));
        continue;
      }
      if (!(await fileExists(pathAbs))) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-readme-table",
          "brief row " + rawKey + " points at missing file " + rawPath,
          "Update the row to the brief's live path, including _done/ after completion.",
        ));
      }
      const pathKey = briefKey(pathAbs);
      if (pathKey !== rawKey) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-brief-key",
          "row key " + rawKey + " disagrees with brief filename key " +
            (pathKey ?? "(none)"),
          "Make the row key and numbered brief filename use the same stable key.",
        ));
      }
      const previous = seenRowKeys.get(rawKey);
      if (previous !== undefined) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-brief-key",
          "brief key " + rawKey + " repeats its row from line " + previous,
          "Keep exactly one README row for each stable brief key.",
        ));
      } else {
        seenRowKeys.set(rawKey, row.line);
      }
      const done = relative(programme.abs, pathAbs).split("/").includes(
        "_done",
      );
      const state = stateIndex < 0
        ? ""
        : plainCell(row.cells[stateIndex] ?? "").toLowerCase();
      if (
        (claimsActive && done) ||
        (done && /\b(active|pending|planned)\b/.test(state)) ||
        (!done && /\b(complete|completed|done|landed|published)\b/.test(state))
      ) {
        findings.push(finding(
          programme.readme.rel,
          row.line,
          "planning-state",
          "brief " + rawKey + " is " + (done ? "under _done/" : "active") +
            " but its README row claims the opposite state",
          "Derive completion from the live path: active briefs stay outside _done/ and completed briefs point inside it.",
        ));
      }
      for (const dependencyIndex of dependencyIndexes) {
        const rawDependencyCell = row.cells[dependencyIndex] ?? "";
        const cell = plainCell(rawDependencyCell);
        const linkedDependencyKeys = new Set(
          briefCellPaths(rawDependencyCell).flatMap((path) => {
            const target = resolveRelativeTarget(programme.readme.abs, path);
            const key = target === undefined ? undefined : briefKey(target);
            return key === undefined ? [] : [key];
          }),
        );
        for (const match of cell.matchAll(/\b(\d+[A-Z])\b/g)) {
          const dependency = match[1];
          if (
            dependency !== undefined && !knownKeys.has(dependency) &&
            !linkedDependencyKeys.has(dependency)
          ) {
            findings.push(finding(
              programme.readme.rel,
              row.line,
              "planning-dependency",
              "brief " + rawKey + " depends on unknown local key " + dependency,
              "Correct the dependency key or name and link the external programme explicitly.",
            ));
          }
        }
      }
      rows.push({
        key: rawKey,
        pathAbs,
        pathRaw: rawPath,
        done,
        line: row.line,
      });
    }
  }

  for (const file of files) {
    const matching = rows.filter((row) => row.pathAbs === file.source.abs);
    if (matching.length === 0) {
      findings.push(finding(
        programme.readme.rel,
        1,
        "planning-readme-table",
        "numbered brief " + relative(programme.abs, file.source.abs) +
          " has no README row",
        "Add one keyed brief row that points at the file's live active or _done/ path.",
      ));
    } else if (matching.length > 1) {
      findings.push(finding(
        programme.readme.rel,
        matching[1]?.line ?? 1,
        "planning-readme-table",
        "numbered brief " + relative(programme.abs, file.source.abs) +
          " appears in multiple README rows",
        "Keep one README row per brief file.",
      ));
    }
  }
  return { findings, rows };
}

/** Find malformed and well-formed planned-output directives. */
async function plannedOutputs(
  programme: Programme,
): Promise<{
  findings: ProjectControlFinding[];
  outputs: PlannedOutput[];
}> {
  const findings: ProjectControlFinding[] = [];
  const outputs: PlannedOutput[] = [];
  const byTarget = new Map<string, PlannedOutput>();

  for (const source of programme.files) {
    const lines = source.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index] ?? "";
      if (!lineText.trim().startsWith("<!--")) continue;
      if (!lineText.includes("discern-planned-output")) continue;
      const match = lineText.match(
        /^\s*<!--\s*discern-planned-output:\s+([^\s<>]+)\s*-->\s*$/,
      );
      if (match === null) {
        findings.push(finding(
          source.rel,
          index + 1,
          "planned-output",
          "malformed discern-planned-output declaration",
          "Use exactly <!-- discern-planned-output: relative/path.md --> beside the one link it excuses.",
        ));
        outputs.push({
          source,
          line: index + 1,
          rawPath: "",
          targetAbs: undefined,
          valid: false,
          referenced: false,
        });
        continue;
      }
      const rawPath = match[1] ?? "";
      const targetAbs = resolveRelativeTarget(source.abs, rawPath);
      if (
        targetAbs === undefined || rawPath.includes("#") ||
        rawPath.includes("?") || !isWithin(programme.abs, targetAbs)
      ) {
        findings.push(finding(
          source.rel,
          index + 1,
          "planned-output",
          "planned output " + rawPath + " does not resolve inside " +
            programme.rel,
          "Use a fragment-free relative path whose resolved target stays inside this programme.",
        ));
        outputs.push({
          source,
          line: index + 1,
          rawPath,
          targetAbs,
          valid: false,
          referenced: false,
        });
        continue;
      }
      const output: PlannedOutput = {
        source,
        line: index + 1,
        rawPath,
        targetAbs,
        valid: true,
        referenced: false,
      };
      const prior = byTarget.get(targetAbs);
      if (prior !== undefined) {
        findings.push(finding(
          source.rel,
          index + 1,
          "planned-output",
          "planned output " + rawPath + " duplicates " + prior.source.rel +
            ":" + prior.line,
          "Keep one declaration beside the one future-output link.",
        ));
        output.valid = false;
      } else {
        byTarget.set(targetAbs, output);
      }
      if (await targetExists(targetAbs)) {
        findings.push(finding(
          source.rel,
          index + 1,
          "planned-output",
          "planned output " + rawPath + " is stale because the target exists",
          "Remove the declaration now that the ordinary link can resolve.",
        ));
        output.valid = false;
      }
      outputs.push(output);
    }
  }
  return { findings, outputs };
}

/** Validate every relative programme link and bind planned-output exceptions. */
async function checkPlanningLinks(
  root: string,
  programme: Programme,
  outputs: PlannedOutput[],
): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  const anchorCache = new Map<string, Set<string>>();
  /** Read and cache the renderer-owned heading ids for one Markdown target. */
  async function anchors(path: string): Promise<Set<string>> {
    const cached = anchorCache.get(path);
    if (cached !== undefined) return cached;
    const value = headingAnchors(await Deno.readTextFile(path));
    anchorCache.set(path, value);
    return value;
  }

  for (const source of programme.files) {
    for (const link of extractDocLinks(source.text)) {
      if (isExternalTarget(link.target)) continue;
      const parts = targetParts(link.target);
      const targetAbs = parts.path === ""
        ? source.abs
        : resolveRelativeTarget(source.abs, parts.path);
      if (targetAbs === undefined || !isWithin(root, targetAbs)) {
        findings.push(finding(
          source.rel,
          link.line,
          "planning-link",
          "relative link " + link.target +
            " does not resolve inside the checkout",
          "Correct or remove the link; planned outputs must remain inside their programme.",
        ));
        continue;
      }
      if (!(await targetExists(targetAbs))) {
        const declaration = outputs.find((output) =>
          output.valid && output.targetAbs === targetAbs &&
          output.source.abs === source.abs &&
          Math.abs(output.line - link.line) <= 1
        );
        if (declaration !== undefined) {
          declaration.referenced = true;
          continue;
        }
        findings.push(finding(
          source.rel,
          link.line,
          "planning-link",
          "relative link " + link.target + " has no target",
          "Restore or repoint the target, or put one valid discern-planned-output declaration directly beside an intentionally future link.",
        ));
        continue;
      }
      if (parts.fragment === "") continue;
      let markdownTarget: string | undefined;
      if (targetAbs.toLowerCase().endsWith(".md")) {
        markdownTarget = targetAbs;
      } else if (await directoryExists(targetAbs)) {
        const readme = join(targetAbs, "README.md");
        if (await fileExists(readme)) markdownTarget = readme;
      }
      if (
        markdownTarget !== undefined &&
        !(await anchors(markdownTarget)).has(parts.fragment)
      ) {
        findings.push(finding(
          source.rel,
          link.line,
          "planning-anchor",
          "relative link " + link.target + " names no rendered heading anchor",
          "Use a live heading fragment from the target page or restore that heading.",
        ));
      }
    }
  }
  for (const output of outputs) {
    if (output.valid && !output.referenced) {
      findings.push(finding(
        output.source.rel,
        output.line,
        "planned-output",
        "planned output " + output.rawPath +
          " is not beside a link to that absent target",
        "Move the declaration directly beside its one link or remove the unused declaration.",
      ));
    }
  }
  return findings;
}

/** Active briefs must carry one stable literal worktree name. */
function checkActiveBriefs(
  programme: Programme,
  files: readonly BriefFile[],
): ProjectControlFinding[] {
  const findings: ProjectControlFinding[] = [];
  const worktrees = new Map<string, BriefFile>();
  const activeKeys = new Map<string, BriefFile>();
  const transientPatterns: readonly RegExp[] = [
    /\b(?:the\s+)?in-flight\s+\d+[A-Z]\b/i,
    /\b\d+[A-Z](?:\s*(?:,|and)\s*\d+[A-Z])*\s+may still be in flight\b/i,
    /\bagent\/[a-z0-9][a-z0-9-]*-[0-9a-f]{6}\b/i,
    /\b(?:currently|right now)\s+(?:green|dirty|ahead|behind|in flight)\b/i,
  ];

  for (const file of files.filter((candidate) => !candidate.done)) {
    const priorKey = activeKeys.get(file.key);
    if (priorKey !== undefined) {
      findings.push(finding(
        file.source.rel,
        1,
        "planning-brief-key",
        "active key " + file.key + " duplicates " + priorKey.source.rel,
        "Give each active brief in a programme one unique stable key.",
      ));
    } else {
      activeKeys.set(file.key, file);
    }

    const candidates = new Set<string>();
    const lines = file.source.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (/worktree|discern_start|name\s*:/i.test(line)) {
        for (
          const match of line.matchAll(
            /\b([a-z][a-z0-9-]*-\d+[a-z])\b/gi,
          )
        ) {
          const value = match[1]?.toLowerCase();
          if (
            value !== undefined && value.endsWith("-" + file.key.toLowerCase())
          ) {
            candidates.add(value);
          }
        }
      }
      if (transientPatterns.some((pattern) => pattern.test(line))) {
        findings.push(finding(
          file.source.rel,
          index + 1,
          "planning-transient-state",
          "active brief records transient branch or fleet state",
          "State the scheduling contract, then require discern_status and a live overlap/dependency check at dispatch.",
        ));
      }
    }
    if (candidates.size !== 1) {
      findings.push(finding(
        file.source.rel,
        1,
        "planning-worktree",
        "active brief " + file.key + " declares " + candidates.size +
          " matching literal worktree names",
        "Name exactly one literal worktree ending -" +
          file.key.toLowerCase() + " in the brief's dispatch instructions.",
      ));
      continue;
    }
    const name = [...candidates][0] ?? "";
    const prior = worktrees.get(name);
    if (prior !== undefined) {
      findings.push(finding(
        file.source.rel,
        1,
        "planning-worktree",
        "literal worktree " + name + " is also declared by " + prior.source.rel,
        "Give every active brief a globally unique literal worktree name.",
      ));
    } else {
      worktrees.set(name, file);
    }
  }

  for (
    const source of programme.files.filter((candidate) =>
      candidate.abs === programme.readme.abs
    )
  ) {
    const lines = source.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (transientPatterns.some((pattern) => pattern.test(line))) {
        findings.push(finding(
          source.rel,
          index + 1,
          "planning-transient-state",
          "programme README records transient branch or fleet state",
          "Keep only durable ordering here; require discern_status and live overlap checks at dispatch.",
        ));
      }
    }
  }
  return findings;
}

/** Check every present private planning programme. */
async function checkPlanning(root: string): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  for (const programme of await discoverProgrammes(root)) {
    const files = briefFiles(programme);
    const declarations = await plannedOutputs(programme);
    findings.push(...declarations.findings);
    findings.push(
      ...await checkPlanningLinks(root, programme, declarations.outputs),
    );
    const tables = await checkReadmeTables(programme, files);
    findings.push(...tables.findings);
    findings.push(...checkActiveBriefs(programme, files));
  }
  return findings;
}

/** Run every repository control-document check, read-only. */
export async function checkProjectControls(
  root: string,
): Promise<ProjectControlFinding[]> {
  const findings = await checkPlanning(resolve(root));
  return findings.sort((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line ||
    a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail)
  );
}

/** Print actionable diagnostics; a clean run is deliberately silent. */
async function main(root: string = Deno.cwd()): Promise<number> {
  const findings = await checkProjectControls(root);
  for (const item of findings) {
    console.error(
      item.file + ":" + item.line + " [" + item.rule + "] " + item.detail +
        ". Repair: " + item.repair,
    );
  }
  return findings.length === 0 ? 0 : 1;
}

if (import.meta.main) Deno.exit(await main());
