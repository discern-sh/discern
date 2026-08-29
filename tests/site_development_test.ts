/** Development-server contracts: local URLs stay browser-usable and watch mode
 * rebuilds from the complete authored site-input boundary. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { z } from "@zod/zod";
import { dirname, fromFileUrl, join, toFileUrl } from "@std/path";
import { Project, SyntaxKind } from "ts-morph";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  assignedWorktreePort,
  DEFAULT_SITE_DEV_PORT,
  type DenoRunInvocation,
  denoRunInvocation,
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
import { quietDenoRunArgs, withTempDir } from "./helpers.ts";
import { addWorktree, gitInit, writeConfig } from "./engine_helpers.ts";
import {
  SITE_BUILD_INPUTS,
  siteBuildEventNeedsRebuild,
  siteBuildInputPaths,
} from "../site/build_inputs.ts";
import { handler } from "../site/serve.ts";
import { GENERATED_SITE_OUTPUTS } from "../site/build.ts";
import { decodeWith } from "./decode_cli_result.ts";

interface DenoConfig {
  readonly tasks?: Readonly<Record<string, string>> | undefined;
  readonly workspace?: readonly string[] | undefined;
}
const DenoConfigSchema: z.ZodType<DenoConfig> = z.object({
  tasks: z.record(z.string(), z.string()).optional(),
  workspace: z.array(z.string()).optional(),
});

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
  return decodeWith(DenoConfigSchema, await Deno.readTextFile(path));
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

/** A preview-capable `deno run` task and the config file declaring it. */
interface PreviewTask {
  readonly config: string;
  readonly name: string;
  readonly invocation: DenoRunInvocation;
}

/** Normalize one task entry token to a repo-relative module path. */
function normalizedTaskEntry(entry: string): string {
  return entry.replace(/^\.\//, "");
}

/** Site modules that reach the preview runtime through site-local imports. */
function previewRuntimeModules(
  sources: readonly AuthoredSource[],
): Set<string> {
  const project = new Project({ useInMemoryFileSystem: true });
  const importsOf = new Map<string, readonly string[]>();
  for (const source of sources) {
    const file = project.createSourceFile(source.path, source.text, {
      overwrite: true,
    });
    const specifiers = [
      ...file.getImportDeclarations().map((declaration) =>
        declaration.getModuleSpecifierValue()
      ),
      ...file.getExportDeclarations().map((declaration) =>
        declaration.getModuleSpecifierValue()
      ),
    ];
    importsOf.set(
      source.path,
      specifiers
        .filter((specifier): specifier is string =>
          specifier !== undefined && specifier.startsWith(".")
        )
        .map((specifier) =>
          new URL(specifier, `file:///${source.path}`).pathname.slice(1)
        )
        .filter((path) => path.startsWith("site/")),
    );
  }
  const reached = new Set<string>(["site/dev.ts"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [path, dependencies] of importsOf) {
      if (reached.has(path)) continue;
      if (dependencies.some((dependency) => reached.has(dependency))) {
        reached.add(path);
        grew = true;
      }
    }
  }
  return reached;
}

/** Tasks whose `deno run` entry reaches the preview runtime. */
function sitePreviewTasks(
  entries: readonly ConfigEntry[],
  runtimeModules: ReadonlySet<string>,
): PreviewTask[] {
  const tasks: PreviewTask[] = [];
  for (const { path, config } of entries) {
    for (const [name, command] of Object.entries(config.tasks ?? {})) {
      const invocation = denoRunInvocation(command);
      if (invocation === undefined) continue;
      if (!runtimeModules.has(normalizedTaskEntry(invocation.entry))) continue;
      tasks.push({ config: path, name, invocation });
    }
  }
  return tasks;
}

/**
 * Replay preview startup's environment reads in a child process. The child
 * inherits the caller's environment, so the probe never depends on ambient
 * values: it always resolves identity, and only mirrors an explicit PORT
 * override's read before neutralizing its value.
 */
const PREVIEW_ENV_PROBE = `
const [target, devSpecifier, entrySpecifier] = Deno.args;
if (
  target === undefined || devSpecifier === undefined ||
  entrySpecifier === undefined
) {
  throw new Error("usage: probe <worktree-root> <dev-url> <entry-url>");
}
await import(entrySpecifier);
const dev = await import(devSpecifier);
const discovered = await dev.assignedWorktreePort(target);
if (discovered === undefined) {
  throw new Error("the scaffolded worktree resolved no identity port");
}
const explicit = Deno.env.get("PORT");
const resolved = await dev.resolveSiteDevPort(
  explicit === undefined ? undefined : String(discovered),
  () => Promise.resolve(discovered),
);
if (resolved !== discovered) {
  throw new Error("preview port resolution ignored the worktree identity");
}
console.log("preview-port:" + resolved);
`;

/** Scaffold a hermetic main checkout plus one linked worktree for port probes. */
async function withScaffoldedWorktree<T>(
  fn: (worktree: string, probePath: string) => Promise<T>,
): Promise<T> {
  return await withTempDir(async (dir) => {
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "site-preview-probe"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const worktree = await addWorktree(dir, "preview-probe");
    const probePath = join(dir, "preview_env_probe.ts");
    await Deno.writeTextFile(probePath, PREVIEW_ENV_PROBE);
    return await fn(worktree, probePath);
  });
}

/** Spawn the probe under exactly the given task permission flags. */
async function runPreviewProbe(
  permissionFlags: readonly string[],
  worktree: string,
  probePath: string,
  entryUrl: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  const devUrl = toFileUrl(join(REPO, "site/dev.ts")).href;
  const output = await new Deno.Command(Deno.execPath(), {
    // The probe file lives outside the repo, so the repo's import map must be
    // named explicitly; permission flags still come only from the task.
    args: quietDenoRunArgs([
      "--config",
      join(REPO, "deno.json"),
      ...permissionFlags,
      probePath,
      worktree,
      devUrl,
      entryUrl,
    ]),
    cwd: REPO,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    success: output.success,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

/** Authored TypeScript that states a restricted env grant anywhere in the repo. */
async function authoredSpawnSources(): Promise<AuthoredSource[]> {
  const sources: AuthoredSource[] = [];
  for (
    const path of await structuralGuardScope({
      guard: "tests/site_development_test.ts#preview-env-grant-census",
      universe: "authored-ts",
    })
  ) {
    const text = await Deno.readTextFile(join(REPO, path));
    if (!text.includes("--allow-env=")) continue;
    sources.push({ path, text });
  }
  return sources;
}

/**
 * Array literals pairing a restricted `--allow-env=` grant with a preview
 * entry. Hand-restated grants drift behind the preview runtime's environment
 * reads; the one legal flag source is the `deno.json` task, read through
 * `denoRunInvocation`.
 */
function handRolledPreviewEnvGrants(
  sources: readonly AuthoredSource[],
  runtimeModules: ReadonlySet<string>,
): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const offenders: string[] = [];
  for (const source of sources) {
    const file = project.createSourceFile(source.path, source.text, {
      overwrite: true,
    });
    for (
      const array of file.getDescendantsOfKind(
        SyntaxKind.ArrayLiteralExpression,
      )
    ) {
      const literals = array
        .getDescendantsOfKind(SyntaxKind.StringLiteral)
        .map((literal) => literal.getLiteralValue());
      if (
        literals.some((value) => value.startsWith("--allow-env=")) &&
        literals.some((value) => runtimeModules.has(normalizedTaskEntry(value)))
      ) {
        offenders.push(`${source.path}:${array.getStartLineNumber()}`);
      }
    }
  }
  return offenders;
}

Deno.test("the preview-grant census catches a freshly hand-rolled sibling", () => {
  const runtime = new Set(["site/showcase.ts"]);
  assertEquals(
    handRolledPreviewEnvGrants([{
      path: "scripts/unrelated.ts",
      text: 'const args = ["run", "--allow-env=PORT", "./site/showcase.ts"];\n',
    }], runtime),
    ["scripts/unrelated.ts:1"],
  );
  assertEquals(
    handRolledPreviewEnvGrants([{
      path: "scripts/innocent.ts",
      text: 'const args = ["--allow-env=NODE_ENV", "site/build.ts"];\n',
    }], runtime),
    [],
  );
});

Deno.test("hand-rolled preview permission grants stay outlawed in authored sources", async () => {
  const runtime = previewRuntimeModules(await authoredSiteSources());
  assertEquals(
    handRolledPreviewEnvGrants(await authoredSpawnSources(), runtime),
    [],
    "spawns of the preview runtime must derive their permission flags from " +
      "the deno.json task through denoRunInvocation, not restate an " +
      "--allow-env list",
  );
});

Deno.test("the preview census parses invocations and reaches the runtime", () => {
  assertEquals(
    denoRunInvocation(
      "discern queue -- deno run --watch --allow-read --allow-env=A,B ./site/showcase.ts --watch",
    ),
    {
      permissionFlags: ["--allow-read", "--allow-env=A,B"],
      entry: "./site/showcase.ts",
    },
  );
  assertEquals(denoRunInvocation("deno fmt"), undefined);
  assertEquals(denoRunInvocation("deno task site:specimens"), undefined);

  const runtime = previewRuntimeModules([
    { path: "site/dev.ts", text: "" },
    {
      path: "site/showcase.ts",
      text: 'import { plan } from "./nested/helper.ts";',
    },
    {
      path: "site/nested/helper.ts",
      text: 'export { planSitePreviewStart as plan } from "../dev.ts";',
    },
    { path: "site/build.ts", text: 'import "./design_system.ts";' },
  ]);
  assert(
    runtime.has("site/showcase.ts"),
    "transitive preview imports must enroll",
  );
  assert(!runtime.has("site/build.ts"), "non-preview site modules stay out");

  assertEquals(
    sitePreviewTasks([{
      path: "unrelated/deno.json",
      config: {
        tasks: { showcase: "deno run --allow-env=PORT site/showcase.ts" },
      },
    }], runtime).map((task) => task.name),
    ["showcase"],
  );
});

Deno.test("worktree port discovery declines a checkout without a git link file", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await assignedWorktreePort(dir), undefined);
    await Deno.mkdir(join(dir, ".git"));
    assertEquals(await assignedWorktreePort(dir), undefined);
  });
});

Deno.test("every preview task resolves worktree identity under its own permissions", async () => {
  const runtime = previewRuntimeModules(await authoredSiteSources());
  const tasks = sitePreviewTasks(await developmentConfigs(), runtime);
  const names = new Set(tasks.map((task) => task.name));
  for (const required of ["site", "watch", "site:specimens"]) {
    assert(names.has(required), `the preview-task census lost '${required}'`);
  }
  await withScaffoldedWorktree(async (worktree, probePath) => {
    assertEquals(typeof await assignedWorktreePort(worktree), "number");
    const results = await Promise.all(tasks.map(async (task) => ({
      task,
      probe: await runPreviewProbe(
        task.invocation.permissionFlags,
        worktree,
        probePath,
        toFileUrl(join(REPO, normalizedTaskEntry(task.invocation.entry))).href,
      ),
    })));
    for (const { task, probe } of results) {
      assert(
        probe.success,
        `task '${task.name}' cannot start from a linked worktree under its ` +
          `own permission flags. Preview startup reads something the task's ` +
          `--allow-env list in ${task.config} does not grant; add the ` +
          `variable named below to that list.\n${probe.stderr}`,
      );
      assertStringIncludes(
        probe.stdout,
        "preview-port:",
        `task '${task.name}' probe skipped identity discovery`,
      );
    }
  });
});

Deno.test("the preview probe fails when an identity variable is withheld", async () => {
  const runtime = previewRuntimeModules(await authoredSiteSources());
  const site = sitePreviewTasks(await developmentConfigs(), runtime)
    .find((task) => task.name === "site");
  assert(site !== undefined, "the root config must keep a 'site' preview task");
  const reduced = site.invocation.permissionFlags.map((flag) =>
    flag.startsWith("--allow-env=") ? "--allow-env=PORT" : flag
  );
  await withScaffoldedWorktree(async (worktree, probePath) => {
    const probe = await runPreviewProbe(
      reduced,
      worktree,
      probePath,
      toFileUrl(join(REPO, "site/dev.ts")).href,
    );
    assertEquals(
      probe.success,
      false,
      "identity resolution under a stripped --allow-env list must fail; if " +
        "this now passes, preview startup no longer reads restricted " +
        "environment variables and the sufficiency probe proves nothing",
    );
    assertStringIncludes(probe.stderr, "NotCapable", probe.stderr);
  });
});

Deno.test("the watch task delegates to the source-driven site watcher", async () => {
  const root = await readConfig(join(REPO, "deno.json"));
  assertEquals(
    root.tasks?.watch,
    "deno run --watch --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=PORT,DISCERN_PROJECT_SLUG,DISCERN_TRUNK,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/dev.ts --watch",
  );

  assertEquals(SITE_BUILD_INPUTS.length > 0, true);
  for (const input of siteBuildInputPaths()) {
    const stat = await Deno.stat(input);
    assertEquals(stat.isFile || stat.isDirectory, true, input);
  }
});
