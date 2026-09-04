/** End-to-end parity for every projection of the canonical product manual. */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  stageBundledManual,
  stripManualSourceComments,
} from "../scripts/build.ts";
import {
  type DocsLanding,
  docsLlmsSection,
  type DocsSite,
  loadDocsSite,
  projectManualPages,
} from "../site/docs.ts";
import { buildSiteRedirectTable, docsLlmsFullText } from "../site/seo.ts";
import { liveHtmlRoutes } from "../site/serve.ts";
import { buildSearchIndex } from "../site/search.ts";
import {
  DOCS_AGENT_CONTEXT_HINT,
  docsResult,
  mapResult,
} from "../src/commands/docs.ts";
import {
  buildRedirectRegistry,
  canonicalDocTarget,
  discoverDocs,
} from "../src/lib/docs.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import {
  buildManualProjection,
  type ManualProjection,
} from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { runCli, seedConfig, withTempDir } from "./helpers.ts";

/** Load the repository manual through the same strict projection as consumers. */
async function repositoryManual(): Promise<ManualProjection> {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: resolveRepositoryManualDir(REPO_ROOT).abs,
  });
  assert(tree !== undefined);
  return await buildManualProjection(tree.entries);
}

Deno.test("all delivery projections agree on canonical manual page identities", async () => {
  const manual = await repositoryManual();
  const expectedIds = manual.pages.map((page) => page.id);
  const expectedRoutes = manual.pages.map((page) => page.route);
  const expectedRecords = manual.pages.map((page) => ({
    target: canonicalDocTarget(page.entry),
    page_id: page.id,
    manual_kind: page.kind,
  }));

  const site = await loadDocsSite();
  assertEquals(
    [site.landing, ...site.pages].map((page) => page.entry.pageId),
    expectedIds,
  );

  const result = await docsResult(REPO_ROOT);
  assert(result.ok && result.data?.docs !== undefined);
  assertEquals(
    result.data.docs.map((record) => ({
      target: record.target,
      page_id: record.page_id,
      manual_kind: record.manual_kind,
    })),
    expectedRecords,
  );
  for (const expected of expectedRecords) {
    const exact = await docsResult(REPO_ROOT, { target: expected.target });
    assert(exact.ok && exact.data?.doc !== undefined, expected.target);
    assertEquals(
      {
        target: exact.data.doc.target,
        page_id: exact.data.doc.page_id,
        manual_kind: exact.data.doc.manual_kind,
      },
      expected,
      expected.target,
    );
  }

  const search = await buildSearchIndex([
    { route: site.landing.route, section: "Manual", entry: site.landing.entry },
    ...site.pages.map((page) => ({
      route: page.route,
      section: page.sectionSlug,
      entry: page.entry,
    })),
  ]);
  assertEquals(
    search.pages.map((page) => ({ route: page.route, kind: page.kind })),
    manual.pages.map((page) => ({ route: page.route, kind: page.kind })),
  );

  // The sitemap also carries project history and the separately admitted Map.
  // Select only the manual's canonical identities before comparing surfaces.
  const expectedRouteSet = new Set(expectedRoutes);
  const manualSitemap = site.sitemapRoutes.filter((route) =>
    expectedRouteSet.has(route)
  );
  assertEquals(manualSitemap, expectedRoutes);
  const llms = docsLlmsSection(site);
  for (const route of expectedRoutes) {
    const target = `](https://discern.sh${route})`;
    assertEquals(llms.split(target).length - 1, 1, route);
  }
  assert(!llms.includes("](https://discern.sh/map"));
  assert(!llms.includes(DOCS_AGENT_CONTEXT_HINT));
  assert(!llms.includes("<nav"));

  const full = await docsLlmsFullText(site);
  for (const page of manual.pages) {
    const url = `https://discern.sh${page.route}`;
    const source = await Deno.readTextFile(page.entry.absPath);
    const { body } = parseFrontmatter(source);
    const chunk = `<!-- BEGIN ${url} -->\n\n${body.trim()}\n\n` +
      `<!-- END ${url} -->`;
    assertStringIncludes(full, chunk, page.id);
    assertEquals(full.split(`<!-- BEGIN ${url} -->`).length - 1, 1, page.id);
  }
  assertEquals(
    full.split("<!-- BEGIN https://discern.sh/docs").length - 1,
    manual.pages.length,
  );
  assert(!full.includes("<!-- BEGIN https://discern.sh/map"));
  assert(!full.includes("<!-- BEGIN https://discern.sh/docs/decisions"));
  assert(!full.includes(DOCS_AGENT_CONTEXT_HINT));
  assert(!full.includes("<nav"));

  const redirects = buildRedirectRegistry(manual.pages.map((page) => ({
    route: page.route,
    redirectFrom: page.entry.redirectFrom,
  })));
  assertEquals(redirects.issues, []);
  assertEquals(redirects.redirects.size, 0);
  const liveRoutes = new Set(expectedRoutes);
  for (const [source, target] of redirects.redirects) {
    assert(!liveRoutes.has(source), `${source} must not also be a live route`);
    assert(
      liveRoutes.has(target),
      `${source} must redirect directly to ${target}`,
    );
  }

  // The served site table must carry the whole manual registry twice over when
  // redirects are introduced after publication: every declared source and its
  // raw Markdown mirror follow the same hop, derived rather than hand-listed.
  const table = buildSiteRedirectTable(liveHtmlRoutes(site), [
    site.landing,
    ...site.pages,
    ...site.decisions.pages,
    site.publicMap.landing,
    ...site.publicMap.pages,
  ]);
  assertEquals(table.issues, []);
  for (const [source, target] of redirects.redirects) {
    assertEquals(table.redirects.get(source), target, source);
    assertEquals(table.redirects.get(`${source}.md`), `${target}.md`, source);
  }
  assert(table.redirects.size >= redirects.redirects.size * 2);
});

Deno.test("manual delivery leaves the configured project Map contract intact", async () => {
  const discovered = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
  });
  assert(discovered !== undefined);
  const index = await mapResult(REPO_ROOT);
  assert(index.ok && index.data?.docs !== undefined);
  assertEquals(
    index.data.docs.map((doc) => doc.target),
    discovered.entries.map(canonicalDocTarget),
  );

  for (
    const target of [
      "50-engine-internals/the-document-model",
      "60-agent-integrations/README",
      "70-reference/mcp-and-results",
      "90-site/README",
    ]
  ) {
    const page = await mapResult(REPO_ROOT, { target });
    assert(page.ok && page.data?.doc !== undefined, target);
    assertEquals(page.data.doc.target, target);
  }

  const search = await mapResult(REPO_ROOT, {
    search: "Model Context Protocol",
  });
  assert(search.ok && search.data?.results !== undefined);
  assert(search.data.results.length > 0);
  assert(
    search.data.results.every((result) =>
      result.path.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/`)
    ),
  );

  const instructions = await Deno.readTextFile(join(REPO_ROOT, "AGENTS.md"));
  assertStringIncludes(instructions, "browsable with **`discern_map`**");
  assertStringIncludes(
    instructions,
    "search` the map in task language, then fetch the best result's canonical `target`",
  );
});

Deno.test("a fresh published page enrols everywhere except promotion", async () => {
  await withTempDir(async (dir) => {
    const manualDir = join(dir, "manual");
    await copy(REPO_AUTHORED_PATHS.manual, manualDir, { overwrite: true });
    const sectionIndex = join(manualDir, "10-guides", "README.md");
    const index = await Deno.readTextFile(sectionIndex);
    await Deno.writeTextFile(
      sectionIndex,
      index.replace(
        "- [Maintain or remove discern]",
        "- [Fresh enrolment](fresh-enrolment.md): Prove that one published page joins every complete delivery surface without receiving promoted placement.\n- [Maintain or remove discern]",
      ),
    );
    const retiredSource = "/docs/fresh-enrolment-retired";
    await Deno.writeTextFile(
      join(manualDir, "10-guides", "fresh-enrolment.md"),
      `---
id: guide-fresh-enrolment
title: "Fresh enrolment"
description: "Prove that a published manual page joins complete delivery automatically without becoming promoted."
order: 999
publish: true
kind: guide
aliases:
  - "fresh manual member"
redirect_from:
  - "${retiredSource}"
---

# Fresh enrolment

This published fixture must join every complete delivery projection while the authored front door remains unchanged.
`,
    );

    const tree = await discoverDocs({ cwd: dir, dir: manualDir });
    assert(tree !== undefined);
    const projection = await buildManualProjection(tree.entries);
    const fresh = projection.byId.get("guide-fresh-enrolment");
    assert(fresh !== undefined);
    assert(!projection.frontDoors.some((page) => page.id === fresh.id));

    const site = projectManualPages(projection);
    assert(site.pages.some((page) => page.entry.pageId === fresh.id));
    const search = await buildSearchIndex(site.pages.map((page) => ({
      route: page.route,
      section: page.sectionSlug,
      entry: page.entry,
    })));
    assert(search.pages.some((page) => page.route === fresh.route));

    const staged = join(dir, "staged-docs");
    const stagedPaths = await stageBundledManual(manualDir, staged);
    assert(stagedPaths.includes(fresh.entry.relToDocs));
    const stagedTree = await discoverDocs({ cwd: dir, dir: staged });
    assert(stagedTree !== undefined);
    const stagedProjection = await buildManualProjection(stagedTree.entries);
    assert(stagedProjection.byId.has(fresh.id));
    for (const page of stagedProjection.pages) {
      const stagedText = await Deno.readTextFile(page.entry.absPath);
      const sourceText = await Deno.readTextFile(
        join(manualDir, page.entry.relToDocs),
      );
      assertEquals(stagedText, stripManualSourceComments(sourceText));
      const comments = stagedText.match(/<!--[\s\S]*?-->/gu) ?? [];
      assert(
        comments.every((comment) =>
          !/\b(?:generated|regenerate|deno task)\b/iu.test(comment)
        ),
        `${page.entry.relToDocs}: staged manual retains a source-generation comment`,
      );
    }

    // Terminal delivery: `docs --json` indexes the fresh page without any
    // registration. The CLI renders the same `docsResult`/`treeResult` core
    // the MCP `discern_docs` tool projects (src/engine/mcp/server.ts), so this
    // one assertion covers the terminal and MCP shapes together.
    await seedConfig(
      dir,
      '[meta]\nbootstrapped = true\n[map]\ndir = "docs/"\n[project]\nslug = "demo"\n',
    );
    const cli = await runCli(["docs", "--json"], dir, {
      DISCERN_DOCS_DIR: manualDir,
    });
    assertEquals(cli.code, 0, cli.stdout + cli.stderr);
    const decoded = decodeCliResult(cli.stdout, "docs");
    assertEquals(decoded.ok, true);
    assertResultDataKey(decoded, "docs");
    const cliDocs = decoded.data.docs;
    assertExists(cliDocs);
    const record = cliDocs.find((doc) => doc.page_id === fresh.id);
    assertExists(record);
    assertEquals(record.target, canonicalDocTarget(fresh.entry));
    assertEquals(record.manual_kind, fresh.kind);

    // Site delivery beyond navigation: rebuild the manual-derived site fields
    // from the synthetic projection exactly as buildDocsSite composes them
    // (tests/site_docs_test.ts pins that composition against the live site in
    // "the sitemap source contains instructions and project-history routes");
    // the non-manual route families stay the real corpus's, which the
    // projections exercised below never consume.
    const real = await loadDocsSite();
    const landing: DocsLanding = {
      routeKind: "manual",
      route: "/docs",
      entry: projection.landing.entry,
      sourcePath: projection.landing.entry.relToDocs,
      manualKind: projection.landing.kind,
      sectionSlug: "",
      isIndex: false,
    };
    const enrolled: DocsSite = {
      ...real,
      landing,
      pages: site.pages,
      sections: site.sections,
      sitemapRoutes: [
        landing.route,
        ...site.pages.map((page) => page.route),
        real.decisions.route,
        ...real.decisions.pages.map((page) => page.route),
        ...real.publicMap.sitemapRoutes,
      ],
    };
    assert(enrolled.sitemapRoutes.includes(fresh.route));
    assert(liveHtmlRoutes(enrolled).includes(fresh.route));

    // llms.txt lists the fresh page exactly once; llms-full.txt carries its
    // frontmatter-stripped source bytes in one addressed chunk.
    const llms = docsLlmsSection(enrolled);
    assertEquals(
      llms.split(`](https://discern.sh${fresh.route})`).length - 1,
      1,
    );
    const full = await docsLlmsFullText(enrolled);
    const freshUrl = `https://discern.sh${fresh.route}`;
    const { body } = parseFrontmatter(
      await Deno.readTextFile(fresh.entry.absPath),
    );
    assertStringIncludes(
      full,
      `<!-- BEGIN ${freshUrl} -->\n\n${body.trim()}\n\n<!-- END ${freshUrl} -->`,
    );

    // The page's declared retired route joins the served redirect table with
    // its raw Markdown mirror, both reaching the fresh page in one hop.
    const table = buildSiteRedirectTable(liveHtmlRoutes(enrolled), [
      enrolled.landing,
      ...enrolled.pages,
      ...real.decisions.pages,
      real.publicMap.landing,
      ...real.publicMap.pages,
    ]);
    assertEquals(table.issues, []);
    assertEquals(table.redirects.get(retiredSource), fresh.route);
    assertEquals(
      table.redirects.get(`${retiredSource}.md`),
      `${fresh.route}.md`,
    );
  });
});
