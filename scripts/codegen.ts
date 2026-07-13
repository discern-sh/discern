/**
 * Regenerate the committed artifacts that derive from the canonical config schema
 * (ADR 0026): the editor JSON Schema and the docs config-reference. Run it after
 * editing `src/shared/config_schema.ts`:
 *
 *   deno task codegen
 *
 * (The `discern.toml` template is NOT regenerated — it stays hand-authored for
 * legibility per ADR 0005, bound to the schema by drift-guard tests instead.)
 *
 * A sync test (`tests/config_codegen_test.ts`) asserts each committed file equals
 * its generator output, so forgetting to regenerate fails the gate.
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";
import {
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";
import {
  renderResultJsonSchema,
  renderResultTypesDts,
} from "../src/shared/result_codegen.ts";
import {
  generateThirdPartyArtifacts,
  THIRD_PARTY_ARTIFACT_PATHS,
} from "../src/shared/third_party_codegen.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const mapDir = resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
const configReference = relative(
  repoRoot,
  join(mapDir, "10-installer", "config-reference.md"),
);

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
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, text);
  console.log(`  ${before === undefined ? "created  " : "updated  "} ${rel}`);
}

console.log("Regenerating config artifacts from src/shared/config_schema.ts:");
await write("schema/discern-config.schema.json", renderConfigDocSchemaJson());
await write(configReference, renderConfigReferenceDoc());
console.log(
  "Regenerating result artifacts from src/shared/result_contracts.ts:",
);
await write("schema/discern-results.schema.json", renderResultJsonSchema());
await write("types/discern-json.d.ts", renderResultTypesDts());
console.log(
  "Regenerating third-party notices from the compile graph of src/main.ts:",
);
const thirdParty = await generateThirdPartyArtifacts({
  repoRoot,
  allowFetch: true,
});
await write(THIRD_PARTY_ARTIFACT_PATHS.notices, thirdParty.notices);
await write(THIRD_PARTY_ARTIFACT_PATHS.bundle, thirdParty.bundleModule);
await write(
  THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache,
  thirdParty.jsrLicenseCacheJson,
);
