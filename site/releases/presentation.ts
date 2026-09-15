/** Shared release wording and section order for HTML and text projections. */
import { UPDATE_SEQUENCE } from "../../src/shared/product_identity.ts";
import type { CatalogueRecord, ReleaseComparison } from "./model.ts";
/** Describe the actual handoff without implying an installation or a binary network check. */
export function checkDisclosure(model: ReleaseComparison): string {
  return model.since === undefined
    ? "No version was supplied. A discern version link lets this page compare your version with published releases; it sends no project data."
    : `This page received ${model.since} in the URL, with no project data from discern. Opening this page did not update discern. The discern program stays offline.`;
}

/** Decorate a numeric identity without changing its meaning. */
export function releaseLabel(
  record: { version: string; codename?: string | undefined },
): string {
  return record.codename === undefined
    ? record.version
    : `${record.version} — ${record.codename}`;
}

/** Common sections preserve every classified record and the applicable subset. */
export function releaseSections(
  model: ReleaseComparison,
): { key: string; title: string; records: CatalogueRecord[] }[] {
  return [
    {
      key: "applicable",
      title: `Changes since ${model.since}`,
      records: model.applicable,
    },
    { key: "stable", title: "Release notes", records: model.history.stable },
    {
      key: "prereleases",
      title: "Preview releases",
      records: model.history.prereleases,
    },
    {
      key: "candidates",
      title: "Upcoming releases",
      records: model.history.candidates,
    },
  ].filter((section) =>
    section.records.length > 0 &&
    (section.key !== "applicable" || model.since !== undefined)
  );
}

/** Shared state copy contains no presentation markup. */
export function comparisonText(model: ReleaseComparison): string[] {
  const latest = model.latest_stable === undefined
    ? ""
    : releaseLabel(model.latest_stable);
  const statusText: Record<ReleaseComparison["status"], string> = {
    index: `discern ${latest} is the latest stable release.`,
    current: `discern ${model.since} is up to date.`,
    "update-available":
      `discern ${latest} is available. See what's changed since ${model.since} below.`,
    ahead:
      `discern ${model.since} is newer than the latest stable release (${latest}).`,
    "no-stable-release": model.since === undefined
      ? "The first stable release is still to come."
      : `There isn't a stable release to compare with discern ${model.since} yet.`,
  };
  return [
    statusText[model.status],
    ...(model.history_coverage.before_earliest_known
      ? [
        `These notes start at discern ${model.history_coverage.earliest_known}. Changes between ${model.since} and that version aren't covered here.`,
      ]
      : []),
  ];
}

/** Render plain text directly from semantic records, including the note bodies. */
export function renderReleaseText(model: ReleaseComparison): string {
  return [
    "discern releases",
    `Status: ${model.status}`,
    ...comparisonText(model),
    ...releaseSections(model).flatMap((
      section,
    ) => [
      section.title,
      ...section.records.flatMap((
        record,
      ) => [
        releaseLabel(record),
        record.publication === "candidate"
          ? "Not released yet."
          : `Published: ${record.date}`,
        record.summary,
        record.body,
      ]),
    ]),
    ...(model.recommendation === undefined
      ? []
      : ["How to update", ...UPDATE_SEQUENCE]),
    "About version checks",
    checkDisclosure(model),
    `Check: ${model.urls.html}`,
    `JSON: ${model.urls.json}`,
    `Installer: ${model.urls.installer}`,
  ].join("\n\n") + "\n";
}
