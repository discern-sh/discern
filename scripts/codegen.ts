/**
 * Regenerate the committed artifacts that derive from the canonical config schema
 * (ADR 0026): the editor JSON Schema, the `discern.toml` template prose, and the
 * docs config-reference. Run it after editing `src/shared/config_schema.ts`:
 *
 *   deno task codegen
 *
 * A sync test (`tests/config_codegen_test.ts`) asserts each committed file equals
 * its generator output, so forgetting to regenerate fails the gate.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import {
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));

/** Write `text` to a repo-relative path, reporting whether it changed. */
async function write(rel: string, text: string): Promise<void> {
  const path = join(repoRoot, rel);
  let before: string | undefined;
  try {
    before = await Deno.readTextFile(path);
  } catch {
    before = undefined;
  }
  if (before === text) {
    console.log(`  unchanged  ${rel}`);
    return;
  }
  await Deno.writeTextFile(path, text);
  console.log(`  ${before === undefined ? "created  " : "updated  "} ${rel}`);
}

console.log("Regenerating config artifacts from src/shared/config_schema.ts:");
await write("schema/discern-config.schema.json", renderConfigDocSchemaJson());
await write(
  "docs/10-installer/config-reference.md",
  renderConfigReferenceDoc(),
);
