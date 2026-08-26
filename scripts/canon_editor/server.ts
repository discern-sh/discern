/**
 * Canon Editor's server. Serves the canon pages rendered
 * by the real renderers with provenance spans, the entry inspector API, IDE
 * jumps, the guard panel, and a change feed that refreshes the editor when a
 * registry file moves on disk.
 *
 * Loopback only, one worktree's editor per derived port, everything
 * `cache-control: no-store` — this is repo-internal tooling, never shipped.
 */

import { join } from "@std/path";
import { bestEffort, bestEffortSync } from "../../src/shared/best_effort.ts";
import { detachPromise } from "../../src/shared/promise_effects.ts";
import { REPO_ROOT } from "./root.ts";
import { openInIde } from "./locate.ts";
import {
  fieldLeaves,
  type FieldValueKind,
  openRegistryProject,
  registryEntries,
} from "./registry_ast.ts";
import type { Snapshot, SnapshotEntry } from "./snapshot.ts";
import { renderDocHtml, renderShell, type SpanState } from "./html.ts";
import { emitCanonEditorAssets } from "./assets.ts";
import { type GuardRunReport, runGuardFiles } from "./guards.ts";
import { saveField, spawnSnapshot } from "./pipeline.ts";
import type { PatchRequest } from "./patch.ts";
import { lintFieldText, valeFindings } from "./lint.ts";
import { fieldSpecFor } from "./fields.ts";
import type { RegistryName } from "./registry_ast.ts";
import { PROSE_REGISTRIES } from "./registry_ast.ts";
import {
  portForId,
  resolveIdentity,
} from "../../src/engine/worktree/identity.ts";
import { statIfExists } from "../../src/shared/fs_presence.ts";
import { runGit } from "../../src/shared/subprocess.ts";
import { THEME_BOOTSTRAP } from "../../site/theme.ts";
import { type PickerCatalogEntry, pickerFromCatalog } from "./pickers.ts";

const BIND_HOST = "127.0.0.1";
const BROWSER_HOST = "localhost";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  BROWSER_HOST,
  BIND_HOST,
]);

/** Header carrying the per-process authority for non-safe HTTP methods. */
export const CANON_EDITOR_REQUEST_TOKEN_HEADER = "x-canon-editor-token";

/** The fallback port when no worktree identity resolves. */
export const DEFAULT_CANON_EDITOR_PORT = 4517;

const WATCH_DEBOUNCE_MS = 200;

/** The files whose change means the canon (or its interpolations) moved. */
const WATCHED_SOURCES: readonly string[] = [
  ...new Set(PROSE_REGISTRIES.map((registry) => registry.file)),
  "scripts/feature_surface_catalog.ts",
  "scripts/canonical_sets.ts",
  "scripts/canon_editor/pickers.ts",
  "src/shared/capabilities.ts",
  "src/shared/agent_catalogue.ts",
  "src/shared/config_schema.ts",
  "src/shared/hints.ts",
  "src/shared/paths_registry.ts",
  "src/shared/verbs.ts",
  "templates/skills",
];

/** Parse an explicit PORT override without silently accepting garbage. */
export function parseCanonEditorPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CANON_EDITOR_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 to 65535; received ${value}`,
    );
  }
  return port;
}

/**
 * The editor's port: an explicit override, then a salt of the worktree's
 * identity (so the editor and the site dev server coexist in one worktree,
 * each deterministic), then the main-checkout default.
 */
export async function resolveCanonEditorPort(
  value: string | undefined,
): Promise<number> {
  if (value !== undefined) return parseCanonEditorPort(value);
  if ((await statIfExists(join(REPO_ROOT, ".git")))?.isFile) {
    const identity = await resolveIdentity(REPO_ROOT, REPO_ROOT);
    return portForId(`${identity.id}-canon-editor`);
  }
  return DEFAULT_CANON_EDITOR_PORT;
}

/** One entry's syntax-side positions, kept beside the evaluated snapshot. */
interface AstRecord {
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly leaves: readonly {
    readonly path: string;
    readonly kind: FieldValueKind;
    readonly line: number;
  }[];
}

/** The browser control available for one syntax leaf. */
type FieldEditor =
  | { readonly kind: "prose" }
  | { readonly kind: "list"; readonly picker: PickerCatalogEntry };

/** Options the tests use to run the editor hermetically. */
export interface CanonEditorOptions {
  readonly port?: number;
  /** Skip the design-system emit (tests exercise routes, not chrome). */
  readonly emitAssets?: boolean;
  /** Skip the file watcher (tests refresh explicitly). */
  readonly watch?: boolean;
  /**
   * Skip the socket: the suite runs without net access, so tests drive the
   * returned handler directly.
   */
  readonly listen?: boolean;
  /** Build the snapshot in-process instead of spawning the subprocess. */
  readonly snapshotBuilder?: () => Promise<Snapshot>;
  /** Deterministic request authority for route tests; random in production. */
  readonly requestToken?: string;
}

/** A running editor, closable. */
export interface CanonEditorHandle {
  readonly port: number;
  readonly url: string;
  /** The route handler itself, for socketless tests. */
  readonly handler: (request: Request) => Promise<Response>;
  close(): Promise<void>;
  /** Rebuild the snapshot and syntax index now (the watcher's path). */
  refresh(): Promise<void>;
}

/** Walk a dotted path through evaluated entry data. */
function valueAt(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** JSON response with the editor's no-store discipline. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Whether an untrusted JSON value is a complete string list. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

/** Refuse DNS-rebound hosts and every non-safe request lacking browser proof. */
function requestAuthorityIssue(
  request: Request,
  url: URL,
  requestToken: string,
): string | undefined {
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return "Canon Editor only answers requests for a loopback Host";
  }
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (request.headers.get("origin") !== url.origin) {
    return "the request Origin does not match Canon Editor";
  }
  if (request.headers.get(CANON_EDITOR_REQUEST_TOKEN_HEADER) !== requestToken) {
    return "the request does not carry Canon Editor's write authority";
  }
  return undefined;
}

/** Static file response typed by extension. */
async function file(path: string): Promise<Response> {
  const types: Readonly<Record<string, string>> = {
    css: "text/css; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    woff2: "font/woff2",
    txt: "text/plain; charset=utf-8",
  };
  try {
    const body = await Deno.readFile(path);
    const extension = path.split(".").at(-1) ?? "";
    return new Response(body, {
      headers: {
        "content-type": types[extension] ?? "application/octet-stream",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

/** Start the editor server; resolve once it is listening. */
export async function startCanonEditor(
  options: CanonEditorOptions = {},
): Promise<CanonEditorHandle> {
  const port = options.port ??
    (await resolveCanonEditorPort(Deno.env.get("PORT")));
  const requestToken = options.requestToken ?? crypto.randomUUID();

  let snapshot: Snapshot | undefined;
  let snapshotError: string | undefined;
  let ast = new Map<string, AstRecord>();
  let saving = false;
  let skipNextWatchRefresh = false;
  const guardReports = new Map<string, GuardRunReport>();
  const guardRunning = new Set<string>();
  const sse = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const notify = (event: Record<string, unknown>): void => {
    const chunk = new TextEncoder().encode(
      `data: ${JSON.stringify(event)}\n\n`,
    );
    for (const controller of sse) {
      try {
        controller.enqueue(chunk);
      } catch {
        sse.delete(controller);
      }
    }
  };

  const buildAst = (): void => {
    const next = new Map<string, AstRecord>();
    const project = openRegistryProject(REPO_ROOT);
    for (const entry of registryEntries(project, REPO_ROOT)) {
      next.set(`${entry.registry}:${entry.slug}`, {
        kind: entry.kind,
        file: entry.file,
        line: entry.line,
        leaves: fieldLeaves(entry).map((leaf) => ({
          path: leaf.path,
          kind: leaf.kind,
          line: leaf.line,
        })),
      });
    }
    ast = next;
  };

  const refresh = async (): Promise<void> => {
    try {
      snapshot = await (options.snapshotBuilder ?? (() =>
        spawnSnapshot(REPO_ROOT)))();
      snapshotError = undefined;
      buildAst();
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error);
    }
    notify({ type: "snapshot", error: snapshotError ?? null });
  };

  const fieldEditor = (
    registry: string,
    kind: string,
    leaf: AstRecord["leaves"][number],
  ): FieldEditor | undefined => {
    const known = PROSE_REGISTRIES.find((item) => item.name === registry)?.name;
    if (known === undefined) return undefined;
    const semantics = fieldSpecFor(known, kind, leaf.path);
    if (semantics === undefined) return undefined;
    if (leaf.kind === "string" && semantics.edit === "prose") {
      return { kind: "prose" };
    }
    if (
      leaf.kind === "string-array" && semantics.edit === "list" &&
      semantics.write === "picker"
    ) {
      const picker = pickerFromCatalog(
        snapshot?.pickers ?? [],
        semantics.picker,
      );
      if (picker !== undefined) return { kind: "list", picker };
    }
    return undefined;
  };

  const fieldState = (
    registry: string,
    kind: string,
    leaf: AstRecord["leaves"][number],
  ): SpanState => {
    const known = PROSE_REGISTRIES.find((item) => item.name === registry)?.name;
    if (known === undefined) return "unknown";
    const semantics = fieldSpecFor(known, kind, leaf.path);
    if (semantics === undefined) return "unknown";
    return fieldEditor(registry, kind, leaf) === undefined
      ? "locked"
      : "editable";
  };

  const spanState = (token: string): SpanState => {
    const [registry, slug, ...fieldParts] = token.split(":");
    const field = fieldParts.join(":");
    if (registry === undefined || slug === undefined || field === "") {
      return "unknown";
    }
    const record = ast.get(`${registry}:${slug}`);
    const leaf = record?.leaves.find((candidate) => candidate.path === field);
    if (record === undefined || leaf === undefined) return "unknown";
    return fieldState(registry, record.kind, leaf);
  };

  const entryPayload = (
    found: SnapshotEntry,
    record: AstRecord | undefined,
  ): Record<string, unknown> => ({
    registry: found.registry,
    id: found.id,
    slug: found.slug,
    title: found.title,
    kind: found.kind,
    parent: found.parent ?? null,
    file: record?.file ?? null,
    line: record?.line ?? null,
    outward: found.outward,
    inward: found.inward,
    claimsCarried: found.claimsCarried ?? [],
    fields: (record?.leaves ?? []).map((leaf) => {
      const editor = fieldEditor(found.registry, found.kind, leaf);
      return {
        path: leaf.path,
        kind: leaf.kind,
        line: leaf.line,
        editable: editor !== undefined,
        editor: editor?.kind ?? null,
        picker: editor?.kind === "list" ? editor.picker : null,
        value: valueAt(found.data, leaf.path) ?? null,
      };
    }),
  });

  const runGuards = (registry: string, files: readonly string[]): void => {
    if (guardRunning.has(registry)) return;
    guardRunning.add(registry);
    notify({ type: "guards", registry, status: "running" });
    detachPromise(
      "canon-editor-guard-run",
      () =>
        runGuardFiles(registry, files)
          .then((report) => {
            guardReports.set(registry, report);
            notify({
              type: "guards",
              registry,
              status: "finished",
              ok: report.ok,
            });
          })
          .finally(() => guardRunning.delete(registry)),
      (error) => console.error("Canon Editor guard run failed:", error),
    );
  };

  const gitDirty = async (): Promise<string[]> => {
    // Only the files the editor can write: the registry sources and the
    // committed canon pages. Other repository changes are outside this feed.
    const writable = [
      ...PROSE_REGISTRIES.map((spec) => spec.file),
      ...(snapshot?.pages ?? [])
        .filter((page) => page.annotated && page.rel.startsWith("project/map/"))
        .map((page) => page.rel),
    ];
    try {
      const output = await runGit(
        ["status", "--porcelain", "--", ...writable],
        {
          cwd: REPO_ROOT,
        },
      );
      if (!output.success) return [];
      return output.stdout
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.slice(3));
    } catch {
      // discern-best-effort: canon-editor-git-dirty-fallback
      return [];
    }
  };

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const authorityIssue = requestAuthorityIssue(
      request,
      url,
      requestToken,
    );
    if (authorityIssue !== undefined) {
      return json({ error: authorityIssue }, 403);
    }
    const path = url.pathname;
    if (path === "/") {
      return Response.redirect(`${url.origin}/page/feature-canon`, 302);
    }
    if (path.startsWith("/page/")) {
      if (snapshot === undefined) {
        return new Response(
          `Canon Editor's snapshot is not ready${
            snapshotError === undefined ? "" : `: ${snapshotError}`
          }`,
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      const id = path.slice("/page/".length);
      const page = snapshot.pages.find((candidate) => candidate.id === id);
      if (page === undefined) {
        return new Response("no such page", { status: 404 });
      }
      const doc = renderDocHtml(page, spanState);
      if (doc.leftover > 0) {
        console.error(
          `${page.id}: ${doc.leftover} annotation markers survived the span transform`,
        );
      }
      return new Response(
        renderShell({
          page,
          docHtml: doc.html,
          snapshot,
          themeBootstrap: THEME_BOOTSTRAP,
          requestToken,
          requestTokenHeader: CANON_EDITOR_REQUEST_TOKEN_HEADER,
        }),
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-robots-tag": "noindex, nofollow",
          },
        },
      );
    }
    if (path.startsWith("/api/entry/")) {
      const [registry, slug] = path.slice("/api/entry/".length).split("/");
      const found = snapshot?.entries.find(
        (entry) => entry.registry === registry && entry.slug === slug,
      );
      if (found === undefined || registry === undefined) {
        return json({ error: "no such entry" }, 404);
      }
      return json(entryPayload(found, ast.get(`${registry}:${found.slug}`)));
    }
    if (path === "/api/open" && request.method === "POST") {
      const body = (await request.json()) as {
        registry?: string;
        slug?: string;
        field?: string;
      };
      const record = ast.get(`${body.registry}:${body.slug}`);
      if (record === undefined) return json({ error: "no such entry" }, 404);
      const leaf = record.leaves.find((c) => c.path === body.field);
      const line = leaf?.line ?? record.line;
      const opened = await openInIde(record.file, line);
      return json({
        opened,
        file: record.file,
        line,
        ...(opened ? {} : {
          hint:
            "PhpStorm couldn't take the jump: no handler answered the phpstorm:// URL scheme and no `phpstorm` launcher is on PATH. Is PhpStorm installed?",
        }),
      });
    }
    if (path === "/api/state") {
      return json({
        error: snapshotError ?? null,
        saving,
        pages: snapshot?.pages.map((page) => ({
          id: page.id,
          title: page.title,
          rel: page.rel,
        })) ?? [],
        standards: snapshot?.standards ?? [],
        guards: snapshot?.guards ?? [],
        reports: [...guardReports.values()],
        dirty: await gitDirty(),
      });
    }
    if (path === "/api/lint" && request.method === "POST") {
      const body = (await request.json()) as {
        registry?: string;
        kind?: string;
        field?: string;
        value?: string;
        vale?: boolean;
      };
      const registry = PROSE_REGISTRIES.find(
        (spec) => spec.name === body.registry,
      )?.name;
      if (
        registry === undefined || body.field === undefined ||
        typeof body.value !== "string"
      ) {
        return json({ error: "malformed lint request" }, 400);
      }
      const spec = fieldSpecFor(registry, body.kind ?? "node", body.field);
      if (spec?.edit !== "prose") {
        return json({ findings: [], grade: null });
      }
      const report = lintFieldText(
        {
          retired: snapshot?.lint.retired ?? [],
          plainPoliced: snapshot?.lint.plainPoliced ?? [],
        },
        spec.register,
        body.value,
      );
      const findings = body.vale === true
        ? [
          ...report.findings,
          ...(await valeFindings(REPO_ROOT, spec.register, body.value)),
        ]
        : report.findings;
      return json({
        findings,
        grade: report.grade ?? null,
        register: spec.register,
      });
    }
    if (path === "/api/save" && request.method === "POST") {
      if (saving) {
        return json({
          ok: false,
          stage: "patch",
          issue: "a save is already running",
        }, 409);
      }
      if (snapshot === undefined) {
        return json(
          { ok: false, stage: "patch", issue: "snapshot not ready" },
          503,
        );
      }
      const body = (await request.json()) as {
        registry?: string;
        slug?: unknown;
        field?: unknown;
        expected?: unknown;
        value?: unknown;
      };
      const registry = PROSE_REGISTRIES.find(
        (spec) => spec.name === body.registry,
      )?.name as RegistryName | undefined;
      if (
        registry === undefined || typeof body.slug !== "string" ||
        typeof body.field !== "string"
      ) {
        return json(
          { ok: false, stage: "patch", issue: "malformed save request" },
          400,
        );
      }
      let patch: PatchRequest;
      if (
        typeof body.expected === "string" && typeof body.value === "string"
      ) {
        patch = {
          mode: "prose",
          registry,
          slug: body.slug,
          field: body.field,
          expected: body.expected,
          value: body.value,
        };
      } else if (
        isStringList(body.expected) && isStringList(body.value)
      ) {
        patch = {
          mode: "list",
          registry,
          slug: body.slug,
          field: body.field,
          expected: body.expected,
          value: body.value,
        };
      } else {
        return json(
          { ok: false, stage: "patch", issue: "malformed save request" },
          400,
        );
      }
      saving = true;
      try {
        const roster = snapshot.guards;
        const report = await saveField(
          patch,
          {
            root: REPO_ROOT,
            pickers: snapshot.pickers,
            guardsFor: (name) =>
              roster.find((candidate) => candidate.registry === name)
                ?.guards ?? [],
            buildSnapshot: options.snapshotBuilder ??
              (() => spawnSnapshot(REPO_ROOT)),
            onStage: (stage) => notify({ type: "save", stage }),
          },
        );
        if (report.ok && report.applied && report.snapshot !== undefined) {
          snapshot = report.snapshot;
          snapshotError = undefined;
          buildAst();
          skipNextWatchRefresh = true;
          notify({ type: "snapshot", error: null });
        }
        if (!report.ok && report.restored === true) {
          // The rollback rewrote the held bytes, so disk again matches the
          // snapshot already in memory; the watcher's next cycle stands down.
          skipNextWatchRefresh = true;
        }
        if (report.ok && report.guards !== undefined) {
          guardReports.set(registry, report.guards);
        }
        return json(
          report.ok
            ? {
              ok: true,
              applied: report.applied,
              pages: report.pages,
              registryChanged: report.registryChanged ?? null,
              guards: report.guards ?? null,
              twin: report.twin ?? null,
              grade: report.grade ?? null,
            }
            : {
              ok: false,
              stage: report.stage,
              issue: report.issue,
              guards: report.guards ?? null,
              restored: report.restored ?? false,
            },
          !report.ok && report.conflict === true ? 409 : 200,
        );
      } finally {
        saving = false;
      }
    }
    if (path === "/api/guards/run" && request.method === "POST") {
      const body = (await request.json()) as { registry?: string };
      const roster = snapshot?.guards.find(
        (candidate) => candidate.registry === body.registry,
      );
      if (roster === undefined || body.registry === undefined) {
        return json({ error: "no such registry" }, 404);
      }
      runGuards(body.registry, roster.guards);
      return json({ started: true }, 202);
    }
    if (path === "/events") {
      let controllerRef: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller): void {
          controllerRef = controller;
          sse.add(controller);
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        },
        cancel(): void {
          sse.delete(controllerRef);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
        },
      });
    }
    if (path === "/assets/app.css" || path === "/assets/app.js") {
      return await file(
        join(
          REPO_ROOT,
          "scripts",
          "canon_editor",
          "ui",
          path.slice("/assets/".length),
        ),
      );
    }
    if (path === "/assets/theme.css" || path === "/assets/theme.js") {
      return await file(
        join(
          REPO_ROOT,
          "site",
          "pages",
          "assets",
          path.slice("/assets/".length),
        ),
      );
    }
    if (path.startsWith("/assets/design-system/")) {
      const rest = path.slice("/assets/design-system/".length);
      if (rest.includes("..")) return new Response("no", { status: 400 });
      return await file(
        join(
          REPO_ROOT,
          ".scratch",
          "canon-editor",
          "assets",
          "design-system",
          rest,
        ),
      );
    }
    return new Response("not found", { status: 404 });
  };

  if (options.emitAssets ?? true) {
    await emitCanonEditorAssets(REPO_ROOT);
  }
  await refresh();

  let watcher: Deno.FsWatcher | undefined;
  let watchLoop: Promise<void> | undefined;
  if (options.watch ?? true) {
    watcher = Deno.watchFs(
      WATCHED_SOURCES.map((source) => join(REPO_ROOT, source)),
    );
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const owned = watcher;
    watchLoop = (async () => {
      for await (const event of owned) {
        if (event.kind === "access") continue;
        if (debounce !== undefined) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = undefined;
          if (saving) {
            // Mid-save writes are the pipeline's own; its verdict — adoption
            // or rollback — decides what happens, not a watcher refresh.
            return;
          }
          if (skipNextWatchRefresh) {
            // The save pipeline just wrote the registry and adopted its own
            // fresh snapshot; one watcher cycle stands down.
            skipNextWatchRefresh = false;
            return;
          }
          detachPromise(
            "canon-editor-watch-refresh",
            refresh,
            (error) => console.error("Canon Editor refresh failed:", error),
          );
        }, WATCH_DEBOUNCE_MS);
      }
    })();
  }

  const server = (options.listen ?? true)
    ? Deno.serve(
      {
        hostname: BIND_HOST,
        port,
        onListen: ({ port: bound }) => {
          console.log(
            `Canon Editor is open: http://${BROWSER_HOST}:${bound}/`,
          );
        },
      },
      handler,
    )
    : undefined;

  const boundPort = server?.addr.port ?? port;
  return {
    port: boundPort,
    url: `http://${BROWSER_HOST}:${boundPort}/`,
    handler,
    refresh,
    close: async (): Promise<void> => {
      watcher?.close();
      if (watchLoop !== undefined) {
        await bestEffort("canon-editor-watch-loop-settlement", async () => {
          await watchLoop;
        });
      }
      for (const controller of sse) {
        bestEffortSync("canon-editor-sse-controller-close", () => {
          controller.close();
        });
      }
      sse.clear();
      await server?.shutdown();
    },
  };
}
