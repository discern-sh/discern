/** Reusable illustrative discern Desk state for public page compositions. */

import { Badge, Window } from "discern-design-system/react";

const PROJECT_STAGES = [
  ["brief", "Brief"],
  ["work", "Work"],
  ["proof", "Evidence"],
  ["decision", "Decision"],
] as const;

/** One ambition moving from its human brief to a decision-ready return. */
export function ProjectInMotion() {
  return (
    <div
      className="landing-project-preview"
      data-project-preview
      data-preview-stage="decision"
      aria-labelledby="project-preview-title"
      data-site-prose-exclude
    >
      <header className="landing-project-preview__caption">
        <span>Illustrative project state</span>
        <strong id="project-preview-title">
          One ambition, returned ready for a decision
        </strong>
      </header>
      <Window
        className="landing-project-preview__window"
        title={
          <code className="landing-project-preview__title">
            discern desk · booking-platform
          </code>
        }
        actions={
          <Badge className="landing-project-preview__badge" tone="success" dot>
            practice active
          </Badge>
        }
        variant="showcase"
      >
        <div
          className="landing-project-preview__controls"
          hidden
          data-preview-controls
        >
          <span>Follow the work</span>
          <div role="group" aria-label="Illustrative project stages">
            {PROJECT_STAGES.map(([stage, label]) => (
              <button
                type="button"
                data-preview-control={stage}
                aria-pressed={stage === "decision" ? "true" : "false"}
                key={stage}
              >
                {label}
              </button>
            ))}
          </div>
          <p
            className="landing-sr-status"
            role="status"
            aria-live="polite"
            data-preview-status
          >
          </p>
        </div>
        <div className="landing-project-preview__body">
          <article className="landing-preview-brief" data-preview-item="brief">
            <span className="landing-artifact-label">Human intention</span>
            <blockquote>
              Let customers reschedule a booking without calling us.
            </blockquote>
            <dl>
              <div>
                <dt>Preserve</dt>
                <dd>The original confirmation trail</dd>
              </div>
              <div>
                <dt>Decide</dt>
                <dd>Who may override the 24-hour window</dd>
              </div>
            </dl>
          </article>

          <section
            className="landing-preview-work"
            data-preview-item="work"
            aria-label="Work in motion"
          >
            <header>
              <span className="landing-artifact-label">Prepared work</span>
              <span>3 efforts</span>
            </header>
            <ol>
              <li>
                <span className="landing-state landing-state--moving" />
                <div>
                  <code>agent/booking-rules</code>
                  <strong>Booking rules</strong>
                </div>
                <Badge className="landing-preview-work__badge" tone="success">
                  Gate passed
                </Badge>
              </li>
              <li>
                <span className="landing-state landing-state--moving" />
                <div>
                  <code>agent/customer-flow</code>
                  <strong>Customer flow</strong>
                </div>
                <Badge className="landing-preview-work__badge" tone="accent">
                  Reviewing
                </Badge>
              </li>
              <li>
                <span className="landing-state landing-state--waiting" />
                <div>
                  <code>agent/notifications</code>
                  <strong>Notifications</strong>
                </div>
                <Badge className="landing-preview-work__badge" tone="neutral">
                  Waiting on rules
                </Badge>
              </li>
            </ol>
          </section>

          <article className="landing-preview-proof" data-preview-item="proof">
            <header>
              <span className="landing-artifact-label">Project conditions</span>
              <Badge tone="success" dot>passed</Badge>
            </header>
            <ul>
              <li>
                <span>format</span>
                <strong>passed</strong>
              </li>
              <li>
                <span>types</span>
                <strong>passed</strong>
              </li>
              <li>
                <span>tests</span>
                <strong>passed</strong>
              </li>
              <li>
                <span>Standards</span>
                <strong>held</strong>
              </li>
            </ul>
            <code className="landing-preview-proof__line">
              Proof · 41d9a8f · clean committed tree
            </code>
          </article>

          <article
            className="landing-preview-decision"
            data-preview-item="decision"
          >
            <span className="landing-artifact-label">
              Ready for your decision
            </span>
            <h2>Customer rescheduling</h2>
            <p>Preview available · Proof valid · 14 files changed</p>
            <div
              className="landing-preview-decision__actions"
              aria-label="Available decisions"
            >
              <span>Inspect</span>
              <span>Revise</span>
              <strong>Accept</strong>
            </div>
            <small>
              Passing prepares the change. Your authority decides what lands.
            </small>
          </article>
        </div>
      </Window>
    </div>
  );
}
