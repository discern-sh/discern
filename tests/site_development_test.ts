/** Development-server contracts: local URLs stay browser-usable and watch mode
 * rebuilds from the complete authored site-input boundary. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";
import { Project, SyntaxKind } from "ts-morph";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  DEFAULT_SITE_DEV_PORT,
  LOCAL_SITE_BUILD_TASKS,
  localHandler,
  localSiteBuildCommandArgs,
  localSiteWatchInputPaths,
  parseSiteDevArgs,
  parseSiteDevPort,
  reportSiteDevStartupError,
  resolveSiteDevPort,
  SITE_DEV_BIND_HOST,
  SITE_DEV_BROWSER_HOST,
  siteDevPortInUseError,
} from "../site/dev.ts";
import {
  SITE_BUILD_INPUTS,
  siteBuildEventNeedsRebuild,
  siteBuildInputPaths,
} from "../site/build_inputs.ts";
import { handler } from "../site/serve.ts";
import { GENERATED_SITE_OUTPUTS } from "../site/build.ts";

interface DenoConfig {
  readonly tasks?: Readonly<Record<string, string>>;
  readonly workspace?: readonly string[];
}

interface ConfigEntry {
  readonly path: string;
  readonly config: DenoConfig;
}

interface AuthoredSource {
  readonly path: string;
  readonly text: string;
}

const ROOT = dirname(fromFileUrl(import.meta.url));
const REPO = dirname(ROOT);

/** Decode one root or workspace Deno configuration for development-policy checks. */
async function readConfig(path: string): Promise<DenoConfig> {
  return JSON.parse(await Deno.readTextFile(path)) as DenoConfig;
}

/** Load the root config and every declared workspace member as labeled entries. */
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

/** Find local site servers that bypass the shared recoverable lifecycle. */
function unmanagedSiteServerStarts(
  sources: readonly AuthoredSource[],
): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const offenders: string[] = [];
  for (const source of sources) {
    if (source.path === "site/main.ts") continue;
    const file = project.createSourceFile(source.path, source.text, {
      overwrite: true,
    });
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "Deno.serve") continue;
      const owner = call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      if (
        source.path === "site/dev.ts" &&
        owner?.getName() === "startManagedSiteServer"
      ) {
        continue;
      }
      offenders.push(`${source.path}:${call.getStartLineNumber()}`);
    }
  }
  return offenders;
}

/** Load every authored TypeScript source in the site's architectural boundary. */
async function authoredSiteSources(): Promise<AuthoredSource[]> {
  const sources: AuthoredSource[] = [];
  for (
    const path of await structuralGuardScope({
      guard: "tests/site_development_test.ts#site-server-boundaries",
      universe: "authored-ts",
      narrow: {
        reason:
          "The local-server ownership and import boundary governs authored TypeScript beneath the site subtree.",
        include: (rel) => rel.startsWith("site/"),
      },
    })
  ) {
    sources.push({
      path,
      text: await Deno.readTextFile(join(REPO, path)),
    });
  }
  return sources;
}

/** Report generated outputs nested under watched inputs unless explicitly ignored. */
function unignoredWatchedBuildOutputOverlaps(
  inputs: readonly string[],
  outputs: readonly string[],
  ignores: readonly string[],
): string[] {
  const normalized = (path: string): string => path.replace(/\/$/, "");
  return inputs.flatMap((input) => {
    const root = normalized(input);
    return outputs
      .map(normalized)
      .filter((output) => output === root || output.startsWith(`${root}/`))
      .filter((output) =>
        !ignores.map(normalized).some((ignored) =>
          output === ignored || output.startsWith(`${ignored}/`)
        )
      )
      .map((output) => `${root} -> ${output}`);
  });
}

/** Find development servers that bind beyond a loopback interface. */
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

/** Find site-dev tasks allowed to override the production NODE_ENV contract. */
function siteDevEnvMaskingOffenders(
  entries: readonly ConfigEntry[],
): string[] {
  const offenders: string[] = [];
  for (const { path, config } of entries) {
    for (const [name, command] of Object.entries(config.tasks ?? {})) {
      if (!/\bsite\/dev\.ts\b/.test(command)) continue;
      const allowEnv = /(?:^|\s)--allow-env(?:=([^\s]+))?(?:\s|$)/.exec(
        command,
      );
      if (
        allowEnv !== null &&
        (allowEnv[1] === undefined ||
          allowEnv[1].split(",").includes("NODE_ENV"))
      ) {
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

Deno.test("the site env-mask detector catches a freshly named task sibling", () => {
  assertEquals(
    siteDevEnvMaskingOffenders([{
      path: "unrelated/deno.json",
      config: {
        tasks: {
          showcase:
            "deno run --allow-env=PORT,NODE_ENV --allow-net=127.0.0.1 site/dev.ts",
        },
      },
    }]),
    ["unrelated/deno.json:showcase"],
  );
});

Deno.test("the site-server lifecycle detector catches a freshly named preview sibling", () => {
  assertEquals(
    unmanagedSiteServerStarts([{
      path: "site/unrelated.ts",
      text:
        "function launch(): void { Deno.serve({ port: 8123 }, () => new Response()); }",
    }]),
    ["site/unrelated.ts:1"],
  );
});

Deno.test("every local site server uses the recoverable preview lifecycle", async () => {
  assertEquals(
    unmanagedSiteServerStarts(await authoredSiteSources()),
    [],
    "local site servers must start through startManagedSiteServer",
  );
});

Deno.test("watched build inputs never contain generated outputs", () => {
  assertEquals(
    unignoredWatchedBuildOutputOverlaps(
      ["feature"],
      ["feature/cache"],
      [],
    ),
    ["feature -> feature/cache"],
  );
  assertEquals(
    unignoredWatchedBuildOutputOverlaps(
      ["feature"],
      ["feature/cache"],
      ["feature/cache"],
    ),
    [],
  );
  const outputs = [
    ...GENERATED_SITE_OUTPUTS.map((path) => `site/${path}`),
  ];
  assertEquals(
    unignoredWatchedBuildOutputOverlaps(
      SITE_BUILD_INPUTS,
      outputs,
      [],
    ),
    [],
  );
  assertEquals(
    siteBuildEventNeedsRebuild([
      join(REPO, "site/design_system.ts"),
    ]),
    true,
  );
});

Deno.test("every deno serve task binds to loopback explicitly", async () => {
  assertEquals(
    wildcardServeTasks(await developmentConfigs()),
    [],
    "development servers must not advertise Deno's 0.0.0.0 default",
  );
});

Deno.test("site development tasks leave NODE_ENV reads visible", async () => {
  assertEquals(
    siteDevEnvMaskingOffenders(await developmentConfigs()),
    [],
    "site/dev.ts must neither grant NODE_ENV nor grant unrestricted env access",
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

Deno.test("an occupied site port reports the exact browser URL without a bind stack", () => {
  const error = siteDevPortInUseError(4507);
  let output = "";
  assertEquals(
    reportSiteDevStartupError(error, (message) => output = message),
    true,
  );
  assertStringIncludes(output, "http://localhost:4507/");
  assertStringIncludes(output, "set PORT to a free port");
  assertEquals(output.includes("AddrInUse"), false);
  assertEquals(reportSiteDevStartupError(new Error("other")), false);
});

Deno.test("one-shot previews replace themselves while a live watcher is reused", async () => {
  const moduleUrl = toFileUrl(join(REPO, "site/dev.ts")).href;
  const script = `
    import {
      localSiteUrl,
      planSitePreviewStart,
      replaceManagedSitePreview,
      SiteDevPortInUseError,
      startManagedSiteServer,
    } from ${JSON.stringify(moduleUrl)};

    const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = reservation.addr.port;
    reservation.close();

    const first = startManagedSiteServer(
      port,
      "site",
      () => new Response("first"),
      () => {},
    );
    const replacement = await planSitePreviewStart(port, "site");
    if (replacement.action !== "replace") {
      throw new Error("a one-shot preview was not replaceable");
    }
    await replaceManagedSitePreview(replacement);
    await first.finished;

    const watcher = startManagedSiteServer(
      port,
      "watch",
      () => new Response("watch"),
      () => {},
    );
    const reuse = await planSitePreviewStart(port, "site");
    if (reuse.action !== "reuse" || reuse.url !== localSiteUrl(port)) {
      throw new Error("a live watcher was not reused");
    }

    let bindMessage = "";
    try {
      startManagedSiteServer(
        port,
        "site",
        () => new Response("second"),
        () => {},
      );
    } catch (error) {
      if (!(error instanceof SiteDevPortInUseError)) throw error;
      bindMessage = error.message;
    }
    if (!bindMessage.includes(localSiteUrl(port))) {
      throw new Error("the bind failure omitted its browser URL");
    }
    await watcher.shutdown();
    console.log("managed replacement and watch reuse passed");
  `;
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  assert(result.success, stderr);
  assertStringIncludes(stdout, "managed replacement and watch reuse passed");
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

Deno.test("the local runner builds only the consumer site and adds no catalogue routes", async () => {
  assertEquals(LOCAL_SITE_BUILD_TASKS, ["site:build"]);
  for (const route of ["/style-guide/", "/styleguide/"]) {
    const local = await localHandler(new Request(`http://localhost${route}`));
    const production = await handler(new Request(`http://localhost${route}`));
    assertEquals(local.status, 404, route);
    assertEquals(local.status, production.status, route);
    assertEquals(await local.text(), await production.text(), route);
  }
});

Deno.test("an explicit build config and future package tree reach every linked-preview rebuild", () => {
  const futureConfig = "/tmp/future-preview/deno.json";
  const futureSources = "/tmp/future-component-system/src";
  assertEquals(
    parseSiteDevArgs([
      "--watch",
      "--build-config",
      futureConfig,
      "--watch-input",
      futureSources,
    ]),
    {
      buildConfig: futureConfig,
      extraWatchInputs: [futureSources],
      watch: true,
    },
  );
  assertEquals(
    localSiteBuildCommandArgs(futureConfig),
    [
      "run",
      "--config",
      futureConfig,
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env=NODE_ENV",
      join(REPO, "site/build.ts"),
    ],
  );
  assertEquals(
    localSiteWatchInputPaths([futureSources]).slice(-1),
    [futureSources],
  );
  assertThrows(
    () => parseSiteDevArgs(["--build-config"]),
    Error,
    "--build-config requires",
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
