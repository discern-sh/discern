/** Product-copy projections of one normalized release comparison. */
import { semanticClass } from "discern-design-system";
import { escapeHtml, renderMarkdownHtml } from "../../src/lib/markdown.ts";
import { siteAppearanceRootAttributes } from "../appearance.ts";
import { designSystemAssetPath } from "../design_system.ts";
import { DISCERN_FAVICON_PATH, DISCERN_MARK, RELEASE_TITLE } from "../brand.ts";
import {
  THEME_BOOTSTRAP,
  THEME_SCRIPT_PATH,
  THEME_STYLESHEET_PATH,
} from "../theme.ts";
import {
  INSTALL_COMMAND,
  RELEASE_ROUTES,
  UPDATE_SEQUENCE,
} from "../../src/shared/product_identity.ts";
import type {
  CatalogueRecord,
  ReleaseComparison,
  ReleaseInputError,
} from "./model.ts";

/** Describe the actual handoff without implying an installation or a binary network check. */
function checkDisclosure(model: ReleaseComparison): string {
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
    checkDisclosure(model),
    `Check: ${model.urls.html}`,
    `JSON: ${model.urls.json}`,
    `Installer: ${model.urls.installer}`,
  ].join("\n\n") + "\n";
}

/** Render the package's framework-neutral semantic contract; its CSS stays package-owned. */
function ds(component: string, element?: string, modifier?: string): string {
  return semanticClass(component, {
    ...(element === undefined ? {} : { element }),
    ...(modifier === undefined ? {} : { modifier }),
  });
}

/** Shared site identity and theme behavior in a request-rendered document. */
function htmlShell(
  body: string,
  title = RELEASE_TITLE,
  description =
    "Read discern release notes, compare your version with published stable releases, and review the steps for a project upgrade.",
): string {
  const brand =
    `<span aria-hidden="true">${DISCERN_MARK}</span> <span>discern</span>`;
  return `<!doctype html>
<html lang="en" ${
    siteAppearanceRootAttributes("mono")
  } data-discern-theme="light">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${
    escapeHtml(description)
  }">
<link rel="icon" href="${DISCERN_FAVICON_PATH}">
<script>${THEME_BOOTSTRAP}</script>
${
    ["fonts.css", "discern.css", "releases.css"].map((file) =>
      `<link rel="stylesheet" href="${
        designSystemAssetPath("compositions", file)
      }">`
    ).join("\n")
  }
<link rel="stylesheet" href="${THEME_STYLESHEET_PATH}">
<script defer src="${THEME_SCRIPT_PATH}"></script>
<script defer src="${
    designSystemAssetPath("compositions", "discern.js")
  }"></script>
</head>
<body class="releases-page">
<a class="${ds("skip-link")}" href="#main">Skip to content</a>
<header class="${ds("site-header")} ${
    ds("site-header", undefined, "campaign")
  }">
  <div class="${ds("site-header", "inner")} releases-chrome">
    <a class="${ds("site-header", "brand")} ${
    ds("site-header", "brand", "mono")
  }" href="/">${brand}</a>
    <nav class="${
    ds("site-header", "nav")
  }" aria-label="Site"><a href="/docs">Manual</a><a href="${RELEASE_ROUTES.html}" aria-current="page">Releases</a></nav>
    <div class="${ds("site-header", "actions")}">
      <button type="button" class="${ds("theme-toggle")} ${
    ds("theme-toggle", undefined, "outlined")
  }" aria-label="Switch to the dark theme" aria-pressed="false" data-theme-toggle>
        <span class="${
    ds("theme-toggle", "glyph")
  }" aria-hidden="true"><span data-theme-toggle-glyph="light">☀</span><span data-theme-toggle-glyph="dark">☾</span></span>
      </button>
    </div>
  </div>
</header>
<main id="main" class="releases-main">${body}</main>
<footer class="${ds("site-footer")}"><div class="${
    ds("site-footer", "inner")
  } releases-chrome">
  <div class="${ds("site-footer", "brand-column")}"><a class="${
    ds("site-footer", "brand")
  } ${ds("site-footer", "brand", "mono")}" href="/">${brand}</a><p class="${
    ds("site-footer", "description")
  }">The details are in the manual.</p></div>
  <nav class="${
    ds("site-footer", "nav")
  }" aria-label="Footer"><div><h2>Explore discern</h2><ul><li><a href="/docs">Read the manual</a></li><li><a href="/trust">How discern works locally</a></li></ul></div></nav>
</div></footer>
</body></html>`;
}

/** Stable links follow numeric identities across comparisons, names, and new records. */
function releaseAnchor(record: CatalogueRecord): string {
  return `release-${record.version}`;
}

/** Scope note anchors to their release and place authored headings below its h3. */
function renderNotes(record: CatalogueRecord): string {
  const prefix = `${releaseAnchor(record)}-`;
  const html = renderMarkdownHtml(record.body).html;
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) =>
    Number(match[1])
  );
  const offset = 4 - Math.min(...levels);
  return html
    .replace(
      /id="([^"]*)"/g,
      (_match, id: string) => `id="${escapeHtml(prefix)}${id}"`,
    )
    .replace(
      /href="#([^"]*)"/g,
      (_match, id: string) => `href="#${escapeHtml(prefix)}${id}"`,
    )
    .replace(
      /<(\/?)h([1-6])\b/g,
      (_match, slash: string, level: string) =>
        `<${slash}h${Math.min(6, Number(level) + offset)}`,
    );
}

/** Distinct state headings all lead to the same complete, readable history. */
const RESULT_HEADINGS: Record<ReleaseComparison["status"], string> = {
  index: "discern releases",
  current: "You're up to date.",
  "update-available": "A new version is available.",
  ahead: "You're ahead of the stable release.",
  "no-stable-release": "Before the first stable release.",
};

/** Names remain a secondary label beside the complete numeric identity. */
function versionMarkup(
  record: { version: string; codename?: string | undefined },
): string {
  return `<span class="releases-version">${escapeHtml(record.version)}</span>${
    record.codename === undefined
      ? ""
      : `<span class="releases-codename">${escapeHtml(record.codename)}</span>`
  }`;
}

/** The comparison card displays the model's supplied and recommended identities. */
function versionCard(model: ReleaseComparison): string {
  if (model.latest_stable === undefined && model.since === undefined) return "";
  return `<div class="${ds("card")} ${
    ds("card", undefined, "pad-lg")
  } releases-comparison"><dl>
    ${
    model.since === undefined
      ? ""
      : `<div><dt>Version in your link</dt><dd>${
        versionMarkup({ version: model.since })
      }</dd></div>`
  }
    ${
    model.latest_stable === undefined
      ? ""
      : `<div><dt>Latest stable release</dt><dd>${
        versionMarkup(model.latest_stable)
      }</dd></div>`
  }
  </dl>${
    model.status === "update-available"
      ? `<a class="${ds("button")} ${
        ds("button", undefined, "primary")
      }" href="#update"><span class="${
        ds("button", "label")
      }">Review the update steps</span></a>`
      : ""
  }</div>`;
}

/** Applicable records link to their single full entry; earlier notes stay within reach. */
function applicableNotes(model: ReleaseComparison): string {
  if (model.status !== "update-available") return "";
  const count = model.applicable.length;
  return `<section class="releases-applicable" data-release-group="applicable" aria-labelledby="applicable-heading">
<h2 id="applicable-heading">${count} stable ${
    count === 1 ? "release" : "releases"
  } since ${escapeHtml(model.since ?? "")}</h2>
<ol>${
    model.applicable.map((record) =>
      `<li><a data-release-ref="${escapeHtml(record.version)}" href="#${
        escapeHtml(releaseAnchor(record))
      }">${escapeHtml(releaseLabel(record))}</a><span>${
        escapeHtml(record.summary)
      }</span></li>`
    ).join("")
  }</ol></section>`;
}

/** Dates and publication labels derive only from the normalized catalogue. */
function publicationMarkup(record: CatalogueRecord): string {
  if (record.publication === "candidate") {
    return "<span>Not released yet.</span>";
  }
  return record.date === undefined
    ? ""
    : `<time datetime="${escapeHtml(record.date)}">${
      escapeHtml(
        new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" })
          .format(new Date(record.date)),
      )
    }</time>`;
}

/** Render each complete note once, without hiding changes behind disclosure controls. */
function historySection(
  section: ReturnType<typeof releaseSections>[number],
  model: ReleaseComparison,
): string {
  return `<section class="releases-history" data-release-group="${section.key}" aria-labelledby="${section.key}-heading">
<h2 id="${section.key}-heading" class="releases-section-heading">${section.title}</h2>
${
    section.records.map((record) =>
      `<article id="${
        escapeHtml(releaseAnchor(record))
      }" data-release-version="${
        escapeHtml(record.version)
      }" data-release-publication="${record.publication}" class="releases-entry">
  <div class="releases-entry-meta">${publicationMarkup(record)}<span class="${
        ds("tag")
      }">${
        record.publication === "stable"
          ? (record.version === model.latest_stable?.version
            ? "Latest stable"
            : "Stable")
          : record.publication === "prerelease"
          ? "Prerelease"
          : "Unpublished"
      }</span></div>
  <div class="releases-entry-content"><h3><a href="#${
        escapeHtml(releaseAnchor(record))
      }">${versionMarkup(record)}</a></h3><p class="releases-summary">${
        escapeHtml(record.summary)
      }</p><div class="releases-notes">${renderNotes(record)}</div></div>
</article>`
    ).join("")
  }</section>`;
}

/** Give long histories an ordinary anchor navigation that works without scripts. */
function historyNav(model: ReleaseComparison): string {
  const hasHistory = Object.values(model.history).some((records) =>
    records.length > 0
  );
  return `<aside class="releases-rail">${
    hasHistory
      ? `<nav aria-label="On this page"><p class="${
        ds("kicker")
      } releases-eyebrow">On this page</p>${
        releaseSections(model).filter((section) => section.key !== "applicable")
          .map((section) =>
            `<div class="releases-rail-group"><a class="releases-rail-title" href="#${section.key}-heading">${section.title}</a><ul>${
              section.records.map((record) =>
                `<li><a href="#${escapeHtml(releaseAnchor(record))}">${
                  escapeHtml(releaseLabel(record))
                }</a></li>`
              ).join("")
            }</ul></div>`
          ).join("")
      }${
        model.status === "update-available"
          ? '<a class="releases-rail-title" href="#update">How to update</a>'
          : ""
      }</nav>`
      : ""
  }<nav class="releases-formats" aria-label="Release formats"><a href="${
    escapeHtml(model.urls.json)
  }">JSON</a><a href="${RELEASE_ROUTES.text}${
    model.since === undefined
      ? ""
      : `?${escapeHtml(new URLSearchParams({ since: model.since }).toString())}`
  }">Plain text</a></nav></aside>`;
}

/** Format the canonical installer in place within the canonical update sequence. */
function updateSteps(model: ReleaseComparison): string {
  if (model.status !== "update-available") return "";
  return `<section id="update" class="${ds("card")} ${
    ds("card", undefined, "pad-lg")
  } releases-update" aria-labelledby="update-heading">
<h2 id="update-heading">How to update</h2><p>Read the notes, then choose when to update your installation and project.</p>
<ol>${
    UPDATE_SEQUENCE.map((step) => {
      const escaped = escapeHtml(step);
      const command = `<figure class="${
        ds("command")
      } releases-command"><div class="${
        ds("command", "execution")
      }"><pre class="${
        ds("command", "text")
      }" tabindex="0" role="group" aria-label="Scrollable installer command"><code>${
        escapeHtml(INSTALL_COMMAND)
      }</code></pre></div></figure>`;
      return `<li>${
        escaped.includes(escapeHtml(INSTALL_COMMAND))
          ? escaped.replace(escapeHtml(INSTALL_COMMAND), command)
          : escaped
      }</li>`;
    }).join("")
  }</ol><a href="${
    escapeHtml(model.urls.installer)
  }">Read the installer script</a></section>`;
}

/** Render query-dependent HTML on the server without requiring JavaScript. */
export function renderReleaseHtml(model: ReleaseComparison): string {
  const heading = RESULT_HEADINGS[model.status];
  const lines = comparisonText(model);
  return htmlShell(
    `<section class="releases-hero" aria-labelledby="result-heading" data-release-status="${model.status}">
<div class="releases-intro"><p class="${
      ds("kicker")
    } releases-eyebrow">Release notes</p><h1 id="result-heading" class="${
      ds("heading")
    } releases-title">${escapeHtml(heading)}</h1>${
      lines.map((line) =>
        `<p class="releases-result-summary">${escapeHtml(line)}</p>`
      ).join("")
    }
${
      model.status === "no-stable-release"
        ? `<p class="releases-context">${
          model.history.prereleases.length > 0
            ? "Prereleases are available to read below. A stable installation is not recommended yet."
            : model.history.candidates.length > 0
            ? "Read the upcoming notes below. Published releases will appear here when they're available."
            : "No release notes are available yet."
        }</p>`
        : ""
    }
<p class="releases-disclosure" data-release-disclosure>${
      escapeHtml(checkDisclosure(model))
    } <a href="/trust">About local control</a></p></div>${
      versionCard(model)
    }</section>
${applicableNotes(model)}
<div class="releases-layout">${
      historyNav(model)
    }<div class="releases-content">${
      releaseSections(model).filter((section) => section.key !== "applicable")
        .map((section) => historySection(section, model)).join("")
    }${updateSteps(model)}</div></div>`,
    model.since === undefined ? RELEASE_TITLE : `${heading} · ${RELEASE_TITLE}`,
    lines[0] === undefined
      ? undefined
      : `${
        lines[0]
      } Read the release notes and compare published versions of discern.`,
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
    `<section class="releases-hero" data-release-status="invalid" aria-labelledby="result-heading"><div class="releases-intro"><p class="${
      ds("kicker")
    } releases-eyebrow">Release notes</p><h1 id="result-heading" class="releases-title">This version link needs a correction.</h1><p class="releases-result-summary">${
      escapeHtml(error.message)
    }</p><p>Use a single version in the <code>since</code> parameter, or browse the release notes without a comparison.</p><a class="${
      ds("button")
    } ${
      ds("button", undefined, "primary")
    }" href="${RELEASE_ROUTES.html}"><span class="${
      ds("button", "label")
    }">Read all release notes</span></a></div></section>`,
    `Invalid version link · ${RELEASE_TITLE}`,
  );
}
