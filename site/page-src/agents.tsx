/** The public /agents campaign page, rendered to static HTML by site/build.ts. */

import type { CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Badge,
  Button,
  Kicker,
  SiteFooter,
  SiteHeader,
  SkipLink,
  Window,
} from "discern-design-system/react";
import { providerBrandSilhouette, PROVIDERS } from "../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../src/shared/agent_catalogue.ts";
import { AGENTS_DESCRIPTION, AGENTS_TITLE, DISCERN_MARK } from "../brand.ts";
import {
  AGENTS_CONTENT,
  AGENTS_EVIDENCE,
  AGENTS_MARKDOWN_TOKEN_ESTIMATE,
  AGENTS_ROUTES,
  CLOSING_ENVELOPE,
  EVALUATION_INSTRUCTION,
} from "./agents-content.ts";
import { pageDocument } from "./document.ts";

const GITHUB = "https://github.com/jackwh/discern";
const LICENSE = GITHUB + "/blob/main/LICENSE";

/** Provider files and marks, derived from the live native-provider registry. */
const PROVIDER_OUTPUTS = AGENT_NAMES.map((name) => {
  const provider = PROVIDERS[name];
  const silhouette = providerBrandSilhouette(provider.brand);
  return {
    name: provider.label,
    file: provider.instructionFile.path,
    mark: provider.brand.mark.path,
    mask: silhouette.path,
  };
});

/** Keep the product name in its page-wide monospace treatment. */
function DiscernName() {
  return <span className="agents-brand-name">discern</span>;
}

/** Navigation for the machine-addressed campaign surface. */
function AgentsMasthead() {
  return (
    <SiteHeader
      className="agents-masthead"
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      navLabel="For coding agents"
      navItems={[
        { label: "Why discern", href: AGENTS_ROUTES.home },
        { label: "Agent ergonomics", href: "#agent-ergonomics" },
        { label: "Proof", href: "#proof" },
        { label: "Machine guide", href: AGENTS_ROUTES.machineGuide },
      ]}
      actions={
        <>
          <a
            className="agents-masthead__plaintext"
            href={AGENTS_ROUTES.plaintext}
          >
            Plaintext
          </a>
          <Button
            className="agents-masthead__guide"
            href={AGENTS_ROUTES.machineGuide}
            variant="primary"
          >
            Read the machine guide
          </Button>
        </>
      }
      sticky
      variant="campaign"
    />
  );
}

/** Shared editorial title rhythm for each movement. */
function MovementHeader(
  { number, eyebrow, title, lead, titleId }: {
    readonly number: string;
    readonly eyebrow: string;
    readonly title: string;
    readonly lead?: string;
    readonly titleId: string;
  },
) {
  return (
    <header className="agents-movement-header">
      <div className="agents-movement-header__index" aria-hidden="true">
        <span>{number}</span>
        <i />
      </div>
      <div className="agents-movement-header__copy">
        <Kicker className="agents-kicker">{eyebrow}</Kicker>
        <h2 id={titleId}>{title}</h2>
        {lead === undefined ? null : <p>{lead}</p>}
      </div>
    </header>
  );
}

/** The shareable, self-contained opening card. */
function AgentsHero() {
  const { hero } = AGENTS_CONTENT;
  const contract = [
    ["state", "ask for it"],
    ["workspace", "isolated"],
    ["results", "bounded"],
    ["guidance", "project-owned"],
    ["authority", "human"],
  ] as const;
  return (
    <section className="agents-hero" aria-labelledby="agents-hero-title">
      <div className="agents-hero__frame">
        <div className="agents-hero__measure" aria-hidden="true">
          <span>01</span>
          <span>agent surface</span>
          <span>exact / bounded</span>
        </div>
        <div className="agents-hero__layout">
          <div className="agents-hero__copy">
            <Kicker className="agents-hero__eyebrow">{hero.eyebrow}</Kicker>
            <h1 id="agents-hero-title">{hero.title}</h1>
            {hero.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            <div className="agents-hero__actions">
              <Button href={AGENTS_ROUTES.machineGuide} variant="primary">
                Read the machine guide
              </Button>
              <Button
                className="agents-button--inverse"
                href={AGENTS_ROUTES.mcp}
                variant="secondary"
              >
                Inspect the MCP tools
              </Button>
            </div>
            <p className="agents-hero__plaintext">
              {hero.plaintext}{" "}
              <a href={AGENTS_ROUTES.plaintext}>
                Open <code>/agents.md</code>.
              </a>
            </p>
          </div>
          <aside
            className="agents-contract"
            aria-label="discern operating contract"
          >
            <header>
              <span>operating contract</span>
              <Badge tone="accent" dot>ready for inspection</Badge>
            </header>
            <dl>
              {contract.map(([term, value], index) => (
                <div key={term}>
                  <dt>{String(index + 1).padStart(2, "0")} / {term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <footer>
              <span>effect</span>
              <strong>more context reaches the project</strong>
            </footer>
          </aside>
        </div>
        <p className="agents-hero__tell">{hero.tell}</p>
      </div>
    </section>
  );
}

/** Recognition of the interfaces agents currently have to compensate for. */
function RecognitionSection() {
  const { recognition } = AGENTS_CONTENT;
  const frictions = [
    ["terminal", "remembers nothing"],
    ["log", "asks you to skim"],
    ["dashboard", "assumes eyes"],
    ["handoff", "becomes human relay"],
  ] as const;
  return (
    <section
      className="agents-recognition"
      id={recognition.id}
      aria-labelledby="recognition-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="02"
          eyebrow={recognition.eyebrow}
          title={recognition.title}
          titleId="recognition-title"
        />
        <div className="agents-recognition__body">
          <div
            className="agents-recognition__frictions"
            aria-label="Interface assumptions"
          >
            {frictions.map(([subject, assumption]) => (
              <div key={subject}>
                <code>{subject}</code>
                <span aria-hidden="true">→</span>
                <strong>{assumption}</strong>
              </div>
            ))}
          </div>
          <div className="agents-prose agents-recognition__prose">
            {recognition.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** One live refusal in two projections, surrounded by the operating contract. */
function ErgonomicsSection() {
  const { ergonomics } = AGENTS_CONTENT;
  const { refusal } = AGENTS_EVIDENCE;
  return (
    <section
      className="agents-ergonomics"
      id={ergonomics.id}
      aria-labelledby="ergonomics-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="03"
          eyebrow={ergonomics.eyebrow}
          title={ergonomics.title}
          lead={ergonomics.lead}
          titleId="ergonomics-title"
        />
        <div className="agents-feature-grid">
          {ergonomics.features.map((feature) => (
            <article key={feature.index}>
              <span>{feature.index}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
        <figure className="agents-refusal-figure">
          <figcaption>
            <div>
              <span>LIVE ENGINE CAPTURE · SAME RESULT OBJECT</span>
              <strong>
                <code>$ {refusal.command}</code>
              </strong>
            </div>
            <Badge tone="warning" dot>unknown_command</Badge>
          </figcaption>
          <div className="agents-refusal-figure__panes">
            <article>
              <header>
                <span>machine projection</span>
                <code>--json</code>
              </header>
              <pre><code>{refusal.json}</code></pre>
            </article>
            <article>
              <header>
                <span>human projection</span>
                <code>--markdown</code>
              </header>
              <pre><code>{refusal.markdown}</code></pre>
            </article>
          </div>
          <footer>
            <span>one source of truth</span>
            <strong>
              A synonym is forgiven. The canonical verb is returned.
            </strong>
          </footer>
        </figure>
        <p className="agents-marginalia">{ergonomics.close}</p>
      </div>
    </section>
  );
}

/** Bounded diagnostics and task-language Map search. */
function ContextSection() {
  const { context } = AGENTS_CONTENT;
  const evidence = AGENTS_EVIDENCE;
  return (
    <section
      className="agents-context"
      id={context.id}
      aria-labelledby="context-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="04"
          eyebrow={context.eyebrow}
          title={context.title}
          lead={context.paragraphs[0]}
          titleId="context-title"
        />
        <div className="agents-context__features">
          {context.features.map((feature, index) => (
            <article key={feature.title}>
              <span>0{index + 1}</span>
              <div>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="agents-context__evidence">
          <Window
            className="agents-diagnostic-window"
            title={<code>bounded diagnostic</code>}
            actions={<Badge tone="warning" dot>truncated</Badge>}
            variant="showcase"
          >
            <div className="agents-diagnostic">
              <section>
                <span>INLINE / ACT NOW</span>
                <ol>
                  {evidence.diagnostic.inline.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </section>
              <section>
                <span>ON DEMAND / FULL CAPTURE</span>
                <code>{evidence.diagnostic.outputPath}</code>
                <small>{evidence.diagnostic.note}</small>
              </section>
            </div>
          </Window>
          <figure className="agents-map-search">
            <figcaption>
              <span>LIVE MAP SEARCH</span>
              <code>{evidence.map.query}</code>
            </figcaption>
            <ol>
              {evidence.map.results.map((result) => (
                <li key={result.target}>
                  <span>{result.rank}</span>
                  <div>
                    <strong>{result.title}</strong>
                    <code>{result.target}</code>
                  </div>
                </li>
              ))}
            </ol>
            <footer>
              <span>{evidence.map.count} matches found</span>
              <strong>5 returned · deeper results available</strong>
            </footer>
          </figure>
        </div>
        <p className="agents-context__close">{context.close}</p>
      </div>
    </section>
  );
}

/** Project state that survives sessions, providers, and parallel work. */
function ContinuitySection() {
  const { continuity } = AGENTS_CONTENT;
  const evidence = AGENTS_EVIDENCE;
  return (
    <section
      className="agents-continuity"
      id={continuity.id}
      aria-labelledby="continuity-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="05"
          eyebrow={continuity.eyebrow}
          title={continuity.title}
          lead={continuity.paragraphs[0]}
          titleId="continuity-title"
        />
        <div className="agents-continuity__features">
          {continuity.features.map((feature, index) => (
            <article key={feature.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
            </article>
          ))}
        </div>
        <figure className="agents-compiler">
          <figcaption>
            <span>LIVE PROVIDER REGISTRY</span>
            <strong>
              One authored source, compiled for the provider reading it.
            </strong>
          </figcaption>
          <div className="agents-compiler__source">
            <span>AUTHORED ONCE</span>
            <code>project/instructions.md</code>
          </div>
          <div className="agents-compiler__line" aria-hidden="true">
            <span>compile</span>
          </div>
          <div className="agents-compiler__outputs">
            {PROVIDER_OUTPUTS.map((provider) => (
              <article key={provider.name}>
                <div
                  className="agents-provider-mark"
                  style={{
                    "--provider-mask": `url("${provider.mask}")`,
                  } as CSSProperties}
                >
                  <img
                    src={provider.mark}
                    alt=""
                    width={26}
                    height={26}
                    decoding="async"
                  />
                </div>
                <span>{provider.name}</span>
                <code>{provider.file}</code>
              </article>
            ))}
          </div>
        </figure>
        <div className="agents-continuity__evidence">
          <article className="agents-worktree-card">
            <header>
              <span>WORKTREE IDENTITY · LIVE</span>
              <Badge tone="success" dot>running</Badge>
            </header>
            <dl>
              <div>
                <dt>id</dt>
                <dd>
                  <code>{evidence.worktree.id}</code>
                </dd>
              </div>
              <div>
                <dt>branch</dt>
                <dd>
                  <code>{evidence.worktree.branch}</code>
                </dd>
              </div>
              <div>
                <dt>root</dt>
                <dd>
                  <code>{evidence.worktree.root}</code>
                </dd>
              </div>
              <div>
                <dt>site</dt>
                <dd>
                  <code>{evidence.worktree.site}:{evidence.worktree.port}</code>
                </dd>
              </div>
              <div>
                <dt>resources</dt>
                <dd>
                  <code>{evidence.worktree.resources}</code>
                </dd>
              </div>
            </dl>
          </article>
          <article className="agents-await-card">
            <header>
              <span>FLEET CONDITION · LIVE</span>
              <Badge tone="success" dot>met</Badge>
            </header>
            <div className="agents-await-card__condition">
              <span>wait until</span>
              <strong>{evidence.await.condition}</strong>
            </div>
            <code>{evidence.await.branch}</code>
            <dl>
              <div>
                <dt>met</dt>
                <dd>{evidence.await.met}</dd>
              </div>
              <div>
                <dt>tip</dt>
                <dd>
                  <code>{evidence.await.tip.slice(0, 12)}</code>
                </dd>
              </div>
            </dl>
            <footer>{evidence.await.hint}</footer>
          </article>
        </div>
        <p className="agents-marginalia">{continuity.close}</p>
      </div>
    </section>
  );
}

/** Exact-commit Proof, including the physical stale-state demonstration. */
function ProofSection() {
  const { proof } = AGENTS_CONTENT;
  const evidence = AGENTS_EVIDENCE.proof;
  return (
    <section
      className="agents-proof"
      id={proof.id}
      aria-labelledby="proof-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="06"
          eyebrow={proof.eyebrow}
          title={proof.title}
          titleId="proof-title"
        />
        <div className="agents-proof__intro agents-prose">
          {proof.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <div
          className="agents-proof-demo"
          data-proof-demo
          data-proof-state="current"
        >
          <header>
            <div>
              <span>PROOF CURRENCY · ENGINE RULE REPLAY</span>
              <strong>
                Change the tree. Watch the evidence stop applying.
              </strong>
            </div>
            <button type="button" data-proof-toggle aria-pressed="false">
              <span data-proof-toggle-current>Introduce one visible edit</span>
              <span data-proof-toggle-stale>Restore the exact tree</span>
            </button>
          </header>
          <div className="agents-proof-demo__body">
            <section className="agents-proof-demo__change">
              <span>VISIBLE TREE</span>
              <div className="agents-code-line">
                <i>71</i>
                <code>&lt;main id=&quot;main&quot;&gt;</code>
              </div>
              <div className="agents-code-line">
                <i>72</i>
                <code>&nbsp;&nbsp;&lt;AgentsHero /&gt;</code>
              </div>
              <div className="agents-code-line agents-code-line--edit">
                <i>73</i>
                <code>+ &lt;ProofNote state=&quot;stale&quot; /&gt;</code>
              </div>
              <div className="agents-code-line">
                <i>74</i>
                <code>&lt;/main&gt;</code>
              </div>
            </section>
            <section className="agents-proof-demo__receipt">
              <span>RECORDED PROOF</span>
              <dl>
                <div>
                  <dt>branch</dt>
                  <dd>
                    <code>{evidence.branch}</code>
                  </dd>
                </div>
                <div>
                  <dt>commit</dt>
                  <dd>
                    <code>{evidence.commit}</code>
                  </dd>
                </div>
                <div>
                  <dt>change</dt>
                  <dd>{evidence.files}</dd>
                </div>
                <div>
                  <dt>standards</dt>
                  <dd>{evidence.standards}</dd>
                </div>
              </dl>
            </section>
          </div>
          <div
            className="agents-proof-demo__status"
            aria-live="polite"
            data-proof-live
          >
            <div data-proof-current>
              <span>✓ PROOF CURRENT</span>
              <strong>{evidence.currentSummary}</strong>
              <small>Valid next action: report the Proof line.</small>
            </div>
            <div data-proof-stale>
              <span>! PROOF STALE</span>
              <strong>{evidence.staleSummary}</strong>
              <small>
                Valid next action: commit the final tree, then run{" "}
                <code>discern done</code> again.
              </small>
            </div>
          </div>
          <footer>
            <code>{evidence.line}</code>
          </footer>
        </div>
        <div className="agents-proof__facts">
          {proof.facts.map((fact) => (
            <article key={fact.title}>
              <h3>{fact.title}</h3>
              <p>{fact.copy}</p>
            </article>
          ))}
        </div>
        <p className="agents-marginalia">{proof.close}</p>
      </div>
    </section>
  );
}

/** Technical success on one side, landing authority on the other. */
function AuthoritySection() {
  const { authority } = AGENTS_CONTENT;
  const evidence = AGENTS_EVIDENCE.authority;
  return (
    <section
      className="agents-authority"
      id={authority.id}
      aria-labelledby="authority-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="07"
          eyebrow={authority.eyebrow}
          title={authority.title}
          titleId="authority-title"
        />
        <div className="agents-authority__intro agents-prose">
          {authority.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <strong>{authority.maxim}</strong>
        </div>
        <figure className="agents-boundary-figure">
          <figcaption>CHECKS AND AUTHORITY ARE DIFFERENT FACTS</figcaption>
          <div className="agents-boundary-figure__checks">
            <span>TECHNICAL STATE</span>
            <strong>Proof valid</strong>
            <ul>
              <li>exact commit named</li>
              <li>declared checks passed</li>
              <li>artifact observation reported</li>
            </ul>
          </div>
          <div className="agents-boundary-figure__divider" aria-hidden="true">
            <span>≠ permission</span>
          </div>
          <div className="agents-boundary-figure__authority">
            <span>AUTHORITY STATE · CAPTURED HERE</span>
            <strong>{evidence.state}</strong>
            <dl>
              <div>
                <dt>standing scope</dt>
                <dd>
                  <code>{evidence.standingScope}</code>
                </dd>
              </div>
              <div>
                <dt>uncovered scope</dt>
                <dd>
                  <code>{evidence.uncoveredScope}</code>
                </dd>
              </div>
              <div>
                <dt>uncovered path</dt>
                <dd>
                  <code>{evidence.uncoveredPath}</code>
                </dd>
              </div>
            </dl>
            <footer>→ {evidence.next}</footer>
          </div>
        </figure>
        <div className="agents-authority__states">
          {authority.states.map((state, index) => (
            <article key={state.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{state.title}</h3>
              <p>{state.copy}</p>
            </article>
          ))}
        </div>
        <div
          className="agents-relationship"
          aria-label="Authority relationship"
        >
          <div>
            <strong>human</strong>
            <span>direction</span>
          </div>
          <i>→</i>
          <div>
            <strong>agent</strong>
            <span>implementation</span>
          </div>
          <i>→</i>
          <div>
            <strong>project</strong>
            <span>evidence back to human</span>
          </div>
        </div>
        <p className="agents-marginalia">{authority.close}</p>
      </div>
    </section>
  );
}

/** Trust through explicit absences. */
function AbsencesSection() {
  const { absences } = AGENTS_CONTENT;
  return (
    <section
      className="agents-absences"
      id={absences.id}
      aria-labelledby="absences-title"
    >
      <div className="agents-shell">
        <MovementHeader
          number="08"
          eyebrow={absences.eyebrow}
          title={absences.title}
          titleId="absences-title"
        />
        <div className="agents-absences__grid">
          {absences.items.map((item, index) => (
            <article key={item.title}>
              <span>0{index + 1} / ABSENT</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
              {item.title === "A sandbox."
                ? <a href={AGENTS_ROUTES.trust}>Read the trust boundary ↗</a>
                : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Evaluation handoff and the result-shaped end of the page. */
function NextActionsSection() {
  const { next } = AGENTS_CONTENT;
  return (
    <section className="agents-next" id={next.id} aria-labelledby="next-title">
      <div className="agents-shell">
        <MovementHeader
          number="09"
          eyebrow={next.eyebrow}
          title={next.title}
          titleId="next-title"
        />
        <div className="agents-next__intro agents-prose">
          {next.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}
          </p>)}
          <nav aria-label="Machine references">
            <a href={AGENTS_ROUTES.machineGuide}>Read the machine guide</a>
            <a href={AGENTS_ROUTES.mcp}>Inspect the MCP tools</a>
            <a href={AGENTS_ROUTES.schema}>Review the result schema</a>
          </nav>
        </div>
        <article className="agents-evaluate" id="evaluate">
          <header>
            <div>
              <span>EVALUATION INSTRUCTION</span>
              <h3>{next.instructionTitle}</h3>
            </div>
            <button type="button" data-copy-instruction>
              <span data-copy-label>Copy instruction</span>
              <span aria-hidden="true">⌘C</span>
            </button>
          </header>
          <pre data-copy-source><code>{EVALUATION_INSTRUCTION}</code></pre>
          <footer>
            <strong>{next.close}</strong>
            <span aria-live="polite" data-copy-status />
          </footer>
        </article>
        <div className="agents-result-close">
          <div className="agents-result-close__meta">
            <span>PAGE RESULT</span>
            <Badge tone="success" dot>ok</Badge>
          </div>
          <pre><code>{CLOSING_ENVELOPE}</code></pre>
        </div>
        <div className="agents-final">
          <span aria-hidden="true">◮</span>
          <h2>{next.finalTitle}</h2>
          <p>{next.signature}</p>
        </div>
      </div>
    </section>
  );
}

/** Shared site chrome around the bespoke campaign composition. */
function AgentsPage() {
  return (
    <div className="agents-page">
      <SkipLink href="#main">Skip to content</SkipLink>
      <AgentsMasthead />
      <main id="main">
        <AgentsHero />
        <RecognitionSection />
        <ErgonomicsSection />
        <ContextSection />
        <ContinuitySection />
        <ProofSection />
        <AuthoritySection />
        <AbsencesSection />
        <NextActionsSection />
      </main>
      <SiteFooter
        className="agents-footer"
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description={AGENTS_CONTENT.next.signature}
        groups={[
          {
            title: "Machine routes",
            links: [
              { label: "agents.md", href: AGENTS_ROUTES.plaintext },
              { label: "Machine guide", href: AGENTS_ROUTES.machineGuide },
              { label: "MCP and results", href: AGENTS_ROUTES.mcp },
              { label: "Result schema", href: AGENTS_ROUTES.schema },
            ],
          },
          {
            title: "Exact boundaries",
            links: [
              { label: "Trust and data", href: AGENTS_ROUTES.trust },
              { label: "Human homepage", href: AGENTS_ROUTES.home },
              { label: "Source repository", href: GITHUB },
              { label: "License", href: LICENSE },
            ],
          },
        ]}
        legal={
          <span>
            This page as Markdown: ~{AGENTS_MARKDOWN_TOKEN_ESTIMATE}{" "}
            tokens. Your context was considered in the making of this page.
          </span>
        }
        meta="© 2026 Jack Webb-Heller"
      />
    </div>
  );
}

/** Render the /agents composition for static serving. */
export function renderAgents(): string {
  return pageDocument({
    source: "agents.tsx",
    sourceComment: "Hello. The version you want is /agents.md",
    title: AGENTS_TITLE,
    description: AGENTS_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "agents.css"],
    scripts: ["agents.js"],
    body: renderToStaticMarkup(<AgentsPage />),
  });
}
