/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
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
import {
  CommissioningTimeline,
  DelegationWavePlan,
  ProofSpecimen,
  StandardTrajectory,
} from "./specimens.tsx";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = `${GITHUB}/blob/main/LICENSE`;
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

/** Page-owned baseline correction for the Unicode mark and mono wordmark. */
function DiscernName() {
  return <span className="landing-brand-name">discern</span>;
}

/** Progressive Copy prompt control; its source text remains visible without JavaScript. */
function CopyPrompt({ id }: { readonly id: string }) {
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
            A <HeadingAccent>bolder</HeadingAccent> way to build.
          </h1>
          <p className="landing-hero__standfirst">
            Let coding agents take on substantial work while the project keeps
            the understanding, working conditions, and evidence you need to take
            it further.
          </p>
          <p className="landing-hero__category">
            An engineering practice for agent-built software.
          </p>
        </div>
        <aside className="landing-hero__action" aria-label="Begin with discern">
          <p>
            Already working with a coding agent? Copy the setup prompt into the
            conversation.
          </p>
          <CopyPrompt id="hero-copy-prompt" />
          <Button href="#delegation" variant="secondary">
            See discern in practice
          </Button>
          <p className="landing-license-note">
            Free to use for permitted purposes under the{" "}
            <a href={LICENSE}>Free and Fair Source license (FSL-1.1-ALv2)</a>.
          </p>
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

        <LandingSection
          id="possibility"
          heading="Agent capability changed the size of the possible."
          className="landing-section--moment"
        >
          <div className="landing-prose landing-prose--lead">
            <p>
              Coding agents have opened software to more people and expanded
              what experienced engineers can direct. Work that once needed a
              team, a longer schedule, or a narrower ambition can now begin with
              one person and a capable agent.
            </p>
            <p>
              That abundance changes the work around the code. Implementation
              can spread across sessions faster than one person can coordinate
              and review it. A larger ambition needs more of the way of working
              to stay with the project.
            </p>
            <Button href="#delegation" variant="ghost">
              See a backlog become a plan
            </Button>
          </div>
        </LandingSection>

        <LandingSection
          id="delegation"
          heading="Turn a backlog into organized work."
          className="landing-section--artefact"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              A useful objective rarely arrives with clean seams. discern's
              Delegate Work method turns the discussion into complete briefs and
              makes the planning choice explicit: one handoff, several
              independent streams, or staged dependencies.
            </p>
            <p>
              The plan behind discern's human view of work in progress, the
              Desk, began with a product audit and a backlog. It gave each
              workstream a literal boundary, a dependency, an authority, and a
              definition of done. Two foundations could move together. Later
              work waited for the results it needed, without making a person
              relay readiness between sessions.
            </p>
            <p>
              You decide what gets dispatched. Each task receives a separate
              place to work, dependencies follow the recorded plan, and every
              stream returns through an independent review with evidence for the
              decision ahead.
            </p>
          </div>
          <dl className="landing-demonstration-steps">
            <div>
              <dt>Discussed objective</dt>
              <dd>
                Make the Desk answer what is happening, whether the work needs
                the person responsible, and what the recommended action will do.
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
                Separate environments with named boundaries and dependencies.
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>An independent technical pass against each brief.</dd>
            </div>
            <div>
              <dt>Return</dt>
              <dd>The working result, evidence, and a decision.</dd>
            </div>
          </dl>
          <div className="landing-section__action">
            <Button href="#delegation-plan" variant="secondary">
              See how several agents work together
            </Button>
          </div>
          <div
            id="delegation-plan"
            className="landing-artefact landing-artefact--delegation"
            data-site-prose-exclude
            tabIndex={-1}
          >
            <DelegationWavePlan />
          </div>
        </LandingSection>

        <LandingSection
          id="commissioning"
          heading="Give future agents a better starting point."
          className="landing-section--split-artefact"
        >
          <div className="landing-split">
            <div className="landing-prose">
              <p>
                Commissioning begins with the repository. Your agent studies the
                code, then asks for the intent it cannot find there. It wires
                the checks the project already uses, proposes missing
                conventional tools with your consent, and writes the guidance,
                principles, and maintained project guide future agents receive.
              </p>
              <p>
                Before commissioning finishes, discern proves that the project
                can run the practice in a fresh isolated workspace, called a Git
                worktree. A failed probe keeps setup open and identifies what
                must be resolved.
              </p>
              <p>
                The agent does the project-specific work and asks for the
                decisions only you can make. Commissioning takes real agent
                effort; it does not become a manual configuration project for
                you.
              </p>
              <p className="landing-prose__declaration">
                A serious engineering practice, installed in your project.
              </p>
              <ol className="landing-sequence-labels">
                <li>Study the repository</li>
                <li>Ask for human intent</li>
                <li>Establish checks and guidance</li>
                <li>Prove the practice in a fresh worktree</li>
                <li>Give future agents the same starting point</li>
              </ol>
              <Button href="#commissioning-timeline" variant="secondary">
                Watch a project get commissioned
              </Button>
            </div>
            <div
              id="commissioning-timeline"
              className="landing-artefact landing-artefact--commissioning"
              data-site-prose-exclude
              tabIndex={-1}
            >
              <CommissioningTimeline />
            </div>
          </div>
        </LandingSection>

        <LandingSection
          id="standards"
          heading="Software worth putting your name to."
          className="landing-section--outcome"
        >
          <div className="landing-split landing-split--reverse">
            <div className="landing-prose">
              <p>
                A prototype becomes something more when people begin to depend
                on it, when its data matters, and when every change carries
                consequences. That is an achievement worth meeting with a way of
                working the project can keep.
              </p>
              <p>
                Once the project earns a measurable gain, a later branch cannot
                weaken the recorded limit. A quality measure called a Standard
                gives that gain somewhere to stay. When a configured measure
                improves, discern can pin the new limit for future work.
              </p>
              <p>
                Measures need judgment. They cannot express every kind of
                quality, and legitimate growth can require a decision about the
                right limit. Used well, they let improvements accumulate while
                the software keeps changing.
              </p>
              <ol className="landing-sequence-labels landing-sequence-labels--compact">
                <li>Measure on the shared branch</li>
                <li>Pin a demonstrated gain</li>
                <li>Hold later work to the new limit</li>
              </ol>
              <p className="landing-caption">
                A discern Standard may tighten. A branch cannot weaken its
                limit.
              </p>
              <Button href="/docs/quality-gate/standards" variant="secondary">
                See how Standards work
              </Button>
            </div>
            <div
              className="landing-artefact landing-artefact--standard"
              data-site-prose-exclude
            >
              <StandardTrajectory />
            </div>
          </div>
        </LandingSection>

        <LandingSection
          id="practice"
          heading="The practice stays with the work."
          className="landing-section--practice"
        >
          <div className="landing-reasons">
            <article>
              <h3>The project starts each agent ahead.</h3>
              <p>
                Shared guidance is written once for configured coding-agent
                providers. Reusable agent playbooks, called Skills, carry
                methods into future sessions. The maintained project guide, the
                Map, stays legible to people and agents, and discern checks its
                structural integrity with the rest of the work.
              </p>
            </article>
            <article>
              <h3>A prepared place for every task.</h3>
              <p>
                Each discern task gets a separate Git worktree and branch, with
                the identity, environment values, and resources the project
                declares. Parallel agents cannot overwrite one another's working
                tree. They can still change the same source files on separate
                branches, so discern surfaces overlap for integration.
              </p>
            </article>
            <article>
              <h3>Evidence belongs to the completed change.</h3>
              <p>
                At completion, the project runs its declared final quality
                check, the Gate. A Proof identifies the exact clean committed
                change that passed and held every applicable Standard. A new
                commit makes that evidence stale. Passing leaves the change
                ready for the person responsible for the project to decide.
              </p>
            </article>
          </div>
          <div className="landing-section__action">
            <Button href="/docs" variant="secondary">
              Explore the engineering practice
            </Button>
          </div>
          <div
            className="landing-artefact landing-artefact--proof"
            data-site-prose-exclude
          >
            <ProofSpecimen />
          </div>
        </LandingSection>

        <LandingSection
          id="audiences"
          heading="The practice starts from the experience you bring."
          className="landing-section--audiences"
        >
          <div className="landing-audiences">
            <article>
              <h3>For experienced engineers</h3>
              <p>
                Turn accumulated judgment into guidance, methods, checks, and
                standards that reach more of the implementation. Review can stay
                skeptical while attention moves toward architecture, exceptions,
                and the working result. The right review depth still depends on
                the project's risk, the change, and the checks you trust.
              </p>
              <Button href="/docs" variant="ghost">
                Explore the engineering practice
              </Button>
            </article>
            <article>
              <h3>For people building through agents</h3>
              <p>
                You have already made something worth continuing. Begin with the
                consequences you understand: the users, data, reputation, or
                livelihood connected to the software. Your agent can study the
                repository, propose a working practice, and ask for the choices
                only you can make.
              </p>
              <CopyPrompt id="audience-copy-prompt" />
            </article>
          </div>
          <p className="landing-audiences__bridge">
            Experience remains valuable. discern gives it somewhere durable to
            work and offers new builders a serious starting point.
          </p>
        </LandingSection>

        <LandingSection
          id="agents"
          heading="Change agents without starting the project over."
          className="landing-section--agents"
        >
          <div className="landing-prose landing-prose--wide">
            <p>
              Configure any of discern's supported providers: Claude Code,
              Codex, Gemini, Cursor, or GitHub Copilot. Each receives project
              guidance compiled from the same authored source. When preference,
              task fit, availability, or a quota changes, you can move to
              another configured provider while the project keeps its guidance
              and working practice.
            </p>
            <p>
              Provider capabilities still differ. Changing providers does not
              transfer hidden conversational state or proprietary features. The
              continuity comes from the practice the project retains.
            </p>
          </div>
          <LogoCloud
            className="landing-integrations"
            aria-label={`${PROVIDER_LOGOS.length} supported coding agent providers`}
            items={PROVIDER_LOGOS}
          />
          <div className="landing-machine">
            <div>
              <h3>Built around the machine doing the work.</h3>
              <p>
                discern treats the coding agent as its principal day-to-day
                operator. Its typed tools return bounded results that state what
                is true and what the agent can do next. Refusals explain the
                route forward. People and agents can read the same underlying
                result, leaving less to translate and more context for the work.
              </p>
            </div>
            <div className="landing-machine__actions">
              <Button href="/docs/agent-integrations" variant="secondary">
                Compare the agent experience
              </Button>
              <Button href="/llms.txt" variant="ghost">
                Read the machine guide
              </Button>
            </div>
          </div>
        </LandingSection>

        <LandingSection
          id="trust"
          heading="Confidence comes with clear boundaries."
          className="landing-section--trust"
        >
          <div className="landing-trust-grid">
            <article>
              <h3>Know what the evidence covers.</h3>
              <p>
                discern is a local, self-contained binary. It contains no AI
                model and needs no API key. Its local activity record, the
                Logbook, and its advisory analysis stay on the machine, contain
                metadata, and exclude code and command output. Coding agents and
                project commands may still use networks, models, or paid
                services.
              </p>
              <p>
                A Proof covers one clean committed change against the Gate and
                Standards the project declares. It does not establish security,
                universal correctness, or production suitability. Passing the
                Gate grants no authority to land. The person responsible decides
                what becomes shared, unless they have recorded a narrower
                permission in advance.
              </p>
              <p>
                discern does not sandbox the coding agent or provide a security
                boundary. Use it inside the security boundary appropriate to
                your project.
              </p>
              <p>
                The source is available under <a href={LICENSE}>FSL-1.1-ALv2</a>
                {" "}
                and free to use for permitted purposes. Each version receives an
                Apache-2.0 future license on its second anniversary.
              </p>
              <Button
                href="/docs/orientation/trust-and-data"
                variant="secondary"
              >
                Review the trust boundaries
              </Button>
            </article>
            <article>
              <h3>Developed under its own practice.</h3>
              <p>
                Coding agents became capable enough to multiply a founder's
                output and expose the limits of human-speed review. discern's
                creator, a software engineer and former CTO, moved more of his
                judgment from personal review into the project. That practice
                became discern.
              </p>
              <p>
                discern is developed under its own Gate, worktrees, Standards,
                Map, and Logbook. The <a href={GITHUB}>public source</a> and
                {" "}
                <a href="/docs/decisions">decision records</a>{" "}
                show that practice at work. This is internal product evidence.
                Independent external validation remains separate.
              </p>
            </article>
          </div>
        </LandingSection>

        <LandingSection
          id="begin"
          heading="Build further."
          className="landing-section--closing"
        >
          <div className="landing-closing">
            <div>
              <p>
                Give your coding agent the next instruction. The prompt asks it
                to fetch the machine guide and follow the setup process for this
                project.
              </p>
              <CopyPrompt id="closing-copy-prompt" />
            </div>
            <div className="landing-install">
              <p>
                Prefer to begin in the terminal? Install the local binary, then
                ask your agent to commission the project.
              </p>
              <p className="landing-install__label">Install discern</p>
              <pre><code>{INSTALL_COMMAND}</code></pre>
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
      "grain.css",
      "specimens.css",
      "landing.css",
    ],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingPage />),
  });
}
