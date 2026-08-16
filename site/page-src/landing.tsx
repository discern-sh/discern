/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Button,
  HeroBlock,
  Kicker,
  LogoCloud,
  MarketingSection,
  ResonanceGround,
  SiteFooter,
  SiteHeader,
  SkipLink,
  Terminal,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import {
  DISCERN_MARK,
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
} from "../brand.ts";
import { pageDocument } from "./document.ts";
import { ProjectInMotion } from "./project-in-motion.tsx";
import { CompactStandardTrajectory } from "./specimens.tsx";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";
const PLACEHOLDER_SECTION_SURFACES = [
  "surface",
  "contrast",
  "surface",
  "contrast",
  "surface",
  "contrast",
  "surface",
  "contrast",
  "surface",
] as const;

/** The commissioning instruction shared by every copy control on the page. */
export const COPY_PROMPT_TEXT =
  "Read https://discern.sh/llms.txt, install discern in this repository, and commission it for this project. Study the codebase, guide me through the decisions only I can make, and complete the required validation before reporting setup finished.";
export const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";

/** The supported provider set, in the catalogue's canonical display order. */
const PROVIDER_LOGOS = AGENT_NAMES.map((name) => {
  const provider = PROVIDERS[name];
  const silhouette = providerBrandSilhouette(provider.brand);
  return {
    name: provider.label,
    mark: provider.brand.mark.path,
    mask: silhouette.path,
  };
});

interface SectionHeadingProps {
  readonly kicker: string;
  readonly title: string;
  readonly intro?: ReactNode;
  readonly align?: "start" | "center";
}

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

/** Draw the canonical mark for large editorial moments. */
function MarkGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <path d={DISCERN_MARK_FILLED_PATH} fill="currentColor" />
      <path
        d={DISCERN_MARK_OUTLINE_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One responsive section introduction. */
function SectionHeading(
  { kicker, title, intro, align = "start" }: SectionHeadingProps,
) {
  return (
    <header
      className={`landing-section-heading landing-section-heading--${align}`}
    >
      <Kicker className="landing-section-heading__kicker">{kicker}</Kicker>
      <h2>{title}</h2>
      {intro
        ? <div className="landing-section-heading__intro">{intro}</div>
        : null}
    </header>
  );
}

/** One visible commissioning instruction with a progressive copy action. */
function CopyPrompt(
  { id, label }: { readonly id: string; readonly label: string },
) {
  return (
    <div className="landing-copy-prompt">
      <p className="landing-copy-prompt__label">{label}</p>
      <p className="landing-copy-prompt__text" id={id}>{COPY_PROMPT_TEXT}</p>
      <div className="landing-copy-prompt__actions">
        <button
          type="button"
          className="discern-button discern-button--primary landing-copy-prompt__button"
          data-copy-prompt
          data-copy-prompt-target={id}
          hidden
        >
          <span className="discern-button__label">Copy prompt</span>
        </button>
        <a className="landing-copy-prompt__link" href="/llms.txt">
          Read the machine guide
        </a>
      </div>
      <p
        className="landing-copy-prompt__status"
        id={`${id}-status`}
        role="status"
        aria-live="polite"
      >
      </p>
    </div>
  );
}

/** Provider marks rendered from the canonical catalogue. */
function ProviderStrip({ compact = false }: { readonly compact?: boolean }) {
  return (
    <LogoCloud
      className={compact
        ? "landing-integrations landing-integrations--compact"
        : "landing-integrations"}
      aria-label={`${AGENT_NAMES.length} supported coding agent providers`}
      label="One project practice across the agents you use"
      items={PROVIDER_LOGOS.map((provider) => ({
        name: provider.name,
        mark: (
          <img
            className="landing-provider-logo"
            src={provider.mark}
            alt=""
            width={28}
            height={28}
            decoding="async"
          />
        ),
        markMask: `url("${provider.mask}")`,
      }))}
      variant="strip"
    />
  );
}

/** Sticky navigation for the current page or its preserved predecessor. */
function Masthead({ archived = false }: { readonly archived?: boolean }) {
  return (
    <SiteHeader
      className="landing-masthead"
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      navLabel="Site"
      navItems={archived
        ? [
          { label: "How it works", href: "#delegation" },
          { label: "What returns", href: "#decision" },
          { label: "Trust", href: "#trust" },
          { label: "GitHub ↗", href: GITHUB },
        ]
        : [{ label: "GitHub ↗", href: GITHUB }]}
      actions={archived
        ? (
          <>
            <Button
              className="landing-masthead__action"
              href="#start"
              variant="primary"
            >
              Copy prompt
            </Button>
            <LandingThemeToggle />
          </>
        )
        : <LandingThemeToggle />}
      sticky
      variant="campaign"
    />
  );
}

/** Compact product foundations used at different points in each hero edition. */
function HeroFacts() {
  return (
    <ul className="landing-hero__facts" aria-label="Product foundations">
      <li>
        <span aria-hidden="true">✓</span> One connected practice
      </li>
      <li>
        <span aria-hidden="true">✓</span> One local binary
      </li>
      <li>
        <span aria-hidden="true">✓</span> No model or API key
      </li>
    </ul>
  );
}

/** Atmospheric discern mark shared by the current and archived heroes. */
function HeroHalo() {
  return (
    <div className="landing-hero__halo" aria-hidden="true">
      <MarkGlyph className="landing-hero__mark" />
    </div>
  );
}

/** Ambition-led opening with a direct commissioning path. */
function Hero({ archived = false }: { readonly archived?: boolean }) {
  return (
    <HeroBlock
      className={archived
        ? "landing-hero"
        : "landing-hero landing-hero--current"}
      aria-labelledby="hero-title"
      eyebrow={
        <span className="landing-hero__signature">
          {archived ? <span aria-hidden="true">{DISCERN_MARK}</span> : null}
          For people who take their software seriously
        </span>
      }
      title={
        <span id="hero-title">
          A <em>bolder</em> way to build.
        </span>
      }
      description={
        <>
          <p className="landing-hero__lead">
            Coding agents can take on substantial work. <DiscernName />{" "}
            gives the project a serious way to carry context, conditions, and
            evidence, so you can take the software further with confidence in
            what comes back.
          </p>
          {archived
            ? (
              <p className="landing-hero__category">
                An engineering practice for agent-built software.
              </p>
            )
            : <HeroFacts />}
        </>
      }
      actions={archived
        ? (
          <>
            <Button
              className="landing-hero__action"
              href="#project-preview"
              variant="primary"
            >
              See discern in practice
            </Button>
            <Button
              className="landing-hero__action"
              href="#commissioning"
              variant="secondary"
            >
              Watch a project get commissioned
            </Button>
          </>
        )
        : null}
      meta={archived
        ? (
          <>
            <HeroHalo />
            <CopyPrompt
              id="hero-copy-prompt"
              label="Already working with a coding agent? Copy this into the conversation."
            />
            <HeroFacts />
          </>
        )
        : null}
      visual={
        <>
          {archived
            ? (
              <div id="project-preview">
                <ProjectInMotion />
              </div>
            )
            : null}
          {archived ? null : <HeroHalo />}
          <ProviderStrip />
        </>
      }
      ground={archived ? null : <ResonanceGround />}
      layout="showcase"
      surface="atmospheric"
    />
  );
}

/** The cultural shift and the attention it makes available. */
function PossibilitySection() {
  return (
    <section
      className="landing-section landing-possibility"
      id="possibility"
      aria-labelledby="possibility-title"
    >
      <div className="landing-shell landing-possibility__grid">
        <div className="landing-possibility__story-stage landing-sticky-boundary">
          <SectionHeading
            kicker="The opportunity"
            title="More capability should widen your ambition."
            intro={
              <p>
                One person can now attempt work that once required more time, a
                larger team, or specialist access.
              </p>
            }
          />
          <div className="landing-possibility__story">
            <p>
              That expansion is worth enjoying. Experienced engineers can direct
              several streams of work. New builders can create software for
              businesses, communities, and ideas that used to stay out of reach.
            </p>
            <p>
              Implementation is only part of the work. Project context,
              coordination, review, and memory still need somewhere to live as
              more work moves.
            </p>
            <blockquote>
              Let your attention stay with direction, architecture, trade-offs,
              exceptions, and the working result.
            </blockquote>
          </div>
        </div>
        <div
          className="landing-possibility__relationship"
          data-site-prose-exclude
        >
          <div>
            <span>01</span>
            <strong>Human</strong>
            <small>intent · judgment · authority</small>
          </div>
          <i aria-hidden="true">→</i>
          <div>
            <span>02</span>
            <strong>Agent</strong>
            <small>interpretation · implementation</small>
          </div>
          <i aria-hidden="true">→</i>
          <div>
            <span>03</span>
            <strong>Project</strong>
            <small>context · conditions · evidence</small>
          </div>
          <i aria-hidden="true">↺</i>
        </div>
      </div>
    </section>
  );
}

/** Compact lifecycle inspired by the reference site's dark method chapter. */
function DelegationSection() {
  const steps = [
    {
      label: "Commission",
      title: "Start with the project already in front of you.",
      copy:
        "The agent studies the repository and brings you the decisions the code cannot supply.",
    },
    {
      label: "Shape",
      title: "Turn ambition into bounded work.",
      copy:
        "A discussed objective becomes complete briefs, independent streams, and recorded dependencies.",
    },
    {
      label: "Work",
      title: "Give every task a prepared place.",
      copy:
        "Each effort receives its own checkout, identity, environment values, and declared resources.",
    },
    {
      label: "Prove",
      title: "Let the project test the finished change.",
      copy:
        "The declared checks run over one clean commit, and the result belongs to that tree.",
    },
    {
      label: "Decide",
      title: "Return where your judgment matters.",
      copy:
        "The result, evidence, and remaining choices arrive together for a person with authority.",
    },
  ] as const;
  return (
    <section
      className="landing-section landing-section--inverse landing-delegation"
      id="delegation"
      aria-labelledby="delegation-title"
    >
      <div className="landing-shell">
        <SectionHeading
          kicker="How the work moves"
          title="Turn a backlog into organized work."
          intro={
            <p>
              One connected method carries a substantial change from the first
              conversation to an informed decision.
            </p>
          }
          align="center"
        />
        <ol className="landing-lifecycle">
          {steps.map((step, index) => (
            <li key={step.label}>
              <span className="landing-lifecycle__number">0{index + 1}</span>
              <span className="landing-lifecycle__icon" aria-hidden="true">
                {index === 0
                  ? DISCERN_MARK
                  : index === 1
                  ? "⌁"
                  : index === 2
                  ? "□"
                  : index === 3
                  ? "✓"
                  : "↗"}
              </span>
              <small>{step.label}</small>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>
        <div className="landing-section__action landing-section__action--center">
          <Button href="/docs/worktrees/team-workflow" variant="secondary">
            See the real workstream plan
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Commissioning story, held beside a readable setup summary. */
function CommissioningSection() {
  const steps = [
    ["Study", "Read the code, structure, tools, and checks already present."],
    [
      "Ask",
      "Bring forward the product and authority choices the repository cannot answer.",
    ],
    [
      "Establish",
      "Create shared guidance, working methods, checks, and maintained project knowledge.",
    ],
    [
      "Prove",
      "Run the commissioned practice in a fresh worktree before setup can finish.",
    ],
    [
      "Inherit",
      "Give future agents the same project starting point across supported providers.",
    ],
  ] as const;
  return (
    <section
      className="landing-section landing-commissioning"
      id="commissioning"
      aria-labelledby="commissioning-title"
    >
      <div className="landing-shell landing-split">
        <div className="landing-commissioning__copy">
          <SectionHeading
            kicker="Commission the project"
            title="One careful beginning. Every future agent starts ahead."
            intro={
              <p>
                Tell your coding agent to set up discern. The agent handles the
                project-specific work and asks for the decisions only you can
                make.
              </p>
            }
          />
          <p>
            Your existing tools and checks remain the starting point. The setup
            process wires them into a practice, proposes conventional gaps with
            your consent, and refuses to finish until the practice works in
            isolation.
          </p>
          <div className="landing-section__action">
            <Button href="/docs/getting-started/walkthrough" variant="primary">
              Watch a project get commissioned
            </Button>
          </div>
        </div>
        <article className="landing-commissioning-card" data-site-prose-exclude>
          <header>
            <span className="landing-artifact-label">
              Commissioning summary
            </span>
            <Badge tone="success" dot>setup proven</Badge>
          </header>
          <ol>
            {steps.map(([label, copy], index) => (
              <li key={label}>
                <span>0{index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <p>{copy}</p>
                </div>
              </li>
            ))}
          </ol>
          <footer>
            <code>discern.toml</code>
            <code>project/guidance.md</code>
            <code>project/map/</code>
            <code>project/skills/</code>
          </footer>
        </article>
      </div>
    </section>
  );
}

/** The returned-change artifact and its evidence boundary. */
function DecisionSection() {
  return (
    <section
      className="landing-section landing-decision"
      id="decision"
      aria-labelledby="decision-title"
    >
      <div className="landing-shell">
        <SectionHeading
          kicker="What comes back"
          title="Come back to work that is ready for a decision."
          intro={
            <p>
              A finished change returns with the working result, the checks that
              ran, evidence for the commit, and the judgment still required.
            </p>
          }
          align="center"
        />
        <article className="landing-return" data-site-prose-exclude>
          <header className="landing-return__header">
            <div>
              <span>Illustrative returned change</span>
              <h3>Saved views are ready for a decision</h3>
            </div>
            <Badge tone="success" dot>Gate passed</Badge>
          </header>
          <div className="landing-return__grid">
            <section>
              <span className="landing-return__label">01 Agent account</span>
              <h4>The requested behavior is working.</h4>
              <p>
                Named views preserve filters, sort order, and the active view
                between sessions. A local preview is ready.
              </p>
              <dl>
                <div>
                  <dt>Change</dt>
                  <dd>7 files · +286 −41</dd>
                </div>
                <div>
                  <dt>Preview</dt>
                  <dd>available</dd>
                </div>
              </dl>
            </section>
            <section>
              <span className="landing-return__label">02 Project checks</span>
              <h4>The declared Gate ran.</h4>
              <ul className="landing-return__checks">
                <li>
                  <span>✓</span> Format passed
                </li>
                <li>
                  <span>✓</span> Types passed
                </li>
                <li>
                  <span>✓</span> Tests passed
                </li>
                <li>
                  <span>✓</span> Standards held
                </li>
              </ul>
            </section>
            <section>
              <span className="landing-return__label">
                03 Exact-tree evidence
              </span>
              <h4>
                Proof covers <code>8f2c1ab</code>.
              </h4>
              <p>
                The evidence belongs to this clean commit and the checks the
                project declared. A later edit clears it.
              </p>
            </section>
            <section className="landing-return__decision">
              <span className="landing-return__label">04 Human decision</span>
              <h4>Ready for your review.</h4>
              <p>
                Passing makes this change eligible for a decision. Permission
                remains explicit.
              </p>
              <Badge className="landing-return__status" tone="accent">
                awaiting your decision
              </Badge>
            </section>
          </div>
        </article>
        <div className="landing-decision__boundary">
          <p>
            <strong>Proof has a precise scope.</strong>{" "}
            It identifies the clean commit that passed the project's declared
            Gate and held its Standards.
          </p>
          <p>
            Security, production suitability, and the decision to land remain
            separate judgments.
          </p>
        </div>
        <div className="landing-section__action landing-section__action--center">
          <Button href="/docs/quality-gate/the-proof" variant="secondary">
            Read the Proof model
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Measurable gains and useful lessons become future starting points. */
function CompoundingSection() {
  return (
    <section
      className="landing-section landing-compounding-section"
      id="compounding"
      aria-labelledby="compounding-title"
    >
      <div className="landing-shell">
        <SectionHeading
          kicker="What the project keeps"
          title="Make an improvement part of the next starting point."
          intro={
            <p>
              Completed work can strengthen the practice that later agents
              inherit.
            </p>
          }
          align="center"
        />
        <div className="landing-compounding" data-site-prose-exclude>
          <article className="landing-compounding__measure">
            <header>
              <span className="landing-artifact-label">
                Retain the measurable gain
              </span>
              <h3>The bar moves with the work.</h3>
            </header>
            <CompactStandardTrajectory />
            <p>
              When a configured measure improves, discern can pin the stronger
              value as the next branch's limit.
            </p>
          </article>
          <article className="landing-memory">
            <header>
              <span className="landing-artifact-label">
                Retain the useful lesson
              </span>
              <h3>Put the correction where future agents can use it.</h3>
            </header>
            <blockquote>
              Keep every public claim beside the evidence boundary it depends
              on.
            </blockquote>
            <ul className="landing-memory__routes">
              <li>
                <strong>Guidance</strong>
                <span>A rule every configured agent receives</span>
              </li>
              <li>
                <strong>Skill</strong>
                <span>A method a future agent can load</span>
              </li>
              <li>
                <strong>Map</strong>
                <span>An account of the project people can inspect</span>
              </li>
            </ul>
            <p className="landing-memory__next">
              <span aria-hidden="true">↗</span>
              <strong>Next session</strong>
              <span>begins with the lesson in view</span>
            </p>
          </article>
        </div>
        <div className="landing-section__action landing-section__action--center landing-section__action--pair">
          <Button href="/docs/quality-gate/standards" variant="secondary">
            See how Standards retain gains
          </Button>
          <Button href="/docs/agent-guidance" variant="secondary">
            See how guidance travels
          </Button>
        </div>
      </div>
    </section>
  );
}

/** One practice welcomes people arriving with different experience. */
function AudienceSection() {
  return (
    <section
      className="landing-section landing-audiences"
      id="audiences"
      aria-labelledby="audiences-title"
    >
      <div className="landing-shell">
        <SectionHeading
          kicker="Who it serves"
          title="Built for people who care what happens next."
          intro={
            <p>
              Software becomes serious when people, data, revenue, reputation,
              or everyday work begin to depend on it.
            </p>
          }
          align="center"
        />
        <div className="landing-audiences__cards">
          <article>
            <span className="landing-audiences__bar" aria-hidden="true" />
            <small>Experienced with software</small>
            <h3>Let your judgment influence more of the implementation.</h3>
            <p>
              Turn conventions, architecture, checks, and review standards into
              project infrastructure that every supported agent can use.
            </p>
            <a href="/docs/worktrees/team-workflow">
              Explore substantial delegation →
            </a>
          </article>
          <article>
            <span className="landing-audiences__bar" aria-hidden="true" />
            <small>Building through agents</small>
            <h3>Give a meaningful project a serious way to grow.</h3>
            <p>
              Your agent establishes the practice, explains consequential
              choices, and brings back evidence you can ask it to interpret.
            </p>
            <a href="/docs/getting-started/walkthrough">
              Follow the commissioning walkthrough →
            </a>
          </article>
        </div>
        <blockquote className="landing-audiences__threshold">
          The software has consequences now. Give it a way of working that can
          grow with them.
        </blockquote>
      </div>
    </section>
  );
}

/** Provider continuity and agent ergonomics share one compact chapter. */
function AgentsSection() {
  return (
    <section
      className="landing-section landing-agents"
      id="agents"
      aria-labelledby="agents-title"
    >
      <div className="landing-shell">
        <div className="landing-agents__grid">
          <div className="landing-agents__main">
            <SectionHeading
              kicker="Project continuity"
              title="Change agents without starting the project over."
              intro={
                <p>
                  Configure the providers you use. Each receives the same
                  project-owned guidance and works through the same discern
                  practice.
                </p>
              }
            />
            <p>
              Hidden conversation state and provider-specific features stay with
              their provider. The project's instructions, methods, checks, and
              evidence remain in the repository.
            </p>
            <div className="landing-section__action landing-section__action--pair">
              <Button href="/docs/agent-integrations" variant="primary">
                Compare agent integrations
              </Button>
              <Button href="/llms.txt" variant="secondary">
                Read the machine guide
              </Button>
            </div>
          </div>
          <Terminal
            className="landing-agent-result"
            title={
              <span className="landing-artifact-label">
                Built for the machine doing the work
              </span>
            }
            actions={<Badge tone="accent">agent ergonomics</Badge>}
            footer={
              <>
                <span>bounded context</span>
                <span>explicit state</span>
                <span>useful next step</span>
              </>
            }
            variant="showcase"
            data-site-prose-exclude
          >
            {`{
  "ok": false,
  "error": "behind_trunk",
  "state": "4 commits behind",
  "next": "call discern_update"
}`}
          </Terminal>
        </div>
        <ProviderStrip compact />
      </div>
    </section>
  );
}

/** Product facts and boundaries arrive before the final invitation. */
function TrustSection() {
  return (
    <section
      className="landing-section landing-section--inverse landing-trust"
      id="trust"
      aria-labelledby="trust-title"
    >
      <div className="landing-shell">
        <SectionHeading
          kicker="Trust and boundaries"
          title="Know what the evidence covers."
          intro={
            <p>
              Confidence comes from clear conditions, visible limits, and
              authority that stays attached to a real person or recorded grant.
            </p>
          }
          align="center"
        />
        <div className="landing-trust__facts">
          <article>
            <span aria-hidden="true">⌁</span>
            <h3>Local foundation</h3>
            <p>
              discern is a self-contained local binary. It contains no AI model
              and needs no API key.
            </p>
          </article>
          <article>
            <span aria-hidden="true">◎</span>
            <h3>Scoped evidence</h3>
            <p>
              Proof covers one clean commit and the checks the project declared.
              It does not certify security or production suitability.
            </p>
          </article>
          <article>
            <span aria-hidden="true">◇</span>
            <h3>Explicit authority</h3>
            <p>
              Passing prepares a change for a decision. A conversation or
              recorded grant decides whether it may land.
            </p>
          </article>
          <article>
            <span aria-hidden="true">□</span>
            <h3>Visible source</h3>
            <p>
              The source is available under FSL-1.1-ALv2. Each version receives
              Apache-2.0 on its second anniversary.
            </p>
          </article>
        </div>
        <div className="landing-trust__lower">
          <article>
            <Kicker className="landing-trust__kicker">
              Local activity record
            </Kicker>
            <h3>Evidence stays on the machine.</h3>
            <p>
              The Logbook contains metadata and excludes source code and command
              output. Coding agents and project commands may still use networks
              or paid services.
            </p>
            <a href="/docs/orientation/trust-and-data">
              Review the trust boundaries →
            </a>
          </article>
          <article>
            <Kicker className="landing-trust__kicker">
              Built under its own practice
            </Kicker>
            <h3>discern develops discern.</h3>
            <p>
              The project uses its Gate, worktrees, Standards, Map, and Logbook.
              This dogfooding is inspectable product evidence, separate from
              independent customer validation.
            </p>
            <a href={GITHUB}>Inspect the public source →</a>
          </article>
        </div>
      </div>
    </section>
  );
}

/** Closing commissioning invitation and terminal alternative. */
function FinalInvitation() {
  return (
    <section
      className="landing-section landing-final"
      id="start"
      aria-labelledby="start-title"
    >
      <div className="landing-shell landing-final__inner">
        <MarkGlyph className="landing-final__mark" />
        <SectionHeading
          kicker="Your next project session"
          title="Software worth putting your name to."
          intro={
            <p>
              Let coding agents carry more of the implementation. Put a
              project-owned engineering practice behind the work.
            </p>
          }
          align="center"
        />
        <CopyPrompt
          id="final-copy-prompt"
          label="Give your coding agent the commissioning instruction."
        />
        <div className="landing-install">
          <span>Prefer the terminal?</span>
          <code>{INSTALL_COMMAND}</code>
          <a href="/docs/getting-started/quickstart">Open the setup guide →</a>
        </div>
      </div>
    </section>
  );
}

interface LandingShellProps {
  readonly archived?: boolean;
  readonly children?: ReactNode;
}

/** Shared campaign chrome around the current and archived homepage bodies. */
function LandingShell({ archived = false, children }: LandingShellProps) {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <Masthead archived={archived} />
      <main id="main">{children}</main>
      <SiteFooter
        className={archived ? undefined : "landing-footer"}
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
        legal={archived
          ? (
            <>
              <a href={GITHUB}>Public source ↗</a>
              {" · "}
              <a href="/llms.txt">Machine guide</a>
            </>
          )
          : (
            <>
              <a href={GITHUB}>Source code</a>
              {" · "}
              <a href={LICENSE}>FSL-1.1-ALv2</a>
              {" · "}
              <a href="/llms.txt">llms.txt</a>
            </>
          )}
        meta={archived ? "© 2026 Jack Webb-Heller." : "© 2026 Jack Webb-Heller"}
      />
    </>
  );
}

/** Empty design-system sections ready for the composed homepage content. */
function LandingPlaceholders() {
  return (
    <LandingShell>
      <>
        <Hero />
        {PLACEHOLDER_SECTION_SURFACES.map((surface, index) => {
          const number = index + 1;
          const labelId = `placeholder-section-${number}`;
          return (
            <MarketingSection
              className="landing-placeholder landing-placeholder--section"
              frame="wide"
              spacing="spacious"
              surface={surface}
              data-site-prose-exclude
              aria-labelledby={labelId}
              key={labelId}
            >
              <h2 className="landing-placeholder__label" id={labelId}>
                Section {number}
              </h2>
            </MarketingSection>
          );
        })}
      </>
    </LandingShell>
  );
}

/** The complete homepage retained at /old while the new page takes shape. */
function OldLandingPage() {
  return (
    <LandingShell archived>
      <>
        <Hero archived />
        <PossibilitySection />
        <DelegationSection />
        <CommissioningSection />
        <DecisionSection />
        <CompoundingSection />
        <AudienceSection />
        <AgentsSection />
        <TrustSection />
        <FinalInvitation />
      </>
    </LandingShell>
  );
}

/** Render the homepage scaffold for static serving. */
export function renderLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "landing.css"],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPlaceholders />),
  });
}

/** Render the preserved full homepage at /old. */
export function renderOldLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "landing.css"],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<OldLandingPage />),
  });
}
