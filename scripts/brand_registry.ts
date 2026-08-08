/**
 * The Brand Operating System's document map as a canonical registry: every
 * brand document — generated and authored overlay alike — lives here as one
 * typed set, and the generated pages under `project/map/_internal/brand/`
 * compile from it through the codegen write chokepoint (following the
 * `cross_agent_registry.ts` idiom, ADR 0257).
 *
 * A generated row carries its module's renderer; an authored row is a
 * path-and-job declaration without content, so the registry still accounts
 * for the private overlay documents. Converting a document means flipping
 * its row from `authored` to `generated` and adding one data module under
 * `scripts/brand/` — nothing else restructures. Authored prose cites the
 * ledger with `{{claim:<slug>}}` tokens (and siblings `{{doc:…}}`,
 * `{{concept:…}}`); the barrel resolves them at render time, so a renamed
 * slug can never strand a reference.
 * `tests/brand_registry_codegen_test.ts` holds the committed pages to the
 * renderers, so a registry edit fails the gate until the pages regenerate.
 */

import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { DISCERN_MARK } from "../src/shared/brand.ts";
import {
  brandDocDir,
  brandDocHrefFromGenerated,
  type BrandDocument,
  type CitationContext,
  generatedBrandBanner,
  resolveCitationTokens,
} from "./brand/model.ts";
import {
  CONCEPT_MAP_HEADING,
  CONCEPTS,
  renderBridgeDoc,
} from "./brand/bridge.ts";
import { claimHeading, CLAIMS, renderClaimsDoc } from "./brand/claims.ts";
import { renderMessagingDoc } from "./brand/messaging.ts";
import { renderCopyPatternsDoc } from "./brand/patterns.ts";
import { renderCopyReviewDoc } from "./brand/docs/copy_review.ts";
import { renderPositioningDoc } from "./brand/docs/positioning.ts";
import { renderReadmeDoc } from "./brand/docs/readme.ts";
import { renderVisualIdentityDoc } from "./brand/docs/visual_identity.ts";

/** The banner every generated brand page carries as its first line. */
const BANNER = generatedBrandBanner(
  "BRAND_DOCUMENTS (scripts/brand_registry.ts)",
);

/** The brand document map: one row per document, in document-map order. */
export const BRAND_DOCUMENTS = [
  {
    id: "readme",
    file: "README.md",
    status: "Canonical",
    job:
      "Maps the Brand Operating System: purpose, the document map, reading paths, precedence, and source-of-truth boundaries.",
    mode: { kind: "generated", render: renderReadmeFromRegistry },
  },
  {
    id: "positioning",
    file: "positioning.md",
    status: "Canonical",
    job:
      "Defines why discern exists, who it serves, the market boundary, and the strategic choices that govern the brand.",
    mode: { kind: "generated", render: renderPositioningDoc },
  },
  {
    id: "audiences",
    file: "audiences.md",
    status: "Canonical",
    job:
      "Defines audience circumstances, desires, objections, knowledge levels, and message translations.",
    mode: { kind: "authored", privateOverlay: true },
  },
  {
    id: "messaging",
    file: "messaging.md",
    status: "Canonical",
    job:
      "Turns the positioning into message territories, descriptions, proof order, CTAs, and approved creative directions.",
    mode: { kind: "generated", render: renderMessagingDoc },
  },
  {
    id: "register-bridge",
    file: "register-bridge.md",
    status: "Canonical",
    job:
      "Prevents product ontology from directly dictating brand copy; maps product truth into human situations and benefits.",
    mode: { kind: "generated", render: renderBridgeDoc },
  },
  {
    id: "claims-and-evidence",
    file: "claims-and-evidence.md",
    status: "Canonical",
    job:
      "States the strongest defensible public claims, evidence, conditions, and forbidden inferences.",
    mode: { kind: "generated", render: renderClaimsDoc },
  },
  {
    id: "visual-identity",
    file: "visual-identity.md",
    status: "Canonical",
    job:
      `Records the visual system: the Editorial Engineering aesthetic, the ${DISCERN_MARK} mark, and the \`discern-design-system\` package.`,
    mode: { kind: "generated", render: renderVisualIdentityDoc },
  },
  {
    id: "voice-brand",
    file: "../../../skills/discern-brand-voice/SKILL.md",
    status: "Canonical skill",
    job: "Produces engaging, premium public-facing copy.",
    mode: { kind: "skill", register: "brand" },
  },
  {
    id: "voice-product",
    file: "../../../skills/discern-product-voice/SKILL.md",
    status: "Canonical skill",
    job: "Produces exact human-facing product and documentation copy.",
    mode: { kind: "skill", register: "product" },
  },
  {
    id: "voice-agent",
    file: "../../../skills/discern-agent-voice/SKILL.md",
    status: "Canonical skill",
    job: "Produces agent-operational and agent-facing public copy.",
    mode: { kind: "skill", register: "agent" },
  },
  {
    id: "copy-patterns",
    file: "copy-patterns.md",
    status: "Operational",
    job:
      "Reusable structures for pages, sections, proof blocks, audience explanations, and CTAs.",
    mode: { kind: "generated", render: renderCopyPatternsDoc },
  },
  {
    id: "website-brief",
    file: "website-brief.md",
    status: "Operational",
    job:
      "Defines the public-site narrative, page responsibilities, proof, objections, and calls to action.",
    mode: { kind: "authored", privateOverlay: true },
  },
  {
    id: "launch-narrative",
    file: "launch-narrative.md",
    status: "Operational",
    job:
      "Preserves the founder story and cultural thesis for essays, interviews, demos, and launch material.",
    mode: { kind: "authored", privateOverlay: true },
  },
  {
    id: "for-agents-brief",
    file: "for-agents-brief.md",
    status: "Operational",
    job:
      "Defines the dedicated For Agents page, `llms.txt`, and the creative “marketing to the machines” program.",
    mode: { kind: "authored", privateOverlay: true },
  },
  {
    id: "claims-residue",
    file: "claims-residue.md",
    status: "Operational",
    job:
      "Receives the private residue carved out of `claims-and-evidence.md`: the dated internal evidence snapshot, the anecdote ledger, and the claims requiring future validation.",
    mode: { kind: "authored", privateOverlay: true },
  },
  {
    id: "copy-review",
    file: "copy-review.md",
    status: "Governance",
    job:
      "Reviews drafts for strategy, truth, register fit, distinctiveness, and contemporary AI-copy smells.",
    mode: { kind: "generated", render: renderCopyReviewDoc },
  },
  {
    id: "decisions",
    file: "decisions.md",
    status: "Governance",
    job:
      "Holds the effort's brand ADRs in working form until they are numbered and published into the ADR tree.",
    mode: { kind: "authored", privateOverlay: false },
  },
] as const satisfies readonly BrandDocument[];

/**
 * Render the README from the live registry rows. A hoisted declaration with
 * an explicit signature rather than an inline closure: citing the registry
 * inside its own initializer would otherwise make the type inference cycle.
 * The body only runs at render time, when the rows are fully initialized.
 */
function renderReadmeFromRegistry(): string {
  return renderReadmeDoc(BRAND_DOCUMENTS);
}

export type BrandDocumentId = (typeof BRAND_DOCUMENTS)[number]["id"];

type BrandDocumentRow = (typeof BRAND_DOCUMENTS)[number];

/** Look a document up by id, or throw — ids are a closed set. */
function documentById(id: BrandDocumentId): BrandDocumentRow {
  const doc = BRAND_DOCUMENTS.find((candidate) => candidate.id === id);
  if (doc === undefined) {
    throw new Error(`no brand document is registered as ${id}`);
  }
  return doc;
}

/** The rows whose pages compile from the registry today. */
export function generatedBrandDocuments(): readonly BrandDocumentRow[] {
  return BRAND_DOCUMENTS.filter(
    (doc: BrandDocument) => doc.mode.kind === "generated",
  );
}

/** A document's path relative to the configured map directory: generated
 * pages under the public `_internal` tree, authored documents under the
 * `_private` overlay tree. */
export function brandDocMapRel(doc: BrandDocument): string {
  return `${brandDocDir(doc)}/${doc.file}`;
}

/**
 * The anchor id the shared renderer mints for a heading, so citation links
 * hold to the same algorithm the map's link-integrity guard validates.
 */
function headingAnchor(heading: string): string {
  const { headings } = renderMarkdownHtml(`### ${heading}`);
  const id = headings[0]?.id;
  if (id === undefined) {
    throw new Error(`heading renders to no anchor: ${heading}`);
  }
  return id;
}

/** Live replacement tables for every citation-token kind. */
function citationContext(): CitationContext {
  const claimsFile = documentById("claims-and-evidence").file;
  const claims = new Map(
    Object.entries(CLAIMS).map(([slug, claim]) => [
      slug,
      `[\`${slug}\`](${claimsFile}#${
        headingAnchor(claimHeading(slug, claim.title))
      })`,
    ]),
  );
  const docs = new Map(
    BRAND_DOCUMENTS.map((doc) => [
      doc.id,
      `[\`${doc.file}\`](${brandDocHrefFromGenerated(doc)})`,
    ]),
  );
  const bridgeFile = documentById("register-bridge").file;
  const conceptAnchor = headingAnchor(CONCEPT_MAP_HEADING);
  const concepts = new Map(
    CONCEPTS.map((concept) => [
      concept.id,
      `[${concept.name}](${bridgeFile}#${conceptAnchor})`,
    ]),
  );
  return { claims, docs, concepts };
}

/** Resolve citation tokens against the live registry tables. */
export function resolveBrandCitations(markdown: string): string {
  return resolveCitationTokens(markdown, citationContext());
}

/**
 * Render one generated document, banner stamped and citation tokens
 * resolved — the exact bytes the codegen write chokepoint canonicalizes.
 * Authored rows have no content here and throw.
 */
export function renderBrandDoc(id: BrandDocumentId): string {
  const doc: BrandDocument = documentById(id);
  if (doc.mode.kind !== "generated") {
    throw new Error(
      `${id} is an authored brand document — there is nothing to render`,
    );
  }
  return [
    BANNER,
    "",
    resolveBrandCitations(doc.mode.render()),
    "",
  ].join("\n");
}
