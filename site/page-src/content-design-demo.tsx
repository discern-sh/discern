import { renderToStaticMarkup } from "react-dom/server";
import {
  ArticleHeader,
  ArticleLayout,
  Badge,
  Button,
  Callout,
  CodeListing,
  CtaBand,
  DataFigure,
  Footnotes,
  HeadingAccent,
  KeyPoints,
  Prose,
  PullQuote,
  RelatedContent,
  SiteFooter,
  SiteHeader,
  TableOfContents,
  Timeline,
} from "discern-design-system/react";
import type { DemoStats } from "./design-system-demo.tsx";
import { DiscernBrand } from "./branding.tsx";
import { pageDocument } from "./document.ts";

const LISTING = `# The project owns the definition of done.
[capabilities]
format = "deno fmt"
check  = "deno check"
test   = "deno task test"

[standards.coverage]
direction = "up"
limit = 94.2`;

function CoverStudy() {
  return (
    <div className="editorial-demo-cover" aria-label="An editorial issue cover">
      <div className="editorial-demo-cover__topline">
        <span>discern field notes</span>
        <span>001 / 2026</span>
      </div>
      <div className="editorial-demo-cover__mark" aria-hidden="true">
        <span>done</span>
        <i />
        <strong>✓</strong>
      </div>
      <div className="editorial-demo-cover__caption">
        <span>Editorial engineering</span>
        <strong>Evidence over assurance.</strong>
      </div>
    </div>
  );
}

function EvidenceChart() {
  const bars = [38, 56, 48, 72, 91] as const;
  return (
    <div
      className="editorial-demo-chart"
      role="img"
      aria-label="Illustrative chart showing review confidence increasing across five evidence-rich iterations"
    >
      <div className="editorial-demo-chart__plot">
        {bars.map((value, index) => (
          <div className="editorial-demo-chart__column" key={value}>
            <span style={{ height: `${value}%` }}>
              <i>{value}</i>
            </span>
            <small>0{index + 1}</small>
          </div>
        ))}
      </div>
      <div className="editorial-demo-chart__annotation">
        <span>Turning point</span>
        <p>The claim and its evidence begin travelling together.</p>
      </div>
    </div>
  );
}

function IssueCard({ stats }: { readonly stats: DemoStats }) {
  return (
    <div className="editorial-demo-issue">
      <span>Issue record</span>
      <dl>
        <div>
          <dt>Series</dt>
          <dd>Field notes</dd>
        </div>
        <div>
          <dt>Components</dt>
          <dd>{stats.components}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>{stats.tokens}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>Static HTML</dd>
        </div>
      </dl>
      <p>Built as a full reading experience from the reusable editorial set.</p>
    </div>
  );
}

function ContentDemoPage({ stats }: { readonly stats: DemoStats }) {
  return (
    <>
      <a className="editorial-demo-skip" href="#article">Skip to article</a>
      <SiteHeader
        className="editorial-demo-header"
        brand={<DiscernBrand tagline="field notes" />}
        brandTypeface="inherit"
        navItems={[
          { label: "Argument", href: "#argument" },
          { label: "Model", href: "#model" },
          { label: "Evidence", href: "#evidence" },
          { label: "Sources", href: "#sources" },
        ]}
        navLabel="Article navigation"
        notice={
          <span>
            Content atlas · 12 reusable editorial patterns ·{" "}
            <a href="https://github.com/discern-sh/design-system">
              inspect the published system
            </a>
          </span>
        }
        actions={
          <>
            <button
              className="editorial-demo-theme"
              type="button"
              data-theme-toggle
              aria-label="Toggle colour theme"
            >
              <span aria-hidden="true">◐</span>
              <span data-theme-label>Dark</span>
            </button>
            <Button href="/design-system-demo" size="sm" variant="secondary">
              Marketing atlas
            </Button>
          </>
        }
      />

      <main id="article">
        <ArticleHeader
          eyebrow={
            <Badge tone="accent">Field note 001 · Editorial engineering</Badge>
          }
          title={
            <>
              The discipline of <HeadingAccent>finishing.</HeadingAccent>
            </>
          }
          standfirst={
            <p>
              Good engineering is not only the work. It is the trail of
              reasoning, evidence, and restraint that lets the next person know
              what became true—and what still has not.
            </p>
          }
          authors={[
            {
              name: "The discern maintainers",
              role: "Systems & practice",
              initials: "DS",
            },
          ]}
          meta={["18 minute read", "14 July 2026", "Edition 001"]}
          actions={
            <Button href="#sources" variant="secondary" size="sm">
              Jump to sources
            </Button>
          }
          media={<CoverStudy />}
          surface="accent"
        />

        <ArticleLayout
          navigation={
            <TableOfContents
              items={[
                { label: "The argument", href: "#argument", current: true },
                { label: "A working model", href: "#model" },
                { label: "Evidence changes review", href: "#evidence" },
                { label: "A short chronology", href: "#chronology" },
                { label: "Notes & sources", href: "#sources" },
              ]}
              progress="18 min · essay 001"
            />
          }
          rail={
            <div className="editorial-demo-rail">
              <IssueCard stats={stats} />
              <Callout
                eyebrow="Reading lens"
                title="Look for the boundary."
                tone="insight"
                icon="◇"
              >
                <p>
                  Every strong system says both what it guarantees and where
                  judgment must still begin.
                </p>
              </Callout>
            </div>
          }
        >
          <Prose id="argument" lead dropCap>
            <p>
              Finishing is often described as the last step: merge the branch,
              close the ticket, move on. That description mistakes motion for
              resolution. A change is finished when its consequence is visible,
              its evidence is attached, and its remaining uncertainty has a
              name.
            </p>
            <p>
              This is a design problem as much as an engineering one. Interfaces
              decide whether context is adjacent or buried. Workflows decide
              whether proof is a first-class output or a sentence reconstructed
              from memory. Language decides whether a reader sees a guarantee, a
              hope, or a gap disguised as confidence.
            </p>
            <h2>Make the invisible hand-off visible.</h2>
            <p>
              The difficult part of agentic development is rarely producing
              another diff. It is making that diff legible to the person who
              owns the result. A good hand-off compresses the work without
              erasing the conditions that make it trustworthy.
            </p>
          </Prose>

          <KeyPoints
            eyebrow="The brief"
            title="Three properties of a credible finish."
            items={[
              {
                title: "It is situated",
                description: (
                  <p>
                    The claim names the exact branch, commit, and project state.
                  </p>
                ),
              },
              {
                title: "It is evidenced",
                description: (
                  <p>
                    The real commands ran, and their observable outcomes travel
                    with the claim.
                  </p>
                ),
              },
              {
                title: "It is bounded",
                description: (
                  <p>
                    What was not exercised is stated as clearly as what was.
                  </p>
                ),
              },
            ]}
          />

          <Prose>
            <h2 id="model">A working model: state, standard, receipt.</h2>
            <p>
              The model is deliberately small. First, observe the state without
              changing it. Second, run the project's own definition of quality.
              Third, bind the result to the exact work that produced it. Each
              move answers a different review question.
            </p>
          </Prose>

          <PullQuote
            quote={
              <p>
                The receipt is not the work. It is the compact, challengeable
                account of why the work is ready to be judged.
              </p>
            }
            attribution="Editorial principle"
            citation="Evidence over assurance"
          />

          <Prose>
            <p>
              Configuration keeps the standard project-owned. The system does
              not replace a formatter, compiler, or test suite; it gives those
              authorities one explicit rendezvous point.
            </p>
          </Prose>

          <CodeListing
            filename="discern.toml"
            language="TOML"
            code={LISTING}
            highlightLines={[2, 3, 4, 5, 7, 8, 9]}
            caption="The project names the commands and the number that may improve but cannot quietly regress."
          />

          <Callout
            eyebrow="Important distinction"
            title="Passing the gate is not permission to land."
            tone="warning"
            icon="!"
          >
            <p>
              Evidence informs the owner's decision; it does not replace that
              decision. Completion and consent remain separate events.
            </p>
          </Callout>

          <Prose>
            <h2 id="evidence">Evidence changes the shape of review.</h2>
            <p>
              When proof is adjacent to the claim, review moves from archaeology
              to judgment. The reviewer can spend attention on consequences and
              trade-offs instead of rebuilding basic facts from scattered logs.
              <sup id="ref-source-1">
                <a href="#note-source-1">1</a>
              </sup>
            </p>
          </Prose>

          <DataFigure
            eyebrow="Figure 01 · Illustrative model"
            title="Review confidence across five iterations"
            legend={[
              { label: "evidence attached", tone: "accent" },
              { label: "decision point", tone: "warning" },
            ]}
            visual={<EvidenceChart />}
            caption="The chart is illustrative: it demonstrates a presentation format, not a measured product claim."
            source="Design-system fixture"
            surface="sunken"
          />

          <Prose>
            <h3>A premium reading surface earns its density.</h3>
            <p>
              Long-form pages can carry more structure than marketing pages, but
              every rail, annotation, and figure needs a reason to exist. The
              aim is not ornament. It is to let different readers enter the same
              argument at different depths without breaking its spine.
            </p>
            <hr />
            <p>
              That is why this page treats code as evidence, metadata as
              orientation, and typography as pacing. Each format changes how a
              claim can be read, checked, or resumed.
            </p>
          </Prose>

          <Timeline
            id="chronology"
            eyebrow="A short chronology"
            title="From session summary to reviewable receipt."
            description={
              <p>
                The pattern becomes stronger each time responsibility moves from
                memory into the system.
              </p>
            }
            items={[
              {
                date: "Stage 01",
                title: "The confident summary",
                description: (
                  <p>
                    The agent reports success, but the evidence remains
                    scattered and easy to overstate.
                  </p>
                ),
                detail: "claim without binding",
                status: "complete",
              },
              {
                date: "Stage 02",
                title: "The shared gate",
                description: (
                  <p>
                    The project defines one real path through format, build,
                    checks, tests, and standards.
                  </p>
                ),
                detail: "mechanism becomes repeatable",
                status: "complete",
              },
              {
                date: "Stage 03",
                title: "The recorded receipt",
                description: (
                  <p>
                    Evidence binds to clean HEAD and becomes stale when the work
                    changes.
                  </p>
                ),
                detail: "review gets an exact object",
                status: "current",
              },
              {
                date: "Next",
                title: "The improving standard",
                description: (
                  <p>
                    Every accepted gain raises the floor future work must hold.
                  </p>
                ),
                detail: "quality compounds",
                status: "upcoming",
              },
            ]}
          />

          <Footnotes
            id="sources"
            items={[
              {
                id: "note-source-1",
                content: (
                  <p>
                    “Confidence” in Figure 01 is an editorial fixture used to
                    exercise the data-figure component. It is not presented as
                    research or a customer result.
                  </p>
                ),
                backHref: "#ref-source-1",
              },
              {
                id: "note-source-2",
                content: (
                  <p>
                    The configuration excerpt is abbreviated to demonstrate code
                    presentation. The manual remains the source of truth for
                    current configuration.
                  </p>
                ),
              },
              {
                id: "note-source-3",
                content: (
                  <p>
                    Every name, date, chart value, and quotation on this demo is
                    authored example content rather than a customer claim.
                  </p>
                ),
              },
            ]}
          />
        </ArticleLayout>

        <RelatedContent
          eyebrow="Continue the edition"
          title="Three ways deeper into the system."
          items={[
            {
              eyebrow: "Manual · Orientation",
              title: "The design principles behind the mechanism.",
              description: (
                <p>
                  Read the commitments that shape every command and workflow.
                </p>
              ),
              href: "/docs/orientation/design-principles",
              meta: "12 min read",
            },
            {
              eyebrow: "Manual · Quality gate",
              title: "What a recorded receipt actually guarantees.",
              description: (
                <p>
                  Follow the evidence boundary from configured command to clean
                  commit.
                </p>
              ),
              href: "/docs/quality-gate/the-receipt",
              meta: "Technical guide",
            },
            {
              eyebrow: "Design system",
              title: "Inspect every editorial component in isolation.",
              description: (
                <p>
                  Use the generated catalogue to review props, semantics, and
                  responsive treatments.
                </p>
              ),
              href: "https://github.com/discern-sh/design-system",
              meta: `${stats.components} components`,
            },
          ]}
        />

        <CtaBand
          eyebrow="The next edition starts with a real question"
          title="Build pages that reward a closer read."
          description={
            <p>
              Use the editorial set for essays, technical narratives, reports,
              changelogs, customer stories, and documentation that needs more
              than a single prose column.
            </p>
          }
          actions={
            <>
              <Button
                href="https://github.com/discern-sh/design-system"
                size="lg"
              >
                Explore the published system
              </Button>
              <Button href="/design-system-demo" size="lg" variant="secondary">
                View marketing blocks
              </Button>
            </>
          }
          note="Typed at author time · semantic HTML at runtime"
          tone="contrast"
        />
      </main>

      <SiteFooter
        brand={<DiscernBrand tagline="field notes" />}
        brandTypeface="inherit"
        description={
          <p>
            Editorial engineering for agentic software: rigorous systems,
            legible evidence, and writing that respects the reader.
          </p>
        }
        groups={[
          {
            title: "Read",
            links: [
              { label: "The manual", href: "/docs" },
              { label: "Plain text", href: "/llms.txt" },
            ],
          },
          {
            title: "Design",
            links: [
              {
                label: "Design system",
                href: "https://github.com/discern-sh/design-system",
              },
              { label: "Marketing atlas", href: "/design-system-demo" },
              { label: "Content atlas", href: "/content-design-demo" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: "https://github.com/jackwh/discern" },
              { label: "Home", href: "/" },
            ],
          },
        ]}
        legal="© 2026 discern · internal content design-system demo"
        meta="editorial engineering · static by design"
      />
    </>
  );
}

/** Render the content-focused design-system composition as static HTML. */
export function renderContentDesignDemo(stats: DemoStats): string {
  return pageDocument({
    source: "content-design-demo.tsx",
    title: "discern · Editorial engineering content atlas",
    description:
      "A content-focused design-system demo for essays, reports, technical narratives, and premium reading experiences.",
    styles: ["fonts.css", "discern.css", "content-demo.css"],
    scripts: ["demo.js"],
    body: renderToStaticMarkup(<ContentDemoPage stats={stats} />),
  });
}
