/**
 * Canon Editor's server: pages render with provenance spans and no
 * leftover markers, heading anchors match the committed pages, derived spans
 * lock, canon-internal links reroute into the editor, and the entry API merges
 * the evaluated snapshot with the syntax-side positions. The suite runs
 * without net access, so the tests drive the route handler directly.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MARK_SEP,
} from "../scripts/canon_editor/annotation.ts";
import { mainCheckoutIssue, REPO_ROOT } from "../scripts/canon_editor/root.ts";
import { buildSnapshot } from "../scripts/canon_editor/snapshot.ts";
import { fieldSpecFor } from "../scripts/canon_editor/fields.ts";
import { buildPickerCatalog } from "../scripts/canon_editor/pickers.ts";
import {
  fieldLeaves,
  openRegistryProject,
  registryEntries,
} from "../scripts/canon_editor/registry_ast.ts";
import {
  CANON_EDITOR_REQUEST_TOKEN_HEADER,
  type CanonEditorHandle,
  startCanonEditor,
} from "../scripts/canon_editor/server.ts";
import { withTempDir } from "./helpers.ts";

const TEST_REQUEST_TOKEN = "canon-editor-test-token";

/** Flush the promise turns used by the inspector's asynchronous handlers. */
async function flushEditorUi(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

/** Run one test body against a hermetic, socketless editor. */
async function withCanonEditor(
  body: (handle: CanonEditorHandle) => Promise<void>,
): Promise<void> {
  const handle = await startCanonEditor({
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

/** Drive one route through the editor's handler. */
async function request(
  editor: CanonEditorHandle,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return await editor.handler(
    new Request(`http://localhost${path}`, init),
  );
}

/** Drive one same-origin JSON POST carrying the editor's request authority. */
async function trustedPost(
  editor: CanonEditorHandle,
  path: string,
  body: unknown,
): Promise<Response> {
  return await request(editor, path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "http://localhost",
      [CANON_EDITOR_REQUEST_TOKEN_HEADER]: TEST_REQUEST_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("Canon Editor serves annotated pages with clean spans", async () => {
  await withCanonEditor(async (editor) => {
    const response = await request(editor, "/page/feature-canon");
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
      /class="canon-editor-field canon-editor-locked"[^>]*data-ref="feature:jobs-table:what"/
        .test(html),
      "interpolated prose renders locked",
    );
    assert(
      html.includes('href="/page/feature-canon-plain"'),
      "canon-internal links reroute into the editor",
    );
  });
});

Deno.test("the Demand Canon page exposes editable struggle prose", async () => {
  await withCanonEditor(async (editor) => {
    const response = await request(editor, "/page/demand-canon");
    assertEquals(response.status, 200);
    const html = await response.text();
    assert(
      html.includes('data-ref="demand:checkout-collisions:situation"'),
      "demand situation spans render",
    );
    assert(
      /class="canon-editor-field canon-editor-locked"[^>]*data-ref="demand:checkout-collisions:evidence"/
        .test(html),
      "shared evidence rows stay locked to IDE editing",
    );
  });
});

Deno.test("the entry API merges evaluation with syntax positions", async () => {
  await withCanonEditor(async (editor) => {
    const proof = await (await request(editor, "/api/entry/feature/proof"))
      .json() as {
        file: string;
        line: number;
        claimsCarried: string[];
        fields: {
          path: string;
          kind: string;
          editable: boolean;
          editor: string | null;
          picker: {
            source: string;
            options: { value: string }[];
          } | null;
        }[];
        inward: { registry: string }[];
      };
    assertEquals(proof.file, "scripts/feature_registry.ts");
    assert(proof.line > 0);
    assert(proof.claimsCarried.includes("proof-exact-tree"));
    const what = proof.fields.find((field) => field.path === "what");
    assertEquals(what?.editable, true);

    const agentBenefit = await (
      await request(
        editor,
        "/api/entry/agent-benefit/own-one-isolated-effort",
      )
    ).json() as {
      file: string;
      inward: { registry: string; slug: string; via: string }[];
      fields: {
        path: string;
        kind: string;
        editable: boolean;
        editor: string | null;
        picker: {
          source: string;
          options: { value: string }[];
        } | null;
      }[];
    };
    assertEquals(agentBenefit.file, "scripts/feature_registry.ts");
    const hints = agentBenefit.fields.find((field) => field.path === "hints");
    assertEquals(hints?.kind, "string-array");
    assertEquals(hints?.editable, true);
    assertEquals(hints?.editor, "list");
    assertEquals(hints?.picker?.source, "hint");
    assert(
      hints?.picker?.options.some((option) =>
        option.value === "start-mcp-re-root"
      ),
      "the field carries live hint choices",
    );
    assert(
      agentBenefit.inward.some((citation) =>
        citation.registry === "practice" &&
        citation.slug === "one-task-one-place" &&
        citation.via === "agentYields"
      ),
      "agent outcomes point back to the practice tenets that enable them",
    );
    assert(proof.inward.some((citation) => citation.registry === "benefit"));

    const practice = await (
      await request(editor, "/api/entry/practice/one-task-one-place")
    ).json() as {
      outward: {
        field: string;
        refs: { registry?: string; slug?: string }[];
      }[];
      fields: { path: string; kind: string }[];
    };
    assert(
      practice.outward.some((citation) =>
        citation.field === "agentYields" &&
        citation.refs.some((ref) =>
          ref.registry === "agent-benefit" &&
          ref.slug === "own-one-isolated-effort"
        )
      ),
      "practice entries expose their coding-agent outcomes",
    );
    assertEquals(
      practice.fields.find((field) => field.path === "agentYields")?.kind,
      "string-array",
    );

    const demand = await (
      await request(editor, "/api/entry/demand/checkout-collisions")
    ).json() as {
      file: string;
      fields: {
        path: string;
        editable: boolean;
        editor: string | null;
        picker: { source: string; options: { value: string }[] } | null;
      }[];
    };
    assertEquals(demand.file, "scripts/brand/demand.ts");
    assertEquals(
      demand.fields.find((field) => field.path === "situation")?.editable,
      true,
    );
    const answers = demand.fields.find((field) =>
      field.path === "answer.benefits"
    );
    assertEquals(answers?.editor, "list");
    assertEquals(answers?.picker?.source, "benefit-entry");
    assert(
      answers?.picker?.options.some((option) =>
        option.value === "parallel-work-on-one-machine"
      ),
      "the answer picker derives live benefit ids",
    );

    const term = await (
      await request(editor, "/api/entry/glossary/file-ownership")
    ).json() as {
      fields: {
        path: string;
        kind: string;
        editable: boolean;
        editor: string | null;
      }[];
    };
    const keep = term.fields.find((field) => field.path === "plain.keep");
    assertEquals(keep?.kind, "string");
    assertEquals(keep?.editable, true);
    assertEquals(keep?.editor, "prose");
    assertEquals(
      term.fields.some((field) => field.path === "plain.phrase"),
      false,
      "the rail never invents the other plain-rendering variant",
    );
    assertEquals(
      term.fields.find((field) => field.path === "retired.0.pattern")?.kind,
      "template",
    );

    const accept = await (
      await request(editor, "/api/entry/glossary/accept")
    ).json() as {
      fields: {
        path: string;
        kind: string;
        editable: boolean;
        editor: string | null;
      }[];
    };
    const phrase = accept.fields.find((field) => field.path === "plain.phrase");
    assertEquals(phrase?.kind, "string");
    assertEquals(phrase?.editable, true);
    assertEquals(phrase?.editor, "prose");
    assertEquals(
      accept.fields.some((field) => field.path === "plain.keep"),
      false,
      "switching a phrase to keep remains structural work",
    );

    const engine = await (
      await request(editor, "/api/entry/glossary/engine")
    ).json() as {
      fields: { path: string; editable: boolean; editor: string | null }[];
    };
    const matcher = engine.fields.find((field) => field.path === "plain.match");
    assertEquals(matcher?.editable, false);
    assertEquals(matcher?.editor, null);

    const missing = await request(editor, "/api/entry/feature/nope");
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  });
});

Deno.test("literal editability never overrides a field's semantics", async () => {
  await withCanonEditor(async (editor) => {
    const supportedPickers = new Set<string>(
      (await buildPickerCatalog()).map((picker) => picker.source),
    );
    const project = openRegistryProject(REPO_ROOT);
    for (const entry of registryEntries(project, REPO_ROOT)) {
      const response = await request(
        editor,
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
          (leaf.kind === "string" && semantics?.edit === "prose") ||
            (leaf.kind === "string-array" && semantics?.edit === "list" &&
              semantics.write === "picker" &&
              supportedPickers.has(semantics.picker)),
          `${entry.registry} ${entry.id} · ${leaf.path}`,
        );
      }
    }

    const glossary = await request(editor, "/page/glossary");
    const html = await glossary.text();
    assert(
      /class="canon-editor-field canon-editor-locked"[^>]*data-ref="glossary:file-ownership:term"/
        .test(html),
      "a glossary identity renders as a locked jump, not an editor",
    );
  });
});

Deno.test("untrusted hosts and POST requests are refused before routing", async () => {
  await withCanonEditor(async (editor) => {
    const rebinding = await editor.handler(
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
      const response = await editor.handler(
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

    const trusted = await trustedPost(editor, "/api/lint", {
      registry: "feature",
      kind: "node",
      field: "what",
      value: "A trusted draft.",
    });
    assertEquals(trusted.status, 200, "the editor's own browser may POST");
    await trusted.body?.cancel();
  });
});

Deno.test("a stale browser save receives a conflict without touching disk", async () => {
  await withCanonEditor(async (editor) => {
    const response = await trustedPost(editor, "/api/save", {
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

Deno.test("a list save refuses values outside its live picker", async () => {
  await withCanonEditor(async (editor) => {
    const response = await trustedPost(editor, "/api/save", {
      registry: "agent-benefit",
      slug: "own-one-isolated-effort",
      field: "hints",
      expected: ["silent-worktree-divergence", "start-mcp-re-root"],
      value: ["not-a-registered-hint"],
    });
    assertEquals(response.status, 200);
    const report = await response.json() as { ok: boolean; issue: string };
    assertEquals(report.ok, false);
    assert(report.issue.includes("not a live hint value"));
  });
});

Deno.test("literal glossary plain fields open from the rail and use the normal save route", async () => {
  const appSource = await Deno.readTextFile(
    join(REPO_ROOT, "scripts", "canon_editor", "ui", "app.js"),
  );
  const executable = appSource.replace(
    'import { SYSTEM_SCHEDULER } from "/assets/scheduler.js";',
    "const SYSTEM_SCHEDULER = globalThis.__CANON_TEST_SCHEDULER;",
  );
  for (
    const fixture of [
      {
        slug: "accept",
        title: "Accept",
        field: "plain.phrase",
        value: "move finished work onto the main shared version",
      },
      {
        slug: "file-ownership",
        title: "File ownership",
        field: "plain.keep",
        value: "ownership of files is everyday English",
      },
    ]
  ) {
    const boot = {
      requestTokenHeader: CANON_EDITOR_REQUEST_TOKEN_HEADER,
      requestToken: TEST_REQUEST_TOKEN,
      guards: [{ registry: "glossary", guards: [] }],
    };
    const dom = new JSDOM(
      `<!doctype html><body>
        <script id="canon-editor-boot" type="application/json">${
        JSON.stringify(boot)
      }</script>
        <header class="canon-editor-header"><div class="canon-editor-header-right"></div></header>
        <main id="canon-editor-doc"><span class="canon-editor-field" tabindex="0" data-ref="glossary:${fixture.slug}:definition">Definition</span></main>
        <aside id="canon-editor-rail"><p>Select a field.</p></aside>
        <section id="canon-editor-bench" data-state="lint" hidden>
          <span id="canon-editor-bench-path"></span>
          <div id="canon-editor-bench-status"></div>
          <button id="canon-editor-bench-details-toggle" type="button" hidden></button>
          <pre id="canon-editor-bench-details" hidden></pre>
          <button id="canon-editor-bench-cancel" type="button">Cancel</button>
          <button id="canon-editor-bench-save" type="button">Save</button>
        </section>
      </body>`,
      { runScripts: "outside-only", url: "http://localhost/page/glossary" },
    );
    const editorWindow = dom.window;
    const saves: string[] = [];
    Object.defineProperty(editorWindow, "EventSource", {
      value: class {
        addEventListener(): void {}
      },
    });
    Object.defineProperty(editorWindow, "__CANON_TEST_SCHEDULER", {
      value: {
        scheduleTimeout: (): number => 1,
        cancelTimeout: (): void => {},
      },
    });
    editorWindow.scrollBy = () => {};
    editorWindow.fetch = ((
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const path = String(input);
      if (path === "/api/state") {
        return Promise.resolve(
          Response.json({ reports: [], dirty: [], standards: [] }),
        );
      }
      if (path === `/api/entry/glossary/${fixture.slug}`) {
        return Promise.resolve(Response.json({
          registry: "glossary",
          id: fixture.title,
          slug: fixture.slug,
          title: fixture.title,
          kind: "term",
          parent: null,
          file: "scripts/glossary_registry.ts",
          line: 1,
          outward: [],
          inward: [],
          claimsCarried: [],
          fields: [
            {
              path: "definition",
              kind: "string",
              line: 2,
              editable: true,
              editor: "prose",
              picker: null,
              value: "Definition",
            },
            {
              path: fixture.field,
              kind: "string",
              line: 3,
              editable: true,
              editor: "prose",
              picker: null,
              value: fixture.value,
            },
          ],
        }));
      }
      if (path === "/api/lint") {
        return Promise.resolve(
          Response.json({ findings: [], grade: 8, register: "plain" }),
        );
      }
      if (path === "/api/save") {
        saves.push(String(init?.body));
        return Promise.resolve(Response.json({
          ok: false,
          stage: "patch",
          issue: "fixture stops before mutation",
          restored: false,
        }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as typeof editorWindow.fetch;
    editorWindow.eval(executable);

    const definition = editorWindow.document.querySelector<HTMLElement>(
      ".canon-editor-field",
    );
    assert(definition !== null);
    definition.click();
    await flushEditorUi();
    const row = [...editorWindow.document.querySelectorAll<HTMLElement>(
      ".canon-editor-fieldrow",
    )].find((candidate) => candidate.textContent?.includes(fixture.field));
    const edit = row?.querySelector<HTMLButtonElement>("button");
    assert(edit !== null && edit !== undefined);
    assertEquals(edit.type, "button", "the rail action is keyboard-operable");
    assertEquals(edit.textContent, "Edit");
    edit.click();
    await flushEditorUi();
    const box = editorWindow.document.querySelector<HTMLElement>(
      ".canon-editor-inspector-prose .canon-editor-editor",
    );
    assert(box !== null, `${fixture.field} opens without a document span`);
    assertEquals(box.textContent, fixture.value);
    assertEquals(
      editorWindow.document.getElementById("canon-editor-bench-path")
        ?.textContent,
      `glossary · ${fixture.slug} · ${fixture.field}`,
    );
    box.textContent = `${fixture.value}; revised`;
    editorWindow.document.getElementById("canon-editor-bench-save")?.click();
    await flushEditorUi();
    assertEquals(saves, [JSON.stringify({
      registry: "glossary",
      slug: fixture.slug,
      field: fixture.field,
      expected: fixture.value,
      value: `${fixture.value}; revised`,
    })]);
    dom.window.close();
  }
});

Deno.test("the editor serves worktrees only", async () => {
  await withTempDir(async (dir) => {
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
  });
});

Deno.test("state and page routes answer sanely", async () => {
  await withCanonEditor(async (editor) => {
    const state = await (await request(editor, "/api/state")).json() as {
      pages: { id: string }[];
      standards: { name: string }[];
    };
    assertEquals(state.pages.length, 11);
    const shell = await (await request(editor, "/page/feature-canon")).text();
    for (const page of state.pages) {
      assert(
        shell.includes(`href="/page/${page.id}"`),
        `${page.id} is reachable from the editor navigation`,
      );
    }
    assert(
      state.standards.some((item) => item.name === "plain_reading_grade"),
    );
    const missing = await request(editor, "/page/nope");
    assertEquals(missing.status, 404);
    await missing.body?.cancel();
  });
});
