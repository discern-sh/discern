/** The public For Agents page, rendered to static HTML by site/build.ts. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  SiteFooter,
  SiteHeader,
  SkipLink,
} from "discern-design-system/react";
import { AGENTS_DESCRIPTION, AGENTS_TITLE, DISCERN_MARK } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";

/** Keep the product name in its page-wide monospace treatment. */
function DiscernName() {
  return <span className="agents-brand-name">discern</span>;
}

/** Static theme toggle wired by the shared theme controller. */
function AgentsThemeToggle() {
  return (
    <button
      type="button"
      className="discern-theme-toggle discern-theme-toggle--outlined agents-theme-toggle"
      aria-label="Switch to the dark theme"
      data-theme-toggle
    >
      <span className="discern-theme-toggle__glyph" aria-hidden="true">
        <span data-theme-toggle-glyph="light">☀</span>
        <span data-theme-toggle-glyph="dark">☾</span>
      </span>
    </button>
  );
}

/** Page-specific actions within the shared site header. */
function AgentsMasthead() {
  return (
    <SiteHeader
      className="agents-masthead"
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      actions={
        <>
          <a className="agents-masthead__home" href="/">For humans</a>
          <Button
            className="agents-masthead__guide"
            href="/llms.txt"
            variant="primary"
          >
            Open <code>llms.txt</code>
          </Button>
          <AgentsThemeToggle />
        </>
      }
      sticky
      variant="campaign"
    />
  );
}

/** Shared site chrome around the empty For Agents composition. */
function AgentsShell() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <AgentsMasthead />
      <main id="main">
        <div className="agents-shell">
          <p>agent page goes here</p>
        </div>
      </main>
      <SiteFooter
        className="agents-footer"
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="A Software Engineering Tool for Coding Agents."
        groups={[
          {
            title: "Machine routes",
            links: [
              { label: "llms.txt", href: "/llms.txt" },
              {
                label: "MCP and results",
                href: "/docs/reference/mcp-and-results",
              },
              {
                label: "Result schema",
                href: "/schema/v1/discern-results.schema.json",
              },
              { label: "Glossary", href: "/docs/orientation/glossary" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "Human homepage", href: "/" },
              { label: "Documentation", href: "/docs" },
              { label: "GitHub", href: GITHUB },
              { label: "License", href: LICENSE },
            ],
          },
        ]}
        legal={
          <>
            <a href={GITHUB}>Source code</a>
            {" · "}
            <a href={LICENSE}>FSL-1.1-ALv2</a>
            {" · "}
            <a href="/llms.txt">llms.txt</a>
          </>
        }
        meta="© 2026 Jack Webb-Heller"
      />
    </>
  );
}

/** Render the For Agents composition for static serving. */
export function renderAgents(): string {
  return pageDocument({
    source: "agents.tsx",
    title: AGENTS_TITLE,
    description: AGENTS_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "agents.css"],
    scripts: [],
    body: renderToStaticMarkup(<AgentsShell />),
  });
}
