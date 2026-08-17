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
import { mainCheckoutIssue, REPO_ROOT } from "../scripts/scriptorium/root.ts";
import { buildSnapshot } from "../scripts/scriptorium/snapshot.ts";
import { fieldSpecFor } from "../scripts/scriptorium/fields.ts";
import {
  fieldLeaves,
  openRegistryProject,
  registryEntries,
} from "../scripts/scriptorium/registry_ast.ts";
import {
  startStudio,
  STUDIO_REQUEST_TOKEN_HEADER,
  type StudioHandle,
} from "../scripts/scriptorium/server.ts";

const TEST_REQUEST_TOKEN = "scriptorium-test-token";

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
    requestToken: TEST_REQUEST_TOKEN,
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
    new Request(`http://localhost${path}`, init),
  );
}

/** Drive one same-origin JSON POST carrying the studio's request authority. */
async function trustedPost(
  studio: StudioHandle,
  path: string,
  body: unknown,
): Promise<Response> {
  return await request(studio, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "http://localhost",
      [STUDIO_REQUEST_TOKEN_HEADER]: TEST_REQUEST_TOKEN,
    },
    body: JSON.stringify(body),
  });
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

Deno.test("literal editability never overrides a field's semantics", async () => {
  await withStudio(async (studio) => {
    const project = openRegistryProject(REPO_ROOT);
    for (const entry of registryEntries(project, REPO_ROOT)) {
      const response = await request(
        studio,
        `/api/entry/${entry.registry}/${entry.slug}`,
      );
      assertEquals(response.status, 200, `${entry.registry}:${entry.slug}`);
      const payload = await response.json() as {
        fields: { path: string; kind: string; editable: boolean }[];
      };
      for (const leaf of fieldLeaves(entry)) {
        const field = payload.fields.find((item) => item.path === leaf.path);
        assert(field !== undefined, `${entry.id}.${leaf.path} is inventoried`);
        const semantics = fieldSpecFor(
          entry.registry,
          entry.kind,
          leaf.path,
        );
        assertEquals(
          field.editable,
          leaf.kind === "string" && semantics?.edit === "prose",
          `${entry.registry} ${entry.id} · ${leaf.path}`,
        );
      }
    }

    const glossary = await request(studio, "/page/glossary");
    const html = await glossary.text();
    assert(
      /class="scr-field scr-locked"[^>]*data-ref="glossary:file-ownership:term"/
        .test(html),
      "a glossary identity renders as a locked jump, not an editor",
    );
  });
});

Deno.test("untrusted hosts and POST requests are refused before routing", async () => {
  await withStudio(async (studio) => {
    const rebinding = await studio.handler(
      new Request("http://attacker.example/page/feature-canon"),
    );
    assertEquals(rebinding.status, 403, "non-loopback Host is refused");
    await rebinding.body?.cancel();

    for (
      const path of [
        "/api/open",
        "/api/lint",
        "/api/save",
        "/api/guards/run",
        "/api/a-future-post-route",
      ]
    ) {
      const response = await studio.handler(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "text/plain",
            "origin": "https://attacker.example",
          },
          body: "{}",
        }),
      );
      assertEquals(response.status, 403, `${path} rejects an untrusted caller`);
      await response.body?.cancel();
    }

    const trusted = await trustedPost(studio, "/api/lint", {
      registry: "feature",
      kind: "node",
      field: "what",
      value: "A trusted draft.",
    });
    assertEquals(trusted.status, 200, "the studio's own browser may POST");
    await trusted.body?.cancel();
  });
});

Deno.test("a stale browser save receives a conflict without touching disk", async () => {
  await withStudio(async (studio) => {
    const response = await trustedPost(studio, "/api/save", {
      registry: "feature",
      slug: "proof",
      field: "why",
      expected: "a value that was never in the registry",
      value: "A replacement that must never be applied.",
    });
    assertEquals(response.status, 409);
    const report = await response.json() as { ok: boolean; issue: string };
    assertEquals(report.ok, false);
    assert(report.issue.includes("changed on disk"));
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
