/** Advisory affected-test ordering; native discovery still owns the full selection. */
import {
  fromFileUrl,
  isAbsolute,
  isGlob,
  join,
  relative,
  toFileUrl,
} from "@std/path";
import { z } from "@zod/zod";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { loadIdentitySettings } from "../src/engine/worktree/identity.ts";
import { collectPaths } from "../src/engine/scopes/scopes.ts";
import { denoMetadata } from "../src/shared/deno_metadata.ts";
import {
  decodeDenoInfoGraph,
  type DenoInfoGraph,
} from "../src/shared/deno_graph.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { listTestModules } from "./test_modules.ts";

export interface TestPriority {
  /** Literal paths relative to the native test cwd, preserving filesystem aliases. */
  readonly files: readonly string[];
  readonly excluded: readonly string[];
  readonly moduleCount: number;
}

const SelectionConfigSchema = z.object({
  test: z.object({
    exclude: z.array(z.string()).optional(),
    include: z.unknown().optional(),
  }).passthrough().optional(),
  workspace: z.unknown().optional(),
  exclude: z.unknown().optional(),
}).passthrough();

/** Preserve the native config exclusions when the CLI supplies an ignore list. */
export function priorityExclusions(config: unknown): string[] | undefined {
  const parsed = SelectionConfigSchema.safeParse(config);
  if (
    !parsed.success || parsed.data.test?.include !== undefined ||
    parsed.data.workspace !== undefined || parsed.data.exclude !== undefined
  ) return undefined;
  const excluded = parsed.data.test?.exclude ?? [];
  return excluded.some((path) => path.includes(",")) ? undefined : excluded;
}

/** Only literal native test filenames can be removed from the remaining selection. */
export function priorityFile(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) && !path.startsWith("../") &&
    !path.startsWith("-") && !path.includes(",") &&
    !isGlob(path) &&
    /(?:^|\/)(?:test|[^/]+[._]test)\.(?:[cm]?[jt]s|[jt]sx)$/.test(path);
}

/** Follow resolved code and type importers once, including redirects and cycles. */
export function affectedTestFiles(
  graph: DenoInfoGraph,
  modules: readonly string[],
  changed: readonly string[],
): string[] {
  const importers = new Map<string, Set<string>>();
  const add = (dependency: string, importer: string): void => {
    const parents = importers.get(dependency) ?? new Set<string>();
    parents.add(importer);
    importers.set(dependency, parents);
  };
  for (const [alias, target] of Object.entries(graph.redirects)) {
    add(target, alias);
  }
  for (const module of graph.modules) {
    for (const dependency of module.dependencies) {
      for (
        const target of [dependency.code?.specifier, dependency.type?.specifier]
      ) {
        if (target !== undefined) add(target, module.specifier);
      }
    }
  }
  const affected = new Set(changed);
  const pending = [...affected];
  for (let index = 0; index < pending.length; index++) {
    const child = pending[index];
    if (child === undefined) continue;
    for (const parent of importers.get(child) ?? []) {
      if (affected.has(parent)) continue;
      affected.add(parent);
      pending.push(parent);
    }
  }
  return [...new Set(modules)].filter((module) => affected.has(module)).sort();
}

/** Resolve optional priority work after native preparation populated its cache. */
export async function discoverTestPriority(
  root: string,
  signal: AbortSignal,
): Promise<TestPriority | undefined> {
  const started = SYSTEM_CLOCK.monotonicNow();
  try {
    signal.throwIfAborted();
    const excluded = priorityExclusions(
      JSON.parse(await readTextIfExists(join(root, "deno.json")) ?? "null"),
    );
    if (excluded === undefined) {
      console.error(
        "Test priority: this native selection configuration uses ordinary seeded admission.",
      );
      return undefined;
    }
    const settings = await loadIdentitySettings(root);
    if (settings.trunk === undefined) return undefined;
    const changed = await collectPaths(root, settings.trunk);
    if (changed === null) {
      console.error(
        "Test priority: no comparison diff is available; using ordinary seeded admission.",
      );
      return undefined;
    }
    if (changed.length === 0) return undefined;
    const modules = [
      ...new Set([
        ...await listTestModules(join(root, "tests")),
        ...changed.filter(priorityFile).map((path) => join(root, path)),
      ]),
    ].map((path) => toFileUrl(path).href).sort();
    const changedUrls = changed.map((path) => toFileUrl(join(root, path)).href);
    const entry = `data:application/typescript,${
      encodeURIComponent(
        modules.map((path) => `import ${JSON.stringify(path)};`).join("\n"),
      )
    }`;
    const graph = decodeDenoInfoGraph(JSON.parse(
      await denoMetadata(root, [
        "info",
        "--json",
        "--frozen=true",
        "--deny-import",
        "--config",
        join(root, "deno.json"),
        entry,
      ], signal),
    ));
    const files = affectedTestFiles(graph, modules, changedUrls).map(
      (url) => relative(root, fromFileUrl(url)),
    ).filter(priorityFile);
    console.error(
      `Test priority: ${files.length} changed or resolved importing modules; ${
        (SYSTEM_CLOCK.monotonicNow() - started).toFixed(0)
      }ms discovery. Dynamic runtime dependencies may remain in the full selection.`,
    );
    return { files, excluded, moduleCount: modules.length };
  } catch (error) {
    if (signal.aborted) throw error;
    console.error(
      "Test priority unavailable; every required test remains in ordinary seeded admission.",
      error instanceof Error
        ? error.message.slice(0, 300)
        : String(error).slice(0, 300),
    );
    return undefined;
  }
}
