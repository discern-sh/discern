/**
 * Regenerate committed artifacts derived from canonical registries and schemas:
 *
 *   deno task codegen
 *
 * This includes the browser search module copied from its authored `src/lib`
 * source, alongside the registry- and schema-derived reference artifacts.
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
  renderConfigSchemaJson,
} from "../src/shared/config_codegen.ts";
import { renderCliReferenceDoc } from "../src/shared/cli_reference_codegen.ts";
import { renderHintInventoryDoc } from "../src/shared/hint_inventory_codegen.ts";
import { renderGlossaryDoc } from "./glossary_registry.ts";
import {
  FEATURE_CANON_PAGE_REL,
  FEATURE_CANON_PLAIN_PAGE_REL,
  renderFeatureCanonDoc,
  renderFeatureCanonPlainDoc,
} from "./feature_registry.ts";
import { buildCli } from "../src/main.ts";
import {
  renderResultJsonSchema,
  renderResultTypesDts,
} from "../src/shared/result_codegen.ts";
import {
  renderPublicSchemaReference,
  replacePublicSchemaReference,
} from "../src/shared/public_schemas.ts";
import {
  generateThirdPartyArtifacts,
  sameThirdPartyBundlePayload,
  THIRD_PARTY_ARTIFACT_PATHS,
} from "../src/shared/third_party_codegen.ts";
import { loadConfig, parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import {
  projectArtifactPaths,
  renderArtifactInventory,
  replaceArtifactInventory,
} from "../src/lib/artifact_ownership.ts";
import { renderBrowserSearchModule } from "../src/lib/docs_search.ts";
import {
  codegenWriteTargets,
  REGISTRY_ATLAS_PAGE_REL,
  renderRegistryAtlasDoc,
} from "./canonical_sets.ts";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const config = await loadConfig(repoRoot);
const mapDir = resolveMapDir(repoRoot, config).abs;
const configReference = relative(
  repoRoot,
  join(mapDir, "70-reference", "config-reference.md"),
);
const cliReference = relative(
  repoRoot,
  join(mapDir, "70-reference", "cli-reference.md"),
);
const mcpReference = relative(
  repoRoot,
  join(mapDir, "70-reference", "mcp-and-results.md"),
);
const hintInventory = relative(
  repoRoot,
  join(mapDir, "_internal", "hint-inventory.md"),
);
const glossary = relative(
  repoRoot,
  join(mapDir, "00-orientation", "glossary.md"),
);
const featureCanon = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_PAGE_REL),
);
const featureCanonPlain = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_PLAIN_PAGE_REL),
);
const installSurface = relative(
  repoRoot,
  join(mapDir, "80-development", "install-surface.md"),
);
const artifactOwnership = relative(
  repoRoot,
  join(mapDir, "70-reference", "artifact-ownership.md"),
);
const registryAtlas = relative(
  repoRoot,
  join(mapDir, REGISTRY_ATLAS_PAGE_REL),
);
type EquivalentText = (before: string, after: string) => boolean;

/** Every path this script may touch, from the canonical-sets meta-registry. */
const enrolledTargets = codegenWriteTargets();

/** Write `text` unless the committed artifact is equivalent, then report it. */
async function write(
  rel: string,
  text: string,
  equivalent: EquivalentText = (before, after) => before === after,
): Promise<void> {
  if (!enrolledTargets.has(rel)) {
    throw new Error(
      `${rel} is not enrolled in the canonical-sets meta-registry — ` +
        "declare it in scripts/canonical_sets.ts before codegen may write it",
    );
  }
  const path = join(repoRoot, rel);
  const canonicalText = rel.endsWith(".md")
    ? await formatMarkdownText(path, text)
    : text;
  let before: string | undefined;
  try {
    before = await Deno.readTextFile(path);
  } catch {
    before = undefined;
  }
  if (before !== undefined && equivalent(before, canonicalText)) {
    console.log(`  unchanged  ${rel}`);
    return;
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, canonicalText);
  console.log(`  ${before === undefined ? "created  " : "updated  "} ${rel}`);
}

console.log("Regenerating config artifacts from src/shared/config_schema.ts:");
await write("schema/discern-config.schema.json", renderConfigSchemaJson());
await write(
  "schema/discern-setup-config.schema.json",
  renderConfigDocSchemaJson(),
);
await write(configReference, renderConfigReferenceDoc());
console.log("Regenerating the CLI reference from the live command registry:");
await write(cliReference, renderCliReferenceDoc(buildCli(false)));
console.log(
  "Regenerating the browser docs-search module from its shared source:",
);
await write(
  "site/pages/assets/search.js",
  renderBrowserSearchModule(
    await Deno.readTextFile(join(repoRoot, "src/lib/docs_search.js")),
  ),
);
console.log("Regenerating the hint inventory from HINTS:");
await write(hintInventory, renderHintInventoryDoc());
console.log("Regenerating the glossary from scripts/glossary_registry.ts:");
await write(glossary, renderGlossaryDoc());
console.log(
  "Regenerating the feature canon from scripts/feature_registry.ts:",
);
await write(featureCanon, renderFeatureCanonDoc());
await write(featureCanonPlain, renderFeatureCanonPlainDoc());
console.log(
  "Regenerating the registry atlas from scripts/canonical_sets.ts:",
);
await write(registryAtlas, await renderRegistryAtlasDoc());
console.log("Regenerating the project artifact ownership inventory:");
const inventory = renderArtifactInventory(
  projectArtifactPaths(parseConfigOrThrow("")),
);
const artifactOwnershipDoc = await Deno.readTextFile(
  join(repoRoot, artifactOwnership),
);
await write(
  artifactOwnership,
  replaceArtifactInventory(artifactOwnershipDoc, inventory),
);
const installSurfaceDoc = await Deno.readTextFile(
  join(repoRoot, installSurface),
);
await write(
  installSurface,
  replaceArtifactInventory(installSurfaceDoc, inventory),
);
console.log(
  "Regenerating result artifacts from src/shared/result_contracts.ts:",
);
await write("schema/discern-results.schema.json", renderResultJsonSchema());
await write("types/discern-json.d.ts", renderResultTypesDts());
console.log(
  "Regenerating the public schema reference from PUBLIC_SCHEMA_PUBLICATIONS:",
);
const mcpReferenceDoc = await Deno.readTextFile(
  join(repoRoot, mcpReference),
);
await write(
  mcpReference,
  replacePublicSchemaReference(
    mcpReferenceDoc,
    renderPublicSchemaReference(),
  ),
);
console.log(
  "Regenerating third-party notices from the compile graph of src/main.ts:",
);
const thirdParty = await generateThirdPartyArtifacts({
  repoRoot,
  allowFetch: true,
});
await write(THIRD_PARTY_ARTIFACT_PATHS.notices, thirdParty.notices);
await write(
  THIRD_PARTY_ARTIFACT_PATHS.bundle,
  thirdParty.bundleModule,
  sameThirdPartyBundlePayload,
);
await write(
  THIRD_PARTY_ARTIFACT_PATHS.jsrLicenseCache,
  thirdParty.jsrLicenseCacheJson,
);
