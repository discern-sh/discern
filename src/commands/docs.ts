/**
 * `discern docs` — browse and read the project's documentation tree.
 *
 * One command serves two audiences, decided by how it is invoked:
 *
 *  - **A human at a terminal** gets an interactive, searchable picker (Cliffy's
 *    `Select`, with type-to-filter) and a rendered, paged view of whatever they
 *    pick. The tree is growing, so search is the primary way in.
 *  - **An agent or a script** gets non-interactive surfaces it can consume: a
 *    target to render straight to stdout, `--raw` for the pristine Markdown
 *    source, `--json` for a machine-readable index (or a single doc's record),
 *    and `--list` for a plain table of contents. It never blocks on a prompt
 *    when stdin/stdout are not a TTY.
 *
 * Rendering is handled by {@link renderMarkdown}; discovery and resolution by
 * {@link discoverDocs} / {@link resolveDoc}. This file is the glue: argument
 * dispatch, the interactive loop, and the pager.
 */

import { Select } from "@cliffy/prompt";
import { colors } from "@cliffy/ansi/colors";
import { relative } from "@std/path";
import { colourEnabled, Logger } from "../lib/log.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import {
  discoverDocs,
  type DocEntry,
  type DocsTree,
  resolveDoc,
} from "../lib/docs.ts";

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
}

/** The machine-readable record for one doc (sans content). */
function toRecord(e: DocEntry): Record<string, string> {
  return { path: e.path, section: e.section, slug: e.slug, title: e.title };
}

/** Path of `abs` relative to `cwd`, for display (falls back to `abs`). */
function display(abs: string, cwd: string): string {
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
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
function printToc(tree: DocsTree, cwd: string, color: boolean): void {
  const paint = (fn: (s: string) => string, s: string) => color ? fn(s) : s;
  const labelOf = (e: DocEntry) =>
    e.section ? e.relToDocs.slice(e.section.length + 1) : e.relToDocs;
  const colWidth = Math.min(
    32,
    Math.max(...tree.entries.map((e) => labelOf(e).length)),
  );

  const lines: string[] = [
    `${paint(colors.bold, "discern docs")} — ${tree.entries.length} ` +
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

/** Resolve a `--target`, then render / raw-dump / JSON-emit that single doc. */
async function viewTarget(
  tree: DocsTree,
  options: DocsOptions,
  log: Logger,
  cwd: string,
  target: string,
): Promise<number> {
  const res = resolveDoc(tree, target, cwd);

  if (res.kind === "none") {
    const message = `no doc matches "${target}".`;
    if (options.json) {
      log.result({ ok: false, verb: "docs", error: "not_found", message });
    } else {
      log.error(message);
      log.detail("list what's available: discern docs --list");
    }
    return 1;
  }

  if (res.kind === "ambiguous") {
    const candidates = res.entries.map((e) => e.path);
    const message = `"${target}" matches ${candidates.length} docs.`;
    if (options.json) {
      log.result({
        ok: false,
        verb: "docs",
        error: "ambiguous",
        message,
        data: { candidates },
      });
    } else {
      log.error(`${message} Qualify it with a section or path:`);
      for (const e of res.entries) log.detail(e.path);
    }
    return 1;
  }

  const entry = res.entry;
  const content = await Deno.readTextFile(entry.absPath);

  if (options.json) {
    log.result({
      ok: true,
      verb: "docs",
      data: { doc: { ...toRecord(entry), content } },
    });
    return 0;
  }
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

/** Run `discern docs`. Returns a process exit code. */
export async function runDocs(options: DocsOptions): Promise<number> {
  const log = new Logger(options);
  const cwd = Deno.cwd();
  const tree = await discoverDocs({ cwd, dir: options.dir });

  if (!tree) {
    const message = options.dir
      ? `no documentation directory at "${options.dir}".`
      : "no docs/ directory here — run `discern bootstrap` to seed one, or pass --dir <path>.";
    if (options.json) {
      log.result({ ok: false, verb: "docs", error: "no_docs", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  if (tree.entries.length === 0) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "docs",
        data: { docs_dir: display(tree.docsDir, cwd), count: 0, docs: [] },
      });
      return 0;
    }
    log.warn(`no Markdown files under ${display(tree.docsDir, cwd)}.`);
    return 0;
  }

  // 1. A specific doc was named → view / raw / JSON-emit just that one.
  if (options.target !== undefined && options.target !== "") {
    return await viewTarget(tree, options, log, cwd, options.target);
  }

  // 2. `--json` with no target → the machine-readable index.
  if (options.json) {
    log.result({
      ok: true,
      verb: "docs",
      data: {
        docs_dir: display(tree.docsDir, cwd),
        count: tree.entries.length,
        docs: tree.entries.map(toRecord),
      },
    });
    return 0;
  }

  // 3. A real terminal and no `--list` → the interactive browser.
  const interactive = !options.list &&
    Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
  if (interactive) {
    return await browse(tree, options);
  }

  // 4. Otherwise (piped, redirected, or `--list`) → a plain table of contents.
  printToc(tree, cwd, colourEnabled(options.noColor));
  return 0;
}
