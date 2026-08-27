/**
 * ADR citations in documentation prose: one normalized form, one stripper.
 *
 * Agents cite decisions liberally — that density is what lets a future session
 * surface "we decided against that" mid-task — so density is a RENDER-time
 * concern, never an editorial one. Published prose carries citations in one
 * normalized, strippable shape: a parenthetical group at clause end,
 *
 *     the one landing target ([ADR 0110](../_adr/0110-the-landing-model.md));
 *     with input-keyed replay ([ADR 0003](../_adr/0003-a.md), [ADR 0059](../_adr/0059-b.md)).
 *
 * The invariant the form buys: prose reads correctly with the citation
 * deleted. Human-rendered surfaces (site HTML, terminal help) strip the inline
 * groups and surface the collected decisions separately; machine-fidelity
 * surfaces (raw `.md`, llms editions, the map itself) retain them, because
 * their consumers are agents who benefit exactly as repo agents do.
 *
 * Three verbs, all code-aware (fenced blocks and inline code are never
 * touched): {@link collectAdrCitations} gathers a page's cited decisions for
 * a related-decisions footer, {@link stripAdrCitations} removes the normalized
 * groups from prose, and {@link findMalformedAdrReferences} is the gate's
 * check that published prose only ever cites in the normalized form.
 */

/** One cited decision: its zero-padded number, slug, and link destination. */
export interface AdrCitation {
  /** The four-digit record number, e.g. `"0110"`. */
  number: string;
  /** The record's file slug, e.g. `"the-landing-model"`. */
  slug: string;
  /** The link destination as written, e.g. `"../_adr/0110-the-landing-model.md"`. */
  path: string;
}

/** One reference the normalized-form check rejects. */
export interface AdrReferenceIssue {
  /** 1-indexed line of the offending reference. */
  line: number;
  /** The reference as written (trimmed excerpt). */
  text: string;
  /** Why it fails the normalized form. */
  reason: string;
}

/** One `[ADR NNNN](dest)` link. */
const CITATION = /\[ADR[ \t]*(\d{4})\]\(([^()\s]+)\)/;

/** A parenthetical citation group — one or more citations, comma-separated —
 * optionally preceded by the whitespace (or line wrap) that attached it to its
 * clause, so stripping removes the attachment too. */
const CITATION_GROUP = new RegExp(
  `(\\n|[ \\t]+)?\\(${CITATION.source}(?:,[ \\t\\n]*${CITATION.source})*\\)`,
  "g",
);

/** Any textual ADR-number reference, linked or bare. */
const ADR_TOKEN = /\bADR[ \t]*\d{4}\b/g;

/** The number a citation's destination points at, or undefined when the
 * destination is neither a Map record nor its canonical public route. */
function destParts(
  dest: string,
): { number: string; slug: string } | undefined {
  const m = dest.match(
    /(?:(?:^|\/)_adr\/|https:\/\/discern\.sh\/docs\/decisions\/)(\d{4})-([^/.#]+)(?:\.md)?$/u,
  );
  const number = m?.[1];
  const slug = m?.[2];
  return number !== undefined && slug !== undefined
    ? { number, slug }
    : undefined;
}

/**
 * Replace fenced code blocks and inline code spans with same-length filler so
 * pattern positions stay valid against the original text. Code is never prose:
 * a doc may legitimately SHOW a citation form inside a fence.
 */
function maskCode(md: string): string {
  let inFence = false;
  return md.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "\0".repeat(line.length);
    }
    if (inFence) return "\0".repeat(line.length);
    return line.replace(/(`+).*?\1/g, (m) => "\0".repeat(m.length));
  }).join("\n");
}

/** 1-indexed line number of `index` within `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/**
 * Every decision a document cites via `[ADR NNNN](…)` links in prose, in
 * first-citation order, deduplicated by number. Collection is deliberately
 * wider than the normalized group form so a footer never silently drops a
 * citation the gate has not (yet) normalized.
 */
export function collectAdrCitations(md: string): AdrCitation[] {
  const masked = maskCode(md);
  const seen = new Set<string>();
  const citations: AdrCitation[] = [];
  for (const m of masked.matchAll(new RegExp(CITATION.source, "g"))) {
    const dest = m[2] ?? "";
    const parts = destParts(dest);
    const number = m[1] ?? "";
    if (seen.has(number)) continue;
    seen.add(number);
    citations.push({
      number,
      slug: parts?.slug ?? "",
      path: dest,
    });
  }
  return citations;
}

/**
 * Remove every normalized citation group from prose, leaving the clause that
 * carried it reading naturally — the whitespace that attached a group to its
 * clause goes with it (a group that began a wrapped line takes the line break,
 * so the paragraph rejoins). Code blocks and inline code are untouched; so is
 * any reference NOT in the normalized form (the gate keeps published prose
 * free of those).
 */
export function stripAdrCitations(md: string): string {
  const masked = maskCode(md);
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(CITATION_GROUP)) {
    const index = m.index ?? 0;
    out += md.slice(last, index);
    // A group that opened a wrapped line: the preceding newline is consumed,
    // so the tail of its line rejoins the previous one with a space — unless
    // the group's own punctuation follows immediately.
    const lead = m[1];
    if (lead === "\n") {
      const next = md[index + m[0].length];
      if (next !== undefined && !/[\s.,;:!?)]/.test(next)) out += " ";
    }
    last = index + m[0].length;
  }
  out += md.slice(last);
  return out;
}

/**
 * The gate's view: every `ADR NNNN` reference in prose must sit inside a
 * normalized citation group whose link destinations name the same records.
 * Returns one issue per offending reference — bare `(ADR NNNN)` text, a
 * linked citation woven into a sentence as a grammatical subject, or a group
 * whose destination disagrees with its number. Empty means the document cites
 * correctly (or not at all).
 */
export function findMalformedAdrReferences(md: string): AdrReferenceIssue[] {
  const masked = maskCode(md);
  const issues: AdrReferenceIssue[] = [];

  // Every group's span (whether or not its members validate), so the token
  // pass below reports only references OUTSIDE any group — a group member's
  // problem is reported once, precisely, from this pass.
  const groupSpans: Array<[number, number]> = [];
  for (const m of masked.matchAll(CITATION_GROUP)) {
    const index = m.index ?? 0;
    const group = m[0];
    groupSpans.push([index, index + group.length]);
    for (const c of group.matchAll(new RegExp(CITATION.source, "g"))) {
      const number = c[1] ?? "";
      const parts = destParts(c[2] ?? "");
      if (parts === undefined) {
        issues.push({
          line: lineOf(masked, index + (c.index ?? 0)),
          text: c[0] ?? "",
          reason:
            "citation destination is neither an `_adr/NNNN-slug.md` record nor its canonical discern.sh decision route",
        });
      } else if (parts.number !== number) {
        issues.push({
          line: lineOf(masked, index + (c.index ?? 0)),
          text: c[0] ?? "",
          reason: `citation text says ADR ${number} but links ${parts.number}`,
        });
      }
    }
  }

  const covered = (index: number): boolean =>
    groupSpans.some(([from, to]) => index >= from && index < to);

  for (const m of masked.matchAll(ADR_TOKEN)) {
    const index = m.index ?? 0;
    if (covered(index)) continue;
    const linked = masked[index - 1] === "[";
    issues.push({
      line: lineOf(masked, index),
      text: m[0],
      reason: linked
        ? "linked citation outside a parenthetical group — move it to clause" +
          " end as `([ADR NNNN](…/_adr/NNNN-slug.md))`"
        : "bare text reference — cite as `([ADR NNNN](…/_adr/NNNN-slug.md))`" +
          " at clause end",
    });
  }
  return issues;
}
