/**
 * The setup-brief **page parser** (ADR 0078).
 *
 * `templates/setup/instructions.md` is authored as a preamble (the operating
 * principles), a sequence of numbered `## Step <n>` **pages**, and a closing
 * stop-conditions epilogue. Each page carries a structured **spine** — a
 * fenced ` ```toml ` block immediately after its heading ({@link SetupPageSpine}:
 * `intent` / `files_to_read` / `must_do` / `what_not_to_do` / `completion_check` /
 * `next_action`) — followed by the warm prose the agent follows verbatim.
 *
 * This module is the ONE place that structure is read back out: `setup begin`
 * serves the preamble + the first page, `setup step <n>` serves one page, and both
 * terminal, JSON, and Markdown presentations project the same {@link SetupPage}.
 * It is pure text→struct (no engine deps), and validates every spine against
 * {@link SetupPageSpineSchema} so a malformed block fails LOUDLY at parse time
 * rather than silently serving half a page.
 */

import { parse as parseToml } from "@std/toml";
import {
  type SetupPageSpine,
  SetupPageSpineSchema,
  type SetupStepData,
} from "./result_schemas.ts";

export type { SetupPageSpine, SetupStepData };

/** One parsed setup page: the structured spine plus the warm prose body. The same
 * shape `setup step <n>` serializes (it IS {@link SetupStepData}). */
export type SetupPage = SetupStepData;

/** The whole brief, split into its three regions. `preamble` is everything before
 * the first step (the operating principles `begin` prints); `pages` are the
 * numbered pages in file order; `epilogue` is the closing stop-conditions section
 * (empty when absent). */
export interface SetupBrief {
  preamble: string;
  pages: SetupPage[];
  epilogue: string;
}

/** A `## Step <n> — <title>` heading (em-dash or hyphen separator). */
const STEP_HEADING = /^##\s+Step\s+(\d+)\s*[—-]\s*(.+?)\s*$/;
/** The closing stop-conditions heading — the epilogue boundary, not a page. */
const EPILOGUE_HEADING = /^##\s+You are not done\b/;
/** Any level-2 heading — the section boundary the brief is split on. */
const ANY_H2 = /^##\s/;
/** The opening fence of a step's spine block. */
const SPINE_FENCE_OPEN = /^```toml\b/;

/** Parse the whole brief into its preamble, numbered pages, and epilogue. Throws a
 * clear error if a step is missing or has a malformed spine block. */
export function parseSetupBrief(text: string): SetupBrief {
  const lines = text.split("\n");

  // Every level-2 heading is a section boundary.
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (ANY_H2.test(lines[i] ?? "")) {
      boundaries.push(i);
    }
  }

  // The preamble runs up to the first STEP heading (other preamble headings — the
  // operating principles — stay inside it).
  const firstStep = boundaries.find((i) => STEP_HEADING.test(lines[i] ?? ""));
  const preambleEnd = firstStep ?? lines.length;
  const preamble = lines.slice(0, preambleEnd).join("\n").trimEnd();

  const pages: SetupPage[] = [];
  let epilogue = "";
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b];
    if (start === undefined) {
      continue;
    }
    const end = boundaries[b + 1] ?? lines.length;
    const heading = lines[start] ?? "";
    const step = STEP_HEADING.exec(heading);
    if (step !== null) {
      const n = Number(step[1]);
      const title = (step[2] ?? "").trim();
      const body = lines.slice(start + 1, end);
      const { spine, instructions } = splitSpineAndProse(body, n);
      pages.push({ step: n, title, spine, instructions });
    } else if (EPILOGUE_HEADING.test(heading)) {
      epilogue = lines.slice(start, end).join("\n").trimEnd();
    }
  }

  return { preamble, pages, epilogue };
}

/** Return the page for step `n`, or undefined when there is none. */
export function getSetupPage(text: string, n: number): SetupPage | undefined {
  return parseSetupBrief(text).pages.find((p) => p.step === n);
}

/** Split a step's body lines into its parsed spine and its prose instructions. The
 * spine is the first ` ```toml ` fence; the instructions are everything after it (a
 * trailing `---` rule trimmed). Throws when the fence is missing or malformed. */
function splitSpineAndProse(
  body: string[],
  n: number,
): { spine: SetupPageSpine; instructions: string } {
  let open = -1;
  let close = -1;
  for (let i = 0; i < body.length; i++) {
    const line = (body[i] ?? "").trim();
    if (open === -1) {
      if (SPINE_FENCE_OPEN.test(line)) {
        open = i;
      }
      continue;
    }
    if (line === "```") {
      close = i;
      break;
    }
  }
  if (open === -1 || close === -1) {
    // The spine-block invariant is ADR 0078.
    throw new Error(
      `Setup Step ${n} is missing its \`\`\`toml spine block.`,
    );
  }

  const tomlText = body.slice(open + 1, close).join("\n");
  let raw: unknown;
  try {
    raw = parseToml(tomlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Setup Step ${n} spine is not valid TOML: ${message}`);
  }
  const parsed = SetupPageSpineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Setup Step ${n} spine is missing or mistyped fields: ${parsed.error.message}`,
    );
  }

  const instructions = body
    .slice(close + 1)
    .join("\n")
    .replace(/\n+---\s*$/, "")
    .trim();
  return { spine: parsed.data, instructions };
}

/**
 * Render one page as the human-facing text the agent reads (ADR 0078): the prose
 * leads (it is the load-bearing lane), bracketed by the orienting `intent` and a
 * light completion/next footer. The terse spine lists (`must_do`, …) stay in the
 * `--json` lane and are NOT re-rendered here, so the warm prose is never flattened
 * into field lists. No success glyph (`✓`) — `begin` asserts none leaks in.
 */
export function renderSetupPage(page: SetupPage): string {
  const { spine } = page;
  return [
    `## Step ${page.step} — ${page.title}`,
    "",
    spine.intent,
    "",
    page.instructions,
    "",
    `This step is complete when: ${spine.completion_check}`,
    `Next: ${spine.next_action}`,
  ].join("\n");
}

/**
 * Render what `setup begin` prints into the brief frame: the preamble (the
 * operating principles) followed by the FIRST page only (A10/ADR 0078). The agent
 * pulls each subsequent page with `setup step <n>`. Returns the first page too, so
 * the caller can carry it structured in `--json`.
 */
export function renderSetupBegin(
  text: string,
): { text: string; firstPage: SetupPage | undefined } {
  const brief = parseSetupBrief(text);
  const first = brief.pages[0];
  const body = first === undefined
    ? brief.preamble
    : `${brief.preamble}\n\n${renderSetupPage(first)}`;
  return { text: body, firstPage: first };
}
