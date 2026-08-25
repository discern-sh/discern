/** Local site runner: build once, bind only to loopback, and optionally rebuild
 * whenever an authored site input changes. Production continues to use
 * `site/main.ts` and its platform-assigned bind address. */

import {
  siteBuildEventNeedsRebuild,
  siteBuildInputPaths,
} from "./build_inputs.ts";
import { handler } from "./serve.ts";
import { resolveIdentity } from "../src/engine/worktree/identity.ts";
import { fromFileUrl, join } from "@std/path";
import { statIfExists } from "../src/shared/fs_presence.ts";

const REPO_ROOT = new URL("../", import.meta.url);
const REPO_ROOT_PATH = fromFileUrl(REPO_ROOT);
const WATCH_DEBOUNCE_MS = 100;
const SITE_PREVIEW_CONTROL_PATH = "/__discern/site-preview";
const SITE_PREVIEW_CONTROL_HEADER = "x-discern-site-preview-control";
const SITE_PREVIEW_CONTROL_VERSION = "1";
const SITE_PREVIEW_PROBE_TIMEOUT_MS = 300;
const SITE_PREVIEW_SHUTDOWN_ATTEMPTS = 20;

export const SITE_DEV_BIND_HOST = "127.0.0.1";
export const SITE_DEV_BROWSER_HOST = "localhost";
export const DEFAULT_SITE_DEV_PORT = 4507;
export const LOCAL_SITE_BUILD_TASKS = ["site:build"] as const;

export type SitePreviewMode = "site" | "watch" | "specimens";

interface ManagedSitePreviewIdentity {
  readonly mode: SitePreviewMode;
  readonly root: string;
  readonly token: string;
  readonly version: typeof SITE_PREVIEW_CONTROL_VERSION;
}

export type SitePreviewStartPlan =
  | { readonly action: "start" }
  | { readonly action: "reuse"; readonly url: string }
  | {
    readonly action: "replace";
    readonly identity: ManagedSitePreviewIdentity;
    readonly port: number;
  };

/** A local preview cannot bind, but the user can act on the named browser URL. */
export class SiteDevPortInUseError extends Error {
  override readonly name = "SiteDevPortInUseError";
}

/** Options shared by the ordinary and locally linked site-preview runners. */
export interface SiteDevOptions {
  readonly buildConfig?: string;
  readonly extraWatchInputs: readonly string[];
  readonly watch: boolean;
}

/** Parse site-runner arguments without letting an unknown option disappear. */
export function parseSiteDevArgs(args: readonly string[]): SiteDevOptions {
  let buildConfig: string | undefined;
  const extraWatchInputs: string[] = [];
  let watch = false;
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    switch (option) {
      case "--watch":
        watch = true;
        break;
      case "--build-config": {
        const value = args[++index];
        if (value === undefined) {
          throw new Error("--build-config requires a path");
        }
        buildConfig = value;
        break;
      }
      case "--watch-input": {
        const value = args[++index];
        if (value === undefined) {
          throw new Error("--watch-input requires a path");
        }
        extraWatchInputs.push(value);
        break;
      }
      default:
        throw new Error(`unknown site development option: ${option}`);
    }
  }
  return {
    ...(buildConfig === undefined ? {} : { buildConfig }),
    extraWatchInputs,
    watch,
  };
}

/** Parse an optional local port override without silently accepting garbage. */
export function parseSiteDevPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SITE_DEV_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer from 1 to 65535; received ${value}`,
    );
  }
  return port;
}

/** Discover the port discern assigned when this checkout is a linked worktree. */
async function assignedWorktreePort(): Promise<number | undefined> {
  if (!(await statIfExists(join(REPO_ROOT_PATH, ".git")))?.isFile) {
    return undefined;
  }
  return (await resolveIdentity(REPO_ROOT_PATH, REPO_ROOT_PATH)).port;
}

/** Prefer an explicit override, then worktree identity, then the main default. */
export async function resolveSiteDevPort(
  value: string | undefined,
  discover: () => Promise<number | undefined> = assignedWorktreePort,
): Promise<number> {
  if (value !== undefined) return parseSiteDevPort(value);
  return (await discover()) ?? DEFAULT_SITE_DEV_PORT;
}

/** Render the loopback bind as the browser-safe URL every local preview prints. */
export function localSiteUrl(port: number): string {
  return `http://${SITE_DEV_BROWSER_HOST}:${port}/`;
}

/** Explain an occupied preview port without making the user recover it from code. */
export function siteDevPortInUseError(port: number): SiteDevPortInUseError {
  const url = localSiteUrl(port);
  return new SiteDevPortInUseError(
    `The local preview URL is already in use: ${url}\n` +
      `Open ${url} to use what is running there, or set PORT to a free port ` +
      "and rerun the same task.",
  );
}

/** Print expected local-startup failures without Deno's internal bind stack. */
export function reportSiteDevStartupError(
  error: unknown,
  report: (message: string) => void = console.error,
): boolean {
  if (!(error instanceof SiteDevPortInUseError)) return false;
  report(error.message);
  return true;
}

/** Accept control requests only from a non-browser local client. */
function isSitePreviewControlRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.pathname === SITE_PREVIEW_CONTROL_PATH &&
    (url.hostname === SITE_DEV_BIND_HOST ||
      url.hostname === SITE_DEV_BROWSER_HOST) &&
    request.headers.get(SITE_PREVIEW_CONTROL_HEADER) ===
      SITE_PREVIEW_CONTROL_VERSION;
}

/** Validate the private response before treating a port occupant as replaceable. */
function managedSitePreviewIdentity(
  value: unknown,
): ManagedSitePreviewIdentity | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.version !== SITE_PREVIEW_CONTROL_VERSION ||
    record.root !== REPO_ROOT_PATH ||
    typeof record.token !== "string" ||
    (record.mode !== "site" && record.mode !== "watch" &&
      record.mode !== "specimens")
  ) {
    return undefined;
  }
  return {
    mode: record.mode,
    root: record.root,
    token: record.token,
    version: record.version,
  };
}

/** Probe the selected URL before spending work on a build that cannot be served. */
async function discoverManagedSitePreview(
  port: number,
): Promise<ManagedSitePreviewIdentity | "unknown" | undefined> {
  try {
    const response = await fetch(
      `http://${SITE_DEV_BIND_HOST}:${port}${SITE_PREVIEW_CONTROL_PATH}`,
      {
        headers: {
          [SITE_PREVIEW_CONTROL_HEADER]: SITE_PREVIEW_CONTROL_VERSION,
        },
        signal: AbortSignal.timeout(SITE_PREVIEW_PROBE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return "unknown";
    return managedSitePreviewIdentity(await response.json()) ?? "unknown";
  } catch {
    return undefined;
  }
}

/** Decide whether this invocation starts, reuses a live watcher, or replaces. */
export async function planSitePreviewStart(
  port: number,
  mode: SitePreviewMode,
): Promise<SitePreviewStartPlan> {
  const existing = await discoverManagedSitePreview(port);
  if (existing === undefined) return { action: "start" };
  if (existing === "unknown") throw siteDevPortInUseError(port);
  if (existing.mode === "watch") {
    if (mode === "site" || mode === "watch") {
      return { action: "reuse", url: localSiteUrl(port) };
    }
    throw siteDevPortInUseError(port);
  }
  return { action: "replace", identity: existing, port };
}

/** Ask a compatible one-shot preview to close, then wait for its bind to clear. */
export async function replaceManagedSitePreview(
  plan: Extract<SitePreviewStartPlan, { readonly action: "replace" }>,
): Promise<void> {
  const endpoint =
    `http://${SITE_DEV_BIND_HOST}:${plan.port}${SITE_PREVIEW_CONTROL_PATH}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${plan.identity.token}`,
        [SITE_PREVIEW_CONTROL_HEADER]: SITE_PREVIEW_CONTROL_VERSION,
      },
      signal: AbortSignal.timeout(SITE_PREVIEW_PROBE_TIMEOUT_MS),
    });
  } catch {
    throw siteDevPortInUseError(plan.port);
  }
  if (response.status !== 202) throw siteDevPortInUseError(plan.port);
  for (let attempt = 0; attempt < SITE_PREVIEW_SHUTDOWN_ATTEMPTS; attempt++) {
    if (await discoverManagedSitePreview(plan.port) === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw siteDevPortInUseError(plan.port);
}

/** One fresh-process build command, optionally pinned to a temporary config. */
export function localSiteBuildCommandArgs(
  buildConfig?: string,
): string[] {
  if (buildConfig === undefined) return ["task", ...LOCAL_SITE_BUILD_TASKS];
  return [
    "run",
    "--config",
    buildConfig,
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env=NODE_ENV",
    join(REPO_ROOT_PATH, "site/build.ts"),
  ];
}

/** Run the build in a fresh process so changed TS modules cannot remain cached. */
async function runSiteBuild(buildConfig?: string): Promise<boolean> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: localSiteBuildCommandArgs(buildConfig),
    cwd: REPO_ROOT_PATH,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return result.success;
}

/** Local development serves the same route surface as production. */
export async function localHandler(request: Request): Promise<Response> {
  return await handler(request);
}

/** Start one managed preview with a private, same-checkout replacement route. */
export function startManagedSiteServer(
  port: number,
  mode: SitePreviewMode,
  previewHandler: (request: Request) => Response | Promise<Response>,
  onListen: (url: string) => void,
): Deno.HttpServer<Deno.NetAddr> {
  const identity: ManagedSitePreviewIdentity = {
    mode,
    root: REPO_ROOT_PATH,
    token: crypto.randomUUID(),
    version: SITE_PREVIEW_CONTROL_VERSION,
  };
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  const managedHandler = async (request: Request): Promise<Response> => {
    if (!isSitePreviewControlRequest(request)) {
      return await previewHandler(request);
    }
    if (request.method === "GET") return Response.json(identity);
    if (
      request.method !== "POST" || mode === "watch" ||
      request.headers.get("authorization") !== `Bearer ${identity.token}`
    ) {
      return new Response(null, { status: 403 });
    }
    const activeServer = server;
    if (activeServer === undefined) return new Response(null, { status: 503 });
    queueMicrotask(() => {
      void activeServer.shutdown();
    });
    return new Response(null, { status: 202 });
  };
  try {
    server = Deno.serve(
      {
        hostname: SITE_DEV_BIND_HOST,
        port,
        onListen: () => onListen(localSiteUrl(port)),
      },
      managedHandler,
    );
  } catch (error) {
    if (error instanceof Deno.errors.AddrInUse) {
      throw siteDevPortInUseError(port);
    }
    throw error;
  }
  return server;
}

/** Consumer inputs plus any source trees supplied by a local package runner. */
export function localSiteWatchInputPaths(
  extraWatchInputs: readonly string[],
): string[] {
  return [...new Set([...siteBuildInputPaths(), ...extraWatchInputs])];
}

/** Rebuild the site from the same config whenever an authored input changes. */
async function watchSiteBuildInputs(
  options: SiteDevOptions,
): Promise<never> {
  const watcher = Deno.watchFs(
    localSiteWatchInputPaths(options.extraWatchInputs),
  );
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let rebuilding = false;
  let rebuildAgain = false;

  const rebuild = async (): Promise<void> => {
    if (rebuilding) {
      rebuildAgain = true;
      return;
    }
    rebuilding = true;
    try {
      do {
        rebuildAgain = false;
        console.log("Site source changed; rebuilding...");
        if (!await runSiteBuild(options.buildConfig)) {
          console.error("Site build failed; watching for the next change.");
        }
      } while (rebuildAgain);
    } finally {
      rebuilding = false;
    }
  };

  console.log("Watching authored site inputs...");
  for await (const event of watcher) {
    if (event.kind === "access" || !siteBuildEventNeedsRebuild(event.paths)) {
      continue;
    }
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      void rebuild();
    }, WATCH_DEBOUNCE_MS);
  }
  throw new Error("Site input watcher stopped unexpectedly");
}

/** Build and serve the site, staying alive to rebuild when requested. */
export async function runLocalSite(options: SiteDevOptions): Promise<void> {
  const port = await resolveSiteDevPort(Deno.env.get("PORT"));
  const mode = options.watch ? "watch" : "site";
  const plan = await planSitePreviewStart(port, mode);
  if (plan.action === "reuse") {
    console.log(`Site already available and rebuilding at ${plan.url}`);
    return;
  }
  if (!await runSiteBuild(options.buildConfig)) {
    throw new Error("Initial site build failed");
  }
  if (plan.action === "replace") await replaceManagedSitePreview(plan);
  const server = startManagedSiteServer(
    port,
    mode,
    localHandler,
    (url) => console.log(`Site listening on ${url}`),
  );
  if (options.watch) await watchSiteBuildInputs(options);
  await server.finished;
}

if (import.meta.main) {
  try {
    await runLocalSite(parseSiteDevArgs(Deno.args));
  } catch (error) {
    if (reportSiteDevStartupError(error)) Deno.exit(1);
    throw error;
  }
}
