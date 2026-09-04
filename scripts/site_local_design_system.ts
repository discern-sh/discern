/**
 * Build or serve discern.sh against a local design-system package without
 * changing the committed exact JSR dependency.
 */

import { dirname, fromFileUrl, join, resolve, toFileUrl } from "@std/path";
import { denoRunInvocation } from "../site/dev.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { SIGNAL_EXIT_CODES } from "../src/engine/process_signals.ts";
import { mainRepoPath } from "../src/engine/worktree/git.ts";
import { withToolTempDir } from "./temp_dir.ts";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const PACKAGE_NAME = "@discern-sh/design-system";
const PACKAGE_NAME_SPECIFIER = `jsr:${PACKAGE_NAME}`;
const PACKAGE_EXPORTS = [".", "./react", "./runtime"] as const;
const PACKAGE_REPOSITORY = "discern-design-system";
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

type JsonObject = Record<string, unknown>;

/** Command-line choices for one local-package preview. */
export interface LocalDesignSystemArgs {
  readonly buildOnly: boolean;
  readonly packageRoot: string;
}

interface ParsedLocalDesignSystemArgs {
  readonly buildOnly: boolean;
  readonly packageRoot: string | undefined;
}

/** Parse the flags and optional checkout override supplied by the operator. */
function parseLocalDesignSystemArgs(
  args: readonly string[],
): ParsedLocalDesignSystemArgs {
  let buildOnly = false;
  let packageRoot: string | undefined;
  for (const argument of args) {
    if (argument === "--") {
      continue;
    }
    if (argument === "--build-only") {
      buildOnly = true;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    }
    if (packageRoot !== undefined) {
      throw new Error("pass exactly one design-system checkout");
    }
    packageRoot = argument;
  }
  if (packageRoot !== undefined && packageRoot.trim() === "") {
    throw new Error("the design-system checkout path cannot be empty");
  }
  return { buildOnly, packageRoot };
}

/**
 * Resolve an explicit override or the conventional package checkout beside
 * discern's Git main checkout. The main-checkout query keeps this stable when
 * the helper runs from a linked worktree.
 */
export async function resolveLocalDesignSystemArgs(
  args: readonly string[],
  resolveMainCheckout: () => Promise<string | undefined>,
): Promise<LocalDesignSystemArgs> {
  const parsed = parseLocalDesignSystemArgs(args);
  if (parsed.packageRoot !== undefined) {
    return { buildOnly: parsed.buildOnly, packageRoot: parsed.packageRoot };
  }
  const mainCheckout = await resolveMainCheckout();
  if (mainCheckout === undefined) {
    throw new Error(
      "could not locate discern's main checkout; pass a design-system checkout",
    );
  }
  return {
    buildOnly: parsed.buildOnly,
    packageRoot: join(dirname(mainCheckout), PACKAGE_REPOSITORY),
  };
}

/** Align the temporary alias with a linked checkout without mutating the base. */
export function localDesignSystemConfig(
  base: Readonly<JsonObject>,
  packageRoot: string,
  packageVersion: string,
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
      "discern-design-system": `${PACKAGE_NAME_SPECIFIER}@${packageVersion}`,
    },
    links: [packageRoot],
    lock: false,
    nodeModulesDir: "none",
  };
}

/** Assert the selected directory exposes the package surface discern consumes. */
export function assertLocalDesignSystemPackage(
  config: unknown,
  path: string,
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
  for (const required of PACKAGE_EXPORTS) {
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

/** Decode a JSON file whose root must be an object. */
async function readJsonObject(path: string): Promise<JsonObject> {
  const value: unknown = JSON.parse(await Deno.readTextFile(path));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value as JsonObject;
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

/** Run the long-lived build or server as an inherited-terminal child. */
async function inheritedCommand(args: readonly string[]): Promise<number> {
  const result = await runOwnedChild(Deno.execPath(), {
    args,
    cwd: REPO_ROOT,
    resumeAfterInterrupt: true,
  });
  return result.interruptedBy === null
    ? result.status.code
    : SIGNAL_EXIT_CODES[result.interruptedBy] ?? 1;
}

/** Prove the temporary config resolves the public runtime export locally. */
async function proveLocalResolution(
  configPath: string,
  packageRoot: string,
): Promise<string> {
  const probe = await capturedCommand([
    "eval",
    "--config",
    configPath,
    'console.log(import.meta.resolve("discern-design-system/runtime"))',
  ]);
  const stdout = new TextDecoder().decode(probe.stdout).trim();
  if (!probe.success) {
    const stderr = new TextDecoder().decode(probe.stderr).trim();
    throw new Error(stderr || "Deno could not resolve the local package");
  }
  if (!isLocalPackageResolution(stdout, packageRoot)) {
    throw new Error(
      `local package preflight resolved ${stdout || "nothing"}`,
    );
  }
  return stdout;
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
      `local preview changed committed dependency files: ${changed.join(", ")}`,
    );
  }
}

/** Arguments for a one-shot site build through the temporary link. */
function buildArgs(configPath: string): string[] {
  return [
    "run",
    "--config",
    configPath,
    "--allow-read",
    "--allow-write",
    "--allow-run",
    "--allow-env=NODE_ENV",
    join(REPO_ROOT, "site/build.ts"),
  ];
}

/** The consumer config's watch task command, the linked server's flag source. */
export function watchTaskCommand(rootConfig: JsonObject): string {
  const tasks = rootConfig.tasks;
  const command =
    typeof tasks === "object" && tasks !== null && !Array.isArray(tasks)
      ? (tasks as JsonObject).watch
      : undefined;
  if (typeof command !== "string") {
    throw new Error("the consumer config declares no watch task to derive");
  }
  return command;
}

/**
 * Arguments for a linked server whose every rebuild retains the override. The
 * sandbox comes from the watch task's own permission flags, so the preview's
 * environment needs stay declared in exactly one place, plus the write access
 * the linked rebuild adds.
 */
export function serverArgs(
  configPath: string,
  packageRoot: string,
  watchCommand: string,
): string[] {
  const invocation = denoRunInvocation(watchCommand);
  if (
    invocation === undefined ||
    invocation.entry.replace(/^\.\//, "") !== "site/dev.ts"
  ) {
    throw new Error(
      "the watch task no longer runs site/dev.ts directly; realign the " +
        "linked design-system server with the preview runtime",
    );
  }
  return [
    "run",
    "--config",
    configPath,
    "--watch",
    ...invocation.permissionFlags,
    "--allow-write",
    join(REPO_ROOT, "site/dev.ts"),
    "--watch",
    "--build-config",
    configPath,
    "--watch-input",
    join(packageRoot, "src"),
    "--watch-input",
    join(packageRoot, "deno.json"),
  ];
}

/** Print the public Project Script contract. */
function printHelp(): void {
  console.log(`Serve discern.sh against a local design-system checkout

Usage:
  discern scripts site-design-system
  discern scripts site-design-system -- --build-only
  discern scripts site-design-system [<checkout>]

The helper uses the sibling discern-design-system repository beside discern's
Git main checkout. Pass another checkout as the positional argument to
override it.
It writes an untracked temporary Deno config, aligns that copy's package version
so Deno accepts an ahead or behind checkout, verifies that the public export
resolves locally, and leaves deno.json and deno.lock unchanged. Without
--build-only it serves and watches both repositories.`);
}

/** Run the complete temporary-link lifecycle. */
async function main(): Promise<number> {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    printHelp();
    return 0;
  }
  const options = await resolveLocalDesignSystemArgs(
    Deno.args,
    () => mainRepoPath(REPO_ROOT),
  );
  const packageRoot = await Deno.realPath(resolve(options.packageRoot));
  const packageConfigPath = join(packageRoot, "deno.json");
  const packageConfig = await readJsonObject(packageConfigPath);
  assertLocalDesignSystemPackage(packageConfig, packageRoot);

  const rootConfigPath = join(REPO_ROOT, "deno.json");
  const rootConfig = await readJsonObject(rootConfigPath);
  if (rootConfig.workspace !== undefined) {
    throw new Error(
      "the temporary-link helper requires discern's single-package config",
    );
  }
  const snapshots = await dependencySnapshots();
  return await withToolTempDir("site-design-system", async (temporaryRoot) => {
    const temporaryConfig = join(temporaryRoot, "deno.json");
    await Deno.writeTextFile(
      temporaryConfig,
      `${
        JSON.stringify(
          localDesignSystemConfig(
            rootConfig,
            packageRoot,
            packageConfig.version,
          ),
          null,
          2,
        )
      }\n`,
    );

    const resolution = await proveLocalResolution(
      temporaryConfig,
      packageRoot,
    );
    console.log(`Using local design system: ${packageRoot}`);
    console.log(`Resolved runtime: ${resolution}`);
    const exitCode = await inheritedCommand(
      options.buildOnly ? buildArgs(temporaryConfig) : serverArgs(
        temporaryConfig,
        packageRoot,
        watchTaskCommand(rootConfig),
      ),
    );
    if (options.buildOnly && exitCode === 0) {
      console.log(
        "Built the local design-system preview; refresh the browser.",
      );
    }
    await assertDependencySnapshots(snapshots);
    return exitCode;
  });
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`site-design-system: ${message}`);
    Deno.exit(1);
  }
}
