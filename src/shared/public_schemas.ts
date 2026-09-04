/** Public schema identities and the root generated artifacts served at them. */

import { ON_DISK_FORMATS } from "./on_disk_formats.ts";

/** Build one public schema identifier from its major and artifact name. */
function publicSchemaId<const Major extends number, const Name extends string>(
  major: Major,
  name: Name,
): `https://discern.sh/schema/v${Major}/${Name}` {
  return `https://discern.sh/schema/v${major}/${name}`;
}

export const CONFIG_SCHEMA_MAJOR = 1;
export const CONFIG_SCHEMA_ID = publicSchemaId(
  CONFIG_SCHEMA_MAJOR,
  "discern-config.schema.json",
);

/** The declarative document consumed by `setup begin --config`. */
export const SETUP_CONFIG_SCHEMA_MAJOR = 1;
export const SETUP_CONFIG_SCHEMA_ID = publicSchemaId(
  SETUP_CONFIG_SCHEMA_MAJOR,
  "discern-setup-config.schema.json",
);

/** The live result contract. Command identity changes require a new major. */
export const RESULT_SCHEMA_MAJOR = 1;
export const RESULT_SCHEMA_ID = publicSchemaId(
  RESULT_SCHEMA_MAJOR,
  "discern-results.schema.json",
);

/** The durable landing proof note's DSSE-compatible envelope. Its
 * `payloadType` points back into this schema, so every note names the payload
 * contract carried in its bytes (ADR 0242). */
export const PROOF_NOTE_SCHEMA_MAJOR = ON_DISK_FORMATS.proofNote.version;
export const PROOF_NOTE_SCHEMA_ID = publicSchemaId(
  PROOF_NOTE_SCHEMA_MAJOR,
  "discern-proof-note.schema.json",
);

/** Frozen MCP request and tool-selection surface. */
export const MCP_TOOLS_MANIFEST_MAJOR = 1;
export const MCP_TOOLS_MANIFEST_ID = publicSchemaId(
  MCP_TOOLS_MANIFEST_MAJOR,
  "discern-mcp-tools.json",
);

/** Frozen command-line grammar. */
export const CLI_MANIFEST_MAJOR = 1;
export const CLI_MANIFEST_ID = publicSchemaId(
  CLI_MANIFEST_MAJOR,
  "discern-cli.json",
);

/** Frozen cross-surface names and repository conventions. */
export const CONVENTIONS_MANIFEST_MAJOR = 1;
export const CONVENTIONS_MANIFEST_ID = publicSchemaId(
  CONVENTIONS_MANIFEST_MAJOR,
  "discern-conventions.json",
);
/** The named payload definition inside the proof-note publication. */
export const PROOF_NOTE_PAYLOAD_DEFINITION = "DiscernProofNotePayload";
/** DSSE authenticates this type together with the decoded payload bytes. */
export const PROOF_NOTE_PAYLOAD_TYPE =
  `${PROOF_NOTE_SCHEMA_ID}#/$defs/${PROOF_NOTE_PAYLOAD_DEFINITION}` as const;
/** The frozen external protocol that defines proof signature bytes. */
export const PROOF_NOTE_DSSE_PROTOCOL =
  "https://github.com/secure-systems-lab/dsse/blob/v1.0.2/protocol.md";
/** The frozen external JSON envelope whose field shape the proof note follows. */
export const PROOF_NOTE_DSSE_ENVELOPE =
  "https://github.com/secure-systems-lab/dsse/blob/v1.0.2/envelope.md";

/** Generated-artifact field that records the policy owning its baseline. */
export const PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY =
  "x-discern-compatibility-policy";

/** Every discern extension keyword accepted by strict public-schema compilers. */
export const PUBLIC_SCHEMA_EXTENSION_KEYWORDS = [
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  "x-discern-contracts",
  "x-discern-dsse-envelope",
  "x-discern-dsse-protocol",
  "x-discern-error-slugs",
  "x-discern-payload-type",
] as const;

export const CONFIG_SCHEMA_COMPATIBILITY_POLICY = "config-input";
export const RESULT_SCHEMA_COMPATIBILITY_POLICY = "result-output";
export const MCP_TOOLS_COMPATIBILITY_POLICY = "mcp-tools-append-only";
export const CLI_COMPATIBILITY_POLICY = "cli-append-only";
export const CONVENTIONS_COMPATIBILITY_POLICY = "conventions-append-only";

export type PublicSchemaCompatibility =
  | typeof CONFIG_SCHEMA_COMPATIBILITY_POLICY
  | typeof RESULT_SCHEMA_COMPATIBILITY_POLICY
  | typeof MCP_TOOLS_COMPATIBILITY_POLICY
  | typeof CLI_COMPATIBILITY_POLICY
  | typeof CONVENTIONS_COMPATIBILITY_POLICY;

/** Narrow unknown metadata to one of the 2 published compatibility policies. */
export function isPublicSchemaCompatibility(
  value: unknown,
): value is PublicSchemaCompatibility {
  return value === CONFIG_SCHEMA_COMPATIBILITY_POLICY ||
    value === RESULT_SCHEMA_COMPATIBILITY_POLICY ||
    value === MCP_TOOLS_COMPATIBILITY_POLICY ||
    value === CLI_COMPATIBILITY_POLICY ||
    value === CONVENTIONS_COMPATIBILITY_POLICY;
}

export interface PublicSchemaPublication {
  readonly id: `https://discern.sh/schema/${string}`;
  readonly artifactPath: `schema/${string}.json`;
  readonly major: number;
  readonly compatibility: PublicSchemaCompatibility;
  readonly label: string;
  readonly contract: string;
}

export const PUBLIC_SCHEMA_PUBLICATIONS = [
  {
    id: CONFIG_SCHEMA_ID,
    artifactPath: "schema/discern-config.schema.json",
    major: CONFIG_SCHEMA_MAJOR,
    compatibility: CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    label: "`discern.toml` configuration",
    contract: "Every section, key, and value type the engine validates.",
  },
  {
    id: SETUP_CONFIG_SCHEMA_ID,
    artifactPath: "schema/discern-setup-config.schema.json",
    major: SETUP_CONFIG_SCHEMA_MAJOR,
    compatibility: CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    label: "Setup config document",
    contract:
      "The bounded setup recipe consumed only by `setup begin --config`.",
  },
  {
    id: RESULT_SCHEMA_ID,
    artifactPath: "schema/discern-results.schema.json",
    major: RESULT_SCHEMA_MAJOR,
    compatibility: RESULT_SCHEMA_COMPATIBILITY_POLICY,
    label: "Result contracts",
    contract: "Every CLI `--json` and MCP tool result envelope.",
  },
  {
    id: PROOF_NOTE_SCHEMA_ID,
    artifactPath: "schema/discern-proof-note.schema.json",
    major: PROOF_NOTE_SCHEMA_MAJOR,
    compatibility: RESULT_SCHEMA_COMPATIBILITY_POLICY,
    label: "Landing proof note",
    contract:
      "The proof envelope acceptance attaches to a landed commit, using the Dead Simple Signing Envelope (DSSE) field and payload boundary.",
  },
  {
    id: MCP_TOOLS_MANIFEST_ID,
    artifactPath: "schema/discern-mcp-tools.json",
    major: MCP_TOOLS_MANIFEST_MAJOR,
    compatibility: MCP_TOOLS_COMPATIBILITY_POLICY,
    label: "MCP tools manifest",
    contract:
      "Tool order, names, titles, descriptions, request schemas, and annotations.",
  },
  {
    id: CLI_MANIFEST_ID,
    artifactPath: "schema/discern-cli.json",
    major: CLI_MANIFEST_MAJOR,
    compatibility: CLI_COMPATIBILITY_POLICY,
    label: "CLI grammar manifest",
    contract:
      "Command paths, aliases, positional arguments, flags, option value counts and types, defaults, and visibility.",
  },
  {
    id: CONVENTIONS_MANIFEST_ID,
    artifactPath: "schema/discern-conventions.json",
    major: CONVENTIONS_MANIFEST_MAJOR,
    compatibility: CONVENTIONS_COMPATIBILITY_POLICY,
    label: "Conventions manifest",
    contract:
      "Frozen environment, skill, Git, checkpoint, identity, provider, hook, and local-format names.",
  },
] as const satisfies readonly PublicSchemaPublication[];

export const PUBLIC_SCHEMA_REFERENCE_START =
  "<!-- BEGIN GENERATED: public schema publications -->";
export const PUBLIC_SCHEMA_REFERENCE_END =
  "<!-- END GENERATED: public schema publications -->";

/** State the same-major additions permitted by a publication's policy. */
function compatibilityContract(
  policy: PublicSchemaCompatibility,
): string {
  switch (policy) {
    case RESULT_SCHEMA_COMPATIBILITY_POLICY:
      return "Same-major releases may add only optional fields, new contracts, and error slugs.";
    case CONFIG_SCHEMA_COMPATIBILITY_POLICY:
      return "Same-major releases may add only optional keys and sections.";
    case MCP_TOOLS_COMPATIBILITY_POLICY:
      return "Same-major releases may add tools or optional input properties; existing metadata and inputs remain compatible.";
    case CLI_COMPATIBILITY_POLICY:
      return "Same-major releases may add commands, aliases, options, and positional arguments without changing existing grammar.";
    case CONVENTIONS_COMPATIBILITY_POLICY:
      return "Same-major releases may add names; every published existing value is immutable.";
  }
}

/** Resolve one registry artifact for the document that receives the block. */
export type PublicSchemaArtifactHref = (
  artifactPath: PublicSchemaPublication["artifactPath"],
) => string;

/** Render the public schema registry as a reference-table block. */
export function renderPublicSchemaReference(
  artifactHref: PublicSchemaArtifactHref = (path) => `../../../${path}`,
  publications: readonly PublicSchemaPublication[] = PUBLIC_SCHEMA_PUBLICATIONS,
): string {
  return [
    PUBLIC_SCHEMA_REFERENCE_START,
    "<!-- Generated by `deno task codegen` from `PUBLIC_SCHEMA_PUBLICATIONS`. -->",
    "",
    "| Schema | Public `$id` | Repository artifact | Contract | Same-major changes |",
    "| --- | --- | --- | --- | --- |",
    ...publications.map((publication) =>
      `| ${publication.label} | <${publication.id}> | ` +
      `[\`${publication.artifactPath}\`](${
        artifactHref(publication.artifactPath)
      }) | ` +
      `${publication.contract} | ${
        compatibilityContract(publication.compatibility)
      } |`
    ),
    "",
    PUBLIC_SCHEMA_REFERENCE_END,
  ].join("\n");
}

/** Replace the registry-derived schema block without changing authored prose. */
export function replacePublicSchemaReference(
  document: string,
  reference: string,
): string {
  const start = document.indexOf(PUBLIC_SCHEMA_REFERENCE_START);
  const end = document.indexOf(PUBLIC_SCHEMA_REFERENCE_END);
  if (start < 0 || end < start) {
    throw new Error(
      "mcp-and-results.md is missing the public schema publication markers",
    );
  }
  const after = end + PUBLIC_SCHEMA_REFERENCE_END.length;
  return `${document.slice(0, start)}${reference}${document.slice(after)}`;
}
