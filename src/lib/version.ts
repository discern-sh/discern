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
