/** End-to-end parity for every projection of the canonical product manual. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { join } from "@std/path";
import { stageBundledManual } from "../scripts/build.ts";
import {
  docsLlmsSection,
  loadDocsSite,
  projectManualPages,
} from "../site/docs.ts";
import { buildSearchIndex } from "../site/search.ts";
import { docsResult } from "../src/commands/docs.ts";
import { buildRedirectRegistry, discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { withTempDir } from "./helpers.ts";

async function repositoryManual() {
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

  const site = await loadDocsSite();
  assertEquals(
    [site.landing, ...site.pages].map((page) => page.entry.pageId),
    expectedIds,
  );

  const result = await docsResult(REPO_ROOT);
  assert(result.ok && result.data?.docs !== undefined);
  assertEquals(result.data.docs.map((record) => record.page_id), expectedIds);

  const search = await buildSearchIndex([
    { route: site.landing.route, section: "Manual", entry: site.landing.entry },
    ...site.pages.map((page) => ({
      route: page.route,
      section: page.sectionSlug,
      entry: page.entry,
    })),
  ]);
  assertEquals(search.pages.map((page) => page.route), expectedRoutes);

  const manualSitemap = site.sitemapRoutes.filter((route) =>
    route !== "/docs/decisions" && !route.startsWith("/docs/decisions/")
  );
  assertEquals(manualSitemap, expectedRoutes);
  const llms = docsLlmsSection(site);
  for (const route of expectedRoutes) {
    assertStringIncludes(llms, `https://discern.sh${route}`);
  }

  const redirects = buildRedirectRegistry(manual.pages.map((page) => ({
    route: page.route,
    redirectFrom: page.entry.redirectFrom,
  })));
  assertEquals(redirects.issues, []);
  assertEquals(redirects.redirects.size, 83);
  const liveRoutes = new Set(expectedRoutes);
  for (const [source, target] of redirects.redirects) {
    assert(!liveRoutes.has(source), `${source} must not also be a live route`);
    assert(
      liveRoutes.has(target),
      `${source} must redirect directly to ${target}`,
    );
  }
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
  });
});
