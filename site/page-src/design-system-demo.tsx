import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Banner,
  Button,
  Card,
  Cluster,
  Container,
  Divider,
  Grid,
  Heading,
  HeadingAccent,
  Kicker,
  Section,
  Stack,
  Tag,
  Terminal,
} from "../design-system/src/mod.ts";

export interface DemoStats {
  readonly components: number;
  readonly tokens: number;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m4 10.5 3.4 3.4L16 5.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10h11m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DemoPage({ stats }: { readonly stats: DemoStats }) {
  const principles = [
    {
      index: "01",
      title: "One source of visual truth",
      copy:
        "Typed tokens define colour, type, spacing, shape, motion, and layout. The browser receives deterministic CSS generated from those values.",
    },
    {
      index: "02",
      title: "Static at the edge",
      copy:
        "React makes authoring composable and checked, then leaves the building. Visitors receive semantic HTML, CSS, and only tiny progressive enhancements.",
    },
    {
      index: "03",
      title: "Every component enrols",
      copy:
        "Implementation, styles, metadata, and examples live together. Adding a component automatically places it in the local catalogue and the build manifest.",
    },
  ] as const;

  return (
    <>
      <a className="demo-skip" href="#main">Skip to content</a>
      <header className="demo-topbar">
        <Container size="lg" className="demo-topbar__inner">
          <a className="demo-brand" href="/">
            <span className="demo-brand__mark" aria-hidden="true">D</span>
            <span>
              <strong>discern</strong>
              <small>design-system demo</small>
            </span>
          </a>
          <nav className="demo-nav" aria-label="Demo navigation">
            <a href="#system">The system</a>
            <a href="#workflow">Workflow</a>
            <a href="/docs">Docs</a>
          </nav>
          <button
            className="demo-theme"
            type="button"
            data-theme-toggle
            aria-label="Toggle colour theme"
          >
            <span aria-hidden="true">◐</span>
            <span data-theme-label>Dark</span>
          </button>
        </Container>
      </header>

      <main id="main">
        <Section spacing="lg" className="demo-hero ds-grain-wash">
          <Container size="lg">
            <div className="demo-hero__grid">
              <Stack gap={6} align="start" className="ds-reveal">
                <Badge tone="success" dot>Experimental surface</Badge>
                <Kicker index="00">The landing-page system</Kicker>
                <Heading level={1}>
                  A visual system with an{" "}
                  <HeadingAccent>exit status.</HeadingAccent>
                </Heading>
                <p className="demo-lead">
                  This page is the proving ground for discern’s new design
                  language: authored with typed components, built to static
                  HTML, and served by the same tiny Deno handler as the existing
                  editions.
                </p>
                <Cluster gap={4} className="demo-actions">
                  <Button href="#system" trailingIcon={<ArrowIcon />}>
                    Explore the system
                  </Button>
                  <Button href="/" variant="secondary">
                    See the current homepage
                  </Button>
                </Cluster>
                <Cluster
                  gap={2}
                  className="demo-tags"
                  aria-label="Runtime properties"
                >
                  <Tag>static HTML</Tag>
                  <Tag>local assets</Tag>
                  <Tag>zero React runtime</Tag>
                </Cluster>
              </Stack>

              <Terminal
                title="discern done"
                className="demo-window ds-reveal"
                bodyStyle={{ minHeight: 330 }}
              >
                <span className="demo-terminal__command">
                  <span className="ds-terminal__prompt" aria-hidden="true">
                    $
                  </span>{" "}
                  discern done --json
                </span>
                <span className="demo-terminal__rule" />
                <span className="demo-terminal__row">
                  <span>format</span>
                  <strong className="ds-terminal__success">passed</strong>
                </span>
                <span className="demo-terminal__row">
                  <span>typecheck</span>
                  <strong className="ds-terminal__success">passed</strong>
                </span>
                <span className="demo-terminal__row">
                  <span>tests</span>
                  <strong className="ds-terminal__success">
                    1,284 passed
                  </strong>
                </span>
                <span className="demo-terminal__rule" />
                <span className="demo-terminal__receipt">
                  <CheckIcon />
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
            </div>
          </Container>
        </Section>

        <Section id="system" spacing="lg">
          <Container size="lg">
            <Stack gap={10}>
              <div className="demo-section-head">
                <div>
                  <Kicker index="01">The system</Kicker>
                  <Heading level={2}>Built to compose, not prescribe.</Heading>
                </div>
                <p>
                  Foundations stay neutral. Product voice and page composition
                  live here, in the consumer—not inside the component library.
                </p>
              </div>
              <Grid minimum="17rem" gap={5}>
                {principles.map((principle) => (
                  <Card key={principle.index} raised padding="lg">
                    <Stack gap={4}>
                      <Kicker index={principle.index}>Principle</Kicker>
                      <Heading level={3}>{principle.title}</Heading>
                      <p className="demo-muted">{principle.copy}</p>
                    </Stack>
                  </Card>
                ))}
              </Grid>
              <Banner tone="accent" icon={<CheckIcon />}>
                <strong>The coexistence rule:</strong>{" "}
                the design system is scoped under{" "}
                <code>data-ds-root</code>, so this experiment can evolve without
                restyling any existing landing page.
              </Banner>
            </Stack>
          </Container>
        </Section>

        <Section id="workflow" surface="surface" spacing="lg">
          <Container size="lg">
            <Stack gap={10}>
              <div className="demo-section-head">
                <div>
                  <Kicker index="02">The workflow</Kicker>
                  <Heading level={2}>Author once. Prove every layer.</Heading>
                </div>
                <p>
                  The build connects design decisions to the static artifact;
                  discern connects that artifact to a permanent quality gate.
                </p>
              </div>
              <div className="demo-flow">
                {[
                  ["Tokens", "Change one typed value."],
                  ["Components", "Compose a page in TSX."],
                  ["Build", "Emit deterministic HTML and CSS."],
                  ["Gate", "Verify routes, assets, and browser behaviour."],
                ].map(([title, copy], index) => (
                  <div className="demo-flow__step" key={title}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                ))}
              </div>
              <Divider label="build receipt" surface="canvas" />
              <Grid minimum="15rem" gap={4}>
                <Card padding="md">
                  <span className="demo-stat">{stats.tokens}</span>
                  <span className="demo-stat__label">typed tokens</span>
                </Card>
                <Card padding="md">
                  <span className="demo-stat">{stats.components}</span>
                  <span className="demo-stat__label">
                    auto-enrolled components
                  </span>
                </Card>
                <Card padding="md">
                  <span className="demo-stat">0</span>
                  <span className="demo-stat__label">
                    third-party runtime requests
                  </span>
                </Card>
              </Grid>
            </Stack>
          </Container>
        </Section>

        <Section spacing="lg" className="demo-cta">
          <Container size="sm">
            <Stack gap={6} align="center">
              <Kicker index="03">The migration path</Kicker>
              <Heading level={2}>One edition at a time.</Heading>
              <p>
                The current landing pages remain untouched until this system has
                earned the right to replace them. Each future edition can be
                composed, compared, and switched over independently.
              </p>
              <Cluster gap={4} justify="center">
                <Button href="/docs">Read the manual</Button>
                <Button href="/agents" variant="secondary">
                  Meet the agent edition
                </Button>
              </Cluster>
            </Stack>
          </Container>
        </Section>
      </main>

      <footer className="demo-footer">
        <Container size="lg" className="demo-footer__inner">
          <span>discern design-system experiment</span>
          <span>typed React at build time · static HTML at runtime</span>
        </Container>
      </footer>
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
<title>discern · Design-system demo</title>
<meta name="description" content="A static landing-page experiment composed with discern's typed design system." />
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
