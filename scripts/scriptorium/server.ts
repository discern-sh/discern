/**
 * The Scriptorium's server: the reading room. Serves the canon pages rendered
 * by the real renderers with provenance spans, the entry inspector API, IDE
 * jumps, the guard panel, and a change feed that refreshes the studio when a
 * registry file moves on disk.
 *
 * Loopback only, one worktree's studio per derived port, everything
 * `cache-control: no-store` — this is repo-internal tooling, never shipped.
 */

import { join } from "@std/path";
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
import { emitStudioAssets } from "./assets.ts";
import { type GuardRunReport, runGuardFiles } from "./guards.ts";
import { saveField, spawnSnapshot } from "./pipeline.ts";
import type { RegistryName } from "./registry_ast.ts";
import { PROSE_REGISTRIES } from "./registry_ast.ts";
import {
  portForId,
  resolveIdentity,
} from "../../src/engine/worktree/identity.ts";
import { THEME_BOOTSTRAP } from "../../site/theme.ts";

const BIND_HOST = "127.0.0.1";
const BROWSER_HOST = "localhost";

/** The studio's fixed port on a main checkout without a worktree identity. */
export const DEFAULT_STUDIO_PORT = 4517;

const WATCH_DEBOUNCE_MS = 200;

/** The files whose change means the canon (or its interpolations) moved. */
const WATCHED_SOURCES: readonly string[] = [
  "scripts/feature_registry.ts",
  "scripts/practice_registry.ts",
  "scripts/glossary_registry.ts",
  "scripts/brand/claims.ts",
  "scripts/canonical_sets.ts",
  "src/shared/capabilities.ts",
  "src/shared/agent_catalogue.ts",
  "src/shared/paths_registry.ts",
];

/** Parse an explicit PORT override without silently accepting garbage. */
export function parseStudioPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_STUDIO_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 to 65535; received ${value}`,
    );
  }
  return port;
}

/**
 * The studio's port: an explicit override, then a salt of the worktree's
 * identity (so the studio and the site dev server coexist in one worktree,
 * each deterministic), then the main-checkout default.
 */
export async function resolveStudioPort(
  value: string | undefined,
): Promise<number> {
  if (value !== undefined) return parseStudioPort(value);
  try {
    if ((await Deno.stat(join(REPO_ROOT, ".git"))).isFile) {
      const identity = await resolveIdentity(REPO_ROOT, REPO_ROOT);
      return portForId(`${identity.id}-scriptorium`);
    }
  } catch {
    // Fall through to the main-checkout default.
  }
  return DEFAULT_STUDIO_PORT;
}

/** One entry's syntax-side positions, kept beside the evaluated snapshot. */
interface AstRecord {
  readonly file: string;
  readonly line: number;
  readonly leaves: readonly {
    readonly path: string;
    readonly kind: FieldValueKind;
    readonly line: number;
  }[];
}

/** Options the tests use to run the studio hermetically. */
export interface StudioOptions {
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
}

/** A running studio, closable. */
export interface StudioHandle {
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

/** JSON response with the studio's no-store discipline. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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

/** Start the studio server; resolve once it is listening. */
export async function startStudio(
  options: StudioOptions = {},
): Promise<StudioHandle> {
  const port = options.port ?? (await resolveStudioPort(Deno.env.get("PORT")));

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

  const spanState = (token: string): SpanState => {
    const [registry, slug, ...fieldParts] = token.split(":");
    const field = fieldParts.join(":");
    if (registry === undefined || slug === undefined || field === "") {
      return "unknown";
    }
    const record = ast.get(`${registry}:${slug}`);
    const leaf = record?.leaves.find((candidate) => candidate.path === field);
    if (leaf === undefined) return "unknown";
    return leaf.kind === "string" ? "editable" : "locked";
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
    fields: (record?.leaves ?? []).map((leaf) => ({
      path: leaf.path,
      kind: leaf.kind,
      line: leaf.line,
      editable: leaf.kind === "string",
      value: valueAt(found.data, leaf.path) ?? null,
    })),
  });

  const runGuards = (registry: string, files: readonly string[]): void => {
    if (guardRunning.has(registry)) return;
    guardRunning.add(registry);
    notify({ type: "guards", registry, status: "running" });
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
      .finally(() => guardRunning.delete(registry));
  };

  const gitDirty = async (): Promise<string[]> => {
    try {
      const output = await new Deno.Command("git", {
        args: ["status", "--porcelain", "--", "scripts/", "project/map/"],
        cwd: REPO_ROOT,
        stdin: "null",
        stdout: "piped",
        stderr: "null",
      }).output();
      if (!output.success) return [];
      return new TextDecoder()
        .decode(output.stdout)
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.slice(3));
    } catch {
      return [];
    }
  };

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/") {
      return Response.redirect(`${url.origin}/page/feature-canon`, 302);
    }
    if (path.startsWith("/page/")) {
      if (snapshot === undefined) {
        return new Response(
          `The studio's snapshot is not ready${
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
      const opened = openInIde(record.file, line);
      return json({ opened, file: record.file, line });
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
        slug?: string;
        field?: string;
        value?: string;
      };
      const registry = PROSE_REGISTRIES.find(
        (spec) => spec.name === body.registry,
      )?.name as RegistryName | undefined;
      if (
        registry === undefined || body.slug === undefined ||
        body.field === undefined || typeof body.value !== "string"
      ) {
        return json(
          { ok: false, stage: "patch", issue: "malformed save request" },
          400,
        );
      }
      saving = true;
      try {
        const roster = snapshot.guards;
        const report = await saveField(
          { registry, slug: body.slug, field: body.field, value: body.value },
          {
            root: REPO_ROOT,
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
            },
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
          "scriptorium",
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
          "scriptorium",
          "assets",
          "design-system",
          rest,
        ),
      );
    }
    return new Response("not found", { status: 404 });
  };

  if (options.emitAssets ?? true) {
    await emitStudioAssets(REPO_ROOT);
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
          if (skipNextWatchRefresh) {
            // The save pipeline just wrote the registry and adopted its own
            // fresh snapshot; one watcher cycle stands down.
            skipNextWatchRefresh = false;
            return;
          }
          void refresh();
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
            `The Scriptorium is open: http://${BROWSER_HOST}:${bound}/`,
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
      await watchLoop?.catch(() => undefined);
      for (const controller of sse) {
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
      sse.clear();
      await server?.shutdown();
    },
  };
}
