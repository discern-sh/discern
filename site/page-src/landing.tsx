/**
 * The authored homepage: an editorial placeholder composed from the design
 * system and rendered to static HTML by site/build.ts.
 */

import { renderToStaticMarkup } from "react-dom/server";
import {
  ArticleHeader,
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
  TableOfContents,
} from "discern-design-system/react";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";

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
          eyebrow="Placeholder"
          title={
            <>
              On keeping software <HeadingAccent>changeable</HeadingAccent>
            </>
          }
          standfirst="Anyone can ask a coding agent for software and watch it appear. The harder question arrives later: whether a project made of many asks stays sound. That discipline can belong to the agent, and this essay is about how."
          meta={["discern.sh", "July 2026"]}
          actions={
            <Cluster gap={4}>
              <Button href="/docs/getting-started/quickstart">
                Install discern
              </Button>
              <Button href="/docs" variant="secondary">Read the manual</Button>
            </Cluster>
          }
        />
        <ArticleLayout
          className="landing-body"
          navigation={
            <TableOfContents
              title="Placeholder"
              items={[
                { label: "The ask", href: "#the-ask" },
                { label: "The pattern", href: "#the-pattern" },
                { label: "The habits", href: "#the-habits" },
              ]}
            />
          }
        >
          <div className="landing-flow">
            <Prose className="landing-prose">
              <h3 id="the-ask">The ask</h3>
            </Prose>
            <Prose dropCap className="landing-prose landing-opening-copy">
              <p>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua.
              </p>
              <p>
                Ut enim ad minim veniam, quis nostrud exercitation ullamco
                laboris nisi ut aliquip ex ea commodo consequat.
              </p>

              <h3 id="the-pattern">The pattern</h3>
              <p>
                Duis aute irure dolor in reprehenderit in voluptate velit esse
                cillum dolore eu fugiat nulla pariatur.
              </p>
              <p>
                Excepteur sint occaecat cupidatat non proident, sunt in culpa
                qui officia deserunt mollit anim id est laborum.
              </p>
            </Prose>

            <PullQuote
              className="landing-pull"
              align="wide"
              quote="Nothing lands until you say so."
            />

            <Prose className="landing-prose">
              <h3 id="the-habits">The habits</h3>
              <p>
                Sed ut perspiciatis unde omnis iste natus error sit voluptatem
                accusantium doloremque laudantium, totam rem aperiam.
              </p>
              <p>
                Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit
                aut fugit, sed quia consequuntur magni dolores eos qui ratione
                voluptatem sequi nesciunt.
              </p>
            </Prose>
          </div>
        </ArticleLayout>

        <LogoCloud
          label="Placeholder logos"
          aria-label="Six placeholder logos"
          items={[
            { name: "Logo 01", mark: "◮" },
            { name: "Logo 02", mark: "◆" },
            { name: "Logo 03", mark: "●" },
            { name: "Logo 04", mark: "■" },
            { name: "Logo 05", mark: "✦" },
            { name: "Logo 06", mark: "◇" },
          ]}
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
