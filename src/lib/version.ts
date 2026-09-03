/**
 * The kit version — single source of truth.
 *
 * The version lives in `deno.json` (the package version). Importing it as a
 * JSON module means `deno compile` bundles the literal into the binary, so the
 * compiled installer reports the right version with no filesystem lookup.
 */

import denoJson from "../../deno.json" with { type: "json" };
import { DISCERN_ISSUES_URL, INSTALL_COMMAND } from "../shared/brand.ts";

/** The current kit version, e.g. "1.0.0". */
export const KIT_VERSION: string = denoJson.version;

/**
 * The one honest way to get a newer discern binary, cited verbatim by every
 * surface that mentions updating it. discern makes no network requests — no
 * update polling, no telemetry, no auto-updater — so a newer binary is always a
 * step the user takes themselves: re-run the install script from the project
 * README (each build is published on the repository's releases page). Guarded
 * by test: no shipped string may invent a channel (a package manager, an
 * auto-updater) this constant doesn't name.
 */
export const UPDATE_CHANNEL =
  `install a current discern binary by running \`${INSTALL_COMMAND}\``;

/** Where a crash report belongs: the repository's public issue tracker, cited
 * verbatim by every crash surface (the stderr frame, the `--json` envelope,
 * the saved report file). */
export const ISSUES_URL = DISCERN_ISSUES_URL;

/**
 * The install schema version — the monotonic migration anchor recorded in
 * `[meta].schema_version` (ADR 0014). It is independent of `KIT_VERSION` and
 * changes only when an installed project needs a migration.
 *
 * The first public release establishes schema 1. Prerelease transitions were
 * squashed before publication, so the production migration chain is empty.
 */
export const SCHEMA_VERSION = 1;
