/**
 * The artifact-validator registry — every `src/lib` validator whose subject is
 * a config-resolved authored artifact (the map, instruction sources, skills,
 * project scripts, the TODO ledger, or the map's ADR records) or discern's
 * bundled manual, each declared
 * either SHIPPED (the binary applies it to every project) or REPO-LOCAL (this
 * repository holds only itself to it, with the reason).
 *
 * The declaration is a contract, not a note. The enrolment guard
 * (`tests/validator_enrolment_test.ts`, ADR 0201) proves each row against the
 * live import graph: a shipped row must have a caller reachable from the
 * binary's shipped trees, and a repo-local row must still be unshipped and
 * still dogfood-applied — so an exemption retires loudly the moment the
 * validator gains a shipped surface, and a shipped validator cannot quietly
 * lose its wiring. The guard's reverse sweep enrols new members mechanically:
 * a library function a dogfood test applies to this repository's authored
 * artifacts must appear here (or in {@link NON_VALIDATOR_IMPORTS}) before the
 * gate passes.
 */

/**
 * The configured authored-artifact trees a validator can hold to a standard —
 * the same set `tests/repo_authored_paths.ts` resolves from `discern.toml`.
 * `adr` names the map's `_adr/` records subtree, listed separately because
 * validators target the record files specifically.
 */
export type ArtifactSubject =
  | "map"
  | "instructions"
  | "skills"
  | "scripts"
  | "todo"
  | "adr"
  | "manual";

/** How a validator reaches the artifacts it holds to a standard. */
export type ValidatorEnforcement =
  | {
    readonly kind: "shipped";
    /** The shipped surface that applies it, for the human reader. */
    readonly via: string;
  }
  | {
    readonly kind: "repo-local";
    /** Why this repository deliberately keeps the check to itself. */
    readonly reason: string;
  };

/** One enrolled validator: a `src/lib` function export and its enforcement. */
export interface EnrolledValidator {
  /** Repo-relative module path under `src/lib/`. */
  readonly module: string;
  /** The exported function's name. */
  readonly exportName: string;
  /** The authored artifact(s) the validator holds to a standard. */
  readonly subjects: readonly ArtifactSubject[];
  readonly enforcement: ValidatorEnforcement;
}

/** The enrolled artifact validators. */
export const ARTIFACT_VALIDATORS: readonly EnrolledValidator[] = [
  {
    module: "src/lib/map_integrity.ts",
    exportName: "checkDocsIntegrity",
    subjects: ["map", "instructions"],
    enforcement: {
      kind: "shipped",
      via: "the gate's map & instructions integrity preflight (ADR 0202)",
    },
  },
  {
    module: "src/lib/frontmatter.ts",
    exportName: "frontmatterShapeIssues",
    subjects: ["map"],
    enforcement: {
      kind: "shipped",
      via: "the frontmatter rule of the gate's map-integrity preflight",
    },
  },
  {
    module: "src/lib/adr_index.ts",
    exportName: "adrIndexState",
    subjects: ["adr"],
    enforcement: {
      kind: "shipped",
      via:
        "the gate's index-currency preflight, the refresh writer, and the status advisory (ADR 0200)",
    },
  },
  {
    module: "src/lib/adr_numbers.ts",
    exportName: "duplicateAdrNumbers",
    subjects: ["adr"],
    enforcement: {
      kind: "shipped",
      via:
        "the gate's number-uniqueness preflight and status's in-flight collision scan (ADR 0186)",
    },
  },
  {
    module: "src/lib/skills.ts",
    exportName: "checkSkillsCurrent",
    subjects: ["skills"],
    enforcement: {
      kind: "shipped",
      via: "the gate's materialized-skills currency preflight (ADR 0034)",
    },
  },
  {
    module: "src/lib/skills.ts",
    exportName: "checkSkillsWellformed",
    subjects: ["skills"],
    enforcement: {
      kind: "shipped",
      via: "the gate's skill-frontmatter preflight",
    },
  },
  {
    module: "src/lib/skills.ts",
    exportName: "skillFrontmatterIssues",
    subjects: ["skills"],
    enforcement: {
      kind: "shipped",
      via: "checkSkillsWellformed, which applies it per effective skill",
    },
  },
  {
    module: "src/lib/frontmatter.ts",
    exportName: "validateFrontmatter",
    subjects: ["map", "manual"],
    enforcement: {
      kind: "shipped",
      via:
        "the bundled product-manual projection; repository tests also apply the same strict tier to discern's own Map",
    },
  },
  {
    module: "src/lib/adr_citations.ts",
    exportName: "findMalformedAdrReferences",
    subjects: ["map"],
    enforcement: {
      kind: "repo-local",
      reason:
        "the normalized citation form is this repository's convention for its own published prose (tests/adr_citation_form_test.ts); the shipped surfaces consume citations through collectAdrCitations and stripAdrCitations, which ARE wired",
    },
  },
  {
    module: "src/lib/manual.ts",
    exportName: "staleManualAliasOwnerOverrides",
    subjects: ["manual"],
    enforcement: {
      kind: "repo-local",
      reason:
        "MANUAL_ALIAS_OWNER_OVERRIDES governs only discern's own manual, so a dead override key is a repository-authoring defect (tests/manual_policy_test.ts); the projection stays permissive because synthetic corpora legitimately project under the repository's override registry",
    },
  },
];

/**
 * Unshipped `src/lib` functions that dogfood tests import for reasons other
 * than validating an authored artifact — generators, renderers, and
 * classifiers a repo guard consumes as fixtures or inputs. Each carries the
 * reason it is not a validator. The guard holds every record live: the export
 * must still exist, still be dogfood-imported, and still be unshipped — a
 * record that outlives any of those facts fails, so the ledger cannot rot.
 */
export const NON_VALIDATOR_IMPORTS: Readonly<Record<string, string>> = {
  "src/lib/paths.ts#numberedDocRoute":
    "derives URL shapes from numbered document paths; the site guard uses it to exercise retired routes, not to validate an authored artifact",
  "src/lib/artifact_ownership.ts#isDiscernWriteTarget":
    "classifies discern-owned write targets for the write-surface guard; its subject is discern's own outputs, not an authored artifact",
  "src/lib/artifact_ownership.ts#projectArtifactPaths":
    "enumerates discern-owned artifact paths for codegen and its guards; an inventory, not a validator",
  "src/lib/artifact_ownership.ts#renderArtifactInventory":
    "renders the artifact-inventory map section for codegen; a generator, not a validator",
  "src/lib/artifact_ownership.ts#replaceArtifactInventory":
    "splices the artifact-inventory section for codegen; a generator, not a validator",
  "src/lib/artifact_ownership.ts#writtenArtifactClass":
    "classifies discern-owned output for inventories and provenance guards; its subject is discern's output, not an authored artifact",
};
