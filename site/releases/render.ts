/** Product-copy projections of one normalized release comparison. */
import { escapeHtml, renderMarkdownHtml } from "../../src/lib/markdown.ts";
import { RELEASE_TITLE } from "../brand.ts";
import { UPDATE_SEQUENCE } from "../../src/shared/product_identity.ts";
import type {
  CatalogueRecord,
  ReleaseComparison,
  ReleaseInputError,
} from "./model.ts";

const CHECK_DISCLOSURE =
  "Opening or fetching this page contacts discern.sh and includes the supplied discern version. It sends no project data. The binary makes no network request.";
const STATUS_TEXT: Record<ReleaseComparison["status"], string> = {
  index: "Release history",
  current: "Your version matches the latest stable release.",
  "update-available": "A newer stable release is available.",
  ahead:
    "Your version is ahead of the stable line. No downgrade is recommended.",
  "no-stable-release":
    "No stable release is published. There is no default installation recommendation.",
};

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
      title: "Applicable stable releases",
      records: model.applicable,
    },
    { key: "stable", title: "Stable history", records: model.history.stable },
    {
      key: "prereleases",
      title: "Prerelease history",
      records: model.history.prereleases,
    },
    {
      key: "candidates",
      title: "Unpublished candidates",
      records: model.history.candidates,
    },
  ];
}

/** Shared state copy contains no presentation markup. */
function comparisonText(model: ReleaseComparison): string[] {
  return [
    `Status: ${model.status}`,
    STATUS_TEXT[model.status],
    ...(model.since === undefined ? [] : [`Supplied version: ${model.since}`]),
    ...(model.latest_stable === undefined
      ? []
      : [`Latest stable: ${releaseLabel(model.latest_stable)}`]),
    "This catalogue contains retained history. Earlier releases may be absent.",
    ...(model.history_coverage.before_earliest_known
      ? ["Your version is older than the earliest retained published record."]
      : []),
    CHECK_DISCLOSURE,
  ];
}

/** Render plain text directly from semantic records, including the note bodies. */
export function renderReleaseText(model: ReleaseComparison): string {
  return [
    "discern releases",
    ...comparisonText(model),
    ...releaseSections(model).flatMap((
      section,
    ) => [
      section.title,
      ...(section.records.length === 0 ? ["None."] : section.records.flatMap((
        record,
      ) => [
        releaseLabel(record),
        record.publication === "candidate"
          ? "Not published."
          : `Published: ${record.date}`,
        record.summary,
        record.body,
      ])),
    ]),
    ...(model.recommendation === undefined
      ? []
      : ["Update sequence", ...UPDATE_SEQUENCE]),
    `Check: ${model.urls.html}`,
    `JSON: ${model.urls.json}`,
    `Installer: ${model.urls.installer}`,
  ].join("\n\n") + "\n";
}

/** A complete accessible shell; the shared handler adds canonical and security metadata. */
function htmlShell(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
    escapeHtml(RELEASE_TITLE)
  }</title><meta name="description" content="Read discern release notes, compare your version with published stable releases, and review the steps for a project upgrade."></head><body><main><h1>discern releases</h1>${body}</main></body></html>`;
}

/** Scope authored heading anchors to their release and section on a shared page. */
function renderNotes(record: CatalogueRecord, section: number): string {
  const prefix = `release-${section}-${record.version}-`;
  return renderMarkdownHtml(record.body).html
    .replace(
      /id="([^"]*)"/g,
      (_match, id: string) => `id="${escapeHtml(prefix)}${id}"`,
    )
    .replace(
      /href="#([^"]*)"/g,
      (_match, id: string) => `href="#${escapeHtml(prefix)}${id}"`,
    )
    .replace(
      /<(\/?)(h[1-6])\b/g,
      (_match, slash: string, tag: string) =>
        `<${slash}h${Math.min(6, Number(tag.slice(1)) + 3)}`,
    );
}

/** Render query-dependent HTML on the server without requiring JavaScript. */
export function renderReleaseHtml(model: ReleaseComparison): string {
  return htmlShell(
    `<section aria-label="Release comparison" data-release-status="${model.status}">${
      comparisonText(model).map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    }</section>` +
      releaseSections(model).map((section, index) =>
        `<section data-release-group="${section.key}" aria-labelledby="release-section-${index}"><h2 id="release-section-${index}">${section.title}</h2>${
          section.records.length === 0
            ? "<p>None.</p>"
            : section.records.map((record) =>
              `<article data-release-version="${
                escapeHtml(record.version)
              }"><h3>${escapeHtml(releaseLabel(record))}</h3><p>${
                record.publication === "candidate"
                  ? "Not published."
                  : `Published: ${escapeHtml(record.date ?? "")}`
              }</p><p>${escapeHtml(record.summary)}</p>${
                renderNotes(record, index)
              }</article>`
            ).join("")
        }</section>`
      ).join("") +
      (model.recommendation === undefined
        ? ""
        : `<section><h2>Update sequence</h2><ol>${
          UPDATE_SEQUENCE.map((step) => `<li>${escapeHtml(step)}</li>`).join("")
        }</ol></section>`) +
      `<nav aria-label="Release formats"><a href="${
        escapeHtml(model.urls.json)
      }">JSON</a> · <a href="${
        escapeHtml(model.urls.installer)
      }">Installer</a></nav>`,
  );
}

/** Invalid queries retain a useful explanation in every negotiated representation. */
export function renderReleaseError(
  error: ReleaseInputError,
  format: "html" | "text" | "json",
): string {
  if (format === "json") return JSON.stringify(error);
  if (format === "text") {
    return `Invalid release comparison: ${error.message}\n`;
  }
  return htmlShell(
    `<h2>Invalid release comparison</h2><p>${escapeHtml(error.message)}</p>`,
  );
}
