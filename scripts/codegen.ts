/**
 * Regenerate committed artifacts derived from canonical registries and schemas:
 *
 *   deno task codegen
 *
 * This includes the browser search module copied from its authored `src/lib`
 * source, alongside the registry- and schema-derived reference artifacts.
 *
 * The `discern.toml` template is one of them: it renders from the config
 * schema and the config prose registry (ADR 0363), so its prose has one
 * authority and its layout is uniform by construction.
 *
 * A sync test (`tests/config_codegen_test.ts`) asserts each committed file equals
 * its generator output, so forgetting to regenerate fails the gate. The
 * `[generated.codegen]` group in discern.toml reruns this script in the gate's
 * build stage and fails on drift too (ADR 0247) — the two guards are
 * deliberately redundant; keep both.
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import {
  renderConfigDocSchemaJson,
  renderConfigSchemaJson,
  renderManualConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";
import { renderConfigTemplate } from "../src/shared/config_template_codegen.ts";
import { renderManualCliReferenceDoc } from "../src/shared/cli_reference_codegen.ts";
import { renderHintInventoryDoc } from "../src/shared/hint_inventory_codegen.ts";
import { renderTipInventoryDoc } from "../src/shared/tip_inventory_codegen.ts";
import { renderCrossAgentReferenceDoc } from "./cross_agent_registry.ts";
import { renderAgentIntegrationCoverageDoc } from "./agent_integration_registry.ts";
import { renderManualEnvironmentVariableReferenceDoc } from "./environment_variable_reference.ts";
import { renderGlossaryDoc } from "./glossary_registry.ts";
import { renderManualGlossaryArtifact } from "./glossary_codegen.ts";
import {
  FEATURE_CANON_AGENT_BENEFITS_PAGE_REL,
  FEATURE_CANON_HUMAN_BENEFITS_PAGE_REL,
  FEATURE_CANON_PAGE_REL,
  FEATURE_CANON_PLAIN_PAGE_REL,
  renderFeatureCanonAgentBenefitsDoc,
  renderFeatureCanonDoc,
  renderFeatureCanonHumanBenefitsDoc,
  renderFeatureCanonPlainDoc,
} from "./feature_registry.ts";
import {
  PRACTICE_CANON_PAGE_REL,
  PRACTICE_PUBLIC_PAGE_REL,
  renderPracticeCanonDoc,
  renderPracticePublicDoc,
} from "./practice_registry.ts";
import { buildCli } from "../src/main.ts";
import {
  renderProofNoteJsonSchema,
  renderResultJsonSchema,
  renderResultTypesDts,
} from "../src/shared/result_codegen.ts";
import {
  renderPublicSchemaReference,
  replacePublicSchemaReference,
} from "../src/shared/public_schemas.ts";
import { replaceExitStatusTable } from "../src/shared/exit_codes.ts";
import {
  generateThirdPartyArtifacts,
  sameThirdPartyBundlePayload,
  THIRD_PARTY_ARTIFACT_PATHS,
} from "./third_party_codegen.ts";
import {
  FIRST_PARTY_LICENSE_ARTIFACT_PATHS,
  generateFirstPartyLicenseBundle,
  renderFirstPartyLicenseBundleModule,
  sameFirstPartyLicenseBundlePayload,
} from "../src/shared/first_party_license_codegen.ts";
import { loadConfig, parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { resolveMapDir, resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { discoverDocs } from "../src/lib/docs.ts";
import { repositoryBlobUrl } from "../src/shared/brand.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
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
import {
  CLA_ASSISTANT_METADATA_PATH,
  renderClaAssistantMetadata,
} from "./contributor_agreement.ts";
import {
  brandDocMapRel,
  generatedBrandDocuments,
  renderBrandDoc,
} from "./brand_registry.ts";
import { REGISTERS } from "./brand/model.ts";
import { renderVoiceSkill, voiceSkillRel } from "./brand/voice.ts";
import {
  renderVoiceEnforcementCoverageDoc,
  valeStyleFiles,
  VOICE_ENFORCEMENT_COVERAGE_PAGE_REL,
} from "./brand/vale.ts";
import { renderGeneratedManualDocument } from "./manual_codegen.ts";
import { replaceSupportedTargetsTable } from "./build_targets.ts";
import {
  PROVIDER_BRAND_PROVENANCE_REL,
  renderProviderBrandProvenance,
} from "./provider_brand_provenance.ts";
import {
  renderCliManifest,
  renderConventionsManifest,
  renderMcpToolsManifest,
} from "./contract_manifests.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const config = await loadConfig(repoRoot);
const mapDir = resolveMapDir(repoRoot, config).abs;
const manualDir = resolveRepositoryManualDir(repoRoot).abs;
const hintInventory = relative(
  repoRoot,
  join(mapDir, "_internal", "hint-inventory.md"),
);
const tipInventory = relative(
  repoRoot,
  join(mapDir, "_internal", "tip-inventory.md"),
);
const voiceEnforcementCoverage = relative(
  repoRoot,
  join(mapDir, VOICE_ENFORCEMENT_COVERAGE_PAGE_REL),
);
const glossary = relative(
  repoRoot,
  join(mapDir, "00-orientation", "glossary.md"),
);
const manualConfigReference = relative(
  repoRoot,
  join(manualDir, "30-reference", "config-reference.md"),
);
const manualCliReference = relative(
  repoRoot,
  join(manualDir, "30-reference", "cli-reference.md"),
);
const manualEnvironmentVariableReference = relative(
  repoRoot,
  join(manualDir, "30-reference", "environment-variables.md"),
);
const manualMcpReference = relative(
  repoRoot,
  join(manualDir, "30-reference", "mcp-and-results.md"),
);
const manualGlossary = relative(
  repoRoot,
  join(manualDir, "30-reference", "glossary.md"),
);
const manualArtifactOwnership = relative(
  repoRoot,
  join(manualDir, "30-reference", "files-and-ownership.md"),
);
const featureCanon = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_PAGE_REL),
);
const featureCanonPlain = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_PLAIN_PAGE_REL),
);
const featureCanonHumanBenefits = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_HUMAN_BENEFITS_PAGE_REL),
);
const featureCanonAgentBenefits = relative(
  repoRoot,
  join(mapDir, FEATURE_CANON_AGENT_BENEFITS_PAGE_REL),
);
const practiceCanon = relative(
  repoRoot,
  join(mapDir, PRACTICE_CANON_PAGE_REL),
);
const practicePublic = relative(
  repoRoot,
  join(mapDir, PRACTICE_PUBLIC_PAGE_REL),
);
const installSurface = relative(
  repoRoot,
  join(mapDir, "80-development", "install-surface.md"),
);
const mapPlatforms = relative(
  repoRoot,
  join(mapDir, "70-reference", "platforms-and-prereqs.md"),
);
const manualPlatforms = relative(
  repoRoot,
  join(manualDir, "30-reference", "platforms-and-providers.md"),
);
const registryAtlas = relative(
  repoRoot,
  join(mapDir, REGISTRY_ATLAS_PAGE_REL),
);
const crossAgentReference = relative(
  repoRoot,
  join(mapDir, "_internal", "cross-agent-behaviour-reference.md"),
);
const agentIntegrationCoverage = relative(
  repoRoot,
  join(mapDir, "_internal", "agent-integration-coverage.md"),
);
type EquivalentText = (before: string, after: string) => boolean;

/** Every path this script may touch, from the canonical-sets meta-registry. */
const enrolledTargets = codegenWriteTargets();
const manualTree = await discoverDocs({ cwd: repoRoot, dir: manualDir });
if (manualTree === undefined) {
  throw new Error(`could not discover the repository manual at ${manualDir}`);
}
const manualProjection = await buildManualProjection(manualTree.entries);

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
  const before = await readTextIfExists(path);
  if (before !== undefined && equivalent(before, canonicalText)) {
    console.log(`  unchanged  ${rel}`);
    return;
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, canonicalText);
  console.log(`  ${before === undefined ? "created  " : "updated  "} ${rel}`);
}

console.log("Regenerating config artifacts from src/shared/config_schema.ts:");
await write("templates/discern.toml.tmpl", renderConfigTemplate());
await write("schema/discern-config.schema.json", renderConfigSchemaJson());
await write(
  "schema/discern-setup-config.schema.json",
  renderConfigDocSchemaJson(),
);
await write(
  manualConfigReference,
  renderGeneratedManualDocument(
    renderManualConfigReferenceDoc(),
    "70-reference/config-reference.md",
    "30-reference/config-reference.md",
    { id: "reference-config", order: 30 },
    manualProjection,
  ),
);
console.log("Regenerating the CLI reference from the live command registry:");
await write(
  manualCliReference,
  renderGeneratedManualDocument(
    renderManualCliReferenceDoc(buildCli(false)),
    "70-reference/cli-reference.md",
    "30-reference/cli-reference.md",
    { id: "reference-cli", order: 20 },
    manualProjection,
  ),
);
console.log(
  "Regenerating the environment-variable reference from its definitions:",
);
await write(
  manualEnvironmentVariableReference,
  renderGeneratedManualDocument(
    renderManualEnvironmentVariableReferenceDoc(),
    "70-reference/environment-variables.md",
    "30-reference/environment-variables.md",
    { id: "reference-environment-variables", order: 60 },
    manualProjection,
  ),
);
console.log("Regenerating supported targets from BUILD_TARGETS:");
await write(
  mapPlatforms,
  replaceSupportedTargetsTable(
    await Deno.readTextFile(join(repoRoot, mapPlatforms)),
  ),
);
await write(
  manualPlatforms,
  replaceSupportedTargetsTable(
    await Deno.readTextFile(join(repoRoot, manualPlatforms)),
  ),
);
console.log(
  "Regenerating the browser docs-search module from its shared source:",
);
await write(
  "site/pages/assets/search.js",
  renderBrowserSearchModule(
    await Deno.readTextFile(join(repoRoot, "src/lib/docs_search.js")),
  ),
);
console.log("Copying the authored ADR skeleton into the write-adr skill:");
// The setup skeleton is the authored source for the ADR pack; the write-adr
// skill carries a generated copy so the pack travels with the skill. The
// byte-identity test in tests/adr_index_test.ts backstops the pair, and its
// file-set equality flags a new source file until it is copied here too.
const adrSkeletonFile = (name: string): Promise<string> =>
  Deno.readTextFile(
    join(repoRoot, "templates/setup/skeleton/map/_adr", name),
  );
await write(
  "templates/skills/discern-write-adr/skeleton/map/_adr/0000-template.md",
  await adrSkeletonFile("0000-template.md"),
);
await write(
  "templates/skills/discern-write-adr/skeleton/map/_adr/0001-adopt-discern.md",
  await adrSkeletonFile("0001-adopt-discern.md"),
);
await write(
  "templates/skills/discern-write-adr/skeleton/map/_adr/README.md",
  await adrSkeletonFile("README.md"),
);
console.log("Regenerating the hint inventory from HINTS:");
await write(hintInventory, renderHintInventoryDoc());
console.log("Regenerating the tip inventory from TIPS:");
await write(tipInventory, renderTipInventoryDoc());
console.log(
  "Regenerating voice-enforcement coverage from the typed coverage model:",
);
await write(
  voiceEnforcementCoverage,
  renderVoiceEnforcementCoverageDoc(),
);
console.log("Regenerating the glossary from scripts/glossary_registry.ts:");
const renderedGlossary = renderGlossaryDoc();
await write(glossary, renderedGlossary);
await write(
  manualGlossary,
  renderManualGlossaryArtifact(manualProjection),
);
console.log(
  "Regenerating the feature canon from scripts/feature_registry.ts:",
);
await write(featureCanon, renderFeatureCanonDoc());
await write(featureCanonPlain, renderFeatureCanonPlainDoc());
await write(
  featureCanonHumanBenefits,
  renderFeatureCanonHumanBenefitsDoc(),
);
await write(
  featureCanonAgentBenefits,
  renderFeatureCanonAgentBenefitsDoc(),
);
console.log(
  "Regenerating the practice canon from scripts/practice_registry.ts:",
);
await write(practiceCanon, renderPracticeCanonDoc());
await write(practicePublic, renderPracticePublicDoc());
console.log(
  "Regenerating the registry atlas from scripts/canonical_sets.ts:",
);
await write(registryAtlas, await renderRegistryAtlasDoc());
console.log(
  "Regenerating the cross-agent reference from scripts/cross_agent_registry.ts:",
);
await write(crossAgentReference, renderCrossAgentReferenceDoc());
console.log(
  "Regenerating the agent-integration coverage from the provider registry:",
);
await write(agentIntegrationCoverage, renderAgentIntegrationCoverageDoc());
console.log(
  "Regenerating provider-logo provenance from the provider registry:",
);
await write(PROVIDER_BRAND_PROVENANCE_REL, renderProviderBrandProvenance());
console.log(
  "Regenerating the brand documents from scripts/brand_registry.ts:",
);
for (const doc of generatedBrandDocuments()) {
  await write(
    relative(repoRoot, join(mapDir, brandDocMapRel(doc))),
    renderBrandDoc(doc.id),
  );
}
console.log("Regenerating the voice skills from scripts/brand/voice.ts:");
for (const register of REGISTERS) {
  await write(voiceSkillRel(register), renderVoiceSkill(register));
}
console.log(
  "Regenerating the register Vale styles from scripts/brand/vale.ts:",
);
for (const file of valeStyleFiles()) {
  await write(file.rel, file.text);
}
console.log("Regenerating the project artifact ownership inventory:");
const inventory = renderArtifactInventory(
  projectArtifactPaths(parseConfigOrThrow("")),
);
const manualArtifactOwnershipDoc = await Deno.readTextFile(
  join(repoRoot, manualArtifactOwnership),
);
await write(
  manualArtifactOwnership,
  replaceArtifactInventory(manualArtifactOwnershipDoc, inventory),
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
await write(
  "schema/discern-proof-note.schema.json",
  renderProofNoteJsonSchema(),
);
await write("types/discern-json.d.ts", renderResultTypesDts());
console.log("Regenerating frozen contract manifests from live registries:");
await write("schema/discern-mcp-tools.json", renderMcpToolsManifest());
await write("schema/discern-cli.json", renderCliManifest());
await write(
  "schema/discern-conventions.json",
  renderConventionsManifest(),
);
console.log(
  "Regenerating the public schema reference from PUBLIC_SCHEMA_PUBLICATIONS:",
);
const manualMcpReferenceDoc = await Deno.readTextFile(
  join(repoRoot, manualMcpReference),
);
await write(
  manualMcpReference,
  replacePublicSchemaReference(
    replaceExitStatusTable(manualMcpReferenceDoc),
    renderPublicSchemaReference(repositoryBlobUrl),
  ),
);
console.log("Regenerating the hosted CLA Assistant metadata:");
await write(CLA_ASSISTANT_METADATA_PATH, renderClaAssistantMetadata());
console.log("Embedding the first-party legal documents:");
const firstPartyLicenses = await generateFirstPartyLicenseBundle({ repoRoot });
await write(
  FIRST_PARTY_LICENSE_ARTIFACT_PATHS.bundle,
  renderFirstPartyLicenseBundleModule(firstPartyLicenses),
  sameFirstPartyLicenseBundlePayload,
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
