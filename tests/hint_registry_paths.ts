/**
 * Where the hint registry lives, for guards that read its source.
 *
 * `src/shared/hints.ts` composes `HINTS` from one catalog module per emitting
 * surface under `src/shared/hints/`. A guard that scans hint source must read
 * every catalog, or a new catalog would escape it; each declares its scan
 * set through `structuralGuardScope` narrowed by {@link isHintRegistryPath}.
 */

/** The registry entry point: composition, firing, and channel ownership. */
export const HINT_REGISTRY_ENTRY = "src/shared/hints.ts";

/** The directory holding the catalog modules and their shared vocabulary. */
export const HINT_CATALOG_DIR = "src/shared/hints/";

/** Whether a repository-relative path is part of the hint registry. */
export function isHintRegistryPath(rel: string): boolean {
  return rel === HINT_REGISTRY_ENTRY || rel.startsWith(HINT_CATALOG_DIR);
}
