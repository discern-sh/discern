/**
 * The proposed mechanical prose checks, per register — candidates for Vale,
 * tests, or registries. `scripts/brand/vale.ts` implements the practical
 * subset as generated styles and records a disposition for every other id;
 * `tests/brand_vale_codegen_test.ts` holds that partition exact, so a
 * proposal added here fails the gate until it is implemented or its
 * deferral is recorded.
 */

import type { Register } from "./model.ts";

/** One proposed mechanical check. The id is the handle the generated Vale
 * styles cite; the text is signed-off content. */
export interface ProposedCheck {
  readonly id: string;
  readonly text: string;
}

/** The proposed checks, per register. */
export const PROPOSED_MECHANICAL_CHECKS = {
  brand: [
    {
      id: "hero-noun-density",
      text: "warn when a hero contains more than two canonical product nouns;",
    },
    {
      id: "repeated-contrast",
      text: "warn on repeated `X, not Y` syntax within one page;",
    },
    {
      id: "generic-verbs",
      text:
        "warn on generic verbs: `unlock`, `empower`, `transform`, `reimagine`;",
    },
    {
      id: "unsupported-adjectives",
      text:
        "warn on unsupported adjectives: `seamless`, `robust`, `powerful`, `enterprise-grade`;",
    },
    {
      id: "cta-generic-label",
      text: "warn when a CTA is only “Learn more,” “Explore,” or “Discover”;",
    },
    {
      id: "claim-annotation",
      text:
        "require a claim annotation in source for designated claim-bearing blocks;",
    },
    {
      id: "serious-near-threat",
      text:
        "warn when “serious” occurs near threat vocabulary without an approved context;",
    },
    {
      id: "headline-duplication",
      text: "check headline duplication across pages;",
    },
    {
      id: "audience-signature-frequency",
      text: "check audience signature frequency.",
    },
  ],
  product: [
    {
      id: "canonical-glossary-terms",
      text: "canonical glossary term enforcement;",
    },
    { id: "retired-synonyms", text: "retired synonym enforcement;" },
    {
      id: "command-flag-references",
      text: "command and flag references from typed registries;",
    },
    {
      id: "path-identifier-formatting",
      text: "path and identifier formatting;",
    },
    { id: "agent-blame", text: "prohibited agent-blame vocabulary;" },
    {
      id: "refusal-next-action",
      text: "required next-action field for refusal families;",
    },
    {
      id: "consent-language",
      text: "consent-language templates for authority-critical operations.",
    },
  ],
  agent: [
    {
      id: "skill-stop-condition",
      text: "required stop condition in Skills and setup steps;",
    },
    {
      id: "authority-field",
      text:
        "required authority field for dispatch, install, and landing procedures;",
    },
    {
      id: "relative-cross-worktree-paths",
      text: "warning on relative cross-worktree paths;",
    },
    {
      id: "vague-pronouns",
      text: "warning on vague pronouns in operational instructions;",
    },
    {
      id: "context-length-budgets",
      text: "context-length budgets by surface;",
    },
    {
      id: "stable-target-validation",
      text: "stable target validation;",
    },
    {
      id: "relay-message-completeness",
      text: "relay-message completeness tests.",
    },
  ],
} as const satisfies Record<Register, readonly ProposedCheck[]>;
