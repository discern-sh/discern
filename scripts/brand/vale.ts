/**
 * The per-register Vale styles as registry data: every mechanical prose
 * check the voice registry supports, declared once here and compiled into
 * one generated style directory per register (`.vale/DiscernBrand/`,
 * `.vale/DiscernProduct/`, `.vale/DiscernAgent/`) through the codegen write
 * chokepoint. `.vale.ini` scopes each style to its tier: the brand style
 * scans `_internal/brand/`, so it switches on when the brand pages promote
 * out of `_private`; the product and agent styles join the map-wide scan
 * beside the authored house style (`.vale/Discern/`), which keeps the
 * shared banned canon — these styles add only what it does not cover.
 *
 * Every rule cites its registry sources (a banned word or move, a voice
 * rule or principle, a proposed mechanical check from the copy review), and
 * `resolveValeSource` throws on any id the registry does not declare — a
 * rename can never strand a rule. The copy review's proposed checks that no
 * rule implements each carry a recorded disposition in `VALE_DISPOSITIONS`;
 * `tests/brand_vale_codegen_test.ts` holds the partition exact, so "to the
 * extent practical" stays an audited boundary.
 */

import { markdownCodeSpan } from "../../src/shared/markdown_code.ts";
import {
  type BannedMove,
  type BannedWord,
  type Register,
  REGISTERS,
  type VoicePrinciple,
  type VoiceRule,
} from "./model.ts";
import { BANNED_MOVES, BANNED_WORDS, VOICES } from "./voice.ts";
import { PROPOSED_MECHANICAL_CHECKS } from "./mechanical_checks.ts";

/** Severity policy: `error` only for a rule with no legitimate exception;
 * `warning` and `suggestion` where judgment is real. */
export type ValeSeverity = "suggestion" | "warning" | "error";

type BannedWordId = (typeof BANNED_WORDS)[number]["id"];
type BannedMoveId = (typeof BANNED_MOVES)[number]["id"];

/** A register-and-id pair naming one proposed mechanical check, typed so an
 * entry can only cite a check its register actually proposes. */
export type ProposedCheckRef = {
  [R in Register]: {
    readonly kind: "proposed-check";
    readonly register: R;
    readonly check: (typeof PROPOSED_MECHANICAL_CHECKS)[R][number]["id"];
  };
}[Register];

/** Where a Vale rule's content comes from in the voice registry. */
export type ValeRuleSource =
  | { readonly kind: "banned-word"; readonly word: BannedWordId }
  | { readonly kind: "banned-move"; readonly move: BannedMoveId }
  | {
    readonly kind: "voice-rule";
    readonly register: Register;
    readonly section: string;
    readonly item: string;
  }
  | {
    readonly kind: "voice-principle";
    readonly register: Register;
    readonly principle: string;
  }
  | ProposedCheckRef;

/** The Vale extension points the renderer knows how to emit. */
export type ValeCheck =
  | {
    readonly extends: "existence";
    /** Patterns Vale wraps in word boundaries (unless `nonword`). */
    readonly tokens?: readonly string[];
    /** Self-delimiting patterns used exactly as written. */
    readonly raw?: readonly string[];
    readonly ignorecase?: true;
    readonly nonword?: true;
    readonly scope?: string;
  }
  | {
    readonly extends: "occurrence";
    readonly token: string;
    readonly max: number;
    readonly scope: string;
  };

/** A real-Vale proving pair plus the semantic boundary that remains after
 * the detector runs. A future rule cannot enter the registry without both. */
export interface ValeBehaviorContract {
  readonly bad: string;
  readonly safe: string;
  readonly residual: string;
}

/** One generated Vale rule: a `<StyleName>/<id>.yml` artifact. */
export interface ValeStyleRule {
  /** The rule's file and check name (PascalCase, e.g. `GenericVerbs`). */
  readonly id: string;
  readonly register: Register;
  /** The rule-file header comment: what it catches and the severity call. */
  readonly comment: string;
  readonly message: string;
  readonly level: ValeSeverity;
  readonly sources: readonly [ValeRuleSource, ...ValeRuleSource[]];
  readonly contract: ValeBehaviorContract;
  readonly check: ValeCheck;
}

/**
 * The generated rule set, in rendering order. The authored house style
 * already blocks the shared banned canon map-wide (hype vocabulary,
 * contrast-frames, scene-setting, self-narration, and the rest), so a rule
 * appears here only when it adds enforcement the house style does not
 * carry; each comment names any sibling coverage.
 */
export const VALE_STYLE_RULES = [
  // ── brand: scans _internal/brand/ (active once the pages promote) ──
  {
    id: "ProductName",
    register: "brand",
    comment:
      "The product name is written lower-case in every position, including at the start of a sentence — recast the line rather than capitalizing it. Zero legitimate exceptions in the canon, so it blocks the gate; compound code identifiers (style and type names) keep their own word boundaries, and code spans are never linted.",
    message:
      "The product name is always lower-case 'discern': recast the sentence rather than capitalizing the name.",
    level: "error",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "write-the-product-name-as-discern",
      },
    ],
    contract: {
      bad: "Discern checks the tree.",
      safe: "The literal `Discern` names a generated style prefix.",
      residual: "None: brand canon permits no capitalized product name.",
    },
    check: { extends: "existence", tokens: ["Discern"] },
  },
  {
    id: "GenericVerbs",
    register: "brand",
    comment:
      "Generic transformation verbs with no concrete content. The house style already blocks 'unlock' and 'empower' map-wide at error severity; this rule adds the proposal's remaining pair. Warning severity: 'transform' can name a real operation, so the writer judges.",
    message: "'%s' is a generic verb: name the concrete change instead.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "generic-verbs" },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "unlock-empower-reimagine-and-seamless",
      },
    ],
    contract: {
      bad: "The workflow will transform the project.",
      safe: "The literal `transform` appears as a counter-example.",
      residual:
        "The listed forms are enforced; whether transform names a real operation remains editorial.",
    },
    check: {
      extends: "existence",
      tokens: ["transform(?:s|ed|ing)?", "reimagin(?:e[sd]?|ing)"],
      ignorecase: true,
    },
  },
  {
    id: "GenericAdjectives",
    register: "brand",
    comment:
      "Adjectives that dodge 'compared to what?'. The house style already blocks 'seamless', 'robust', and 'powerful' map-wide at error severity; this rule adds the proposal's remaining forms. Warning severity: the fix is showing the mechanism, which is the writer's call.",
    message:
      "'%s' dodges 'compared to what?': show the mechanism or artifact that earned it.",
    level: "warning",
    sources: [
      {
        kind: "proposed-check",
        register: "brand",
        check: "unsupported-adjectives",
      },
      {
        kind: "voice-principle",
        register: "brand",
        principle: "make-confidence-feel-earned",
      },
    ],
    contract: {
      bad: "The project has enterprise-grade checks.",
      safe: "The literal `enterprise-grade` appears as a counter-example.",
      residual:
        "The listed forms are enforced; whether a claim has enough support remains editorial.",
    },
    check: {
      extends: "existence",
      tokens: ["enterprise[-\\s]grade", "transformative(?:ly)?"],
      ignorecase: true,
    },
  },
  {
    id: "TemplateOpener",
    register: "brand",
    comment:
      "Model-copy opening templates. The house style already blocks 'in a world where' map-wide at error severity; this rule adds the registers' other named templates. Warning severity: the brand pages legitimately quote these templates when teaching against them.",
    message: "Model-copy template ('%s'): make the claim directly.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "this-isnt-just-openings",
      },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "the-future-of-claims",
      },
    ],
    contract: {
      bad: "This isn't just a check.",
      safe: "The literal `This isn't just` appears as a counter-example.",
      residual:
        "The named templates are enforced; novel model-copy openings remain editorial.",
    },
    check: {
      extends: "existence",
      tokens: [
        "this\\s+is(?:n(?:'|’)t|\\s+not)\\s+just",
        "the\\s+future\\s+of",
      ],
      ignorecase: true,
    },
  },
  {
    id: "CtaGenericLabel",
    register: "brand",
    comment:
      "A call to action whose whole label is a generic verb tells the reader nothing about the destination. Matches the raw link syntax (raw scope: rendered text loses the markup), so only a label that IS the whole CTA fires. Warning severity: a secondary link may earn a short label.",
    message:
      "Generic CTA label ('%s'): name the destination or commitment instead.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "cta-generic-label" },
    ],
    contract: {
      bad: "[Learn more](https://example.com)",
      safe: "Learn more before editing the registry.",
      residual:
        "The complete-link labels are enforced; whether a short secondary label is useful remains editorial.",
    },
    check: {
      extends: "existence",
      raw: ["\\[(?:Learn\\s+more|Explore|Discover)\\]\\("],
      ignorecase: true,
      scope: "raw",
    },
  },
  {
    id: "RepeatedContrast",
    register: "brand",
    comment:
      "The house style warns on each contrast-frame; this rule adds the proposal's page-level budget — more than one on a page is a template, whatever each instance earns. Warning severity: the budget is editorial.",
    message:
      "More than one contrast-frame on this page: keep at most one, and only where the distinction does real work.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "brand", check: "repeated-contrast" },
      {
        kind: "voice-rule",
        register: "brand",
        section: "banned-moves",
        item: "constant-x-not-y-constructions",
      },
    ],
    contract: {
      bad: "Use evidence, not slogans. Keep facts, not theater.",
      safe: "Use evidence, not slogans.",
      residual:
        "The page budget is enforced; whether one retained contrast earns its place remains editorial.",
    },
    check: {
      extends: "occurrence",
      token:
        "(?i)(?:not\\s+[^.?!;:—]{1,45},\\s+but|isn(?:'|’)t\\s+[^.?!;:—]{1,45}[,;]\\s+it(?:'|’)s|,\\s+(?:not|never)\\s+[^.?!;:—]{1,45}[.?!:;])",
      max: 1,
      scope: "text",
    },
  },
  {
    id: "StackedSlogans",
    register: "brand",
    comment:
      "Three consecutive slogan-length sentences read as stacked aphorisms. Suggestion severity: spec fragments listing facts are legal, so this prompts a look rather than asserting a defect.",
    message:
      "Three consecutive slogan-length sentences: let one line land and give it support.",
    level: "suggestion",
    sources: [
      {
        kind: "voice-principle",
        register: "brand",
        principle: "write-for-the-page-not-for-a-slogan-collection",
      },
    ],
    contract: {
      bad: "Proof stays. Work moves. State holds.",
      safe: "Proof stays while the branch remains ready for review.",
      residual:
        "The named three-sentence cadence is enforced; other slogan-like rhythm remains editorial.",
    },
    check: {
      extends: "existence",
      tokens: [
        "(?:\\b[\\w’-]+(?:\\s+[\\w’-]+){0,3}[.!?]\\s+){2}\\b[\\w’-]+(?:\\s+[\\w’-]+){0,3}[.!?]",
      ],
      nonword: true,
      scope: "paragraph",
    },
  },
  // ── product: joins the map-wide scan beside the house style ──
  {
    id: "ProductName",
    register: "product",
    comment:
      "The product name is lower-case on human-facing product surfaces. The prose gate holds this warning at zero on every maintained page where the product register applies. Brand pages enforce their sibling rule; ADRs retain reduced styling. Compound code identifiers keep their own word boundaries, and code spans are never linted.",
    message:
      "The product name is lower-case 'discern': recast the sentence rather than capitalizing the name.",
    level: "warning",
    sources: [
      {
        kind: "proposed-check",
        register: "product",
        check: "canonical-glossary-terms",
      },
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "write-the-product-name-as-discern",
      },
    ],
    contract: {
      bad: "Discern checks the tree.",
      safe: "The literal `Discern` names a generated style prefix.",
      residual:
        "Coverage is product-name casing only; context-sensitive glossary term choice remains editorial.",
    },
    check: { extends: "existence", tokens: ["Discern"] },
  },
  {
    id: "AgentBlame",
    register: "product",
    comment:
      "Product surfaces describe the object's state, never a worker's character: name the branch, tree, or command, not what the agent supposedly is. Warning severity: an analytical page may describe recorded behavior, so the writer judges the verdict.",
    message:
      "Agent-blame vocabulary ('%s'): describe the object's state, not the worker's character.",
    level: "warning",
    sources: [
      { kind: "proposed-check", register: "product", check: "agent-blame" },
      {
        kind: "voice-principle",
        register: "product",
        principle: "name-the-object-in-the-state",
      },
      {
        kind: "voice-rule",
        register: "product",
        section: "anti-patterns",
        item: "blames-or-praises-an-agents-character",
      },
    ],
    contract: {
      bad: "The agent forgot the update.",
      safe: "The branch is behind main.",
      residual:
        "The named character verdicts are enforced; analysis of recorded behavior remains editorial.",
    },
    check: {
      extends: "existence",
      tokens: [
        "the\\s+agent\\s+(?:forgot|neglected|didn(?:'|’)t\\s+bother)",
        "(?:careless|lazy|stupid|dumb|incompetent|untrustworthy|unreliable)\\s+agents?",
        "agents?\\s+(?:is|are|was|were)\\s+(?:careless|lazy|stupid|dumb|incompetent|untrustworthy|unreliable)",
        "blames?\\s+the\\s+agent",
      ],
      ignorecase: true,
    },
  },
  // ── agent: joins the map-wide scan beside the house style ──
  {
    id: "BestJudgment",
    register: "agent",
    comment:
      "Deferring to an agent's judgment where a real boundary can be stated leaves the boundary unstated. Warning severity by the rule's own qualifier: where no boundary can be stated, the phrase is legitimate.",
    message: "'%s': state the real boundary instead, where one can be stated.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "do-not-say-use-your-best-judgment",
      },
    ],
    contract: {
      bad: "Use your best judgment.",
      safe: "Stop when landing authority is absent.",
      residual:
        "The stock phrase is enforced; whether a real boundary can be stated remains editorial.",
    },
    check: {
      extends: "existence",
      tokens: ["use\\s+your\\s+(?:best\\s+|own\\s+)?judg(?:e)?ment"],
      ignorecase: true,
    },
  },
  {
    id: "PositionalReference",
    register: "agent",
    comment:
      "A positional reference breaks the moment context is compressed or reordered; a stable target (a path, heading, or anchor) survives. Warning severity: prose about a directly preceding block can occasionally earn it.",
    message:
      "Positional reference ('%s'): point at a stable target (a path, heading, or anchor) instead.",
    level: "warning",
    sources: [
      {
        kind: "voice-rule",
        register: "agent",
        section: "language-rules",
        item: "prefer-stable-targets-over-positional-references",
      },
    ],
    contract: {
      bad: "See above for the command.",
      safe: "See `project/map/README.md` for the command.",
      residual:
        "The named positional forms are enforced; a directly preceding reference may still be clear.",
    },
    check: {
      extends: "existence",
      tokens: [
        "(?:as\\s+)?(?:mentioned|noted|shown|described|listed)\\s+above",
        "see\\s+above",
        "the\\s+(?:file|command|section|table|list|example|snippet|step|output)\\s+above",
      ],
      ignorecase: true,
    },
  },
] as const satisfies readonly ValeStyleRule[];

/** One exact code or artifact reference in the enforcement record. */
export interface EnforcementReference {
  readonly path: string;
  readonly symbol?: string;
  readonly detail?: string;
}

type EnforcementReferences = readonly [
  EnforcementReference,
  ...EnforcementReference[],
];

/** A proposal held by a non-Vale structural or generated-projection guard. */
export interface CoveredValeDisposition {
  readonly check: ProposedCheckRef;
  readonly disposition: "covered";
  readonly mechanism: "structural-guard" | "map-projection";
  readonly authority: EnforcementReferences;
  readonly guards: EnforcementReferences;
  readonly targets: readonly EnforcementReference[];
  readonly tests: EnforcementReferences;
  readonly residual: string;
}

/** A proposal whose missing fact makes mechanical enforcement unsound. */
export interface DeferredValeDisposition {
  readonly check: ProposedCheckRef;
  readonly disposition: "deferred";
  readonly mechanism: "semantic-residual";
  readonly missingFact: string;
  readonly reason: string;
}

/** One recorded classification for a proposal no generated Vale rule cites. */
export type ValeDisposition =
  | CoveredValeDisposition
  | DeferredValeDisposition;

/** Build a reference without making optional fields present as `undefined`. */
function enforcementReference(
  path: string,
  symbol?: string,
  detail?: string,
): EnforcementReference {
  return {
    path,
    ...(symbol === undefined ? {} : { symbol }),
    ...(detail === undefined ? {} : { detail }),
  };
}

/**
 * The audited remainder of the copy review's proposed checks. Every
 * proposal is either cited by a rule in `VALE_STYLE_RULES` or listed here —
 * exactly one of the two; the guard test fails the gate on any drift. The
 * fuller analysis lives in the planning folder's Vale-deferrals note.
 */
export const VALE_DISPOSITIONS = [
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "hero-noun-density",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority assigns hero regions or identifies the canonical product-noun subset.",
    reason:
      "Counting glossary words without both facts would flag ordinary body copy and miss undeclared site heroes.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "claim-annotation",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority marks which source blocks must carry a claim annotation.",
    reason:
      "Claim-slug resolution is already structural, but inferring claim-bearing blocks from prose would be unsound.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "serious-near-threat",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority defines threat vocabulary, proximity, and approved contexts as one relation.",
    reason:
      "A token window cannot separate a threat claim from a page discussing or rejecting that wording.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "headline-duplication",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority assigns the headline candidates to actual page and slot identities.",
    reason:
      "The candidate registry intentionally reuses lines; checking it alone would mistake inventory reuse for cross-page duplication.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "brand",
      check: "audience-signature-frequency",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority assigns audience signatures to a defined published corpus.",
    reason:
      "A frequency count has no valid denominator or membership boundary until that assignment exists.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "retired-synonyms",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/glossary_registry.ts",
        "GLOSSARY",
        "GLOSSARY[].retired",
      ),
    ],
    guards: [
      enforcementReference("scripts/glossary_registry.ts", "retiredSynonyms"),
      enforcementReference("scripts/glossary_registry.ts", "retiredPattern"),
    ],
    targets: [],
    tests: [enforcementReference("tests/vocab_drift_test.ts")],
    residual:
      "Registered phrases are enforced; dated records, private findings, and declared path exceptions remain outside the live-vocabulary corpus.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "command-flag-references",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [enforcementReference("src/main.ts", "buildCli")],
    guards: [
      enforcementReference(
        "src/lib/docs_integrity.ts",
        "validateFencedCommand",
      ),
      enforcementReference("src/lib/map_integrity.ts", "checkDocsIntegrity"),
    ],
    targets: [],
    tests: [
      enforcementReference("tests/docs_integrity_test.ts"),
      enforcementReference("tests/map_integrity_test.ts"),
    ],
    residual:
      "Fenced commands and flags are enforced; inline prose remains editorial because ordinary verbs beside the product name are lexically indistinguishable from commands.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "path-identifier-formatting",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No authority declares the path and identifier literals expected on each prose surface.",
    reason:
      "A blanket string scan cannot distinguish an unformatted identifier from ordinary prose, and Vale correctly exempts code spans.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "refusal-next-action",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference("src/shared/result.ts", "ERROR_SLUGS"),
      enforcementReference("src/shared/hints.ts", "ERROR_FAILURE_RECOVERY"),
      enforcementReference(
        "src/shared/hints.ts",
        "ERRORLESS_FAILURE_RECOVERY",
      ),
    ],
    guards: [
      enforcementReference("src/shared/hints.ts", "withFailureRecoveryHint"),
      enforcementReference(
        "src/shared/result_serialization.ts",
        "serializeResult",
      ),
    ],
    targets: [],
    tests: [enforcementReference("tests/result_schemas_test.ts")],
    residual:
      "Every registered public failure family carries evidence-classified recovery; the quality of family-specific wording remains editorial.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "product",
      check: "consent-language",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference("src/shared/consent.ts", "CONSENT_GATED_VERBS"),
      enforcementReference("src/shared/consent.ts", "LANDING_CONSENT_SOURCES"),
    ],
    guards: [
      enforcementReference(
        "src/engine/worktree/lifecycle.ts",
        "landingConsentForApply",
      ),
      enforcementReference("src/shared/setup_messages.ts", "consentMessage"),
    ],
    targets: [],
    tests: [enforcementReference("tests/engine_consent_gate_test.ts")],
    residual:
      "The act, consequence, scope, continuation, and no-effects refusal are enforced on declared surfaces; prose outside a consent-gated operation remains editorial.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "skill-stop-condition",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/agent_surface_contracts.ts",
        "AGENT_SURFACE_CONTRACTS",
      ),
    ],
    guards: [
      enforcementReference(
        "scripts/agent_contract.ts",
        "agentContractStructureIssues",
      ),
    ],
    targets: [],
    tests: [enforcementReference("tests/agent_surface_contracts_test.ts")],
    residual:
      "Every operational surface declares and evidences its stop conditions; whether the declared conditions are sufficient remains semantic review.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "authority-field",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/agent_surface_contracts.ts",
        "AGENT_SURFACE_CONTRACTS",
      ),
    ],
    guards: [
      enforcementReference(
        "scripts/agent_contract.ts",
        "agentContractStructureIssues",
      ),
    ],
    targets: [],
    tests: [enforcementReference("tests/agent_surface_contracts_test.ts")],
    residual:
      "Authority-sensitive surfaces must bind boundary and recheck evidence; whether their classification is true remains semantic review.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "relative-cross-worktree-paths",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/agent_surface_contracts.ts",
        "AGENT_SURFACE_CONTRACTS",
      ),
    ],
    guards: [
      enforcementReference(
        "scripts/agent_contract.ts",
        "agentContractStructureIssues",
      ),
    ],
    targets: [],
    tests: [enforcementReference("tests/agent_surface_contracts_test.ts")],
    residual:
      "A cross-worktree surface must bind an exact root or path; the correctness of its cross-worktree classification remains semantic review.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "vague-pronouns",
    },
    disposition: "deferred",
    mechanism: "semantic-residual",
    missingFact:
      "No structural fact identifies the intended referent of each pronoun.",
    reason:
      "A token list cannot distinguish a vague pronoun from one bound clearly by the surrounding sentence.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "context-length-budgets",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference("discern.toml", "[standards.instructions]"),
      enforcementReference("discern.toml", "[standards.skills_count]"),
      enforcementReference("discern.toml", "[standards.skills_words]"),
    ],
    guards: [
      enforcementReference(
        "src/engine/gate/standards.ts",
        "standardsResult",
      ),
    ],
    targets: [],
    tests: [
      enforcementReference("tests/engine_gate_standards_test.ts"),
      enforcementReference("tests/engine_standards_test.ts"),
    ],
    residual:
      "The configured corpus totals are ratcheted; allocation within one Skill or instruction section remains editorial.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "stable-target-validation",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/agent_surface_contracts.ts",
        "AGENT_SURFACE_CONTRACTS",
      ),
    ],
    guards: [
      enforcementReference("src/lib/map_integrity.ts", "checkDocsIntegrity"),
      enforcementReference(
        "scripts/agent_contract.ts",
        "agentContractStructureIssues",
      ),
      enforcementReference(
        "scripts/prose_lib.ts",
        "selectProseGateAlerts",
      ),
    ],
    targets: [
      enforcementReference(
        ".vale/DiscernAgent/PositionalReference.yml",
      ),
    ],
    tests: [
      enforcementReference("tests/map_integrity_test.ts"),
      enforcementReference("tests/agent_surface_contracts_test.ts"),
      enforcementReference("tests/brand_vale_codegen_test.ts"),
    ],
    residual:
      "Target existence and positional-reference tells are enforced; whether the selected target is the right one remains semantic review.",
  },
  {
    check: {
      kind: "proposed-check",
      register: "agent",
      check: "relay-message-completeness",
    },
    disposition: "covered",
    mechanism: "structural-guard",
    authority: [
      enforcementReference(
        "scripts/agent_surface_contracts.ts",
        "AGENT_SURFACE_CONTRACTS",
      ),
    ],
    guards: [
      enforcementReference(
        "scripts/agent_contract.ts",
        "agentContractStructureIssues",
      ),
    ],
    targets: [],
    tests: [enforcementReference("tests/agent_surface_contracts_test.ts")],
    residual:
      "Every declared relay fact must appear as a placeholder in the evidenced message; whether the declared fact set is complete remains semantic review.",
  },
] as const satisfies readonly ValeDisposition[];

/** A proposal table accepted by the pure partition predicate. */
export type ProposedCheckTable = Readonly<
  Record<Register, readonly { readonly id: string }[]>
>;

/** The rule shape the pure partition predicate needs. */
export interface ProposedCheckPartitionRule {
  readonly register: Register;
  readonly id: string;
  readonly sources: readonly {
    readonly kind: string;
    readonly register?: Register;
    readonly check?: string;
  }[];
}

/** The disposition shape the pure partition predicate needs. */
export interface ProposedCheckPartitionDisposition {
  readonly check: {
    readonly register: Register;
    readonly check: string;
  };
  readonly disposition: string;
}

/** The stable key used only inside the proposal coverage model. */
function proposalKey(register: Register, check: string): string {
  return `${register}/${check}`;
}

/** Report proposals that have zero or multiple classifications, plus stale
 * rule citations and disposition rows that name no live proposal. */
export function coveragePartitionIssues(
  proposals: ProposedCheckTable,
  rules: readonly ProposedCheckPartitionRule[],
  dispositions: readonly ProposedCheckPartitionDisposition[],
): string[] {
  const live = new Set<string>();
  for (const register of REGISTERS) {
    for (const proposal of proposals[register]) {
      live.add(proposalKey(register, proposal.id));
    }
  }

  const classifications = new Map<string, string[]>();
  const record = (key: string, source: string): void => {
    const existing = classifications.get(key);
    if (existing === undefined) classifications.set(key, [source]);
    else existing.push(source);
  };

  const issues: string[] = [];
  for (const rule of rules) {
    for (const source of rule.sources) {
      if (
        source.kind !== "proposed-check" || source.register === undefined ||
        source.check === undefined
      ) continue;
      const key = proposalKey(source.register, source.check);
      if (!live.has(key)) {
        issues.push(
          `${rule.register}/${rule.id} cites unknown proposal ${key}`,
        );
      }
      record(key, `generated Vale ${rule.register}/${rule.id}`);
    }
  }
  for (const disposition of dispositions) {
    const key = proposalKey(
      disposition.check.register,
      disposition.check.check,
    );
    if (!live.has(key)) {
      issues.push(
        `${disposition.disposition} row names unknown proposal ${key}`,
      );
    }
    record(key, `${disposition.disposition} disposition`);
  }

  for (const key of live) {
    const sources = classifications.get(key) ?? [];
    if (sources.length === 0) {
      issues.push(
        `${key} has no coverage classification — add one generated rule citation or one VALE_DISPOSITIONS row`,
      );
    } else if (sources.length > 1) {
      issues.push(
        `${key} has ${sources.length} classifications: ${sources.join(", ")}`,
      );
    }
  }
  return issues;
}

/** One rendered proposal row, derived from its generated rule or disposition. */
export interface VoiceEnforcementCoverageEntry {
  readonly register: Register;
  readonly proposal: string;
  readonly proposalText: string;
  readonly mechanism:
    | "generated-vale"
    | "structural-guard"
    | "map-projection"
    | "semantic-residual";
  readonly authority: readonly EnforcementReference[];
  readonly guards: readonly EnforcementReference[];
  readonly targets: readonly EnforcementReference[];
  readonly tests: readonly EnforcementReference[];
  readonly residual: string;
}

/** The generated page's configured Map-relative path. */
export const VOICE_ENFORCEMENT_COVERAGE_PAGE_REL =
  "_internal/voice-enforcement-coverage.md";

const GENERATED_VALE_GUARDS: EnforcementReferences = [
  enforcementReference(".vale.ini"),
  enforcementReference("scripts/prose_lib.ts", "selectProseGateAlerts"),
];

const GENERATED_VALE_TESTS: EnforcementReferences = [
  enforcementReference("tests/brand_vale_codegen_test.ts"),
  enforcementReference("tests/prose_input_test.ts"),
];

/** Resolve a Vale source to the typed registry location that owns its meaning. */
function valeSourceAuthority(
  source: Exclude<ValeRuleSource, ProposedCheckRef>,
): EnforcementReference {
  switch (source.kind) {
    case "banned-word":
      return enforcementReference(
        "scripts/brand/voice.ts",
        "BANNED_WORDS",
        resolveValeSource(source),
      );
    case "banned-move":
      return enforcementReference(
        "scripts/brand/voice.ts",
        "BANNED_MOVES",
        resolveValeSource(source),
      );
    case "voice-rule":
    case "voice-principle":
      return enforcementReference(
        "scripts/brand/voice.ts",
        "VOICES",
        resolveValeSource(source),
      );
  }
}

/** The authority references for a generated rule: its executable definition
 * plus every non-proposal registry source it cites. */
function generatedValeAuthorities(
  rule: ValeStyleRule,
): readonly EnforcementReference[] {
  const references: EnforcementReference[] = [
    enforcementReference(
      "scripts/brand/vale.ts",
      "VALE_STYLE_RULES",
      `${valeStyleName(rule.register)}.${rule.id}`,
    ),
  ];
  for (const source of rule.sources) {
    if (source.kind !== "proposed-check") {
      references.push(valeSourceAuthority(source));
    }
  }
  return references;
}

/** Build the live, registry-ordered proposal coverage model. */
export function voiceEnforcementCoverage(): readonly VoiceEnforcementCoverageEntry[] {
  const partitionIssues = coveragePartitionIssues(
    PROPOSED_MECHANICAL_CHECKS,
    VALE_STYLE_RULES,
    VALE_DISPOSITIONS,
  );
  if (partitionIssues.length > 0) {
    throw new Error(
      `voice enforcement coverage is not a partition:\n  ${
        partitionIssues.join("\n  ")
      }`,
    );
  }

  const entries: VoiceEnforcementCoverageEntry[] = [];
  for (const register of REGISTERS) {
    for (const proposal of PROPOSED_MECHANICAL_CHECKS[register]) {
      const rule = VALE_STYLE_RULES.find((candidate) =>
        candidate.sources.some((source) =>
          source.kind === "proposed-check" && source.register === register &&
          source.check === proposal.id
        )
      );
      if (rule !== undefined) {
        entries.push({
          register,
          proposal: proposal.id,
          proposalText: proposal.text,
          mechanism: "generated-vale",
          authority: generatedValeAuthorities(rule),
          guards: GENERATED_VALE_GUARDS,
          targets: [enforcementReference(valeRuleRel(rule))],
          tests: GENERATED_VALE_TESTS,
          residual: rule.contract.residual,
        });
        continue;
      }

      const disposition = VALE_DISPOSITIONS.find((candidate) =>
        candidate.check.register === register &&
        candidate.check.check === proposal.id
      );
      if (disposition === undefined) {
        throw new Error(`coverage partition lost ${register}/${proposal.id}`);
      }
      if (disposition.disposition === "covered") {
        entries.push({
          register,
          proposal: proposal.id,
          proposalText: proposal.text,
          mechanism: disposition.mechanism,
          authority: disposition.authority,
          guards: disposition.guards,
          targets: disposition.targets,
          tests: disposition.tests,
          residual: disposition.residual,
        });
      } else {
        entries.push({
          register,
          proposal: proposal.id,
          proposalText: proposal.text,
          mechanism: disposition.mechanism,
          authority: [],
          guards: [],
          targets: [],
          tests: [],
          residual:
            `Missing fact: ${disposition.missingFact} ${disposition.reason}`,
        });
      }
    }
  }
  return entries;
}

/** Every typed file/symbol citation and generated target in proposal coverage. */
export function voiceEnforcementReferences(): readonly EnforcementReference[] {
  return voiceEnforcementCoverage().flatMap((entry) => [
    ...entry.authority,
    ...entry.guards,
    ...entry.targets,
    ...entry.tests,
  ]);
}

/** Render one code reference for a compact generated table cell. */
function enforcementReferenceText(reference: EnforcementReference): string {
  const target = reference.symbol === undefined
    ? reference.path
    : `${reference.path}#${reference.symbol}`;
  return markdownCodeSpan(
    reference.detail === undefined ? target : `${target} — ${reference.detail}`,
  );
}

/** Render a reference list without inventing an authority for a residual. */
function enforcementReferencesText(
  references: readonly EnforcementReference[],
): string {
  return references.length === 0
    ? "—"
    : references.map(enforcementReferenceText).join("; ");
}

/** Escape authored text for one Markdown table cell. */
function coverageCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();
}

/** Human labels for the closed mechanism vocabulary. */
function mechanismLabel(
  mechanism: VoiceEnforcementCoverageEntry["mechanism"],
): string {
  switch (mechanism) {
    case "generated-vale":
      return "Generated Vale";
    case "structural-guard":
      return "Structural guard";
    case "map-projection":
      return "Map projection";
    case "semantic-residual":
      return "Semantic residual";
  }
}

/** Generate the durable internal coverage record from rules and dispositions. */
export function renderVoiceEnforcementCoverageDoc(): string {
  const coverage = voiceEnforcementCoverage();
  const counts = new Map<VoiceEnforcementCoverageEntry["mechanism"], number>();
  for (const entry of coverage) {
    counts.set(entry.mechanism, (counts.get(entry.mechanism) ?? 0) + 1);
  }
  const supplemental = VALE_STYLE_RULES.filter((rule) =>
    !rule.sources.some((source) => source.kind === "proposed-check")
  );
  const lines = [
    "<!-- GENERATED by `deno task codegen` from VALE_STYLE_RULES and VALE_DISPOSITIONS (scripts/brand/vale.ts) — do NOT edit by hand. Change the typed coverage model and regenerate. -->",
    "",
    "# Voice enforcement coverage",
    "",
    "_Every proposed voice check has one enforcement disposition, generated from the live typed model._",
    "",
    `${coverage.length} proposals: ${
      counts.get("generated-vale") ?? 0
    } generated Vale, ${counts.get("map-projection") ?? 0} Map projection, ${
      counts.get("structural-guard") ?? 0
    } structural guard, and ${
      counts.get("semantic-residual") ?? 0
    } semantic residual.`,
    "",
    "A semantic residual records the fact a machine would need before enforcement could be sound. Covered rows name the exact authority, guard, generated target where one exists, and test.",
    "",
    "| Proposal | Register | Mechanism | Authority | Guard | Target | Test | Residual status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of coverage) {
    lines.push(
      `| ${markdownCodeSpan(entry.proposal)} | ${entry.register} | ${
        mechanismLabel(entry.mechanism)
      } | ${coverageCell(enforcementReferencesText(entry.authority))} | ${
        coverageCell(enforcementReferencesText(entry.guards))
      } | ${coverageCell(enforcementReferencesText(entry.targets))} | ${
        coverageCell(enforcementReferencesText(entry.tests))
      } | ${coverageCell(entry.residual)} |`,
    );
  }
  lines.push(
    "",
    "## Supplemental generated rules",
    "",
    "These rules enforce signed-off voice canon outside the proposal registry. The register Vale-style canonical set owns their membership and generated files.",
    "",
    "| Rule | Register | Authority | Guard | Target | Test | Residual status |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const rule of supplemental) {
    lines.push(
      `| ${
        markdownCodeSpan(`${valeStyleName(rule.register)}.${rule.id}`)
      } | ${rule.register} | ${
        coverageCell(enforcementReferencesText(generatedValeAuthorities(rule)))
      } | ${coverageCell(enforcementReferencesText(GENERATED_VALE_GUARDS))} | ${
        coverageCell(
          enforcementReferencesText([enforcementReference(valeRuleRel(rule))]),
        )
      } | ${coverageCell(enforcementReferencesText(GENERATED_VALE_TESTS))} | ${
        coverageCell(rule.contract.residual)
      } |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** A register's generated style name — the Vale check-name prefix and the
 * directory under `.vale/`. */
export function valeStyleName(register: Register): string {
  return `Discern${register.charAt(0).toUpperCase()}${register.slice(1)}`;
}

/** A rule file's repo-relative path. */
export function valeRuleRel(rule: ValeStyleRule): string {
  return `.vale/${valeStyleName(rule.register)}/${rule.id}.yml`;
}

/** Resolve a source reference against the live registry, or throw — the
 * same total-by-construction contract as the citation tokens. Returns the
 * short provenance label the rule file's comment carries. */
export function resolveValeSource(source: ValeRuleSource): string {
  switch (source.kind) {
    case "banned-word": {
      const word: BannedWord | undefined = BANNED_WORDS.find(
        (candidate) => candidate.id === source.word,
      );
      if (word === undefined) {
        throw new Error(`vale rule cites unknown banned word ${source.word}`);
      }
      return `banned word ${source.word}`;
    }
    case "banned-move": {
      const move: BannedMove | undefined = BANNED_MOVES.find(
        (candidate) => candidate.id === source.move,
      );
      if (move === undefined) {
        throw new Error(`vale rule cites unknown banned move ${source.move}`);
      }
      return `banned move ${source.move}`;
    }
    case "voice-rule": {
      for (const section of VOICES[source.register].sections) {
        if (section.kind !== "rules" || section.id !== source.section) continue;
        const item: VoiceRule | undefined = section.items.find(
          (candidate) => candidate.id === source.item,
        );
        if (item !== undefined) {
          return `${source.register} voice rule ${source.section}/${source.item}`;
        }
      }
      throw new Error(
        `vale rule cites unknown ${source.register} voice rule ` +
          `${source.section}/${source.item}`,
      );
    }
    case "voice-principle": {
      for (const section of VOICES[source.register].sections) {
        if (section.kind !== "principles") continue;
        const item: VoicePrinciple | undefined = section.items.find(
          (candidate) => candidate.id === source.principle,
        );
        if (item !== undefined) {
          return `${source.register} voice principle ${source.principle}`;
        }
      }
      throw new Error(
        `vale rule cites unknown ${source.register} voice principle ` +
          source.principle,
      );
    }
    case "proposed-check": {
      const checks: readonly { readonly id: string }[] =
        PROPOSED_MECHANICAL_CHECKS[source.register];
      if (!checks.some((candidate) => candidate.id === source.check)) {
        throw new Error(
          `vale rule cites unknown proposed check ` +
            `${source.register}/${source.check}`,
        );
      }
      return `proposed check ${source.register}/${source.check}`;
    }
  }
}

/** Reject a pattern the map's hard-wrapped prose would defeat: a literal
 * space never matches an instance wrapped across source lines. Returns the
 * offences instead of throwing so the guard test can probe the predicate. */
export function valePatternOffences(pattern: string): string[] {
  const offences: string[] = [];
  if (pattern.includes(" ")) {
    offences.push(
      `literal space in Vale pattern (join words with \\s+): ${pattern}`,
    );
  }
  if (pattern.trim().length === 0) {
    offences.push("empty Vale pattern");
  }
  return offences;
}

/** Every pattern a check can fire on, as written in the rule file. */
export function valeCheckPatterns(check: ValeCheck): readonly string[] {
  if (check.extends === "occurrence") return [check.token];
  return [...(check.tokens ?? []), ...(check.raw ?? [])];
}

const BANNER =
  "# GENERATED by `deno task codegen` from VALE_STYLE_RULES (scripts/brand/vale.ts) — do NOT edit by hand. Change the brand registry (scripts/brand/) and regenerate.";

/** Wrap comment prose into `# `-prefixed lines within 80 columns. */
function commentLines(text: string): string[] {
  const lines: string[] = [];
  let line = "#";
  for (const word of text.split(/\s+/)) {
    if (word.length === 0) continue;
    if (line !== "#" && line.length + 1 + word.length > 78) {
      lines.push(line);
      line = "#";
    }
    line += ` ${word}`;
  }
  if (line !== "#") lines.push(line);
  return lines;
}

/** A YAML scalar for a regex pattern. Plain wherever YAML allows it — the
 * authored house style's idiom, and the one form `deno fmt` never rewrites.
 * A pattern whose first character would start a YAML construct is quoted:
 * double quotes when its backslashes survive them, single quotes otherwise
 * (double-quoted YAML would read `\s` as an escape). */
function patternScalar(pattern: string): string {
  const first = pattern.charAt(0);
  if (!`-?:,[]{}#&*!|>'"%@\``.includes(first)) return pattern;
  if (!pattern.includes("\\") && !pattern.includes('"')) return `"${pattern}"`;
  if (!pattern.includes("'")) return `'${pattern}'`;
  throw new Error(
    `no stable YAML quoting for Vale pattern (rebuild it so it does not ` +
      `open with a YAML indicator, or drop its quotes or backslashes): ` +
      pattern,
  );
}

/** A double-quoted YAML scalar for message text. */
function messageScalar(message: string): string {
  if (message.includes('"') || message.includes("\\")) {
    throw new Error(
      `vale message must not need YAML escapes (rewrite without " or \\): ` +
        message,
    );
  }
  return `"${message}"`;
}

/** Render one rule file: banner, provenance comment, then the check body
 * in the authored style's key order. */
export function renderValeRule(rule: ValeStyleRule): string {
  for (const pattern of valeCheckPatterns(rule.check)) {
    const offences = valePatternOffences(pattern);
    if (offences.length > 0) {
      throw new Error(`${valeRuleRel(rule)}: ${offences.join("; ")}`);
    }
  }
  const provenance = rule.sources.map(resolveValeSource).join("; ");
  const lines: string[] = [
    BANNER,
    "#",
    ...commentLines(rule.comment),
    ...commentLines(`Sources: ${provenance}.`),
    `extends: ${rule.check.extends}`,
    `message: ${messageScalar(rule.message)}`,
  ];
  if (rule.check.extends === "existence") {
    if (rule.check.ignorecase === true) lines.push("ignorecase: true");
    lines.push(`level: ${rule.level}`);
    if (rule.check.nonword === true) lines.push("nonword: true");
    if (rule.check.scope !== undefined) {
      lines.push(`scope: ${rule.check.scope}`);
    }
    const tokens = rule.check.tokens ?? [];
    const raw = rule.check.raw ?? [];
    if (tokens.length + raw.length === 0) {
      throw new Error(`${valeRuleRel(rule)} declares no patterns`);
    }
    if (tokens.length > 0) {
      lines.push("tokens:");
      for (const token of tokens) lines.push(`  - ${patternScalar(token)}`);
    }
    if (raw.length > 0) {
      lines.push("raw:");
      for (const pattern of raw) lines.push(`  - ${patternScalar(pattern)}`);
    }
  } else {
    lines.push(`level: ${rule.level}`);
    lines.push(`scope: ${rule.check.scope}`);
    lines.push(`max: ${rule.check.max}`);
    lines.push(`token: ${patternScalar(rule.check.token)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Every generated style file, in registry order — the codegen loop's
 * write list and the guard test's expected set. */
export function valeStyleFiles(): readonly { rel: string; text: string }[] {
  const seen = new Set<string>();
  return VALE_STYLE_RULES.map((rule) => {
    const rel = valeRuleRel(rule);
    if (seen.has(rel)) {
      throw new Error(`duplicate Vale rule file ${rel}`);
    }
    seen.add(rel);
    return { rel, text: renderValeRule(rule) };
  });
}
