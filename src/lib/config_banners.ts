/**
 * Pure scanners for discern.toml's ruled, managed comment banners.
 *
 * Kept independent of template/path resolution so both template reconciliation
 * and the comment-preserving editor can use the same ownership boundaries.
 */

/** Matches the opening/closing line of a `# ───` ruled documentation block. */
const RULE_RE = /^#\s*─/;

/** Matches a comment whose first content is a bracketed config path. */
const BANNER_IDENTITY_RE = /^\s*#\s*\[([^\]]+)\]/;

/** True for a TOML comment line. */
function isComment(line: string): boolean {
  return /^\s*#/.test(line);
}

/** One clean ruled banner, identified by the bracketed path on its first line. */
export interface RuledBannerSpan {
  /** The path named by the first comment after the opening rule. */
  identity: string;
  /** Line index of the opening `# ───` rule. */
  start: number;
  /** Line index of the closing `# ───` rule, inclusive. */
  end: number;
}

/** One discern-owned managed record-family banner. */
export interface ManagedBannerSpan {
  /** The record family (a member of the caller's record paths) it documents. */
  family: string;
  /** Line index of the banner's opening `# ───` rule. */
  start: number;
  /** Line index of the banner's closing `# ───` rule, inclusive. */
  end: number;
}

/**
 * Locate every clean `# ───`-delimited banner whose first content line names a
 * bracketed config path. Only comment lines may occur before the closing rule;
 * malformed or half-delimited regions are ignored rather than matched broadly.
 */
export function scanRuledBanners(text: string): RuledBannerSpan[] {
  const lines = text.split("\n");
  const spans: RuledBannerSpan[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!RULE_RE.test(lines[i] ?? "")) {
      i++;
      continue;
    }
    const identity = (lines[i + 1] ?? "").match(BANNER_IDENTITY_RE)?.[1]
      ?.trim();
    if (identity === undefined) {
      i++;
      continue;
    }
    let k = i + 1;
    let clean = true;
    while (k < lines.length && !RULE_RE.test(lines[k] ?? "")) {
      if (!isComment(lines[k] ?? "")) {
        clean = false;
        break;
      }
      k++;
    }
    if (!clean || k >= lines.length) {
      i++;
      continue;
    }
    spans.push({ identity, start: i, end: k });
    i = k + 1;
  }
  return spans;
}

/**
 * Locate every ruled banner belonging to one of `recordPaths`. At most one
 * banner per family (the first wins); spans are returned in file order.
 */
export function scanManagedBanners(
  text: string,
  recordPaths: readonly string[],
): ManagedBannerSpan[] {
  const familyOf = (path: string): string | undefined =>
    recordPaths.find((record) =>
      path === record || path.startsWith(`${record}.`)
    );
  const spans: ManagedBannerSpan[] = [];
  const seen = new Set<string>();
  for (const span of scanRuledBanners(text)) {
    const family = familyOf(span.identity);
    if (family === undefined || seen.has(family)) {
      continue;
    }
    spans.push({ family, start: span.start, end: span.end });
    seen.add(family);
  }
  return spans;
}

/**
 * Rename the first path segment in clean ruled-banner identities. Ordinary
 * comments and every byte outside the owned rule pairs remain untouched.
 */
export function renameRuledBannerIdentity(
  text: string,
  from: string,
  to: string,
): string {
  const lines = text.split("\n");
  for (const span of scanRuledBanners(text)) {
    const parts = span.identity.split(".");
    if (parts[0] !== from) {
      continue;
    }
    const identityLine = lines[span.start + 1];
    if (identityLine === undefined) {
      continue;
    }
    lines[span.start + 1] = identityLine.replace(
      `[${span.identity}]`,
      `[${[to, ...parts.slice(1)].join(".")}]`,
    );
  }
  return lines.join("\n");
}
