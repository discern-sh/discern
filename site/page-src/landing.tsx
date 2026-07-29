/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Brand,
  Button,
  Cluster,
  HeadingAccent,
  LogoCloud,
  SiteFooter,
  SkipLink,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";

/** The native provider set, in the catalogue's canonical display order. */
const PROVIDER_LOGOS = AGENT_NAMES.map((name) => {
  const provider = PROVIDERS[name];
  const silhouette = providerBrandSilhouette(provider.brand);
  return {
    name: provider.label,
    mark: (
      <span
        className="landing-provider-logo-frame"
        style={{
          "--landing-provider-logo-mask": `url("${silhouette.path}")`,
        } as CSSProperties}
      >
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
      className="discern-theme-toggle discern-theme-toggle--quiet landing-masthead__theme"
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

        {
          /*
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
        */
        }
      </main>
      <SiteFooter
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="Discern makes AI coding agents work like a disciplined engineering team. It coordinates their changes, separates parallel tasks, and proves their work is correct before it ships."
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
        legal={
          <>
            <a href={GITHUB}>GitHub ↗</a>
            {" · "}
            <a href="/llms.txt">llms.txt</a>
          </>
        }
        meta="© 2026 Jack Webb-Heller."
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
