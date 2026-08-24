/**
 * Deno-backed runtime module-graph reader shared by structural graph guards.
 *
 * The graph is Deno's resolved code graph for one entry point. Type-only
 * dependencies have no `code` projection and therefore stay outside it;
 * dynamic imports do have one and remain enrolled. Local modules are reported
 * repository-relative while external modules are discarded.
 */

import { fromFileUrl, relative } from "@std/path";

/** The dependency fields consumed from `deno info --json`. */
export interface DenoInfoDependency {
  readonly code?: { readonly specifier: string };
}

/** The module fields consumed from `deno info --json`. */
export interface DenoInfoModule {
  readonly specifier: string;
  readonly dependencies?: readonly DenoInfoDependency[];
}

/** The bounded `deno info --json` projection required by the graph walk. */
export interface DenoInfo {
  readonly modules: readonly DenoInfoModule[];
}

/** Repository-local modules and their resolved runtime dependency edges. */
export interface ModuleGraph {
  readonly modules: ReadonlySet<string>;
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}

const ERROR_DETAIL_MAX = 480;

/** Narrow an unknown JSON value to a non-array object. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

/** Keep command failures bounded even when an upstream tool emits a huge value. */
function boundedDetail(detail: string): string {
  return detail.length <= ERROR_DETAIL_MAX
    ? detail
    : `${detail.slice(0, ERROR_DETAIL_MAX)}…`;
}

/** Build the one command-named malformed-report error used by every decoder branch. */
function malformedDenoInfo(command: string, detail: string): Error {
  return new Error(
    `${command} returned malformed JSON: ${boundedDetail(detail)}`,
  );
}

/**
 * Validate and project exactly the module/dependency fields the graph walk
 * consumes. Missing optional dependency arrays and type-only dependency
 * records are valid; malformed present fields fail closed.
 */
export function decodeDenoInfo(
  value: unknown,
  command: string,
): DenoInfo {
  const root = recordOf(value);
  if (root === undefined) {
    throw malformedDenoInfo(command, "the top-level value is not an object");
  }
  if (!Array.isArray(root.modules)) {
    throw malformedDenoInfo(command, "modules is not an array");
  }

  const modules: DenoInfoModule[] = [];
  for (const [moduleIndex, rawModule] of root.modules.entries()) {
    const module = recordOf(rawModule);
    if (module === undefined) {
      throw malformedDenoInfo(
        command,
        `modules[${moduleIndex}] is not an object`,
      );
    }
    if (typeof module.specifier !== "string") {
      throw malformedDenoInfo(
        command,
        `modules[${moduleIndex}].specifier is not a string`,
      );
    }
    if (
      module.dependencies !== undefined &&
      !Array.isArray(module.dependencies)
    ) {
      throw malformedDenoInfo(
        command,
        `modules[${moduleIndex}].dependencies is not an array`,
      );
    }

    const dependencies: DenoInfoDependency[] = [];
    for (
      const [dependencyIndex, rawDependency] of (module.dependencies ?? [])
        .entries()
    ) {
      const dependency = recordOf(rawDependency);
      if (dependency === undefined) {
        throw malformedDenoInfo(
          command,
          `modules[${moduleIndex}].dependencies[${dependencyIndex}] is not an object`,
        );
      }
      if (dependency.code === undefined) {
        dependencies.push({});
        continue;
      }
      const code = recordOf(dependency.code);
      if (code === undefined || typeof code.specifier !== "string") {
        throw malformedDenoInfo(
          command,
          `modules[${moduleIndex}].dependencies[${dependencyIndex}].code.specifier is not a string`,
        );
      }
      dependencies.push({ code: { specifier: code.specifier } });
    }
    modules.push({
      specifier: module.specifier,
      ...(module.dependencies === undefined ? {} : { dependencies }),
    });
  }
  return { modules };
}

/** Parse command output to unknown before applying the bounded shape decoder. */
export function parseDenoInfoJson(text: string, command: string): DenoInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw malformedDenoInfo(command, detail);
  }
  return decodeDenoInfo(parsed, command);
}

/** Map a file URL into the shipped repository graph while excluding external modules. */
export function localModule(
  root: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith("file:")) return undefined;
  const rel = relative(root, fromFileUrl(specifier)).replaceAll("\\", "/");
  return rel === ".." || rel.startsWith("../") ? undefined : rel;
}

/** Read the runtime module graph with Deno's TypeScript parser and resolver. */
export async function shippedModuleGraph(
  root: string,
  entrypoint: string,
): Promise<ModuleGraph> {
  const resolvedRoot = await Deno.realPath(root);
  const command = `deno info --json ${entrypoint}`;
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: resolvedRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(
      `${command} failed: ${
        boundedDetail(stderr === "" ? "no stderr" : stderr)
      }`,
    );
  }
  const info = parseDenoInfoJson(
    new TextDecoder().decode(output.stdout),
    command,
  );
  const modules = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];
  for (const module of info.modules) {
    const from = localModule(resolvedRoot, module.specifier);
    if (from === undefined) continue;
    modules.add(from);
    for (const dependency of module.dependencies ?? []) {
      const specifier = dependency.code?.specifier;
      if (specifier === undefined) continue;
      const to = localModule(resolvedRoot, specifier);
      if (to !== undefined) edges.push({ from, to });
    }
  }
  return { modules, edges };
}
