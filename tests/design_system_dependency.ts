/** Immutable package contract shared by CLI and web consumer checks. */
import { fromFileUrl } from "@std/path";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

export const DESIGN_SYSTEM_VERSION = "0.35.0";
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
    }).passthrough(),
  ).optional(),
}).passthrough();

/** Read Deno's resolved module graph for one repository entrypoint. */
export async function moduleSpecifiers(entrypoint: string): Promise<string[]> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", entrypoint],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr));
  }
  const info = decodeWith(
    DENO_INFO_SCHEMA,
    new TextDecoder().decode(output.stdout),
  );
  return (info.modules ?? []).flatMap((module) =>
    module.specifier === undefined ? [] : [module.specifier]
  );
}
