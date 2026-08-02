/**
 * Forcing-function guard (ADR 0138): every knob a record-table entry accepts must
 * be documented in that family's MANAGED BANNER — the only channel by which a
 * newly-added knob reaches an existing install, since scaffold reconciliation
 * never key-backfills a project-owned record table. Driven off the single sources
 * of truth (`RECORD_ENTRY_SCHEMAS` and the record-path registry), so a field added
 * to a record schema, or a whole new record family, auto-enrols: add it and the
 * banner must document it or the gate fails. This is what stops the next silent
 * knob addition (as `margin` was) from shipping where no upgrade would surface it.
 */

import { assert, assertEquals } from "@std/assert";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import { RECORD_CONFIG_PATHS } from "../src/lib/config_reconcile.ts";
import { managedBannersFromTemplate } from "../src/lib/config_template.ts";

/** Return the template. */
function template(): Promise<string> {
  return Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
}

Deno.test("the families with an entry schema are exactly the record paths", () => {
  assertEquals(
    Object.keys(RECORD_ENTRY_SCHEMAS).sort(),
    [...RECORD_CONFIG_PATHS].sort(),
    "RECORD_ENTRY_SCHEMAS and RECORD_CONFIG_PATHS must name the same record families",
  );
});

Deno.test("every record-table knob is documented in its managed banner", async () => {
  const banners = managedBannersFromTemplate(
    await template(),
    RECORD_CONFIG_PATHS,
  );
  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    const banner = banners.get(family);
    assert(
      banner !== undefined,
      `[${family}] has no managed banner in the template — give it a # ───-ruled shape-doc block`,
    );
    for (const knob of Object.keys(schema.shape)) {
      assert(
        new RegExp(`\\b${knob}\\b`).test(banner),
        `the [${family}] managed banner must document the "${knob}" knob — a knob absent from the banner never reaches an existing install (scaffold reconciliation cannot key-backfill a project-owned record table)`,
      );
    }
  }
});
