/**
 * First-party legal-document registry.
 *
 * The repository files remain the authored legal texts. This registry owns
 * their identities, order, and paths so codegen, the installed `licenses`
 * command, release smoke, package metadata parity, and canonical-set guards
 * agree about the legal package discern ships.
 */

/** The kinds of first-party legal document discern ships. */
export const FIRST_PARTY_LEGAL_DOCUMENT_KINDS = [
  "license",
  "notice",
] as const;

/** One authored first-party legal document shipped with discern. */
export interface FirstPartyLegalDocumentDeclaration {
  readonly key: string;
  readonly kind: (typeof FIRST_PARTY_LEGAL_DOCUMENT_KINDS)[number];
  readonly identifier: string;
  readonly title: string;
  readonly path: string;
  /** Stable source-text evidence that catches a registry/path mismatch. */
  readonly smokeMarker: string;
}

/** The license identifier carried by `deno.json`. */
export const DISCERN_SOFTWARE_LICENSE = {
  key: "software",
  kind: "license",
  identifier: "FSL-1.1-ALv2",
  title: "discern software",
  path: "LICENSE",
  smokeMarker: "Functional Source License, Version 1.1",
} as const satisfies FirstPartyLegalDocumentDeclaration;

/** The repository notice that scopes the project-payload grant. */
export const DISCERN_NOTICE = {
  key: "notice",
  kind: "notice",
  identifier: "NOTICE",
  title: "scope and attribution notices",
  path: "NOTICE",
  smokeMarker: "Discern-authored portions",
} as const satisfies FirstPartyLegalDocumentDeclaration;

/** The license for discern-authored material emitted to projects. */
export const DISCERN_PROJECT_PAYLOAD_LICENSE = {
  key: "project-payloads",
  kind: "license",
  identifier: "Apache-2.0",
  title: "discern-authored project payloads",
  path: "LICENSES/Apache-2.0.txt",
  smokeMarker: "Apache License",
} as const satisfies FirstPartyLegalDocumentDeclaration;

/** The complete first-party legal package, in human display order. */
export const FIRST_PARTY_LEGAL_DOCUMENTS = [
  DISCERN_SOFTWARE_LICENSE,
  DISCERN_NOTICE,
  DISCERN_PROJECT_PAYLOAD_LICENSE,
] as const satisfies readonly FirstPartyLegalDocumentDeclaration[];
