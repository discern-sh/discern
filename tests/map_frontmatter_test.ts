/**
 * The map's metadata contract — this repository's OWN strict standard.
 *
 * Every Markdown file in the live map (minus `_private`, which carries no
 * shipped contract) must satisfy the strict frontmatter schema: a typo'd key,
 * an out-of-shape value, or a broken fence fails HERE, at the gate — never by
 * silently vanishing into the lenient reader. Published siblings must not
 * reuse an explicit `order`. Product-route redirect claims belong to the
 * dedicated manual rather than this maintainer corpus.
 *
 * Deliberately repo-local: the shipped map-integrity preflight applies only
 * the domain-neutral shape tier (`frontmatterShapeIssues`) — unknown keys,
 * length bounds, duplicate sibling orders, and the redirect registry are the
 * discern.sh site's house style, which end-user projects never inherit.
 * Strict layers over the same per-key shape rules, so this suite subsumes the
 * neutral tier on this repo's corpus.
 *
 * All three checks iterate the live tree, so a newly added page auto-enrols.
 */

import { dirname, join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { validateFrontmatter } from "../src/lib/frontmatter.ts";
import {
  buildRedirectRegistry,
  discoverDocs,
  isPublicDoc,
} from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

Deno.test("every map doc's frontmatter satisfies the strict schema", async () => {
  const failures: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/map_frontmatter_test.ts#strict-map-frontmatter",
      universe: "tracked-markdown",
      narrow: {
        reason:
          "The strict metadata house style governs this repository's configured map except its non-shipped private planning subtree.",
        include: (path) =>
          path.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/`) &&
          !path.startsWith(`${REPO_AUTHORED_PATHS.mapRel}/_private/`),
      },
    })
  ) {
    const issues = validateFrontmatter(
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    );
    failures.push(...issues.map((issue) => `${rel}: ${issue}`));
  }
  assertEquals(
    failures,
    [],
    "fix the frontmatter (or its schema) — metadata mistakes fail at the " +
      "gate, never silently",
  );
});

Deno.test("published siblings never share an explicit order", async () => {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
  });
  assert(tree !== undefined, "the map tree exists");

  const byDir = new Map<string, Map<number, string[]>>();
  for (const entry of tree.entries) {
    if (!isPublicDoc(entry) || entry.order === undefined) continue;
    const dir = dirname(entry.relToDocs);
    const orders = byDir.get(dir) ?? new Map<number, string[]>();
    const holders = orders.get(entry.order) ?? [];
    holders.push(entry.relToDocs);
    orders.set(entry.order, holders);
    byDir.set(dir, orders);
  }

  const clashes: string[] = [];
  for (const [dir, orders] of byDir) {
    for (const [order, holders] of orders) {
      if (holders.length > 1) {
        clashes.push(`${dir}: order ${order} → ${holders.join(", ")}`);
      }
    }
  }
  assertEquals(clashes, [], "give each published sibling its own order");
});

Deno.test("the Map does not claim product-manual redirects", async () => {
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
  });
  assert(tree !== undefined);
  const claims = tree.entries
    .filter((entry) => entry.redirectFrom.length > 0)
    .map((e) => e.relToDocs);
  assertEquals(
    claims,
    [],
    "move product-route redirect_from claims to their manual destinations",
  );
});

Deno.test("buildRedirectRegistry rejects collisions and double claims", () => {
  const ok = buildRedirectRegistry([
    { route: "/docs/a", redirectFrom: ["/docs/old-a"] },
    { route: "/docs/b", redirectFrom: [] },
  ]);
  assertEquals(ok.issues, []);
  assertEquals(ok.redirects.get("/docs/old-a"), "/docs/a");

  const collision = buildRedirectRegistry([
    { route: "/docs/a", redirectFrom: ["/docs/b"] },
    { route: "/docs/b", redirectFrom: [] },
  ]);
  assertEquals(collision.issues.length, 1);
  assert(collision.issues[0]?.includes("live route"), collision.issues[0]);

  const doubled = buildRedirectRegistry([
    { route: "/docs/a", redirectFrom: ["/docs/old"] },
    { route: "/docs/b", redirectFrom: ["/docs/old"] },
  ]);
  assertEquals(doubled.issues.length, 1);
  assert(
    doubled.issues[0]?.includes("cannot point two ways"),
    doubled.issues[0],
  );
});
