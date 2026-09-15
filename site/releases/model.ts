/** Pure release comparison and its versioned public JSON contract. */
import { z } from "@zod/zod";
import { compareVersions, parseVersion } from "../../src/shared/semver.ts";
import {
  DISCERN_INSTALL_URL,
  releaseCheckUrls,
} from "../../src/shared/product_identity.ts";
import {
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  RELEASE_SCHEMA_ID,
  RELEASE_SCHEMA_MAJOR,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../../src/shared/public_schemas.ts";
import { type AuthoredRelease, publicRelease } from "./records.ts";

export const publicationSchema = z.strictObject({
  version: z.string(),
  date: z.iso.date(),
});
export type Publication = z.infer<typeof publicationSchema>;
export const catalogueRecordSchema = z.strictObject({
  version: z.string(),
  summary: z.string(),
  body: z.string(),
  date: z.iso.date().optional(),
  codename: z.string().optional(),
  publication: z.enum(["stable", "prerelease", "candidate"]),
});
export type CatalogueRecord = z.infer<typeof catalogueRecordSchema>;
export const comparisonSchema = z.strictObject({
  schema_version: z.literal(RELEASE_SCHEMA_MAJOR),
  since: z.string().optional(),
  status: z.enum([
    "index",
    "current",
    "update-available",
    "ahead",
    "no-stable-release",
  ]),
  latest_stable: catalogueRecordSchema.optional(),
  applicable: z.array(catalogueRecordSchema),
  history: z.strictObject({
    stable: z.array(catalogueRecordSchema),
    prereleases: z.array(catalogueRecordSchema),
    candidates: z.array(catalogueRecordSchema),
  }),
  history_coverage: z.strictObject({
    earliest_known: z.string().optional(),
    before_earliest_known: z.boolean(),
    complete: z.literal(false),
  }),
  urls: z.strictObject({ html: z.url(), json: z.url(), installer: z.url() }),
  recommendation: z.strictObject({
    version: z.string(),
    codename: z.string().optional(),
  }).optional(),
});
export type ReleaseComparison = z.infer<typeof comparisonSchema>;
export const releaseErrorSchema = z.strictObject({
  schema_version: z.literal(RELEASE_SCHEMA_MAJOR),
  error: z.literal("invalid-since"),
  message: z.string(),
});
export type ReleaseInputError = z.infer<typeof releaseErrorSchema>;

/** Join validated records to observed publication; authored dates prove no availability. */
export function releaseCatalogue(
  records: readonly AuthoredRelease[],
  publications: readonly Publication[],
): CatalogueRecord[] {
  const published = new Map<string, Publication>();
  for (const publication of publications) {
    publicationSchema.parse(publication);
    if (published.has(publication.version)) {
      throw new Error(`duplicate publication ${publication.version}`);
    }
    if (!records.some((record) => record.version === publication.version)) {
      throw new Error(
        `published release ${publication.version}: missing retained release record`,
      );
    }
    published.set(publication.version, publication);
  }
  return records.map((record): CatalogueRecord => {
    const publication = published.get(record.version);
    if (
      publication !== undefined && record.date !== undefined &&
      record.date !== publication.date
    ) {
      throw new Error(
        `${record.source}: date ${record.date} disagrees with publication ${publication.date}`,
      );
    }
    return {
      ...publicRelease(record),
      ...(publication === undefined ? {} : { date: publication.date }),
      publication: publication === undefined
        ? "candidate"
        : (parseVersion(record.version).prerelease?.length ?? 0) === 0
        ? "stable"
        : "prerelease",
    };
  }).sort((a, b) => compareVersions(b.version, a.version));
}

/** Reject empty, repeated, prefixed, or malformed versions without coercion. */
export function parseSince(query: URLSearchParams): string | undefined {
  const values = query.getAll("since");
  if (values.length === 0) return undefined;
  if (values.length !== 1) {
    throw new Error("Supply since once, as a SemVer such as 2.3.4.");
  }
  const value = values[0] ?? "";
  try {
    parseVersion(value);
  } catch (cause) {
    throw new Error(
      "since must be a complete SemVer, without a v prefix or surrounding spaces. Encode a build-metadata + as %2B.",
      { cause },
    );
  }
  return value;
}

/** Select semantic sets once; projections never select or compare independently. */
export function compareReleases(
  records: readonly CatalogueRecord[],
  since?: string,
): ReleaseComparison {
  if (since !== undefined) parseVersion(since);
  const sorted = [...records].sort((a, b) =>
    compareVersions(b.version, a.version)
  );
  const stable = sorted.filter((record) => record.publication === "stable");
  const latest_stable = stable[0];
  const precedence = since !== undefined && latest_stable !== undefined
    ? compareVersions(since, latest_stable.version)
    : undefined;
  const status: ReleaseComparison["status"] = latest_stable === undefined
    ? "no-stable-release"
    : since === undefined
    ? "index"
    : precedence === 0
    ? "current"
    : precedence !== undefined && precedence > 0
    ? "ahead"
    : "update-available";
  const earliest_known = sorted.filter((record) =>
    record.publication !== "candidate"
  ).at(-1)?.version;
  return {
    schema_version: RELEASE_SCHEMA_MAJOR,
    ...(since === undefined ? {} : { since }),
    status,
    ...(latest_stable === undefined ? {} : { latest_stable }),
    applicable: stable.filter((record) =>
      since === undefined || compareVersions(record.version, since) > 0
    ),
    history: {
      stable,
      prereleases: sorted.filter((record) =>
        record.publication === "prerelease"
      ),
      candidates: sorted.filter((record) => record.publication === "candidate"),
    },
    history_coverage: {
      ...(earliest_known === undefined ? {} : { earliest_known }),
      before_earliest_known: since !== undefined &&
        earliest_known !== undefined &&
        compareVersions(since, earliest_known) < 0,
      complete: false,
    },
    urls: {
      ...releaseCheckUrls(since),
      installer: DISCERN_INSTALL_URL,
    },
    ...(latest_stable === undefined || status === "ahead" ? {} : {
      recommendation: {
        version: latest_stable.version,
        ...(latest_stable.codename === undefined
          ? {}
          : { codename: latest_stable.codename }),
      },
    }),
  };
}

/** Publish the same validation spine as an independently versioned result schema. */
export function releaseJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(z.union([comparisonSchema, releaseErrorSchema])),
    $id: RELEASE_SCHEMA_ID,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]:
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
  };
}
