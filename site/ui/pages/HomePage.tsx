import type { ReactElement } from "react";
/** Homepage shell for the public landing page. */

import {
  ApproachBackdrop,
  Button,
  Grid,
  Heading,
  Icon,
  Kicker,
  Paragraph,
} from "discern-design-system/react";
import {
  DISCERN_MARK,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
} from "../../brand.ts";
import { renderDocument } from "../Document.tsx";
import { MarketingLayout } from "../layouts/MarketingLayout.tsx";

const benefits = [
  {
    title: "Set the direction.",
    description:
      "Keep your decisions and expectations in the project, where your coding agents can put them to work.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z" />
      </>
    ),
  },
  {
    title: "Let more work move.",
    description:
      "Give each task its own space, so several agents can move different parts of your project forward.",
    icon: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />,
  },
  {
    title: "Know what’s ready.",
    description:
      "Review work with evidence from your project's own checks. You decide what ships.",
    icon: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  },
] as const;

/** Render the homepage with shared navigation and a page-owned canvas. */
export function renderLanding(): string {
  return renderDocument({
    source: "site/ui/pages/HomePage.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    appearance: "mono",
    styles: ["fonts.css", "discern.css", "campaign.css", "landing.css"],
    scripts: ["discern.js"],
    children: <HomePage />,
  });
}

/** Homepage content composed through the shared marketing layout. */
function HomePage(): ReactElement {
  return (
    <MarketingLayout currentPath="/">
      <section className="homepage-artwork" aria-labelledby="homepage-title">
        <ApproachBackdrop />
        <div className="homepage-copy">
          <Kicker className="homepage-eyebrow">
            <span aria-hidden="true">{DISCERN_MARK}</span> discern v1.0.0
          </Kicker>
          <Heading level={1} id="homepage-title" className="homepage-title">
            Software worth putting your name to.
          </Heading>
          <Paragraph className="homepage-subtitle">
            discern installs a serious engineering practice into agent-built
            software projects, helping your product hold up and set itself
            apart.
          </Paragraph>
          <Button
            href="/docs/start"
            size="lg"
            trailingIcon="→"
            className="homepage-cta"
          >
            Get started
          </Button>
        </div>
        <div className="homepage-benefits">
          <Grid minimum="12rem" gap={6} className="homepage-benefits-grid">
            {benefits.map(({ title, description, icon }) => (
              <div className="homepage-benefit" key={title}>
                <Icon
                  size="3rem"
                  fit="contain"
                  relief
                  className="homepage-benefit-icon"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="100%"
                    height="100%"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {icon}
                  </svg>
                </Icon>
                <Heading level={2}>{title}</Heading>
                <Paragraph>{description}</Paragraph>
              </div>
            ))}
          </Grid>
        </div>
      </section>
    </MarketingLayout>
  );
}
