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

/** Staged commissioning narrative from repository study to a fresh worktree probe. */
function CommissioningTimeline() {
  return (
    <DataFigure
      className="commissioning-figure"
      eyebrow="Commissioning timeline · staged setup"
      title="From repository study to inherited practice"
      legend={[
        { label: "study and intent", tone: "ink" },
        { label: "authored change", tone: "accent" },
        { label: "structural proof", tone: "success" },
      ]}
      visual={
        <div className="commissioning-plan">
          <div className="commissioning-branch">
            <div>
              <span>Working boundary</span>
              <strong>Isolated setup branch</strong>
            </div>
            <Badge tone="neutral">reviewable</Badge>
            <Badge tone="neutral">reversible</Badge>
          </div>

          <ol className="commissioning-stages">
            <li>
              <span className="commissioning-stages__marker">01</span>
              <div className="commissioning-stages__body">
                <header>
                  <div>
                    <span>Study</span>
                    <h4>Read the repository before prescribing a practice</h4>
                  </div>
                  <Badge tone="neutral">read-only</Badge>
                </header>
                <p>
                  Stack, existing checks, conventions, risks, and the shape of
                  work already present.
                </p>
                <small>Output · repository study</small>
              </div>
            </li>
            <li>
              <span className="commissioning-stages__marker">02</span>
              <div className="commissioning-stages__body">
                <header>
                  <div>
                    <span>Ask</span>
                    <h4>Resolve the intent the code cannot reveal</h4>
                  </div>
                  <Badge tone="neutral">one batch</Badge>
                </header>
                <p>
                  A concise set of human decisions closes the gaps left by
                  repository evidence.
                </p>
                <small>Output · commissioning decisions</small>
              </div>
            </li>
            <li>
              <span className="commissioning-stages__marker">03</span>
              <div className="commissioning-stages__body commissioning-stages__body--authored">
                <header>
                  <div>
                    <span>Wire</span>
                    <h4>Connect the project’s real checks</h4>
                  </div>
                  <Badge tone="accent">commit</Badge>
                </header>
                <p>
                  Existing tools are wired. Missing conventional tools are
                  proposed before installation.
                </p>
                <small>
                  Example subject · <code>Wire the project’s real checks</code>
                </small>
              </div>
            </li>
            <li>
              <span className="commissioning-stages__marker">04</span>
              <div className="commissioning-stages__body commissioning-stages__body--authored">
                <header>
                  <div>
                    <span>Author</span>
                    <h4>Record principles, guidance, and the Map</h4>
                  </div>
                  <Badge tone="accent">commit</Badge>
                </header>
                <p>
                  The project gains durable instructions and knowledge that
                  future agents can inherit.
                </p>
                <small>
                  Example subject · <code>Author the project practice</code>
                </small>
              </div>
            </li>
            <li>
              <span className="commissioning-stages__marker">05</span>
              <div className="commissioning-stages__body commissioning-stages__body--proof">
                <header>
                  <div>
                    <span>Verify</span>
                    <h4>Run structural checks and the full Gate</h4>
                  </div>
                  <Badge tone="success" dot>checked</Badge>
                </header>
                <p>
                  <code>discern refresh</code>,{" "}
                  <code>discern doctor</code>, and the configured Gate test the
                  reviewable setup tree.
                </p>
                <small>Output · clean committed setup tree</small>
              </div>
            </li>
            <li>
              <span className="commissioning-stages__marker commissioning-stages__marker--final">
                06
              </span>
              <div className="commissioning-stages__body commissioning-stages__body--probe">
                <header>
                  <div>
                    <span>Probe</span>
                    <h4>Prove inheritance in a fresh worktree</h4>
                  </div>
                  <Badge tone="success" dot>practice live</Badge>
                </header>
                <p>
                  A throwaway worktree verifies that guidance, checks,
                  resources, and working conditions arrive outside the setup
                  branch.
                </p>
                <small>Output · fresh-worktree probe passed</small>
              </div>
            </li>
          </ol>

          <div className="commissioning-boundaries">
            <div>
              <span>01</span>
              <p>
                <strong>Consent stays visible.</strong>{" "}
                Missing dependencies are proposed before they are installed.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>The change stays inspectable.</strong>{" "}
                Setup remains a branch the owner can review or decline.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>The probe closes the loop.</strong>{" "}
                Success means the practice survives a fresh checkout.
              </p>
            </div>
          </div>
        </div>
      }
      caption="Commissioning is agent-led work with explicit human decisions: study first, author in an isolated branch, verify the tree, then prove the result where future work begins."
      source="Amended website brief, commissioning section, 9 August 2026. Example commit subjects are illustrative and carry no fabricated hashes."
      surface="sunken"
    />
  );
}

/** Dated internal trajectory of the real lint-suppression falling ceiling. */
function StandardTrajectory() {
  return (
    <DataFigure
      className="standard-figure"
      eyebrow="Internal evidence · refreshed 9 Aug 2026"
      title="One measured gain, pinned so it cannot drift back"
      legend={[
        { label: "measured suppressions", tone: "accent" },
        { label: "configured ceiling", tone: "ink" },
      ]}
      visual={
        <div className="standard-trajectory">
          <div className="standard-trajectory__status">
            <div>
              <Badge tone="warning">Observational</Badge>
              <Badge tone="neutral">Internal dogfooding</Badge>
            </div>
            <p>Lower is better. Every authored Deno source file is enrolled.</p>
          </div>

          <div className="standard-trajectory__summary">
            <div>
              <span>Measured count</span>
              <strong>
                31 <i aria-hidden="true">→</i> 25
              </strong>
              <small>six suppressions removed</small>
            </div>
            <div>
              <span>Falling ceiling</span>
              <strong>
                31 <i aria-hidden="true">→</i> 26
              </strong>
              <small>gain pinned on 29 July</small>
            </div>
          </div>

          <div className="standard-chart">
            <svg
              viewBox="0 0 640 300"
              role="img"
              aria-label="Lint suppressions fell from 31 on 28 July to 26 on 29 July and 25 on 9 August. The ceiling fell from 31 to 26 and held."
            >
              <title>lint_suppressions Standard trajectory</title>
              <desc>
                Three dated observations. Lower values are improvements.
              </desc>
              <g className="standard-chart__grid" aria-hidden="true">
                <line x1="72" y1="48" x2="584" y2="48" />
                <line x1="72" y1="144" x2="584" y2="144" />
                <line x1="72" y1="240" x2="584" y2="240" />
                <text x="56" y="53">31</text>
                <text x="56" y="149">28</text>
                <text x="56" y="245">25</text>
              </g>
              <path
                className="standard-chart__ceiling"
                d="M 88 48 L 320 208 L 560 208"
                fill="none"
              />
              <path
                className="standard-chart__measure"
                d="M 88 48 L 320 208 L 560 240"
                fill="none"
              />
              <g className="standard-chart__points">
                <circle cx="88" cy="48" r="6" />
                <circle cx="320" cy="208" r="6" />
                <circle cx="560" cy="240" r="6" />
              </g>
              <g className="standard-chart__labels">
                <text x="88" y="276" textAnchor="middle">28 Jul</text>
                <text x="320" y="276" textAnchor="middle">29 Jul</text>
                <text x="560" y="276" textAnchor="middle">9 Aug</text>
              </g>
              <g className="standard-chart__notes">
                <text x="106" y="38">baseline · 31</text>
                <text x="320" y="187" textAnchor="middle">
                  gain pinned · 26
                </text>
                <text x="552" y="224" textAnchor="end">latest · 25</text>
              </g>
            </svg>
          </div>

          <table className="standard-data">
            <caption>Committed and observed trajectory</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Measured</th>
                <th scope="col">Ceiling</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>28 Jul</td>
                <td>31</td>
                <td>31</td>
                <td>baseline committed</td>
              </tr>
              <tr>
                <td>29 Jul</td>
                <td>26</td>
                <td>26</td>
                <td>measured gain pinned</td>
              </tr>
              <tr>
                <td>9 Aug</td>
                <td>25</td>
                <td>26</td>
                <td>latest Logbook finding</td>
              </tr>
            </tbody>
          </table>

          <ol
            className="standard-annotations"
            aria-label="Trajectory annotations"
          >
            <li>
              <span>01</span>
              <p>
                <strong>The universe is explicit.</strong>{" "}
                New authored Deno source trees enter the count automatically.
              </p>
            </li>
            <li>
              <span>02</span>
              <p>
                <strong>The gain becomes policy.</strong>{" "}
                A branch may reduce the ceiling, but it cannot raise it.
              </p>
            </li>
            <li>
              <span>03</span>
              <p>
                <strong>The next gain remains evidence.</strong>{" "}
                A count of 25 can be reviewed before another pin.
              </p>
            </li>
          </ol>

          <p className="standard-caveat">
            471 readings across 12 days and 40 attributed setup or release
            configurations. Internal snapshot, not a customer benchmark.
          </p>
        </div>
      }
      caption="The metric improved from 31 to 25. Pinning tightened its ceiling to 26, turning a cleanup into retained ground while keeping the next measured gain visible."
      source="discern Logbook and git history · snapshot refreshed 9 August 2026 · observational internal evidence"
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
            <a href="#commissioning">02 · Commissioning</a>
            <a href="#standard">03 · Standard</a>
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

        <SpecimenSection
          id="commissioning"
          index="02 / 04"
          title="A commissioning timeline"
          introduction={
            <>
              Setup as an inspectable sequence of study, human intent, authored
              change, structural checks, and the final fresh-worktree probe.
            </>
          }
          render={() => <CommissioningTimeline />}
        />

        <SpecimenSection
          id="standard"
          index="03 / 04"
          title="A Standard trajectory"
          introduction={
            <>
              A real falling ceiling from{" "}
              <DiscernName />’s own development, dated and bounded as
              observational internal evidence.
            </>
          }
          render={() => <StandardTrajectory />}
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
