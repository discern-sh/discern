/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Brand,
  Button,
  HeadingAccent,
  LogoCloud,
  SiteFooter,
  SkipLink,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { CompactStandardTrajectory } from "./specimens.tsx";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";
export const COPY_PROMPT_TEXT =
  "Set this project up with discern. Start by fetching https://discern.sh/llms.txt, then follow the setup instructions there.";
export const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";

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
          "--landing-provider-logo-mask": 'url("' + silhouette.path + '")',
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

interface LandingSectionProps {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
  readonly className?: string;
}

interface ProductTerm {
  readonly name: string;
  readonly definition: string;
  readonly href: string;
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

/** Progressive copy-prompt control; its source text remains visible without JavaScript. */
function CopyPrompt(
  { id, buttonVariant = "primary" }: {
    readonly id: string;
    readonly buttonVariant?: "primary" | "secondary";
  },
) {
  const statusId = id + "-status";
  return (
    <div className="landing-copy-prompt">
      <blockquote id={id} className="landing-copy-prompt__text">
        {COPY_PROMPT_TEXT}
      </blockquote>
      <Button
        className="landing-copy-prompt__button"
        variant={buttonVariant}
        type="button"
        data-copy-prompt=""
        data-copy-prompt-target={id}
        aria-describedby={id + " " + statusId}
        hidden
      >
        Copy setup prompt
      </Button>
      <span
        id={statusId}
        className="landing-copy-prompt__status"
        aria-live="polite"
      />
    </div>
  );
}

/** Shared editorial wrapper for one numbered homepage section. */
function LandingSection(
  { id, heading, children, className = "" }: LandingSectionProps,
) {
  return (
    <section
      id={id}
      className={("landing-section " + className).trim()}
      aria-labelledby={id + "-title"}
    >
      <div className="landing-section__inner">
        <header className="landing-section__header">
          <h2 id={id + "-title"}>{heading}</h2>
        </header>
        {children}
      </div>
    </section>
  );
}

/** Focusable, optional definitions for product vocabulary introduced nearby. */
function ProductTerms({ terms }: { readonly terms: readonly ProductTerm[] }) {
  return (
    <aside className="landing-terms" aria-label="Concepts introduced">
      <p>Concepts introduced:</p>
      <div className="landing-terms__items">
        {terms.map((term) => (
          <details className="landing-term" key={term.name}>
            <summary>{term.name}</summary>
            <div>
              <p>{term.definition}</p>
              <a href={term.href}>Read the documentation ↗</a>
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}

/** A deliberately cropped preview of the result the page later explains. */
function HeroOutcomePreview() {
  return (
    <aside
      className="landing-hero-preview"
      aria-label="Returned change preview"
    >
      <div className="landing-hero-preview__card">
        <header>
          <span>Returned change</span>
          <Badge tone="success" dot>Gate passed</Badge>
        </header>
        <h2>Saved views are ready for a decision</h2>
        <dl>
          <div>
            <dt>Project checks</dt>
            <dd>4 passed</dd>
          </div>
          <div>
            <dt>Proof covers</dt>
            <dd>
              <code>8f2c1ab</code>
            </dd>
          </div>
          <div>
            <dt>Decision</dt>
            <dd>Awaiting you</dd>
          </div>
        </dl>
      </div>
      <a href="#returned-change">See how the change reached this point.</a>
    </aside>
  );
}

/** Introduce the category, promise, and destination of the practice. */
function LandingHero() {
  return (
    <header className="landing-hero">
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          <p className="landing-hero__eyebrow">
            <DiscernName /> is for people who take their software seriously.
          </p>
          <h1>
            An engineering <HeadingAccent>practice</HeadingAccent>{" "}
            for agent-built software
          </h1>
          <p className="landing-hero__promise">
            Build more ambitious software. Review less code. Keep the final say.
          </p>
          <p className="landing-hero__standfirst">
            Coding agents can carry substantial implementation. discern puts the
            practice around that work into the project itself: shared
            understanding for every agent, isolated work for every task, the
            project's real checks, and evidence attached to the exact change.
          </p>
          <p className="landing-hero__standfirst landing-hero__standfirst--closing">
            More work can move without turning you into the operating layer
            around every detail.
          </p>
          <ul className="landing-hero__facts" aria-label="Product foundations">
            <li>One complete practice</li>
            <li>One local binary</li>
            <li>No model inside</li>
          </ul>
          <div className="landing-hero__buttons">
            <Button href="#returned-change" variant="primary">
              See a change come back
            </Button>
            <Button href="#begin" variant="secondary">
              Tell your agent to set it up
            </Button>
          </div>
        </div>
        <HeroOutcomePreview />
      </div>
    </header>
  );
}

/** The opening handoff from a human reader to their coding agent. */
function BeginWithDiscern() {
  return (
    <section id="begin" className="landing-begin" aria-labelledby="begin-title">
      <div className="landing-begin__inner">
        <div className="landing-begin__setup">
          <p className="landing-begin__eyebrow">Begin with discern</p>
          <h2 id="begin-title">Already working with a coding agent?</h2>
          <p className="landing-begin__lead">Give it one instruction.</p>
          <CopyPrompt id="hero-copy-prompt" />
          <Button
            href="/docs/getting-started/quickstart"
            variant="secondary"
          >
            Open the setup guide
          </Button>
        </div>
        <div className="landing-begin__explanation">
          <h3>What happens after you paste it</h3>
          <p>
            Your agent studies the repository and the tools already in use. It
            asks for the intent it cannot infer, wires the project's real
            checks, and proposes any missing conventional tools with your
            consent. Before setup can finish, it proves the practice in a fresh
            worktree.
          </p>
          <p>
            You make the decisions only you can make. The agent carries the
            project-specific setup.
          </p>
        </div>
        <div className="landing-begin__providers">
          <p>Works with:</p>
          <LogoCloud
            className="landing-begin__logo-cloud"
            aria-label="Supported coding-agent providers"
            items={PROVIDER_LOGOS}
          />
        </div>
        <nav className="landing-proof-strip" aria-label="Project evidence">
          <a href="/docs/worktrees/team-workflow">
            Built under its own practice
          </a>
          <a href={GITHUB}>Public source</a>
          <a href="/docs/decisions">Inspectable decisions</a>
        </nav>
      </div>
    </section>
  );
}

/** Three human outcomes from the practice, before product vocabulary enters. */
function HumanOutcomes() {
  return (
    <div className="landing-outcomes">
      <article>
        <span>01</span>
        <h3>Build further</h3>
        <p>
          Shape substantial work into parallel or staged efforts and let more of
          it remain in motion.
        </p>
      </article>
      <article>
        <span>02</span>
        <h3>Review less code</h3>
        <p>
          Begin with the working result, the checks that ran, and evidence for
          the exact committed change.
        </p>
      </article>
      <article>
        <span>03</span>
        <h3>Keep the final say</h3>
        <p>
          Passing conditions prepare a change for your decision. They never make
          that decision for you.
        </p>
      </article>
    </div>
  );
}

/** A restrained comparison between a conversational and project-backed return. */
function ReviewComparison() {
  return (
    <div className="landing-review-comparison" data-site-prose-exclude>
      <article>
        <span>Starting from conversation</span>
        <h3>A conversational return</h3>
        <ul>
          <li>Agent summary</li>
          <li>Code diff</li>
          <li>Test claims to reconstruct</li>
          <li>Final tree state to establish</li>
        </ul>
      </article>
      <article className="landing-review-comparison__discern">
        <span>Starting further ahead</span>
        <h3>A discern return</h3>
        <ul>
          <li>Working result</li>
          <li>Declared checks</li>
          <li>Proof for the exact commit</li>
          <li>A decision that still belongs to you</li>
        </ul>
      </article>
    </div>
  );
}

/** Illustrative return packet separating account, project verdict, evidence, and authority. */
function ReturnedChange() {
  return (
    <div className="landing-return" data-site-prose-exclude>
      <header className="landing-return__header">
        <div>
          <span>Illustrative returned change</span>
          <h3>Saved views are ready for a decision</h3>
        </div>
        <Badge tone="success" dot>Gate passed</Badge>
      </header>

      <div className="landing-return__body">
        <div className="landing-return__work">
          <section className="landing-return__account">
            <p className="landing-return__label">
              <span>01</span> Agent account
            </p>
            <h4>The requested behavior is working.</h4>
            <p>
              Named views now preserve filters, sort order, and the active view
              between sessions. A local preview is ready.
            </p>
            <dl className="landing-return__change">
              <div>
                <dt>Change</dt>
                <dd>7 files · +286 −41</dd>
              </div>
              <div>
                <dt>Worktree</dt>
                <dd>
                  <code>agent/saved-views</code>
                </dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>Preview available</dd>
              </div>
            </dl>
          </section>

          <section className="landing-return__checks">
            <header>
              <p className="landing-return__label">
                <span>02</span> Project checks
              </p>
              <strong>The declared Gate ran over the finished tree.</strong>
            </header>
            <ol>
              <li>
                <span aria-hidden="true">✓</span>Format passed
              </li>
              <li>
                <span aria-hidden="true">✓</span>Types passed
              </li>
              <li>
                <span aria-hidden="true">✓</span>Tests passed
              </li>
              <li>
                <span aria-hidden="true">✓</span>Standards held
              </li>
            </ol>
          </section>
        </div>

        <div className="landing-return__verdict">
          <section className="landing-return__proof">
            <p className="landing-return__label">
              <span>03</span> Exact-change evidence
            </p>
            <dl className="landing-return__evidence">
              <div>
                <dt>Proof covers</dt>
                <dd>
                  <code>8f2c1ab</code>
                </dd>
              </div>
              <div>
                <dt>Tree state</dt>
                <dd>clean and committed</dd>
              </div>
            </dl>
            <p>
              The evidence belongs to this commit and these declared checks. A
              later edit clears it.
            </p>
          </section>

          <section className="landing-return__decision">
            <p className="landing-return__label">
              <span>04</span> Your decision
            </p>
            <h4>Ready for the review you choose to do.</h4>
            <p>
              The routine conditions have been established. Inspect the change
              as deeply as its risk deserves, then decide whether it becomes
              shared.
            </p>
            <div className="landing-return__decision-status">
              <Badge tone="accent">Awaiting your decision</Badge>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One real project workstream expressed as a compact editorial artifact. */
function WorkstreamSteps() {
  return (
    <dl className="landing-demonstration-steps">
      <div>
        <dt>Discussed objective</dt>
        <dd>
          Make the operator view show what is happening, whether the work needs
          the person responsible, and what the recommended action will do.
        </dd>
      </div>
      <div>
        <dt>Chosen plan</dt>
        <dd>
          Complete briefs arranged into parallel foundations and dependent later
          work.
        </dd>
      </div>
      <div>
        <dt>Isolated work</dt>
        <dd>
          Separate environments with named boundaries, resources, and recorded
          dependencies.
        </dd>
      </div>
      <div>
        <dt>Independent review</dt>
        <dd>A technical pass against each brief before the work returns.</dd>
      </div>
      <div>
        <dt>Returned decision</dt>
        <dd>
          The working result, evidence for the exact changes, and the decisions
          still required.
        </dd>
      </div>
    </dl>
  );
}

/** One lesson moving from a review moment into durable project memory. */
function ProjectMemory() {
  return (
    <div className="landing-memory">
      <div className="landing-memory__lesson">
        <span>Review correction</span>
        <strong>
          “Keep every public claim beside the evidence boundary it depends on.”
        </strong>
      </div>
      <ol className="landing-memory__routes">
        <li>
          <span>Guidance</span>
          <strong>A rule every configured agent receives</strong>
        </li>
        <li>
          <span>Skill</span>
          <strong>A method a future agent can load and apply</strong>
        </li>
        <li>
          <span>Map</span>
          <strong>
            An account of the project that people and agents can inspect
          </strong>
        </li>
      </ol>
      <div className="landing-memory__next">
        <span aria-hidden="true">{DISCERN_MARK}</span>
        <div>
          <small>Next session</small>
          <strong>Begins with the lesson in view</strong>
        </div>
      </div>
    </div>
  );
}

/** One project-owned practice configured for every supported provider. */
function ProviderOrbit() {
  return (
    <div className="landing-provider-orbit" data-site-prose-exclude>
      <svg
        viewBox="0 0 600 420"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M300 210 120 72" />
        <path d="M300 210 480 72" />
        <path d="M300 210 68 226" />
        <path d="M300 210 532 226" />
        <path d="M300 210 300 360" />
      </svg>
      <div className="landing-provider-orbit__project">
        <span aria-hidden="true">{DISCERN_MARK}</span>
        <strong>Project-owned practice</strong>
        <small>guidance · methods · checks · evidence</small>
      </div>
      {PROVIDER_LOGOS.map((provider, index) => (
        <div
          className={"landing-provider-orbit__provider landing-provider-orbit__provider--" +
            String(index + 1)}
          key={provider.name}
        >
          {provider.mark}
          <strong>{provider.name}</strong>
          <small>configured instructions, hooks, and tools</small>
        </div>
      ))}
    </div>
  );
}

/** The complete proposed homepage sequence and lean public navigation. */
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
              href="#begin"
              variant="primary"
            >
              Set up discern
            </Button>
            <LandingThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <LandingHero />
        <BeginWithDiscern />

        <LandingSection
          id="ambition"
          heading="More capability should widen your ambition."
          className="landing-section--moment"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              One person can now attempt software that once required a team, a
              longer schedule, or specialist access. That is a genuine expansion
              of human capability.
            </p>
            <p>
              Implementation is only part of the work. Someone still has to
              preserve project context, turn objectives into viable tasks,
              prepare environments, coordinate dependencies, establish what
              actually passed, reconcile parallel changes, and decide what
              becomes shared.
            </p>
            <p>
              Too often, the person gains execution capacity and becomes the
              operating layer around it.
            </p>
            <p>discern moves that operating practice into the project.</p>
            <p>
              It gives coding agents a durable way to understand the project,
              carry complete units of work, verify the finished change, and
              return with a meaningful basis for a human decision.
            </p>
            <blockquote className="landing-pullquote">
              More implementation can move without demanding the same increase
              in your coordination and review.
            </blockquote>
          </div>
          <HumanOutcomes />
        </LandingSection>

        <LandingSection
          id="returned-change"
          heading="Review less code. Know exactly what passed."
          className="landing-section--decision"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              A coding agent can tell you what it changed. discern lets the
              project show you what passed.
            </p>
            <p>
              The project's final check, the{" "}
              <strong>Gate</strong>, runs over a clean, committed tree. When it
              passes, <strong>Proof</strong>{" "}
              names the exact commit and the declared conditions that succeeded.
              A later edit clears that evidence.
            </p>
            <p>
              That removes a layer of routine reconstruction from review. You do
              not have to read every line merely to discover whether the final
              version formatted, built, typechecked, or passed its tests. You
              can inspect more deeply wherever novelty, risk, architecture,
              taste, or product behavior deserves it.
            </p>
            <p>
              Passing makes the change eligible for a decision. It never grants
              itself permission to land.
            </p>
          </div>
          <ProductTerms
            terms={[
              {
                name: "Gate",
                definition:
                  "The project's final declared check over a clean, committed tree.",
                href: "/docs/quality-gate",
              },
              {
                name: "Proof",
                definition:
                  "Evidence tied to the exact committed change and declared conditions that passed.",
                href: "/docs/quality-gate/the-proof",
              },
              {
                name: "Accept",
                definition:
                  "The recorded operation that moves an authorized exact change onto the shared branch.",
                href: "/docs/worktrees/team-workflow",
              },
            ]}
          />
          <ReviewComparison />
          <ReturnedChange />
          <div className="landing-section__action">
            <Button href="/docs/quality-gate/the-proof" variant="secondary">
              See what a Proof can claim
            </Button>
          </div>
          <blockquote className="landing-pullquote">
            Build further. Stand behind what comes back.
          </blockquote>
        </LandingSection>

        <LandingSection
          id="delegation"
          heading="Put more work in motion."
          className="landing-section--artefact"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Useful work rarely arrives with clean seams. It arrives as a
              discussion, an audit, a backlog, a half-formed objective, and
              decisions that have not yet been made.
            </p>
            <p>
              discern's <strong>Delegate Work</strong>{" "}
              method turns that material into complete briefs and an explicit
              plan: one handoff, several independent workstreams, or stages with
              recorded dependencies.
            </p>
            <p>Nothing starts until you choose the plan.</p>
            <p>
              Each effort receives a literal scope, its own isolated and
              provisioned worktree, a definition of done, and a clear boundary
              of authority. Dependent efforts can wait on recorded project
              conditions instead of asking you to relay messages between agents.
            </p>
            <p>
              Several substantial pieces can move at once without making you
              their courier.
            </p>
          </div>
          <ProductTerms
            terms={[
              {
                name: "Delegate Work",
                definition:
                  "A project method for turning discussed work into complete handoffs, parallel streams, or staged dependencies.",
                href: "/docs/worktrees/team-workflow",
              },
              {
                name: "Start",
                definition:
                  "Creates one isolated, prepared worktree for a bounded effort.",
                href: "/docs/worktrees",
              },
              {
                name: "Await",
                definition:
                  "Waits on a recorded branch or trunk condition without making you relay readiness.",
                href: "/docs/worktrees/team-workflow",
              },
            ]}
          />
          <div className="landing-workstream">
            <div>
              <h3>A real discern workstream</h3>
              <p>
                We used this practice to redesign discern's own operator view.
                Two foundations moved at the same time. Later work began from
                the exact results it needed. The complete plan, briefs, reviews,
                and returned evidence are inspectable.
              </p>
            </div>
            <WorkstreamSteps />
            <div className="landing-section__action">
              <Button href="/docs/worktrees/team-workflow" variant="secondary">
                See the real workstream plan
              </Button>
            </div>
            <aside className="landing-built-under">
              <h3>Built under its own practice</h3>
              <p>
                discern began when capable agents multiplied implementation
                faster than personal review could comfortably follow. It has
                been developed under the resulting practice ever since. Its{" "}
                <a href={GITHUB}>public source</a> and{" "}
                <a href="/docs/decisions">decision records</a>{" "}
                make that process inspectable.
              </p>
            </aside>
          </div>
        </LandingSection>

        <LandingSection
          id="commissioning"
          heading="Every agent starts with the project already in view."
          className="landing-section--split-artefact"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Repeated prompts and private conversation history are weak places
              to keep a project's way of working.
            </p>
            <p>
              <strong>Commissioning</strong>{" "}
              begins with the repository you already have. Your agent studies
              the code, structure, tools, and checks in use. It asks for the
              intent it cannot infer, proposes missing conventional tools with
              your consent, and establishes the shared guidance, reusable
              methods, project map, and declared checks that future agents will
              inherit.
            </p>
            <p>
              Before Commissioning can finish, discern proves the practice in a
              fresh worktree. If the probe fails, setup remains open and
              identifies what still needs resolving.
            </p>
            <p>
              Once the practice is established, every configured agent begins
              with the same project-owned understanding. A new session does not
              have to reconstruct the project's standards from the last
              conversation.
            </p>
            <blockquote className="landing-pullquote">
              Teach the project once. Let future agents begin from what it
              knows.
            </blockquote>
          </div>
          <ProductTerms
            terms={[
              {
                name: "Commissioning",
                definition:
                  "The agent studies, establishes, and proves the project's way of working.",
                href: "/docs/getting-started/walkthrough",
              },
              {
                name: "Guidance",
                definition:
                  "Shared project instructions written once and supplied to every configured agent.",
                href: "/docs/agent-guidance",
              },
              {
                name: "Skill",
                definition:
                  "A reusable agent playbook that future sessions can load and apply.",
                href: "/docs/skills",
              },
              {
                name: "Map",
                definition:
                  "A maintained, inspectable account of what agents understand about the project.",
                href: "/docs/project-map",
              },
            ]}
          />
          <div className="landing-commissioning">
            <h3>Commissioning the existing project</h3>
            <div className="landing-split">
              <div className="landing-prose">
                <p>
                  Your agent carries the project-specific setup. You make the
                  decisions only you can make.
                </p>
                <p>
                  The resulting practice belongs to the repository, where the
                  next configured agent can begin from it.
                </p>
              </div>
              <div className="landing-commissioning-summary">
                <p className="landing-prose__declaration">Commissioning</p>
                <ol className="landing-sequence-labels">
                  <li>
                    <strong>Study the repository</strong>
                    <span>
                      Understand the code, structure, tools, and checks already
                      present.
                    </span>
                  </li>
                  <li>
                    <strong>Ask for human intent</strong>
                    <span>
                      Surface the decisions that cannot be recovered from the
                      repository.
                    </span>
                  </li>
                  <li>
                    <strong>Establish the practice</strong>
                    <span>
                      Create the shared guidance, methods, checks, and
                      maintained project understanding.
                    </span>
                  </li>
                  <li>
                    <strong>Prove it in isolation</strong>
                    <span>
                      Run the practice successfully in a fresh worktree.
                    </span>
                  </li>
                  <li>
                    <strong>Begin from one starting point</strong>
                    <span>
                      Give each configured agent the same established way of
                      working.
                    </span>
                  </li>
                </ol>
                <Button
                  href="/docs/getting-started/walkthrough"
                  variant="secondary"
                >
                  Watch a project get commissioned
                </Button>
              </div>
            </div>
          </div>
        </LandingSection>

        <LandingSection
          id="compounding"
          heading="Make an improvement part of the next starting point."
          className="landing-section--compounding"
        >
          <div className="landing-prose landing-prose--wide">
            <p>Good work can improve more than the feature it delivers.</p>
            <p>Two kinds of progress can survive the task that created them.</p>
            <h3>Retain the measurable gain</h3>
            <p>
              When a configured measure improves, discern can pin the stronger
              value as a{" "}
              <strong>Standard</strong>. Later branches can meet it or improve
              it. They cannot weaken the committed limit merely to pass.
            </p>
            <h3>Retain the useful lesson</h3>
            <p>
              A correction can travel too. Put it in shared Guidance, a reusable
              Skill, the maintained Map, a decision record, or a gotcha that
              appears when the same kind of failure returns.
            </p>
          </div>

          <div className="landing-compounding" data-site-prose-exclude>
            <article className="landing-compounding__measure">
              <header>
                <span>01 · Standard trajectory</span>
                <h3>The bar moves with the work.</h3>
              </header>
              <div className="landing-artefact landing-artefact--standard">
                <CompactStandardTrajectory />
              </div>
              <p>
                Six suppressions were removed. The stronger limit becomes the
                next branch's starting point.
              </p>
            </article>

            <article className="landing-compounding__memory">
              <header>
                <span>02 · Lesson retained</span>
                <h3>Put the lesson where the next agent will find it.</h3>
              </header>
              <ProjectMemory />
            </article>
          </div>

          <blockquote className="landing-pullquote">
            The next branch starts from the gain. The next session starts from
            the lesson.
          </blockquote>
          <div className="landing-inline-actions landing-section__action">
            <Button href="/docs/quality-gate/standards" variant="secondary">
              See how Standards retain gains
            </Button>
            <Button href="/docs/agent-guidance" variant="secondary">
              See how project guidance travels
            </Button>
          </div>
        </LandingSection>

        <LandingSection
          id="providers"
          heading="Change the agent. Keep the project."
          className="landing-section--agents"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              People move between coding-agent providers because of task fit,
              preference, availability, subscription limits, and changing model
              quality.
            </p>
            <p>
              discern keeps the working practice in the project. Configure
              Claude Code, Codex, Gemini, Cursor, or GitHub Copilot, and each
              receives the same project-owned guidance and works through the
              same checks, methods, standards, and evidence model.
            </p>
            <p>
              Move when the work calls for it without teaching the project from
              the beginning again.
            </p>
            <p>
              Hidden conversational state and provider-specific capabilities do
              not transfer. The project's way of working does.
            </p>
            <blockquote className="landing-pullquote">
              Switch providers without re-teaching the work.
            </blockquote>
          </div>
          <ProviderOrbit />
          <div className="landing-inline-actions landing-section__action">
            <Button href="/docs/agent-integrations" variant="secondary">
              Compare the agent integrations
            </Button>
            <Button href="/llms.txt" variant="secondary">
              Read the machine guide
            </Button>
          </div>
          <aside className="landing-agent-operator">
            <h3>Built for the machine doing the work.</h3>
            <p>
              discern treats the coding agent as its day-to-day operator. Its
              structured tools return bounded results, explicit state, and a
              useful next step. When an action is refused, the result explains
              how to proceed. People and agents see the same underlying answer.
            </p>
            <p>
              Less has to be translated. More agent context remains available
              for the work itself.
            </p>
          </aside>
        </LandingSection>

        <LandingSection
          id="trust"
          heading="Exact evidence. Explicit authority."
          className="landing-section--trust"
        >
          <p className="landing-section__intro">
            discern is designed to make its claims inspectable and its
            boundaries plain.
          </p>
          <div className="landing-trust-grid">
            <article>
              <h3>Local by design</h3>
              <p>
                discern is a self-contained local binary. It contains no model,
                needs no API key, and makes no network calls. Its optional
                activity record stays on the machine and contains metadata
                rather than source code or command output.
              </p>
              <p>
                Coding agents and the commands your project declares may still
                use networks, models, or paid services.
              </p>
            </article>
            <article>
              <h3>Evidence that stays exact</h3>
              <p>
                A Proof says that one exact clean commit passed the Gate and the
                conditions the project declared. It does not certify security,
                universal correctness, or production suitability.
              </p>
            </article>
            <article>
              <h3>Authority remains yours</h3>
              <p>
                A green Gate grants nothing by itself. You accept the change, or
                record a narrower permission in advance. Uncertainty returns to
                the person responsible.
              </p>
            </article>
            <article>
              <h3>Use the right security boundary</h3>
              <p>
                discern does not sandbox the coding agent. Run the agent inside
                the security boundary appropriate to your project.
              </p>
            </article>
          </div>
          <p className="landing-license">
            The source is available under <a href={LICENSE}>FSL-1.1-ALv2</a>
            {" "}
            and free to use for permitted purposes. Each version receives an
            Apache-2.0 future license on its second anniversary.
          </p>
          <div className="landing-inline-actions landing-section__action">
            <Button
              href="/docs/orientation/trust-and-data"
              variant="secondary"
            >
              Review the trust boundaries
            </Button>
            <Button href={GITHUB} variant="secondary">
              Inspect the public source
            </Button>
          </div>
        </LandingSection>

        <LandingSection
          id="serious-software"
          heading="Software worth putting your name to."
          className="landing-section--closing"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Coding agents have expanded who can build software and how far one
              person can take an idea. discern exists for the moment that
              software matters enough to deserve a durable way of working.
            </p>
            <p>
              Some people arrive with years of engineering judgment. Others
              arrive because the thing they built with agents now has users,
              data, revenue, maintenance obligations, or a reputation.
            </p>
            <p>
              They begin in different places. They share a choice: take the
              software seriously and lean further into what coding agents make
              possible.
            </p>
            <p>
              The prototype can become a product. The side project can become
              part of someone's workday. The thing you built can grow into
              software you are proud to stand behind.
            </p>
            <blockquote className="landing-pullquote">
              Let agents carry more of the implementation. Review less code.
              Keep the final say.
            </blockquote>
          </div>
          <div className="landing-final-cta">
            <header>
              <h3>Put the practice in your project.</h3>
              <p>
                Already working with a coding agent? Give it the next
                instruction.
              </p>
              <p>
                The setup prompt sends it to discern's machine guide and through
                Commissioning for the current repository. It carries the
                project-specific work and brings you the decisions it cannot
                make.
              </p>
            </header>
            <div className="landing-closing">
              <div>
                <CopyPrompt id="closing-copy-prompt" />
              </div>
              <div className="landing-install">
                <p className="landing-install__label">Prefer the terminal?</p>
                <pre><code>{INSTALL_COMMAND}</code></pre>
                <p>
                  Install the local binary, then ask your agent to commission
                  the project.
                </p>
                <Button
                  href="/docs/getting-started/quickstart"
                  variant="secondary"
                >
                  Open the setup guide
                </Button>
              </div>
            </div>
          </div>
        </LandingSection>
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
      "specimens.css",
      "landing.css",
    ],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
