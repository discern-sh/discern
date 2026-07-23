/** The authored homepage, rendered to static HTML by site/build.ts. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  ArticleHeader,
  Brand,
  Button,
  Cluster,
  HeadingAccent,
  LogoCloud,
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
          className={`landing-provider-logo landing-provider-logo--${name}`}
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
        <ArticleHeader
          className="landing-header"
          title={
            <>
              Engineering discipline for{" "}
              <HeadingAccent>coding agents</HeadingAccent>
            </>
          }
          standfirst="discern gives every coding agent the same project knowledge, keeps parallel tasks in separate worktrees, and requires proof that the project’s real checks passed before work is called finished."
          meta={[
            "Free and open source",
            "Runs offline",
            "No API key",
            "No AI model",
          ]}
          actions={
            <Cluster gap={4}>
              <Button href="/docs/getting-started/quickstart">
                Install discern
              </Button>
              <Button href="/docs" variant="secondary">Read the manual</Button>
            </Cluster>
          }
        />

        <LogoCloud
          className="landing-integrations"
          label="Native coding agent integrations"
          aria-label={`${PROVIDER_LOGOS.length} native coding agent integrations`}
          items={PROVIDER_LOGOS}
        />

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
