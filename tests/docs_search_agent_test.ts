/**
 * Agent-facing documentation search accepts task language. Complete matches
 * lead, strong partial matches fill the remaining result slots, and exact
 * technical text keeps its high-precision behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { searchAgentPages, type SearchPage } from "../src/lib/docs_search.ts";

function page(
  route: string,
  overrides: Partial<SearchPage> = {},
): SearchPage {
  return {
    route,
    title: route.slice(1),
    section: "Fixture",
    description: "",
    aliases: [],
    headings: [],
    codeTerms: [],
    body: "",
    ...overrides,
  };
}

Deno.test("agent search fills after two complete matches without weak padding", () => {
  const pages = [
    page("/complete-a", {
      title: "Field notes",
      body:
        "Copper appears first. An orchard follows. Velvet comes later. One beacon closes the page.",
    }),
    page("/complete-b", {
      title: "Survey notes",
      body:
        "The beacon is listed before velvet, with copper and an orchard in separate sections.",
    }),
    page("/orchard", { title: "Copper orchard" }),
    page("/beacon", { title: "Velvet beacon" }),
    page("/weak", { title: "Copper" }),
  ];

  const results = searchAgentPages(
    pages,
    "copper orchard velvet beacons",
    5,
  );

  assertEquals(results.slice(0, 2).map((result) => result.match), [
    "complete",
    "complete",
  ]);
  assertEquals(
    new Set(results.slice(0, 2).map((result) => result.page.route)),
    new Set(["/complete-a", "/complete-b"]),
  );
  assertEquals(
    new Set(results.slice(2).map((result) => result.page.route)),
    new Set(["/orchard", "/beacon"]),
  );
  assert(results.slice(2).every((result) => result.match === "partial"));
  assert(!results.some((result) => result.page.route === "/weak"));
});

Deno.test("a prose phrase leads without blocking focused partial matches", () => {
  const pages = [
    page("/overview", {
      body: "Copper orchard velvet beacons are covered in this overview.",
    }),
    page("/orchard", { title: "Copper orchard" }),
    page("/beacon", { title: "Velvet beacon" }),
  ];

  const results = searchAgentPages(
    pages,
    "copper orchard velvet beacons",
    5,
  );

  assertEquals(results[0]?.page.route, "/overview");
  assertEquals(results[0]?.match, "complete");
  assertEquals(
    new Set(results.slice(1).map((result) => result.page.route)),
    new Set(["/orchard", "/beacon"]),
  );
  assert(results.slice(1).every((result) => result.match === "partial"));
});

Deno.test("agent search returns complementary pages when no page covers the task", () => {
  const pages = [
    page("/meadow", { title: "Silver meadow" }),
    page("/signal", { title: "Indigo beacon" }),
    page("/weak", { title: "Silver" }),
  ];

  const results = searchAgentPages(
    pages,
    "silver meadow indigo beacons telescope",
    5,
  );

  assertEquals(
    new Set(results.map((result) => result.page.route)),
    new Set(["/meadow", "/signal"]),
  );
  assert(results.every((result) => result.match === "partial"));
});

Deno.test("agent search favors new query coverage over a duplicate partial", () => {
  const pages = [
    page("/a-primary", { title: "Silver meadow" }),
    page("/b-duplicate", { title: "Silver meadow" }),
    page("/z-complement", { body: "Indigo beacon." }),
  ];

  const results = searchAgentPages(
    pages,
    "silver meadow indigo beacon telescope",
    5,
  );

  assertEquals(
    new Set(results.slice(0, 2).map((result) => result.page.route)),
    new Set(["/a-primary", "/z-complement"]),
  );
  assertEquals(results[2]?.page.route, "/b-duplicate");
});

Deno.test("agent search keeps an exact technical phrase precise", () => {
  const pages = [
    page("/command", {
      title: "Resource identity",
      codeTerms: ["discern identity --resource <name>"],
      body: "Run `discern identity --resource <name>`.",
    }),
    page("/decoy", {
      title: "Identity",
      body: "Discern identity records describe a resource.",
    }),
  ];

  const results = searchAgentPages(
    pages,
    "discern identity --resource <name>",
    5,
  );

  assertEquals(results.map((result) => result.page.route), ["/command"]);
  assertEquals(results[0]?.match, "complete");
});

Deno.test("an exact technical result snippets the literal query", () => {
  const pages = [
    page("/error", {
      body: `Score overview. ${
        "Unrelated context. ".repeat(20)
      }The reported error is below_min_score.`,
    }),
  ];

  const results = searchAgentPages(pages, "below_min_score", 5);

  assertEquals(results.length, 1);
  assertStringIncludes(results[0]?.snippet ?? "", "below_min_score");
});

Deno.test("agent search uses lexical tokens and simple plural equivalence", () => {
  const pages = [
    page("/provider", { title: "AI provider logo" }),
    page("/substring-decoy", {
      body: "The readiness check fails while the process is waiting.",
    }),
  ];

  const results = searchAgentPages(pages, "AI logos", 5);

  assertEquals(results.map((result) => result.page.route), ["/provider"]);
  assertEquals(results[0]?.match, "complete");
});
