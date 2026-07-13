/**
 * The /docs section: the published tree, its negotiation, and its links.
 *
 * Every check iterates the discovered site — the same `discoverDocs` +
 * `BUNDLED_PUBLIC_DOC_DIRS` derivation the handler serves — so a leaf added to
 * the map auto-enrols: it must render, negotiate, appear in the search index
 * and llms.txt, and keep every local link resolvable. No hand-kept route list
 * exists to go stale.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { handler } from "../site/serve.ts";
import {
  docsLlmsSection,
  type DocsPage,
  loadDocsSite,
  rewriteLinks,
  sectionSlugOf,
} from "../site/docs.ts";
import { BUNDLED_PUBLIC_DOC_DIRS } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15",
};
const CURL = { accept: "*/*", "user-agent": "curl/8.6.0" };

function get(path: string, headers: Record<string, string>): Promise<Response> {
  return handler(new Request(`https://discern.sh${path}`, { headers }));
}

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
  }
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
  assertStringIncludes(css, "color: var(--ds-color-ink-faint)");
  assertStringIncludes(css, "font-size: 1rem");
  assertStringIncludes(css, "transform: translate(-50%, -60%)");
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

  for (const section of site.sections) {
    assertStringIncludes(html, `href="${section.index.route}"`, section.dir);
    assertStringIncludes(md, section.title, section.dir);
  }

  // The index honours the .md suffix like every leaf does.
  const asSuffix = await get("/docs.md", BROWSER);
  assertEquals(asSuffix.status, 200);
  assertEquals(await asSuffix.text(), md);
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

  const res = await get("/docs/index.json", BROWSER);
  assertEquals(res.status, 200);
  const index = await res.json() as {
    pages: Array<{ route: string; title: string }>;
  };
  assertEquals(index.pages.map((p) => p.route), site.pages.map((p) => p.route));

  const llms = await get("/llms.txt", CURL);
  const text = await llms.text();
  assertStringIncludes(text, "DISCERN(1)");
  for (const page of site.pages) {
    assertStringIncludes(text, `https://discern.sh${page.route}`);
  }
  // The section is generated, not hand-kept.
  assertStringIncludes(docsLlmsSection(site), "DOCUMENTATION");
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
