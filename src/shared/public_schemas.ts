/** Public schema identities and the root generated artifacts served at them. */

export const CONFIG_SCHEMA_ID =
  "https://discern.sh/schema/v1/discern-config.schema.json";

export const RESULT_SCHEMA_ID =
  "https://discern.sh/schema/v1/discern-results.schema.json";

export interface PublicSchemaPublication {
  readonly id: `https://discern.sh/schema/${string}`;
  readonly artifactPath: `schema/${string}.json`;
}

export const PUBLIC_SCHEMA_PUBLICATIONS = [
  {
    id: CONFIG_SCHEMA_ID,
    artifactPath: "schema/discern-config.schema.json",
  },
  {
    id: RESULT_SCHEMA_ID,
    artifactPath: "schema/discern-results.schema.json",
  },
] as const satisfies readonly PublicSchemaPublication[];
