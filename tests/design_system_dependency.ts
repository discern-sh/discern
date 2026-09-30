/** Immutable package contract shared by CLI and web consumer checks. */
import { fromFileUrl, toFileUrl } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

export const DESIGN_SYSTEM_VERSION = "0.37.0";
export const DESIGN_SYSTEM_SPECIFIER =
  `jsr:@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_PACKAGE =
  `@discern-sh/design-system@${DESIGN_SYSTEM_VERSION}`;
export const DESIGN_SYSTEM_ORIGIN =
  `https://jsr.io/@discern-sh/design-system/${DESIGN_SYSTEM_VERSION}/`;

/** Select React runtimes by Deno's resolved npm package identity, not checkout paths. */
export function reactRuntimeModules(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) =>
    /^npm:\/?react(?:-dom)?(?:[/@]|$)/u.test(specifier)
  );
}

const DENO_INFO_SCHEMA = z.object({
  modules: z.array(
    z.object({
      specifier: z.string().optional(),
      dependencies: z.array(
        z.object({ specifier: z.string() }).passthrough(),
      ).optional(),
    }).passthrough(),
  ).optional(),
}).passthrough();

type DenoInfo = z.infer<typeof DENO_INFO_SCHEMA>;

/** Read Deno's resolved module graph for one repository entrypoint. */
async function denoInfo(entrypoint: string): Promise<DenoInfo> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  return decodeWith(DENO_INFO_SCHEMA, new TextDecoder().decode(output.stdout));
}

/** Every resolved module specifier in one repository entrypoint's graph. */
export async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  return ((await denoInfo(entrypoint)).modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}

/**
 * The bare import specifiers this repository's own modules write, across one
 * entrypoint's graph, that start with `prefix`.
 */
export async function authoredImportSpecifiers(
  entrypoint: string,
  prefix: string,
): Promise<string[]> {
  const repository = toFileUrl(ROOT).href;
  const found = new Set<string>();
  for (const module of (await denoInfo(entrypoint)).modules ?? []) {
    if (module.specifier?.startsWith(repository) !== true) continue;
    for (const dependency of module.dependencies ?? []) {
      if (dependency.specifier.startsWith(prefix)) {
        found.add(dependency.specifier);
      }
    }
  }
  return [...found].sort();
}
