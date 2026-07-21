/** Production-style crawl of the real site handler or a deployed release. */

import { JSDOM } from "jsdom";
import { loadDocsSite, relatedDecisionCitations } from "../site/docs.ts";
import { handler, liveHtmlRoutes } from "../site/serve.ts";
import {
  buildSiteRedirectTable,
  canonicalUrl,
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  SITE_ORIGIN,
  STATIC_REDIRECTS,
} from "../site/seo.ts";

const BROWSER_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "Mozilla/5.0 (discern site smoke)",
};
const TEXT_HEADERS = { accept: "text/plain", "user-agent": "curl/8.6.0" };
const CONCURRENCY = 16;

interface GuidanceItem {
  route: string;
  title: string;
}

interface HtmlPage {
  dom: JSDOM;
  html: string;
}

export interface SiteSmokeOptions {
  base: URL;
  externalLinks?: boolean | undefined;
  productionDomains?: boolean | undefined;
}

export interface SiteSmokeResult {
  ok: boolean;
  base: string;
  observations: string[];
  failures: string[];
  inconclusiveExternal: string[];
}

async function parallel<T>(
  values: readonly T[],
  work: (value: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
      while (cursor < values.length) {
        const value = values[cursor++];
        if (value !== undefined) await work(value);
      }
    }),
  );
}

function sameSequence(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
  fail: (message: string) => void,
): void {
  if (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  ) return;
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  fail(
    `${label}: expected ${expected.length}, got ${actual.length}; ` +
      `missing [${
        expected.filter((value) => !actualSet.has(value)).join(", ")
      }]; ` +
      `extra [${actual.filter((value) => !expectedSet.has(value)).join(", ")}]`,
  );
}

function sameItems(
  label: string,
  actual: readonly GuidanceItem[],
  expected: readonly GuidanceItem[],
  fail: (message: string) => void,
): void {
  sameSequence(
    `${label} routes/order`,
    actual.map((item) => item.route),
    expected.map((item) => item.route),
    fail,
  );
  const labels = new Map(actual.map((item) => [item.route, item.title]));
  for (const item of expected) {
    const actualTitle = labels.get(item.route);
    if (actualTitle !== item.title) {
      fail(
        `${label}: ${item.route} label ${JSON.stringify(actualTitle)} != ` +
          JSON.stringify(item.title),
      );
    }
  }
}

function securityFailures(response: Response, label: string): string[] {
  const failures: string[] = [];
  const csp = response.headers.get("content-security-policy") ?? "";
  for (
    const token of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "script-src 'self' 'nonce-",
    ]
  ) {
    if (!csp.includes(token)) failures.push(`${label}: CSP lacks ${token}`);
  }
  const exact: Readonly<Record<string, string>> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  };
  for (const [name, expected] of Object.entries(exact)) {
    const actual = response.headers.get(name);
    if (actual !== expected) {
      failures.push(
        `${label}: ${name} ${JSON.stringify(actual)} != ${expected}`,
      );
    }
  }
  if (
    !(response.headers.get("permissions-policy") ?? "").includes("camera=()")
  ) {
    failures.push(`${label}: permissions-policy lacks camera=()`);
  }
  return failures;
}

function redirectDestination(base: URL, route: string): string {
  return base.hostname === "discern.sh" || base.hostname === "www.discern.sh"
    ? canonicalUrl(route)
    : new URL(route, base).href;
}

/** Crawl one running artifact and return a structured evidence record. */
export async function runSiteSmoke(
  options: SiteSmokeOptions,
): Promise<SiteSmokeResult> {
  const base = new URL(options.base.href);
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  const failures: string[] = [];
  const observations: string[] = [];
  const inconclusiveExternal: string[] = [];
  const external = new Set<string>();
  const fail = (message: string): void => {
    failures.push(message);
  };
  const secure = (response: Response, label: string): void => {
    failures.push(...securityFailures(response, label));
  };
  const get = (
    path: string,
    headers: HeadersInit = BROWSER_HEADERS,
  ): Promise<Response> =>
    fetch(new URL(path, base), { headers, redirect: "manual" });

  const site = await loadDocsSite();
  const expectedRoutes = liveHtmlRoutes(site);
  const expectedCanonical = expectedRoutes.map(canonicalUrl);
  const guidance: GuidanceItem[] = [
    { route: site.landing.route, title: site.landing.entry.title },
    ...site.pages.map((page) => ({
      route: page.route,
      title: page.entry.title,
    })),
  ];

  const sitemapResponse = await get("/sitemap.xml");
  secure(sitemapResponse, "/sitemap.xml");
  if (sitemapResponse.status !== 200) {
    fail(`/sitemap.xml: status ${sitemapResponse.status}`);
  }
  const sitemapText = await sitemapResponse.text();
  const canonicalUrls = [...sitemapText.matchAll(/<loc>(.*?)<\/loc>/g)].map(
    (match) => match[1] ?? "",
  );
  sameSequence("sitemap", canonicalUrls, expectedCanonical, fail);
  const routes = canonicalUrls.map((value) => new URL(value).pathname);

  const htmlPages = new Map<string, HtmlPage>();
  const titles = new Map<string, string>();
  await parallel(routes, async (route) => {
    const response = await get(route);
    secure(response, route);
    if (response.status !== 200) {
      fail(`${route}: HTML status ${response.status}`);
      await response.body?.cancel();
      return;
    }
    if (!(response.headers.get("content-type") ?? "").includes("text/html")) {
      fail(
        `${route}: HTML content type ${response.headers.get("content-type")}`,
      );
    }
    const canonical = canonicalUrl(route);
    if (response.headers.get("link") !== `<${canonical}>; rel="canonical"`) {
      fail(`${route}: response canonical ${response.headers.get("link")}`);
    }
    const html = await response.text();
    const dom = new JSDOM(html);
    htmlPages.set(route, { dom, html });
    const document = dom.window.document;
    const title = document.title.trim();
    const titledForSite = route === "/"
      ? title === "discern — automatic quality control for coding agents"
      : title.endsWith(" · discern.sh docs");
    if (title === "" || !titledForSite) {
      fail(`${route}: invalid title ${JSON.stringify(title)}`);
    }
    const titleOwner = titles.get(title);
    if (titleOwner !== undefined) {
      fail(`${route}: duplicate title with ${titleOwner}: ${title}`);
    }
    titles.set(title, route);
    const description = document.querySelector('meta[name="description"]')
      ?.getAttribute("content") ?? "";
    if (
      description.length < META_DESCRIPTION_MIN ||
      description.length > META_DESCRIPTION_MAX
    ) {
      fail(`${route}: description length ${description.length}`);
    }
    if (
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") !==
        canonical
    ) {
      fail(`${route}: HTML canonical mismatch`);
    }
    for (
      const selector of [
        'meta[property="og:title"]',
        'meta[property="og:description"]',
        'meta[property="og:image"]',
        'meta[property="og:url"]',
        'meta[name="twitter:card"]',
        'meta[name="twitter:title"]',
        'meta[name="twitter:description"]',
        'meta[name="twitter:image"]',
      ]
    ) {
      if (document.querySelector(selector) === null) {
        fail(`${route}: missing ${selector}`);
      }
    }
    const structured = [
      ...document.querySelectorAll('script[type="application/ld+json"]'),
    ].map((node) => node.textContent ?? "").join("\n");
    if (
      route === "/" && !structured.includes('"@type":"SoftwareApplication"')
    ) {
      fail("/: missing SoftwareApplication JSON-LD");
    }
    if (
      (route === "/docs" || route.startsWith("/docs/")) &&
      !structured.includes('"@type":"BreadcrumbList"')
    ) {
      fail(`${route}: missing BreadcrumbList JSON-LD`);
    }
    if (
      document.querySelector(
        'script[src^="http"], link[rel="stylesheet"][href^="http"], ' +
          'link[rel="preconnect"][href^="http"]',
      ) !== null
    ) {
      fail(`${route}: active third-party resource`);
    }
  });

  const checkedInternal = new Map<string, number>();
  for (const [route, page] of htmlPages) {
    for (const anchor of page.dom.window.document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href") ?? "";
      if (
        href === "" || href.startsWith("mailto:") || href.startsWith("tel:") ||
        href.startsWith("data:") || href.startsWith("javascript:")
      ) continue;
      const url = new URL(href, `${SITE_ORIGIN}${route}`);
      if (url.origin !== SITE_ORIGIN) {
        if (url.protocol === "http:" || url.protocol === "https:") {
          url.hash = "";
          external.add(url.href);
        }
        continue;
      }
      const target = htmlPages.get(url.pathname);
      if (target !== undefined) {
        if (url.hash !== "") {
          let id: string;
          try {
            id = decodeURIComponent(url.hash.slice(1));
          } catch {
            fail(`${route}: malformed anchor ${url.hash}`);
            continue;
          }
          if (target.dom.window.document.getElementById(id) === null) {
            fail(`${route}: missing anchor ${url.pathname}${url.hash}`);
          }
        }
        continue;
      }
      if (!checkedInternal.has(url.pathname)) {
        const response = await get(url.pathname);
        secure(response, `linked ${url.pathname}`);
        checkedInternal.set(url.pathname, response.status);
        await response.body?.cancel();
      }
      const status = checkedInternal.get(url.pathname);
      if (status !== 200) {
        fail(`${route}: internal link ${url.pathname} returned ${status}`);
      }
    }
  }

  const rawPages = [
    site.landing,
    ...site.pages,
    { route: site.decisions.route, entry: site.decisions.index },
    ...site.decisions.pages,
  ];
  await parallel(rawPages, async (page) => {
    const source = await Deno.readTextFile(page.entry.absPath);
    const markdown = await get(`${page.route}.md`);
    secure(markdown, `${page.route}.md`);
    if (markdown.status !== 200) fail(`${page.route}.md: ${markdown.status}`);
    if (
      !(markdown.headers.get("content-type") ?? "").includes("text/markdown")
    ) {
      fail(`${page.route}.md: content type`);
    }
    if (
      markdown.headers.get("link") !==
        `<${canonicalUrl(page.route)}>; rel="canonical"`
    ) {
      fail(`${page.route}.md: canonical header`);
    }
    if (markdown.headers.get("x-robots-tag") !== "noindex, follow") {
      fail(`${page.route}.md: x-robots-tag`);
    }
    const markdownBody = await markdown.text();
    if (markdownBody !== source) fail(`${page.route}.md: source bytes differ`);

    const negotiated = await get(page.route, TEXT_HEADERS);
    secure(negotiated, `text ${page.route}`);
    if (negotiated.status !== 200) {
      fail(`text ${page.route}: ${negotiated.status}`);
    }
    if (await negotiated.text() !== source) {
      fail(`text ${page.route}: source bytes differ`);
    }
  });

  for (const page of site.pages) {
    const rendered = htmlPages.get(page.route)?.dom.window.document;
    if (rendered === undefined) {
      fail(`${page.route}: missing rendered document`);
      continue;
    }
    const article = rendered.querySelector(".doc-body");
    if (article === null) {
      fail(`${page.route}: missing rendered doc body`);
      continue;
    }
    if (/\bADR \d{4}\b/.test(article.textContent ?? "")) {
      fail(`${page.route}: inline ADR citation survived human rendering`);
    }
    const related = [...rendered.querySelectorAll(".docs-related-decision")]
      .map((link) => link.getAttribute("href") ?? "");
    const expected = relatedDecisionCitations(page).map((citation) =>
      site.decisions.byNumber.get(citation.number)?.route ?? ""
    );
    sameSequence(`${page.route} related decisions`, related, expected, fail);
  }

  const variants: Array<{ route: string; variant: string }> = [];
  for (const route of routes) {
    if (route === "/") {
      variants.push({ route, variant: "/index.html" });
    } else {
      variants.push(
        { route, variant: `${route}/` },
        { route, variant: `${route}/index.html` },
        { route, variant: `${route}.html` },
      );
    }
  }
  const checkRedirect = async (
    source: string,
    target: string,
    label: string,
  ): Promise<void> => {
    const response = await get(source);
    secure(response, label);
    if (response.status !== 308) {
      fail(`${label}: status ${response.status}`);
      await response.body?.cancel();
      return;
    }
    const expected = redirectDestination(base, target);
    const location = response.headers.get("location");
    if (location !== expected) {
      fail(`${label}: location ${location} != ${expected}`);
      await response.body?.cancel();
      return;
    }
    await response.body?.cancel();
    const destination = await fetch(expected, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
    });
    secure(destination, `${label} destination`);
    if (destination.status !== 200) {
      fail(`${label}: chain or dead target status ${destination.status}`);
    }
    await destination.body?.cancel();
  };
  await parallel(
    variants,
    ({ route, variant }) => checkRedirect(variant, route, variant),
  );

  const redirectTable = buildSiteRedirectTable(
    expectedRoutes,
    [site.landing, ...site.pages, ...site.decisions.pages],
    STATIC_REDIRECTS,
  );
  failures.push(
    ...redirectTable.issues.map((issue) => `redirect table: ${issue}`),
  );
  await parallel(
    [...redirectTable.redirects],
    ([source, target]) => checkRedirect(source, target, `declared ${source}`),
  );

  const docs = htmlPages.get("/docs")?.dom.window.document;
  if (docs === undefined) {
    fail("/docs: unavailable for surface parity");
  } else {
    const nav: GuidanceItem[] = [guidance[0] as GuidanceItem];
    for (const chapter of docs.querySelectorAll(".docs-nav-chapter")) {
      const sectionTitle = chapter.querySelector(".docs-nav-label")?.textContent
        ?.replace(/^\s*\d+\s*/, "").trim() ?? "";
      for (
        const [index, link] of [...chapter.querySelectorAll("ul a")].entries()
      ) {
        nav.push({
          route: link.getAttribute("href") ?? "",
          title: index === 0 ? sectionTitle : (link.textContent ?? "").trim(),
        });
      }
    }
    sameItems("/docs nav", nav, guidance, fail);
  }

  const searchResponse = await get("/docs/index.json");
  secure(searchResponse, "/docs/index.json");
  const search = await searchResponse.json() as {
    pages: Array<{ route: string; title: string }>;
  };
  sameItems("search", search.pages, guidance, fail);

  const llmsResponse = await get("/llms.txt");
  secure(llmsResponse, "/llms.txt");
  const llmsText = await llmsResponse.text();
  const llms = llmsText.slice(llmsText.indexOf("DOCUMENTATION"))
    .split("\n")
    .flatMap((line): GuidanceItem[] => {
      const match = /https:\/\/discern\.sh(\/docs\S*)\s+(.+)$/.exec(line);
      return match === null
        ? []
        : [{ route: match[1] ?? "", title: (match[2] ?? "").trim() }];
    });
  sameItems("llms.txt", llms, guidance, fail);

  const fullResponse = await get("/llms-full.txt");
  secure(fullResponse, "/llms-full.txt");
  const fullText = await fullResponse.text();
  const fullRoutes = [...fullText.matchAll(
    /<!-- BEGIN https:\/\/discern\.sh(\/docs[^ ]*) -->/g,
  )].map((match) => match[1] ?? "");
  sameSequence(
    "llms-full.txt",
    fullRoutes,
    guidance.map((item) => item.route),
    fail,
  );

  const sitemapGuidance = routes.filter((route) =>
    route === "/docs" ||
    (route.startsWith("/docs/") && route !== site.decisions.route &&
      !route.startsWith(`${site.decisions.route}/`))
  );
  sameSequence(
    "guidance sitemap",
    sitemapGuidance,
    guidance.map((item) => item.route),
    fail,
  );

  for (const path of ["/robots.txt", "/assets/og-card.png", "/install"]) {
    const response = await get(path);
    secure(response, path);
    if (response.status !== 200) fail(`${path}: status ${response.status}`);
    await response.body?.cancel();
  }
  const robots = await get("/robots.txt");
  if (
    !(await robots.text()).includes(`Sitemap: ${canonicalUrl("/sitemap.xml")}`)
  ) {
    fail("robots.txt: missing canonical sitemap line");
  }
  for (const headers of [BROWSER_HEADERS, TEXT_HEADERS]) {
    const response = await get("/definitely-missing", headers);
    secure(response, "/definitely-missing");
    if (response.status !== 404) {
      fail(`/definitely-missing: expected 404, got ${response.status}`);
    }
    await response.body?.cancel();
  }
  const method = await fetch(new URL("/docs", base), {
    method: "POST",
    headers: BROWSER_HEADERS,
    redirect: "manual",
  });
  secure(method, "POST /docs");
  if (method.status !== 405) fail(`POST /docs: status ${method.status}`);
  await method.body?.cancel();

  if (options.productionDomains === true) {
    for (
      const source of [
        "http://discern.sh/docs/",
        "https://www.discern.sh/docs/",
      ]
    ) {
      const response = await fetch(source, {
        headers: BROWSER_HEADERS,
        redirect: "manual",
      });
      secure(response, source);
      if (response.status !== 308) fail(`${source}: status ${response.status}`);
      if (response.headers.get("location") !== "https://discern.sh/docs") {
        fail(`${source}: location ${response.headers.get("location")}`);
      }
      await response.body?.cancel();
    }
  }

  if (options.externalLinks === true) {
    await parallel([...external], async (href) => {
      try {
        const response = await fetch(href, {
          headers: BROWSER_HEADERS,
          redirect: "follow",
          signal: AbortSignal.timeout(15_000),
        });
        if (
          response.status === 401 || response.status === 403 ||
          response.status === 429
        ) {
          inconclusiveExternal.push(`${href}: HTTP ${response.status}`);
        } else if (response.status >= 400) {
          fail(`external ${href}: HTTP ${response.status}`);
        }
        await response.body?.cancel();
      } catch (error) {
        inconclusiveExternal.push(`${href}: ${String(error)}`);
      }
    });
    observations.push(`${external.size} external links attempted`);
  } else {
    observations.push(
      `${external.size} unique external links not network-checked`,
    );
  }

  observations.unshift(
    `${routes.length} canonical HTML routes`,
    `${rawPages.length} pristine Markdown editions and negotiated text routes`,
    `${variants.length} canonical redirect variants`,
    `${redirectTable.redirects.size} declared historical redirects`,
    `${checkedInternal.size} linked non-HTML internal endpoints`,
    `${guidance.length} guidance pages in cross-surface parity`,
  );
  return {
    ok: failures.length === 0,
    base: base.href,
    observations,
    failures,
    inconclusiveExternal,
  };
}

async function selfHostedOptions(
  externalLinks: boolean,
): Promise<SiteSmokeResult> {
  let announce: ((port: number) => void) | undefined;
  const listening = new Promise<number>((resolve) => {
    announce = resolve;
  });
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: ({ port }) => announce?.(port),
  }, handler);
  try {
    const port = await listening;
    return await runSiteSmoke({
      base: new URL(`http://127.0.0.1:${port}/`),
      externalLinks,
    });
  } finally {
    await server.shutdown();
  }
}

if (import.meta.main) {
  const selfHost = Deno.args.includes("--self-host");
  const externalLinks = Deno.args.includes("--external-links");
  const productionDomains = Deno.args.includes("--production-domains");
  const target = Deno.args.find((arg) => !arg.startsWith("--"));
  if (!selfHost && target === undefined) {
    console.error(
      "usage: site_smoke.ts --self-host | <base-url> " +
        "[--production-domains] [--external-links]",
    );
    Deno.exit(2);
  }
  const result = selfHost
    ? await selfHostedOptions(externalLinks)
    : await runSiteSmoke({
      base: new URL(target ?? ""),
      externalLinks,
      productionDomains,
    });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) Deno.exit(1);
}
