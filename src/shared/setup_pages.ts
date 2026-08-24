/**
 * The setup-brief **page parser** (ADR 0078).
 *
 * `templates/setup/instructions.md` is authored as a preamble (the operating
 * principles), a sequence of numbered `## Step <n>` **pages**, and a closing
 * stop-conditions epilogue. Each page carries a structured **spine** — a
 * fenced ` ```toml ` block immediately after its heading ({@link SetupPageSpine}:
 * operational fields) — followed by the warm prose the agent follows verbatim.
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

/**
 * Versioned presentation registry for the stable setup page identifiers.
 *
 * Page numbers are public resume handles: an in-progress setup may already have
 * been told to run `discern setup step <n>`. Wave 4 changes the dependency order
 * without renumbering those handles. The registry is therefore the authority for
 * presentation order and the exact next command; the authored headings may move,
 * but a missing, duplicate, or reordered member fails parsing.
 */
export const SETUP_PAGE_REGISTRY_VERSION = 2;
export const SETUP_PAGE_REGISTRY = [
  { step: 0, nextCommand: "discern setup step 1" },
  { step: 1, nextCommand: "discern setup step 2" },
  { step: 2, nextCommand: "discern setup step 3" },
  { step: 3, nextCommand: "discern setup step 4" },
  { step: 4, nextCommand: "discern setup step 5" },
  { step: 5, nextCommand: "discern setup step 7" },
  { step: 7, nextCommand: "discern setup step 8" },
  { step: 8, nextCommand: "discern setup step 6" },
  { step: 6, nextCommand: "discern setup step 9" },
  { step: 9, nextCommand: "discern setup done" },
] as const;

/** Stable ids of pages that author architecture, ownership, command, or
 * instruction claims and must therefore carry the final evidence-recheck action. */
export const SETUP_DOCUMENTATION_CLAIM_STEPS = [4, 5, 7, 6] as const;

/** Useful-context ceilings for the default progressive-disclosure surfaces. */
export const SETUP_PAGE_MAX_CHARS = 12_000;
export const SETUP_BEGIN_MAX_CHARS = 18_000;
export const SETUP_RESULT_MAX_CHARS = 24_000;

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

  const authoredPages: SetupPage[] = [];
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
      authoredPages.push({ step: n, title, spine, instructions });
    } else if (EPILOGUE_HEADING.test(heading)) {
      epilogue = lines.slice(start, end).join("\n").trimEnd();
    }
  }

  const expected = SETUP_PAGE_REGISTRY.map((entry) => entry.step);
  const actual = authoredPages.map((page) => page.step);
  if (
    actual.length !== expected.length ||
    actual.some((step, index) => step !== expected[index])
  ) {
    throw new Error(
      `Setup page registry v${SETUP_PAGE_REGISTRY_VERSION} expects authored order ${
        expected.join(", ")
      }; found ${
        actual.join(", ")
      }. Keep stable page ids and move whole page sections into registry order.`,
    );
  }
  for (const [index, page] of authoredPages.entries()) {
    const registered = SETUP_PAGE_REGISTRY[index];
    if (registered === undefined || page.step !== registered.step) {
      throw new Error(`Setup page ${page.step} is not registered.`);
    }
    if (page.spine.next_action !== registered.nextCommand) {
      throw new Error(
        `Setup Step ${page.step} must use the registry next command ` +
          `\`${registered.nextCommand}\`; found \`${page.spine.next_action}\`.`,
      );
    }
  }

  return { preamble, pages: authoredPages, epilogue };
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
 * Render one page as the human-facing operational contract. Every load-bearing
 * spine fact is projected here from the same parsed authority JSON carries; the
 * prose remains a distinct rationale/examples lane rather than repeating the
 * action list. No success glyph (`✓`) — `begin` asserts none leaks in.
 */
export function renderSetupPage(page: SetupPage): string {
  const { spine } = page;
  const bullets = (values: readonly string[]): string[] =>
    values.map((value) => `- ${value}`);
  const ordered = (values: readonly string[]): string[] =>
    values.map((value, index) => `${index + 1}. ${value}`);
  return [
    `## Step ${page.step} — ${page.title}`,
    "",
    `Phase: ${spine.phase}`,
    `Stable target: ${spine.stable_target}`,
    "",
    spine.intent,
    "",
    "### Inspect before acting",
    "",
    ...bullets(spine.files_to_read),
    "",
    "### Must do, in order",
    "",
    ...ordered(spine.must_do),
    "",
    "### Authority and owner decisions",
    "",
    ...bullets(spine.authority_boundaries.map((item) => `Authority: ${item}`)),
    ...bullets(spine.human_decisions.map((item) => `Owner decision: ${item}`)),
    "",
    "### Do not",
    "",
    ...bullets(spine.what_not_to_do),
    ...(page.instructions.length === 0
      ? []
      : ["", "### Rationale and examples", "", page.instructions]),
    "",
    "### Completion check",
    "",
    spine.completion_check,
    "",
    "### Stop and recover",
    "",
    ...bullets(spine.stop_conditions.map((item) => `Stop: ${item}`)),
    ...bullets(spine.recovery.map((item) => `Recovery: ${item}`)),
    ...(spine.relay === undefined
      ? []
      : ["", "### Relay to the owner", "", ...bullets(spine.relay)]),
    "",
    "### Next command",
    "",
    `\`${spine.next_action}\``,
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
