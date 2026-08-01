/**
 * The authored identities of discern's contributor agreements and the exact
 * payload mirrored into the hosted CLA Assistant Gist.
 *
 * A numeric version identifies one immutable byte sequence from the moment the
 * agreements are first offered for acceptance. Until then, a byte change keeps
 * its version and updates the SHA-256 pin here; once
 * CONTRIBUTOR_AGREEMENTS_OFFERED is true, any byte change requires a later
 * version and a new pin. Keep the legal prose in its Markdown file and
 * regenerate service metadata with codegen.
 */

export const INDIVIDUAL_CONTRIBUTOR_AGREEMENT = {
  kind: "individual",
  repoPath: "CLA.md",
  version: "1.0",
  sha256: "cb7dac75b7af2224d1949567406f56df7c43ff8167fb250950c4d391db7a6040",
} as const;

export const CORPORATE_CONTRIBUTOR_AGREEMENT = {
  kind: "corporate",
  repoPath: "CCLA.md",
  version: "1.0",
  sha256: "42bd715e690237da24e9ab95c1234b4327f6f7114479524ac699746ba7ddae8f",
} as const;

/** Every agreement whose versioned bytes form part of the legal record. */
export const CONTRIBUTOR_AGREEMENTS = [
  INDIVIDUAL_CONTRIBUTOR_AGREEMENT,
  CORPORATE_CONTRIBUTOR_AGREEMENT,
] as const;

/**
 * Whether any agreement version has ever been offered for acceptance. The
 * release runbook flips this to true when the hosted acceptance path goes
 * live; it never returns to false. While false, nobody has been offered the
 * current bytes, so an agreement may change under its existing version.
 */
export const CONTRIBUTOR_AGREEMENTS_OFFERED: boolean = false;

export const CONTRIBUTOR_AGREEMENT_REGISTRY_PATH =
  "scripts/contributor_agreement.ts";

export const CONTRIBUTOR_AGREEMENT_ACCEPTANCE =
  `I have read and agreed to the discern Contributor License Agreement, version ${INDIVIDUAL_CONTRIBUTOR_AGREEMENT.version}`;

export const CLA_ASSISTANT_METADATA_PATH = ".github/cla-assistant/metadata";

/** Exact repository sources copied to like-named files in the hosted Gist. */
export const CLA_ASSISTANT_GIST_FILES = [
  { repoPath: "CLA.md", gistName: "CLA.md" },
  { repoPath: CLA_ASSISTANT_METADATA_PATH, gistName: "metadata" },
] as const;

const AGREEMENT_HEADING =
  /^# discern (?:Individual|Corporate) Contributor License Agreement, version ([0-9]+)\.([0-9]+)$/m;

/** Read the numeric version from an agreement's canonical heading. */
export function contributorAgreementVersion(
  source: string,
): readonly [number, number] | undefined {
  const match = source.match(AGREEMENT_HEADING);
  const major = match?.[1];
  const minor = match?.[2];
  if (major === undefined || minor === undefined) return undefined;
  return [Number.parseInt(major, 10), Number.parseInt(minor, 10)];
}

/** Whether equal bytes or a strictly later numeric version satisfy the rule. */
export function agreementChangeAdvancesVersion(
  current: string,
  previous: string,
): boolean {
  if (current === previous) return true;
  const currentVersion = contributorAgreementVersion(current);
  const previousVersion = contributorAgreementVersion(previous);
  if (currentVersion === undefined || previousVersion === undefined) {
    return false;
  }
  return currentVersion[0] > previousVersion[0] ||
    (currentVersion[0] === previousVersion[0] &&
      currentVersion[1] > previousVersion[1]);
}

/** Render the required acknowledgement field shown by CLA Assistant. */
export function renderClaAssistantMetadata(): string {
  return JSON.stringify(
    {
      agreement: {
        title: CONTRIBUTOR_AGREEMENT_ACCEPTANCE,
        type: "boolean",
        required: true,
      },
    },
    null,
    2,
  ) + "\n";
}
