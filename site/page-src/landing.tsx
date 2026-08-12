/** The authored homepage, rendered to static HTML by site/build.ts. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  Brand,
  Button,
  SiteFooter,
  SkipLink,
} from "discern-design-system/react";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";
export const COPY_PROMPT_TEXT =
  "Set this project up with discern. Start by fetching https://discern.sh/llms.txt, then follow the setup instructions there.";
export const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";

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

/** Keep the product name in its page-wide monospace treatment. */
function DiscernName() {
  return <span className="landing-brand-name">discern</span>;
}

/** Placeholder page shell while the replacement homepage concepts are built. */
function LandingPage() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <header className="landing-masthead">
        <div className="landing-masthead__inner">
          <a href="/" className="landing-masthead__brand">
            <Brand
              mark={DISCERN_MARK}
              name={<DiscernName />}
              size="lg"
              typeface="mono"
            />
          </a>
          <nav className="landing-masthead__nav" aria-label="Site">
            <a className="landing-masthead__link" href="/docs">Docs</a>
            <a
              className="landing-masthead__link landing-masthead__link--github"
              href={GITHUB}
            >
              GitHub ↗
            </a>
            <Button
              className="landing-masthead__action"
              href="/docs/getting-started/quickstart"
              variant="primary"
            >
              Set up discern
            </Button>
            <LandingThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <section
          className="landing-placeholder"
          aria-label="Homepage placeholder"
        >
          <p>Cool homepage goes here!</p>
        </section>
      </main>

      <SiteFooter
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="An engineering practice for agent-built software."
        groups={[
          {
            title: "Documentation",
            links: [
              { label: "Quickstart", href: "/docs/getting-started/quickstart" },
              { label: "The practice", href: "/docs" },
              {
                label: "Trust & your data",
                href: "/docs/orientation/trust-and-data",
              },
              { label: "Agent integrations", href: "/docs/agent-integrations" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: GITHUB },
              { label: "Decisions", href: "/docs/decisions" },
              { label: "License", href: LICENSE },
              { label: "llms.txt", href: "/llms.txt" },
            ],
          },
        ]}
        legal={
          <>
            <a href={GITHUB}>Public source ↗</a>
            {" · "}
            <a href="/llms.txt">Machine guide</a>
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
      "landing.css",
    ],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
