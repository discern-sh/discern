/** Release comparison and history composed from the published React adapters. */
import type { ReactElement } from "react";
import {
  Button,
  Card,
  Command,
  Heading,
  Kicker,
  Tag,
} from "discern-design-system/react";
import { RELEASE_TITLE } from "../../brand.ts";
import {
  INSTALL_COMMAND,
  RELEASE_ROUTES,
  UPDATE_SEQUENCE,
} from "../../../src/shared/product_identity.ts";
import type {
  CatalogueRecord,
  ReleaseComparison,
  ReleaseInputError,
} from "../../releases/model.ts";
import {
  checkDisclosure,
  comparisonText,
  releaseLabel,
  releaseSections,
} from "../../releases/presentation.ts";
import { renderDocument } from "../Document.tsx";
import { MarketingLayout } from "../layouts/MarketingLayout.tsx";
import { Markdown } from "../components/Markdown.tsx";

const RESULT_HEADINGS: Record<ReleaseComparison["status"], string> = {
  index: "discern releases",
  current: "You're up to date.",
  "update-available": "A new version is available.",
  ahead: "You're ahead of the stable release.",
  "no-stable-release": "Before the first stable release.",
};

/** Stable numeric anchors remain valid across release names and comparisons. */
function releaseAnchor(record: CatalogueRecord): string {
  return `release-${record.version}`;
}

/** Names remain secondary to the complete numeric identity. */
function Version(
  { record }: {
    readonly record: { version: string; codename?: string | undefined };
  },
): ReactElement {
  return (
    <>
      <span className="releases-version">{record.version}</span>
      {record.codename === undefined
        ? null
        : <span className="releases-codename">{record.codename}</span>}
    </>
  );
}

/** Display supplied and recommended versions without duplicating comparison policy. */
function VersionCard(
  { model }: { readonly model: ReleaseComparison },
): ReactElement | null {
  if (model.latest_stable === undefined && model.since === undefined) {
    return null;
  }
  return (
    <Card padding="lg" className="releases-comparison">
      <dl>
        {model.since === undefined ? null : (
          <div>
            <dt>Version in your link</dt>
            <dd>
              <Version record={{ version: model.since }} />
            </dd>
          </div>
        )}
        {model.latest_stable === undefined ? null : (
          <div>
            <dt>Latest stable release</dt>
            <dd>
              <Version record={model.latest_stable} />
            </dd>
          </div>
        )}
      </dl>
      {model.status === "update-available"
        ? <Button href="#update">Review the update steps</Button>
        : null}
    </Card>
  );
}

/** Applicable records point to their single complete history entry. */
function ApplicableNotes(
  { model }: { readonly model: ReleaseComparison },
): ReactElement | null {
  if (model.status !== "update-available") return null;
  const count = model.applicable.length;
  return (
    <section
      className="releases-applicable"
      data-release-group="applicable"
      aria-labelledby="applicable-heading"
    >
      <Heading level={2} id="applicable-heading">
        {count} stable {count === 1 ? "release" : "releases"} since{" "}
        {model.since}
      </Heading>
      <ol>
        {model.applicable.map((record) => (
          <li key={record.version}>
            <a
              data-release-ref={record.version}
              href={`#${releaseAnchor(record)}`}
            >
              {releaseLabel(record)}
            </a>
            <span>{record.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Publication facts come only from the normalized catalogue. */
function Publication(
  { record }: { readonly record: CatalogueRecord },
): ReactElement | null {
  if (record.publication === "candidate") return <span>Not released yet.</span>;
  if (record.date === undefined) return null;
  return (
    <time dateTime={record.date}>
      {new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" })
        .format(new Date(record.date))}
    </time>
  );
}

/** Render notes once in full, with package Markdown scoped beneath each release heading. */
function HistorySection(
  { section, model }: {
    readonly section: ReturnType<typeof releaseSections>[number];
    readonly model: ReleaseComparison;
  },
): ReactElement {
  return (
    <section
      className="releases-history"
      data-release-group={section.key}
      aria-labelledby={`${section.key}-heading`}
    >
      <Heading
        level={2}
        id={`${section.key}-heading`}
        className="releases-section-heading"
      >
        {section.title}
      </Heading>
      {section.records.map((record) => (
        <article
          key={record.version}
          id={releaseAnchor(record)}
          data-release-version={record.version}
          data-release-publication={record.publication}
          className="releases-entry"
        >
          <div className="releases-entry-meta">
            <Publication record={record} />
            <Tag>
              {record.publication === "stable"
                ? record.version === model.latest_stable?.version
                  ? "Latest stable"
                  : "Stable"
                : record.publication === "prerelease"
                ? "Prerelease"
                : "Unpublished"}
            </Tag>
          </div>
          <div className="releases-entry-content">
            <Heading level={3}>
              <a href={`#${releaseAnchor(record)}`}>
                <Version record={record} />
              </a>
            </Heading>
            <p className="releases-summary">{record.summary}</p>
            <Markdown
              source={record.body}
              idPrefix={`${releaseAnchor(record)}-`}
              firstHeadingLevel={4}
              className="releases-notes"
            />
          </div>
        </article>
      ))}
    </section>
  );
}

/** Ordinary anchors and format links work before any browser enhancement loads. */
function HistoryNav(
  { model }: { readonly model: ReleaseComparison },
): ReactElement {
  const sections = releaseSections(model).filter((section) =>
    section.key !== "applicable"
  );
  const query = model.since === undefined
    ? ""
    : `?${new URLSearchParams({ since: model.since })}`;
  return (
    <aside className="releases-rail">
      {sections.length === 0 ? null : (
        <nav aria-label="On this page">
          <Kicker className="releases-eyebrow">On this page</Kicker>
          {sections.map((section) => (
            <div key={section.key} className="releases-rail-group">
              <a
                className="releases-rail-title"
                href={`#${section.key}-heading`}
              >
                {section.title}
              </a>
              <ul>
                {section.records.map((record) => (
                  <li key={record.version}>
                    <a href={`#${releaseAnchor(record)}`}>
                      {releaseLabel(record)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {model.status === "update-available"
            ? (
              <a className="releases-rail-title" href="#update">
                How to update
              </a>
            )
            : null}
        </nav>
      )}
      <nav className="releases-formats" aria-label="Release formats">
        <a href={model.urls.json}>JSON</a>
        <a href={`${RELEASE_ROUTES.text}${query}`}>Plain text</a>
      </nav>
    </aside>
  );
}

/** Place the canonical command within the canonical update sequence. */
function UpdateSteps(
  { model }: { readonly model: ReleaseComparison },
): ReactElement | null {
  if (model.status !== "update-available") return null;
  return (
    <Card
      padding="lg"
      id="update"
      className="releases-update"
      role="region"
      aria-labelledby="update-heading"
    >
      <Heading level={2} id="update-heading">How to update</Heading>
      <p>
        Read the notes, then choose when to update your installation and
        project.
      </p>
      <ol>
        {UPDATE_SEQUENCE.map((step) => {
          const commandIndex = step.indexOf(INSTALL_COMMAND);
          return (
            <li key={step}>
              {commandIndex < 0 ? step : (
                <>
                  {step.slice(0, commandIndex)}
                  <Command
                    command={INSTALL_COMMAND}
                    className="releases-command"
                  />
                  {step.slice(commandIndex + INSTALL_COMMAND.length)}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <a href={model.urls.installer}>Read the installer script</a>
    </Card>
  );
}

/** The model determines content; React and the package determine markup. */
function ReleasesPage(
  { model }: { readonly model: ReleaseComparison },
): ReactElement {
  return (
    <MarketingLayout mainClassName="releases-main">
      <section
        className="releases-hero"
        aria-labelledby="result-heading"
        data-release-status={model.status}
      >
        <div className="releases-intro">
          <Kicker className="releases-eyebrow">Release notes</Kicker>
          <Heading level={1} id="result-heading" className="releases-title">
            {RESULT_HEADINGS[model.status]}
          </Heading>
          {comparisonText(model).map((line) => (
            <p className="releases-result-summary" key={line}>{line}</p>
          ))}
          {model.status !== "no-stable-release"
            ? null
            : (
              <p className="releases-context">
                {model.history.prereleases.length > 0
                  ? "Prereleases are available to read below. A stable installation is not recommended yet."
                  : model.history.candidates.length > 0
                  ? "Read the upcoming notes below. Published releases will appear here when they're available."
                  : "No release notes are available yet."}
              </p>
            )}
          <p className="releases-disclosure" data-release-disclosure="">
            {checkDisclosure(model)} <a href="/trust">About local control</a>
          </p>
        </div>
        <VersionCard model={model} />
      </section>
      <ApplicableNotes model={model} />
      <div className="releases-layout">
        <HistoryNav model={model} />
        <div className="releases-content">
          {releaseSections(model).filter((section) =>
            section.key !== "applicable"
          ).map((section) => (
            <HistorySection key={section.key} section={section} model={model} />
          ))}
          <UpdateSteps model={model} />
        </div>
      </div>
    </MarketingLayout>
  );
}

const RELEASE_DOCUMENT = {
  appearance: "mono",
  styles: ["fonts.css", "discern.css", "releases.css"],
  scripts: ["discern.js"],
  bodyClassName: "releases-page",
} as const;

/** Render each validated comparison using the shared document. */
export function renderReleaseHtml(model: ReleaseComparison): string {
  const summary = comparisonText(model)[0];
  return renderDocument({
    ...RELEASE_DOCUMENT,
    title: model.since === undefined
      ? RELEASE_TITLE
      : `${RESULT_HEADINGS[model.status]} · ${RELEASE_TITLE}`,
    description: `${
      summary ?? "Read discern release notes."
    } Read the release notes and compare published versions of discern.`,
    children: <ReleasesPage model={model} />,
  });
}

/** Invalid queries keep complete navigation and a useful next action. */
export function renderReleaseErrorHtml(error: ReleaseInputError): string {
  return renderDocument({
    ...RELEASE_DOCUMENT,
    title: `Invalid version link · ${RELEASE_TITLE}`,
    description:
      "Read discern release notes, compare your version with published stable releases, and review the steps for a project upgrade.",
    children: (
      <MarketingLayout mainClassName="releases-main">
        <section
          className="releases-hero"
          data-release-status="invalid"
          aria-labelledby="result-heading"
        >
          <div className="releases-intro">
            <Kicker className="releases-eyebrow">Release notes</Kicker>
            <Heading level={1} id="result-heading" className="releases-title">
              This version link needs a correction.
            </Heading>
            <p className="releases-result-summary">{error.message}</p>
            <p>
              Use a single version in the <code>since</code>{" "}
              parameter, or browse the release notes without a comparison.
            </p>
            <Button href={RELEASE_ROUTES.html}>Read all release notes</Button>
          </div>
        </section>
      </MarketingLayout>
    ),
  });
}
