/** Development-only homepage artefact specimens, rendered to static HTML. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Brand,
  DataFigure,
  SkipLink,
} from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;

interface SpecimenSectionProps {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly introduction: ReactNode;
  readonly render: () => ReactNode;
}

interface SerialWave {
  readonly key: string;
  readonly title: string;
  readonly worktree: string;
  readonly dependency: string;
}

const SERIAL_WAVES: readonly SerialWave[] = [
  {
    key: "2A",
    title: "Render a responsive decision-first board",
    worktree: "desk-2a",
    dependency: "wave 1 landed",
  },
  {
    key: "3A",
    title: "Make every action contextual, reviewable, and safe",
    worktree: "desk-3a",
    dependency: "wave 2 landed",
  },
  {
    key: "4A",
    title: "Complete task ingress and human-readable identity",
    worktree: "desk-4a",
    dependency: "wave 3 landed",
  },
  {
    key: "5A",
    title: "Make degraded and finished work recoverable",
    worktree: "desk-5a",
    dependency: "wave 4 landed",
  },
  {
    key: "6A",
    title: "Make the desk fully keyboard and accessibility operable",
    worktree: "desk-6a",
    dependency: "wave 5 landed",
  },
  {
    key: "7A",
    title: "Keep the desk responsive through refresh and failure",
    worktree: "desk-7a",
    dependency: "wave 6 landed",
  },
  {
    key: "8A",
    title:
      "Close the product loop with docs, evidence, and acceptance journeys",
    worktree: "desk-8a",
    dependency: "wave 7 landed",
  },
  {
    key: "9A",
    title: "Decide and, if earned, ship the persistent desk",
    worktree: "desk-9a",
    dependency: "wave 8 landed",
  },
];

/** The product name uses the visual system's one permitted brand-name mono treatment. */
function DiscernName() {
  return <span className="specimen-brand-name">discern</span>;
}

/** Frame one artefact twice under deterministic token roots. */
function SpecimenSection(
  { id, index, title, introduction, render }: SpecimenSectionProps,
) {
  const headingId = `${id}-title`;
  return (
    <section className="specimen-section" id={id} aria-labelledby={headingId}>
      <header className="specimen-section__introduction">
        <span className="specimen-section__index">{index}</span>
        <div>
          <h2 id={headingId}>{title}</h2>
          <p>{introduction}</p>
        </div>
      </header>
      <div className="specimen-theme-pair">
        {PREVIEW_THEMES.map((theme) => (
          <article
            className="specimen-theme"
            data-discern-root
            data-discern-theme={theme}
            aria-label={`${title}, ${theme} theme`}
            key={theme}
          >
            <div className="specimen-theme__label" aria-hidden="true">
              <span>{theme}</span>
              <i />
            </div>
            {render()}
          </article>
        ))}
      </div>
    </section>
  );
}

/** One of the two disjoint tasks that open the real Desk UX programme. */
function ParallelTask(
  { task, title, worktree, landing }: {
    readonly task: string;
    readonly title: string;
    readonly worktree: string;
    readonly landing: string;
  },
) {
  return (
    <article className="wave-task">
      <div className="wave-task__heading">
        <strong>{task}</strong>
        <Badge tone="accent">parallel</Badge>
      </div>
      <h4>{title}</h4>
      <dl>
        <div>
          <dt>Worktree</dt>
          <dd>
            <code>{worktree}</code>
          </dd>
        </div>
        <div>
          <dt>Depends on</dt>
          <dd>nothing</dd>
        </div>
        <div>
          <dt>Landing</dt>
          <dd>{landing}</dd>
        </div>
      </dl>
    </article>
  );
}

/** Faithful, designed reproduction of the Desk UX wave and landing plan. */
function DelegationWavePlan() {
  return (
    <DataFigure
      className="delegation-figure"
      eyebrow="Delegation wave plan · 3 Aug 2026"
      title="Desk UX programme · ten worktrees, one landing sequence"
      legend={[
        { label: "parallel opening", tone: "accent" },
        { label: "serial dependency", tone: "ink" },
        { label: "conditional checkpoint", tone: "warning" },
      ]}
      visual={
        <div className="wave-plan">
          <div className="wave-opening">
            <header className="wave-label">
              <span>Wave 1</span>
              <strong>Two disjoint surfaces move together</strong>
            </header>
            <div className="wave-opening__tasks">
              <ParallelTask
                task="1A"
                title="Make task state answer the human decision"
                worktree="desk-1a"
                landing="first"
              />
              <ParallelTask
                task="1B"
                title="Give the real desk a pseudo-TTY contract"
                worktree="desk-1b"
                landing="after update"
              />
            </div>
          </div>

          <div className="wave-handoff" aria-label="Staged landing handoff">
            <span>1A lands</span>
            <i aria-hidden="true">→</i>
            <span>
              <code>desk-1b</code> updates
            </span>
            <i aria-hidden="true">→</i>
            <span>1B lands</span>
          </div>

          <ol className="wave-spine" start={2}>
            {SERIAL_WAVES.map((wave, index) => (
              <li
                className={wave.key === "9A"
                  ? "wave-spine__item wave-spine__item--checkpoint"
                  : "wave-spine__item"}
                key={wave.key}
              >
                <span className="wave-spine__number" aria-hidden="true">
                  {String(index + 2).padStart(2, "0")}
                </span>
                <div className="wave-spine__copy">
                  <div>
                    <strong>{wave.key}</strong>
                    {wave.key === "9A"
                      ? <Badge tone="warning">conditional</Badge>
                      : <Badge tone="neutral">serial</Badge>}
                  </div>
                  <h4>{wave.title}</h4>
                </div>
                <dl>
                  <div>
                    <dt>Worktree</dt>
                    <dd>
                      <code>{wave.worktree}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Guard</dt>
                    <dd>{wave.dependency}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>

          <ol className="specimen-annotations" aria-label="Plan annotations">
            <li>
              <span>01</span>
              <p>
                <strong>Leverage.</strong>{" "}
                Only the disjoint model and real-terminal harness overlap.
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>Composition.</strong>{" "}
                The second landing updates so both prerequisites sit beneath
                wave 2.
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                <strong>Control.</strong>{" "}
                Waves 2–9 stay serial where they meet the same presentation
                boundary.
              </p>
            </li>
          </ol>
        </div>
      }
      caption="One parallel opening creates the two surfaces every later wave consumes. Staged landings turn concurrent work into a clean serial foundation."
      source="Desk UX programme plan, 3 August 2026. Faithful internal reproduction; no private planning link is published."
      surface="sunken"
    />
  );
}

/** Static development page that lets the owner judge every artefact in both themes. */
function SpecimenPreview() {
  return (
    <>
      <SkipLink href="#specimens">Skip to specimens</SkipLink>
      <header className="specimen-masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="specimen-masthead__meta">
          <Badge tone="neutral">Development only</Badge>
          <span>Homepage artefacts · 2B</span>
        </div>
      </header>
      <main id="specimens">
        <header className="specimen-introduction">
          <p className="specimen-introduction__eyebrow">
            Editorial engineering · prototype sheet
          </p>
          <h1>Artefacts that explain the mechanism.</h1>
          <p>
            Each specimen is a truthful product object, annotated for a reader
            encountering <DiscernName />{" "}
            for the first time. Light and dark are fixed beside one another for
            direct review.
          </p>
          <nav aria-label="Specimens on this page">
            <a href="#delegation">01 · Delegation</a>
          </nav>
        </header>

        <SpecimenSection
          id="delegation"
          index="01 / 04"
          title="The delegation wave plan"
          introduction={
            <>
              The real Desk UX programme, reproduced as an executable-looking
              editorial plan: waves, worktrees, dependencies, and staged
              landings.
            </>
          }
          render={() => <DelegationWavePlan />}
        />
      </main>
      <footer className="specimen-footer">
        <span>
          <DiscernName /> · homepage artefact prototypes
        </span>
        <span>Static HTML and CSS · outside the public route registry</span>
      </footer>
    </>
  );
}

/** Render the development-only specimen sheet with the shared document shell. */
export function renderSpecimens(): string {
  return pageDocument({
    source: "specimens.tsx",
    title: "Homepage artefact specimens · discern",
    description: "Development-only dual-theme homepage artefact prototypes.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "specimens.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<SpecimenPreview />),
  });
}
