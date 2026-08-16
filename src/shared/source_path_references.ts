/**
 * Live references to configured authored-source paths.
 *
 * Membership comes only from {@link SOURCE_PATHS}: every entry whose
 * `resolution` is `configured` receives `${<config-key>}` automatically. A
 * future configured source therefore enters parsing, expansion, seed rendering,
 * and the registry-driven tests without another membership list.
 */

import type { DiscernConfig } from "./config_schema.ts";
import { SOURCE_PATH_REFERENCES } from "./paths_registry.ts";
import { resolveSourcePaths } from "./source_path_resolution.ts";

export {
  SOURCE_PATH_REFERENCES,
  type SourcePathReference,
  sourcePathReference,
} from "./paths_registry.ts";

/** Expand every registered live source-path reference in one scope-glob dialect
 * string. Unregistered braced forms remain byte-for-byte intact for the shell
 * or another downstream consumer; expansion is simultaneous, so a configured
 * path containing reference-shaped text is not recursively interpreted. */
export function expandSourcePathReferences(
  value: string,
  config: DiscernConfig,
): string {
  const resolved = new Map(
    resolveSourcePaths(config).map(({ name, path }) => [name, path] as const),
  );
  const replacements = new Map(
    SOURCE_PATH_REFERENCES.map(({ name, reference }) => {
      const path = resolved.get(name);
      if (path === undefined) {
        throw new Error(`${name}: registered source path did not resolve`);
      }
      return [reference, path] as const;
    }),
  );
  return value.replace(
    /\$\{[^{}]+\}/g,
    (reference) => replacements.get(reference) ?? reference,
  );
}
