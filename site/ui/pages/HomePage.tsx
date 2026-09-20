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
    styles: ["fonts.css", "discern.css", "campaign.css", "landing.css"],
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
        className="homepage-hero"
        layout="statement"
        eyebrow={
          <Kicker className="homepage-eyebrow">
            <span aria-hidden="true">{DISCERN_MARK}</span> discern v
            {DISCERN_VERSION}
          </Kicker>
        }
        title="Intelligence, in practice."
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
            <Button href="#practice" size="lg" variant="ghost">
              See how it works
            </Button>
          </>
        }
        meta="Any stack. Runs offline. No API key."
        backdrop={<ApproachBackdrop />}
        visual={
          <LogoCloud
            className="homepage-agents"
            label="Works with the coding agents you already use"
            align="start"
            variant="strip"
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
        eyebrow="The practice"
        title="Two kinds of intelligence. One shared project."
        lead={
          <p>
            An engineering practice for agent-built software, installed in your
            project. You set the direction, your agent carries the work, and the
            project keeps what matters between you.
          </p>
        }
        aside={
          <>
            <span>Built on itself</span>
            <p>
              discern has run under its own practice since day one. Every change
              to discern is built, checked, and proven by discern.
            </p>
          </>
        }
        asideLabel="How discern is built"
      >
        <p>
          You decide what quality means for your project. discern keeps that
          judgment in the project itself, where every coding agent you use can
          find it and put it to work.
        </p>
        <p>
          Your agent operates discern day to day. It starts each task in its own
          workspace, runs the checks your project declares, and brings the work
          back with evidence that they passed. You review the result and decide
          what ships.
        </p>
        <h3>For people who take their software seriously.</h3>
        <p>
          If you have only ever built software through an agent, discern asks
          nothing of you beyond the decisions that are yours to make. Your agent
          sets it up and runs it, and the discipline is in place by the time
          people start depending on your work.
        </p>
        <p>
          If you already direct more implementation than you can personally
          read, discern lets your judgment reach every change without you
          reading every line. Run more work in parallel, keep your standards
          across models and providers, and stay the one who decides.
        </p>
      </NarrativeChapter>
      <FeatureBento
        className="homepage-bento"
        eyebrow="What discern gives you"
        title="The right limits let more work move and finish."
        description={
          <p>
            Every task gets its own workspace, every change is held to the bar
            your project declares, and the decision to ship stays with you.
          </p>
        }
        items={[
          {
            title: "Built around the way agents work.",
            description: (
              <>
                <p>
                  Most developer tools assume a person at the keyboard. discern
                  treats your coding agent as its day-to-day operator, and most
                  of what it does for the agent happens out of your sight.
                </p>
                <p>
                  Every session opens already briefed by your project's compiled
                  instructions. One call reports what is true right now and the
                  next valid step, so the agent never rebuilds the picture from
                  a long transcript.
                </p>
                <p>
                  Results come back bounded, so the agent spends its context on
                  your change rather than on the tool. A failed check returns
                  the evidence and a command to reproduce it, and a refusal
                  always names a way forward. The agent operates; you still
                  decide what lands.
                </p>
              </>
            ),
            icon: tileGlyphs.prompt,
            size: "large",
            tone: "accent",
          },
          {
            title: "Give each task its own workspace.",
            icon: tileGlyphs.branch,
            description: (
              <p>
                Every piece of work begins in a separate checkout on its own
                branch. Several agents can move at once without treading on each
                other, and nothing unfinished reaches your shared branch.
              </p>
            ),
            size: "wide",
          },
          {
            title: "Know what passed.",
            icon: tileGlyphs.check,
            description: (
              <p>
                Finished work comes back with the results of your project's own
                checks, tied to the exact change that passed them.
              </p>
            ),
          },
          {
            title: "Keep every gain.",
            icon: tileGlyphs.trend,
            description: (
              <p>
                When a quality measure improves, the project keeps the new
                level. A later change cannot lower it.
              </p>
            ),
          },
          {
            title: "You decide what ships.",
            icon: tileGlyphs.flag,
            description: (
              <p>
                Passing checks makes a change ready for a decision. The decision
                to land it stays with you.
              </p>
            ),
            size: "wide",
          },
          {
            title: "Your agent sets it up.",
            icon: tileGlyphs.spark,
            description: (
              <p>
                Tell your coding agent to set up discern. It studies your
                project, wires up your real checks, asks only for the decisions
                that are yours, and proves the setup works before it finishes.
              </p>
            ),
            size: "wide",
          },
        ]}
      />
    </MarketingLayout>
  );
}
