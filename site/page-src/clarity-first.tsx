/** The clarity-first campaign composition currently selected for the homepage. */

import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Kicker,
  LogoCloud,
  Window,
} from "discern-design-system/react";
import {
  PROVIDER_TRADEMARK_NOTICE,
  providerBrandSilhouette,
  PROVIDERS,
} from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import {
  DISCERN_MARK,
  DISCERN_MARK_FILLED_PATH,
  DISCERN_MARK_OUTLINE_PATH,
} from "../brand.ts";
import {
  CampaignFooter,
  CampaignHeader,
  CampaignShell,
  CampaignThemeToggle,
  CopyPrompt,
  DiscernName,
} from "./campaign.tsx";
import {
  DISCERN_REPOSITORY_URL,
  repositoryBlobUrl,
} from "../../src/shared/brand.ts";

const GITHUB = DISCERN_REPOSITORY_URL;
const LICENSE = repositoryBlobUrl("LICENSE");

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

/** Sticky navigation for the homepage. */
function Masthead() {
  return (
    <CampaignHeader
      className="landing-masthead"
      navLabel="Site"
      navItems={[
        { label: "How it works", href: "#workflow" },
        { label: "What you get", href: "#outcomes" },
        { label: "Proof", href: "#proof" },
        { label: "Trust", href: "/trust" },
        { label: "Documentation", href: "/docs" },
      ]}
      actions={
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
          <CampaignThemeToggle className="landing-masthead__theme" />
        </>
      }
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
      "The task gets its own branch, working copy, instruction source, and resources.",
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
            <ul className="v3-work-instructions">
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
            workflow—not a promise that the model will try harder.
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
                Instructions, reusable procedures, decisions, documentation, and
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
          <a href="/docs/understand/worktrees-and-trunk">
            See parallel work in practice <span>↗</span>
          </a>
          <a href="/docs/understand/proof">
            Read the Proof model <span>↗</span>
          </a>
          <a href="/docs/understand/instructions-skills-and-map">
            See how project instructions work <span>↗</span>
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
      title: "Project-owned instructions",
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
              href="/docs/understand/local-control"
              variant="secondary"
              className="v3-proof__trust-link"
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
      "Yes. The project’s instructions, procedures, checks, quality limits, and other authored material remain project-owned while supported provider integrations can change.",
  },
  {
    question: "What happens if I uninstall discern?",
    answer:
      "The uninstall process removes discern’s integration wiring while keeping the project’s authored instructions, documentation, procedures, scripts, and configuration.",
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
              linkHref="/docs/start/first-success"
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

interface LandingShellProps {
  readonly children?: ReactNode;
}

/** Apply the current campaign's destinations to the route-neutral shell. */
function LandingShell({ children }: LandingShellProps) {
  return (
    <CampaignShell
      header={<Masthead />}
      footer={
        <CampaignFooter
          description="A Software Engineering Tool for Coding Agents."
          groups={[
            {
              title: "Documentation",
              links: [
                { label: "Quickstart", href: "/docs/start/first-success" },
                { label: "The practice", href: "/docs" },
                { label: "Trust", href: "/trust" },
                {
                  label: "Trust & your data",
                  href: "/docs/understand/local-control",
                },
                {
                  label: "Agent integrations",
                  href: "/docs/guides/connect-a-coding-agent",
                },
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
              <a href={GITHUB}>Source code</a>
              {" · "}
              <a href={LICENSE}>FSL-1.1-ALv2</a>
              {" · "}
              <a href="/llms.txt">llms.txt</a>
              <br />
              {PROVIDER_TRADEMARK_NOTICE}
            </>
          }
          meta="© 2026 Jack Webb-Heller"
        />
      }
    >
      {children}
    </CampaignShell>
  );
}

/** The first coherent slice of the clarity-first homepage. */
export function ClarityFirst() {
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
