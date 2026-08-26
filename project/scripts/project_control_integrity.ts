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
import { structuralGuardScope } from "../../tests/structural_guard_scope.ts";

const PLANNING_REL = "project/map/_private/planning";
const TODO_REL = "project/TODO.md";
const SCOPES_REL = "project/map/_internal/scopes";
const PAGE_TEMPLATES_REL = "project/map/_internal/page-templates.md";
const DOCUMENTER_BRIEF_REL = "project/map/_internal/documenter-agent-brief.md";

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
  "todo-shape",
  "todo-title",
  "todo-description",
  "todo-evidence",
  "todo-link",
  "todo-session-wording",
  "scope-manifest",
  "scope-member",
  "scope-exclusion",
  "budget-authority",
  "budget-copy",
  "page-shape",
  "budget-exception",
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
  readonly line: number;
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

interface PageShapeAuthority {
  readonly names: ReadonlySet<string>;
  readonly anchors: ReadonlyMap<string, string>;
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
    tables.push({ headers, rows, line: index + 1 });
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

/** Whether a table belongs to one exact level-two Markdown section. */
function tableInSection(
  text: string,
  table: MarkdownTable,
  heading: string,
): boolean {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## " + heading);
  if (start < 0 || table.line <= start + 1) return false;
  const nextHeading = lines.findIndex((line, index) =>
    index > start && /^##\s+/.test(line)
  );
  return nextHeading < 0 || table.line <= nextHeading;
}

/** Find the judgment-bearing inventory table in one scope document. */
function scopeFilesTable(text: string): MarkdownTable | undefined {
  return markdownTables(text).find((table) => {
    const headers = table.headers.map((header) =>
      plainCell(header).toLowerCase()
    );
    return tableInSection(text, table, "Files to produce") &&
      headers.includes("file") && headers.includes("topic");
  });
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

/** Remove an optional source location or heading from a repository path. */
function evidenceTarget(raw: string): string {
  const withoutFragment = raw.split("#", 1)[0] ?? raw;
  return withoutFragment.replace(/:\d+(?:-\d+)?$/, "");
}

/** Check links rendered inside one TODO item independently of its evidence. */
async function checkTodoLinks(
  root: string,
  todo: MarkdownSource,
  itemText: string,
  itemLine: number,
): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  for (const link of extractDocLinks(itemText)) {
    if (isExternalTarget(link.target)) continue;
    const parts = targetParts(link.target);
    const targetAbs = parts.path === ""
      ? todo.abs
      : resolveRelativeTarget(todo.abs, parts.path);
    if (
      targetAbs === undefined || !isWithin(root, targetAbs) ||
      !(await targetExists(targetAbs))
    ) {
      findings.push(finding(
        todo.rel,
        itemLine + link.line - 1,
        "todo-link",
        "TODO link " + link.target + " has no repository target",
        "Correct the repository-relative link or remove it from the item.",
      ));
      continue;
    }
    if (
      parts.fragment !== "" && targetAbs.toLowerCase().endsWith(".md") &&
      !(headingAnchors(await Deno.readTextFile(targetAbs))).has(parts.fragment)
    ) {
      findings.push(finding(
        todo.rel,
        itemLine + link.line - 1,
        "todo-link",
        "TODO link " + link.target + " names no rendered heading anchor",
        "Use a live heading fragment or remove the stale fragment.",
      ));
    }
  }
  return findings;
}

/** Validate the tidy-stable, pickup-able shape of every TODO item. */
async function checkTodo(root: string): Promise<ProjectControlFinding[]> {
  const path = join(root, TODO_REL);
  if (!(await fileExists(path))) return [];

  const findings: ProjectControlFinding[] = [];
  const text = await Deno.readTextFile(path);
  const lines = text.split("\n");
  const titleOwners = new Map<string, number>();
  const itemStart = /^- \[[^\]]*\]/;
  const sessionRelative =
    /\b(?:this|last|next|current)\s+(?:session|round|task|branch|worktree)\b|\bfor now\b/i;
  const todo: MarkdownSource = { abs: path, rel: TODO_REL, text };

  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index] ?? "";
    if (!itemStart.test(first)) continue;

    const continuationLines: string[] = [];
    for (let offset = 1; index + offset < lines.length; offset += 1) {
      const line = lines[index + offset] ?? "";
      if (!/^(?: {2,}|\t)\S/.test(line)) break;
      continuationLines.push(line);
    }
    const lineNumber = index + 1;
    const itemText = [first, ...continuationLines].join("\n");
    const checkboxCount = [...itemText.matchAll(/\[[ xX]\]/g)].length;
    const itemMatch = first.match(
      /^- \[ \] \*\*(.+?)\*\* (.+?) Evidence: (.+)$/,
    );
    const titleMatch = first.match(/^- \[ \] \*\*(.+?)\*\*(?: |$)/);

    if (
      checkboxCount !== 1 || continuationLines.length !== 0 ||
      itemMatch === null
    ) {
      findings.push(finding(
        TODO_REL,
        lineNumber,
        "todo-shape",
        "TODO item is not one tidy-stable line with exactly one unchecked checkbox, bold title, description, and Evidence field",
        "Use - [ ] **Specific title.** Bounded standalone description. Evidence: `live/repository/path`.",
      ));
    }
    if (titleMatch === null) {
      findings.push(finding(
        TODO_REL,
        lineNumber,
        "todo-title",
        "TODO item is checked or its whole title is not bold",
        "Start it exactly as - [ ] **A unique, specific title.**; delete completed items instead of checking them.",
      ));
    } else {
      const title = titleMatch[1]?.trim() ?? "";
      if (title.length < 8 || title.length > 140 || !/[.!?]$/.test(title)) {
        findings.push(finding(
          TODO_REL,
          lineNumber,
          "todo-title",
          "TODO title must be 8–140 characters and end with sentence punctuation",
          "Give the item a short, specific, sentence-shaped bold title.",
        ));
      }
      const normalized = title.toLowerCase().replace(/\s+/g, " ");
      const priorLine = titleOwners.get(normalized);
      if (priorLine !== undefined) {
        findings.push(finding(
          TODO_REL,
          lineNumber,
          "todo-title",
          "TODO title duplicates line " + priorLine,
          "Merge the facts into one item or give distinct work distinct titles.",
        ));
      } else if (title !== "") {
        titleOwners.set(normalized, lineNumber);
      }
    }

    const description = itemMatch?.[2]?.trim() ?? "";
    if (
      description.length < 30 || description.length > 600 ||
      !/[.!?]$/.test(description)
    ) {
      findings.push(finding(
        TODO_REL,
        lineNumber,
        "todo-description",
        "TODO description is not one standalone 30–600 character sentence",
        "Put one bounded, pickup-able description between the bold title and Evidence field, ending with punctuation.",
      ));
    }

    const evidence = itemMatch?.[3]?.trim() ?? "";
    if (evidence === "") {
      findings.push(finding(
        TODO_REL,
        lineNumber,
        "todo-evidence",
        "TODO item has no terminal Evidence field",
        "Add repository paths in code spans, or use Evidence: Owner-only: followed by one concrete external fact.",
      ));
    } else {
      const ownerOnly = evidence.match(/^Owner-only: (.{20,240}[.!?])$/);
      const codePaths = [...evidence.matchAll(/`([^`\n]+)`/g)].flatMap(
        (match) => match[1] === undefined ? [] : [match[1]],
      );
      if (ownerOnly === null && codePaths.length === 0) {
        findings.push(finding(
          TODO_REL,
          lineNumber,
          "todo-evidence",
          "TODO evidence declares neither a repository path nor the Owner-only form",
          "Name at least one live repository-relative path in backticks, or declare a concrete Owner-only fact.",
        ));
      }
      if (ownerOnly !== null && codePaths.length > 0) {
        findings.push(finding(
          TODO_REL,
          lineNumber,
          "todo-evidence",
          "Owner-only evidence is mixed with repository paths",
          "Use repository evidence when it exists; reserve Owner-only for work with no checkout artifact.",
        ));
      }
      for (const rawPath of codePaths) {
        const relativePath = evidenceTarget(rawPath);
        const target = resolve(root, relativePath);
        if (
          relativePath === "" || isAbsolute(relativePath) ||
          relativePath.includes("\\") || relativePath.includes("?") ||
          !isWithin(root, target) || !(await targetExists(target))
        ) {
          findings.push(finding(
            TODO_REL,
            lineNumber,
            "todo-evidence",
            "TODO evidence path " + rawPath + " has no live repository target",
            "Use a live repository-relative file or directory, with only an optional :line or #heading suffix.",
          ));
        }
      }
    }

    if (sessionRelative.test(itemText)) {
      findings.push(finding(
        TODO_REL,
        lineNumber,
        "todo-session-wording",
        "TODO item depends on session-relative wording",
        "State the durable condition and pickup point without referring to a session, round, task, branch, or worktree.",
      ));
    }
    findings.push(...await checkTodoLinks(root, todo, itemText, lineNumber));
  }
  return findings;
}

/** Parse one code-wrapped Markdown path from a manifest cell. */
function scopePath(cell: string): string | undefined {
  return cell.trim().match(/^`([^`]+\.md)`$/)?.[1];
}

/** Validate one scope manifest against every live Markdown leaf it owns. */
async function checkScopeManifest(
  root: string,
  manifest: MarkdownSource,
): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  const subtreeName = basename(manifest.abs, ".md");
  const subtree = join(root, "project/map", subtreeName);
  if (!/^\d{2}-[a-z0-9-]+$/.test(subtreeName)) {
    return [finding(
      manifest.rel,
      1,
      "scope-manifest",
      "scope manifest name " + basename(manifest.abs) +
        " does not identify a numbered Map subtree",
      "Name the manifest <NN-subtree>.md or remove it from the live scopes directory.",
    )];
  }
  if (!(await directoryExists(subtree))) {
    return [finding(
      manifest.rel,
      1,
      "scope-manifest",
      "scope manifest points at missing subtree project/map/" + subtreeName,
      "Restore the numbered subtree or remove its stale scope manifest.",
    )];
  }

  const tables = markdownTables(manifest.text);
  const filesTable = scopeFilesTable(manifest.text);
  if (filesTable === undefined) {
    return [finding(
      manifest.rel,
      1,
      "scope-manifest",
      "scope manifest has no Files to produce table with File and Topic columns",
      "Restore the hand-authored inventory table under Files to produce.",
    )];
  }

  const fileIndex = filesTable.headers.findIndex((header) =>
    plainCell(header).toLowerCase() === "file"
  );
  const topicIndex = filesTable.headers.findIndex((header) =>
    plainCell(header).toLowerCase() === "topic"
  );
  const members = new Map<string, number>();
  for (const row of filesTable.rows) {
    const rawCell = row.cells[fileIndex] ?? "";
    const path = scopePath(rawCell);
    const topic = plainCell(row.cells[topicIndex] ?? "");
    if (path === undefined) {
      findings.push(finding(
        manifest.rel,
        row.line,
        "scope-manifest",
        "Files to produce row has no single code-wrapped Markdown path",
        "Put one subtree-relative .md path in backticks in the File cell.",
      ));
      continue;
    }
    const target = resolve(subtree, path);
    if (
      isAbsolute(path) || path.includes("\\") ||
      !isWithin(subtree, target)
    ) {
      findings.push(finding(
        manifest.rel,
        row.line,
        "scope-manifest",
        "scope member " + path + " escapes its numbered subtree",
        "Use a relative Markdown path contained by project/map/" +
          subtreeName + ".",
      ));
      continue;
    }
    const prior = members.get(path);
    if (prior !== undefined) {
      findings.push(finding(
        manifest.rel,
        row.line,
        "scope-manifest",
        "scope member " + path + " duplicates line " + prior,
        "Keep one inventory row per live Markdown leaf.",
      ));
    } else {
      members.set(path, row.line);
    }
    if (topic.length < 10) {
      findings.push(finding(
        manifest.rel,
        row.line,
        "scope-manifest",
        "scope member " + path + " has no substantive hand-authored topic",
        "Describe the page's topic and boundary in the Topic cell.",
      ));
    }
  }

  const exclusions = new Map<string, number>();
  const exclusionTable = tables.find((table) => {
    const headers = table.headers.map((header) =>
      plainCell(header).toLowerCase()
    );
    return tableInSection(manifest.text, table, "Declared exclusions") &&
      headers.includes("file") && headers.includes("reason");
  });
  if (exclusionTable !== undefined) {
    const exclusionFileIndex = exclusionTable.headers.findIndex((header) =>
      plainCell(header).toLowerCase() === "file"
    );
    const reasonIndex = exclusionTable.headers.findIndex((header) =>
      plainCell(header).toLowerCase() === "reason"
    );
    for (const row of exclusionTable.rows) {
      const path = scopePath(row.cells[exclusionFileIndex] ?? "");
      const reason = plainCell(row.cells[reasonIndex] ?? "");
      if (path === undefined || reason.length < 15) {
        findings.push(finding(
          manifest.rel,
          row.line,
          "scope-exclusion",
          "scope exclusion needs one code-wrapped Markdown path and a substantive reason",
          "Name one live subtree-relative .md file and explain why the refresh scope excludes it.",
        ));
        continue;
      }
      const target = resolve(subtree, path);
      if (
        isAbsolute(path) || path.includes("\\") ||
        !isWithin(subtree, target) || exclusions.has(path) || members.has(path)
      ) {
        findings.push(finding(
          manifest.rel,
          row.line,
          "scope-exclusion",
          "scope exclusion " + path +
            " is duplicate, already enrolled, or escapes its subtree",
          "Keep one exclusion row for one contained live leaf that is absent from Files to produce.",
        ));
        continue;
      }
      exclusions.set(path, row.line);
    }
  }

  const live = new Set(
    (await markdownPaths(subtree)).map((path) => relative(subtree, path)),
  );
  if (!members.has("README.md")) {
    findings.push(finding(
      manifest.rel,
      1,
      "scope-member",
      "live subtree README.md is not explicitly enrolled",
      "Add README.md as an ordinary Files to produce row; it cannot be excluded.",
    ));
  }
  if (exclusions.has("README.md")) {
    findings.push(finding(
      manifest.rel,
      exclusions.get("README.md") ?? 1,
      "scope-exclusion",
      "README.md cannot be excluded from a subtree refresh inventory",
      "Move README.md into Files to produce and describe its overview purpose.",
    ));
  }

  for (const [path, line] of [...members, ...exclusions]) {
    if (!live.has(path)) {
      findings.push(finding(
        manifest.rel,
        line,
        path === "README.md" || members.has(path)
          ? "scope-member"
          : "scope-exclusion",
        "scope row " + path + " is stale because the leaf is absent",
        "Remove the stale row or restore the Markdown leaf it deliberately inventories.",
      ));
    }
  }
  for (const path of live) {
    if (!members.has(path) && !exclusions.has(path)) {
      findings.push(finding(
        manifest.rel,
        1,
        "scope-member",
        "live leaf " + path + " is not enrolled or declared excluded",
        "Add it to Files to produce, or add a Declared exclusions row with a durable reason.",
      ));
    }
  }
  return findings;
}

/** Check every present documenter scope manifest. */
async function checkScopes(root: string): Promise<ProjectControlFinding[]> {
  const scopes = join(root, SCOPES_REL);
  if (!(await directoryExists(scopes))) return [];
  const findings: ProjectControlFinding[] = [];
  for (const path of await markdownPaths(scopes)) {
    if (basename(path) === "_template.md") continue;
    findings.push(
      ...await checkScopeManifest(root, {
        abs: path,
        rel: relative(root, path),
        text: await Deno.readTextFile(path),
      }),
    );
  }
  return findings;
}

/** Parse the sole page-shape and default-budget authority. */
async function pageShapeAuthority(
  root: string,
): Promise<{
  authority: PageShapeAuthority | undefined;
  findings: ProjectControlFinding[];
}> {
  const path = join(root, PAGE_TEMPLATES_REL);
  if (!(await fileExists(path))) return { authority: undefined, findings: [] };

  const findings: ProjectControlFinding[] = [];
  const text = await Deno.readTextFile(path);
  const lines = text.split("\n");
  const names = new Set<string>();
  const anchors = new Map<string, string>();
  const boundBudgets = new Set<number>();
  const budgetLine =
    /^Default budget: (?:\d[\d,]*[–-]\d[\d,]* words|unbudgeted; keep it scannable)\.$/;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes("discern-page-shape")) continue;
    const match = line.match(
      /^<!-- discern-page-shape: ([a-z][a-z0-9-]*) -->$/,
    );
    if (match === null) {
      findings.push(finding(
        PAGE_TEMPLATES_REL,
        index + 1,
        "budget-authority",
        "malformed discern-page-shape declaration",
        "Use exactly <!-- discern-page-shape: stable-name --> directly before its budgeted level-two heading.",
      ));
      continue;
    }
    const name = match[1] ?? "";
    let headingIndex = index + 1;
    while (
      headingIndex < lines.length &&
      (lines[headingIndex] ?? "").trim() === ""
    ) headingIndex += 1;
    const heading = lines[headingIndex] ?? "";
    let budgetIndex = headingIndex + 1;
    while (
      budgetIndex < lines.length &&
      (lines[budgetIndex] ?? "").trim() === ""
    ) budgetIndex += 1;
    if (!/^## .+/.test(heading) || !budgetLine.test(lines[budgetIndex] ?? "")) {
      findings.push(finding(
        PAGE_TEMPLATES_REL,
        index + 1,
        "budget-authority",
        "page shape " + name +
          " is not followed by one heading and one Default budget line",
        "Put the declaration before a stable level-two heading, then state one numeric word range or the unbudgeted marker on the next content line.",
      ));
    } else {
      boundBudgets.add(budgetIndex);
      const anchor = [...headingAnchors(heading)][0];
      if (anchor === undefined) {
        findings.push(finding(
          PAGE_TEMPLATES_REL,
          headingIndex + 1,
          "budget-authority",
          "page shape " + name + " has no renderer-derived heading anchor",
          "Give the shape a nonempty stable level-two heading.",
        ));
      } else if (!anchors.has(name)) {
        anchors.set(name, anchor);
      }
    }
    if (names.has(name)) {
      findings.push(finding(
        PAGE_TEMPLATES_REL,
        index + 1,
        "budget-authority",
        "page shape " + name + " is declared more than once",
        "Keep one declaration and one budget-bearing heading per page shape.",
      ));
    }
    names.add(name);
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (budgetLine.test(lines[index] ?? "") && !boundBudgets.has(index)) {
      findings.push(finding(
        PAGE_TEMPLATES_REL,
        index + 1,
        "budget-authority",
        "Default budget line has no discern-page-shape declaration",
        "Bind the budget to one stable shape declaration and level-two heading.",
      ));
    }
  }
  if (names.size === 0) {
    findings.push(finding(
      PAGE_TEMPLATES_REL,
      1,
      "budget-authority",
      "page template authority declares no page shapes",
      "Declare each supported shape beside its one default budget.",
    ));
  }
  return {
    authority: {
      names,
      anchors,
    },
    findings,
  };
}

/** Reject copied default budgets outside the authority document. */
async function checkBudgetCopies(
  root: string,
): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  const paths = await structuralGuardScope({
    guard:
      "project/scripts/project_control_integrity.ts#documenter-budget-consumers",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "Default budget copies are forbidden in the documenter brief and every scope-control document.",
      include: (rel) =>
        rel === DOCUMENTER_BRIEF_REL || rel.startsWith(SCOPES_REL + "/"),
    },
  }, root);
  const sources = await Promise.all(paths.map(async (rel) => {
    const abs = join(root, rel);
    return { abs, rel, text: await Deno.readTextFile(abs) };
  }));
  const range = /\b\d[\d,]*\s*[–-]\s*\d[\d,]*[-\s]+words?\b/i;
  for (const source of sources) {
    const isManifest = source.rel.startsWith(SCOPES_REL + "/") &&
      basename(source.abs) !== "_template.md";
    const lines = source.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const exception = isManifest &&
        /^<!-- discern-page-budget-exception: .+ -->$/.test(line);
      if (range.test(line) && !exception) {
        findings.push(finding(
          source.rel,
          index + 1,
          "budget-copy",
          "numeric page budget is copied outside " + PAGE_TEMPLATES_REL,
          isManifest
            ? "Select the declared page shape, or use one valid file-scoped budget-exception declaration for a genuine local exception."
            : "Link the selected page shape in page-templates.md instead of restating its numbers.",
        ));
      }
    }
  }
  return findings;
}

/** Validate page-shape links and explicit numeric exceptions in one manifest. */
async function checkManifestBudgets(
  root: string,
  manifest: MarkdownSource,
  authority: PageShapeAuthority,
): Promise<ProjectControlFinding[]> {
  const findings: ProjectControlFinding[] = [];
  const table = scopeFilesTable(manifest.text);
  if (table === undefined) return findings;
  const headers = table.headers.map((header) =>
    plainCell(header).toLowerCase()
  );
  const fileIndex = headers.indexOf("file");
  const shapeIndex = headers.indexOf("shape");
  const members = new Set<string>();
  const isTemplate = basename(manifest.abs) === "_template.md";
  if (shapeIndex < 0) {
    findings.push(finding(
      manifest.rel,
      table.line,
      "page-shape",
      "Files to produce table has no Shape column",
      "Add Shape and link every row to one declared page shape in ../page-templates.md.",
    ));
    return findings;
  }
  for (const row of table.rows) {
    const path = scopePath(row.cells[fileIndex] ?? "");
    if (path !== undefined) members.add(path);
    const cell = row.cells[shapeIndex] ?? "";
    const shapeLink = cell.match(
      /^\[([a-z][a-z0-9-]*)\]\(\.\.\/page-templates\.md#([^)]+)\)$/,
    );
    const shape = plainCell(cell).toLowerCase();
    const linked = shapeLink !== null && shapeLink[1] === shape &&
      authority.anchors.get(shape) === shapeLink[2];
    const declared = cell.trim() === shape;
    if (
      !authority.names.has(shape) ||
      (isTemplate ? !linked : !linked && !declared)
    ) {
      findings.push(finding(
        manifest.rel,
        row.line,
        "page-shape",
        "scope member " + (path ?? plainCell(row.cells[fileIndex] ?? "")) +
          " names unknown or unlinked page shape " + (shape || "<empty>"),
        isTemplate
          ? "Link one shape declared in ../page-templates.md from the Shape cell."
          : "Name one shape declared in ../page-templates.md, or link that declaration.",
      ));
    }
  }

  if (isTemplate) return findings;
  const subtree = join(root, "project/map", basename(manifest.abs, ".md"));
  const seen = new Set<string>();
  const lines = manifest.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes("discern-page-budget-exception")) continue;
    const match = line.match(
      /^<!-- discern-page-budget-exception: ([^|<>]+\.md) \| (\d[\d,]*)[–-](\d[\d,]*) words \| (.{15,}) -->$/,
    );
    if (match === null) {
      findings.push(finding(
        manifest.rel,
        index + 1,
        "budget-exception",
        "malformed discern-page-budget-exception declaration",
        "Use exactly <!-- discern-page-budget-exception: file.md | lower–upper words | durable reason -->.",
      ));
      continue;
    }
    const path = match[1] ?? "";
    const lower = Number((match[2] ?? "").replaceAll(",", ""));
    const upper = Number((match[3] ?? "").replaceAll(",", ""));
    const target = resolve(subtree, path);
    if (
      lower < 1 || upper < lower || isAbsolute(path) ||
      !isWithin(subtree, target) || !(await fileExists(target)) ||
      !members.has(path) || seen.has(path)
    ) {
      findings.push(finding(
        manifest.rel,
        index + 1,
        "budget-exception",
        "budget exception for " + path +
          " has an invalid range, duplicate, stale target, or unenrolled member",
        "Declare one increasing positive range for one live Files to produce member.",
      ));
    }
    seen.add(path);
  }
  return findings;
}

/** Validate each default shape selected by the shared documenter brief. */
async function checkDocumenterShapeUses(
  root: string,
  authority: PageShapeAuthority,
): Promise<ProjectControlFinding[]> {
  const path = join(root, DOCUMENTER_BRIEF_REL);
  if (!(await fileExists(path))) return [];
  const findings: ProjectControlFinding[] = [];
  const lines = (await Deno.readTextFile(path)).split("\n");
  const subjects = new Map<string, number>();
  let declarations = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.includes("discern-page-shape-use")) continue;
    declarations += 1;
    const match = line.match(
      /^<!-- discern-page-shape-use: ([^|<>]{2,80}) \| ([a-z][a-z0-9-]*) -->$/,
    );
    if (match === null) {
      findings.push(finding(
        DOCUMENTER_BRIEF_REL,
        index + 1,
        "page-shape",
        "malformed discern-page-shape-use declaration",
        "Use exactly <!-- discern-page-shape-use: page role | declared-shape --> directly before its linked instruction.",
      ));
      continue;
    }
    const subject = match[1]?.trim() ?? "";
    const shape = match[2] ?? "";
    let instructionIndex = index + 1;
    while (
      instructionIndex < lines.length &&
      (lines[instructionIndex] ?? "").trim() === ""
    ) instructionIndex += 1;
    const instruction = lines[instructionIndex] ?? "";
    const expectedAnchor = authority.anchors.get(shape);
    const expectedLink = expectedAnchor === undefined
      ? ""
      : "(page-templates.md#" + expectedAnchor + ")";
    const expectedLinkedShape = "[" + shape + " shape]" + expectedLink;
    const prior = subjects.get(subject.toLowerCase());
    if (
      !authority.names.has(shape) || expectedAnchor === undefined ||
      !instruction.includes(expectedLinkedShape) || prior !== undefined
    ) {
      findings.push(finding(
        DOCUMENTER_BRIEF_REL,
        index + 1,
        "page-shape",
        "documenter role " + subject +
          " has an unknown, duplicate, or unlinked shape " + shape,
        "Declare each role once and link its selected page-templates.md heading in the immediately following instruction.",
      ));
    }
    if (prior === undefined) subjects.set(subject.toLowerCase(), index + 1);
  }
  if (declarations === 0) {
    findings.push(finding(
      DOCUMENTER_BRIEF_REL,
      1,
      "page-shape",
      "documenter brief declares no default page-shape uses",
      "Declare each default role and link its shape in page-templates.md instead of restating a budget.",
    ));
  }
  return findings;
}

/** Check the single page-budget authority and every consumer. */
async function checkBudgets(root: string): Promise<ProjectControlFinding[]> {
  const scopes = join(root, SCOPES_REL);
  const manifests = await directoryExists(scopes)
    ? await markdownSources(root, scopes)
    : [];
  const parsed = await pageShapeAuthority(root);
  const hasConsumers = manifests.length > 0 ||
    await fileExists(join(root, DOCUMENTER_BRIEF_REL));
  if (parsed.authority === undefined) {
    return hasConsumers
      ? [finding(
        PAGE_TEMPLATES_REL,
        1,
        "budget-authority",
        "documenter controls exist without their page-template authority",
        "Restore page-templates.md with one declared budget per supported shape.",
      )]
      : [];
  }
  const findings = [...parsed.findings];
  findings.push(...await checkBudgetCopies(root));
  findings.push(...await checkDocumenterShapeUses(root, parsed.authority));
  for (const manifest of manifests) {
    findings.push(
      ...await checkManifestBudgets(
        root,
        manifest,
        parsed.authority,
      ),
    );
  }
  return findings;
}

/** Run every repository control-document check, read-only. */
export async function checkProjectControls(
  root: string,
): Promise<ProjectControlFinding[]> {
  const resolvedRoot = resolve(root);
  const findings = [
    ...await checkPlanning(resolvedRoot),
    ...await checkTodo(resolvedRoot),
    ...await checkScopes(resolvedRoot),
    ...await checkBudgets(resolvedRoot),
  ];
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
