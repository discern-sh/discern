/**
 * Server-side HTML for the editor: turn a snapshot page's annotated Markdown
 * into the reading surface — provenance spans in place of markers, heading
 * anchors identical to the committed page, canon-internal links rewritten to
 * editor routes — and wrap it in the editor shell.
 */

import {
  MARK_CLOSE,
  MARK_OPEN,
  MARK_SEP,
  stripAnnotationMarkers,
} from "./annotation.ts";
import type { Snapshot, SnapshotPage } from "./snapshot.ts";
import { escapeHtml, renderMarkdownHtml } from "../../src/lib/markdown.ts";

/** How the editor may treat a span, from the AST classification of its field. */
export type SpanState = "editable" | "locked" | "unknown";

/** Resolve a ref token to its span state. */
export type SpanStates = (token: string) => SpanState;

/** The canon pages' file names, mapped to their editor routes. */
const PAGE_ROUTES: Readonly<Record<string, string>> = {
  "feature-canon.md": "feature-canon",
  "feature-canon-plain.md": "feature-canon-plain",
  "feature-canon-human-benefits.md": "feature-canon-human-benefits",
  "feature-canon-agent-benefits.md": "feature-canon-agent-benefits",
  "demand-canon.md": "demand-canon",
  "brand/demand-canon.md": "demand-canon",
  "practice-canon.md": "practice-canon",
  "the-practice.md": "the-practice",
  "glossary.md": "glossary",
  "30-reference/glossary.md": "manual-glossary",
  "claims-and-evidence.md": "claims-and-evidence",
  "brand/claims-and-evidence.md": "claims-and-evidence",
  "registry-atlas.md": "registry-atlas",
};

/**
 * Replace annotation markers with provenance spans. Every marker must resolve
 * — a leftover marker means the transform and the annotator disagree, so the
 * caller treats a nonzero remainder as a defect, not a cosmetic issue.
 */
export function markersToSpans(
  html: string,
  stateOf: SpanStates,
): { html: string; spans: number; leftover: number } {
  let spans = 0;
  const open = new RegExp(
    `${MARK_OPEN}([^${MARK_SEP}${MARK_CLOSE}]*)${MARK_SEP}`,
    "g",
  );
  let out = html.replace(open, (_match, token: string) => {
    spans += 1;
    const state = stateOf(token);
    const cls = state === "editable"
      ? "canon-editor-field"
      : state === "locked"
      ? "canon-editor-field canon-editor-locked"
      : "canon-editor-field canon-editor-unknown";
    return `<span class="${cls}" data-ref="${escapeHtml(token)}" tabindex="0">`;
  });
  out = out.replaceAll(MARK_CLOSE, "</span>");
  const leftover =
    (out.match(new RegExp(`[${MARK_OPEN}${MARK_SEP}${MARK_CLOSE}]`, "g")) ?? [])
      .length;
  return { html: out, spans, leftover };
}

/**
 * Restore the committed page's heading anchors. Markers inside a heading feed
 * the slugger, so the annotated render's ids drift; re-rendering the stripped
 * body through the same renderer yields the canonical ids, which are grafted
 * back on in document order.
 */
export function restoreHeadingIds(
  annotatedHtml: string,
  strippedBody: string,
): string {
  const canonical = renderMarkdownHtml(strippedBody).headings;
  let index = 0;
  return annotatedHtml.replace(
    /(<h[1-6][^>]*\bid=")([^"]*)(")/g,
    (whole, before: string, _id: string, after: string) => {
      const heading = canonical[index];
      index += 1;
      if (heading === undefined) return whole;
      return `${before}${escapeHtml(heading.id)}${after}`;
    },
  );
}

/** Rewrite canon-internal links to editor routes; neutralize the rest. */
export function rewriteDocLinks(html: string): string {
  return html.replace(
    /href="([^"]*)"/g,
    (whole, href: string) => {
      if (href.startsWith("#")) return whole;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return whole;
      const [path, anchor] = href.split("#");
      const normalized = (path ?? "").replace(/^(\.\.\/|\.\/)+/, "");
      const route = PAGE_ROUTES[normalized];
      if (route !== undefined) {
        const suffix = anchor === undefined ? "" : `#${anchor}`;
        return `href="/page/${route}${suffix}"`;
      }
      return `href="#" data-outside="${escapeHtml(href)}"`;
    },
  );
}

/** A page's reading surface: rendered, span-wrapped, anchor-faithful HTML. */
export function renderDocHtml(
  page: SnapshotPage,
  stateOf: SpanStates,
): { html: string; spans: number; leftover: number } {
  const rendered = renderMarkdownHtml(page.body).html;
  const { html, spans, leftover } = page.annotated
    ? markersToSpans(rendered, stateOf)
    : { html: rendered, spans: 0, leftover: 0 };
  const anchored = page.annotated
    ? restoreHeadingIds(html, stripAnnotationMarkers(page.body))
    : html;
  return { html: rewriteDocLinks(anchored), spans, leftover };
}

/** One nav row: a page link with its entry count. */
interface NavRow {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
}

/** The editor shell around one rendered page. */
export function renderShell(options: {
  readonly page: SnapshotPage;
  readonly docHtml: string;
  readonly snapshot: Snapshot;
  readonly themeBootstrap: string;
  readonly requestToken: string;
  readonly requestTokenHeader: string;
}): string {
  const {
    page,
    docHtml,
    snapshot,
    themeBootstrap,
    requestToken,
    requestTokenHeader,
  } = options;
  const counts = new Map<string, number>();
  for (const entry of snapshot.entries) {
    counts.set(entry.registry, (counts.get(entry.registry) ?? 0) + 1);
  }
  const canonRows: readonly NavRow[] = [
    {
      id: "feature-canon",
      title: "Feature canon",
      count: counts.get("feature"),
    },
    {
      id: "feature-canon-plain",
      title: "Plain twin",
      count: counts.get("feature"),
    },
    {
      id: "feature-canon-human-benefits",
      title: "Human benefits",
      count: counts.get("benefit"),
    },
    {
      id: "feature-canon-agent-benefits",
      title: "Agent benefits",
      count: counts.get("agent-benefit"),
    },
    {
      id: "demand-canon",
      title: "Demand canon",
      count: counts.get("demand"),
    },
    {
      id: "practice-canon",
      title: "Practice canon",
      count: counts.get("practice"),
    },
    { id: "the-practice", title: "The practice (public)" },
    {
      id: "glossary",
      title: "Glossary (Map)",
      count: counts.get("glossary"),
    },
    { id: "manual-glossary", title: "Glossary (Manual)" },
    {
      id: "claims-and-evidence",
      title: "Claims ledger",
      count: counts.get("claims"),
    },
  ];
  const atlasRows: readonly NavRow[] = [
    { id: "registry-atlas", title: "Registry atlas" },
  ];
  const navSection = (label: string, rows: readonly NavRow[]): string => {
    const items = rows
      .map((row) => {
        const current = row.id === page.id ? ` aria-current="page"` : "";
        const count = row.count === undefined
          ? ""
          : `<span class="canon-editor-count">${row.count}</span>`;
        return `<li><a href="/page/${row.id}"${current}>${
          escapeHtml(row.title)
        }${count}</a></li>`;
      })
      .join("");
    return `<section class="canon-editor-nav-group"><h2>${
      escapeHtml(label)
    }</h2><ul>${items}</ul></section>`;
  };
  const grade = snapshot.standards.find(
    (standard) => standard.name === "plain_reading_grade",
  );
  const gradeChip = grade?.value === undefined
    ? ""
    : `<span class="canon-editor-chip" id="canon-editor-grade" title="plain_reading_grade — a ceiling that may only fall">grade ${grade.value}${
      grade.limit === undefined ? "" : ` / ${grade.limit}`
    }</span>`;
  const boot = {
    page: page.id,
    rel: page.rel,
    guards: snapshot.guards,
    standards: snapshot.standards,
    requestToken,
    requestTokenHeader,
  };
  return `<!doctype html>
<html lang="en" data-discern-root data-discern-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.title)} — Canon Editor</title>
<script>${themeBootstrap}</script>
<link rel="stylesheet" href="/assets/design-system/fonts.css" />
<link rel="stylesheet" href="/assets/design-system/discern.css" />
<link rel="stylesheet" href="/assets/theme.css" />
<link rel="stylesheet" href="/assets/app.css" />
<script defer src="/assets/theme.js"></script>
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<header class="canon-editor-header">
<a class="canon-editor-brand" href="/page/feature-canon">Canon Editor</a>
<div class="canon-editor-header-right">
${gradeChip}
<span class="canon-editor-chip canon-editor-chip-dirty" id="canon-editor-dirty" hidden>● uncommitted changes</span>
<button type="button" class="canon-editor-chip" data-theme-toggle aria-pressed="false" aria-label="Switch to the dark theme">◐ theme</button>
</div>
</header>
<div class="canon-editor-shell">
<aside class="canon-editor-nav" aria-label="Canons">
${navSection("Canons", canonRows)}
${navSection("All sets", atlasRows)}
</aside>
<main class="canon-editor-doc">
<article class="discern-prose canon-editor-article" id="canon-editor-doc">
${docHtml}
</article>
</main>
<aside class="canon-editor-rail" id="canon-editor-rail" aria-label="Entry inspector">
<div class="canon-editor-rail-empty">Select an annotated span to inspect its entry, source, citations, and guards.</div>
</aside>
</div>
<div class="canon-editor-bench" id="canon-editor-bench" hidden>
<div class="canon-editor-bench-row">
<span class="canon-editor-bench-path" id="canon-editor-bench-path"></span>
<span class="canon-editor-bench-status" id="canon-editor-bench-status"></span>
<span class="canon-editor-bench-actions">
<button type="button" class="canon-editor-btn" id="canon-editor-bench-details-toggle" hidden aria-expanded="false">Details</button>
<button type="button" class="canon-editor-btn" id="canon-editor-bench-cancel">Cancel</button>
<button type="button" class="canon-editor-btn canon-editor-primary" id="canon-editor-bench-save">Save</button>
</span>
</div>
<pre class="canon-editor-bench-details" id="canon-editor-bench-details" hidden></pre>
</div>
<script id="canon-editor-boot" type="application/json">${
    JSON.stringify(boot).replaceAll("</", "<\\/")
  }</script>
</body>
</html>
`;
}
