import type { ReactElement, ReactNode } from "react";
/** Homepage shell for the public landing page. */

import {
  ApproachBackdrop,
  Button,
  FeatureBento,
  Grid,
  Heading,
  HeroBlock,
  Icon,
  Kicker,
  LogoCloud,
  MarketingSection,
  NarrativeChapter,
  Paragraph,
} from "discern-design-system/react";
import {
  providerBrandSilhouette,
  PROVIDERS,
} from "../../../src/lib/providers.ts";
import { DISCERN_VERSION } from "../../../src/lib/version.ts";
import { AGENT_NAMES } from "../../../src/shared/agent_catalogue.ts";
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

/** The integrated coding agents, read from the live provider registry. */
const agents = AGENT_NAMES.map((name) => {
  const { label, brand } = PROVIDERS[name];
  return {
    label,
    mark: brand.mark.path,
    silhouette: providerBrandSilhouette(brand).path,
  };
});

/** A 24-unit stroke glyph drawn from path children. */
function Glyph({ children }: { readonly children: ReactNode }): ReactElement {
  return (
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
      {children}
    </svg>
  );
}

/** One glyph per bento tile, in tile order. */
const tileGlyphs = {
  prompt: (
    <Glyph>
      <path d="m5 7 5 5-5 5" />
      <path d="M12 17h7" />
    </Glyph>
  ),
  branch: (
    <Glyph>
      <path d="M6 3v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Glyph>
  ),
  check: (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </Glyph>
  ),
  trend: (
    <Glyph>
      <path d="m4 18 6-6 4 4 6-8" />
      <path d="M14 8h6v6" />
    </Glyph>
  ),
  flag: (
    <Glyph>
      <path d="M5 21V4h11l-1.5 4L16 12H5" />
    </Glyph>
  ),
  spark: (
    <Glyph>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" />
    </Glyph>
  ),
} as const;

/** Render the homepage with shared navigation and a page-owned canvas. */
export function renderLanding(): string {
  return renderDocument({
    source: "site/ui/pages/HomePage.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    appearance: "mono",
    styles: ["fonts.css", "discern.css", "landing.css"],
    scripts: ["discern.js"],
    children: <HomePage />,
  });
}

/** The three-part promise that closes the opening block. */
function Benefits(): ReactElement {
  return (
    <Grid minimum="12rem" gap={6} className="homepage-benefits-grid">
      {benefits.map(({ title, description, icon }) => (
        <div className="homepage-benefit" key={title}>
          <Icon
            size="3rem"
            fit="contain"
            relief
            className="homepage-benefit-icon"
          >
            <Glyph>{icon}</Glyph>
          </Icon>
          <Heading level={2}>{title}</Heading>
          <Paragraph>{description}</Paragraph>
        </div>
      ))}
    </Grid>
  );
}

/** Homepage content composed through the shared marketing layout. */
function HomePage(): ReactElement {
  return (
    <MarketingLayout currentPath="/">
      <HeroBlock
        layout="statement"
        style={{ paddingTop: 50, paddingBottom: 50 }}
        frame="wide"
        eyebrow={
          <Kicker className="homepage-eyebrow">
            <span aria-hidden="true">{DISCERN_MARK}</span> discern v
            {DISCERN_VERSION}
          </Kicker>
        }
        title="Intelligence In Practice."
        description={
          <p className="homepage-lede">
            discern installs a disciplined engineering practice into your
            software project. You bring the vision, your agent writes the code,
            and your project gets better at being built.
          </p>
        }
        actions={
          <>
            <Button href="/docs/start" size="lg" trailingIcon="→">
              Get started
            </Button>
            <Button href="#practice" size="lg" variant="secondary">
              See how it works
            </Button>
          </>
        }
        meta="Any stack. Runs offline. No API key."
        backdrop={
          <ApproachBackdrop
            className="homepage-backdrop"
            arrive
            drift="in"
            driftBeats={16}
            dolly
            grain
          />
        }
        visual={
          <LogoCloud
            label="Works with your coding agent"
            align="start"
            variant="strip"
            frame="fill"
            items={agents.map(({ label, mark, silhouette }) => ({
              name: label,
              mark: <img src={mark} alt="" width="24" height="24" />,
              markMask: `url("${silhouette}")`,
            }))}
          />
        }
      />
      <MarketingSection
        className="homepage-benefits"
        spacing="compact"
        frame="wide"
        aria-label="What discern does"
      >
        <Benefits />
      </MarketingSection>
      <NarrativeChapter
        id="practice"
        className="homepage-chapter"
        // eyebrow="The practice"
        title="Two kinds of intelligence. One shared project."
        lead={
          <p>
            Designed to improve the way humans and agents work together, discern
            installs a collaborative engineering practice into any software
            project.
          </p>
        }
        aside={
          <>
            <strong>Built on itself</strong>
            <p>
              discern has been created by its own workflow since day one. Every
              change to discern's codebase has been built, validated, and proven
              under its own gate.
            </p>
          </>
        }
        asideLabel="How discern is built"
      >
        <p>
          <strong>You</strong>{" "}
          decide what "quality" means for your project. discern encodes your
          taste and judgment into the project's configuration, then teaches
          every future agent how to put it to work.
        </p>
        <p>
          <strong>Your agent</strong>{" "}
          operates discern day-to-day. discern helps them write better code,
          work safely in parallel, and continually improve the project's quality
          over time.
        </p>
        <p>
          <strong>Your project</strong>{" "}
          becomes a more reliable place for agents to work. Every change is
          deterministically proven to meet your standards. discern gives you the
          confidence to ship high-quality changes faster than ever.
        </p>
        <h3>Designed for people who ship serious software.</h3>
        <p>
          If you've only ever built software through a coding agent, discern is
          easy-to-use and requires no previous coding experience. When people
          start depending on your work, discern provides the engineering
          discipline so you can ship it with confidence.
        </p>
        <p>
          Or if you're an experienced engineer using agents to write more code
          than you can keep up with, discern lets you scale your ambition even
          further. Direct more work with less oversight, preserve your expertise
          across models and providers, and run complex workstreams in parallel.
        </p>
      </NarrativeChapter>
      <FeatureBento
        frame="wide"
        eyebrow="Why choose discern?"
        title="Software engineering for the agentic era."
        description={
          <p>
            discern makes it possible to use coding agents to their full
            potential, without compromising on quality or what matters to you.
          </p>
        }
        items={[
          {
            title: "Built around the way agents work.",
            description: (
              <>
                <p>
                  Most developer tools assume a person at the keyboard. discern
                  takes a different approach, by treating your coding agent as
                  its day-to-day operator.
                </p>
                <p>
                  Most of what discern does happens out of sight. It operates
                  quietly in the background, guiding your agent to make the
                  right decisions for your project, throughout the entire
                  software development lifecycle.
                </p>
                <p>
                  discern teaches your agent everything they need to know about
                  your project, at the time they need to know about it. That
                  means they don't fill up their context window re-learning the
                  basics. It provides precise, bounded hints, guiding your agent
                  to take the right action. If something fails, discern tells
                  your agent how to fix it. And every response includes a clear
                  next step for the agent to take.
                </p>
              </>
            ),
            icon: tileGlyphs.prompt,
            size: "large",
            tone: "accent",
            align: "end",
          },
          {
            title: "Build in parallel with isolated workspaces.",
            icon: tileGlyphs.branch,
            description: (
              <p>
                Every change takes place in an isolated worktree. Several agents
                can build at once without tripping over each other. discern
                takes care of creating, syncing, and tidying each workspace
                automatically.
              </p>
            ),
            size: "wide",
          },
          {
            title: "Trust the process.",
            icon: tileGlyphs.check,
            description: (
              <p>
                Don't just take their word for it. discern gives you and your
                agent Proof: a deterministic guarantee that the project's checks
                passed, tied to the exact commit they passed on.
              </p>
            ),
          },
          {
            title: "Things can only get better.",
            icon: tileGlyphs.trend,
            description: (
              <p>
                When a quality measure improves, your project can lock in the
                gain. Later changes can't lower it, preventing regressions from
                sneaking back in.
              </p>
            ),
          },
          {
            title: "You decide what ships.",
            icon: tileGlyphs.flag,
            description: (
              <p>
                discern's practice lets you stay focused on what actually
                matters to your project. discern empowers your agents to work
                more autonomously, but nothing gets landed or shipped without
                your consent.
              </p>
            ),
            size: "wide",
          },
          {
            title: "Zero-configuration setup.",
            icon: tileGlyphs.spark,
            description: (
              <p>
                Simply tell your coding agent to set up discern in your project.
                That's it. discern guides your agent step-by-step, analyzing the
                project and showing them how to wire up the right checks, before
                verifying everything works.
              </p>
            ),
            size: "wide",
          },
        ]}
      />
    </MarketingLayout>
  );
}
