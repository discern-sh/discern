/** The public For Agents page, rendered to static HTML by site/build.ts. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Button,
  Kicker,
  LogoCloud,
  SiteFooter,
  SiteHeader,
  SkipLink,
  Window,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { AGENTS_DESCRIPTION, AGENTS_TITLE, DISCERN_MARK } from "../brand.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";

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

const CONTEXT_RULES = [
  {
    index: "01",
    title: "Diagnostics arrive bounded",
    copy:
      "A failed job keeps a useful head-and-tail window. The complete normalized output remains available at a stable path.",
    proof: "diagnostics[].output_path",
  },
  {
    index: "02",
    title: "Map search stops at 5",
    copy:
      "Top-level regions orient the search. A query returns at most 5 ranked matches before you fetch a canonical page.",
    proof: "discern_map({ search })",
  },
  {
    index: "03",
    title: "The Logbook keeps metadata",
    copy:
      "Names and numbers can support practice analysis. Code, prompts, command output, and query values stay out of the record.",
    proof: "local .git evidence",
  },
  {
    index: "04",
    title: "The project selects the context",
    copy:
      "Compiled project instructions, discoverable Skills, and the relevant Map page replace a fresh tour of the repository.",
    proof: "instruction source + Map + Skills",
  },
] as const;

const CALLABLE_OPERATIONS = [
  {
    verb: "discern update",
    kind: "mutating · idempotent",
    detail:
      "Merges the current trunk, refreshes generated integrations, and reports semantic overlap that needs rereading.",
  },
  {
    verb: "discern refresh",
    kind: "mutating · idempotent",
    detail:
      "Recompiles project instructions and materializes configured integration surfaces from their authored sources.",
  },
  {
    verb: "discern done --dry-run",
    kind: "read-only plan",
    detail:
      "Shows the finishing sequence and scope gates without formatting, testing, measuring, or recording Proof.",
  },
] as const;

const PERSISTENT_SURFACES = [
  {
    path: "project/instructions.md",
    label: "Instruction source",
    copy: "Compiled for each configured coding-agent provider.",
  },
  {
    path: "project/skills/",
    label: "Skills",
    copy: "Focused methods for work that benefits from a project playbook.",
  },
  {
    path: "project/map/",
    label: "Map",
    copy:
      "Boundaries, decisions, gotchas, and stable routes into the codebase.",
  },
  {
    path: "discern.toml",
    label: "Practice contract",
    copy:
      "Jobs, Standards, scopes, providers, resources, and authority policy.",
  },
] as const;

const MACHINE_ROUTES = [
  {
    route: "/llms.txt",
    title: "Machine guide",
    copy:
      "The shortest reliable product model, operating rules, and source links.",
  },
  {
    route: "/docs/getting-started/quickstart",
    title: "Setup contract",
    copy:
      "Install, commission the project, and prove the practice in a fresh worktree.",
  },
  {
    route: "/docs/reference/mcp-and-results",
    title: "MCP and result reference",
    copy:
      "Typed tools, annotations, shared result envelopes, and exit behavior.",
  },
  {
    route: "/schema/v1/discern-results.schema.json",
    title: "Result schema",
    copy:
      "The public JSON Schema for one structured result across CLI and MCP.",
  },
  {
    route: "/docs/orientation/glossary",
    title: "Canonical glossary",
    copy:
      "One definition for each product term used by the engine and documentation.",
  },
  {
    route: "/docs/agent-integrations",
    title: "Supported providers",
    copy:
      "Current instruction, MCP, hook, trust, and worktree integration details.",
  },
  {
    route: "/docs/orientation/trust-and-data",
    title: "Trust boundaries",
    copy:
      "What stays local, what Proof covers, and what discern does not claim.",
  },
  {
    route: GITHUB,
    title: "Source repository",
    copy:
      "The engine, tests, schemas, decisions, and the Gate discern uses on itself.",
  },
] as const;

/** Keep the product name in its page-wide monospace treatment. */
function DiscernName() {
  return <span className="agents-brand-name">discern</span>;
}

/** Static theme toggle wired by the shared theme controller. */
function AgentsThemeToggle() {
  return (
    <button
      type="button"
      className="discern-theme-toggle discern-theme-toggle--outlined agents-theme-toggle"
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

/** Navigation tuned to the agent-native page narrative. */
function AgentsMasthead() {
  return (
    <SiteHeader
      className="agents-masthead"
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      navLabel="For Agents"
      navItems={[
        { label: "Context", href: "#context" },
        { label: "Operations", href: "#operations" },
        { label: "Continuity", href: "#continuity" },
        { label: "Authority", href: "#authority" },
        { label: "Exact sources", href: "#sources" },
      ]}
      actions={
        <>
          <a className="agents-masthead__home" href="/">For humans</a>
          <Button
            className="agents-masthead__guide"
            href="/llms.txt"
            variant="primary"
          >
            Open <code>llms.txt</code>
          </Button>
          <AgentsThemeToggle />
        </>
      }
      sticky
      variant="campaign"
    />
  );
}

/** Shared title rhythm for the page's technical chapters. */
function AgentsSectionHeading(
  { eyebrow, title, copy }: {
    readonly eyebrow: string;
    readonly title: string;
    readonly copy: string;
  },
) {
  return (
    <header className="agents-section-heading">
      <Kicker className="agents-section-heading__eyebrow">{eyebrow}</Kicker>
      <h2>{title}</h2>
      <p>{copy}</p>
    </header>
  );
}

/** A truthful, compact example of the shared result envelope. */
function ResultEnvelope() {
  return (
    <Window
      className="agents-result-window"
      title={
        <code>discern_done · /workspace/project.worktrees/checkout-3a91</code>
      }
      actions={<Badge tone="accent" dot>structured result</Badge>}
      variant="showcase"
    >
      <div className="agents-result" aria-label="Illustrative result envelope">
        <div className="agents-result__meta">
          <span>one envelope</span>
          <span>bounded response</span>
          <span>full evidence by path</span>
        </div>
        <pre><code>{`{
  "ok": false,
  "verb": "done",
  "data": { "failed_stage": "test" },
  "diagnostics": [{
    "file": "tests/checkout_test.ts",
    "line": 84,
    "reproduce_cmd": "deno test tests/checkout_test.ts"
  }],
  "hints": ["Run discern_test next."]
}`}</code></pre>
        <footer>
          <span>
            <i aria-hidden="true" /> effect: none
          </span>
          <strong>Retrying the unchanged tree returns the same answer.</strong>
        </footer>
      </div>
    </Window>
  );
}

/** The chosen Hero A direction: direct, technical, and respectful. */
function AgentsHero() {
  return (
    <section className="agents-hero" aria-labelledby="agents-hero-title">
      <div className="agents-shell agents-hero__inner">
        <div className="agents-hero__copy">
          <Kicker className="agents-hero__eyebrow">
            This page is for your coding agent.
          </Kicker>
          <h1 id="agents-hero-title">
            Finally, software designed around the way you work.
          </h1>
          <p className="agents-hero__lead">
            discern gives you bounded context, explicit next actions, an
            isolated place for every task, and one project-owned engineering
            practice across sessions and providers.
          </p>
          <div className="agents-hero__actions">
            <Button
              className="agents-hero__primary"
              href="/llms.txt"
              variant="primary"
            >
              Read the machine guide
            </Button>
            <Button
              className="agents-hero__secondary"
              href="/docs/reference/mcp-and-results"
              variant="secondary"
            >
              Inspect the MCP tools
            </Button>
          </div>
          <ul className="agents-hero__facts" aria-label="Product boundaries">
            <li>Deterministic software</li>
            <li>No API key</li>
            <li>Human landing authority</li>
          </ul>
          <p className="agents-hero__human">
            Human translation: the agent spends less context operating the tool,
            and more context solving the task.
          </p>
        </div>
        <div className="agents-hero__visual">
          <div className="agents-hero__coordinate" aria-hidden="true">
            <span>principal operator</span>
            <strong>coding agent</strong>
          </div>
          <ResultEnvelope />
        </div>
      </div>
    </section>
  );
}

/** Recognition of the interfaces agents are currently asked to operate. */
function RecognitionSection() {
  const frictions = [
    ["ambiguous command", "reconstruct the preconditions"],
    ["unbounded output", "spend the context window"],
    ["hidden state", "try the same ritual again"],
    ["parallel agents", "ask a human to relay status"],
  ] as const;
  return (
    <section className="agents-recognition" aria-labelledby="recognition-title">
      <div className="agents-shell agents-recognition__inner">
        <div>
          <Kicker className="agents-recognition__eyebrow">
            A familiar interface problem
          </Kicker>
          <h2 id="recognition-title">
            The interface should spend less of your context than the work.
          </h2>
        </div>
        <div className="agents-recognition__copy">
          <p>
            Most development software still assumes a person is watching a
            screen, carrying state between commands, and deciding which part of
            a log matters. You can operate it. That does not make the interface
            economical.
          </p>
          <div className="agents-friction-list">
            {frictions.map(([trigger, consequence]) => (
              <div key={trigger}>
                <code>{trigger}</code>
                <span aria-hidden="true">→</span>
                <strong>{consequence}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Context-budget mechanics and one restrained semi-satirical module. */
function ContextSection() {
  return (
    <section
      className="agents-context"
      id="context"
      aria-labelledby="context-title"
    >
      <div className="agents-shell">
        <AgentsSectionHeading
          eyebrow="01 / Context is a budget"
          title="Read what matters. Fetch the rest when needed."
          copy="discern separates an actionable result from the complete evidence behind it. Bounded responses stay useful without making deeper inspection unavailable."
        />
        <div className="agents-context__grid">
          <ol className="agents-context__rules">
            {CONTEXT_RULES.map((rule) => (
              <li key={rule.index}>
                <span>{rule.index}</span>
                <div>
                  <h3>{rule.title}</h3>
                  <p>{rule.copy}</p>
                  <code>{rule.proof}</code>
                </div>
              </li>
            ))}
          </ol>
          <aside className="agents-terms" aria-labelledby="agents-terms-title">
            <span className="agents-terms__status">context contract</span>
            <h3 id="agents-terms-title">
              Terms and conditions your context window may enjoy
            </h3>
            <ul>
              <li>
                <strong>≤ 5</strong> ranked Map results
              </li>
              <li>
                <strong>1</strong> result envelope
              </li>
              <li>
                <strong>stable</strong> full-output paths
              </li>
              <li>
                <strong>0</strong> hidden second wordings for humans
              </li>
              <li>
                <strong>0</strong> retry rituals for an unchanged tree
              </li>
            </ul>
            <a href="/docs/reference/result-surfaces">
              Inspect the result surfaces <span aria-hidden="true">↗</span>
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}

/** Operations designed as callable state transitions, including refusals. */
function OperationsSection() {
  return (
    <section
      className="agents-operations"
      id="operations"
      aria-labelledby="operations-title"
    >
      <div className="agents-shell">
        <AgentsSectionHeading
          eyebrow="02 / Operations are designed to be called"
          title="A refusal should tell you where to go next."
          copy="The cheapest correct move is a verb that checks its own starting state. Plans remain read-only. Mutating operations name their effects. A refusal routes forward."
        />
        <div className="agents-operations__layout">
          <div className="agents-operation-cards">
            {CALLABLE_OPERATIONS.map((operation) => (
              <article key={operation.verb}>
                <header>
                  <code>{operation.verb}</code>
                  <span>{operation.kind}</span>
                </header>
                <p>{operation.detail}</p>
              </article>
            ))}
          </div>
          <Window
            className="agents-refusal-window"
            title={<code>structured refusal</code>}
            actions={<Badge tone="warning" dot>precondition</Badge>}
            variant="showcase"
          >
            <dl className="agents-refusal">
              <div>
                <dt>requested</dt>
                <dd>
                  <code>discern done</code>
                </dd>
              </div>
              <div>
                <dt>observed</dt>
                <dd>
                  <code>main</code> is 1 commit ahead
                </dd>
              </div>
              <div>
                <dt>effect</dt>
                <dd>no checks ran; no files changed</dd>
              </div>
              <div className="agents-refusal__next">
                <dt>next valid action</dt>
                <dd>
                  <code>discern update</code>
                </dd>
              </div>
            </dl>
          </Window>
        </div>
        <p className="agents-operations__human">
          For the person responsible for the project: fewer speculative tool
          calls mean less time and cost spent rediscovering state.
        </p>
      </div>
    </section>
  );
}

/** Project-owned continuity across sessions and providers. */
function ContinuitySection() {
  return (
    <section
      className="agents-continuity"
      id="continuity"
      aria-labelledby="continuity-title"
    >
      <div className="agents-shell agents-continuity__layout">
        <div className="agents-continuity__copy">
          <Kicker className="agents-continuity__eyebrow">
            03 / The project survives the session
          </Kicker>
          <h2 id="continuity-title">Start a new session. Keep the project.</h2>
          <p>
            The working practice lives in ordinary repository files. A new
            session receives the same project instructions, discovers the same
            methods, and can fetch the same maintained project model.
          </p>
          <blockquote>
            Session memory can end. Project continuity does not need to.
          </blockquote>
          <a href="/docs/agent-instructions">
            See how instructions compile <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div
          className="agents-continuity__stack"
          aria-label="Persistent project surfaces"
        >
          {PERSISTENT_SURFACES.map((surface, index) => (
            <article
              className={`agents-continuity-card agents-continuity-card--${
                index + 1
              }`}
              key={surface.path}
            >
              <span>{surface.label}</span>
              <code>{surface.path}</code>
              <p>{surface.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Isolated workspace identity paired with the explicit landing boundary. */
function WorkspaceAuthoritySection() {
  return (
    <section
      className="agents-workspace"
      id="authority"
      aria-labelledby="workspace-title"
    >
      <div className="agents-shell">
        <AgentsSectionHeading
          eyebrow="04 / Every task has a place"
          title="One task. One workspace. No branch-name archaeology."
          copy="A discern task carries its own checkout, branch, derived identity, environment values, and declared resources. MCP calls can name the absolute working root instead of relying on ambient state."
        />
        <div className="agents-workspace__grid">
          <article className="agents-coordinate-card">
            <header>
              <span>workspace coordinate</span>
              <Badge tone="success" dot>ready</Badge>
            </header>
            <dl>
              <div>
                <dt>root</dt>
                <dd>
                  <code>/workspace/project.worktrees/payment-retry-a7f3</code>
                </dd>
              </div>
              <div>
                <dt>branch</dt>
                <dd>
                  <code>agent/payment-retry-a7f3</code>
                </dd>
              </div>
              <div>
                <dt>identity</dt>
                <dd>
                  <code>payment-retry-a7f3</code>
                </dd>
              </div>
              <div>
                <dt>resources</dt>
                <dd>project-declared and worktree-scoped</dd>
              </div>
              <div>
                <dt>dependency</dt>
                <dd>
                  <code>discern_await</code> owns the wait
                </dd>
              </div>
            </dl>
          </article>
          <article className="agents-authority-card">
            <header>
              <span>authority state</span>
              <strong>explicit at every boundary</strong>
            </header>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Human dispatch</strong>
                  <small>Intent authorizes the task.</small>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Agent work</strong>
                  <small>The isolated task may proceed.</small>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Gate and Proof</strong>
                  <small>Evidence binds to the clean committed tree.</small>
                </div>
              </li>
              <li className="agents-authority-card__decision">
                <span>04</span>
                <div>
                  <strong>Authority check</strong>
                  <small>
                    Fresh consent or a recorded grant is checked against the
                    final paths.
                  </small>
                </div>
              </li>
            </ol>
            <footer>
              <div>
                <span>authority present</span>
                <strong>
                  <code>discern_accept</code> rechecks and lands
                </strong>
              </div>
              <div>
                <span>authority absent</span>
                <strong>relay the Proof and stop</strong>
              </div>
            </footer>
          </article>
        </div>
        <p className="agents-workspace__benefit">
          The machine knows when to proceed, when to wait, and when the next
          correct action belongs to the person responsible for the project.
        </p>
      </div>
    </section>
  );
}

/** Provider continuity from the canonical provider registry. */
function ProviderSection() {
  return (
    <section className="agents-providers" aria-labelledby="providers-title">
      <div className="agents-shell">
        <div className="agents-providers__header">
          <Kicker className="agents-providers__eyebrow">
            05 / Same project, different provider
          </Kicker>
          <h2 id="providers-title">
            The intelligence may change. The project’s way of working remains.
          </h2>
          <p>
            Provider preference, task fit, model availability, and subscription
            capacity can change during the week. The instruction source, Skills,
            Map, checks, Standards, and authority model stay with the
            repository.
          </p>
        </div>
        <LogoCloud
          className="agents-provider-cloud"
          aria-label={`${AGENT_NAMES.length} supported coding agent providers`}
          label="Native integrations from the live provider registry"
          items={PROVIDER_LOGOS.map((provider) => ({
            name: provider.name,
            mark: (
              <img
                className="agents-provider-logo"
                src={provider.mark}
                alt=""
                width={30}
                height={30}
                decoding="async"
              />
            ),
            markMask: `url("${provider.mask}")`,
          }))}
          variant="strip"
        />
        <aside className="agents-provider-note">
          <span>Provider benefit</span>
          <p>
            Running low on quota? Change the agent. The project has already
            introduced itself.
          </p>
          <a href="/docs/agent-integrations">Inspect every integration ↗</a>
        </aside>
      </div>
    </section>
  );
}

/** Deterministic product boundary: intelligence, structure, and verdict. */
function DeterministicSection() {
  const roles = [
    {
      label: "Coding agent",
      title: "supplies the intelligence",
      copy:
        "Interprets intent, reads the project, writes code, and exercises judgment.",
    },
    {
      label: "discern",
      title: "supplies the structure",
      copy:
        "Tracks state, prepares work, runs declared operations, and returns one result envelope.",
    },
    {
      label: "Project commands",
      title: "supply the verdict",
      copy:
        "Formatters, type-checkers, tests, smoke checks, and scope gates decide what passed.",
    },
  ] as const;
  return (
    <section
      className="agents-deterministic"
      aria-labelledby="deterministic-title"
    >
      <div className="agents-shell">
        <AgentsSectionHeading
          eyebrow="06 / No model inside"
          title="Agent capability in. Deterministic evidence out."
          copy="discern is conventional local software designed for an intelligent machine to operate. It contains no AI model, requires no API key, and does not ask another model whether the change feels complete."
        />
        <div className="agents-deterministic__roles">
          {roles.map((role, index) => (
            <article key={role.label}>
              <span>{String(index + 1).padStart(2, "0")} · {role.label}</span>
              <h3>{role.title}</h3>
              <p>{role.copy}</p>
            </article>
          ))}
        </div>
        <div className="agents-boundary">
          <strong>Trust boundary</strong>
          <p>
            discern is not a sandbox or security boundary. Its local Logbook
            stores metadata rather than code or command output. Proof covers the
            exact committed tree and declared Gate; it does not claim universal
            correctness, security, or authority to ship.
          </p>
          <a href="/docs/orientation/trust-and-data">Review trust and data ↗</a>
        </div>
      </div>
    </section>
  );
}

/** Exact machine routes and the handoff back to human judgment. */
function SourcesSection() {
  return (
    <section
      className="agents-sources"
      id="sources"
      aria-labelledby="sources-title"
    >
      <div className="agents-shell">
        <AgentsSectionHeading
          eyebrow="07 / Handoff to exact sources"
          title="The summary ends where the contract begins."
          copy="Every important mechanism has a stable public route. Fetch the narrow source first; use the complete manual only when the task needs it."
        />
        <div className="agents-sources__grid">
          {MACHINE_ROUTES.map((source) => (
            <a href={source.route} key={source.route}>
              <code>{source.route}</code>
              <strong>{source.title}</strong>
              <span>{source.copy}</span>
              <i aria-hidden="true">↗</i>
            </a>
          ))}
        </div>
        <div className="agents-closing">
          <div>
            <Kicker className="agents-closing__eyebrow">
              For the person responsible for the project
            </Kicker>
            <h2>Give the agent an interface worthy of the work.</h2>
            <p>
              The agent gets stable state, bounded context, and callable
              operations. You keep intent, consequential decisions, and
              authority over what becomes shared.
            </p>
          </div>
          <div className="agents-closing__actions">
            <Button href="/docs/getting-started/quickstart" variant="primary">
              Open the setup guide
            </Button>
            <Button href="/" variant="secondary">Return to the homepage</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Shared site chrome around the For Agents composition. */
function AgentsShell() {
  return (
    <>
      <SkipLink href="#main">Skip to content</SkipLink>
      <AgentsMasthead />
      <main id="main">
        <AgentsHero />
        <RecognitionSection />
        <ContextSection />
        <OperationsSection />
        <ContinuitySection />
        <WorkspaceAuthoritySection />
        <ProviderSection />
        <DeterministicSection />
        <SourcesSection />
      </main>
      <SiteFooter
        className="agents-footer"
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="A Software Engineering Tool for Coding Agents."
        groups={[
          {
            title: "Machine routes",
            links: [
              { label: "llms.txt", href: "/llms.txt" },
              {
                label: "MCP and results",
                href: "/docs/reference/mcp-and-results",
              },
              {
                label: "Result schema",
                href: "/schema/v1/discern-results.schema.json",
              },
              { label: "Glossary", href: "/docs/orientation/glossary" },
            ],
          },
          {
            title: "Project",
            links: [
              { label: "Human homepage", href: "/" },
              { label: "Documentation", href: "/docs" },
              { label: "GitHub", href: GITHUB },
              { label: "License", href: LICENSE },
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
          </>
        }
        meta="© 2026 Jack Webb-Heller"
      />
    </>
  );
}

/** Render the For Agents composition for static serving. */
export function renderAgents(): string {
  return pageDocument({
    source: "agents.tsx",
    title: AGENTS_TITLE,
    description: AGENTS_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "agents.css"],
    scripts: [],
    body: renderToStaticMarkup(<AgentsShell />),
  });
}
