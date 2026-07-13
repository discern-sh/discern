/** Local site runner: build once, bind only to loopback, and optionally rebuild
 * whenever an authored site input changes. Production continues to use
 * `site/main.ts` and its platform-assigned bind address. */

import { siteBuildInputPaths } from "./build_inputs.ts";
import { handler } from "./serve.ts";

const REPO_ROOT = new URL("../", import.meta.url);
const WATCH_DEBOUNCE_MS = 100;

export const SITE_DEV_BIND_HOST = "127.0.0.1";
export const SITE_DEV_BROWSER_HOST = "localhost";
export const DEFAULT_SITE_DEV_PORT = 4507;

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

/** Run the build in a fresh process so changed TS modules cannot remain cached. */
async function runSiteBuild(): Promise<boolean> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["task", "site:build"],
    cwd: decodeURIComponent(REPO_ROOT.pathname),
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  return result.success;
}

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
    handler,
  );
}

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

  console.log("Watching authored site and design-system inputs...");
  for await (const event of watcher) {
    if (event.kind === "access") continue;
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
  const port = parseSiteDevPort(Deno.env.get("PORT"));
  if (!await runSiteBuild()) throw new Error("Initial site build failed");
  const server = startSiteServer(port);
  if (watch) await watchSiteBuildInputs();
  await server.finished;
}

if (import.meta.main) await runLocalSite(Deno.args.includes("--watch"));
