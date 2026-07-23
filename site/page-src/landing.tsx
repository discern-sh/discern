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
      <img
        className="landing-provider-logo"
        src={provider.brand.mark.path}
        alt=""
        width={32}
        height={32}
        decoding="async"
      />
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
              Engineering control for{" "}
              <HeadingAccent>AI coding agents</HeadingAccent>.
            </>
          }
          standfirst="discern gives every agent the same project knowledge, isolates parallel tasks in separate worktrees, and makes the repository’s checks the definition of done."
          actions={
            <Cluster gap={4}>
              <Button href="/docs/getting-started/quickstart">
                Install discern
              </Button>
              <Button href="/docs" variant="secondary">Read the manual</Button>
            </Cluster>
          }
        />
        <section
          className="landing-control"
          aria-labelledby="landing-control-title"
        >
          <div className="landing-control__summary">
            <h2 id="landing-control-title">
              Your project owns the definition of done.
            </h2>
            <p>
              <code>discern done</code>{" "}
              runs the repository’s configured checks, keeps configured quality
              standards from moving backward, and produces a receipt tied to the
              commit that passed.
            </p>
          </div>
          <dl className="landing-control__facts">
            <div>
              <dt>Shared project knowledge</dt>
              <dd>
                Write guidance once. discern compiles it into the instructions
                every configured agent reads.
              </dd>
            </div>
            <div>
              <dt>Isolated parallel work</dt>
              <dd>
                Each change gets its own branch and worktree, keeping agents in
                separate checkouts.
              </dd>
            </div>
            <div>
              <dt>Proof for review</dt>
              <dd>
                A passing run records the checks against the commit you’re
                reviewing.
              </dd>
            </div>
          </dl>
        </section>

        <LogoCloud
          className="landing-integrations"
          label="Native coding agent integrations"
          aria-label={`${PROVIDER_LOGOS.length} native coding agent integrations`}
          items={PROVIDER_LOGOS}
        />
      </main>
      <SiteFooter
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="One binary that gives your repository a definition of done, an isolated worktree per change, and one set of instructions every agent reads."
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
