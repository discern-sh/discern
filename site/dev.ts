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

const REPO_ROOT = new URL("../", import.meta.url);
const REPO_ROOT_PATH = fromFileUrl(REPO_ROOT);
const WATCH_DEBOUNCE_MS = 100;

export const SITE_DEV_BIND_HOST = "127.0.0.1";
export const SITE_DEV_BROWSER_HOST = "localhost";
export const DEFAULT_SITE_DEV_PORT = 4507;
export const LOCAL_SITE_BUILD_TASKS = ["site:build"] as const;

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
  try {
    if (!(await Deno.stat(join(REPO_ROOT_PATH, ".git"))).isFile) {
      return undefined;
    }
  } catch {
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

/** Run the build in a fresh process so changed TS modules cannot remain cached. */
async function runSiteBuild(): Promise<boolean> {
  for (const task of LOCAL_SITE_BUILD_TASKS) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["task", task],
      cwd: REPO_ROOT_PATH,
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!result.success) return false;
  }
  return true;
}

/** Local development serves the same route surface as production. */
export async function localHandler(request: Request): Promise<Response> {
  return await handler(request);
}

/** Start the production route handler on the local development port. */
function startSiteServer(port: number): Deno.HttpServer<Deno.NetAddr> {
  return Deno.serve(
    {
      hostname: SITE_DEV_BIND_HOST,
      port,
      onListen: () => {
        console.log(
          `Site listening on http://${SITE_DEV_BROWSER_HOST}:${port}/`,
        );
      },
    },
    localHandler,
  );
}

/** Rebuild after debounced source changes, queuing one repeat when changes overlap. */
async function watchSiteBuildInputs(): Promise<never> {
  const watcher = Deno.watchFs(siteBuildInputPaths());
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
        if (!await runSiteBuild()) {
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
export async function runLocalSite(watch: boolean): Promise<void> {
  const port = await resolveSiteDevPort(Deno.env.get("PORT"));
  if (!await runSiteBuild()) throw new Error("Initial site build failed");
  const server = startSiteServer(port);
  if (watch) await watchSiteBuildInputs();
  await server.finished;
}

if (import.meta.main) await runLocalSite(Deno.args.includes("--watch"));
