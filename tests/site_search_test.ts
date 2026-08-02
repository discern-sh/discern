/**
 * Search is a public projection and a user journey, not a title filter. These
 * fixtures pin both halves: the server index must derive every searchable
 * field from stripped public documents, and the client matcher must rank and
 * contextualise the terms evaluators actually paste.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { DocEntry } from "../src/lib/docs.ts";
import { loadDocsSite } from "../site/docs.ts";
import { buildSearchIndex, type SearchSource } from "../site/search.ts";
import { renderBrowserSearchModule } from "../src/lib/docs_search.ts";
import { searchPages } from "../site/pages/assets/search.js";

/** Build a published document entry while varying only the search signals under test. */
function entry(
  slug: string,
  overrides: Partial<DocEntry> = {},
): DocEntry {
  return {
    path: `project/map/20-quality-gate/${slug}.md`,
    absPath: `/fixture/${slug}.md`,
    relToDocs: `20-quality-gate/${slug}.md`,
    section: "20-quality-gate",
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
  aliases: ["sandbox fleet"],
});
const withheld = entry("draft-recovery", {
  publish: false,
  title: "Private recovery notes",
});
const decision = entry("0199-search-history", {
  section: "_adr",
  relToDocs: "_adr/0199-search-history.md",
  title: "Search history decision",
});

const sources: SearchSource[] = [
  {
    route: "/docs/worktrees/resource-recovery",
    section: "Worktrees",
    entry: searchable,
  },
  {
    route: "/docs/worktrees/draft-recovery",
    section: "Worktrees",
    entry: withheld,
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

## Runtime discovery

Run \`discern identity --resource <name>\`, then set
\`[worktree.setup].ensure\`. A rejected score returns
\`below_min_score\`. ([ADR 0042](../_adr/0042-hidden.md))
`,
  ],
  [withheld.absPath, "# Private recovery notes\n\nunpublished-secret-token\n"],
  [decision.absPath, "# Search history decision\n\ndecision-secret-token\n"],
]);

const readFixture = (path: string): Promise<string> => {
  const value = markdown.get(path);
  if (value === undefined) throw new Error(`missing search fixture ${path}`);
  return Promise.resolve(value);
};

Deno.test("the search projection indexes stripped public body, code, headings, and aliases", async () => {
  const index = await buildSearchIndex(sources, readFixture);
  assertEquals(index.pages.length, 1);
  const page = index.pages[0];
  assert(page !== undefined);
  assertEquals(page.route, "/docs/worktrees/resource-recovery");
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

  const serialized = JSON.stringify(index);
  assert(!serialized.includes("unpublished-secret-token"));
  assert(!serialized.includes("decision-secret-token"));
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
    assertEquals(result.page.route, "/docs/worktrees/resource-recovery");
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
    ["give this back", "/docs/worktrees/hand-work-back"],
    ["can't edit main", "/docs/worktrees/lifecycle"],
    ["check failed", "/docs/quality-gate/when-the-gate-fails"],
    [
      "remember this rule",
      "/docs/agent-guidance/write-project-guidance",
    ],
    ["update my branch", "/docs/worktrees/lifecycle"],
  ] as const;

  for (const [query, expectedRoute] of cases) {
    const result = searchPages(index.pages, query)[0];
    assert(result !== undefined, `top result for ${query}`);
    assertEquals(
      result.page.route,
      expectedRoute,
      `top result for ${query}`,
    );
  }
});

Deno.test("every public numbered-tier page declares search aliases", async () => {
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
  assertStringIncludes(searchSection, 'fetch("/docs/index.json")');
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
