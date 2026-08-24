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
import { DISCERN_FAVICON_PATH, DISCERN_MARK } from "../site/brand.ts";
import { DESIGN_SYSTEM_BUNDLES } from "../site/design_system.ts";
import { handler } from "../site/serve.ts";
import {
  createGlossaryProseRenderer,
  docsLlmsSection,
  type DocsPage,
  glossaryMentions,
  loadDocsSite,
  projectDocsPages,
  relatedDecisionCitations,
  rewriteLinks,
  sectionSlugOf,
} from "../site/docs.ts";
import type { DocEntry } from "../src/lib/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { docsResult } from "../src/commands/docs.ts";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
};
const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Project a configured map record path onto the route served by the docs site. */
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

/** Serve a docs route through the production handler with caller-controlled negotiation headers. */
function get(path: string, headers: Record<string, string>): Promise<Response> {
  return handler(new Request(`https://discern.sh${path}`, { headers }));
}

/** Build a minimal published document entry for route and navigation cases. */
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

/** Escape fixture text before embedding it in expected HTML attributes and content. */
function htmlEsc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Class tokens carried by the served docs top bar (the shell's <header>). */
function topBarClasses(pageHtml: string): Set<string> {
  const classes = new Set<string>();
  const header = pageHtml.match(/<header\b[\s\S]*?<\/header>/)?.[0] ?? "";
  for (const attr of header.matchAll(/class="([^"]*)"/g)) {
    for (const token of (attr[1] ?? "").split(/\s+/)) {
      if (token !== "") classes.add(token);
    }
  }
  return classes;
}

/** Vertical-nudge declarations in any rule that targets one of `classes`. */
function verticalNudges(css: string, classes: ReadonlySet<string>): string[] {
  const nudges: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    const targeted = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)]
      .some((cls) => classes.has(cls[1] ?? ""));
    if (!targeted) continue;
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

/** The repo-authored stylesheets a served docs page links. Generated
 * design-system bundles are excluded by their registry-declared output
 * prefixes — their rules are the package's, not this repo's to police. */
async function docsServedStylesheets(
  pageHtml: string,
): Promise<Array<[string, string]>> {
  const generated = Object.values(DESIGN_SYSTEM_BUNDLES).map((b) =>
    `/${b.output.slice("pages/".length)}`
  );
  const sheets: Array<[string, string]> = [];
  for (
    const link of pageHtml.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)
  ) {
    const href = link[1] ?? "";
    if (generated.some((prefix) => href.startsWith(prefix))) continue;
    const res = await get(href, BROWSER);
    assertEquals(res.status, 200, `stylesheet ${href} should be served`);
    sheets.push([href, await res.text()]);
  }
  return sheets;
}

Deno.test("the docs top-bar alignment guard catches a fresh-name vertical nudge", () => {
  const classes = topBarClasses(
    '<header class="fresh-chrome"><span class="fresh-identity-addon"></span></header>',
  );
  assertEquals(
    verticalNudges(
      ".fresh-identity-addon { margin-block-start: 2px; }",
      classes,
    ),
    [".fresh-identity-addon: margin-block-start: 2px"],
  );
  // Precision control: rules outside the top-bar class set stay unflagged.
  assertEquals(verticalNudges(".docs-nav { top: 56px; }", classes), []);
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

Deno.test("the full nav contains every published page exactly once in model order", async () => {
  const site = await loadDocsSite();
  const res = await get("/docs", BROWSER);
  const html = await res.text();
  const dom = new JSDOM(html);
  const nav = dom.window.document.querySelector(".docs-nav-scroll");
  const childRoutes = [...nav?.querySelectorAll("[data-nav-page] > a") ?? []]
    .map((link) => link.getAttribute("href") ?? "");
  assertEquals(
    childRoutes,
    site.sections.flatMap((section) => section.pages.map((page) => page.route)),
  );
  assertEquals(new Set(childRoutes).size, childRoutes.length);
  assertEquals(
    [...nav?.querySelectorAll("[data-nav-page] > a") ?? []]
      .filter((link) => link.textContent?.trim() === "Overview").length,
    site.sections.length,
  );
  assertEquals(
    nav?.querySelector("[data-nav-sections]")?.hasAttribute(
      "data-nav-default",
    ),
    false,
  );
  assertEquals(nav?.querySelector("[data-nav-disclosure]"), null);
  assertEquals(nav?.querySelectorAll("[hidden]").length, 0);
  const gate = site.sections.find((section) =>
    section.dir === "20-quality-gate"
  );
  assertEquals(gate?.pages[1]?.entry.slug, "when-the-gate-fails");
  dom.window.close();
});

Deno.test("every guide keeps the complete canonical nav and marks only itself", async () => {
  const site = await loadDocsSite();
  const canonicalRoutes = site.pages.map((page) => page.route);
  for (const current of site.pages) {
    const html = await (await get(current.route, BROWSER)).text();
    const dom = new JSDOM(html);
    const nav = dom.window.document.querySelector(".docs-nav-scroll");
    assertEquals(
      [...nav?.querySelectorAll("[data-nav-page] > a") ?? []].map((link) =>
        link.getAttribute("href")
      ),
      canonicalRoutes,
      current.route,
    );
    assertEquals(
      [...nav?.querySelectorAll('[aria-current="page"]') ?? []].map((link) =>
        link.getAttribute("href")
      ),
      [current.route],
      current.route,
    );
    assertEquals(
      nav?.querySelector(
        "[data-nav-disclosure], [data-nav-context], .docs-nav-relation, .docs-nav-scope",
      ),
      null,
      current.route,
    );
    dom.window.close();
  }
});

Deno.test("docs navigation foot keeps the three durable reference links visible", async () => {
  const site = await loadDocsSite();
  const expected = [
    ["Glossary", "/docs/orientation/glossary"],
    ["Commands", "/docs/reference/cli-reference"],
    ["Configuration", "/docs/reference/config-reference"],
  ];
  const decision = site.decisions.pages[0];
  for (
    const route of [
      "/docs",
      site.decisions.route,
      ...(decision === undefined ? [] : [decision.route]),
    ]
  ) {
    const html = await (await get(route, BROWSER)).text();
    const dom = new JSDOM(html);
    assertEquals(
      [...dom.window.document.querySelectorAll(".docs-nav-foot a")].map(
        (link) => [link.textContent?.trim(), link.getAttribute("href")],
      ),
      expected,
      route,
    );
    assertEquals(
      dom.window.document.querySelectorAll(
        ".docs-nav-scroll [aria-current='page']",
      ).length,
      0,
      route,
    );
    dom.window.close();
  }
});

Deno.test("the manual cover and colophon expose current, agent-friendly metadata", async () => {
  const site = await loadDocsSite();
  const guide = site.pages.find((page) => !page.isIndex);
  if (guide === undefined) throw new Error("docs fixture has no guide page");

  const indexDom = new JSDOM(await (await get("/docs", BROWSER)).text());
  assertEquals(
    indexDom.window.document.querySelector(".discern-kicker__index")
      ?.textContent,
    `v${KIT_VERSION}`,
  );
  assertEquals(
    indexDom.window.document.querySelector(".discern-kicker")?.textContent
      ?.replace(/\s+/g, " ").trim(),
    `v${KIT_VERSION}The Discern Manual`,
  );
  assertEquals(
    indexDom.window.document.querySelector(
      ".docs-chapters > .discern-divider[role='separator']",
    )?.className,
    "discern-divider discern-divider--canvas discern-divider--plain",
  );
  assert(DESIGN_SYSTEM_BUNDLES.docs.components.includes("divider"));
  indexDom.window.close();

  for (const route of ["/docs", guide.route]) {
    const dom = new JSDOM(await (await get(route, BROWSER)).text());
    const colophon = dom.window.document.querySelector(".docs-colophon");
    assertStringIncludes(
      colophon?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      "Plain text for agents:",
      route,
    );
    assertEquals(
      colophon?.textContent?.includes("This page is plain text too"),
      false,
      route,
    );
    assertEquals(
      [...colophon?.querySelectorAll(".docs-colophon-links a") ?? []].map(
        (link) => link.getAttribute("href"),
      )[0],
      "/llms.txt",
      route,
    );
    dom.window.close();
  }
});

Deno.test("every nested contents heading is unnumbered and does not advance sections", async () => {
  const site = await loadDocsSite();
  let pagesWithNestedHeadings = 0;

  for (const page of site.pages) {
    const dom = new JSDOM(await (await get(page.route, BROWSER)).text());
    const document = dom.window.document;
    const article = document.querySelector<HTMLElement>("article.doc-body");
    assert(article !== null, `${page.route}: missing docs article`);
    const items = [
      ...document.querySelectorAll<HTMLLIElement>(".docs-toc li"),
    ];
    const topLevel = items.filter((item) =>
      !item.classList.contains("discern-table-of-contents__item--nested")
    );
    const nested = items.filter((item) =>
      item.classList.contains("discern-table-of-contents__item--nested")
    );
    const authoredHeadings = [
      ...article.querySelectorAll<HTMLElement>("h2[id], h3[id]"),
    ].filter((heading) => heading.closest(".docs-section-index") === null);
    const topLevelHeadings = authoredHeadings.filter((heading) =>
      heading.tagName === "H2"
    );
    const nestedHeadings = authoredHeadings.filter((heading) =>
      heading.tagName === "H3"
    );
    if (nestedHeadings.length > 0) pagesWithNestedHeadings++;

    assertEquals(
      topLevel.map((item) =>
        item.querySelector(":scope > a")?.getAttribute("href")
      ),
      topLevelHeadings.map((heading) => `#${heading.id}`),
      page.route,
    );
    assertEquals(
      topLevel.map((item) =>
        item.querySelector(":scope > a > span")?.textContent
      ),
      topLevel.map((_, index) => String(index + 1).padStart(2, "0")),
      page.route,
    );
    assertEquals(
      nested.map((item) =>
        item.querySelector(":scope > a")?.getAttribute("href")
      ),
      nestedHeadings.map((heading) => `#${heading.id}`),
      page.route,
    );
    assertEquals(
      nested.every((item) => item.querySelector(":scope > a > span") === null),
      true,
      page.route,
    );
    dom.window.close();
  }

  assert(
    pagesWithNestedHeadings > 0,
    "the nested-heading guard needs at least one published example",
  );
});

Deno.test("the shared CLI/MCP docs core and site model have exact instruction parity", async () => {
  const site = await loadDocsSite();
  const docs = await docsResult(REPO_ROOT);
  assert(docs.ok && docs.data?.docs !== undefined);
  const docsItems = docs.data.docs.map((doc) => ({
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
  assertEquals(docsItems, siteItems);
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
      `class="discern-logo discern-logo--md discern-logo--plain discern-logo--natural discern-brand__mark" aria-hidden="true">${DISCERN_MARK}</span>`,
      `design-system brand on route ${page.route}`,
    );
    assertStringIncludes(
      html,
      `href="${DISCERN_FAVICON_PATH}"`,
      `favicon on route ${page.route}`,
    );
  }
});

Deno.test("glossary matching defaults, opt-outs, ordering, and ambiguity are explicit", () => {
  const live = glossaryMentions();
  const matchesFor = (term: string): string[] =>
    live.filter((mention) => mention.entry.term === term).map((mention) =>
      mention.text
    );
  assertEquals(matchesFor("Accept"), ["discern accept"]);
  assertEquals(matchesFor("Patterns"), ["discern patterns"]);
  assertEquals(matchesFor("Preset"), ["discern preset"]);
  assertEquals(matchesFor("Proof"), ["proof line"]);
  assertEquals(matchesFor("Proof note"), ["Proof note"]);
  assertEquals(matchesFor("Update"), ["discern update"]);

  assertEquals(
    glossaryMentions([
      {
        term: "Gate",
        definition: "The full check.",
        plain: { keep: "fixture" },
      },
      {
        term: "Gate job",
        definition: "One unit of gate work.",
        plain: { keep: "fixture" },
      },
    ]).map((mention) => mention.text),
    ["Gate job", "Gate"],
  );
  assertEquals(
    glossaryMentions([
      {
        term: "Hidden",
        definition: "A hidden term.",
        matches: [],
        plain: { keep: "fixture" },
      },
    ]),
    [],
  );
  assertThrows(
    () =>
      glossaryMentions([
        {
          term: "First",
          definition: "The first term.",
          matches: ["same phrase"],
          plain: { keep: "fixture" },
        },
        {
          term: "Second",
          definition: "The second term.",
          matches: ["Same phrase"],
          plain: { keep: "fixture" },
        },
      ]),
    Error,
    "belongs to both First and Second",
  );
});

Deno.test("bare common words stay plain while code-form matches link", async () => {
  const site = await loadDocsSite();
  const render = createGlossaryProseRenderer(site);
  assertEquals(
    render("accept the suggestion and update the docs"),
    "accept the suggestion and update the docs",
  );

  const dom = new JSDOM(
    `<article>${render("Run discern accept when ready.")}</article>`,
  );
  const document = dom.window.document;
  assertEquals(
    document.querySelector("dfn")?.textContent,
    "discern accept",
  );
  assertEquals(
    document.querySelector(".discern-glossary-term__term")?.textContent,
    "Accept",
  );
  assertEquals(
    document.querySelector(".discern-hover-card__panel")?.getAttribute(
      "aria-label",
    ),
    "Accept summary",
  );
  assertEquals(
    document.querySelector(".docs-glossary-link")?.getAttribute("href"),
    "/docs/orientation/glossary#accept",
  );
  dom.window.close();
});

Deno.test("first eligible glossary mentions render summaries and longest matches", async () => {
  const site = await loadDocsSite();
  const { html } = renderMarkdownHtml(
    [
      "# Gate job",
      "",
      "`Gate job` [Gate job](/already-linked) **Gate job**",
      "",
      "Gate job pairs with a gate. Gate job and gate follow.",
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
    "Gate job",
    "gate",
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
    assertEquals(card.getAttribute("data-discern-floating-root"), "");
    assertEquals(
      card.getAttribute("data-discern-floating-placement"),
      "top",
    );
    assertEquals(
      card.getAttribute("data-discern-floating-align"),
      "center",
    );
    assertEquals(trigger.tagName, "DFN");
    assertEquals(trigger.getAttribute("tabindex"), "0");
    assertEquals(trigger.getAttribute("data-discern-floating-trigger"), "");
    const panelId = trigger.getAttribute("aria-details");
    assert(panelId !== null);
    panelIds.add(panelId);
    const panel = card.querySelector<HTMLElement>(`#${panelId}`);
    assert(panel !== null);
    assertEquals(panel.getAttribute("data-discern-floating-panel"), "");
    assertEquals(panel.getAttribute("role"), "group");
    assertEquals(
      panel.getAttribute("aria-label"),
      `${index === 0 ? "Gate job" : "Gate"} summary`,
    );
    assertEquals(
      panel.querySelector(".discern-glossary-term__term")?.textContent,
      index === 0 ? "Gate job" : "Gate",
    );
  }
  assertEquals(panelIds.size, cards.length);

  const links = [...document.querySelectorAll<HTMLAnchorElement>(
    ".discern-glossary-term__definition a",
  )].map((link) => link.getAttribute("href"));
  assert(links.includes("/docs/orientation/glossary#gate-job"));
  assert(links.includes("/docs/orientation/glossary#stage"));
  assert(links.includes("/docs/orientation/glossary#scope"));
  assert(links.includes("/docs/orientation/glossary#standard"));
  assert(!html.includes("Every job is labeled"));
  assert(!html.includes("../20-quality-gate"));

  const glossaryLinks = [...document.querySelectorAll<HTMLAnchorElement>(
    ".docs-glossary-link",
  )];
  assertEquals(
    glossaryLinks.map((link) => link.getAttribute("href")),
    [
      "/docs/orientation/glossary#gate-job",
      "/docs/orientation/glossary#gate",
    ],
  );
  assertEquals(
    glossaryLinks.map((link) => link.getAttribute("aria-label")),
    [
      "Open Gate job in the glossary",
      "Open Gate in the glossary",
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

Deno.test("the built Worktrees page links Fleet without linking bare update", async () => {
  const site = await loadDocsSite();
  const worktrees = site.sections.find((section) =>
    section.dir === "30-worktrees"
  );
  assert(worktrees !== undefined);
  const response = await get(worktrees.index.route, BROWSER);
  const dom = new JSDOM(await response.text());
  const document = dom.window.document;
  const triggers = [...document.querySelectorAll("dfn")].map((node) =>
    node.textContent?.toLowerCase()
  );

  assert(document.body.textContent?.includes("inspect, update, land"));
  assert(triggers.includes("fleet"));
  assert(!triggers.includes("update"));
  dom.window.close();
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
  assertStringIncludes(css, `content: "${DISCERN_MARK}";`);
  assertStringIncludes(css, "color: var(--discern-color-ink-faint)");
  assertStringIncludes(css, "font-size: 1rem");
  assertStringIncludes(css, "transform: translate(-50%, -60%)");
});

Deno.test("the docs rails scroll flush beneath the header and footer rule", async () => {
  const css = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.css", import.meta.url),
  );
  assertStringIncludes(
    css,
    ".docs-nav {\n  position: sticky;\n  top: 56px;",
  );
  assertStringIncludes(css, "padding-block: 0 var(--discern-space-4);");
  assertStringIncludes(
    css,
    ".docs-nav-scroll {\n  flex: 1;\n  overflow-y: auto;\n  padding-block-start: var(--discern-space-8);",
  );
  assertStringIncludes(css, "margin-top: 0;");
  assertEquals(css.includes(".docs-chapters::before"), false);
  assertEquals(css.includes(".docs-toc-d3"), false);
  assertEquals(css.includes(".docs-nav-disclosure"), false);
});

Deno.test("the docs top bar aligns its children without vertical nudges", async () => {
  const html = await (await get("/docs", BROWSER)).text();
  const classes = topBarClasses(html);
  assert(classes.has("docs-top"), "the served shell should carry the top bar");
  const sheets = await docsServedStylesheets(html);
  assert(sheets.length > 0, "docs pages should link repo-authored stylesheets");
  const failures = sheets.flatMap(([href, css]) =>
    verticalNudges(css, classes).map((nudge) => `${href} → ${nudge}`)
  );
  assertEquals(failures, []);
});

/** Every size a stylesheet pins on a `code` element: explicit `font-size`
 * declarations plus `font` shorthands (whose second slot carries a size). */
function codeFontSizes(css: string): string[] {
  const sizes: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (!/(?:^|[^.#\w-])code\b/.test(selector)) continue;
    for (const declaration of (match[2] ?? "").split(";")) {
      const [prop = "", ...rest] = declaration.split(":");
      const name = prop.trim();
      if (name === "font-size" || name === "font") {
        sizes.push(`${selector} → ${name}: ${rest.join(":").trim()}`);
      }
    }
  }
  return sizes;
}

Deno.test("the code-scale guard catches a fresh-name code size", () => {
  assertEquals(
    codeFontSizes(".fresh-panel samp code { font-size: 0.8125em; }"),
    [".fresh-panel samp code → font-size: 0.8125em"],
  );
  // Precision controls: neither a non-code rule nor a lookalike substring
  // (`decode`) is the guard's business.
  assertEquals(codeFontSizes(".decode-btn { font-size: 2em; }"), []);
  assertEquals(codeFontSizes(".docs-copy { font-size: 2em; }"), []);
});

Deno.test("inline code shares one readable optical scale across docs content", async () => {
  const html = await (await get("/docs", BROWSER)).text();
  const sheets = await docsServedStylesheets(html);
  const sizes = sheets
    .flatMap(([href, css]) => codeFontSizes(css).map((s) => `${href} ${s}`))
    .sort();
  // The complete code-sizing canon: inline code rides just under the running
  // text; code sheets keep their own fixed scale. Any other code sizing — the
  // undersized legacy 0.8125em included — must join this set deliberately.
  assertEquals(sizes, [
    "/assets/docs.css .doc-body pre > code → font: 400 0.8125rem/1.7 var(--discern-font-mono)",
    "/assets/docs.css .docs-main :not(pre) > code → font-size: 0.9em",
  ]);
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
  assertStringIncludes(indexHtml, "not current product documentation");
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
  let ordinaryCitationCount = 0;
  for (const page of site.pages) {
    const res = await get(page.route, BROWSER);
    const html = await res.text();
    const dom = new JSDOM(html);
    const links = [...dom.window.document.querySelectorAll<HTMLAnchorElement>(
      ".docs-related-decision",
    )];
    const glossary = page.mapPath === "00-orientation/glossary.md";
    const expectedCitations = relatedDecisionCitations(page);
    if (!glossary) ordinaryCitationCount += expectedCitations.length;
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
  assert(
    ordinaryCitationCount > 0,
    "the policy must preserve citations on ordinary documentation pages",
  );
});

Deno.test("unpublished tiers never surface under /docs", async () => {
  const prefix = `${REPO_AUTHORED_PATHS.mapRel}/`;
  const files = await structuralGuardScope({
    guard: "tests/site_docs_test.ts#unpublished-map-tiers",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "The unpublished-tier complement is derived from every Markdown-bearing directory in the configured map.",
      include: (path) => path.startsWith(prefix),
    },
  });
  const tiers = [
    ...new Set(files.flatMap((rel) => {
      const within = rel.slice(prefix.length);
      const tier = within.split("/")[0];
      return within.includes("/") && tier !== undefined ? [tier] : [];
    })),
  ];
  for (const tier of tiers) {
    if (BUNDLED_PUBLIC_DOC_DIRS.includes(tier)) continue;
    const res = await get(`/docs/${sectionSlugOf(tier)}`, BROWSER);
    assertEquals(res.status, 404, `tier ${tier} must not publish`);
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
  const instructionRoutes = ["/docs", ...site.pages.map((page) => page.route)];

  const res = await get("/docs/index.json", BROWSER);
  assertEquals(res.status, 200);
  const index = await res.json() as {
    pages: Array<{ route: string; title: string }>;
  };
  assertEquals(index.pages.map((p) => p.route), instructionRoutes);
  assertEquals(index.pages[0]?.title, "The discern manual");
  for (const decision of site.decisions.pages) {
    assert(
      !index.pages.some((page) => page.route === decision.route),
      decision.route,
    );
  }

  const llms = await get("/llms.txt", CURL);
  const text = await llms.text();
  assert(
    text.startsWith("# discern\n\n> "),
    "llms.txt opens with the H1 and summary blockquote the convention requires",
  );
  assertStringIncludes(
    text,
    "- [The discern manual](https://discern.sh/docs):",
    "llms.txt lists the manual front door with its canonical label",
  );
  for (const page of site.pages) {
    assertStringIncludes(text, `https://discern.sh${page.route}`);
  }
  assert(!text.includes(site.decisions.route));
  // The section is generated, not hand-kept.
  assertStringIncludes(docsLlmsSection(site), "## Documentation");
});

Deno.test("the sitemap source contains instructions and project-history routes", async () => {
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
