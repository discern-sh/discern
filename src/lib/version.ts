/**
 * The kit version — single source of truth.
 *
 * The version lives in `deno.json` (the package version). Importing it as a
 * JSON module means `deno compile` bundles the literal into the binary, so the
 * compiled installer reports the right version with no filesystem lookup. Every
 * `{{kit_version}}` substitution and the `--version` flag read it from here.
 */

import denoJson from "../../deno.json" with { type: "json" };

/** The current kit version, e.g. "1.0.0". */
export const KIT_VERSION: string = denoJson.version;

/**
 * The install **schema version** — the anchor the migration system steps from
 * (ADR 0014). Distinct from `KIT_VERSION` on purpose: `KIT_VERSION` is the
 * package's semver for display, while this is a plain monotonic integer that
 * bumps *only* when an installed project needs a migration to stay correct.
 * `init` stamps the current value into the manifest; `upgrade` reads the
 * recorded value, brings the install forward, and re-stamps. Most releases need
 * no migration and leave this untouched.
 *
 * The current shape is schema **2** (the schema-1→2 step backfills
 * `[project].main_branch`; see `MIGRATIONS`). A manifest with no `schema_version`
 * field predates the field and is read as schema 1, then migrated forward.
 */
export const SCHEMA_VERSION = 2;
