/**
 * The consent-gated verbs and the attestation they share.
 *
 * Two acts in discern are destructive enough that structure — not a guidance
 * sentence — must guard them: scaffolding a fresh install (`setup begin`, ADR
 * 0086) and landing a branch on the trunk (`accept`, ADR 0134). Fresh setup
 * requires an explicit `--confirmed` attestation. Landing accepts either that
 * current-conversation attestation or a machine-checked standing/effort grant
 * (ADR 0194). When no valid source satisfies the act, the verb refuses
 * read-only and re-serves the setup conversation or landing-review moment. An
 * agent under context pressure drops prose; a structural refusal forces the
 * moment into the transcript instead.
 *
 * This module is the single source both verbs share: one refusal slug, and the
 * registry of which verbs are gated. Keeping them here — not duplicated in two
 * subsystems — is what lets a parity test hold every member to one refusal
 * contract, and enrol a future gated verb the moment it joins the registry.
 */

/**
 * The stable failure slug every consent-gated verb uses when no accepted consent
 * source satisfies the act. One spelling across the class (ADR 0086 minted it
 * for `setup begin`; ADR 0134 shares it with `accept`) so an agent — and the
 * class test — recognises the refusal wherever it fires. The envelope's `verb`
 * field disambiguates which act is awaiting consent.
 */
export const AWAITING_CONSENT_SLUG = "awaiting_consent";

/** The attestation flag both gated verbs accept — the fact the caller asserts:
 * the human has consented to this act in the current conversation. Recorded
 * landing grants are checked directly and never asserted through this flag. */
export const CONFIRMED_ATTESTATION = "--confirmed";

/**
 * The closed vocabulary recorded for every successful landing. Conversation
 * consent comes through `--confirmed`; standing and effort grants are
 * machine-checked records.
 */
export const LANDING_CONSENT_SOURCES = [
  "conversation",
  "standing-grant",
  "effort-grant",
] as const;

/** One recorded landing-consent source. */
export type LandingConsentSource = (typeof LANDING_CONSENT_SOURCES)[number];

/** The two postures a read-only landing-authority observation can report. */
export const LANDING_AUTHORITY_KINDS = [
  "authorized",
  "conversation-required",
] as const;

/** One landing-authority posture. */
export type LandingAuthorityKind = (typeof LANDING_AUTHORITY_KINDS)[number];

/** The consent evidence carried by acceptance results and local history. */
export interface LandingConsent {
  readonly source: LandingConsentSource;
  /** The granted scopes that covered this landing (standing grants only). */
  readonly scopes?: readonly string[];
}

/** One rendering that must carry the gated act's complete interaction contract. */
export type ConsentSurface = "human" | "json" | "mcp";

/** One consent-gated verb — pure metadata, no behaviour. */
export interface ConsentGatedVerb {
  /** Stable identifier for the class (matches the probe key in the class test). */
  readonly id: string;
  /** The CLI command a human types, sans the leading `discern`. */
  readonly command: string;
  /** The attestation flag that satisfies the gate. */
  readonly flag: string;
  /** Public surfaces that must carry the same act, consequence, scope, and continuation. */
  readonly surfaces: readonly ConsentSurface[];
}

/**
 * The consent-gated verbs — the single source the consent-gate class test
 * iterates. Adding a member here enrols it in the shared-refusal contract, which
 * then fails until the new verb refuses with {@link AWAITING_CONSENT_SLUG} and
 * names its recovery — so a future gated act can never quietly ship without the
 * structural refusal the class exists to guarantee.
 */
export const CONSENT_GATED_VERBS = [
  {
    id: "setup-begin",
    command: "setup begin",
    flag: CONFIRMED_ATTESTATION,
    surfaces: ["human", "json"],
  },
  {
    id: "accept",
    command: "accept",
    flag: CONFIRMED_ATTESTATION,
    surfaces: ["human", "json", "mcp"],
  },
] as const satisfies readonly ConsentGatedVerb[];

/** Stable ids used by the authority-driven class probes. */
export type ConsentGatedVerbId = (typeof CONSENT_GATED_VERBS)[number]["id"];
