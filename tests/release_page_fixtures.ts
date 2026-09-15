/** Synthetic publication states for the human release page and local visual review. */
import { parseReleaseRecords } from "../site/releases/records.ts";
import {
  type CatalogueRecord,
  releaseCatalogue,
} from "../site/releases/model.ts";
import { loadDocsSite } from "../site/docs.tsx";
import { liveHtmlRoutes, type SiteRouting } from "../site/serve.ts";
import { buildSiteRedirectTable, STATIC_REDIRECTS } from "../site/seo.tsx";

/** Keep visual-review names and release claims confined to synthetic records. */
export function releasePageCatalogue(): CatalogueRecord[] {
  const records = parseReleaseRecords([
    {
      path: "7.8.0.md",
      markdown: `---
summary: A shared place for project instructions and release evidence.
codename: Test family · 星の海
---
## Shared instructions

Keep the project's instructions in one authored source. Review what each coding agent receives before starting work.

## Review the evidence

Read the [shared instructions](#shared-instructions), then inspect the completed change and its check results.`,
    },
    {
      path: "7.8.1.md",
      markdown: `---
summary: Clearer next steps when a project check needs attention.
---
## Check results

A check result names the affected file and the next action. Review the result before running another check.`,
    },
    {
      path: "7.8.2.md",
      markdown: `---
summary: More useful release notes, with the steps to update in one place.
---
## Read before updating

The release page compares the version in your link with published stable versions. It keeps the version, date, and complete notes together.

### Project changes

Review the project diff after applying an upgrade. Keep the changes you intend to adopt and commit them with the rest of your project.

~~~text
A long output line remains readable and selectable on a narrow display, without widening the entire page.
~~~`,
    },
    {
      path: "7.9.0-rc.1.md",
      markdown: `---
summary: A preview build for testing changes before a stable release.
codename: Preview fixture
---
## Preview notes

This is a prerelease. The stable update recommendation remains separate from these notes.`,
    },
    {
      path: "8.0.0.md",
      markdown: `---
summary: Notes for a future version that has not been published.
---
## Upcoming work

An authored record does not establish that a release is available to install.`,
    },
  ]);
  return releaseCatalogue(
    records,
    records.filter((record) => record.version !== "8.0.0").map((
      record,
      index,
    ) => ({
      version: record.version,
      date: `2026-09-${String(14 - index).padStart(2, "0")}`,
    })),
  );
}

/** Share the production route construction across semantic and visual checks. */
export async function releasePageRouting(
  records: readonly CatalogueRecord[],
): Promise<SiteRouting> {
  const site = await loadDocsSite();
  const liveRoutes = liveHtmlRoutes(site);
  return {
    site,
    liveRoutes,
    releases: records,
    redirects: buildSiteRedirectTable(liveRoutes, [], STATIC_REDIRECTS),
  };
}

/** Read canonical update wording separately from package clipboard-control labels. */
export function releaseUpdateSteps(document: Document): string[] {
  return [...document.querySelectorAll("#update li")].map((step) => {
    const copy = step.cloneNode(true) as Element;
    for (const control of copy.querySelectorAll("button")) control.remove();
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}
