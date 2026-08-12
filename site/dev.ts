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
  if (!await runSiteBuild(options.buildConfig)) {
    throw new Error("Initial site build failed");
  }
  const server = startSiteServer(port);
  if (options.watch) await watchSiteBuildInputs(options);
  await server.finished;
}

if (import.meta.main) await runLocalSite(parseSiteDevArgs(Deno.args));
