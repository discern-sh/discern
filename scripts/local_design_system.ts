/**
 * Develop discern against a local design-system checkout without changing the
 * committed exact JSR dependency.
 *
 * Each surface names the package exports it consumes. The lifecycle verifies
 * that the checkout exposes them, writes an untracked Deno config whose alias
 * links the checkout, proves every consumed specifier resolves inside it, runs
 * the caller's work, and refuses a run that changed deno.json or deno.lock.
 *
 * This module's graph excludes the design system and every product module that
 * renders with it. The helpers run under the committed pin while their children
 * run under the link, so they must keep loading when discern's own modules
 * already use an API only the linked checkout provides.
 */

import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { SIGNAL_EXIT_CODES } from "../src/engine/process_signals.ts";
import { mainRepoPath } from "../src/shared/main_repo.ts";
import { withToolTempDir } from "./temp_dir.ts";

/** The discern checkout these helpers run from. */
export const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const PACKAGE_NAME = "@discern-sh/design-system";
const PACKAGE_NAME_SPECIFIER = `jsr:${PACKAGE_NAME}`;
const PACKAGE_ALIAS = "discern-design-system";
const PACKAGE_REPOSITORY = "discern-design-system";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/**
 * Every surface the local loop links: the package exports it consumes and the
 * entry modules whose graphs import them. The loop proves only the exports a
 * surface names, so its test holds each entry graph inside its surface's set:
 * a new import cannot run against the link unverified.
 */
export const LOCAL_DESIGN_SYSTEM_SURFACES = {
  /** The public site: its build and its preview server. */
  site: {
    exports: [
      ".",
      "./cli",
      "./cli/interactive",
      "./cli/projection",
      "./react",
      "./runtime",
    ],
    entrypoints: ["site/build.ts", "site/dev.ts"],
  },
  /** The CLI, the Desk, and the tooling that drives and captures them. */
  cli: {
    exports: [
      ".",
      "./cli",
      "./cli/interactive",
      "./cli/interactive/testing",
      "./cli/projection",
    ],
    entrypoints: [
      "src/main.ts",
      "scripts/desk_capture.ts",
      "scripts/desk_sandbox.ts",
      "scripts/terminal_capture.ts",
      "tests/fixtures/desk_tty_harness.ts",
      "tests/fixtures/desk_scripted_application.ts",
    ],
  },
} as const;

/** Package exports the public site's build and preview import. */
export const SITE_DESIGN_SYSTEM_EXPORTS =
  LOCAL_DESIGN_SYSTEM_SURFACES.site.exports;

/** Package exports the CLI, the Desk, and their capture tooling import. */
export const CLI_DESIGN_SYSTEM_EXPORTS =
  LOCAL_DESIGN_SYSTEM_SURFACES.cli.exports;

type JsonObject = Record<string, unknown>;

/** A linked configuration that has passed every preflight. */
export interface LocalDesignSystemLink {
  /** Canonical path of the linked checkout. */
  readonly packageRoot: string;
  /** The untracked Deno config every child must share. */
  readonly configPath: string;
  /** discern's committed config the temporary one overlays. */
  readonly rootConfig: Readonly<JsonObject>;
  /** Each required specifier and the local file it resolved to. */
  readonly resolutions: ReadonlyMap<string, string>;
}

/** The import specifier discern writes for one package export. */
export function designSystemSpecifier(exportPath: string): string {
  if (exportPath === ".") return PACKAGE_ALIAS;
  if (!exportPath.startsWith("./")) {
    throw new TypeError(`package export ${exportPath} must start with ./`);
  }
  return `${PACKAGE_ALIAS}/${exportPath.slice(2)}`;
}

/**
 * Resolve an explicit checkout, or the conventional package repository beside
 * discern's Git main checkout. The main-checkout query keeps the default stable
 * when a helper runs from a linked worktree.
 */
export async function resolveDesignSystemCheckout(
  explicit: string | undefined,
  resolveMainCheckout: () => Promise<string | undefined> = () =>
    mainRepoPath(REPO_ROOT),
): Promise<string> {
  if (explicit !== undefined) {
    if (explicit.trim() === "") {
      throw new Error("the design-system checkout path cannot be empty");
    }
    return explicit;
  }
  const mainCheckout = await resolveMainCheckout();
  if (mainCheckout === undefined) {
    throw new Error(
      "could not locate discern's main checkout; pass a design-system checkout",
    );
  }
  return join(dirname(mainCheckout), PACKAGE_REPOSITORY);
}

/**
 * Point the temporary alias at a linked checkout without mutating the base.
 * The alias names no version: Deno uses a link only when its version satisfies
 * the import, so an exact version would silently fall back to the registry as
 * soon as the checkout bumped its own while a preview kept serving.
 */
export function localDesignSystemConfig(
  base: Readonly<JsonObject>,
  packageRoot: string,
): JsonObject {
  const imports = base.imports;
  if (
    imports === null || typeof imports !== "object" || Array.isArray(imports)
  ) {
    throw new Error("discern's deno.json must declare imports");
  }
  return {
    ...base,
    imports: {
      ...imports,
      [PACKAGE_ALIAS]: PACKAGE_NAME_SPECIFIER,
    },
    links: [packageRoot],
    lock: false,
    nodeModulesDir: "none",
  };
}

/** Assert the selected directory exposes every export a surface consumes. */
export function assertLocalDesignSystemPackage(
  config: unknown,
  path: string,
  requiredExports: readonly string[],
): asserts config is JsonObject & { readonly version: string } {
  if (config === null || typeof config !== "object") {
    throw new Error(`${path}/deno.json must contain an object`);
  }
  const candidate = config as JsonObject;
  if (candidate.name !== PACKAGE_NAME) {
    throw new Error(`${path} must be the ${PACKAGE_NAME} package`);
  }
  if (
    typeof candidate.version !== "string" ||
    !SEMVER_PATTERN.test(candidate.version)
  ) {
    throw new Error(`${path}/deno.json must declare a semantic version`);
  }
  const exports = candidate.exports;
  if (exports === null || typeof exports !== "object") {
    throw new Error(`${path}/deno.json must declare package exports`);
  }
  const available = exports as JsonObject;
  for (const required of requiredExports) {
    if (typeof available[required] !== "string") {
      throw new Error(`${path}/deno.json must export ${required}`);
    }
  }
}

/** Whether Deno resolved a package export from the selected local directory. */
export function isLocalPackageResolution(
  resolution: string,
  packageRoot: string,
): boolean {
  const rootUrl = toFileUrl(
    packageRoot.endsWith("/") ? packageRoot : `${packageRoot}/`,
  ).href;
  return resolution.startsWith(rootUrl);
}

/**
 * Name the mismatch when a child config would resolve the design system from a
 * different source than the process launching it. A parent on the published
 * package driving a child on a local checkout, or the reverse, projects one
 * build's output through the other build's parser, so neither side may differ.
 */
export function designSystemGraphMismatch(
  parentResolution: string,
  childConfig: Readonly<JsonObject>,
  childConfigPath: string,
): string | undefined {
  const links = Array.isArray(childConfig.links)
    ? childConfig.links.filter((link): link is string =>
      typeof link === "string"
    )
    : [];
  if (parentResolution.startsWith("file:")) {
    return links.some((link) =>
        isLocalPackageResolution(parentResolution, link)
      )
      ? undefined
      : `this process resolves the design system from ${
        fromFileUrl(parentResolution)
      }, but ${childConfigPath} does not link that checkout; pass the ` +
        "process's own Deno config to the child";
  }
  return links.length === 0
    ? undefined
    : `this process uses the published design system, but ${childConfigPath} ` +
      `links ${
        links.join(", ")
      }; run the parent under the same Deno config as its child`;
}

const CHECKED_CHILD_CONFIGS = new Set<string>();

/**
 * Refuse a child launch whose Deno config would load a different design-system
 * build from this process. Each config is read once per process.
 */
export function assertChildDesignSystemGraph(childConfigPath: string): void {
  if (CHECKED_CHILD_CONFIGS.has(childConfigPath)) return;
  const mismatch = designSystemGraphMismatch(
    import.meta.resolve(designSystemSpecifier("./cli")),
    parseJsonObject(Deno.readTextFileSync(childConfigPath), childConfigPath),
    childConfigPath,
  );
  if (mismatch !== undefined) throw new Error(mismatch);
  CHECKED_CHILD_CONFIGS.add(childConfigPath);
}

/** Decode JSON text whose root must be an object. */
function parseJsonObject(text: string, path: string): JsonObject {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value as JsonObject;
}

/** Decode a JSON file whose root must be an object. */
async function readJsonObject(path: string): Promise<JsonObject> {
  return parseJsonObject(await Deno.readTextFile(path), path);
}

/** Run one child with captured output for a preflight probe. */
async function capturedCommand(
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: [...args],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

/**
 * Run one long-lived child with the inherited terminal. `cwd` defaults to this
 * process's directory, so a project-scoped command acts where it was invoked.
 */
export async function inheritedCommand(
  args: readonly string[],
  options: { readonly cwd?: string } = {},
): Promise<number> {
  const result = await runOwnedChild(Deno.execPath(), {
    args,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    resumeAfterInterrupt: true,
  });
  return result.interruptedBy === null
    ? result.status.code
    : SIGNAL_EXIT_CODES[result.interruptedBy] ?? 1;
}

/** Prove the temporary config resolves every required export locally. */
async function proveLocalResolution(
  configPath: string,
  packageRoot: string,
  requiredExports: readonly string[],
): Promise<Map<string, string>> {
  const specifiers = requiredExports.map(designSystemSpecifier);
  const probe = await capturedCommand([
    "eval",
    "--config",
    configPath,
    `console.log(JSON.stringify(${
      JSON.stringify(specifiers)
    }.map((specifier) => import.meta.resolve(specifier))))`,
  ]);
  if (!probe.success) {
    const stderr = new TextDecoder().decode(probe.stderr).trim();
    throw new Error(stderr || "Deno could not resolve the local package");
  }
  const resolved: unknown = JSON.parse(
    new TextDecoder().decode(probe.stdout).trim(),
  );
  if (!Array.isArray(resolved) || resolved.length !== specifiers.length) {
    throw new Error("local package preflight returned no resolution list");
  }
  const resolutions = new Map<string, string>();
  for (const [index, specifier] of specifiers.entries()) {
    const resolution = resolved[index];
    if (
      typeof resolution !== "string" ||
      !isLocalPackageResolution(resolution, packageRoot)
    ) {
      throw new Error(
        `local package preflight resolved ${specifier} to ${
          typeof resolution === "string" ? resolution : "nothing"
        }`,
      );
    }
    resolutions.set(specifier, resolution);
  }
  return resolutions;
}

/** Read the tracked dependency files so the helper can prove it left no link. */
async function dependencySnapshots(): Promise<ReadonlyMap<string, string>> {
  const snapshots = new Map<string, string>();
  for (const name of ["deno.json", "deno.lock"]) {
    const path = join(REPO_ROOT, name);
    snapshots.set(path, await Deno.readTextFile(path));
  }
  return snapshots;
}

/** Refuse a run that changed the consumer's committed dependency surfaces. */
async function assertDependencySnapshots(
  snapshots: ReadonlyMap<string, string>,
): Promise<void> {
  const changed: string[] = [];
  for (const [path, before] of snapshots) {
    if (await Deno.readTextFile(path) !== before) changed.push(path);
  }
  if (changed.length > 0) {
    throw new Error(
      `local design-system run changed committed dependency files: ${
        changed.join(", ")
      }`,
    );
  }
}

/**
 * Link one checkout for the duration of `run`. The temporary config exists only
 * inside the callback, and the committed dependency files must be byte-identical
 * afterwards whatever the callback's exit code.
 */
export async function withLocalDesignSystem(
  checkout: string,
  requiredExports: readonly string[],
  run: (link: LocalDesignSystemLink) => Promise<number>,
): Promise<number> {
  const packageRoot = await Deno.realPath(resolve(checkout));
  const packageConfig = await readJsonObject(join(packageRoot, "deno.json"));
  assertLocalDesignSystemPackage(packageConfig, packageRoot, requiredExports);
  const rootConfig = await readJsonObject(join(REPO_ROOT, "deno.json"));
  if (rootConfig.workspace !== undefined) {
    throw new Error(
      "the temporary-link helper requires discern's single-package config",
    );
  }
  const snapshots = await dependencySnapshots();
  return await withToolTempDir("local-design-system", async (temporaryRoot) => {
    const configPath = join(temporaryRoot, "deno.json");
    await Deno.writeTextFile(
      configPath,
      `${
        JSON.stringify(
          localDesignSystemConfig(rootConfig, packageRoot),
          null,
          2,
        )
      }\n`,
    );
    const resolutions = await proveLocalResolution(
      configPath,
      packageRoot,
      requiredExports,
    );
    console.log(`Using local design system: ${packageRoot}`);
    const exitCode = await run({
      packageRoot,
      configPath,
      rootConfig,
      resolutions,
    });
    await assertDependencySnapshots(snapshots);
    return exitCode;
  });
}

/** Run a helper's main function, reporting any refusal under its own name. */
export async function runLocalDesignSystemTool(
  name: string,
  main: () => Promise<number>,
): Promise<never> {
  try {
    Deno.exit(await main());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${name}: ${message}`);
    Deno.exit(1);
  }
}
