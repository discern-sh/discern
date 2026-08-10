/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Brand,
  Button,
  HeadingAccent,
  SiteFooter,
  SkipLink,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { DISCERN_MARK, LANDING_DESCRIPTION, LANDING_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { CompactStandardTrajectory } from "./specimens.tsx";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = `${GITHUB}/blob/main/LICENSE`;
export const COPY_PROMPT_TEXT =
  "Set this project up with discern. Start by fetching https://discern.sh/llms.txt, then follow the setup instructions there.";
export const INSTALL_COMMAND = "curl -fsSL https://discern.sh/install | sh";

/** Beam origins for the native providers, in the catalogue's canonical display order. */
const PRISM_PROVIDER_X = {
  claude_code: 58,
  codex: 179,
  gemini: 300,
  cursor: 421,
  copilot: 542,
} as const satisfies Record<(typeof AGENT_NAMES)[number], number>;

/** The native provider set projected into the interactive hero artwork. */
const PRISM_PROVIDERS = AGENT_NAMES.map((name, index) => {
  const provider = PROVIDERS[name];
  const silhouette = providerBrandSilhouette(provider.brand);
  return {
    delay: `${index * -0.31}s`,
    id: name,
    name: provider.label,
    path: provider.brand.mark.path,
    silhouette: silhouette.path,
    x: PRISM_PROVIDER_X[name],
  };
});

interface LandingSectionProps {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
  readonly className?: string;
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

/** Progressive Copy prompt control; its source text remains visible without JavaScript. */
function CopyPrompt(
  { id }: {
    readonly id: string;
  },
) {
  const statusId = `${id}-status`;
  return (
    <div className="landing-copy-prompt">
      <blockquote id={id} className="landing-copy-prompt__text">
        {COPY_PROMPT_TEXT}
      </blockquote>
      <Button
        className="landing-copy-prompt__button"
        type="button"
        data-copy-prompt=""
        data-copy-prompt-progressive=""
        data-copy-prompt-target={id}
        aria-describedby={`${id} ${statusId}`}
        hidden
      >
        Copy prompt
      </Button>
      <span
        id={statusId}
        className="landing-copy-prompt__status"
        aria-live="polite"
      />
    </div>
  );
}

/** A provider-selectable setup action rendered as discern's intelligence prism. */
function ProviderPrism() {
  const promptId = "hero-copy-prompt";
  const statusId = `${promptId}-status`;
  return (
    <div className="landing-prism" data-provider-prism="">
      <div className="landing-prism__header">
        <p>Choose your coding agent</p>
        <p data-prism-instruction="">Hover to channel. Click to copy.</p>
      </div>

      <div className="landing-prism__stage">
        <div
          className="landing-prism__providers"
          role="group"
          aria-label="Copy the discern setup prompt for your coding agent"
        >
          {PRISM_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className="landing-prism__provider"
              style={{
                "--landing-prism-delay": provider.delay,
                "--landing-prism-position": provider.x / 6,
                "--landing-provider-logo-mask": `url("${provider.silhouette}")`,
              } as CSSProperties}
              data-prism-provider={provider.id}
              data-copy-prompt=""
              data-copy-prompt-provider={provider.name}
              data-copy-prompt-target={promptId}
              data-copy-prompt-status={statusId}
              aria-label={`Copy setup prompt for ${provider.name}`}
              aria-describedby={`${promptId} ${statusId}`}
            >
              <span className="landing-provider-logo-frame">
                <img
                  className="landing-provider-logo"
                  src={provider.path}
                  alt=""
                  width={42}
                  height={42}
                  decoding="async"
                />
              </span>
              <span className="landing-prism__provider-name">
                {provider.name}
              </span>
              <span
                className="landing-visually-hidden"
                data-copy-prompt-label=""
                aria-hidden="true"
              >
                Copy setup prompt for {provider.name}
              </span>
            </button>
          ))}
        </div>

        <svg
          className="landing-prism__art"
          viewBox="0 0 600 470"
          role="img"
          aria-label="Coding agent providers channel energy into the discern mark"
        >
          <defs>
            <linearGradient id="landing-prism-beam" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--landing-prism-cyan)" />
              <stop
                offset="0.55"
                stopColor="var(--landing-prism-violet)"
              />
              <stop offset="1" stopColor="var(--landing-prism-pink)" />
            </linearGradient>
            <linearGradient id="landing-prism-left" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#b88cff" stopOpacity="0.34" />
              <stop offset="1" stopColor="#6038a8" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient
              id="landing-prism-right"
              x1="1"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0" stopColor="#8ef2ff" stopOpacity="0.28" />
              <stop offset="1" stopColor="#5742a0" stopOpacity="0.05" />
            </linearGradient>
            <radialGradient id="landing-prism-core">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.3" stopColor="#d7c4ff" />
              <stop offset="1" stopColor="#8f68dc" stopOpacity="0" />
            </radialGradient>
            <filter
              id="landing-prism-glow"
              x="-80%"
              y="-80%"
              width="260%"
              height="260%"
            >
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <g className="landing-prism__grid" aria-hidden="true">
            <path d="M48 123H552" />
            <path d="M48 183H552" />
            <path d="M48 243H552" />
            <path d="M48 303H552" />
            <path d="M48 363H552" />
            <path d="M108 94V414" />
            <path d="M204 94V414" />
            <path d="M300 94V414" />
            <path d="M396 94V414" />
            <path d="M492 94V414" />
          </g>

          {PRISM_PROVIDERS.map((provider) => (
            <g
              key={provider.id}
              className="landing-prism__beam"
              data-prism-beam={provider.id}
              style={{
                "--landing-prism-delay": provider.delay,
              } as CSSProperties}
            >
              <path
                className="landing-prism__beam-rail"
                d={`M${provider.x} 65 L300 161`}
              />
              <path
                className="landing-prism__beam-energy"
                d={`M${provider.x} 65 L300 161`}
              />
            </g>
          ))}

          <path
            className="landing-prism__triangle-glow"
            d="M300 157 496 421H104Z"
          />
          <path
            className="landing-prism__triangle landing-prism__triangle--left"
            d="M300 157 300 421H104Z"
          />
          <path
            className="landing-prism__triangle landing-prism__triangle--right"
            d="M300 157 496 421H300Z"
          />
          <path className="landing-prism__facet" d="M300 157V421" />
          <path className="landing-prism__facet" d="M201 289H399" />
          <path className="landing-prism__facet" d="M151 356H449" />
          <circle
            className="landing-prism__apex-glow"
            cx="300"
            cy="160"
            r="42"
          />
          <circle
            className="landing-prism__apex"
            cx="300"
            cy="160"
            r="4"
          />
        </svg>

        <div className="landing-prism__core" aria-hidden="true">
          <span className="landing-prism__mark">{DISCERN_MARK}</span>
          <span className="landing-prism__name">discern</span>
          <span className="landing-prism__core-label">practice online</span>
        </div>
      </div>

      <div className="landing-prism__readout">
        <span className="landing-prism__readout-label">Copies to chat</span>
        <blockquote id={promptId} className="landing-prism__prompt">
          {COPY_PROMPT_TEXT}
        </blockquote>
      </div>
      <p
        id={statusId}
        className="landing-prism__status"
        aria-live="polite"
      >
        Choose a provider
      </p>
    </div>
  );
}

/** Shared editorial wrapper for one signed-off homepage section. */
function LandingSection(
  { id, heading, children, className = "" }: LandingSectionProps,
) {
  return (
    <section
      id={id}
      className={`landing-section ${className}`.trim()}
      aria-labelledby={`${id}-title`}
    >
      <div className="landing-section__inner">
        <header className="landing-section__header">
          <h2 id={`${id}-title`}>{heading}</h2>
        </header>
        {children}
      </div>
    </section>
  );
}

/** Introduce the ambition, category, and signature action. */
function LandingHero() {
  return (
    <header className="landing-hero">
      <div className="landing-hero__inner">
        <div className="landing-hero__copy">
          <p className="landing-hero__eyebrow">
            <DiscernName /> is for people who take their software seriously.
          </p>
          <h1>
            An engineering practice for{" "}
            <HeadingAccent>agent-built software</HeadingAccent>
          </h1>
          <p className="landing-hero__standfirst">
            Coding agents can take on real work. discern makes the way of
            working part of the project: shared context, work in its own place,
            declared checks, and evidence for each change. You can aim higher
            without staying inside every detail.
          </p>
          <ul className="landing-hero__facts" aria-label="Product foundations">
            <li>One complete practice</li>
            <li>One local binary</li>
            <li>No model inside</li>
          </ul>
        </div>
        <aside
          className="landing-hero__action"
          aria-label="Choose your coding agent and copy the discern setup prompt"
        >
          <ProviderPrism />
        </aside>
      </div>
    </header>
  );
}

/** The complete signed-off homepage sequence and lean public navigation. */
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
            <a href="/docs">Docs</a>
            <a href={GITHUB}>GitHub ↗</a>
            <LandingThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main">
        <LandingHero />

        <LandingSection
          id="possibility"
          heading="More capability should widen your ambition."
          className="landing-section--moment"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              One person can now attempt work that used to require a team, a
              longer schedule, or specialist access. That is a genuine expansion
              of human capability.
            </p>
            <p>
              But implementation is only part of the work. Someone still has to
              preserve project context, turn objectives into viable work, and
              prepare environments. They have to coordinate dependencies, check
              what actually ran, reconcile parallel changes, and decide what
              becomes shared.
            </p>
            <p>
              The person gained execution capacity and became the operating
              layer around it.
            </p>
            <p>discern moves that operating practice into the project.</p>
            <p>
              Software earns confidence through the way it is built. discern
              gives that way of working somewhere durable to live.
            </p>
            <blockquote className="landing-pullquote">
              More implementation can move. Your attention can stay with
              direction, architecture, trade-offs, exceptions, and the working
              result.
            </blockquote>
          </div>
        </LandingSection>

        <LandingSection
          id="delegation"
          heading="Turn a backlog into organized work."
          className="landing-section--artefact"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Useful work rarely arrives with clean seams. It arrives as a
              discussion, audit findings, backlog items, and decisions that have
              not yet been made.
            </p>
            <p>
              discern's <strong>Delegate Work</strong>{" "}
              method turns that material into complete briefs. It makes the plan
              explicit: one handoff, several independent workstreams, or stages
              with recorded dependencies.
            </p>
            <p>Nothing is dispatched until you choose the plan.</p>
            <p>
              Each workstream receives a literal boundary, its own worktree, a
              definition of done, and a clear scope of authority. Dependencies
              move through the recorded plan instead of through you.
            </p>
            <p>
              Finished work returns through an independent technical review. The
              working result, its evidence, and the next decision come back
              together.
            </p>
            <p>
              We used this method to redesign discern's own operator view. Two
              foundations could move at the same time. Later work waited for the
              results it needed. The complete plan, briefs, reviews, and
              returned evidence are inspectable.
            </p>
          </div>
          <dl className="landing-demonstration-steps">
            <div>
              <dt>Discussed objective</dt>
              <dd>
                Make the operator view show what is happening, whether the work
                needs the person responsible, and what the recommended action
                will do.
              </dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>
                Complete briefs arranged into independent and staged
                workstreams.
              </dd>
            </div>
            <div>
              <dt>Work</dt>
              <dd>
                Separate environments with named boundaries and recorded
                dependencies.
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>An independent technical pass against each brief.</dd>
            </div>
            <div>
              <dt>Return</dt>
              <dd>
                The working result, evidence for the exact change, and a
                decision.
              </dd>
            </div>
          </dl>
          <div className="landing-section__action">
            <Button href="/docs/worktrees/team-workflow" variant="secondary">
              See the real workstream plan
            </Button>
          </div>
        </LandingSection>

        <LandingSection
          id="commissioning"
          heading="A complete practice, by design."
          className="landing-section--split-artefact"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Each part of discern reinforces the next.
            </p>
            <p>
              Project understanding shapes the brief. The brief defines the
              work. The work runs in an isolated environment. The project's own
              commands judge the finished tree. Evidence records exactly what
              passed. A person with authority decides what lands. A demonstrated
              improvement can become part of the next baseline.
            </p>
            <p>
              Every discern project adopts the whole method. Configuration fits
              it to the repository; it does not decide which parts count.
            </p>
            <blockquote className="landing-pullquote">
              The consistency is the product.
            </blockquote>
          </div>

          <ol
            className="landing-practice-flow"
            aria-label="The discern practice"
          >
            <li>Commission the project</li>
            <li>Shape the work</li>
            <li>Isolate each effort</li>
            <li>Verify the exact change</li>
            <li>Decide what lands</li>
            <li>Keep the gains</li>
          </ol>

          <div className="landing-commissioning">
            <h3>Commission the project you already have.</h3>
            <div className="landing-split">
              <div className="landing-prose">
                <p>
                  <strong>Commissioning</strong> begins with the repository.
                </p>
                <p>
                  Your agent studies the code and the tools already in use, then
                  asks for the intent it cannot infer. It wires the project's
                  real checks and proposes missing conventional tools only with
                  your consent. It establishes the guidance, principles,
                  reusable methods, and maintained project guide that future
                  agents will inherit.
                </p>
                <p>
                  Before Commissioning can finish, discern proves the practice
                  in a fresh Git worktree. If that probe fails, setup remains
                  open and identifies what still needs resolving.
                </p>
                <p>
                  Your agent carries the project-specific setup. You make the
                  decisions only you can make.
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
                      Create the shared guidance, methods, checks, and project
                      understanding.
                    </span>
                  </li>
                  <li>
                    <strong>Prove it in isolation</strong>
                    <span>
                      Run the practice successfully in a fresh worktree.
                    </span>
                  </li>
                  <li>
                    <strong>Accept the result</strong>
                    <span>
                      Begin future sessions from the same established starting
                      point.
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
          id="practice"
          heading="The project keeps the way of working."
          className="landing-section--practice"
        >
          <div className="landing-reasons">
            <article>
              <h3>A starting point for every agent.</h3>
              <p>
                One authored source becomes guidance for every configured
                coding-agent provider. Reusable methods and a maintained project
                guide carry the project's expectations and understanding into
                future sessions.
              </p>
              <p>
                Change agents without rebuilding the project from conversation
                history.
              </p>
            </article>
            <article>
              <h3>A proper place for every effort.</h3>
              <p>
                Each task receives its own Git worktree and branch, together
                with its own identity, environment values, and declared
                resources.
              </p>
              <p>
                Parallel agents cannot overwrite one another's checkout. When
                separate branches touch the same source files, discern surfaces
                the overlap for integration.
              </p>
            </article>
            <article>
              <h3>Evidence for the exact change.</h3>
              <p>
                At completion, the <strong>Gate</strong>{" "}
                runs the project's declared commands. Its result decides whether
                the work is green; the agent's confidence remains advisory.
              </p>
              <p>
                When a clean committed tree passes, a <strong>Proof</strong>
                names the exact commit and the conditions it covered. Add
                another commit and the evidence becomes stale.
              </p>
              <p>
                Passing prepares a change for a decision. It never grants
                authority by itself.
              </p>
            </article>
          </div>
          <div className="landing-standard-feature">
            <div className="landing-prose">
              <h3>A stronger baseline after good work.</h3>
              <p>
                A <strong>Standard</strong>{" "}
                turns a useful measure into a one-way limit.
              </p>
              <p>
                When the project improves, discern can pin the stronger value.
                Later branches can meet it or improve it; they cannot quietly
                loosen it.
              </p>
              <p>
                Measures still require judgment. Legitimate growth can change
                the right limit. The purpose is to make that change deliberate
                rather than incidental.
              </p>
            </div>
            <div
              className="landing-artefact landing-artefact--standard"
              data-site-prose-exclude
            >
              <CompactStandardTrajectory />
            </div>
          </div>
          <div className="landing-section__action">
            <Button href="/docs" variant="secondary">
              Explore the complete engineering practice
            </Button>
          </div>
        </LandingSection>

        <LandingSection
          id="audiences"
          heading="You do not need the same background. You do need to care what happens next."
          className="landing-section--audiences"
        >
          <div className="landing-prose landing-prose--wide">
            <p>Some people arrive with years of engineering judgment.</p>
            <p>
              Others arrive because the thing they built through agents now has
              users, data, revenue, maintenance obligations, or a reputation.
            </p>
            <p>
              They begin in different places. They share the same threshold:
            </p>
            <blockquote className="landing-pullquote">
              The software has consequences now.
            </blockquote>
            <p>
              For experienced engineers, discern turns accumulated judgment into
              a project-owned practice that can influence more of the
              implementation.
            </p>
            <p>
              For newer builders, it provides a serious starting point, brings
              consequential choices into view, and makes clear where experience
              still matters.
            </p>
          </div>
          <p className="landing-audiences__bridge">
            Experience remains valuable. discern gives it somewhere durable to
            work.
          </p>
        </LandingSection>

        <LandingSection
          id="agents"
          heading="Change the agent. Keep the project."
          className="landing-section--agents"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Configure Claude Code, Codex, Gemini, Cursor, or GitHub Copilot.
              Each receives the same project-owned guidance and works through
              the same discern practice.
            </p>
            <p>
              Move when task fit, preference, availability, or quota changes
              without teaching the project from the beginning again.
            </p>
            <p>
              Hidden conversational state and provider-specific capabilities do
              not transfer. The project's way of working does.
            </p>
          </div>
          <div className="landing-machine">
            <div>
              <h3>Built for the machine doing the work.</h3>
              <p>
                discern treats the coding agent as its day-to-day operator. Its
                structured tools return bounded results, explicit state, and a
                useful next step. When an action is refused, the result explains
                how to proceed. People and agents see the same underlying
                answer. That leaves less to translate and more context for the
                work.
              </p>
            </div>
            <div className="landing-machine__actions">
              <Button href="/docs/agent-integrations" variant="secondary">
                Compare the agent integrations
              </Button>
              <Button href="/llms.txt" variant="secondary">
                Read the machine guide
              </Button>
            </div>
          </div>
        </LandingSection>

        <LandingSection
          id="trust"
          heading="Exact evidence. Explicit authority."
          className="landing-section--trust"
        >
          <div className="landing-trust-grid">
            <article>
              <p>
                discern is a local, self-contained binary. It contains no AI
                model and needs no API key.
              </p>
              <p>
                Its local activity record stays on the machine, contains
                metadata, and excludes source code and command output. Coding
                agents and project commands may still use networks, models, or
                paid services.
              </p>
              <p>
                A Proof says that one exact clean commit passed the Gate and the
                conditions the project declared. It does not certify security,
                universal correctness, or production suitability.
              </p>
              <p>
                Passing grants no authority by itself. The person responsible
                decides what becomes shared, or records a narrower permission in
                advance.
              </p>
              <p>
                discern does not sandbox the coding agent. Use it inside the
                security boundary appropriate to your project.
              </p>
              <p>
                The source is available under <a href={LICENSE}>FSL-1.1-ALv2</a>
                {" "}
                and free to use for permitted purposes. Each version receives an
                Apache-2.0 future license on its second anniversary.
              </p>
              <div className="landing-inline-actions">
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
            </article>
            <article>
              <h3>Built under its own practice.</h3>
              <p>
                discern began when capable agents multiplied implementation
                faster than personal review could comfortably follow. The answer
                was to move more of the working practice out of one person's
                head and into the project.
              </p>
              <p>
                discern has been developed under that practice ever since. Its
                public source and <a href="/docs/decisions">decision records</a>
                {" "}
                make the process inspectable.
              </p>
            </article>
          </div>
        </LandingSection>

        <LandingSection
          id="begin"
          heading="Software worth putting your name to."
          className="landing-section--closing"
        >
          <div className="landing-closing">
            <div>
              <p>
                Let coding agents carry more of the implementation. Put one
                complete engineering practice behind the work.
              </p>
              <p>
                Already working with a coding agent? Give it the next
                instruction.
              </p>
              <p>
                The setup prompt sends it to discern's machine guide and through
                Commissioning for the current repository. It will carry the
                project-specific work and bring you the decisions it cannot
                make.
              </p>
              <CopyPrompt id="closing-copy-prompt" />
            </div>
            <div className="landing-install">
              <p>Prefer the terminal?</p>
              <pre><code>{INSTALL_COMMAND}</code></pre>
              <p>
                Install the local binary, then ask your agent to commission the
                project.
              </p>
              <Button
                href="/docs/getting-started/quickstart"
                variant="secondary"
              >
                Open the setup guide
              </Button>
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
