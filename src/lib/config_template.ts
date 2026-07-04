/**
 * Read the canonical, doc-commented blocks out of the `discern.toml` template.
 *
 * The template (`templates/discern.toml.tmpl`) is the single source of truth for
 * how a section *should* read in a project's config: its `# ───` documentation
 * paragraph, its `[header]`, and its body of commented defaults. `setup` lays the
 * whole template down, so a fresh config is fully documented. A 5→6 migration
 * (ADR 0020) adds sections to an *existing* config — and an only-if-absent line
 * edit would append them as bare keys, leaving a migrated config worse-documented
 * than an init'd one the longer it has existed.
 *
 * This module closes that gap: it extracts a section's canonical block verbatim
 * from the template so the migration can insert it (doc block and all) at the
 * section's canonical position, giving a migrated config the same quality as a
 * fresh one. It is template-shaped, not a general TOML parser — it reads the
 * regular structure the template author maintains.
 */

import { join } from "@std/path";
import { resolveTemplatesDir } from "./paths.ts";
import type { EnvReader } from "../shared/env.ts";

/** The template file name inside the resolved `templates/` tree. */
const CONFIG_TEMPLATE_NAME = "discern.toml.tmpl";

/** Matches a section header line, capturing the section path inside the brackets. */
const HEADER_RE = /^\[([^\]]+)\]/;

/** Matches the opening/closing line of a `# ───` ruled documentation block. */
const RULE_RE = /^#\s*─/;

/** Matches a simple single-line TOML assignment and captures its bare key. */
const ASSIGNMENT_RE = /^\s*([A-Za-z0-9_-]+)\s*=/;

/** True for a blank (whitespace-only) line. */
function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** True for a comment line (`# …`). */
function isComment(line: string): boolean {
  return /^\s*#/.test(line);
}

/**
 * Extract a top-level section's canonical block from the `discern.toml` template
 * text: its documentation comment block (when it has one), the `[section]`
 * header, and the section body — as one multi-line string with no surrounding
 * blank lines. Returns `undefined` when the section header is absent.
 *
 * The doc block is the comment run immediately above the header (the ruled `# ───`
 * paragraph most sections carry, kept with the single blank line that separates
 * it from the header). A section whose comment-run-above reaches the very top of
 * the file is documented inline in its body instead (as `[meta]` is), and the
 * file preamble is never pulled in as its doc block.
 */
export function sectionBlockFromTemplate(
  templateText: string,
  section: string,
): string | undefined {
  const lines = templateText.split("\n");
  const headerIdx = lines.findIndex(
    (l) => l.match(HEADER_RE)?.[1]?.trim() === section,
  );
  if (headerIdx === -1) {
    return undefined;
  }
  const headerLine = lines[headerIdx];
  if (headerLine === undefined) {
    return undefined;
  }

  // Body: the lines after the header up to the next section — either its header
  // or the `# ───` doc block that introduces it — with trailing blanks trimmed.
  let bodyEnd = headerIdx + 1;
  for (; bodyEnd < lines.length; bodyEnd++) {
    const cur = lines[bodyEnd];
    if (cur === undefined || HEADER_RE.test(cur) || RULE_RE.test(cur)) {
      break;
    }
  }
  while (bodyEnd > headerIdx + 1) {
    const prev = lines[bodyEnd - 1];
    if (prev === undefined || !isBlank(prev)) break;
    bodyEnd--;
  }
  const body = lines.slice(headerIdx + 1, bodyEnd);

  // Doc block: scan up over the single separating blank, then the comment run.
  // If that run reaches the top of the file it is the preamble, not this
  // section's documentation (the [meta] case) — drop it.
  let i = headerIdx - 1;
  while (i >= 0) {
    const cur = lines[i];
    if (cur === undefined || !isBlank(cur)) break;
    i--;
  }
  const docEnd = i;
  while (i >= 0) {
    const cur = lines[i];
    if (cur === undefined || !isComment(cur)) break;
    i--;
  }
  const docStart = i + 1;
  const reachedTop = i < 0;
  const docBefore = (!reachedTop && docEnd >= docStart)
    ? lines.slice(docStart, docEnd + 1)
    : [];

  const out = docBefore.length > 0
    ? [...docBefore, "", headerLine, ...body]
    : [headerLine, ...body];
  return out.join("\n");
}

/** The live, uncommented section headers the template actively writes, in order. */
export function sectionNamesFromTemplate(templateText: string): string[] {
  const out: string[] = [];
  for (const line of templateText.split("\n")) {
    const section = line.match(HEADER_RE)?.[1]?.trim();
    if (section !== undefined) {
      out.push(section);
    }
  }
  return out;
}

/** The active keys the template writes inside one section, in order. */
export function sectionKeyNamesFromTemplate(
  templateText: string,
  section: string,
): string[] {
  const block = sectionBlockFromTemplate(templateText, section);
  if (block === undefined) {
    return [];
  }
  const lines = block.split("\n");
  const headerIdx = lines.findIndex(
    (line) => line.match(HEADER_RE)?.[1]?.trim() === section,
  );
  if (headerIdx === -1) {
    return [];
  }
  const keys: string[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const key = line.match(ASSIGNMENT_RE)?.[1];
    if (key !== undefined) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Extract the documented block for one active key from the rendered template:
 * any directly-attached comment paragraph (and its separating blank, when the
 * key is not first in the section) plus the key assignment line itself.
 */
export function keyBlockFromTemplate(
  templateText: string,
  dottedKey: string,
): string | undefined {
  const parts = dottedKey.split(".");
  const key = parts.at(-1);
  if (parts.length < 2 || key === undefined) {
    return undefined;
  }
  const section = parts.slice(0, -1).join(".");
  const block = sectionBlockFromTemplate(templateText, section);
  if (block === undefined) {
    return undefined;
  }
  const lines = block.split("\n");
  const headerIdx = lines.findIndex(
    (line) => line.match(HEADER_RE)?.[1]?.trim() === section,
  );
  if (headerIdx === -1) {
    return undefined;
  }
  const keyRe = new RegExp(
    `^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`,
  );
  const keyIdx = lines.findIndex((line, idx) =>
    idx > headerIdx && keyRe.test(line)
  );
  if (keyIdx === -1) {
    return undefined;
  }

  let start = keyIdx;
  while (start - 1 > headerIdx && isComment(lines[start - 1] ?? "")) {
    start--;
  }
  if (start - 1 > headerIdx && isBlank(lines[start - 1] ?? "")) {
    start--;
  }
  return lines.slice(start, keyIdx + 1).join("\n");
}

/**
 * Read the bundled `discern.toml` template text, or `undefined` if the templates
 * tree cannot be resolved or read. Migration callers may treat `undefined` as
 * "fall back to a plain key edit"; scaffold reconciliation treats it as a
 * blocking condition because it cannot prove the config is current.
 */
export async function readConfigTemplate(
  env: EnvReader = Deno.env,
): Promise<string | undefined> {
  try {
    const dir = await resolveTemplatesDir(env);
    return await Deno.readTextFile(join(dir, CONFIG_TEMPLATE_NAME));
  } catch {
    return undefined;
  }
}
