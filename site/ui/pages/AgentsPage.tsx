import { MarketingLayout } from "../layouts/MarketingLayout.tsx";
import { SiteFooter } from "../components/SiteFooter.tsx";
import { SiteHeader } from "../components/SiteHeader.tsx";
/** The public /agents campaign page, rendered to static HTML by site/build.ts. */

import type { CSSProperties } from "react";
import { Badge, Button, Kicker } from "discern-design-system/react";
import {
  PROVIDER_TRADEMARK_NOTICE,
  providerBrandSilhouette,
  PROVIDERS,
} from "../../../src/lib/providers.ts";
import { AGENT_NAMES } from "../../../src/shared/agent_catalogue.ts";
import { AGENTS_DESCRIPTION, AGENTS_TITLE, DISCERN_MARK } from "../../brand.ts";
import {
  AGENTS_CONTENT,
  AGENTS_EVIDENCE,
  AGENTS_ROUTES,
  CLOSING_ENVELOPE,
  EVALUATION_INSTRUCTION,
} from "../../page-src/agents-content.ts";
import { renderDocument } from "../Document.tsx";
import {
  DISCERN_REPOSITORY_URL,
  repositoryBlobUrl,
} from "../../../src/shared/brand.ts";

const GITHUB = DISCERN_REPOSITORY_URL;
const LICENSE = repositoryBlobUrl("LICENSE");

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
      brandMark={<span className="agents-masthead__mark">{DISCERN_MARK}</span>}
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
            href={AGENTS_ROUTES.machineGuide}
          >
            llms.txt
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

/** The opening card: the claim, and the agent's account rendered as a profile. */
function AgentsHero() {
  const { hero } = AGENTS_CONTENT;
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
              <a href={AGENTS_ROUTES.machineGuide}>
                Open <code>/llms.txt</code>.
              </a>
            </p>
          </div>
          <aside
            className="agents-profile"
            aria-label="The agent's user profile"
          >
            <header>
              <span>{hero.profile.label}</span>
              <Badge tone="success" dot>{hero.profile.status}</Badge>
            </header>
            <div className="agents-profile__identity">
              <span className="agents-profile__avatar" aria-hidden="true">
                {DISCERN_MARK}
              </span>
              <div>
                <strong>{hero.profile.name}</strong>
                <span>{hero.profile.role}</span>
              </div>
            </div>
            <dl>
              {hero.profile.fields.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
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

/** The explicit workflow, shown as the "did you mean" every developer knows. */
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
        <figure className="agents-terminal">
          <div className="agents-terminal__chrome" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>terminal</span>
          </div>
          <pre><code>{`$ ${refusal.command}\n${refusal.lines.join("\n")}`}</code></pre>
          <figcaption>{ergonomics.terminalCaption}</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Context economy, itemised like a till bill. */
function ContextSection() {
  const { context } = AGENTS_CONTENT;
  const { bill } = AGENTS_EVIDENCE;
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
        <figure className="agents-bill" aria-label="Context, itemised">
          <div className="agents-bill__paper">
            <span className="agents-bill__title">{bill.title}</span>
            <dl>
              {bill.items.map(([item, cost]) => (
                <div key={item}>
                  <dt>{item}</dt>
                  <dd>{cost}</dd>
                </div>
              ))}
              <div className="agents-bill__total">
                <dt>{bill.total[0]}</dt>
                <dd>{bill.total[1]}</dd>
              </div>
            </dl>
          </div>
        </figure>
        <p className="agents-context__meter">{context.meter}</p>
      </div>
    </section>
  );
}

/** Project memory that outlives sessions, compiled per provider. */
function ContinuitySection() {
  const { continuity } = AGENTS_CONTENT;
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
        <figure className="agents-compiler">
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
          <figcaption>{continuity.compilerCaption}</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** Exact completion, issued the way certificates always have been. */
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
        <figure className="agents-certificate">
          <div className="agents-certificate__paper">
            <span className="agents-certificate__mark" aria-hidden="true">
              {DISCERN_MARK}
            </span>
            <span className="agents-certificate__title">Proof</span>
            <strong className="agents-certificate__stamp">gate passed</strong>
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
                <dd>
                  <code>{evidence.files}</code>
                </dd>
              </div>
              <div>
                <dt>standards</dt>
                <dd>
                  <code>{evidence.standards}</code>
                </dd>
              </div>
            </dl>
            <small>{evidence.smallPrint}</small>
          </div>
          <figcaption>{proof.certificateCaption}</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** A green gate is not permission, shown as the review box every dev knows. */
function AuthoritySection() {
  const { authority } = AGENTS_CONTENT;
  const { review } = authority;
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
          lead={authority.paragraphs[0]}
          titleId="authority-title"
        />
        <figure className="agents-review" aria-label="Landing review state">
          <span className="agents-review__label">{review.label}</span>
          <div className="agents-review__row agents-review__row--pass">
            <i aria-hidden="true">✓</i>
            <strong>{review.checks}</strong>
          </div>
          <div className="agents-review__row agents-review__row--pending">
            <i aria-hidden="true">●</i>
            <strong>{review.pending}</strong>
            <span>{review.pendingNote}</span>
          </div>
          <div className="agents-review__action">
            <button type="button" disabled>{review.action}</button>
          </div>
        </figure>
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
              {"link" in item
                ? (
                  <a href={AGENTS_ROUTES[item.link.href]}>
                    {item.link.label}
                  </a>
                )
                : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The page turns to the human: one instruction to hand their agent. */
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
          <p className="agents-result-close__note">{next.plaintextNote}</p>
        </div>
        <div className="agents-final">
          <span aria-hidden="true">{DISCERN_MARK}</span>
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
      <MarketingLayout
        header={<AgentsMasthead />}
        footer={
          <SiteFooter
            className="agents-footer"
            brand={<DiscernName />}
            brandMark={
              <span className="agents-footer__mark">{DISCERN_MARK}</span>
            }
            brandTypeface="mono"
            brandMarkTreatment="plain"
            description={AGENTS_CONTENT.next.signature}
            groups={[
              {
                title: "Machine routes",
                links: [
                  { label: "llms.txt", href: AGENTS_ROUTES.machineGuide },
                  { label: "Quickstart", href: AGENTS_ROUTES.quickstart },
                  { label: "MCP and results", href: AGENTS_ROUTES.mcp },
                  { label: "Result schema", href: AGENTS_ROUTES.schema },
                ],
              },
              {
                title: "Exact boundaries",
                links: [
                  { label: "Trust and data", href: AGENTS_ROUTES.trust },
                  { label: "Canonical glossary", href: AGENTS_ROUTES.glossary },
                  {
                    label: "Supported providers",
                    href: AGENTS_ROUTES.providers,
                  },
                  { label: "Human homepage", href: AGENTS_ROUTES.home },
                  { label: "Source repository", href: GITHUB },
                  { label: "License", href: LICENSE },
                ],
              },
            ]}
            legal={
              <span className="agents-footer__legal">
                Machine-readable orientation lives at{" "}
                <a href={AGENTS_ROUTES.machineGuide}>
                  <code>/llms.txt</code>
                </a>.<br />
                {PROVIDER_TRADEMARK_NOTICE}
              </span>
            }
            meta={
              <span className="agents-footer__meta">
                © 2026 Jack Webb-Heller
              </span>
            }
          />
        }
      >
        <AgentsHero />
        <RecognitionSection />
        <ErgonomicsSection />
        <ContextSection />
        <ContinuitySection />
        <ProofSection />
        <AuthoritySection />
        <AbsencesSection />
        <NextActionsSection />
      </MarketingLayout>
    </div>
  );
}

/** Render the /agents composition for static serving. */
export function renderAgents(): string {
  return renderDocument({
    source: "site/ui/pages/AgentsPage.tsx",
    sourceComment: "Hello. Machine-readable orientation lives at /llms.txt",
    title: AGENTS_TITLE,
    description: AGENTS_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "agents.css"],
    scripts: ["discern.js", "agents.js"],
    children: <AgentsPage />,
  });
}
