/**
 * `discern docs` and `discern help` — browse and read a documentation tree.
 *
 * The two verbs share every line of this file through a {@link DocsVerb}
 * descriptor (ADR 0039); only the tree they read differs: `docs` serves the
 * project's own `docs/` (resolved from the project root), `help` serves
 * discern's OWN documentation, bundled into every install. Both serve two
 * audiences, decided by how the verb is invoked:
 *
 *  - **A human at a terminal** gets an interactive, searchable picker (Cliffy's
 *    `Select`, with type-to-filter) and a rendered, paged view of whatever they
 *    pick. The tree is growing, so search is the primary way in.
 *  - **An agent or a script** gets non-interactive surfaces it can consume: a
 *    target to render straight to stdout, `--raw` for the pristine Markdown
 *    source, `--json` for a machine-readable index (or a single doc's record),
 *    `--list` for a plain table of contents, and `--export` for one concatenated
 *    Markdown stream. It never blocks on a prompt when stdin/stdout are not a
 *    TTY.
 *
 * Rendering is handled by {@link renderMarkdown}; discovery and resolution by
 * {@link discoverDocs} / {@link resolveDoc}. This file is the glue: argument
 * dispatch, the interactive loop, and the pager.
 */

import { Checkbox, Select } from "@cliffy/prompt";
import { colors } from "@cliffy/ansi/colors";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { colourEnabled, Logger } from "../lib/log.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import {
  discoverDocs,
  type DocEntry,
  type DocsTree,
  filterDocsByGroups,
  formatDocsExport,
  groupDocs,
  resolveDoc,
} from "../lib/docs.ts";
import {
  BUNDLED_INTERNAL_DOC_DIRS,
  resolveBundledDocsDir,
} from "../lib/paths.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { DocRecord, DocsData } from "../shared/result_schemas.ts";

/** Supported concatenated Markdown export scopes. */
type DocsExportScope = "public" | "all" | "select";

/**
 * How `discern docs` (the project's own `docs/` tree) and `discern help`
 * (discern's OWN bundled documentation) differ. Everything else — the
 * interactive browser, the renderer, target resolution, `--list`, `--json`, and
 * export — operates on a resolved {@link DocsTree} + {@link DocsOptions} and is
 * shared verbatim (ADR 0039). Only three things vary: which directory is read,
 * the verb label carried in results/messages, and the wording when the tree is
 * missing.
 */
interface DocsVerb {
  /** The label in every {@link DiscernResult} and user-facing message. */
  verb: "docs" | "help";
  /** Machine-stable error slug when the tree is absent (`no_docs` / `no_help`). */
  missingError: string;
  /**
   * Resolve the directory to hand {@link discoverDocs}. `docs` passes a user
   * `--dir` through (and `undefined` keeps discovery's project-root default);
   * `help` resolves discern's bundled tree and reports `missing` when a binary
   * was built without it (it must NEVER fall back to a project's `docs/`).
   */
  resolveDir(opts: { dir?: string | undefined }): Promise<DirResolution>;
  /** The human message when no tree is found (verb-specific wording). */
  missingTree(opts: { dir?: string | undefined }): string;
  /** Export scopes this verb accepts (`help` is public-only — no internal tree). */
  exportScopes: readonly DocsExportScope[];
}

/**
 * The outcome of a verb's directory resolution. `ok` with an `undefined` dir is
 * meaningful for `docs` (discovery falls back to `<project root>/docs`); `missing`
 * means the tree cannot be located at all and the shared core must not probe a
 * project root in its place.
 */
type DirResolution =
  | { kind: "ok"; dir: string | undefined }
  | { kind: "missing" };

/** `discern docs` — the install's own project documentation tree. */
const DOCS_VERB: DocsVerb = {
  verb: "docs",
  missingError: "no_docs",
  resolveDir: (opts) => Promise.resolve({ kind: "ok", dir: opts.dir }),
  missingTree: (opts) =>
    opts.dir
      ? `no documentation directory at "${opts.dir}".`
      : "no docs/ directory here — run `discern setup` to seed one, or pass --dir <path>.",
  exportScopes: ["public", "all", "select"],
};

/** `discern help` — discern's OWN documentation, bundled into every install. */
const HELP_VERB: DocsVerb = {
  verb: "help",
  missingError: "no_help",
  resolveDir: async () => {
    const dir = await resolveBundledDocsDir();
    return dir ? { kind: "ok", dir } : { kind: "missing" };
  },
  missingTree: () =>
    "discern's bundled documentation is missing from this binary — this is a build defect; please report it.",
  exportScopes: ["public"],
};

/** Render an allowed-scope list for an error message ("public, all, or select"). */
function listScopes(scopes: readonly DocsExportScope[]): string {
  if (scopes.length <= 1) return scopes.join("");
  return `${scopes.slice(0, -1).join(", ")}, or ${scopes.at(-1) ?? ""}`;
}

/**
 * The internal-subtree policy for a browse. `help --adr` reveals the bundled ADR
 * tree — and ONLY that ({@link BUNDLED_INTERNAL_DOC_DIRS}), never `_internal` /
 * `_private`, and never over MCP (the `helpResult` path passes nothing).
 * Everything else stays public-only.
 */
function internalScope(
  desc: DocsVerb,
  options: DocsOptions,
): boolean | readonly string[] {
  return desc.verb === "help" && options.adr
    ? BUNDLED_INTERNAL_DOC_DIRS
    : false;
}

/** Options accepted by the `docs` command (global flags folded in). */
export interface DocsOptions {
  json: boolean;
  noColor: boolean;
  /** Print a doc's pristine Markdown source instead of rendering it. */
  raw: boolean;
  /** Print a plain table of contents and exit, even on a TTY. */
  list: boolean;
  /** Never page rendered output through `$PAGER`. */
  noPager: boolean;
  /** Override the docs directory (default `<project root>/docs`). */
  dir?: string | undefined;
  /** Override the wrap width (default: the terminal width, capped). */
  width?: number | undefined;
  /** A specific doc to open (slug, `section/slug`, or path). */
  target?: string | undefined;
  /** `help` only: also surface the bundled ADR subtree (hidden by default). */
  adr?: boolean | undefined;
  /** Concatenate docs to stdout or `output`. */
  export?: string | undefined;
  /** Write an export to this path instead of stdout. */
  output?: string | undefined;
}

/** The machine-readable record for one doc (sans content). */
function toRecord(e: DocEntry): DocRecord {
  return { path: e.path, section: e.section, slug: e.slug, title: e.title };
}

/** Path of `abs` relative to `cwd`, for display (falls back to `abs`). */
function display(abs: string, cwd: string): string {
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/** True when `candidate` is `root` itself or lexically nested beneath it. */
function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
}

/**
 * Resolve symlinks for an existing output, or for its existing parent when the
 * output is new. This prevents `--output` escaping the lexical safety check via
 * a symlinked file or directory.
 */
async function canonicalOutputPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    try {
      return resolve(await Deno.realPath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/** Parse an export scope against the verb's allowed set (no silent typos). */
function exportScope(
  value: string,
  allowed: readonly DocsExportScope[],
): DocsExportScope | undefined {
  return (allowed as readonly string[]).includes(value)
    ? value as DocsExportScope
    : undefined;
}

/** Report a command-usage failure in the active human/JSON presentation mode. */
function invalidOptions(log: Logger, verb: string, message: string): number {
  if (log.json) {
    log.result({
      ok: false,
      verb,
      error: "invalid_options",
      message,
    });
  } else {
    log.error(message);
  }
  return 1;
}

/** The terminal's column count, or undefined when stdout is not a TTY. */
function terminalColumns(): number | undefined {
  try {
    return Deno.consoleSize().columns;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the wrap width: an explicit `--width` wins; otherwise the terminal
 * width (or `$COLUMNS`), capped to a readable maximum with a small margin, and
 * falling back to 80 off a TTY.
 */
function resolveWidth(explicit: number | undefined): number {
  if (explicit && explicit > 0) return Math.floor(explicit);
  const env = Number(Deno.env.get("COLUMNS"));
  const cols = Number.isFinite(env) && env > 0 ? env : terminalColumns();
  if (!cols) return 80;
  return Math.max(40, Math.min(cols - 2, 100));
}

/**
 * Page `text` through the user's pager so long docs scroll (and keep ANSI
 * colour). Honours `$PAGER`, defaulting to `less -R`. Returns false if no pager
 * could be spawned, so the caller can fall back to a plain print.
 */
async function pageThrough(text: string): Promise<boolean> {
  const pager = Deno.env.get("PAGER")?.trim();
  const cmd = pager ? "sh" : "less";
  const args = pager ? ["-c", pager] : ["-R"];
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdin: "piped",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text + "\n"));
      await writer.close();
    } catch {
      // The pager exited before reading everything (e.g. the user pressed q on
      // a short doc) — a broken pipe here is expected, not an error.
    }
    await child.status;
    return true;
  } catch {
    return false;
  }
}

/** Show rendered text: paged on an interactive terminal, else straight to stdout. */
async function present(text: string, noPager: boolean): Promise<void> {
  if (!noPager && Deno.stdout.isTerminal()) {
    if (await pageThrough(text)) return;
  }
  console.log(text);
}

/** The picker label for a doc: its docs-relative path, then its title. */
function optionLabel(e: DocEntry, color: boolean): string {
  if (!color) return `${e.relToDocs}  —  ${e.title}`;
  return `${colors.cyan(e.relToDocs)}  ${colors.dim("· " + e.title)}`;
}

/** The interactive browse loop: pick a doc, view it, repeat until quit. */
async function browse(tree: DocsTree, options: DocsOptions): Promise<number> {
  const color = colourEnabled(options.noColor);
  const width = resolveWidth(options.width);
  const QUIT = "\x00quit";
  const choices = tree.entries.map((e) => ({
    name: optionLabel(e, color),
    value: e.path,
  }));
  let last: string | undefined;

  while (true) {
    let choice: string;
    try {
      choice = await Select.prompt({
        message: "Search docs (type to filter)",
        options: [
          ...choices,
          Select.separator(color ? colors.dim("─────") : "─────"),
          { name: color ? colors.dim("Quit") : "Quit", value: QUIT },
        ],
        search: true,
        info: true,
        maxRows: 14,
        ...(last !== undefined ? { default: last } : {}),
      });
    } catch {
      // Cancelled (Ctrl-C / Esc) — a clean exit, not an error.
      return 0;
    }
    if (choice === QUIT) return 0;
    last = choice;
    const entry = tree.entries.find((e) => e.path === choice);
    if (!entry) continue;
    const content = await Deno.readTextFile(entry.absPath);
    await present(renderMarkdown(content, { width, color }), options.noPager);
  }
}

/** Print a grouped, plain table of contents to stdout. */
function printToc(
  verb: string,
  tree: DocsTree,
  cwd: string,
  color: boolean,
): void {
  const paint = (fn: (s: string) => string, s: string) => color ? fn(s) : s;
  const labelOf = (e: DocEntry) =>
    e.section ? e.relToDocs.slice(e.section.length + 1) : e.relToDocs;
  const colWidth = Math.min(
    32,
    Math.max(...tree.entries.map((e) => labelOf(e).length)),
  );

  const lines: string[] = [
    `${paint(colors.bold, `discern ${verb}`)} — ${tree.entries.length} ` +
    `documents in ${display(tree.docsDir, cwd)}`,
  ];
  let section: string | null = null;
  for (const e of tree.entries) {
    if (e.section !== section) {
      section = e.section;
      lines.push("");
      lines.push(paint(colors.bold.cyan, (section || "(root)") + "/"));
    }
    const label = labelOf(e).padEnd(colWidth);
    lines.push(`  ${paint(colors.cyan, label)}  ${paint(colors.dim, e.title)}`);
  }
  console.log(lines.join("\n"));
}

/**
 * Concatenate a selected docs scope and emit it atomically from the command's
 * point of view: every source is read before stdout or the output file changes.
 */
async function exportDocs(
  desc: DocsVerb,
  options: DocsOptions,
  scope: DocsExportScope,
  log: Logger,
  cwd: string,
): Promise<number> {
  const resolved = await desc.resolveDir(options);
  const tree = resolved.kind === "missing" ? undefined : await discoverDocs({
    cwd,
    dir: resolved.dir,
    includeInternal: scope !== "public",
  });
  if (!tree) {
    log.error(desc.missingTree(options));
    return 1;
  }

  let outputPath: string | undefined;
  if (options.output) {
    outputPath = resolve(cwd, options.output);
    // The within-tree guard protects a project's editable docs/ from being
    // clobbered by its own export. `help`'s tree is discern's read-only bundled
    // documentation (a binary's embedded copy), so there is nothing to protect —
    // and probing it with realPath would be meaningless.
    if (desc.verb === "docs") {
      const docsDir = await Deno.realPath(tree.docsDir);
      const canonicalOutput = await canonicalOutputPath(outputPath);
      if (pathIsWithin(docsDir, canonicalOutput)) {
        log.error(
          `refusing to write an export inside ${
            display(tree.docsDir, cwd)
          }; choose a path outside the source documentation tree.`,
        );
        return 1;
      }
    }
  }

  let entries = tree.entries;
  if (scope === "select") {
    const groups = groupDocs(entries);
    if (groups.length === 0) {
      log.warn(`no Markdown files under ${display(tree.docsDir, cwd)}.`);
      return 0;
    }

    let selected: string[];
    try {
      selected = await Checkbox.prompt<string>({
        message: "Include documentation sections",
        options: groups.map((group) => ({
          name: `${group.name} (${group.entries.length})`,
          value: group.name,
          checked: !group.internal,
        })),
        minOptions: 1,
      });
    } catch {
      // Cancelled (Ctrl-C / Esc) — do not create or overwrite the output file.
      return 0;
    }

    entries = filterDocsByGroups(entries, selected);
  }

  let markdown: string;
  try {
    const sources = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        content: await Deno.readTextFile(entry.absPath),
      })),
    );
    markdown = formatDocsExport(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`could not read every documentation source: ${message}`);
    return 1;
  }

  if (outputPath) {
    try {
      await Deno.writeTextFile(outputPath, markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`could not write "${options.output}": ${message}`);
      return 1;
    }
    log.ok(
      `Exported ${entries.length} document${
        entries.length === 1 ? "" : "s"
      } to ${display(outputPath, cwd)}.`,
    );
    return 0;
  }

  await Deno.stdout.write(new TextEncoder().encode(markdown));
  return 0;
}

/**
 * Compute a docs/help {@link DiscernResult} — the machine-readable index, or a
 * single doc's record + content when `target` is given. The ONE source the CLI's
 * `--json` paths and the MCP server both render; the human, raw, and interactive
 * renderings live in {@link runTree} / {@link viewTarget}. Mirrors the human
 * resolution exactly: no tree, empty tree, target not-found / ambiguous / found,
 * or the full index. The `desc` selects the project tree (`docs`) or discern's
 * bundled tree (`help`); the shape is otherwise identical.
 */
async function treeResult(
  desc: DocsVerb,
  cwd: string,
  opts: {
    target?: string | undefined;
    dir?: string | undefined;
    internal?: boolean | readonly string[] | undefined;
  } = {},
): Promise<DiscernResult> {
  const resolved = await desc.resolveDir(opts);
  const tree = resolved.kind === "missing" ? undefined : await discoverDocs({
    cwd,
    dir: resolved.dir,
    includeInternal: opts.internal,
  });
  if (!tree) {
    return {
      ok: false,
      verb: desc.verb,
      error: desc.missingError,
      message: desc.missingTree(opts),
    };
  }
  if (tree.entries.length === 0) {
    return {
      ok: true,
      verb: desc.verb,
      data: {
        docs_dir: display(tree.docsDir, cwd),
        count: 0,
        docs: [],
      } satisfies DocsData,
    };
  }

  // A specific doc named → that one's record + content.
  if (opts.target !== undefined && opts.target !== "") {
    const res = resolveDoc(tree, opts.target, cwd);
    if (res.kind === "none") {
      return {
        ok: false,
        verb: desc.verb,
        error: "not_found",
        message: `no doc matches "${opts.target}".`,
      };
    }
    if (res.kind === "ambiguous") {
      return {
        ok: false,
        verb: desc.verb,
        error: "ambiguous",
        message: `"${opts.target}" matches ${res.entries.length} docs.`,
        data: {
          candidates: res.entries.map((e) => e.path),
        } satisfies DocsData,
      };
    }
    const content = await Deno.readTextFile(res.entry.absPath);
    return {
      ok: true,
      verb: desc.verb,
      data: { doc: { ...toRecord(res.entry), content } } satisfies DocsData,
    };
  }

  // No target → the index.
  return {
    ok: true,
    verb: desc.verb,
    data: {
      docs_dir: display(tree.docsDir, cwd),
      count: tree.entries.length,
      docs: tree.entries.map(toRecord),
    } satisfies DocsData,
  };
}

/**
 * The `docs` result core — {@link treeResult} over the project's own `docs/`
 * tree. Backs the CLI's `--json` path and the MCP `discern_docs` tool.
 */
export function docsResult(
  cwd: string,
  opts: { target?: string | undefined; dir?: string | undefined } = {},
): Promise<DiscernResult> {
  return treeResult(DOCS_VERB, cwd, opts);
}

/**
 * The `help` result core — {@link treeResult} over discern's OWN bundled docs.
 * The single shape a future `discern_help` MCP tool and the CLI's `--json` path
 * both render, mirroring {@link docsResult}. (No `--dir`: the doc set is fixed.)
 */
export function helpResult(
  cwd: string,
  opts: { target?: string | undefined } = {},
): Promise<DiscernResult> {
  return treeResult(HELP_VERB, cwd, opts);
}

/** Resolve a `--target`, then render or raw-dump that single doc (human path;
 * `--json` goes through {@link treeResult}). */
async function viewTarget(
  verb: string,
  tree: DocsTree,
  options: DocsOptions,
  log: Logger,
  cwd: string,
  target: string,
): Promise<number> {
  const res = resolveDoc(tree, target, cwd);

  if (res.kind === "none") {
    log.error(`no doc matches "${target}".`);
    log.detail(`list what's available: discern ${verb} --list`);
    return 1;
  }

  if (res.kind === "ambiguous") {
    log.error(
      `"${target}" matches ${res.entries.length} docs. Qualify it with a section or path:`,
    );
    for (const e of res.entries) log.detail(e.path);
    return 1;
  }

  const content = await Deno.readTextFile(res.entry.absPath);
  if (options.raw) {
    // Pristine source — exactly the file's bytes, no added newline.
    await Deno.stdout.write(new TextEncoder().encode(content));
    return 0;
  }
  const color = colourEnabled(options.noColor);
  const rendered = renderMarkdown(content, {
    width: resolveWidth(options.width),
    color,
  });
  await present(rendered, options.noPager);
  return 0;
}

/**
 * Run a docs/help browse. Returns a process exit code. The `desc` selects the
 * tree (`docs` → the project's `docs/`; `help` → discern's bundled docs); the
 * argument dispatch, export pipeline, `--json` surface, interactive browser, and
 * pager are shared verbatim.
 */
async function runTree(desc: DocsVerb, options: DocsOptions): Promise<number> {
  const log = new Logger(options);
  const cwd = Deno.cwd();

  if (options.output && !options.export) {
    return invalidOptions(log, desc.verb, "--output requires --export.");
  }

  if (options.export) {
    const scope = exportScope(options.export, desc.exportScopes);
    if (!scope) {
      return invalidOptions(
        log,
        desc.verb,
        `unknown export scope "${options.export}"; expected ${
          listScopes(desc.exportScopes)
        }.`,
      );
    }

    const conflicts = [
      options.target !== undefined ? "a target" : undefined,
      options.json ? "--json" : undefined,
      options.raw ? "--raw" : undefined,
      options.list ? "--list" : undefined,
      options.adr ? "--adr" : undefined,
      options.width !== undefined ? "--width" : undefined,
      options.noPager ? "--no-pager" : undefined,
    ].filter((value): value is string => value !== undefined);
    if (conflicts.length > 0) {
      return invalidOptions(
        log,
        desc.verb,
        `--export cannot be combined with ${conflicts.join(", ")}.`,
      );
    }

    if (scope === "select") {
      if (!options.output) {
        return invalidOptions(
          log,
          desc.verb,
          "--export select requires --output <path>.",
        );
      }
      if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
        return invalidOptions(
          log,
          desc.verb,
          "--export select requires an interactive terminal.",
        );
      }
    }

    return await exportDocs(desc, options, scope, log, cwd);
  }

  // `help --adr` widens discovery to the bundled ADR subtree; every other browse
  // (and every `docs` browse, and the MCP path) stays public-only.
  const internal = internalScope(desc, options);

  // `--json`: the entire machine-readable surface (index, single doc, or error)
  // is {@link treeResult} — the one shape the MCP server also renders. The human,
  // raw, and interactive renderings below never run under `--json`.
  if (options.json) {
    const result = await treeResult(desc, cwd, {
      target: options.target,
      dir: options.dir,
      internal,
    });
    log.result(result);
    return result.ok ? 0 : 1;
  }

  const resolved = await desc.resolveDir(options);
  const tree = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({ cwd, dir: resolved.dir, includeInternal: internal });
  if (!tree) {
    log.error(desc.missingTree(options));
    return 1;
  }
  if (tree.entries.length === 0) {
    log.warn(`no Markdown files under ${display(tree.docsDir, cwd)}.`);
    return 0;
  }

  // 1. A specific doc was named → render / raw-dump just that one.
  if (options.target !== undefined && options.target !== "") {
    return await viewTarget(desc.verb, tree, options, log, cwd, options.target);
  }

  // 2. A real terminal and no `--list` → the interactive browser.
  const interactive = !options.list &&
    Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  if (interactive) {
    return await browse(tree, options);
  }

  // 3. Otherwise (piped, redirected, or `--list`) → a plain table of contents.
  printToc(desc.verb, tree, cwd, colourEnabled(options.noColor));
  return 0;
}

/** Run `discern docs` — browse the project's own documentation tree. */
export function runDocs(options: DocsOptions): Promise<number> {
  return runTree(DOCS_VERB, options);
}

/** Run `discern help` — browse discern's OWN bundled documentation. */
export function runHelp(options: DocsOptions): Promise<number> {
  return runTree(HELP_VERB, options);
}
