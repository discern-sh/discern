/**
 * Search is a public projection and a user journey, not a title filter. These
 * fixtures pin both halves: the server index must derive every searchable
 * field from stripped public documents, and the client matcher must rank and
 * contextualise the terms evaluators actually paste.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { DocEntry } from "../src/lib/docs.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { buildSearchIndex, type SearchSource } from "../site/search.ts";
import { renderBrowserSearchModule } from "../src/lib/docs_search.ts";
import { searchPages } from "../site/pages/assets/search.js";

/** Build a published document entry while varying only the search signals under test. */
function entry(
  slug: string,
  overrides: Partial<DocEntry> = {},
): DocEntry {
  return {
    path: `project/manual/40-troubleshooting/${slug}.md`,
    absPath: `/fixture/${slug}.md`,
    relToDocs: `40-troubleshooting/${slug}.md`,
    section: "40-troubleshooting",
    slug,
    title: slug,
    description: `Fixture description for ${slug}`,
    publish: true,
    aliases: [],
    redirectFrom: [],
    citedAdrs: [],
    ...overrides,
  };
}

const searchable = entry("resource-recovery", {
  title: "Recover a worktree resource",
  description: "Restore an isolated resource after its readiness check fails.",
  manualKind: "troubleshooting",
  aliases: ["sandbox fleet"],
});
const decision = entry("0199-search-history", {
  path: "project/map/_adr/0199-search-history.md",
  section: "_adr",
  relToDocs: "_adr/0199-search-history.md",
  title: "Search history decision",
});

const sources: SearchSource[] = [
  {
    route: "/docs/troubleshooting/resource-recovery",
    section: "Troubleshooting",
    entry: searchable,
  },
  {
    route: "/docs/decisions/0199-search-history",
    section: "Decisions",
    entry: decision,
  },
];

const markdown = new Map<string, string>([
  [
    searchable.absPath,
    `---
aliases:
  - sandbox fleet
---
# Recover a worktree resource

Use the runtime discovery path when a resource needs attention.

<!-- source note: \`phantom-capability\` -->

Visible recovery context remains searchable.

## Runtime discovery

Run \`discern identity --resource <name>\`, then set
\`[worktree.setup].ensure\`. A rejected score returns
\`below_min_score\`. ([ADR 0042](../_adr/0042-hidden.md))
`,
  ],
  [decision.absPath, "# Search history decision\n\ndecision-secret-token\n"],
]);

const readFixture = (path: string): Promise<string> => {
  const value = markdown.get(path);
  if (value === undefined) throw new Error(`missing search fixture ${path}`);
  return Promise.resolve(value);
};

Deno.test("the search projection indexes stripped public body, code, headings, and aliases", async () => {
  const readPaths: string[] = [];
  const index = await buildSearchIndex(sources, async (path) => {
    readPaths.push(path);
    return await readFixture(path);
  });
  assertEquals(index.pages.length, 1);
  assertEquals(readPaths, [searchable.absPath]);
  const page = index.pages[0];
  assert(page !== undefined);
  assertEquals(page.route, "/docs/troubleshooting/resource-recovery");
  assertEquals(page.kind, "troubleshooting");
  assertEquals(page.aliases, ["sandbox fleet"]);
  assertEquals(page.headings.map((heading) => heading.text), [
    "Runtime discovery",
  ]);
  assert(
    page.codeTerms.some((term) =>
      term.includes("discern identity --resource <name>")
    ),
  );
  assertStringIncludes(page.body, "below_min_score");
  assert(!page.body.includes("aliases:"), "frontmatter stays out of the index");
  assert(!page.body.includes("ADR 0042"), "human projection strips citations");
  assert(!page.body.includes("phantom-capability"));
  assertStringIncludes(page.body, "Visible recovery context");

  const serialized = JSON.stringify(index);
  assert(!serialized.includes("decision-secret-token"));
});

Deno.test("source-only comments cannot create search results or snippets", async () => {
  const index = await buildSearchIndex(sources, readFixture);
  assertEquals(searchPages(index.pages, "phantom-capability"), []);

  const result = searchPages(index.pages, "visible recovery context")[0];
  assert(result !== undefined);
  assertStringIncludes(result.snippet, "Visible recovery context");
  assert(!result.snippet.includes("source note"));
  assert(!result.snippet.includes("phantom-capability"));
});

Deno.test("exact commands, config keys, error strings, and aliases return contextual results", async () => {
  const index = await buildSearchIndex(sources, readFixture);
  for (
    const query of [
      "discern identity --resource <name>",
      "[worktree.setup].ensure",
      "below_min_score",
      "sandbox fleet",
    ]
  ) {
    const result = searchPages(index.pages, query)[0];
    assert(result !== undefined, `result for ${query}`);
    assertEquals(result.page.route, "/docs/troubleshooting/resource-recovery");
    assert(result.snippet.length > 0, `contextual snippet for ${query}`);
    if (query !== "sandbox fleet") {
      assertStringIncludes(result.snippet.toLowerCase(), query.toLowerCase());
    }
  }
});

Deno.test("task-shaped searches land on the manual page that owns the procedure", async () => {
  const site = await loadDocsSite();
  const index = await buildSearchIndex([
    {
      route: site.landing.route,
      section: "Manual",
      entry: site.landing.entry,
    },
    ...site.pages.map((page) => ({
      route: page.route,
      section: site.sections.find((section) =>
        section.slug === page.sectionSlug
      )?.title ?? "",
      entry: page.entry,
    })),
  ]);

  const cases = [
    ["give this back", "guide-finish-and-land-a-change"],
    ["can't edit main", "guide-finish-and-land-a-change"],
    ["check failed", "guide-fix-a-red-gate"],
    ["remember this rule", "guide-write-project-instructions"],
    ["update my branch", "guide-finish-and-land-a-change"],
  ] as const;

  for (const [query, expectedPageId] of cases) {
    const result = searchPages(index.pages, query)[0];
    assert(result !== undefined, `top result for ${query}`);
    const expected = site.pages.find((page) =>
      page.entry.pageId === expectedPageId
    );
    assert(expected !== undefined, `manual page ${expectedPageId}`);
    assertEquals(
      result.page.route,
      expected.route,
      `top result for ${query}`,
    );
  }
});

Deno.test("every published manual page declares search aliases", async () => {
  const site = await loadDocsSite();
  assertEquals(
    site.pages
      .filter((page) => page.entry.aliases.length === 0)
      .map((page) => page.entry.relToDocs),
    [],
  );
});

Deno.test("search field weights stay title > aliases > headings > code > body", async () => {
  const weightedSources: SearchSource[] = [
    {
      route: "/docs/title",
      section: "Reference",
      entry: entry("title", { title: "Recovery" }),
    },
    {
      route: "/docs/alias",
      section: "Reference",
      entry: entry("alias", { aliases: ["recovery"] }),
    },
    { route: "/docs/heading", section: "Reference", entry: entry("heading") },
    { route: "/docs/code", section: "Reference", entry: entry("code") },
    { route: "/docs/body", section: "Reference", entry: entry("body") },
  ];
  const weightedMarkdown = new Map<string, string>([
    [weightedSources[0]?.entry.absPath ?? "", "# Recovery\n\nA title match.\n"],
    [
      weightedSources[1]?.entry.absPath ?? "",
      "# Alias page\n\nAn alias match.\n",
    ],
    [
      weightedSources[2]?.entry.absPath ?? "",
      "# Heading page\n\n## Recovery\n\nA heading match.\n",
    ],
    [
      weightedSources[3]?.entry.absPath ?? "",
      "# Code page\n\nRun \`recovery\`.\n",
    ],
    [
      weightedSources[4]?.entry.absPath ?? "",
      "# Body page\n\nThe recovery path lives here.\n",
    ],
  ]);
  const index = await buildSearchIndex(weightedSources, (path) => {
    const value = weightedMarkdown.get(path);
    if (value === undefined) {
      throw new Error(`missing weighted fixture ${path}`);
    }
    return Promise.resolve(value);
  });
  assertEquals(
    searchPages(index.pages, "recovery").map((result) => result.page.route),
    ["/docs/title", "/docs/alias", "/docs/heading", "/docs/code", "/docs/body"],
  );
});

Deno.test("task-shaped kinds beat an incidental reference body match", async () => {
  const kindSources: SearchSource[] = [
    {
      route: "/docs/reference/dense",
      section: "Reference",
      entry: entry("dense", { manualKind: "reference" }),
    },
    {
      route: "/docs/troubleshooting/recover",
      section: "Troubleshooting",
      entry: entry("recover", { manualKind: "troubleshooting" }),
    },
  ];
  const index = await buildSearchIndex(
    kindSources,
    () => Promise.resolve("# Page\n\nRecover the blocked resource safely.\n"),
  );
  assertEquals(
    searchPages(index.pages, "recover resource").map((result) =>
      result.page.route
    ),
    [
      "/docs/troubleshooting/recover",
      "/docs/reference/dense",
    ],
  );
});

Deno.test("search queries stay in the browser with no telemetry or persistence", async () => {
  const client = await Deno.readTextFile(
    new URL("../site/pages/assets/docs.js", import.meta.url),
  );
  const matcher = await Deno.readTextFile(
    new URL("../site/pages/assets/search.js", import.meta.url),
  );
  const searchSection = client.slice(client.indexOf("// ── Search palette"));
  const statefulApis = [
    ...`${searchSection}\n${matcher}`.matchAll(
      /\b(fetch|sendBeacon|localStorage|XMLHttpRequest|WebSocket)\b/g,
    ),
  ].map((match) => match[1]);
  assertEquals(statefulApis, ["fetch"]);
  assertStringIncludes(searchSection, "palette.dataset.searchEndpoint");
  assertStringIncludes(searchSection, "fetch(searchEndpoint)");
  assertStringIncludes(searchSection, "Show all ${allResults.length} results");
  assertStringIncludes(
    searchSection,
    "No results. Try a command, config key, or exact error message.",
  );
});

Deno.test("the browser matcher is generated from the shared authored source", async () => {
  const source = await Deno.readTextFile(
    new URL("../src/lib/docs_search.js", import.meta.url),
  );
  assertEquals(
    await Deno.readTextFile(
      new URL("../site/pages/assets/search.js", import.meta.url),
    ),
    renderBrowserSearchModule(source),
  );
});
