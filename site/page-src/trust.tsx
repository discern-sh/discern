/** The concise /trust bridge from public claims to inspectable evidence. */

import { renderToStaticMarkup } from "react-dom/server";
import {
  Button,
  Kicker,
  SiteFooter,
  SiteHeader,
  SkipLink,
} from "discern-design-system/react";
import type { ClaimSlug } from "../../scripts/brand/claims.ts";
import { DISCERN_MARK, TRUST_DESCRIPTION, TRUST_TITLE } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { DISCERN_REPOSITORY_URL } from "../../src/shared/brand.ts";

const GITHUB = DISCERN_REPOSITORY_URL;

/** One public claim group and the exact reader destinations that carry scope. */
export interface TrustEvidenceGroup {
  readonly claims: readonly ClaimSlug[];
  readonly title: string;
  readonly summary: string;
  readonly links: readonly { label: string; href: string }[];
}

/** Typed bridge: every material trust statement names its claims authority. */
export const TRUST_EVIDENCE = [
  {
    claims: ["no-model-inside", "local-logbook"],
    title: "Local, with the boundary stated",
    summary:
      "discern is a local deterministic program. It contains no AI model, needs no API key, and makes no network requests of its own. Release checking opens a browser or uses an authorized agent tool; the application payload contains only the running version number. Clone-local reminders record handoffs, without establishing update availability. Checking and installing follow the actions you requested. Committed managed_version records project adoption without reporting what teammates have installed. Its Logbook keeps bounded metadata on the machine; your coding agent, project commands, and chosen integrations retain their own network and permission boundaries.",
    links: [
      { label: "Local control", href: "/docs/understand/local-control" },
      {
        label: "Platforms and providers",
        href: "/docs/reference/platforms-and-providers",
      },
    ],
  },
  {
    claims: ["proof-exact-tree", "gate-grants-no-authority"],
    title: "Evidence has an exact scope",
    summary:
      "The Gate runs the checks a project declares. Proof ties a passing result to the exact clean commit it covered and keeps checkpoint judgments visibly declared. Green does not certify correctness or security, grant authority, land a change, or release it.",
    links: [
      { label: "How Proof works", href: "/docs/understand/proof" },
      {
        label: "Proof and checkpoint formats",
        href: "/docs/reference/proof-and-checkpoint-formats",
      },
    ],
  },
  {
    claims: ["map-mechanically-checked", "runs-on-itself"],
    title: "The working account is open to inspection",
    summary:
      "discern's coding agents maintain a Map of the codebase they work in. The Gate checks its links, anchors, live command examples, audience boundaries, metadata, and Skill references. Because discern is developed under its own practice, the Map is a live internal-use exhibit—not independent validation.",
    links: [
      { label: "Inspect the live Map", href: "/map" },
      {
        label: "Understand instructions, Skills, and Maps",
        href: "/docs/understand/instructions-skills-and-map",
      },
    ],
  },
] as const satisfies readonly TrustEvidenceGroup[];

/** Render the product name used in shared header and footer brand slots. */
function DiscernName() {
  return <span className="trust-brand-name">discern</span>;
}

/** Shared public navigation around the bounded trust gateway. */
function TrustHeader() {
  return (
    <SiteHeader
      className="trust-header"
      brand={<DiscernName />}
      brandMark={DISCERN_MARK}
      brandTypeface="mono"
      brandMarkTreatment="plain"
      navLabel="Trust"
      navItems={[
        { label: "Home", href: "/" },
        { label: "Manual", href: "/docs" },
        { label: "Live Map", href: "/map" },
        { label: "Source", href: GITHUB },
      ]}
      actions={
        <Button href="/docs/start/evaluate-discern" variant="primary">
          Evaluate discern
        </Button>
      }
      sticky
      variant="campaign"
    />
  );
}

/** One evidence group, kept short and routed to the authority for conditions. */
function EvidenceGroup({ group, index }: {
  readonly group: TrustEvidenceGroup;
  readonly index: number;
}) {
  const titleId = `trust-evidence-${index + 1}`;
  return (
    <article className="trust-evidence" aria-labelledby={titleId}>
      <span className="trust-evidence__index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <h2 id={titleId}>{group.title}</h2>
      <p>{group.summary}</p>
      <ul aria-label={`Evidence for ${group.title}`}>
        {group.links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The complete bridge: three bounded claims, then exact operational homes. */
function TrustPage() {
  return (
    <div className="trust-page">
      <SkipLink className="trust-skip" href="#main">Skip to content</SkipLink>
      <TrustHeader />
      <main id="main">
        <header className="trust-hero">
          <Kicker>Trust and evidence</Kicker>
          <h1>Confidence you can inspect.</h1>
          <p>
            discern does not ask you to treat a green light as a blank cheque.
            It gives each claim a boundary, each completed change exact
            evidence, and each landing a separate authority check.
          </p>
          <div className="trust-hero__actions">
            <Button href="/map" variant="primary">Inspect the live Map</Button>
            <Button href="/docs/understand/local-control" variant="secondary">
              Read the exact boundaries
            </Button>
          </div>
        </header>

        <section className="trust-evidence-list" aria-label="Trust evidence">
          {TRUST_EVIDENCE.map((group, index) => (
            <EvidenceGroup
              key={group.claims.join("-")}
              group={group}
              index={index}
            />
          ))}
        </section>

        <aside
          className="trust-reference"
          aria-labelledby="trust-reference-title"
        >
          <Kicker>Exact contracts</Kicker>
          <h2 id="trust-reference-title">
            Follow the question, not the claim.
          </h2>
          <p>
            The manual carries the complete security, data, permission, file,
            provider, and limitation details. These are the stable places to
            inspect before putting discern into a project.
          </p>
          <ul>
            <li>
              <a href="/docs/understand/local-control">
                Security, data, and limitations
              </a>
            </li>
            <li>
              <a href="/docs/reference/files-and-ownership">
                Files and write ownership
              </a>
            </li>
            <li>
              <a href="/docs/reference/platforms-and-providers">
                Provider permissions and prerequisites
              </a>
            </li>
            <li>
              <a href="/docs/reference/licenses">Licenses and source terms</a>
            </li>
          </ul>
        </aside>
      </main>
      <SiteFooter
        className="trust-footer"
        brand={<DiscernName />}
        brandMark={DISCERN_MARK}
        brandTypeface="mono"
        brandMarkTreatment="plain"
        description="Inspect the evidence. Keep the decision."
        groups={[
          {
            title: "Evidence",
            links: [
              { label: "Live Map", href: "/map" },
              { label: "Project decisions", href: "/docs/decisions" },
              { label: "Source repository", href: GITHUB },
            ],
          },
          {
            title: "Manual",
            links: [
              {
                label: "Evaluate discern",
                href: "/docs/start/evaluate-discern",
              },
              { label: "Proof", href: "/docs/understand/proof" },
              {
                label: "Local control",
                href: "/docs/understand/local-control",
              },
            ],
          },
        ]}
        legal={<a href="/docs/reference/licenses">Licenses</a>}
        meta="© 2026 Jack Webb-Heller"
      />
    </div>
  );
}

/** Render /trust as framework-free static HTML. */
export function renderTrust(): string {
  return pageDocument({
    source: "trust.tsx",
    title: TRUST_TITLE,
    description: TRUST_DESCRIPTION,
    styles: ["fonts.css", "discern.css", "trust.css"],
    scripts: ["discern.js"],
    body: renderToStaticMarkup(<TrustPage />),
  });
}
