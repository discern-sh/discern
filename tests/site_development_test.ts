/** Development-server contracts: local URLs stay browser-usable and watch mode
 * rebuilds from the complete authored site-input boundary. */

import { assertEquals, assertThrows } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  DEFAULT_SITE_DEV_PORT,
  parseSiteDevPort,
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
} from "../site/dev.ts";
import {
  SITE_BUILD_INPUTS,
  siteBuildInputPaths,
} from "../site/build_inputs.ts";

interface DenoConfig {
  readonly tasks?: Readonly<Record<string, string>>;
  readonly workspace?: readonly string[];
}

interface ConfigEntry {
  readonly path: string;
  readonly config: DenoConfig;
}

const ROOT = dirname(fromFileUrl(import.meta.url));
const REPO = dirname(ROOT);

async function readConfig(path: string): Promise<DenoConfig> {
  return JSON.parse(await Deno.readTextFile(path)) as DenoConfig;
}

async function developmentConfigs(): Promise<ConfigEntry[]> {
  const rootPath = join(REPO, "deno.json");
  const root = await readConfig(rootPath);
  const entries: ConfigEntry[] = [{ path: "deno.json", config: root }];
  for (const member of root.workspace ?? []) {
    const relative = join(member, "deno.json");
    entries.push({
      path: relative,
      config: await readConfig(join(REPO, relative)),
    });
  }
  return entries;
}

function wildcardServeTasks(entries: readonly ConfigEntry[]): string[] {
  const loopbackHost =
    /--host(?:=|\s+)(?:localhost|127\.0\.0\.1|::1|\[::1\])(?:\s|$)/;
  const offenders: string[] = [];
  for (const { path, config } of entries) {
    for (const [name, command] of Object.entries(config.tasks ?? {})) {
      if (/\bdeno\s+serve\b/.test(command) && !loopbackHost.test(command)) {
        offenders.push(`${path}:${name}`);
      }
    }
  }
  return offenders;
}

Deno.test("the development-server detector catches a freshly named wildcard sibling", () => {
  assertEquals(
    wildcardServeTasks([{
      path: "unrelated/deno.json",
      config: { tasks: { preview: "deno serve --port 9999 app.ts" } },
    }]),
    ["unrelated/deno.json:preview"],
  );
});

Deno.test("every deno serve task binds to loopback explicitly", async () => {
  assertEquals(
    wildcardServeTasks(await developmentConfigs()),
    [],
    "development servers must not advertise Deno's 0.0.0.0 default",
  );
});

Deno.test("the site development runner advertises localhost and rejects bad ports", () => {
  assertEquals(SITE_DEV_BIND_HOST, "127.0.0.1");
  assertEquals(SITE_DEV_BROWSER_HOST, "localhost");
  assertEquals(parseSiteDevPort(undefined), DEFAULT_SITE_DEV_PORT);
  assertEquals(parseSiteDevPort("4510"), 4510);
  assertThrows(() => parseSiteDevPort("not-a-port"), Error, "PORT must be");
  assertThrows(() => parseSiteDevPort("0"), Error, "PORT must be");
});

Deno.test("the site development port prefers an override, then worktree identity, then the main default", async () => {
  const unexpectedDiscovery = (): Promise<number | undefined> => {
    throw new Error("an explicit PORT must bypass worktree discovery");
  };
  assertEquals(
    await resolveSiteDevPort("4510", unexpectedDiscovery),
    4510,
  );
  assertEquals(
    await resolveSiteDevPort(undefined, () => Promise.resolve(13_812)),
    13_812,
  );
  assertEquals(
    await resolveSiteDevPort(undefined, () => Promise.resolve(undefined)),
    DEFAULT_SITE_DEV_PORT,
  );
});

Deno.test("the watch task delegates to the source-driven site watcher", async () => {
  const root = await readConfig(join(REPO, "deno.json"));
  assertEquals(
    root.tasks?.watch,
    "deno run --watch --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=PORT,DISCERN_PROJECT_SLUG,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/dev.ts --watch",
  );

  assertEquals(SITE_BUILD_INPUTS.length > 0, true);
  for (const input of siteBuildInputPaths()) {
    const stat = await Deno.stat(input);
    assertEquals(stat.isFile || stat.isDirectory, true, input);
  }
});
