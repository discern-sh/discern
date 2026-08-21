/** Guards for the site design-system coverage census and route boundary. */

import { assertEquals } from "@std/assert";
import {
  htmlClassTokens,
  type ManifestComponent,
  measureBundleComponentCoverage,
  measureSiteComponentCoverage,
  resolveSelectedComponents,
  routeUsesBundle,
} from "../scripts/site_component_coverage_lib.ts";

const COMPONENTS: readonly ManifestComponent[] = [
  {
    id: "foundation",
    group: "Core",
    dependencies: [],
    ownedClasses: ["system-foundation"],
  },
  {
    id: "card",
    group: "Display",
    dependencies: ["foundation"],
    ownedClasses: ["system-card"],
  },
  {
    id: "future",
    group: "Display",
    dependencies: [],
    ownedClasses: ["system-future"],
  },
];

Deno.test("component coverage resolves groups and dependencies from the manifest", () => {
  assertEquals(
    resolveSelectedComponents(
      { components: ["card"], groups: [] },
      COMPONENTS,
    ).map((component) => component.id),
    ["foundation", "card"],
  );
  assertEquals(
    resolveSelectedComponents(
      { components: [], groups: ["Display"] },
      COMPONENTS,
    ).map((component) => component.id),
    ["foundation", "card", "future"],
  );
});

Deno.test("component coverage enrolls a prospective selected component as a gap", () => {
  const coverage = measureBundleComponentCoverage(
    "example",
    { components: [], groups: ["Display"] },
    COMPONENTS,
    [
      {
        route: "/example",
        html: '<article class="page system-foundation system-card"></article>',
      },
    ],
  );
  assertEquals(coverage.witnessed, ["foundation", "card"]);
  assertEquals(coverage.gaps, ["future"]);
  assertEquals(coverage.routeGaps, []);
});

Deno.test("component coverage reports a live route outside its component boundary", () => {
  const coverage = measureBundleComponentCoverage(
    "example",
    { components: ["card"], groups: [] },
    COMPONENTS,
    [
      { route: "/covered", html: '<article class="system-card"></article>' },
      { route: "/bare", html: '<article class="page-owned"></article>' },
    ],
  );
  assertEquals(coverage.routeGaps, ["/bare"]);
});

Deno.test("HTML class extraction and route ownership cover canonical variants", () => {
  assertEquals(
    [...htmlClassTokens(`<p class='one two'></p><p class="two three"></p>`)],
    ["one", "two", "three"],
  );
  assertEquals(routeUsesBundle("/", ["/"]), true);
  assertEquals(routeUsesBundle("/agents", ["/"]), false);
  assertEquals(routeUsesBundle("/docs/quality-gate", ["/docs"]), true);
  assertEquals(routeUsesBundle("/documentation", ["/docs"]), false);
});

Deno.test("every live HTML route renders a component from its assigned bundle", async () => {
  const coverage = await measureSiteComponentCoverage();
  assertEquals(
    coverage.flatMap((bundle) =>
      bundle.routeGaps.map((route) => `${bundle.bundle}:${route}`)
    ),
    [],
  );
});
