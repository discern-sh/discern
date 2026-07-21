/**
 * The /docs section: the published tree, its negotiation, and its links.
 *
 * Every check iterates the discovered site — the same `discoverDocs` +
 * `BUNDLED_PUBLIC_DOC_DIRS` derivation the handler serves — so a leaf added to
 * the map auto-enrols: it must render, negotiate, appear in the search index
 * and llms.txt, and keep every local link resolvable. No hand-kept route list
 * exists to go stale.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { DISCERN_FAVICON_PATH } from "../site/brand.ts";
import { handler } from "../site/serve.ts";
import {
  createGlossaryProseRenderer,
  docsLlmsSection,
  type DocsPage,
  loadDocsSite,
  projectDocsPages,
  rewriteLinks,
  sectionSlugOf,
} from "../site/docs.ts";
import type { DocEntry } from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { helpResult } from "../src/commands/docs.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
};
const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

function helpRecordRoute(path: string): string {
  const rel = path.replace(/^(?:map|docs)\//, "");
  if (rel === "README.md") return "/docs";
  const parts = rel.split("/");
  const section = (parts[0] ?? "").replace(/^\d+-/, "");
  const filename = parts.at(-1) ?? "";
  return filename.toLowerCase() === "readme.md"
    ? `/docs/${section}`
    : `/docs/${section}/${filename.replace(/\.md$/, "")}`;
}

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return handler(new Request(`https://discern.sh${path}`, { headers }));
}

function fixtureEntry(
  relToDocs: string,
  section: string,
  slug: string,
): DocEntry {
  return {
    path: `map/${relToDocs}`,
    absPath: `/fixture/map/${relToDocs}`,
    relToDocs,
    section,
    slug,
    title: slug,
    description: "Fixture description.",
    publish: true,
    order: undefined,
    aliases: [],
    redirectFrom: [],
    citedAdrs: [],
  };
}

function htmlEsc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function docsTopBarVerticalNudges(css: string): string[] {
  const start = css.indexOf("/* ── Top bar");
  const end = css.indexOf("/* ── Chapter nav", start);
  if (start < 0 || end <= start) return ["missing top-bar boundary"];
  const topBar = css.slice(start, end);
  const nudges: string[] = [];
  for (const match of topBar.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    for (const declaration of (match[2] ?? "").split(";")) {
      const value = declaration.trim();
      if (
        /^(?:align-self|(?:margin|padding)-(?:block(?:-start|-end)?|top|bottom)|inset-block(?:-start|-end)?|top|bottom|translate|transform)\s*:/
          .test(
            value,
          )
      ) {
        nudges.push(`${selector}: ${value}`);
      }
    }
  }
  return nudges;
}

Deno.test("the docs top-bar alignment guard catches a fresh-name vertical nudge", () => {
  const fixture = `
    /* ── Top bar ── */
    .fresh-identity-addon { margin-block-start: 2px; }
    /* ── Chapter nav ── */
  `;
  assertEquals(
    docsTopBarVerticalNudges(fixture),
    [".fresh-identity-addon: margin-block-start: 2px"],
  );
});

Deno.test("the published docs site covers exactly the bundled-public sections", async () => {
  const site = await loadDocsSite();
  assertEquals(
    site.sections.map((s) => s.dir),
    [...BUNDLED_PUBLIC_DOC_DIRS],
  );
  // Stripped section slugs stay collision-free (buildDocsSite throws on a
  // clash; reaching here proves it) and every page's route reflects one.
  for (const page of site.pages) {
    assert(
      page.route.startsWith(`/docs/${page.sectionSlug}`),
      `route ${page.route} carries its section slug`,
    );
    assert(
      !/\/\d+-/.test(page.route),
      `route ${page.route} has no numeric tier prefix`,
    );
  }
});

Deno.test("the nav exposes every published page in model reading order", async () => {
  const site = await loadDocsSite();
  const res = await get("/docs", BROWSER);
  const html = await res.text();
  const nav = /<nav class="[^"]*docs-nav-scroll[^"]*"[^>]*>([\s\S]*?)<\/nav>/
    .exec(html)
    ?.[1] ?? "";
  const childRoutes = [...nav.matchAll(/<li><a href="([^"]+)"/g)].map((match) =>
    match[1] ?? ""
  );
  assertEquals(
    childRoutes,
    site.sections.flatMap((section) => section.pages.map((page) => page.route)),
  );
  assertEquals(
    [...nav.matchAll(/>Overview<\/a>/g)].length,
    site.sections.length,
  );
  const gate = site.sections.find((section) =>
    section.dir === "20-quality-gate"
  );
  assertEquals(gate?.pages[1]?.entry.slug, "when-the-gate-fails");
});

Deno.test("the shared CLI/MCP help core and site model have exact guidance parity", async () => {
  const site = await loadDocsSite();
  const help = await helpResult(REPO_ROOT);
  assert(help.ok && help.data?.docs !== undefined);
  const helpItems = help.data.docs.map((doc) => ({
    route: helpRecordRoute(doc.path),
    title: doc.title,
  }));
  const siteItems = [
    { route: site.landing.route, title: site.landing.entry.title },
    ...site.pages.map((page) => ({
      route: page.route,
      title: page.entry.title,
    })),
  ];
  assertEquals(helpItems, siteItems);
});

Deno.test("the docs projection refuses orphan shapes", () => {
  assertThrows(
    () =>
      projectDocsPages(
        [fixtureEntry("loose.md", "", "loose")],
        ["20-quality-gate"],
      ),
    Error,
    "has no section",
  );
  assertThrows(
    () =>
      projectDocsPages(
        [
          fixtureEntry(
            "20-quality-gate/leaf.md",
            "20-quality-gate",
            "leaf",
          ),
        ],
        ["20-quality-gate"],
      ),
    Error,
    "has no public README",
  );
});

Deno.test("section landings derive their leaf index from model metadata", async () => {
  const site = await loadDocsSite();
  for (const section of site.sections) {
    const res = await get(section.index.route, BROWSER);
    const html = await res.text();
    const generated = /<section class="docs-section-index"[\s\S]*?<\/section>/
      .exec(html)?.[0] ?? "";
    const leaves = section.pages.filter((page) => !page.isIndex);
    assert(generated.length > 0, section.dir);
    assertEquals(
      [...generated.matchAll(/<li><a href="([^"]+)"/g)].map((match) =>
        match[1] ?? ""
      ),
      leaves.map((page) => page.route),
      section.dir,
    );
    for (const leaf of leaves) {
      assertStringIncludes(
        generated,
        htmlEsc(leaf.entry.title),
        leaf.entry.path,
      );
      assertStringIncludes(
        generated,
        htmlEsc(leaf.entry.description),
        leaf.entry.path,
      );
    }
    if (section.dir === "20-quality-gate") {
      assert(!html.includes('href="#in-this-section"'));
    }
  }
});

Deno.test("every published page renders for a browser, with title and shell", async () => {
  const site = await loadDocsSite();
  for (const page of site.pages) {
    const res = await get(page.route, BROWSER);
    assertEquals(res.status, 200, `route ${page.route}`);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/html",
      `route ${page.route}`,
    );
    const html = await res.text();
    assertStringIncludes(html, "<title>", `route ${page.route}`);
    assertStringIncludes(html, 'class="doc-body"', `route ${page.route}`);
    assertStringIncludes(
      html,
      'class="discern-logo discern-logo--md discern-logo--plain discern-logo--natural discern-brand__mark" aria-hidden="true">◮</span>',
      `design-system brand on route ${page.route}`,
    );
    assertStringIncludes(
      html,
      `href="${DISCERN_FAVICON_PATH}"`,
      `favicon on route ${page.route}`,
    );
  }
});

Deno.test("first eligible glossary mentions render the design-system hover-card contract", async () => {
  const site = await loadDocsSite();
  const { html } = renderMarkdownHtml(
    [
      "# Worktree resource",
      "",
      "`Worktree resource` [Worktree resource](/already-linked) **Worktree resource**",
      "",
      "Worktree resource pairs with a worktree. Worktree resource and worktree follow.",
    ].join("\n"),
    { renderProseText: createGlossaryProseRenderer(site) },
  );
  const dom = new JSDOM(`<article>${html}</article>`);
  const document = dom.window.document;
  const cards = [...document.querySelectorAll<HTMLElement>(
    ".discern-glossary-term",
  )];
  const triggers = cards.map((card) => card.querySelector("dfn"));

  assertEquals(cards.length, 2);
  assertEquals(triggers.map((trigger) => trigger?.textContent), [
    "Worktree resource",
    "worktree",
  ]);
  assertEquals(
    document.querySelector("h1 .discern-glossary-term"),
    null,
  );
  assertEquals(
    document.querySelector("code .discern-glossary-term"),
    null,
  );
  assertEquals(
    document.querySelector("a .discern-glossary-term"),
    null,
  );
  assertEquals(
    document.querySelector("strong .discern-glossary-term"),
    null,
  );

  const panelIds = new Set<string>();
  for (const [index, card] of cards.entries()) {
    const trigger = triggers[index];
    assert(trigger !== null && trigger !== undefined);
    assertEquals(trigger.tagName, "DFN");
    assertEquals(trigger.getAttribute("tabindex"), "0");
    const panelId = trigger.getAttribute("aria-details");
    assert(panelId !== null);
    panelIds.add(panelId);
    const panel = card.querySelector<HTMLElement>(`#${panelId}`);
    assert(panel !== null);
    assertEquals(panel.getAttribute("role"), "group");
    assertEquals(
      panel.getAttribute("aria-label"),
      `${trigger.textContent} definition`,
    );
    assertEquals(
      panel.querySelector(".discern-glossary-term__term")?.textContent,
      trigger.textContent,
    );
  }
  assertEquals(panelIds.size, cards.length);

  const links = [...document.querySelectorAll<HTMLAnchorElement>(
    ".discern-glossary-term__definition a",
  )].map((link) => link.getAttribute("href"));
  assert(links.includes("/docs/orientation/glossary#worktree-resource"));
  assert(links.includes("/docs/worktrees"));
  assert(!html.includes("../30-worktrees"));
  assert(!html.includes("ADR 0025"));

  const glossaryLinks = [...document.querySelectorAll<HTMLAnchorElement>(
    ".docs-glossary-link",
  )];
  assertEquals(
    glossaryLinks.map((link) => link.getAttribute("href")),
    [
      "/docs/orientation/glossary#worktree-resource",
      "/docs/orientation/glossary#worktree",
    ],
  );
  assertEquals(
    glossaryLinks.map((link) => link.getAttribute("aria-label")),
    [
      "Open Worktree resource in the glossary",
      "Open worktree in the glossary",
    ],
  );
  dom.window.close();
});

Deno.test("published Markdown pages wire glossary cards into the docs shell", async () => {
  const site = await loadDocsSite();
  const worktrees = site.sections.find((section) =>
    section.dir === "30-worktrees"
  );
  assert(worktrees !== undefined);
  const response = await get(worktrees.index.route, BROWSER);
  const html = await response.text();
  assertStringIncludes(html, "discern-glossary-term");
  assertStringIncludes(html, "discern-hover-card__panel");
  assertStringIncludes(html, "discern-dotted-underline");
  assertStringIncludes(html, "aria-details=");
});

Deno.test("rendered Markdown rules use the editorial discern mark", async () => {
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  const ruleStart = css.indexOf(".doc-body hr {");
  const ruleEnd = css.indexOf("}", ruleStart);
  assert(ruleStart >= 0 && ruleEnd > ruleStart);
  const rule = css.slice(ruleStart, ruleEnd + 1);
  assert(!rule.includes("repeating-linear-gradient"));
  assertStringIncludes(rule, "background-size: 100% 1px");
  assertStringIncludes(css, ".doc-body hr::after {");
  assertStringIncludes(css, 'content: "◮";');
  assertStringIncludes(css, "color: var(--discern-color-ink-faint)");
  assertStringIncludes(css, "font-size: 1rem");
  assertStringIncludes(css, "transform: translate(-50%, -60%)");
});

Deno.test("the docs top bar aligns its children without vertical nudges", async () => {
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  assertEquals(docsTopBarVerticalNudges(css), []);
});

Deno.test("every published page serves its pristine Markdown to text clients and via .md", async () => {
  const site = await loadDocsSite();
  for (const page of site.pages) {
    const raw = await Deno.readTextFile(page.entry.absPath);

    const asCurl = await get(page.route, CURL);
    assertEquals(asCurl.status, 200, `route ${page.route}`);
    assertStringIncludes(
      asCurl.headers.get("vary") ?? "",
      "User-Agent",
      `route ${page.route}`,
    );
    assertEquals(await asCurl.text(), raw, `curl ${page.route}`);

    const asSuffix = await get(`${page.route}.md`, BROWSER);
    assertEquals(asSuffix.status, 200, `route ${page.route}.md`);
    assertEquals(await asSuffix.text(), raw, `suffix ${page.route}.md`);
  }
});

Deno.test("the /docs index lists every section for both readers", async () => {
  const site = await loadDocsSite();

  const asHtml = await get("/docs", BROWSER);
  assertEquals(asHtml.status, 200);
  const html = await asHtml.text();
  const asText = await get("/docs", CURL);
  assertEquals(asText.status, 200);
  const md = await asText.text();
  const rootSource = await Deno.readTextFile(
    new URL("../project/map/README.md", import.meta.url),
  );
  assertEquals(md, rootSource, "the manual front door keeps the raw contract");

  for (const section of site.sections) {
    assertStringIncludes(html, `href="${section.index.route}"`, section.dir);
    assertStringIncludes(md, `${section.dir}/`, section.dir);
  }

  // The index honours the .md suffix like every leaf does.
  const asSuffix = await get("/docs.md", BROWSER);
  assertEquals(asSuffix.status, 200);
  assertEquals(await asSuffix.text(), md);
});

Deno.test("the decisions family renders every record as labeled project history", async () => {
  const site = await loadDocsSite();
  const indexRes = await get(site.decisions.route, BROWSER);
  assertEquals(indexRes.status, 200);
  const indexHtml = await indexRes.text();
  assertStringIncludes(indexHtml, "Project history");
  assertStringIncludes(indexHtml, "not current product guidance");
  const indexSource = await Deno.readTextFile(
    new URL("../project/map/_adr/README.md", import.meta.url),
  );
  const indexMarkdown = await get(`${site.decisions.route}.md`, BROWSER);
  assertEquals(
    await indexMarkdown.text(),
    indexSource,
    "the decisions front door keeps the raw contract",
  );

  const superseded = site.decisions.pages.filter((page) => page.superseded);
  assert(superseded.length > 0, "the history fixture includes retired records");
  assertEquals(
    [...indexHtml.matchAll(/docs-decision-status">Superseded/g)].length,
    superseded.length,
  );

  for (const page of site.decisions.pages) {
    assertStringIncludes(indexHtml, `href="${page.route}"`, page.entry.path);
    const res = await get(page.route, BROWSER);
    assertEquals(res.status, 200, page.route);
    const html = await res.text();
    assertStringIncludes(html, "Project history", page.route);
    assertStringIncludes(html, "docs-decision-record", page.route);
    assertEquals(
      html.includes("Superseded record."),
      page.superseded,
      page.route,
    );

    const raw = await Deno.readTextFile(page.entry.absPath);
    const textRes = await get(`${page.route}.md`, BROWSER);
    assertEquals(await textRes.text(), raw, `${page.route}.md`);
  }
});

Deno.test("decisions stay outside the sidebar and enter through the colophon", async () => {
  const site = await loadDocsSite();
  const res = await get("/docs", BROWSER);
  const html = await res.text();
  const sidebar = /<aside class="docs-nav"[\s\S]*?<\/aside>/.exec(html)?.[0] ??
    "";
  assert(!sidebar.includes(`href="${site.decisions.route}"`));
  assertStringIncludes(
    html,
    `<a href="${site.decisions.route}">Project decisions</a>`,
  );
});

Deno.test("ADR links rewrite to decision routes", async () => {
  const site = await loadDocsSite();
  const page = site.pages[0];
  const active = site.decisions.pages.find((candidate) =>
    !candidate.superseded
  );
  const superseded = site.decisions.pages.find((candidate) =>
    candidate.superseded
  );
  assert(
    page !== undefined && active !== undefined && superseded !== undefined,
  );
  assertEquals(
    rewriteLinks(
      `[record](../_adr/${active.entry.relToDocs})`,
      page,
      site,
    ),
    `[record](${active.route})`,
  );
  assertEquals(
    rewriteLinks(
      `[record](../_adr/${superseded.entry.relToDocs})`,
      page,
      site,
    ),
    `[record](${superseded.route})`,
  );
});

Deno.test("related decisions render exactly the collected citation set", async () => {
  const site = await loadDocsSite();
  for (const page of site.pages) {
    const res = await get(page.route, BROWSER);
    const html = await res.text();
    const dom = new JSDOM(html);
    const links = [...dom.window.document.querySelectorAll<HTMLAnchorElement>(
      ".docs-related-decision",
    )];
    const glossary = page.mapPath === "00-orientation/glossary.md";
    const expectedCitations = glossary ? [] : page.entry.citedAdrs;
    assertEquals(links.length, expectedCitations.length, page.entry.path);
    assertEquals(
      links.map((link) => link.getAttribute("href")),
      expectedCitations.map((citation) => {
        const decision = site.decisions.byNumber.get(citation.number);
        assert(decision !== undefined, citation.number);
        return decision.route;
      }),
      page.entry.path,
    );
    for (const [index, citation] of expectedCitations.entries()) {
      const link = links[index];
      const decision = site.decisions.byNumber.get(citation.number);
      assert(link !== undefined && decision !== undefined);
      assertEquals(link.textContent, `ADR ${citation.number}`);
      assertEquals(link.closest("li")?.textContent, decision.entry.title);
    }
    if (glossary) {
      assert(
        page.entry.citedAdrs.length > 0,
        "the glossary fixture carries decisions so its exception is exercised",
      );
      assertEquals(
        dom.window.document.querySelector(".docs-related-decisions"),
        null,
      );
    }
    dom.window.close();
  }
});

Deno.test("unpublished tiers never surface under /docs", async () => {
  // The complement of the allowlist, read from disk so a new tier auto-enrols.
  for await (const entry of Deno.readDir(REPO_AUTHORED_PATHS.map)) {
    if (!entry.isDirectory) continue;
    if (BUNDLED_PUBLIC_DOC_DIRS.includes(entry.name)) continue;
    const res = await get(`/docs/${sectionSlugOf(entry.name)}`, BROWSER);
    assertEquals(res.status, 404, `tier ${entry.name} must not publish`);
    await res.body?.cancel();
  }
});

Deno.test("every local link in every published page resolves — no dead ends", async () => {
  const site = await loadDocsSite();
  const failures: string[] = [];
  for (const page of site.pages) {
    const raw = await Deno.readTextFile(page.entry.absPath);
    const { body } = parseFrontmatter(raw);
    const rewritten = rewriteLinks(body, page, site);
    for (const m of rewritten.matchAll(/\]\(([^()\s]+)\)/g)) {
      const dest = m[1] ?? "";
      // After rewriting, a well-formed page contains only: fragments,
      // site-absolute routes, or absolute URLs. A surviving relative path is
      // a link the rewriter could not place — a dead end on the site.
      if (
        dest.startsWith("#") || dest.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(dest)
      ) {
        // Site-absolute destinations must actually exist as routes.
        if (
          dest.startsWith("/docs/") &&
          dest.replace(/#.*$/, "") !== site.decisions.route &&
          !site.byRoute.has(dest.replace(/#.*$/, ""))
        ) {
          failures.push(`${page.entry.path}: broken route ${dest}`);
        }
        continue;
      }
      failures.push(`${page.entry.path}: unresolved link ${dest}`);
    }
  }
  assertEquals(failures, []);
});

Deno.test("the search index and llms.txt cover every published page", async () => {
  const site = await loadDocsSite();
  const guidanceRoutes = ["/docs", ...site.pages.map((page) => page.route)];

  const res = await get("/docs/index.json", BROWSER);
  assertEquals(res.status, 200);
  const index = await res.json() as {
    pages: Array<{ route: string; title: string }>;
  };
  assertEquals(index.pages.map((p) => p.route), guidanceRoutes);
  assertEquals(index.pages[0]?.title, "The discern manual");
  for (const decision of site.decisions.pages) {
    assert(
      !index.pages.some((page) => page.route === decision.route),
      decision.route,
    );
  }

  const llms = await get("/llms.txt", CURL);
  const text = await llms.text();
  assertStringIncludes(text, "DISCERN(1)");
  assert(
    /https:\/\/discern\.sh\/docs\s+The discern manual/.test(text),
    "llms.txt lists the manual front door with its canonical label",
  );
  for (const page of site.pages) {
    assertStringIncludes(text, `https://discern.sh${page.route}`);
  }
  assert(!text.includes(site.decisions.route));
  // The section is generated, not hand-kept.
  assertStringIncludes(docsLlmsSection(site), "DOCUMENTATION");
});

Deno.test("the sitemap source contains guidance and project-history routes", async () => {
  const site = await loadDocsSite();
  assertEquals(site.sitemapRoutes, [
    "/docs",
    ...site.pages.map((page) => page.route),
    site.decisions.route,
    ...site.decisions.pages.map((page) => page.route),
  ]);
});

Deno.test("docs 404s answer in the reader's own format", async () => {
  const asHtml = await get("/docs/no-such-doc", BROWSER);
  assertEquals(asHtml.status, 404);
  assertStringIncludes(asHtml.headers.get("content-type") ?? "", "text/html");
  await asHtml.body?.cancel();

  const asText = await get("/docs/no-such-doc", CURL);
  assertEquals(asText.status, 404);
  assertStringIncludes(asText.headers.get("content-type") ?? "", "text/plain");
  await asText.body?.cancel();
});

Deno.test("descriptions surface on every page of the reading order", async () => {
  const site = await loadDocsSite();
  // Section landing pages always have a lead paragraph to derive from; a
  // missing one means a README lost its opening prose.
  for (const section of site.sections) {
    assert(
      section.description.length > 0,
      `section ${section.dir} has a derived description`,
    );
  }
  // Prev/next follows discovery's reading order exactly.
  const first = site.pages[0];
  assert(first !== undefined && first.isIndex, "reading order opens a section");
});

Deno.test("a frontmatter publish:false leaf disappears from every surface", async () => {
  // Structural: the handler's filter honours entry.publish. Exercised against
  // a synthetic page rather than mutating the real map.
  const site = await loadDocsSite();
  const withheld = site.pages.filter((p: DocsPage) => !p.entry.publish);
  assertEquals(withheld, []);
});
