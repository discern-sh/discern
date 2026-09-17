/**
 * Live references to configured paths.
 *
 * Membership comes from two enumerated sources. Every {@link SOURCE_PATHS}
 * entry whose `resolution` is `configured` receives `${<config-key>}`
 * automatically, so a future configured source enters parsing, expansion, seed
 * rendering, and the registry-driven tests without another membership list.
 * {@link SCALAR_CONFIG_PATH_REFERENCES} adds the configured scalar doc paths
 * that are deliberately NOT authored-surface registry members: they carry no
 * prescriptive default and no seeding story, so the registry's satellites
 * (seeding, scope fills, leakage sentinels) must not enrol them — only the
 * reference machinery sees them. Directory references expand with exactly one
 * trailing slash, independently of the configured spelling, so a reference can
 * prefix a child path without inheriting a path-default convention.
 */

import type { DiscernConfig } from "./config_schema.ts";
import { SOURCE_PATH_REFERENCES } from "./paths_registry.ts";
import { resolveSourcePaths } from "./source_path_resolution.ts";

export {
  SOURCE_PATH_REFERENCES,
  type SourcePathReference,
  sourcePathReference,
} from "./paths_registry.ts";

/**
 * One configured scalar path that expands as a live reference without being an
 * authored-surface registry member. An empty configured value expands to the
 * empty pattern, which the scope-glob dialect defines as matching nothing — so
 * a consumer keyed on an unset value goes quiet instead of misfiring.
 */
export interface ScalarConfigPathReference {
  /** The dotted config key the value lives at. */
  readonly key: string;
  /** The `${<config-key>}` spelling, following the registry convention. */
  readonly reference: string;
  /** Read the configured value from a parsed config. */
  readonly resolve: (config: DiscernConfig) => string;
}

/** The configured scalar doc paths that expand as live references. */
export const SCALAR_CONFIG_PATH_REFERENCES:
  readonly ScalarConfigPathReference[] = [
    {
      key: "project.gotchas_doc",
      reference: "${project.gotchas_doc}",
      resolve: (config) => config.project.gotchas_doc,
    },
  ];

/** Every live path-reference spelling, registry members first — the one list
 * schema descriptions and docs interpolate, so a new member documents itself. */
export const LIVE_PATH_REFERENCE_SPELLINGS: readonly string[] = [
  ...SOURCE_PATH_REFERENCES.map(({ reference }) => reference),
  ...SCALAR_CONFIG_PATH_REFERENCES.map(({ reference }) => reference),
];

/** Expand every registered live source-path reference in one scope-glob dialect
 * string. Directory members include one trailing slash; file members preserve
 * their configured spelling. Unregistered braced forms remain byte-for-byte
 * intact for the shell or another downstream consumer; expansion is
 * simultaneous, so a configured path containing reference-shaped text is not
 * recursively interpreted. */
export function expandSourcePathReferences(
  value: string,
  config: DiscernConfig,
): string {
  const resolved = new Map(
    resolveSourcePaths(config).map(({ name, path, pathKind }) =>
      [
        name,
        pathKind === "directory" ? `${path.replace(/\/+$/, "")}/` : path,
      ] as const
    ),
  );
  const replacements = new Map<string, string>(
    SOURCE_PATH_REFERENCES.map(({ name, reference }) => {
      const path = resolved.get(name);
      if (path === undefined) {
        throw new Error(`${name}: registered source path did not resolve`);
      }
      return [reference, path] as const;
    }),
  );
  for (const member of SCALAR_CONFIG_PATH_REFERENCES) {
    replacements.set(member.reference, member.resolve(config));
  }
  return value.replace(
    /\$\{[^{}]+\}/g,
    (reference) => replacements.get(reference) ?? reference,
  );
}
