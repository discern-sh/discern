/** Product-copy projections of one normalized release comparison. */
import { escapeHtml, renderMarkdownHtml } from "../../src/lib/markdown.ts";
import { siteAppearanceRootAttributes } from "../appearance.ts";
import { designSystemAssetPath } from "../design_system.ts";
import { RELEASE_TITLE } from "../brand.ts";
import { UPDATE_SEQUENCE } from "../../src/shared/product_identity.ts";
import type {
  CatalogueRecord,
  ReleaseComparison,
  ReleaseInputError,
} from "./model.ts";

const CHECK_DISCLOSURE =
  "Version checks use discern.sh. When a link includes your discern version, the site uses it to show what has changed. No project data is sent, and discern itself stays offline.";

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
function comparisonText(model: ReleaseComparison): string[] {
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
    CHECK_DISCLOSURE,
    `Check: ${model.urls.html}`,
    `JSON: ${model.urls.json}`,
    `Installer: ${model.urls.installer}`,
  ].join("\n\n") + "\n";
}

/** A complete accessible shell; the shared handler adds canonical and security metadata. */
function htmlShell(body: string): string {
  return `<!doctype html><html lang="en" ${siteAppearanceRootAttributes()} data-discern-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
    escapeHtml(RELEASE_TITLE)
  }</title><meta name="description" content="Read discern release notes, compare your version with published stable releases, and review the steps for a project upgrade."><link rel="stylesheet" href="${
    designSystemAssetPath("compositions", "fonts.css")
  }"><link rel="stylesheet" href="${
    designSystemAssetPath("compositions", "discern.css")
  }"><script defer src="${
    designSystemAssetPath("compositions", "discern.js")
  }"></script></head><body><main class="discern-article-layout discern-article-layout--no-navigation discern-article-layout--no-rail"><div class="discern-article-layout__columns"><div class="discern-article-layout__body"><h1>discern releases</h1>${body}</div></div></main></body></html>`;
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
          section.records.map((record) =>
            `<article data-release-version="${
              escapeHtml(record.version)
            }"><h3>${escapeHtml(releaseLabel(record))}</h3><p>${
              record.publication === "candidate"
                ? "Not released yet."
                : `Published: ${escapeHtml(record.date ?? "")}`
            }</p><p>${escapeHtml(record.summary)}</p>${
              renderNotes(record, index)
            }</article>`
          ).join("")
        }</section>`
      ).join("") +
      (model.recommendation === undefined
        ? ""
        : `<section><h2>How to update</h2><ol>${
          UPDATE_SEQUENCE.map((step) => `<li>${escapeHtml(step)}</li>`).join("")
        }</ol></section>`) +
      `<details><summary>About version checks</summary><p>${CHECK_DISCLOSURE}</p></details>` +
      `<nav aria-label="Release formats"><a href="${
        escapeHtml(model.urls.json)
      }">JSON</a>${
        model.recommendation === undefined
          ? ""
          : ` · <a href="${escapeHtml(model.urls.installer)}">Installer</a>`
      }</nav>`,
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
