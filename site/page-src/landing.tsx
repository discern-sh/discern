/** The authored homepage, rendered to static HTML by site/build.ts. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  ArticleLayout,
  Brand,
  Button,
  Cluster,
  HeadingAccent,
  LogoCloud,
  Prose,
  PullQuote,
  SiteFooter,
  SkipLink,
} from "discern-design-system/react";
import { PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";

/** The native provider set, in the catalogue's canonical display order. */
const PROVIDER_LOGOS = AGENT_NAMES.map((name) => {
  const provider = PROVIDERS[name];
  return {
    name: provider.label,
    mark: (
      <span className="landing-provider-logo-frame">
        <img
          className="landing-provider-logo"
          src={provider.brand.mark.path}
          alt=""
          width={32}
          height={32}
          decoding="async"
        />
      </span>
    ),
  };
});

/** Static theme toggle wired at runtime by the shared /assets/theme.js. */
function LandingThemeToggle() {
  return (
    <button
      type="button"
      className="discern-theme-toggle landing-masthead__theme"
      aria-label="Switch to the dark theme"
      aria-pressed="false"
      data-theme-toggle
    >
      <span className="discern-theme-toggle__glyph" aria-hidden="true">
        <span data-theme-toggle-glyph="light">☀</span>
        <span data-theme-toggle-glyph="dark">☾</span>
      </span>
    </button>
  );
}

/** Page-owned baseline correction for the Unicode mark and mono wordmark. */
function DiscernName() {
  return <span className="landing-brand-name">discern</span>;
}

interface EditorialIndexItem {
  readonly term: string;
  readonly description: string;
}

function EditorialIndex(
  { label, items }: {
    readonly label: string;
    readonly items: readonly EditorialIndexItem[];
  },
) {
  return (
    <dl className="landing-editorial-index" aria-label={label}>
      {items.map((item) => (
        <div key={item.term}>
          <dt>{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function LandingHero() {
  return (
    <header className="discern-article-header discern-article-header--canvas landing-header">
      <div className="discern-article-header__inner">
        <div className="discern-article-header__copy">
          <h1>
            Engineering discipline for{" "}
            <HeadingAccent>coding agents</HeadingAccent>
          </h1>
          <div className="discern-article-header__standfirst">
            discern gives every coding agent the same project knowledge, keeps
            parallel tasks in separate worktrees, and requires proof that the
            project’s real checks passed before work is called finished.
          </div>
          <div className="discern-article-header__footer">
            <ul className="discern-article-header__meta">
              <li>Free and open source</li>
              <li>Runs offline</li>
              <li>No API key</li>
              <li>Not an AI</li>
            </ul>
            <div className="discern-article-header__actions">
              <Cluster gap={4}>
                <Button href="/docs/getting-started/quickstart">
                  Install discern
                </Button>
                <Button href="/docs" variant="secondary">
                  Read the manual
                </Button>
              </Cluster>
            </div>
          </div>
        </div>
      </div>
      <LogoCloud
        className="landing-integrations"
        aria-label={`${PROVIDER_LOGOS.length} native coding agent integrations`}
        items={PROVIDER_LOGOS}
      />
    </header>
  );
}

function LandingBenefits() {
  return (
    <>
      <section
        className="landing-benefit"
        aria-labelledby="landing-quality-title"
      >
        <ArticleLayout
          className="landing-benefit__layout"
          railLabel="Quality rules in brief"
          rail={
            <EditorialIndex
              label="Quality rules in brief"
              items={[
                { term: "Minimums", description: "Can only rise" },
                { term: "Maximums", description: "Can only fall" },
                { term: "Weaker limits", description: "Fail the check" },
              ]}
            />
          }
        >
          <Prose className="landing-benefit__copy" measure="wide">
            <span className="landing-benefit__eyebrow">Quality rules</span>
            <h2 id="landing-quality-title">
              Quality can only move one way.
            </h2>
            <p>
              Set a minimum or maximum for what matters. Discern lets the limit
              move only towards better quality. A change that weakens it fails,
              even when a coding agent would rather call the work finished.
            </p>
          </Prose>
        </ArticleLayout>
      </section>

      <section
        className="landing-benefit landing-benefit--memory"
        aria-labelledby="landing-memory-title"
      >
        <ArticleLayout
          className="landing-benefit__layout"
          railLabel="The knowledge Discern keeps"
          rail={
            <EditorialIndex
              label="The knowledge Discern keeps"
              items={[
                { term: "Instructions", description: "Write once" },
                { term: "Methods", description: "Reuse next time" },
                { term: "Project guide", description: "Checked with the code" },
              ]}
            />
          }
        >
          <Prose className="landing-benefit__copy" measure="wide">
            <span className="landing-benefit__eyebrow">Project memory</span>
            <h2 id="landing-memory-title">
              What the project learns stays learned.
            </h2>
            <p>
              Write the instructions once. Save a hard-won method as a reusable
              guide. Keep the project guide tied to the files it explains. The
              next coding agent starts from the same knowledge instead of
              discovering it all again.
            </p>
          </Prose>
        </ArticleLayout>
      </section>

      <section
        className="landing-footprint"
        aria-label="A small local footprint"
      >
        <div className="landing-footprint__inner">
          <PullQuote
            className="landing-footprint__quote"
            align="inline"
            quote="One self-contained program. One tracked settings file. Nothing watching in the background."
            attribution="Small by design"
          />
          <p className="landing-footprint__note">
            Discern runs offline, keeps its activity record on your computer,
            and leaves the finished app alone.
          </p>
        </div>
      </section>
    </>
  );
}

function LandingPage() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <header className="landing-masthead">
        <a href="/" className="landing-masthead__brand">
          <Brand
            mark={DISCERN_MARK}
            name={<DiscernName />}
            size="lg"
            typeface="mono"
          />
        </a>
        <nav className="landing-masthead__nav" aria-label="Site">
          <a href="/docs">Docs</a>
          <a href={GITHUB}>GitHub ↗</a>
          <LandingThemeToggle />
        </nav>
      </header>
      <main id="main">
        <LandingHero />

        <section
          className="landing-control"
          aria-labelledby="landing-control-title"
        >
          <div className="landing-control__summary">
            <h2 id="landing-control-title">
              Your project decides when work is finished.
            </h2>
            <p>
              <code>discern done</code>{" "}
              runs your project’s real checks, stops quality from slipping, and
              gives you proof tied to the code you’re reviewing.
            </p>
          </div>
          <dl className="landing-control__facts">
            <div>
              <dt>Same project knowledge</dt>
              <dd>
                Write the project guidance once. Every supported coding agent
                reads the same instructions.
              </dd>
            </div>
            <div>
              <dt>Parallel work stays separate</dt>
              <dd>
                Each task gets its own branch and worktree, so agents do not
                interfere with one another.
              </dd>
            </div>
            <div>
              <dt>Proof for review</dt>
              <dd>
                A passing run records the checks and the exact commit you’re
                reviewing.
              </dd>
            </div>
          </dl>
        </section>
        <LandingBenefits />
      </main>
      <SiteFooter
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="One binary that gives every coding agent the same project instructions, separates parallel tasks, and proves the project’s checks passed."
        groups={[
          {
            title: "Documentation",
            links: [
              {
                label: "Quickstart",
                href: "/docs/getting-started/quickstart",
              },
              { label: "Concepts", href: "/docs/orientation/concepts" },
              { label: "The quality gate", href: "/docs/quality-gate" },
              {
                label: "Trust & your data",
                href: "/docs/orientation/trust-and-data",
              },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: GITHUB },
              { label: "Releases", href: `${GITHUB}/releases/latest` },
              { label: "Decisions", href: "/docs/decisions" },
              { label: "FAQ", href: "/docs/getting-started/faq" },
            ],
          },
        ]}
        legal="Open source under Apache-2.0."
        meta="macOS · Linux · WSL2"
      />
    </>
  );
}

/** Render the homepage for static serving. */
export function renderLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "landing.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
