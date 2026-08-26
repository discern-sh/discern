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
 * its generator output, so forgetting to regenerate fails the gate. The
 * `[generated.codegen]` group in discern.toml reruns this script in the gate's
 * build stage and fails on drift too (ADR 0247) — the two guards are
 * deliberately redundant; keep both.
 */

import { dirname, fromFileUrl, join, relative } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import {
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
  renderConfigSchemaJson,
} from "../src/shared/config_codegen.ts";
import { renderCliReferenceDoc } from "../src/shared/cli_reference_codegen.ts";
import { renderHintInventoryDoc } from "../src/shared/hint_inventory_codegen.ts";
import { renderTipInventoryDoc } from "../src/shared/tip_inventory_codegen.ts";
import { renderCrossAgentReferenceDoc } from "./cross_agent_registry.ts";
import { renderAgentIntegrationCoverageDoc } from "./agent_integration_registry.ts";
import {
  ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL,
  renderEnvironmentVariableReferenceDoc,
} from "./environment_variable_reference.ts";
import { renderGlossaryDoc } from "./glossary_registry.ts";
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
import {
  generateThirdPartyArtifacts,
  sameThirdPartyBundlePayload,
  THIRD_PARTY_ARTIFACT_PATHS,
} from "../src/shared/third_party_codegen.ts";
import {
  FIRST_PARTY_LICENSE_ARTIFACT_PATHS,
  generateFirstPartyLicenseBundle,
  renderFirstPartyLicenseBundleModule,
  sameFirstPartyLicenseBundlePayload,
} from "../src/shared/first_party_license_codegen.ts";
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
const environmentVariableReference = relative(
  repoRoot,
  join(mapDir, ENVIRONMENT_VARIABLE_REFERENCE_PAGE_REL),
);
const mcpReference = relative(
  repoRoot,
  join(mapDir, "70-reference", "mcp-and-results.md"),
);
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
const artifactOwnership = relative(
  repoRoot,
  join(mapDir, "70-reference", "artifact-ownership.md"),
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
await write("schema/discern-config.schema.json", renderConfigSchemaJson());
await write(
  "schema/discern-setup-config.schema.json",
  renderConfigDocSchemaJson(),
);
await write(configReference, renderConfigReferenceDoc());
console.log("Regenerating the CLI reference from the live command registry:");
await write(cliReference, renderCliReferenceDoc(buildCli(false)));
console.log(
  "Regenerating the environment-variable reference from its definitions:",
);
await write(
  environmentVariableReference,
  renderEnvironmentVariableReferenceDoc(),
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
    join(repoRoot, "templates/setup/skeleton/docs/_adr", name),
  );
await write(
  "templates/skills/discern-write-adr/skeleton/docs/_adr/0000-template.md",
  await adrSkeletonFile("0000-template.md"),
);
await write(
  "templates/skills/discern-write-adr/skeleton/docs/_adr/0001-adopt-discern.md",
  await adrSkeletonFile("0001-adopt-discern.md"),
);
await write(
  "templates/skills/discern-write-adr/skeleton/docs/_adr/README.md",
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
await write(glossary, renderGlossaryDoc());
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
await write(
  "schema/discern-proof-note.schema.json",
  renderProofNoteJsonSchema(),
);
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
