/**
 * The "a gate step failed" gotchas surface, ALWAYS written to stderr so it
 * never pollutes the gate's stdout. Aims an agent at the project's gotchas doc
 * (`[project].gotchas_doc`); an empty gotchas_doc disables the doc line. When
 * the doc annotates a trap with a matcher and the failure matches it, the
 * entry itself is inlined in place of the pointer (ADR 0189), on the human
 * tail and the result envelope alike.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { canonicalDocTargetFromPath } from "../../lib/docs.ts";
import { resolveMapDir } from "../../lib/paths.ts";
import { isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { palette, writeStderr } from "../output.ts";
import {
  type GateFailureEvidence,
  type GotchasTrap,
  matchTrap,
  parseGotchasDoc,
} from "./gotcha_match.ts";

/** Chars of trap body inlined into a failure before truncating to the pointer. */
export const INLINED_TRAP_BODY_CAP = 4_000;

/** True when `candidate` is nested below `directory` (not the directory itself). */
function isNestedWithin(directory: string, candidate: string): boolean {
  const rel = relative(directory, candidate);
  return rel !== "" && rel !== ".." &&
    !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel);
}

/** Quote one positional for the POSIX shells discern supports. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) && !value.startsWith("-")
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Render the structured map fetch for one canonical target. */
function mapFetchCommand(target: string): string {
  return target.startsWith("-")
    ? `discern map --json -- ${shellWord(target)}`
    : `discern map ${shellWord(target)} --json`;
}

/** How a failure references the gotchas doc: the map verb's canonical fetch
 * when the doc lives below `[map].dir`, the filesystem path otherwise. */
export type GotchasDocReference =
  | { command: string; path?: never }
  | { path: string; command?: never };

/** The configured doc's reference, or undefined when gotchas_doc is empty. */
function gotchasDocReference(
  config: DiscernConfig,
  root: string,
): { reference: GotchasDocReference; docPath: string } | undefined {
  const doc = config.project.gotchas_doc;
  if (doc === "") {
    return undefined;
  }
  const docPath = resolve(root, doc);
  const mapDir = resolve(resolveMapDir(root, config).abs);
  if (isNestedWithin(mapDir, docPath)) {
    const rel = relative(mapDir, docPath).replaceAll(SEPARATOR, "/");
    if (/\.md$/i.test(rel)) {
      const target = canonicalDocTargetFromPath(rel);
      return { reference: { command: mapFetchCommand(target) }, docPath };
    }
  }
  return { reference: { path: docPath }, docPath };
}

/** Fire the generic pointer for one doc reference (narrowing the union — the
 * hint template takes exactly one of the two reference forms). */
function firePointer(reference: GotchasDocReference): FiredHint {
  return reference.command !== undefined
    ? fire(HINTS["gate-failure-gotchas"], { command: reference.command })
    : fire(HINTS["gate-failure-gotchas"], { path: reference.path });
}

/** Fire the inlined matched-trap hint for one doc reference. */
function fireMatched(
  reference: GotchasDocReference,
  title: string,
  body: string,
): FiredHint {
  return reference.command !== undefined
    ? fire(HINTS["gate-failure-gotcha-matched"], {
      title,
      body,
      command: reference.command,
    })
    : fire(HINTS["gate-failure-gotcha-matched"], {
      title,
      body,
      path: reference.path,
    });
}

/**
 * Build the registered gotchas pointer shared by stderr and result envelopes.
 * A Markdown doc below `[map].dir` uses the map verb's canonical target; every
 * other configured path keeps the filesystem fallback.
 */
export function gateFailureGotchasHint(
  config: DiscernConfig,
  root: string,
): FiredHint | undefined {
  const doc = gotchasDocReference(config, root);
  return doc === undefined ? undefined : firePointer(doc.reference);
}

/** Bound a trap body for inlining: cut at a line boundary under the cap and
 * say so — the reference sentence that follows reaches the full entry. */
function boundedTrapBody(body: string): string {
  if (body.length <= INLINED_TRAP_BODY_CAP) {
    return body;
  }
  const head = body.slice(0, INLINED_TRAP_BODY_CAP);
  const cut = head.lastIndexOf("\n");
  return `${cut > 0 ? head.slice(0, cut) : head}\n\n(entry truncated)`;
}

/**
 * The gotchas content a failed gate verb carries: ONE hint for the envelope —
 * the matched trap entry when a matcher fires, the generic pointer otherwise —
 * plus a warning per malformed matcher. The human failure tail prints the same
 * fired texts, so the two surfaces cannot disagree.
 */
export interface GotchasFailureTail {
  hint: FiredHint;
  warnings: FiredHint[];
}

/**
 * Resolve the gotchas tail for one failure: read the configured doc (a missing
 * or unreadable doc keeps the pointer — the doc is the project's to write),
 * surface each malformed matcher by entry name, and inline the first matching
 * trap in document order. Returns undefined when no gotchas doc is configured.
 */
export async function gateFailureGotchasTail(
  config: DiscernConfig,
  root: string,
  failure: GateFailureEvidence,
): Promise<GotchasFailureTail | undefined> {
  const doc = gotchasDocReference(config, root);
  if (doc === undefined) {
    return undefined;
  }
  let md: string;
  try {
    md = await Deno.readTextFile(doc.docPath);
  } catch {
    return { hint: firePointer(doc.reference), warnings: [] };
  }
  const parsed = parseGotchasDoc(md);
  const warnings = parsed.problems.map((p) =>
    fire(HINTS["gotchas-matcher-invalid"], {
      entry: p.entry,
      problem: p.problem,
    })
  );
  const matched: GotchasTrap | undefined = matchTrap(parsed.traps, failure);
  if (matched === undefined) {
    return { hint: firePointer(doc.reference), warnings };
  }
  return {
    hint: fireMatched(
      doc.reference,
      matched.title,
      boundedTrapBody(matched.body),
    ),
    warnings,
  };
}

/** Print the failure pointer to stderr (the pointer-only surface used by
 * `with-gotchas`, which observes an external command with no gate evidence). */
export function gotchasHint(
  config: DiscernConfig,
  root: string,
  color: boolean,
): void {
  const hint = gateFailureGotchasHint(config, root);
  renderGotchasLead(hint, color);
}

/** The shared stderr lead: the failed-step marker plus the fired hint text,
 * or the record-your-fix nudge when no gotchas doc is configured. */
function renderGotchasLead(hint: FiredHint | undefined, color: boolean): void {
  const c = palette(color);
  const lead = `\n${c.dim}── a gate step failed.${c.reset}`;
  writeStderr(
    hint !== undefined
      ? `${lead} ${hint.text}\n`
      : `${lead} If it isn't self-explanatory, record the fix in a gotchas doc and point ${c.cyan}[project].gotchas_doc${c.reset} in discern.toml at it.\n`,
  );
}

/** Print a failed gate verb's gotchas tail to stderr: the inlined trap or the
 * pointer, then each malformed-matcher warning. */
export function renderGotchasTail(
  tail: GotchasFailureTail | undefined,
  color: boolean,
): void {
  renderGotchasLead(tail?.hint, color);
  const c = palette(color);
  for (const warning of tail?.warnings ?? []) {
    writeStderr(`${c.yellow}!${c.reset} ${warning.text}\n`);
  }
}
