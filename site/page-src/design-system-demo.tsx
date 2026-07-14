import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties } from "react";
import {
  AudienceGrid,
  Badge,
  Button,
  CaseStudy,
  ComparisonTable,
  CtaBand,
  FaqBlock,
  FeatureBento,
  HeadingAccent,
  HeroBlock,
  LogoCloud,
  MetricsBand,
  ProcessSteps,
  SiteFooter,
  SiteHeader,
  SplitFeature,
  Tag,
  Terminal,
  Testimonial,
} from "../design-system/src/mod.ts";

export interface DemoStats {
  readonly components: number;
  readonly tokens: number;
}

type DemoIconName =
  | "agent"
  | "arrow"
  | "branch"
  | "check"
  | "code"
  | "map"
  | "spark";

function DemoIcon({ name }: { readonly name: DemoIconName }) {
  const path = {
    agent: (
      <>
        <rect x="4" y="6" width="16" height="13" rx="3" />
        <path d="M9 3h6M12 3v3M8 12h.01M16 12h.01M9 16h6" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="18" cy="8" r="2" />
        <circle cx="6" cy="19" r="2" />
        <path d="M6 7v10M8 8h4a6 6 0 0 1 6 6v-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    code: <path d="m9 7-5 5 5 5m6-10 5 5-5 5" />,
    map: (
      <>
        <path d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2V6Z" />
        <path d="M9 4v14m6-12v14" />
      </>
    ),
    spark: (
      <path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" />
    ),
  }[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

function ReceiptTerminal({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Terminal
      title={compact ? "discern done" : "discern done · recorded receipt"}
      className={compact
        ? "demo-receipt demo-receipt--compact"
        : "demo-receipt"}
      bodyStyle={{ minHeight: compact ? 280 : 390 }}
    >
      <span className="demo-receipt__command">
        <span className="demo-receipt__prompt" aria-hidden="true">$</span>{" "}
        discern done --json
      </span>
      <span className="demo-receipt__rule" />
      {[
        ["format", "passed"],
        ["typecheck", "passed"],
        ["tests", "1,284 passed"],
        ["standards", "held"],
      ].map(([label, result]) => (
        <span className="demo-receipt__row" key={label}>
          <span>{label}</span>
          <strong>{result}</strong>
        </span>
      ))}
      <span className="demo-receipt__rule" />
      <span className="demo-receipt__success">
        <DemoIcon name="check" />
        <span>clean HEAD · receipt recorded</span>
      </span>
      <button
        type="button"
        className="demo-copy"
        data-copy="discern done --json"
      >
        copy command
      </button>
    </Terminal>
  );
}

function GateVisual() {
  return (
    <div className="demo-gate-visual" aria-label="A quality gate pipeline">
      <div className="demo-gate-visual__header">
        <span>change/ready-for-review</span>
        <span>00:41</span>
      </div>
      <div className="demo-gate-visual__track">
        {[
          ["01", "fix", "formatted"],
          ["02", "build", "generated"],
          ["03", "check", "clean"],
          ["04", "test", "1,284"],
        ].map(([index, title, result]) => (
          <div key={index}>
            <span>{index}</span>
            <strong>{title}</strong>
            <small>
              <i aria-hidden="true" />
              {result}
            </small>
          </div>
        ))}
      </div>
      <div className="demo-gate-visual__receipt">
        <DemoIcon name="check" />
        <span>
          <strong>Receipt ready</strong>
          <small>every claim links back to evidence</small>
        </span>
      </div>
    </div>
  );
}

function WorktreeVisual() {
  return (
    <div
      className="demo-worktrees demo-visual-inset demo-contained-stack"
      data-demo-contained-stack="worktrees"
      data-demo-inset="worktrees"
      aria-label="Three isolated worktrees"
    >
      {[
        ["main", "trunk", "quiet"],
        ["agent/header", "site", "active"],
        ["agent/retry", "engine", "testing"],
      ].map(([branch, scope, state], index) => (
        <div key={branch} style={{ "--demo-offset": index } as CSSProperties}>
          <span>
            <DemoIcon name="branch" />
          </span>
          <strong>{branch}</strong>
          <small>{scope} · {state}</small>
        </div>
      ))}
    </div>
  );
}

const GUIDANCE_AGENTS = ["Claude", "Codex", "Gemini"] as const;

function GuidanceVisual() {
  return (
    <div className="demo-guidance" aria-label="One source feeding three agents">
      <div className="demo-guidance__source">
        <span>project/guidance.md</span>
        <strong>one authored voice</strong>
      </div>
      <div className="demo-guidance__line" aria-hidden="true">
        {GUIDANCE_AGENTS.map((agent) => (
          <span data-demo-fanout-arm="guidance" key={agent} />
        ))}
      </div>
      <div className="demo-guidance__agents">
        {GUIDANCE_AGENTS.map((agent) => (
          <span data-demo-fanout-target="guidance" key={agent}>
            <DemoIcon name="agent" />
            {agent}
          </span>
        ))}
      </div>
    </div>
  );
}

function StandardsVisual() {
  return (
    <div className="demo-standards" aria-label="Quality standards holding">
      {[
        ["coverage", "94%", 94],
        ["prose", "0.8", 72],
        ["binary", "18mb", 62],
      ].map(([label, value, width]) => (
        <div key={String(label)}>
          <span>
            <strong>{label}</strong>
            <small>{value}</small>
          </span>
          <i>
            <b style={{ width: `${width}%` }} />
          </i>
        </div>
      ))}
      <p>
        <DemoIcon name="check" />{" "}
        Numbers can improve. They cannot quietly slide.
      </p>
    </div>
  );
}

function MapVisual() {
  return (
    <div
      className="demo-map demo-visual-inset"
      data-demo-inset="map"
      aria-label="A browsable project map"
    >
      <div>
        <DemoIcon name="map" />
        <strong>project/map</strong>
      </div>
      {[
        ["00", "orientation"],
        ["20", "quality gate"],
        ["30", "worktrees"],
        ["90", "public site"],
      ].map(([index, label]) => (
        <span key={index}>
          <code>{index}/</code>
          {label}
        </span>
      ))}
    </div>
  );
}

function ScenarioVisual() {
  return (
    <div
      className="demo-scenario"
      aria-label="Defect class converted into a permanent guard"
    >
      <div className="demo-scenario__before">
        <small>before</small>
        <strong>one shipped defect</strong>
        <span>instance patched</span>
        <span>siblings still exposed</span>
      </div>
      <span className="demo-scenario__arrow" aria-hidden="true">
        <DemoIcon name="arrow" />
      </span>
      <div className="demo-scenario__after">
        <small>after</small>
        <strong>the class is illegal</strong>
        <span>
          <DemoIcon name="check" /> canonical predicate
        </span>
        <span>
          <DemoIcon name="check" /> siblings auto-enrol
        </span>
        <span>
          <DemoIcon name="check" /> future additions covered
        </span>
      </div>
    </div>
  );
}

function CommandCard() {
  return (
    <div className="demo-command-card">
      <span className="demo-command-card__label">Start with one command</span>
      <code>
        <span>$</span> curl -fsSL discern.sh/install | sh
      </code>
      <div>
        <span>
          <DemoIcon name="check" /> one binary
        </span>
        <span>
          <DemoIcon name="check" /> your stack
        </span>
        <span>
          <DemoIcon name="check" /> reversible
        </span>
      </div>
    </div>
  );
}

function DemoPage({ stats }: { readonly stats: DemoStats }) {
  return (
    <>
      <a className="demo-skip" href="#main">Skip to content</a>
      <SiteHeader
        sticky
        brand={<strong>discern</strong>}
        brandMark="D"
        navItems={[
          { label: "Audiences", href: "#audiences" },
          { label: "Capabilities", href: "#capabilities" },
          { label: "Proof", href: "#proof" },
          { label: "Questions", href: "#questions" },
        ]}
        navLabel="Demo navigation"
        notice={
          <span>
            Block atlas · 14 reusable marketing sections ·{" "}
            <a href="/styleguide/">inspect every component</a>
          </span>
        }
        actions={
          <>
            <button
              className="demo-theme"
              type="button"
              data-theme-toggle
              aria-label="Toggle colour theme"
            >
              <span aria-hidden="true">◐</span>
              <span data-theme-label>Dark</span>
            </button>
            <Button href="/docs" size="sm" variant="secondary">
              Docs
            </Button>
          </>
        }
      />

      <main id="main">
        <HeroBlock
          className="demo-hero ds-grain-wash"
          eyebrow={
            <Badge tone="success" dot>Open source · launch candidate</Badge>
          }
          title={
            <>
              Software quality you can <HeadingAccent>see.</HeadingAccent>
            </>
          }
          description={
            <p>
              discern gives coding agents a reliable way to understand your
              project, work in isolation, and prove what they changed—without
              asking you to trust a confident summary.
            </p>
          }
          actions={
            <>
              <Button
                href="/start"
                size="lg"
                trailingIcon={<DemoIcon name="arrow" />}
              >
                Add discern to a project
              </Button>
              <Button href="/docs" size="lg" variant="secondary">
                Read the manual
              </Button>
            </>
          }
          meta={
            <div className="demo-proof-list" aria-label="Product properties">
              <Tag>one self-contained binary</Tag>
              <Tag>stack-neutral</Tag>
              <Tag>local-first</Tag>
            </div>
          }
          visual={<ReceiptTerminal />}
          surface="accent"
        />

        <LogoCloud
          className="demo-logo-cloud"
          label="Designed to work beside the tools already in your project"
          items={[
            { name: "Git", mark: "⑂" },
            { name: "Deno", mark: "◉" },
            { name: "GitHub", mark: "⌁" },
            { name: "Claude", mark: "C" },
            { name: "Codex", mark: "⌘" },
            { name: "Gemini", mark: "✦" },
          ]}
        />

        <AudienceGrid
          id="audiences"
          eyebrow="Three doors into the same system"
          title="Meet people where they are."
          description={
            <p>
              The mechanics stay consistent. The invitation changes with the
              experience, anxieties, and desired outcome of the reader.
            </p>
          }
          items={[
            {
              icon: <DemoIcon name="code" />,
              eyebrow: "Experienced engineers",
              title: "Keep the autonomy. Add a forcing function.",
              description: (
                <p>
                  Bring your own stack, commands, and standards. discern makes
                  them legible to every agent and executable at the review
                  boundary.
                </p>
              ),
              meta: "Configuration over convention",
              href: "#capabilities",
              linkLabel: "Inspect the architecture",
              featured: true,
            },
            {
              icon: <DemoIcon name="spark" />,
              eyebrow: "Emerging coders",
              title: "Borrow a maintainer’s best instincts.",
              description: (
                <p>
                  Start with a safe path through worktrees, checks, tests, and
                  documentation—without needing to know every term up front.
                </p>
              ),
              meta: "Strong defaults, explained",
              href: "#journey",
              linkLabel: "Follow the workflow",
            },
            {
              icon: <DemoIcon name="agent" />,
              eyebrow: "Coding agents",
              title: "Know what is true, next, and done.",
              description: (
                <p>
                  One structured surface orients the session, isolates the
                  change, exposes the gate, and records an evidence-backed
                  finish.
                </p>
              ),
              meta: "MCP first, CLI everywhere",
              href: "#agent-edition",
              linkLabel: "Read the agent edition",
            },
          ]}
        />

        <MetricsBand
          eyebrow="The system today"
          title="Small surface. Broad vocabulary."
          tone="contrast"
          items={[
            {
              value: stats.components,
              label: "auto-enrolled components",
              detail: "including 14 marketing blocks",
            },
            {
              value: stats.tokens,
              label: "typed design tokens",
              detail: "light and dark roles included",
            },
            {
              value: "0",
              label: "remote runtime requests",
              detail: "fonts and textures stay local",
            },
          ]}
        />

        <FeatureBento
          id="capabilities"
          eyebrow="A complete project habit"
          title="Not another dashboard. The layer your agent was missing."
          description={
            <p>
              Each capability solves a local problem. Together they make agent
              work understandable, reviewable, and steadily better.
            </p>
          }
          items={[
            {
              eyebrow: "Quality gate",
              title: "Done becomes an observable state.",
              description: (
                <p>
                  Format, build, check, test, and standards run as one
                  project-owned gate—then leave a receipt.
                </p>
              ),
              icon: <DemoIcon name="check" />,
              visual: <GateVisual />,
              size: "large",
              tone: "accent",
            },
            {
              eyebrow: "Isolated work",
              title: "One branch, checkout, and resource identity per task.",
              description: (
                <p>
                  Parallel changes stay separated until the owner deliberately
                  accepts one onto the trunk.
                </p>
              ),
              icon: <DemoIcon name="branch" />,
              visual: <WorktreeVisual />,
              size: "tall",
            },
            {
              eyebrow: "Guidance",
              title: "Author the project once.",
              description: (
                <p>
                  Compile one provider-neutral source into every agent surface.
                </p>
              ),
              visual: <GuidanceVisual />,
              tone: "sunken",
            },
            {
              eyebrow: "Standards",
              title: "Numbers that cannot get worse.",
              description: (
                <p>
                  Hold coverage, size, prose, or any project metric at today’s
                  value—then ratchet upward.
                </p>
              ),
              visual: <StandardsVisual />,
            },
            {
              eyebrow: "The map",
              title: "Give agents a maintained account of the codebase.",
              description: (
                <p>
                  Keep decisions and subsystem knowledge in a tree humans can
                  audit and future sessions can read.
                </p>
              ),
              visual: <MapVisual />,
            },
          ]}
        />

        <SplitFeature
          id="proof"
          eyebrow="The review boundary"
          title={
            <>
              A green check is useful. A receipt is <em>trustworthy.</em>
            </>
          }
          description={
            <p>
              A discern receipt says which commit passed, which capabilities
              ran, which standards held, and what would land. It is compact
              enough to review and exact enough to challenge.
            </p>
          }
          points={[
            {
              title: "Bound to clean HEAD",
              description:
                "A later edit makes the evidence stale instead of silently reusing it.",
            },
            {
              title: "Project-owned commands",
              description: "Your real build and tests remain the authority.",
            },
            {
              title: "Human acceptance stays explicit",
              description: "Passing the gate never grants permission to land.",
            },
          ]}
          actions={
            <Button href="/docs/quality-gate/the-receipt" variant="secondary">
              Read about receipts
            </Button>
          }
          media={<ReceiptTerminal compact />}
          reverse
          surface="canvas"
        />

        <ProcessSteps
          id="journey"
          eyebrow="One session, start to finish"
          title="A workflow agents can follow without improvising."
          description={
            <p>
              Each transition has an owner, an observable state, and a clear
              next move. The process stays understandable even when the code is
              not.
            </p>
          }
          steps={[
            {
              eyebrow: "Orient",
              title: "Read what is true.",
              description: (
                <p>
                  Status names the branch, gate, standards, and next action.
                </p>
              ),
              detail: "discern status",
            },
            {
              eyebrow: "Isolate",
              title: "Create a clean place to work.",
              description: (
                <p>
                  A linked worktree keeps this change away from every other
                  effort.
                </p>
              ),
              detail: "discern start",
            },
            {
              eyebrow: "Iterate",
              title: "Use the fast inner loop.",
              description: (
                <p>
                  Prepare and targeted tests keep feedback close while the idea
                  moves.
                </p>
              ),
              detail: "discern prepare",
            },
            {
              eyebrow: "Prove",
              title: "Finish on a clean commit.",
              description: (
                <p>
                  The complete gate records evidence the owner can accept or
                  question.
                </p>
              ),
              detail: "discern done",
            },
          ]}
        />

        <Testimonial
          eyebrow="Illustrative voice · testimonial pattern"
          quote="The best part isn’t another green check. It’s seeing exactly what the agent proved—and what it didn’t."
          author="Illustrative engineering lead"
          authorRole="Example content · not a customer claim"
          avatar="EL"
          metric="1"
          metricLabel="reviewable receipt instead of a dozen disconnected assurances"
        />

        <ComparisonTable
          eyebrow="Why add a system?"
          title="Replace good intentions with a shared mechanism."
          description={
            <p>
              discern does not make judgment automatic. It makes the conditions
              for good judgment visible and repeatable.
            </p>
          }
          firstLabel="Agent work by memory"
          secondLabel="Agent work with discern"
          secondBadge="Coherent"
          rows={[
            {
              feature: "Definition of done",
              first: "Implicit and session-specific",
              second: "Configured, executable, and recorded",
            },
            {
              feature: "Parallel changes",
              first: "Shared checkout and accidental collisions",
              second: "One isolated worktree per effort",
            },
            {
              feature: "Project context",
              first: "Rediscovered from scattered files",
              second: "Authored once and compiled everywhere",
            },
            {
              feature: "Quality baseline",
              first: "Can drift between sessions",
              second: "Standards may improve but never loosen",
            },
            {
              feature: "Human control",
              first: "Easy to confuse completion with consent",
              second: "Gate and acceptance are separate events",
            },
          ]}
        />

        <div className="demo-direction-label" id="agent-edition">
          <span>Alternative landing-page direction</span>
          <strong>Audience: coding agents</strong>
        </div>
        <HeroBlock
          headingLevel={2}
          layout="centered"
          surface="accent"
          eyebrow={<Badge tone="accent">Machine-readable by design</Badge>}
          title={<>The website your coding agent can read, too.</>}
          description={
            <p>
              The same public URL can be a considered visual explanation for a
              person and a direct text surface for an agent. No separate,
              slowly-drifting story required.
            </p>
          }
          actions={
            <>
              <Button href="/llms.txt">Open llms.txt</Button>
              <Button href="/agents" variant="secondary">
                Meet the agent edition
              </Button>
            </>
          }
          meta="Content negotiation · plain text · documentation as Markdown"
        />

        <CaseStudy
          eyebrow="Composite scenario · case-study pattern"
          title="One defect. Every sibling. A permanent guard."
          summary={
            <p>
              A failure in one member of a repeated pattern is treated as
              evidence of a class—not an invitation to patch the visible
              instance and move on.
            </p>
          }
          body={
            <p>
              The agent names the failing predicate, discovers every current
              member, drives a parameterized guard from the canonical source,
              and fixes the whole set. The next member auto-enrols.
            </p>
          }
          stats={[
            { value: "1", label: "checkable predicate" },
            { value: "12", label: "siblings auto-enrolled" },
            { value: "0", label: "hand-kept test lists" },
          ]}
          media={<ScenarioVisual />}
          action={
            <Button
              href="/docs/orientation/design-principles"
              variant="secondary"
            >
              Read the design principles
            </Button>
          }
        />

        <FaqBlock
          id="questions"
          eyebrow="The practical questions"
          title="What teams ask before installing."
          description={
            <p>
              Clear limits make the promise more credible. These answers are
              intentionally direct.
            </p>
          }
          aside={
            <Button href="/docs/installer/faq" variant="secondary" size="sm">
              Read the full FAQ
            </Button>
          }
          openFirst
          items={[
            {
              question: "Does discern replace our existing tools?",
              answer: (
                <p>
                  No. Your formatter, build, linter, type checker, tests, and
                  scripts remain the real project commands. discern gives them
                  one structured surface and a shared workflow.
                </p>
              ),
            },
            {
              question: "Is this tied to one language or coding agent?",
              answer: (
                <p>
                  No. The configuration is stack-neutral, and one authored
                  guidance source compiles into the integration surfaces each
                  supported agent understands.
                </p>
              ),
            },
            {
              question: "Can an agent land work without asking?",
              answer: (
                <p>
                  Passing the gate is not permission. Landing requires explicit
                  owner acceptance; without it, the worktree stays separate and
                  the receipt is simply ready for review.
                </p>
              ),
            },
            {
              question: "What does discern send away?",
              answer: (
                <p>
                  discern itself has no account, hosted control plane, or
                  telemetry service. It works with local files, Git, and the
                  project commands you configure.
                </p>
              ),
            },
            {
              question: "Can we remove it later?",
              answer: (
                <p>
                  Yes. The footprint is explicit, the generated surfaces are
                  identifiable, and the installer documents the complete removal
                  path.
                </p>
              ),
            },
          ]}
        />

        <CtaBand
          eyebrow="Try the habit on one real change"
          title="Don’t take your agent’s word for it."
          description={
            <p>
              Give it a project that matters. Let discern make the work
              isolated, the standard executable, and the result reviewable.
            </p>
          }
          actions={
            <>
              <Button href="/start" size="lg">Start with discern</Button>
              <Button href="/docs" size="lg" variant="secondary">
                Read the manual
              </Button>
            </>
          }
          note="Open source · local-first · no account required"
          visual={<CommandCard />}
          tone="contrast"
          align="split"
        />
      </main>

      <SiteFooter
        brand="discern"
        brandMark="D"
        description={
          <p>
            A stack-neutral development system for coding agents and the humans
            responsible for their work.
          </p>
        }
        groups={[
          {
            title: "Explore",
            links: [
              { label: "For engineers", href: "#audiences" },
              { label: "For agents", href: "/agents" },
              { label: "Get started", href: "/start" },
            ],
          },
          {
            title: "Learn",
            links: [
              { label: "Documentation", href: "/docs" },
              { label: "Design system", href: "/styleguide/" },
              { label: "Plain-text edition", href: "/llms.txt" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "GitHub", href: "https://github.com/jackwh/discern" },
              { label: "Careers", href: "/careers" },
              { label: "Current homepage", href: "/" },
            ],
          },
        ]}
        legal="© 2026 discern · internal design-system demo"
        meta="typed React at build time · static HTML at runtime"
      />
    </>
  );
}

const THEME_BOOTSTRAP =
  `(function(){try{var t=localStorage.getItem("discern-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.dataset.dsTheme="dark"}}catch(_){}})();`;

/** Render the complete, deterministic static document served at the demo route. */
export function renderDesignSystemDemo(stats: DemoStats): string {
  const body = renderToStaticMarkup(<DemoPage stats={stats} />);
  return `<!doctype html>
<!-- Generated by site/build.ts from site/page-src/design-system-demo.tsx. Do not edit. -->
<html lang="en" data-ds-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>discern · Marketing block atlas</title>
<meta name="description" content="A comprehensive landing-page demo composed from discern's typed marketing blocks." />
<meta name="theme-color" content="#F7F5F8" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%232B2635'/%3E%3Cpath d='M28 53l17 16 27-36' stroke='%237D5BE7' stroke-width='10' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E" />
<script>${THEME_BOOTSTRAP}</script>
<link rel="stylesheet" href="/assets/design-system/fonts.css" />
<link rel="stylesheet" href="/assets/design-system/discern.css" />
<link rel="stylesheet" href="/assets/design-system/demo.css" />
<script defer src="/assets/design-system/demo.js"></script>
</head>
<body data-ds-root>
${body}
</body>
</html>
`;
}
