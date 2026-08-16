/** Resolve the source-path registry against one fully parsed project config. */

import type { DiscernConfig } from "./config_schema.ts";
import {
  instructionSeedRel,
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathEntry,
  type SourcePathName,
} from "./paths_registry.ts";

/** One configured authored surface with its registry identity retained. */
export interface ResolvedSourcePath {
  readonly name: SourcePathName;
  readonly path: string;
  readonly pathKind: SourcePathEntry["pathKind"];
}

/** Follow a dotted config path, stopping at an absent or non-object segment. */
function valueAt(config: DiscernConfig, dotted: string): unknown {
  let value: unknown = config;
  for (const segment of dotted.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

/** Resolve one registry entry from its default, instruction seed, or config key. */
function resolvedPath(entry: SourcePathEntry, config: DiscernConfig): string {
  switch (entry.resolution) {
    case "default":
      return entry.defaultPath;
    case "instruction-seed":
      return instructionSeedRel(config.instructions.sources);
    case "configured": {
      if (entry.key === null) {
        throw new Error(
          `${entry.defaultPath} uses configured resolution without a config key`,
        );
      }
      const value = valueAt(config, entry.key);
      if (typeof value !== "string") {
        throw new Error(`${entry.key} must resolve to one path`);
      }
      return value;
    }
  }
}

/** Resolve every registered authored surface in registry order. */
export function resolveSourcePaths(
  config: DiscernConfig,
): ResolvedSourcePath[] {
  return SOURCE_PATH_NAMES.map((name) => {
    const entry = SOURCE_PATHS[name];
    return {
      name,
      path: resolvedPath(entry, config),
      pathKind: entry.pathKind,
    };
  });
}
