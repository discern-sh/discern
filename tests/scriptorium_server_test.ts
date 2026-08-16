/**
 * The studio server's reading room: pages render with provenance spans and no
 * leftover markers, heading anchors match the committed pages, derived spans
 * lock, canon-internal links reroute into the studio, and the entry API merges
 * the evaluated snapshot with the syntax-side positions. The suite runs
 * without net access, so the tests drive the route handler directly.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MARK_SEP,
} from "../scripts/scriptorium/annotation.ts";
import { mainCheckoutIssue } from "../scripts/scriptorium/root.ts";
import { buildSnapshot } from "../scripts/scriptorium/snapshot.ts";
import {
  startStudio,
  type StudioHandle,
} from "../scripts/scriptorium/server.ts";

/** Run one test body against a hermetic, socketless studio. */
async function withStudio(
  body: (handle: StudioHandle) => Promise<void>,
): Promise<void> {
  const handle = await startStudio({
    port: 0,
    emitAssets: false,
    watch: false,
    listen: false,
    snapshotBuilder: buildSnapshot,
  });
  try {
    await body(handle);
  } finally {
    await handle.close();
  }
}

/** Drive one route through the studio's handler. */
async function request(
  studio: StudioHandle,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await studio.handler(
    new Request(`http://scriptorium.test${path}`, init),
  );
}

Deno.test("the reading room serves annotated pages with clean spans", async () => {
  await withStudio(async (studio) => {
    const response = await request(studio, "/page/feature-canon");
    assertEquals(response.status, 200);
    const html = await response.text();
    assert(html.includes('data-ref="feature:proof:what"'), "span refs render");
    for (const marker of [MARK_OPEN, MARK_SEP, MARK_CLOSE]) {
      assert(!html.includes(marker), "no raw markers survive the transform");
    }
    assert(
      html.includes('id="the-quality-gate"'),
      "heading anchors match the committed page",
    );
    assert(
      /class="scr-field scr-locked"[^>]*data-ref="feature:jobs-table:what"/
        .test(html),
      "interpolated prose renders locked",
    );
    assert(
      html.includes('href="/page/feature-canon-plain"'),
      "canon-internal links reroute into the studio",
    );
  });
});

Deno.test("the entry API merges evaluation with syntax positions", async () => {
  await withStudio(async (studio) => {
    const proof = await (await request(studio, "/api/entry/feature/proof"))
      .json() as {
        file: string;
        line: number;
        claimsCarried: string[];
        fields: { path: string; kind: string; editable: boolean }[];
        inward: { registry: string }[];
      };
    assertEquals(proof.file, "scripts/feature_registry.ts");
    assert(proof.line > 0);
    assert(proof.claimsCarried.includes("proof-exact-tree"));
    const what = proof.fields.find((field) => field.path === "what");
    assertEquals(what?.editable, true);
    const hints = proof.fields.find((field) => field.path === "hints");
    assertEquals(hints?.kind, "string-array");
    assertEquals(hints?.editable, false);
    assert(proof.inward.some((citation) => citation.registry === "benefit"));

    const term = await (
      await request(studio, "/api/entry/glossary/file-ownership")
    ).json() as { fields: { path: string; kind: string }[] };
    assertEquals(
      term.fields.find((field) => field.path === "retired.0.pattern")?.kind,
      "template",
    );

    const missing = await request(studio, "/api/entry/feature/nope");
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  });
});

Deno.test("the studio serves worktrees only", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assert(
      await mainCheckoutIssue(dir) !== undefined,
      "no .git at all refuses",
    );
    await Deno.mkdir(join(dir, ".git"));
    assert(
      await mainCheckoutIssue(dir) !== undefined,
      "a .git directory is the main checkout and refuses",
    );
    await Deno.remove(join(dir, ".git"));
    await Deno.writeTextFile(join(dir, ".git"), "gitdir: elsewhere");
    assertEquals(
      await mainCheckoutIssue(dir),
      undefined,
      "a gitlink file is a linked worktree and serves",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("state and page routes answer sanely", async () => {
  await withStudio(async (studio) => {
    const state = await (await request(studio, "/api/state")).json() as {
      pages: { id: string }[];
      standards: { name: string }[];
    };
    assertEquals(state.pages.length, 8);
    assert(
      state.standards.some((item) => item.name === "plain_reading_grade"),
    );
    const missing = await request(studio, "/page/nope");
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  });
});
