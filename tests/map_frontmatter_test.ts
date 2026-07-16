/**
 * The map's metadata contract, enforced at the gate.
 *
 * Every Markdown file in the live map (minus `_private`, which carries no
 * shipped contract) must satisfy the strict frontmatter schema: a typo'd key,
 * an out-of-shape value, or a broken fence fails HERE, at the gate — never by
 * silently vanishing into the lenient reader. Published siblings must not
 * reuse an explicit `order`, and the destination-owned redirect claims must
 * assemble into a serve-safe registry against the site's live routes.
 *
 * All three checks iterate the live tree, so a newly added page auto-enrols.
 */

import { walk } from "@std/fs";
import { dirname, relative } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { validateFrontmatter } from "../src/lib/frontmatter.ts";
import {
  buildRedirectRegistry,
  discoverDocs,
  isPublicDoc,
} from "../src/lib/docs.ts";
import { loadDocsSite } from "../site/docs.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("every map doc's frontmatter satisfies the strict schema", async () => {
  const failures: string[] = [];
  for await (
    const entry of walk(REPO_AUTHORED_PATHS.map, {
      exts: [".md"],
      includeDirs: false,
      skip: [/(^|\/)_private(\/|$)/],
    })
  ) {
    const issues = validateFrontmatter(await Deno.readTextFile(entry.path));
    const rel = relative(REPO_ROOT, entry.path);
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

Deno.test("redirect claims assemble into a serve-safe registry", async () => {
  const site = await loadDocsSite();
  const registry = buildRedirectRegistry(site.pages.map((p) => ({
    route: p.route,
    redirectFrom: p.entry.redirectFrom,
  })));
  assertEquals(registry.issues, []);

  // Only pages the site actually serves may claim historical routes — a
  // withheld or never-published doc would give its redirects a dead target.
  const tree = await discoverDocs({
    cwd: REPO_ROOT,
    dir: REPO_AUTHORED_PATHS.map,
  });
  assert(tree !== undefined);
  const served = new Set(site.pages.map((p) => p.entry.relToDocs));
  const deadClaims = tree.entries
    .filter((e) => e.redirectFrom.length > 0 && !served.has(e.relToDocs))
    .map((e) => e.relToDocs);
  assertEquals(
    deadClaims,
    [],
    "redirect_from belongs only on pages the site serves",
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
