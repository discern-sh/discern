/**
 * Trap matchers for the gotchas doc (ADR 0189): a `###` trap entry may carry
 * one fenced `gotcha-match` block (TOML: `stage` and/or `evidence`) that lets
 * the gate recognize the failure it documents and inline the entry into the
 * failure output. Pure parse + match — reading the doc, firing hints, and
 * rendering stay with the gotchas surface in `gotchas.ts`.
 *
 * Malformed matchers are collected as named problems, never dropped: a typo'd
 * key or stage must surface as a warning at consumption time, not become an
 * entry that can never match (ADR 0189 puts validation at consumption time).
 */

import { parse as parseToml } from "@std/toml";
import { fencedBlocks } from "../../lib/docs_integrity.ts";
import {
  type Diagnostic,
  FAILED_STAGES,
  type FailedStage,
} from "../../shared/result.ts";

/** The info string that marks a trap entry's matcher block. */
export const MATCHER_INFO = "gotcha-match";

/** A parsed matcher: every present field must hold for the entry to match. */
export interface TrapMatcher {
  stage?: FailedStage | undefined;
  evidence?: RegExp | undefined;
}

/** One `###` trap entry, with its matcher when the entry carries a valid one. */
export interface GotchasTrap {
  /** The `###` heading text. */
  title: string;
  /** The entry body, matcher block excluded, trimmed. */
  body: string;
  matcher?: TrapMatcher | undefined;
}

/** One malformed matcher, attributed to the entry that carries it. */
export interface MatcherProblem {
  /** The `###` heading of the entry (or a placeholder outside any entry). */
  entry: string;
  /** What is wrong with the block, in one sentence fragment. */
  problem: string;
}

/** The parse result: every trap in document order, plus every named problem. */
export interface ParsedGotchasDoc {
  traps: GotchasTrap[];
  problems: MatcherProblem[];
}

/** The entry attribution used for a matcher block above the first `###`. */
const NO_ENTRY = "(outside any trap entry)";

/** The keys a matcher block may carry — each one is compatibility surface. */
const MATCHER_KEYS = ["stage", "evidence"] as const;

/**
 * Parse one `gotcha-match` block body into a matcher, or explain why it does
 * not parse. Unknown keys and unknown stages are refusals, not ignores: a
 * misspelling must warn instead of yielding a matcher that never fires.
 */
function parseMatcherBlock(
  body: string,
): { matcher: TrapMatcher } | { problem: string } {
  let table: Record<string, unknown>;
  try {
    table = parseToml(body);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { problem: `the block is not valid TOML (${detail})` };
  }
  const known = new Set<string>(MATCHER_KEYS);
  const unknown = Object.keys(table).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    return {
      problem: `unknown key${unknown.length === 1 ? "" : "s"} ${
        unknown.map((k) => `\`${k}\``).join(", ")
      } (a matcher takes \`stage\` and \`evidence\`)`,
    };
  }
  const matcher: TrapMatcher = {};
  if ("stage" in table) {
    const stage = table.stage;
    if (typeof stage !== "string") {
      return { problem: "`stage` must be a string" };
    }
    if (!(FAILED_STAGES as readonly string[]).includes(stage)) {
      return {
        problem: `\`stage\` is "${stage}", which is not a gate stage (one of ${
          FAILED_STAGES.map((s) => `"${s}"`).join(", ")
        })`,
      };
    }
    matcher.stage = stage as FailedStage;
  }
  if ("evidence" in table) {
    const evidence = table.evidence;
    if (typeof evidence !== "string") {
      return { problem: "`evidence` must be a string" };
    }
    try {
      matcher.evidence = new RegExp(evidence);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        problem: `\`evidence\` is not a valid regular expression (${detail})`,
      };
    }
  }
  if (matcher.stage === undefined && matcher.evidence === undefined) {
    return { problem: "the block sets neither `stage` nor `evidence`" };
  }
  return { matcher };
}

/** A matcher block located in the doc: its body and the 0-based line span of
 * the whole block, fence markers included. */
interface LocatedBlock {
  body: string;
  /** 0-based index of the opening fence line. */
  from: number;
  /** 0-based index just past the closing fence line (or past EOF). */
  until: number;
}

/**
 * Parse a gotchas doc into its trap entries and their matchers. Every `###`
 * heading outside fenced code opens an entry (the stack-independent and
 * project-specific sections alike — matching does not care which section a
 * trap lives in); the entry runs to the next `###`/`##` heading. A trap's
 * body keeps its prose but drops the matcher block itself.
 */
export function parseGotchasDoc(md: string): ParsedGotchasDoc {
  const lines = md.split("\n");

  // Locate every fenced block once: matcher blocks by info string, and the
  // full fenced line-set so heading detection skips heading-shaped fence body.
  const fencedLines = new Set<number>();
  const matcherBlocks: LocatedBlock[] = [];
  for (const block of fencedBlocks(md)) {
    const from = block.startLine - 2; // 0-based opening fence line
    const until = Math.min(lines.length, from + block.lines.length + 2);
    for (let i = from; i < until; i += 1) {
      fencedLines.add(i);
    }
    if (block.info === MATCHER_INFO) {
      matcherBlocks.push({ body: block.lines.join("\n"), from, until });
    }
  }

  const traps: GotchasTrap[] = [];
  const problems: MatcherProblem[] = [];

  // Entry boundaries: each `###` heading to the next `###`/`##` heading.
  interface EntrySpan {
    title: string;
    from: number;
    until: number;
  }
  const spans: EntrySpan[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (fencedLines.has(i)) {
      continue;
    }
    const line = lines[i] ?? "";
    const previous = spans.at(-1);
    if (
      previous !== undefined && previous.until === lines.length &&
      (line.startsWith("### ") || line.startsWith("## "))
    ) {
      previous.until = i;
    }
    if (line.startsWith("### ")) {
      spans.push({ title: line.slice(4).trim(), from: i, until: lines.length });
    }
  }

  const entryFor = (blockLine: number): EntrySpan | undefined =>
    spans.find((s) => blockLine > s.from && blockLine < s.until);

  // Attribute matcher blocks: the first block in an entry is its matcher
  // slot; additional blocks in the same entry are malformed by definition.
  const matcherByEntry = new Map<EntrySpan, LocatedBlock>();
  for (const block of matcherBlocks) {
    const entry = entryFor(block.from);
    if (entry === undefined) {
      problems.push({
        entry: NO_ENTRY,
        problem: "a `gotcha-match` block must sit inside a `###` trap entry",
      });
      continue;
    }
    if (matcherByEntry.has(entry)) {
      problems.push({
        entry: entry.title,
        problem: "the entry carries more than one `gotcha-match` block",
      });
      continue;
    }
    matcherByEntry.set(entry, block);
  }

  for (const span of spans) {
    const block = matcherByEntry.get(span);
    const body = lines
      .slice(span.from + 1, span.until)
      .filter((_, offset) => {
        const line = span.from + 1 + offset;
        return block === undefined || line < block.from || line >= block.until;
      })
      .join("\n")
      .trim();
    const trap: GotchasTrap = { title: span.title, body };
    if (block !== undefined) {
      const parsed = parseMatcherBlock(block.body);
      if ("matcher" in parsed) {
        trap.matcher = parsed.matcher;
      } else {
        problems.push({ entry: span.title, problem: parsed.problem });
      }
    }
    traps.push(trap);
  }

  return { traps, problems };
}

/** The failure facts a matcher is tested against. */
export interface GateFailureEvidence {
  failedStage: FailedStage;
  diagnostics: readonly Pick<Diagnostic, "message" | "output">[];
}

/** True when the regex matches any diagnostic's message or captured output. */
function evidenceMatches(
  re: RegExp,
  diagnostics: GateFailureEvidence["diagnostics"],
): boolean {
  return diagnostics.some((d) =>
    re.test(d.message) || (d.output !== undefined && re.test(d.output))
  );
}

/**
 * The first trap (document order) whose matcher holds against the failure —
 * document order is the author's ranking, and at most one entry inlines.
 */
export function matchTrap(
  traps: readonly GotchasTrap[],
  failure: GateFailureEvidence,
): GotchasTrap | undefined {
  return traps.find((trap) => {
    const m = trap.matcher;
    if (m === undefined) {
      return false;
    }
    if (m.stage !== undefined && m.stage !== failure.failedStage) {
      return false;
    }
    if (
      m.evidence !== undefined &&
      !evidenceMatches(m.evidence, failure.diagnostics)
    ) {
      return false;
    }
    return true;
  });
}
