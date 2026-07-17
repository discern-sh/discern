/**
 * The site's canonical URL, metadata, redirect, and machine-discovery policy.
 *
 * Everything here is derived from the live route model. The handler supplies
 * the ordinary page routes and the published DocsSite projection; this module
 * never discovers documents independently.
 */

import { buildRedirectRegistry } from "../src/lib/docs.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import type { DocsPage, DocsSite } from "./docs.ts";

export const SITE_ORIGIN = "https://discern.sh";
export const OG_IMAGE_PATH = "/assets/og-card.png";
export const META_DESCRIPTION_MIN = 50;
export const META_DESCRIPTION_MAX = 160;

/** Section-level route moves that cannot live on one destination document.
 * The site is not public yet, so the registry starts empty. Add entries only
 * after the slug freeze establishes a historical URL contract. */
export const STATIC_REDIRECTS: Readonly<Record<string, string>> = {};

export interface SiteRedirectTable {
  redirects: Map<string, string>;
  issues: string[];
}

/** The canonical absolute URL for one route (never a representation suffix). */
export function canonicalUrl(route: string): string {
  return `${SITE_ORIGIN}${route}`;
}

/**
 * Keep a derived description useful inside the metadata bounds. Long lead
 * paragraphs end at a word boundary; a very short lead is paired with its
 * title rather than padded with filler.
 */
export function boundedDescription(title: string, description: string): string {
  let value = description.replace(/\s+/g, " ").trim();
  if (value.length < META_DESCRIPTION_MIN) {
    value = `${title.replace(/\s+/g, " ").trim()}. ${value}`.trim();
  }
  if (value.length < META_DESCRIPTION_MIN) {
    throw new Error(
      `metadata description for ${JSON.stringify(title)} is only ` +
        `${value.length} characters`,
    );
  }
  if (value.length <= META_DESCRIPTION_MAX) return value;

  const room = META_DESCRIPTION_MAX - 1;
  const prefix = value.slice(0, room + 1);
  const sentenceEnd = Math.max(
    prefix.lastIndexOf(". "),
    prefix.lastIndexOf("! "),
    prefix.lastIndexOf("? "),
  );
  if (sentenceEnd >= META_DESCRIPTION_MIN - 1) {
    return value.slice(0, sentenceEnd + 1);
  }
  const wordEnd = prefix.lastIndexOf(" ");
  if (wordEnd < META_DESCRIPTION_MIN) {
    throw new Error(
      `metadata description for ${JSON.stringify(title)} has no safe ` +
        `boundary inside ${META_DESCRIPTION_MAX} characters`,
    );
  }
  return `${value.slice(0, wordEnd).replace(/[,:;\s]+$/, "")}…`;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeHtmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function attr(tag: string, name: string): string | undefined {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  );
  return match?.[2];
}

function pageTitle(html: string): string | undefined {
  const value = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return value === undefined
    ? undefined
    : decodeHtmlText(value.replace(/\s+/g, " ").trim());
}

function pageDescription(html: string): string | undefined {
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    if (attr(tag, "name")?.toLowerCase() === "description") {
      const content = attr(tag, "content");
      if (content !== undefined) return decodeHtmlText(content);
    }
  }
  return undefined;
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function routeLabel(segment: string): string {
  if (segment === "docs") return "Documentation";
  return segment.replaceAll("-", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function breadcrumbTitle(title: string): string {
  return title.replace(/ · discern\.sh docs$/, "");
}

function structuredData(
  route: string,
  title: string,
  description: string,
): unknown {
  if (route === "/") {
    return {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "discern",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Linux",
      url: SITE_ORIGIN,
      downloadUrl: "https://github.com/jackwh/discern/releases/latest",
      description,
    };
  }
  if (route !== "/docs" && !route.startsWith("/docs/")) return undefined;

  const segments = route.split("/").filter(Boolean);
  const elements: Array<Record<string, unknown>> = [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: SITE_ORIGIN,
    },
  ];
  let path = "";
  for (const [index, segment] of segments.entries()) {
    path += `/${segment}`;
    elements.push({
      "@type": "ListItem",
      position: index + 2,
      name: index === segments.length - 1
        ? breadcrumbTitle(title)
        : routeLabel(segment),
      item: canonicalUrl(path),
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: elements,
  };
}

function metadataMarkup(
  route: string,
  title: string,
  description: string,
): string {
  const canonical = canonicalUrl(route);
  const image = canonicalUrl(OG_IMAGE_PATH);
  const data = structuredData(route, title, description);
  const jsonLd = data === undefined
    ? ""
    : `\n<script type="application/ld+json">${jsonForHtml(data)}</script>`;
  return `<!-- discern:metadata -->
<link rel="canonical" href="${htmlEscape(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="discern" />
<meta property="og:title" content="${htmlEscape(title)}" />
<meta property="og:description" content="${htmlEscape(description)}" />
<meta property="og:url" content="${htmlEscape(canonical)}" />
<meta property="og:image" content="${htmlEscape(image)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(title)}" />
<meta name="twitter:description" content="${htmlEscape(description)}" />
<meta name="twitter:image" content="${htmlEscape(image)}" />${jsonLd}
<!-- /discern:metadata -->`;
}

/** Add canonical/social/structured metadata and nonce every inline block. */
export function decorateHtmlPage(
  html: string,
  route: string,
  nonce: string,
): string {
  const sourceTitle = pageTitle(html);
  const sourceDescription = pageDescription(html);
  if (sourceTitle === undefined || sourceTitle.length === 0) {
    throw new Error(`HTML route ${route} has no title`);
  }
  if (sourceDescription === undefined || sourceDescription.length === 0) {
    throw new Error(`HTML route ${route} has no description`);
  }
  const title = sourceTitle.endsWith(" · discern.sh docs")
    ? sourceTitle
    : `${sourceTitle} · discern.sh docs`;
  const description = boundedDescription(title, sourceDescription);
  // Resource tags are active requests, unlike ordinary outbound anchors.
  // Legacy editions still name remote CSS/font/runtime providers in source;
  // remove those tags at the response boundary as well as refusing them in CSP.
  let output = html
    .replace(/<link\b[^>]*href=["']https?:\/\/[^>]*>\s*/gi, "")
    .replace(
      /<script\b[^>]*src=["']https?:\/\/[^>]*>\s*<\/script>\s*/gi,
      "",
    );
  output = output.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${htmlEscape(title)}</title>`,
  );
  output = output.replace(
    /<meta\s+[^>]*name=["']description["'][^>]*>/i,
    `<meta name="description" content="${htmlEscape(description)}" />`,
  );
  output = output.replace(
    /<\/head>/i,
    `${metadataMarkup(route, title, description)}\n</head>`,
  );
  output = output.replace(
    /<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)([^>]*)>/gi,
    `<script nonce="${htmlEscape(nonce)}"$1>`,
  );
  return output.replace(
    /<style(?![^>]*\bnonce=)([^>]*)>/gi,
    `<style nonce="${htmlEscape(nonce)}"$1>`,
  );
}

/** Apply the security policy to every response, including redirects/errors. */
export function applySecurityHeaders(
  headers: Headers,
  nonce: string,
  secure: boolean,
): void {
  headers.set(
    "content-security-policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      `script-src 'self' 'nonce-${nonce}'`,
      "script-src-attr 'unsafe-inline'",
      `style-src 'self' 'nonce-${nonce}'`,
      "style-src-attr 'unsafe-inline'",
      // Only meaningful on a secure response: on plain-HTTP local preview it
      // upgrades every asset request to an https origin that cannot answer
      // (Safari applies it even on loopback, unlike Chrome and Firefox).
      ...(secure ? ["upgrade-insecure-requests"] : []),
    ].join("; "),
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "permissions-policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  headers.set("x-frame-options", "DENY");
}

/** A per-response nonce. Inline theme bootstraps work without unsafe-inline. */
export function responseNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

function markdownRoute(route: string): string {
  return `${route}.md`;
}

/**
 * Combine destination-owned frontmatter claims with the explicit section map.
 * The 1A registry supplies the destination claims; this layer adds all live
 * routes, machine-edition mirrors, and static-map chain/loop validation.
 */
export function buildSiteRedirectTable(
  liveRoutes: readonly string[],
  pages: readonly Pick<DocsPage, "route" | "entry">[],
  staticRedirects: Readonly<Record<string, string>> = STATIC_REDIRECTS,
): SiteRedirectTable {
  const claims = buildRedirectRegistry(pages.map((page) => ({
    route: page.route,
    redirectFrom: page.entry.redirectFrom,
  })));
  const live = new Set(liveRoutes);
  const liveRepresentations = new Set(liveRoutes);
  for (const route of live) {
    if (route === "/docs" || route.startsWith("/docs/")) {
      liveRepresentations.add(markdownRoute(route));
    }
  }
  const redirects = new Map<string, string>();
  const issues = [...claims.issues];

  const add = (source: string, target: string, owner: string): void => {
    if (!source.startsWith("/") || !target.startsWith("/")) {
      issues.push(`${owner}: redirect routes must be absolute`);
      return;
    }
    if (
      (source.length > 1 && source.endsWith("/")) ||
      (target.length > 1 && target.endsWith("/"))
    ) {
      issues.push(`${owner}: redirect routes use the no-trailing-slash style`);
      return;
    }
    if (liveRepresentations.has(source)) {
      issues.push(`${owner}: ${source} collides with a live route`);
      return;
    }
    if (!liveRepresentations.has(target)) {
      issues.push(`${owner}: target ${target} is not a live route`);
    }
    const existing = redirects.get(source);
    if (existing !== undefined && existing !== target) {
      issues.push(
        `${owner}: ${source} cannot point to both ${existing} and ${target}`,
      );
      return;
    }
    redirects.set(source, target);
  };

  for (const [source, target] of claims.redirects) {
    add(source, target, `redirect_from on ${target}`);
  }
  for (const [source, target] of Object.entries(staticRedirects)) {
    add(source, target, "static redirect map");
  }

  // Raw Markdown mirrors follow the same one-hop move as their HTML route.
  for (const [source, target] of [...redirects]) {
    if (
      source.startsWith("/docs") && target.startsWith("/docs") &&
      !source.endsWith(".md") && !target.endsWith(".md")
    ) {
      add(
        markdownRoute(source),
        markdownRoute(target),
        `Markdown mirror of ${source}`,
      );
    }
  }

  for (const [source, target] of redirects) {
    if (source === target) {
      issues.push(`redirect loop: ${source} points to itself`);
    } else if (redirects.has(target)) {
      issues.push(`redirect chain: ${source} points to redirect ${target}`);
    }
  }
  return { redirects, issues: [...new Set(issues)] };
}

/** Canonical absolute HTML URLs only. */
export function sitemapXml(routes: readonly string[]): string {
  const unique = [...new Set(routes)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    unique.map((route) =>
      `  <url><loc>${htmlEscape(canonicalUrl(route))}</loc></url>`
    ).join("\n") +
    `\n</urlset>\n`;
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\nSitemap: ${canonicalUrl("/sitemap.xml")}\n`;
}

/** Full public Markdown projection: frontmatter stripped, citations retained. */
export async function docsLlmsFullText(site: DocsSite): Promise<string> {
  const chunks = [
    "# discern documentation",
    "",
    "The complete public manual. Source citations are retained for agents.",
  ];
  for (const page of site.pages) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    const { body } = parseFrontmatter(raw);
    chunks.push(
      "",
      `<!-- BEGIN ${canonicalUrl(page.route)} -->`,
      "",
      body.trim(),
      "",
      `<!-- END ${canonicalUrl(page.route)} -->`,
    );
  }
  return `${chunks.join("\n").trimEnd()}\n`;
}
