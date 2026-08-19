/** The authored homepage, rendered to static HTML by site/build.ts. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Button,
  HeroBlock,
  Kicker,
  LogoCloud,
  SiteFooter,
  SiteHeader,
  SkipLink,
  Terminal,
  Window,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import {
  DISCERN_MARK,
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  OLD_LANDING_TITLE,
} from "../brand.ts";
import { pageDocument } from "./document.ts";
import { ProjectInMotion } from "./project-in-motion.tsx";
import { CompactStandardTrajectory } from "./specimens.tsx";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";

/** The commissioning instruction shared by every copy control on the page. */
export const COPY_PROMPT_TEXT =
  "Read https://discern.sh/llms.txt and set up discern in this project. Follow the setup process exactly, study the repository before changing it, and bring me every decision or consent point that requires my input.";
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
      className="discern-theme-toggle discern-theme-toggle--outlined landing-masthead__theme"
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
  {
    id,
    label,
    buttonLabel = "Copy prompt",
    copiedLabel = "Prompt copied",
    linkLabel = "Read the machine guide",
    linkHref = "/llms.txt",
  }: {
    readonly id: string;
    readonly label: string;
    readonly buttonLabel?: string;
    readonly copiedLabel?: string;
    readonly linkLabel?: string;
    readonly linkHref?: string;
  },
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
          data-copy-label={buttonLabel}
          data-copied-label={copiedLabel}
          hidden
        >
          <span className="discern-button__label">{buttonLabel}</span>
        </button>
        <a className="landing-copy-prompt__link" href={linkHref}>
          {linkLabel}
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
        : [
          { label: "How it works", href: "#workflow" },
          { label: "What you get", href: "#outcomes" },
          { label: "Proof", href: "#proof" },
          { label: "Documentation", href: "/docs" },
        ]}
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
        : (
          <>
            <a className="v3-masthead__text-action" href="#workflow">
              See how it works
            </a>
            <Button
              className="v3-masthead__setup"
              href="#setup"
              variant="primary"
            >
              <span className="v3-masthead__setup-long">
                Tell your agent to set it up
              </span>
              <span className="v3-masthead__setup-short">Set it up</span>
            </Button>
            <LandingThemeToggle />
          </>
        )}
      sticky
      variant="campaign"
    />
  );
}

const HERO_TASK_STAGES = [
  {
    state: "request",
    label: "Request",
    detail: "Allow customers to reschedule a booking online.",
  },
  {
    state: "working",
    label: "Working",
    detail: "Separate working copy · project instructions loaded",
  },
  {
    state: "checked",
    label: "Checked",
    detail: "Build, lint, types, tests, smoke and project rules passed",
  },
  {
    state: "decision",
    label: "Your decision",
    detail: "Inspect the result · accept · request changes",
  },
] as const;

/** One ordinary task moving through discern's complete authority boundary. */
function V3HeroTask() {
  return (
    <Window
      className="v3-task-window"
      title={<code>discern · customer-rescheduling</code>}
      actions={<Badge tone="success" dot>ready</Badge>}
      variant="showcase"
    >
      <div className="v3-task-flow">
        <header className="v3-task-flow__header">
          <span>One task</span>
          <strong>Four clear states</strong>
        </header>
        <ol>
          {HERO_TASK_STAGES.map((stage, index) => (
            <li
              className={`v3-task-flow__stage v3-task-flow__stage--${stage.state}`}
              key={stage.state}
            >
              <span className="v3-task-flow__number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{stage.label}</strong>
                <p>{stage.detail}</p>
              </div>
              <span className="v3-task-flow__signal" aria-hidden="true" />
            </li>
          ))}
        </ol>
        <footer>
          <span aria-hidden="true">{DISCERN_MARK}</span>
          Evidence follows the exact change. Approval stays with you.
        </footer>
      </div>
    </Window>
  );
}

/** Clarity-first opening for the redesigned homepage. */
function V3Hero() {
  return (
    <section className="v3-hero" aria-labelledby="v3-hero-title">
      <div className="v3-shell v3-hero__inner">
        <div className="v3-hero__copy">
          <Kicker className="v3-eyebrow">
            A Software Engineering Tool for Coding Agents
          </Kicker>
          <h1 id="v3-hero-title">
            Let coding agents handle <em>more of the work.</em>
            <span>Keep control of what ships.</span>
          </h1>
          <p className="v3-hero__lead">
            <DiscernName />{" "}
            installs a consistent engineering workflow into your software
            project. Coding agents use it to take on substantial tasks in
            separate working copies, follow shared project instructions, run
            required checks, and return changes with evidence tied to the exact
            commit.
          </p>
          <p className="v3-hero__shift">
            You coordinate less and keep the final decision over what ships.
          </p>
          <div className="v3-hero__actions">
            <Button href="#workflow" variant="primary">
              See how discern works
            </Button>
            <Button href="#setup" variant="secondary">
              Tell your coding agent to set it up
            </Button>
          </div>
          <ul className="v3-hero__trust" aria-label="Product foundations">
            <li>One local binary</li>
            <li>No model or API key of its own</li>
            <li>MCP and CLI</li>
          </ul>
          <p className="v3-hero__audience">
            For anyone responsible for software other people will rely on.
          </p>
        </div>
        <div className="v3-hero__visual">
          <span className="v3-hero__orbit" aria-hidden="true">
            <MarkGlyph />
          </span>
          <V3HeroTask />
        </div>
      </div>
    </section>
  );
}

/** The coordination work that remains after an agent can already write code. */
function V3ProblemSection() {
  const problems = [
    {
      number: "01",
      title: "You keep repeating the project",
      copy:
        "New sessions need the same project rules and decisions, often scattered across prompts and transcripts.",
    },
    {
      number: "02",
      title: "Parallel tasks need manual coordination",
      copy:
        "Separate branches, checkouts, local resources, and status updates become another system for you to operate.",
    },
    {
      number: "03",
      title: "‘Done’ still needs investigation",
      copy:
        "You still have to ask what ran, which version passed, and whether the evidence still applies after the latest edit.",
    },
  ] as const;

  return (
    <section
      className="v3-section v3-problem"
      id="problem"
      aria-labelledby="v3-problem-title"
    >
      <div className="v3-shell">
        <header className="v3-section-lead v3-section-lead--split">
          <div>
            <Kicker className="v3-eyebrow">The work around the code</Kicker>
            <h2 id="v3-problem-title">
              Coding agents can implement quickly. You still end up running the
              workflow.
            </h2>
          </div>
          <div className="v3-section-lead__copy">
            <p>
              Coding agents can implement features quickly. But somebody still
              has to divide the work, repeat context, separate parallel changes,
              run the right checks, and decide whether the result is ready.
            </p>
            <p>
              As more tasks move at once, that can become a second job for the
              person building the product.
            </p>
          </div>
        </header>

        <ol className="v3-problem__list">
          {problems.map((problem) => (
            <li key={problem.number}>
              <span>{problem.number}</span>
              <h3>{problem.title}</h3>
              <p>{problem.copy}</p>
            </li>
          ))}
        </ol>

        <div className="v3-problem__resolution">
          <span className="v3-problem__mark" aria-hidden="true">
            {DISCERN_MARK}
          </span>
          <p>
            <DiscernName />{" "}
            turns those repeated responsibilities into one project-specific
            workflow that coding agents operate themselves.
          </p>
          <a href="#workflow">See one ordinary product change ↓</a>
        </div>
      </div>
    </section>
  );
}

const V3_WORKFLOW_STAGES = [
  {
    state: "brief",
    number: "01",
    title: "Give the agent a complete task",
    copy: "Start with the outcome. Shape the constraints before work begins.",
  },
  {
    state: "work",
    number: "02",
    title: "Start in a separate checkout",
    copy:
      "The task gets its own branch, working copy, guidance, and resources.",
  },
  {
    state: "proof",
    number: "03",
    title: "Run the project’s own checks",
    copy:
      "Failures return focused evidence and the command that reproduces them.",
  },
  {
    state: "decision",
    number: "04",
    title: "Return the exact change",
    copy: "A clean commit comes back with check results for your decision.",
  },
] as const;

/** Product evidence for one booking change, enhanced into a stage selector. */
function V3WorkflowSurface() {
  return (
    <div
      className="v3-workflow-preview"
      data-project-preview
      data-preview-stage="brief"
    >
      <div
        className="v3-workflow-preview__controls"
        data-preview-controls
        hidden
      >
        <span className="v3-workflow-preview__controls-label">
          Follow the task
        </span>
        <div role="group" aria-label="Task stages">
          {V3_WORKFLOW_STAGES.map((stage) => (
            <button
              type="button"
              data-preview-control={stage.state}
              aria-pressed={stage.state === "brief" ? "true" : "false"}
              key={stage.state}
            >
              <span>{stage.number}</span>
              <strong>{stage.title}</strong>
              <small>{stage.copy}</small>
            </button>
          ))}
        </div>
        <p
          className="landing-sr-status"
          role="status"
          aria-live="polite"
          data-preview-status
        />
      </div>

      <Window
        className="v3-workflow-preview__window"
        title={<code>discern · booking-platform</code>}
        actions={<Badge tone="accent" dot>task in focus</Badge>}
        variant="showcase"
      >
        <div className="v3-workflow-preview__panels">
          <article className="v3-stage-panel" data-preview-item="brief">
            <header>
              <div>
                <span className="v3-artifact-label">Complete task</span>
                <h3>Customer rescheduling</h3>
              </div>
              <Badge tone="success" dot>ready to start</Badge>
            </header>
            <blockquote>
              “Allow customers to reschedule a booking online.”
            </blockquote>
            <div className="v3-brief-grid">
              <div>
                <span>Outcome</span>
                <strong>Self-serve a new date and time</strong>
              </div>
              <div>
                <span>Preserve</span>
                <strong>Original confirmation trail</strong>
              </div>
              <div>
                <span>Owner decision</span>
                <strong>Who may override the 24-hour window?</strong>
              </div>
              <div>
                <span>Done when</span>
                <strong>Flow, notifications, and checks agree</strong>
              </div>
            </div>
          </article>

          <article className="v3-stage-panel" data-preview-item="work">
            <header>
              <div>
                <span className="v3-artifact-label">Isolated work</span>
                <h3>A prepared place to implement</h3>
              </div>
              <Badge tone="accent" dot>working</Badge>
            </header>
            <dl className="v3-work-identity">
              <div>
                <dt>worktree</dt>
                <dd>
                  <code>booking-reschedule-7c31</code>
                </dd>
              </div>
              <div>
                <dt>branch</dt>
                <dd>
                  <code>agent/booking-reschedule-7c31</code>
                </dd>
              </div>
              <div>
                <dt>preview</dt>
                <dd>
                  <code>localhost:17431</code>
                </dd>
              </div>
            </dl>
            <ul className="v3-work-guidance">
              <li>
                <span>✓</span> Project instructions loaded
              </li>
              <li>
                <span>✓</span> Booking-domain procedure selected
              </li>
              <li>
                <span>✓</span> Shared checkout left untouched
              </li>
            </ul>
          </article>

          <article className="v3-stage-panel" data-preview-item="proof">
            <header>
              <div>
                <span className="v3-artifact-label">Useful failure</span>
                <h3>The check points back to the fix</h3>
              </div>
              <Badge tone="warning" dot>recovered</Badge>
            </header>
            <div className="v3-diagnostic">
              <div className="v3-diagnostic__failure">
                <span>test · failed</span>
                <strong>Reschedule policy rejects an expired window</strong>
                <code>
                  deno task test tests/booking_test.ts --filter &quot;expired
                  window&quot;
                </code>
              </div>
              <span className="v3-diagnostic__arrow" aria-hidden="true">→</span>
              <div className="v3-diagnostic__recovery">
                <span>re-run · passed</span>
                <strong>Policy and customer flow now agree</strong>
                <small>1 focused check · 0 failures</small>
              </div>
            </div>
          </article>

          <article className="v3-stage-panel" data-preview-item="decision">
            <header>
              <div>
                <span className="v3-artifact-label">
                  Ready for your decision
                </span>
                <h3>Customer rescheduling</h3>
              </div>
              <Badge tone="success" dot>Proof valid</Badge>
            </header>
            <div className="v3-decision-summary">
              <dl>
                <div>
                  <dt>commit</dt>
                  <dd>
                    <code>41d9a8f</code>
                  </dd>
                </div>
                <div>
                  <dt>change</dt>
                  <dd>17 files · +486 −72</dd>
                </div>
                <div>
                  <dt>checks</dt>
                  <dd>6 passed · limits held</dd>
                </div>
              </dl>
              <div
                className="v3-decision-actions"
                aria-label="Available decisions"
              >
                <span>Inspect</span>
                <span>Request changes</span>
                <strong>Accept</strong>
              </div>
            </div>
            <p>
              Passing prepares the change for review. It does not grant itself
              permission to land.
            </p>
          </article>
        </div>
      </Window>
    </div>
  );
}

/** One complete path from a human request to a checked change. */
function V3WorkflowSection() {
  return (
    <section
      className="v3-section v3-workflow"
      id="workflow"
      aria-labelledby="v3-workflow-title"
    >
      <div className="v3-shell">
        <header className="v3-section-lead v3-section-lead--center">
          <Kicker className="v3-eyebrow">How discern works</Kicker>
          <h2 id="v3-workflow-title">
            One workflow from request to checked change.
          </h2>
          <p>
            Follow one ordinary product change. The agent handles the workflow,
            the project records the facts, and you make the release decision.
          </p>
        </header>
        <V3WorkflowSurface />
        <div className="v3-section-action">
          <Button href="#proof" variant="secondary">
            Follow the evidence to the exact commit
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Three outcomes, each paired with the mechanism that makes it credible. */
function V3OutcomesSection() {
  return (
    <section
      className="v3-section v3-outcomes"
      id="outcomes"
      aria-labelledby="v3-outcomes-title"
    >
      <div className="v3-shell">
        <header className="v3-section-lead v3-section-lead--split">
          <div>
            <Kicker className="v3-eyebrow">What changes</Kicker>
            <h2 id="v3-outcomes-title">
              More work can move without adding the same amount of coordination
              to your day.
            </h2>
          </div>
          <p className="v3-section-lead__aside">
            Three practical outcomes. Each one comes from a concrete part of the
            workflow—not a promise that the model will simply try harder.
          </p>
        </header>

        <div className="v3-outcomes__list">
          <article className="v3-outcome">
            <div className="v3-outcome__copy">
              <span>01 · Capacity</span>
              <h3>Delegate larger tasks without coordinating every step.</h3>
              <p>
                Give an agent a substantial objective instead of managing every
                action. <DiscernName />{" "}
                creates prepared checkouts, keeps task state available across
                sessions, and lets dependent work wait on reliable repository
                conditions.
              </p>
              <p>
                Several tasks can move without making you open every session or
                relay every update.
              </p>
            </div>
            <div
              className="v3-outcome__visual v3-efforts"
              data-site-prose-exclude
            >
              <header>
                <span>Work in motion</span>
                <strong>3 efforts</strong>
              </header>
              <ol>
                <li>
                  <i className="v3-state v3-state--passed" />
                  <div>
                    <code>booking-rules</code>
                    <strong>Gate passed</strong>
                  </div>
                  <span>ready</span>
                </li>
                <li>
                  <i className="v3-state v3-state--moving" />
                  <div>
                    <code>customer-flow</code>
                    <strong>Implementing</strong>
                  </div>
                  <span>active</span>
                </li>
                <li>
                  <i className="v3-state v3-state--waiting" />
                  <div>
                    <code>notifications</code>
                    <strong>Waiting on rules</strong>
                  </div>
                  <span>held</span>
                </li>
              </ol>
            </div>
          </article>

          <article className="v3-outcome v3-outcome--reverse">
            <div className="v3-outcome__copy">
              <span>02 · Evidence</span>
              <h3>Know which checks passed before you approve a change.</h3>
              <p>
                Completed work returns with the checks that passed and the exact
                commit they covered. Review can focus on behavior, design, risk,
                and whether the change should ship.
              </p>
              <p>Passing checks never grants permission on its own.</p>
            </div>
            <div
              className="v3-outcome__visual v3-proof-stamp"
              data-site-prose-exclude
            >
              <span className="v3-proof-stamp__mark" aria-hidden="true">
                {DISCERN_MARK}
              </span>
              <div>
                <span>Proof</span>
                <strong>valid</strong>
                <code>41d9a8f · clean committed tree</code>
              </div>
              <ul>
                <li>
                  checks <strong>6 passed</strong>
                </li>
                <li>
                  limits <strong>held</strong>
                </li>
                <li>
                  approval <strong>waiting</strong>
                </li>
              </ul>
            </div>
          </article>

          <article className="v3-outcome">
            <div className="v3-outcome__copy">
              <span>03 · Continuity</span>
              <h3>
                Give every agent the same project instructions, methods, and
                quality rules.
              </h3>
              <p>
                Guidance, reusable procedures, decisions, documentation, and
                quality limits live in project-owned files. Fresh sessions and
                supported providers receive the same sources.
              </p>
              <p>
                Useful lessons and measurable improvements remain available when
                the active agent changes.
              </p>
            </div>
            <div
              className="v3-outcome__visual v3-project-files"
              data-site-prose-exclude
            >
              <header>
                <span>project/</span>
                <strong>owned by you</strong>
              </header>
              <ul>
                <li>
                  <span>↳</span>
                  <code>instructions.md</code>
                  <strong>every session</strong>
                </li>
                <li>
                  <span>↳</span>
                  <code>skills/</code>
                  <strong>when relevant</strong>
                </li>
                <li>
                  <span>↳</span>
                  <code>map/</code>
                  <strong>durable context</strong>
                </li>
                <li>
                  <span>↳</span>
                  <code>discern.toml</code>
                  <strong>checks + limits</strong>
                </li>
              </ul>
              <footer>
                Claude Code · Codex · Gemini · Cursor · GitHub Copilot
              </footer>
            </div>
          </article>
        </div>

        <nav className="v3-outcomes__links" aria-label="Explore the workflow">
          <a href="/docs/worktrees">
            See parallel work in practice <span>↗</span>
          </a>
          <a href="/docs/quality-gate/the-proof">
            Read the Proof model <span>↗</span>
          </a>
          <a href="/docs/agent-instructions">
            See how project guidance works <span>↗</span>
          </a>
        </nav>
      </div>
    </section>
  );
}

const V3_PROOF_CHECKS = [
  "format",
  "build",
  "lint",
  "typecheck",
  "test",
  "smoke",
] as const;

/** Exact-commit evidence and the authority boundary around it. */
function V3ProofSection() {
  const trustFacts = [
    {
      title: "Local software",
      copy:
        "One self-contained binary. No hosted discern control plane is required.",
    },
    {
      title: "No model inside discern",
      copy:
        "Your coding agent supplies the intelligence. discern adds no model call or credential of its own.",
    },
    {
      title: "Project-owned guidance",
      copy:
        "Instructions, procedures, scripts, settings, and documentation remain ordinary repository files.",
    },
    {
      title: "Your real tools",
      copy:
        "The final check runs the commands the project declares, not a separate language toolchain.",
    },
    {
      title: "Clean exit",
      copy:
        "Remove the integration while keeping the material your project owns.",
    },
  ] as const;

  return (
    <section
      className="v3-section v3-proof"
      id="proof"
      aria-labelledby="v3-proof-title"
    >
      <div className="v3-shell">
        <header className="v3-section-lead v3-section-lead--split v3-proof__lead">
          <div>
            <Kicker className="v3-eyebrow">
              Proof for the change you are reviewing
            </Kicker>
            <h2 id="v3-proof-title">
              See which checks passed, and which commit they covered.
            </h2>
          </div>
          <div className="v3-section-lead__copy">
            <p>
              The final project check runs against a clean committed tree.{"  "}
              <DiscernName />{" "}
              records the commit, changed files, check results, and quality
              limits independently of the agent’s confidence.
            </p>
            <p>
              If the tree changes, the record no longer applies. <DiscernName />
              {" "}
              calls that exact-commit record <strong>Proof</strong>.
            </p>
          </div>
        </header>

        <div className="v3-proof__grid">
          <Window
            className="v3-proof-card"
            title={<code>discern status · customer-rescheduling</code>}
            actions={<Badge tone="success" dot>valid</Badge>}
            variant="showcase"
            data-site-prose-exclude
          >
            <div className="v3-proof-card__body">
              <header>
                <div>
                  <span>Ready for your decision</span>
                  <h3>Customer rescheduling</h3>
                </div>
                <span className="v3-proof-card__glyph" aria-hidden="true">
                  {DISCERN_MARK}
                </span>
              </header>
              <dl className="v3-proof-card__facts">
                <div>
                  <dt>commit</dt>
                  <dd>
                    <code>41d9a8f</code>
                  </dd>
                </div>
                <div>
                  <dt>size</dt>
                  <dd>17 files changed</dd>
                </div>
              </dl>
              <div className="v3-proof-card__checks">
                <span>project checks</span>
                <ul>
                  {V3_PROOF_CHECKS.map((check) => (
                    <li key={check}>
                      <code>{check}</code>
                      <strong>passed</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <dl className="v3-proof-card__footer">
                <div>
                  <dt>quality limits</dt>
                  <dd>held</dd>
                </div>
                <div>
                  <dt>proof</dt>
                  <dd>valid for this exact commit</dd>
                </div>
                <div>
                  <dt>approval</dt>
                  <dd>waiting for you</dd>
                </div>
              </dl>
            </div>
          </Window>

          <div className="v3-proof__boundary">
            <article>
              <span
                className="v3-boundary-icon v3-boundary-icon--yes"
                aria-hidden="true"
              >
                ✓
              </span>
              <div>
                <h3>What Proof establishes</h3>
                <p>
                  The project’s declared checks and quality conditions passed
                  for the exact committed change shown.
                </p>
              </div>
            </article>
            <article>
              <span className="v3-boundary-icon" aria-hidden="true">—</span>
              <div>
                <h3>What Proof does not establish</h3>
                <p>
                  It is not a universal guarantee of correctness, security,
                  design quality, or business fit. Those still require the
                  testing, review, and judgment appropriate to the change.
                </p>
              </div>
            </article>
            <article className="v3-proof__decision-note">
              <span
                className="v3-boundary-icon v3-boundary-icon--accent"
                aria-hidden="true"
              >
                {DISCERN_MARK}
              </span>
              <div>
                <h3>The final decision remains explicit</h3>
                <p>
                  A passing result makes the change ready for review; it does
                  not authorize release. Accept it, request revisions, reject
                  it, or grant narrow permission for routine work.
                </p>
              </div>
            </article>
            <Button
              href="/docs/orientation/trust-and-data"
              variant="secondary"
            >
              Review the trust boundaries
            </Button>
          </div>
        </div>

        <div className="v3-trust-strip">
          {trustFacts.map((fact, index) => (
            <article key={fact.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{fact.title}</h3>
              <p>{fact.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

const V3_FAQ = [
  {
    question: "Is discern another coding agent or AI model?",
    answer:
      "No. Your chosen coding agent performs the model-driven work. discern is deterministic local software that gives the agent a structured project workflow through its CLI and MCP tools.",
  },
  {
    question: "Do I need to be an experienced software engineer?",
    answer:
      "No. discern is for the person responsible for what the software becomes. Experienced engineers can give their judgment more reach; newer builders gain a more consistent workflow and clearer evidence for the decisions they still own.",
  },
  {
    question: "Does discern automatically ship a change when checks pass?",
    answer:
      "No. Passing the project’s declared checks makes the exact committed change ready for review. Acceptance still requires your current approval or recorded permission that covers the final changed paths.",
  },
  {
    question: "Does discern replace CI?",
    answer:
      "No. CI remains useful for shared and remote verification. discern provides an earlier local workflow around how agent work begins, proceeds, passes project checks, and becomes eligible for acceptance. The final Gate can also run in CI.",
  },
  {
    question: "Does discern send my code to another hosted service?",
    answer:
      "The discern binary adds no hosted control plane or model call of its own. Its optional local activity record contains metadata rather than code or command output. The coding-agent provider you choose has its own separate data practices.",
  },
  {
    question: "Can I change coding agents later?",
    answer:
      "Yes. The project’s guidance, procedures, checks, quality limits, and other authored material remain project-owned while supported provider integrations can change.",
  },
  {
    question: "What happens if I uninstall discern?",
    answer:
      "The uninstall process removes discern’s integration wiring while keeping the project’s authored guidance, documentation, procedures, scripts, and configuration.",
  },
] as const;

/** Agent-led commissioning, the final action, and collapsed evaluation detail. */
function V3SetupSection() {
  return (
    <section
      className="v3-section v3-setup"
      id="setup"
      aria-labelledby="v3-setup-title"
    >
      <div className="v3-shell">
        <header className="v3-section-lead v3-setup__lead">
          <Kicker className="v3-eyebrow">Setup</Kicker>
          <h2 id="v3-setup-title">
            Let your coding agent set <DiscernName /> up for this project.
          </h2>
          <p>
            Your coding agent studies the repository, identifies its commands
            and agent tools, asks for decisions it cannot infer, and configures
            {" "}
            <DiscernName /> for the project.
          </p>
          <p>
            Setup is not complete until the workflow is validated in a fresh
            isolated checkout.
          </p>
        </header>

        <div className="v3-setup__grid">
          <div className="v3-setup__process">
            <span className="v3-artifact-label">Commissioning</span>
            <p>
              <DiscernName />{" "}
              calls its setup process commissioning. The agent handles
              repository study and routine configuration; you provide the
              decisions and permissions that require the project owner.
            </p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Study the project</strong>
                  <small>
                    Commands, conventions, providers, and existing checks
                  </small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Bring you the decisions</strong>
                  <small>
                    Nothing consequential is inferred on your behalf
                  </small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Validate the whole workflow</strong>
                  <small>A fresh isolated checkout proves setup works</small>
                </div>
              </li>
            </ol>
            <div className="v3-agent-help">
              <p className="v3-agent-help__label">Supported coding agents</p>
              <ProviderStrip compact />
            </div>
          </div>

          <div className="v3-setup__prompt">
            <CopyPrompt
              id="v3-setup-prompt"
              label="Give your coding agent this one instruction."
              buttonLabel="Copy setup prompt"
              copiedLabel="Setup prompt copied"
              linkLabel="Read the complete setup guide"
              linkHref="/docs/getting-started/quickstart"
            />
            <p className="v3-setup__paste-note">
              Paste the prompt into a coding-agent session rooted in the project
              you want to configure.
            </p>
          </div>
        </div>

        <div className="v3-final-close">
          <span className="v3-final-close__mark" aria-hidden="true">
            <MarkGlyph />
          </span>
          <div>
            <h2>
              Give agents more of the work. Review with evidence. Keep control.
            </h2>
            <p>
              <DiscernName />{" "}
              gives coding agents a consistent way to complete substantial
              changes while you remain responsible for what the software
              becomes.
            </p>
            <strong>Build software you are proud to stand behind.</strong>
          </div>
        </div>

        <div className="v3-faq" id="faq">
          <header>
            <Kicker className="v3-eyebrow">Questions, answered directly</Kicker>
            <h2>Before you put it in a project.</h2>
          </header>
          <div className="v3-faq__list">
            {V3_FAQ.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
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
          <p className="landing-hero__category">
            An engineering practice for agent-built software.
          </p>
          {archived ? null : <HeroFacts />}
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
      "Create shared project instructions, working methods, checks, and maintained project knowledge.",
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
            <code>project/instructions.md</code>
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
                <strong>Instructions</strong>
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
          <Button href="/docs/agent-instructions" variant="secondary">
            See how project instructions travel
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
                  project-owned instructions and works through the same discern
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
        description={archived
          ? "An engineering practice for agent-built software."
          : "A Software Engineering Tool for Coding Agents."}
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

/** The first coherent slice of the clarity-first homepage. */
function LandingV3() {
  return (
    <LandingShell>
      <>
        <V3Hero />
        <V3ProblemSection />
        <V3WorkflowSection />
        <V3OutcomesSection />
        <V3ProofSection />
        <V3SetupSection />
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
    styles: ["fonts.css", "discern.css", "landing.css", "landing-v3.css"],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<LandingV3 />),
  });
}

/** Render the preserved full homepage at /old. */
export function renderOldLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: OLD_LANDING_TITLE,
    description: LANDING_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "landing.css"],
    scripts: ["landing.js"],
    body: renderToStaticMarkup(<OldLandingPage />),
  });
}
