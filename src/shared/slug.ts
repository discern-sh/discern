/**
 * The one slug rule every discern-derived name obeys. Worktree identity builds
 * ids, sites, and resource handles from it, and the temp-artifact registry
 * labels artifact filenames with it — a single definition, so a value safe in
 * one namespace can never be unsafe in another.
 */

/**
 * Lowercase, collapse every run of non-`[a-z0-9]` to a single dash, and trim
 * leading/trailing dashes.
 */
export function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}
