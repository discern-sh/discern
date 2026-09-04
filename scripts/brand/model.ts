/**
 * Shared types for the brand registry (`scripts/brand/`): the typed model
 * behind the Brand Operating System's documents, following the
 * canonical-registry idiom of `scripts/cross_agent_registry.ts` (ADR 0257).
 * Data modules declare their sets `as const satisfies` these shapes, derive
 * id unions for compile-time referential integrity, and keep long-form prose
 * as authored Markdown `body` fields — structure where structure exists, no
 * shredding paragraphs into fake fields. The barrel
 * (`scripts/brand_registry.ts`) owns the document map and resolves the
 * citation tokens defined here at render time.
 */

/** The three communication registers the Brand Operating System separates,
 * in document-map order — the axis `VOICES` and the generated skills key on. */
export const REGISTERS = ["brand", "product", "agent"] as const;

export type Register = (typeof REGISTERS)[number];

/** The claims ledger's evidence vocabulary, strongest class first. */
export const EVIDENCE_CLASS_NAMES = [
  "structural",
  "demonstrated",
  "corroborated",
  "observational",
  "anecdotal",
  "hypothesis",
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASS_NAMES)[number];

/**
 * How one inspectable source backs a claim or a boundary: a recorded
 * `decision`, an executable `guard` that fails when the fact regresses, or
 * the `source` that implements it.
 */
export const EVIDENCE_SOURCE_KINDS = ["decision", "guard", "source"] as const;

export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

/**
 * One inspectable source behind a claim or a boundary. A `guard` names a
 * test module that cites the claim slug or boundary id it holds, so the
 * registry and the test point at each other.
 */
export interface EvidenceSource {
  readonly kind: EvidenceSourceKind;
  readonly path: string;
  readonly summary: string;
}

/** The display label for one evidence-source kind. */
export function evidenceSourceLabel(kind: EvidenceSourceKind): string {
  switch (kind) {
    case "decision":
      return "Decision";
    case "guard":
      return "Guard";
    case "source":
      return "Source";
  }
}

/** Whose outcome a public claim primarily describes. */
export const CLAIM_AUDIENCES = ["human", "coding-agent", "shared"] as const;

export type ClaimAudience = (typeof CLAIM_AUDIENCES)[number];

/** What one evidence class means and how it may be used publicly. */
export interface EvidenceClassDefinition {
  readonly meaning: string;
  readonly publicUse: string;
}

/**
 * One entry of the public claims ledger. Fields render as the ledger's
 * labelled bullets, in declaration order; the rare per-claim annotations
 * (`evidenceNote`, `tacticalUse`, `wordingCorrection`) sit between the
 * forbidden inference and the primary source.
 */
export interface Claim {
  /** The claim statement, rendered beside the slug in the ledger heading. */
  readonly title: string;
  /** The audience whose benefit account must carry this claim. */
  readonly audience: ClaimAudience;
  readonly evidence: readonly EvidenceClass[];
  /** The strongest supported public wording (rendered inside “” quotes). */
  readonly strongestPublicForm: string;
  readonly mechanism?: string;
  readonly conditions?: string;
  readonly forbiddenInference: string;
  readonly evidenceNote?: string;
  readonly tacticalUse?: string;
  readonly wordingCorrection?: string;
  readonly primarySource: string;
}

/** One message territory of the canonical hierarchy; the body stays prose. */
export interface Territory {
  readonly id: string;
  readonly title: string;
  /** Verbatim section Markdown (candidate lines, usage notes, cautions). */
  readonly body: string;
}

/**
 * One message pillar. `claims` cites the ledger — typed non-empty, so a
 * pillar with no reason to believe cannot compile; the slugs are metadata
 * for provenance and never render into the document.
 */
export interface Pillar<Slug extends string = string> {
  readonly id: string;
  readonly title: string;
  readonly humanTruth: string;
  readonly promise: string;
  readonly goodExpressions: readonly string[];
  /** Instructions rendered between the expressions and the avoid list. */
  readonly note?: string;
  readonly avoid?: readonly string[];
  readonly claims: readonly [Slug, ...Slug[]];
}

/** One row of the contextual headline inventory. */
export interface Headline {
  readonly line: string;
  readonly bestUse: string;
  readonly caution: string;
}

/**
 * One row of the positioning grid: the status quo a message pushes against
 * and discern's answer, both copy-ready. `claims` cites the ledger — typed
 * non-empty, so a contrast without a defensible reason to believe cannot
 * compile; the slugs are provenance metadata and never render.
 */
export interface PositioningContrast<Slug extends string = string> {
  readonly id: string;
  /** The default the reader already lives with. */
  readonly against: string;
  /** discern's answer, in copy-ready form. */
  readonly instead: string;
  readonly claims: readonly [Slug, ...Slug[]];
}

/**
 * One copy-ready fact line: a concrete, ledger-backed sentence a page can
 * carry verbatim. `claim` cites the ledger entry whose strongest supported
 * form bounds the wording; the rendered line links to it.
 */
export interface FactLine<Slug extends string = string> {
  readonly id: string;
  /** The line, exactly as a page may carry it. */
  readonly line: string;
  readonly claim: Slug;
  /** Optional usage note rendered after the line. */
  readonly note?: string;
}

/** One named group of the CTA system. */
export interface CtaBank {
  readonly id: string;
  readonly title: string;
  readonly ctas: readonly string[];
}

/** Which section of the messaging document a description belongs to. */
export type DescriptionGroup = "length" | "audience";

/** One approved description; the body keeps its authored Markdown form. */
export interface Description {
  readonly id: string;
  readonly group: DescriptionGroup;
  readonly heading: string;
  readonly body: string;
}

/** One candidate hero system — a testable homepage arrangement. */
export interface HeroSystem {
  readonly id: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly headline: string;
  readonly sub: string;
  readonly primaryCta: string;
  readonly secondaryCta: string;
  readonly signature?: string;
}

/**
 * One row of the register bridge's core concept map. The fields are the
 * table's columns: `productRole` is “Exact product role”, `plainFirstUse` is
 * “Plain-language first use”, `prominence` is “Use prominently?”, and
 * `doNotImply` is “Do not imply”.
 */
export interface Concept {
  readonly id: string;
  /** The display name, bolded in the table's first column. */
  readonly name: string;
  readonly productRole: string;
  readonly humanSituation: string;
  readonly brandInterpretation: string;
  readonly plainFirstUse: string;
  readonly prominence: string;
  readonly doNotImply: string;
}

/** One product-to-brand translation worked example. */
export interface Translation {
  readonly id: string;
  readonly title: string;
  readonly productTruth: string;
  readonly weakLiteralTranslation: string;
  readonly betterHumanTranslations: readonly string[];
  /** Rendered as the “Where the product noun enters” blockquote. */
  readonly productNounEntry?: string;
}

/** One titled trailing section of a copy pattern, body verbatim. */
export interface PatternSection {
  readonly heading: string;
  /** Verbatim section Markdown (examples, bullets, follow-on prose). */
  readonly body: string;
}

/**
 * One reusable copy pattern. The optional fields mirror the document's own
 * variability: a pattern may lack a “Use when”, carry prose directly after
 * its structure block, or close with a “Requirements” list.
 */
export interface CopyPattern {
  readonly id: string;
  /** The name after the number in the pattern's heading. */
  readonly title: string;
  /** Markdown body of “Use when” (bullets or a sentence). */
  readonly useWhen?: string;
  /** The fenced structure block's contents, byte-exact. */
  readonly structure: string;
  /** The structure fence's language when it is not `markdown`. */
  readonly structureLang?: "text";
  /** Prose directly after the structure block, before any titled section. */
  readonly structureNote?: string;
  /** Titled sections between the structure and any requirements. */
  readonly sections?: readonly PatternSection[];
  /** The closing “Requirements” bullets. */
  readonly requirements?: readonly string[];
}

/** One numbered principle of a voice register's principle section. Its
 * rendered number is its position in the section, so the sequence can never
 * skip or repeat. */
export interface VoicePrinciple {
  readonly id: string;
  /** The title after the number in the principle's heading. */
  readonly title: string;
  /** Verbatim principle Markdown under the numbered heading. */
  readonly body: string;
}

/**
 * One item of a structured voice rule list — a cadence rule, an
 * anti-pattern, a mechanics rule. `phrases` carries the mechanically
 * bannable wordings a prose lint can hold pattern-for-pattern; an entry
 * without phrases is a judgment rule no token list can encode.
 */
export interface VoiceRule {
  readonly id: string;
  /** The list item exactly as the document renders it. */
  readonly text: string;
  readonly phrases?: readonly string[];
}

/**
 * One banned-words table row. `registers` names the skills the row renders
 * into, so one entry serves every register that bans it; `phrases` is the
 * mechanically bannable subset the Vale parity guard holds to the style.
 */
export interface BannedWord {
  readonly id: string;
  /** The table's “Avoid” cell. */
  readonly avoid: string;
  /** The table's “Why” cell. */
  readonly why: string;
  /** The table's “Instead” cell. */
  readonly instead: string;
  readonly phrases?: readonly string[];
  readonly registers: readonly [Register, ...Register[]];
}

/** One banned move: a named machine-tell pattern with its definitive rule. */
export interface BannedMove {
  readonly id: string;
  /** The move's bold lead-in name. */
  readonly name: string;
  /** The definitive rule, verbatim Markdown after the name. */
  readonly text: string;
  readonly phrases?: readonly string[];
}

/** One intro-plus-checklist group of a voice criteria section. */
export interface VoiceCriteriaGroup {
  /** The single line introducing the checklist. */
  readonly intro: string;
  /** The checklist items, verbatim, punctuation included. */
  readonly items: readonly string[];
}

/**
 * One section of a voice document, in document order. Structure follows the
 * signed-off documents: rule lists, numbered principles, and acceptance
 * checklists are typed data (the entries later Vale generation reads);
 * everything else stays verbatim authored Markdown. The `banned-words`,
 * `banned-moves`, and `mechanics` kinds render from the shared canon sets,
 * so the registers sharing a rule can never drift apart on it.
 */
export type VoiceSection =
  | {
    readonly kind: "prose";
    readonly heading: string;
    readonly body: string;
  }
  | {
    readonly kind: "principles";
    readonly heading: string;
    readonly items: readonly VoicePrinciple[];
  }
  | {
    readonly kind: "rules";
    readonly id: string;
    readonly heading: string;
    /** Markdown between the heading and the rule list. */
    readonly intro?: string;
    readonly items: readonly VoiceRule[];
    /** Markdown after the rule list, to the section's end. */
    readonly outro?: string;
  }
  | {
    readonly kind: "criteria";
    readonly heading: string;
    readonly groups: readonly VoiceCriteriaGroup[];
  }
  | {
    readonly kind: "banned-words";
    readonly heading: string;
    readonly intro: string;
  }
  | {
    readonly kind: "banned-moves";
    readonly heading: string;
    readonly intro: string;
  }
  | {
    readonly kind: "mechanics";
    readonly heading: string;
  };

/** One register's complete voice definition: the skill identity fields and
 * the document's sections in rendering order. */
export interface VoiceDefinition {
  /** The skill frontmatter description, verbatim. */
  readonly description: string;
  /** The document's H1 title. */
  readonly title: string;
  readonly sections: readonly VoiceSection[];
}

/** The document-map statuses the brand README table shows. */
export type BrandDocumentStatus =
  | "Canonical"
  | "Canonical skill"
  | "Operational"
  | "Governance";

/**
 * How a brand document is produced today. Conversion flips a row from
 * `authored` to `generated` without restructuring the registry; overlay
 * documents stay authored path-and-job rows without content. A `skill` row
 * is generated too, but by the voice-skill codegen loop into the configured
 * skills directory — the row is the document map's account of it.
 */
export type BrandDocumentMode =
  | {
    readonly kind: "generated";
    /** Render the document body; citation tokens are still unresolved. */
    readonly render: () => string;
  }
  | {
    readonly kind: "authored";
    /** True for documents that stay private overlay files at launch. */
    readonly privateOverlay: boolean;
  }
  | {
    readonly kind: "skill";
    /** The register whose generated skill this row accounts for. */
    readonly register: Register;
  };

/** One row of the brand document map. */
export interface BrandDocument {
  readonly id: string;
  /** Path relative to the brand directory (e.g. `positioning.md`; a skill
   * row traverses out to the configured skills directory). */
  readonly file: string;
  readonly status: BrandDocumentStatus;
  /** The document's job, as the document map states it. */
  readonly job: string;
  readonly mode: BrandDocumentMode;
}

/**
 * Where the generated brand pages live, relative to the configured map
 * directory: public repository content, Vale-scanned under its own
 * `.vale.ini` tier.
 */
export const BRAND_GENERATED_DIR = "_internal/brand";

/**
 * Where the authored brand documents live, relative to the configured map
 * directory: the tree the launch scrub turns into a local, gitignored
 * private overlay.
 */
export const BRAND_OVERLAY_DIR = "_private/brand";

/** A document's directory relative to the configured map directory. Authored
 * rows sit in the overlay tree; generated and skill rows are accounted from
 * the generated tree (a skill row's `file` traverses out of the map). */
export function brandDocDir(doc: BrandDocument): string {
  return doc.mode.kind === "authored" ? BRAND_OVERLAY_DIR : BRAND_GENERATED_DIR;
}

/**
 * The href a generated page uses to reach `doc`. Generated and skill rows
 * resolve from the generated directory itself; an authored row's href
 * crosses the tier boundary into the overlay tree — dangling on a checkout
 * without the overlay, which the document map's overlay marker explains.
 */
export function brandDocHrefFromGenerated(doc: BrandDocument): string {
  return doc.mode.kind === "authored"
    ? `../../${BRAND_OVERLAY_DIR}/${doc.file}`
    : doc.file;
}

/** The banner every generated brand artifact carries, naming its source. */
export function generatedBrandBanner(source: string): string {
  return `<!-- GENERATED by \`deno task codegen\` from ${source} — do NOT edit by hand. Change the brand registry (scripts/brand/) and regenerate. -->`;
}

/** Replacement text per citable id, one table per citation-token kind. */
export interface CitationContext {
  readonly claims: ReadonlyMap<string, string>;
  readonly docs: ReadonlyMap<string, string>;
  readonly concepts: ReadonlyMap<string, string>;
}

/**
 * Resolve `{{claim:<slug>}}`, `{{doc:<id>}}`, and `{{concept:<id>}}` citation
 * tokens against the context. Total by construction: an unknown id throws,
 * and so does any token-shaped text the well-formed pattern cannot resolve —
 * a rename can never strand a reference in rendered output.
 */
export function resolveCitationTokens(
  markdown: string,
  context: CitationContext,
): string {
  const resolved = markdown.replace(
    /\{\{(claim|doc|concept):([a-z0-9-]+)\}\}/g,
    (token, kind: string, id: string) => {
      const table = kind === "claim"
        ? context.claims
        : kind === "doc"
        ? context.docs
        : context.concepts;
      const replacement = table.get(id);
      if (replacement === undefined) {
        throw new Error(`${token} cites no known ${kind}`);
      }
      return replacement;
    },
  );
  const leftover = resolved.match(/\{\{(?:claim|doc|concept):[^}]*\}\}/);
  if (leftover !== null) {
    throw new Error(`unresolvable citation token: ${leftover[0]}`);
  }
  return resolved;
}
