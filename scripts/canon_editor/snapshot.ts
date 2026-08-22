/**
 * Canon Editor's evaluated view of the canon: every page rendered by the
 * real renderers with annotation markers installed, plus the structured data
 * the editor surfaces — entries, the citation web, the lint patterns, the
 * guard roster, and the standards the canons feed.
 *
 * The server runs this module as a fresh subprocess per refresh, so a
 * just-patched registry is re-imported from disk with no stale module cache,
 * and a registry that fails to evaluate takes down one snapshot run rather
 * than the editor.
 */

import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { markerAnnotator, setProseAnnotator, slugify } from "./annotation.ts";
import { REPO_ROOT } from "./root.ts";
import {
  AGENT_BENEFIT_CANON,
  type AgentBenefitCluster,
  type AgentBenefitEntry,
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
  FEATURE_CANON_AGENT_BENEFITS_PAGE_REL,
  FEATURE_CANON_HUMAN_BENEFITS_PAGE_REL,
  FEATURE_CANON_PAGE_REL,
  FEATURE_CANON_PLAIN_PAGE_REL,
  type FeatureNode,
  HUMAN_BENEFIT_CANON,
  type HumanBenefitCluster,
  type HumanBenefitEntry,
  PLAIN_GENERAL_JARGON,
  plainPolicedTerms,
  renderFeatureCanonAgentBenefitsDoc,
  renderFeatureCanonDoc,
  renderFeatureCanonHumanBenefitsDoc,
  renderFeatureCanonPlainDoc,
} from "../feature_registry.ts";
import {
  PRACTICE_CANON,
  PRACTICE_CANON_PAGE_REL,
  PRACTICE_PUBLIC_PAGE_REL,
  type PracticeTenet,
  renderPracticeCanonDoc,
  renderPracticePublicDoc,
} from "../practice_registry.ts";
import {
  GLOSSARY,
  renderGlossaryDoc,
  retiredPattern,
  retiredSynonyms,
} from "../glossary_registry.ts";
import { CLAIMS } from "../brand/claims.ts";
import {
  DEMAND_CANON,
  type DemandEntry,
  type DemandTerritory,
} from "../brand/demand.ts";
import { renderBrandDoc } from "../brand_registry.ts";
import { CANONICAL_SETS, REGISTRY_ATLAS_PAGE_REL } from "../canonical_sets.ts";
import { plainReadingGrade } from "../plain_reading_grade_lib.ts";
import { formatMarkdownText } from "../../src/lib/tidy_format.ts";
import { readFrontmatterBlock } from "../../src/lib/frontmatter.ts";
import { buildPickerCatalog, type PickerCatalogEntry } from "./pickers.ts";
import type { ProseRegistry } from "./annotation.ts";

/** One rendered canon page, annotated and canonically formatted. */
export interface SnapshotPage {
  readonly id: string;
  /** Repo-relative path of the committed page this render corresponds to. */
  readonly rel: string;
  readonly title: string;
  /** The formatted, annotated body with any frontmatter stripped for display. */
  readonly body: string;
  /**
   * The complete formatted, annotated text, frontmatter included — stripping
   * its markers yields the exact bytes the committed page should hold.
   */
  readonly full: string;
  /** Whether the page carries annotation spans (the atlas does not). */
  readonly annotated: boolean;
}

/** A cross-reference to another canon entry or an out-of-editor label. */
export interface CitationRef {
  /** Present when the target is an editor entry the reader can navigate to. */
  readonly registry?: string;
  readonly slug?: string;
  readonly label: string;
}

/** One direction of an entry's citation web. */
export interface OutwardCitation {
  readonly field: string;
  readonly refs: readonly CitationRef[];
}

/** An inbound citation: who cites this entry, and through which field. */
export interface InwardCitation {
  readonly registry: string;
  readonly slug: string;
  readonly label: string;
  readonly via: string;
}

/** One canon entry, evaluated. */
export interface SnapshotEntry {
  readonly registry: string;
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly parent?: string;
  /** The entry's own data, child entries pruned. */
  readonly data: Record<string, unknown>;
  readonly outward: readonly OutwardCitation[];
  readonly inward: readonly InwardCitation[];
  /** Public claim slugs this entry carries through citing benefits. */
  readonly claimsCarried?: readonly string[];
}

/** A serialized lint pattern the editor applies as-you-type. */
export interface LintPattern {
  readonly name: string;
  readonly source: string;
  readonly flags: string;
  /** The canonical replacement or plain rendering to suggest. */
  readonly plain: string;
}

/** One registry's guard roster, from the meta-registry. */
export interface RegistryGuards {
  readonly registry: string;
  readonly guards: readonly string[];
}

/** A standard the canons feed, with its recorded limit. */
export interface StandardReading {
  readonly name: string;
  readonly value?: number;
  readonly limit?: number;
  readonly direction?: string;
}

/** Everything the editor knows about the canon at one instant. */
export interface Snapshot {
  readonly pages: readonly SnapshotPage[];
  readonly entries: readonly SnapshotEntry[];
  /** Typed list choices, derived from their live registry authorities. */
  readonly pickers: readonly PickerCatalogEntry[];
  readonly lint: {
    readonly retired: readonly LintPattern[];
    readonly plainPoliced: readonly LintPattern[];
  };
  readonly guards: readonly RegistryGuards[];
  readonly standards: readonly StandardReading[];
}

/** The set ids the prose registries carry in the meta-registry. */
const REGISTRY_SET_IDS: Readonly<Record<ProseRegistry, string>> = {
  feature: "feature-canon",
  benefit: "human-benefit-canon",
  "agent-benefit": "agent-benefit-canon",
  demand: "demand-canon",
  practice: "practice-tenets",
  glossary: "glossary-terms",
  claims: "brand-claims",
};

/** Prune one key off a data object without mutating the registry constant. */
function prune(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

/** The feature-node titles by id, for citation labels. */
function featureTitles(): Map<string, string> {
  return new Map(allFeatureNodes().map(({ node }) => [node.id, node.title]));
}

/** Build the evaluated entry list with the citation web resolved both ways. */
function buildEntries(): SnapshotEntry[] {
  const titles = featureTitles();
  const clusterTitles = new Map(
    HUMAN_BENEFIT_CANON.map((cluster) => [cluster.id, cluster.title]),
  );
  const benefitTitles = new Map(
    allHumanBenefitEntries().map(({ entry }) => [entry.id, entry.title]),
  );
  const agentBenefitTitles = new Map(
    allAgentBenefitEntries().map(({ entry }) => [entry.id, entry.title]),
  );
  const inward = new Map<string, InwardCitation[]>();
  const carried = new Map<string, Set<string>>();
  const cite = (
    targetRegistry: string,
    targetSlug: string,
    from: { registry: string; slug: string; label: string },
    via: string,
  ): void => {
    const key = `${targetRegistry}:${targetSlug}`;
    const list = inward.get(key) ?? [];
    list.push({ ...from, via });
    inward.set(key, list);
  };
  for (const { cluster, entry } of allHumanBenefitEntries()) {
    const from = { registry: "benefit", slug: entry.id, label: entry.title };
    for (const id of entry.drawsOn) {
      cite("feature", id, from, "drawsOn");
      for (const claim of entry.claims ?? []) {
        const set = carried.get(id) ?? new Set<string>();
        set.add(claim);
        carried.set(id, set);
      }
    }
    for (const claim of entry.claims ?? []) {
      cite("claims", claim, from, "claims");
    }
    void cluster;
  }
  for (const { cluster, entry } of allAgentBenefitEntries()) {
    const from = {
      registry: "agent-benefit",
      slug: entry.id,
      label: entry.title,
    };
    for (const id of [...entry.drawsOn, ...(entry.supportedBy ?? [])]) {
      cite(
        "feature",
        id,
        from,
        entry.drawsOn.includes(id) ? "drawsOn" : "supportedBy",
      );
      for (const claim of entry.claims ?? []) {
        const set = carried.get(id) ?? new Set<string>();
        set.add(claim);
        carried.set(id, set);
      }
    }
    for (const claim of entry.claims ?? []) {
      cite("claims", claim, from, "claims");
    }
    void cluster;
  }
  for (const tenet of PRACTICE_CANON) {
    const from = { registry: "practice", slug: tenet.id, label: tenet.title };
    for (const id of tenet.mechanisms) cite("feature", id, from, "mechanisms");
    for (const id of tenet.yields) cite("benefit", id, from, "yields");
    for (const id of tenet.agentYields) {
      cite("agent-benefit", id, from, "agentYields");
    }
  }
  for (const territory of DEMAND_CANON) {
    cite(
      "benefit",
      territory.counterpart,
      {
        registry: "demand",
        slug: territory.id,
        label: territory.title,
      },
      "counterpart",
    );
    for (const entry of territory.entries) {
      const from = { registry: "demand", slug: entry.id, label: entry.title };
      for (const id of entry.answer.benefits ?? []) {
        cite("benefit", id, from, "answer.benefits");
      }
    }
  }

  const entries: SnapshotEntry[] = [];
  const push = (entry: SnapshotEntry): void => {
    entries.push(entry);
  };
  const inwardOf = (registry: string, slug: string): InwardCitation[] =>
    inward.get(`${registry}:${slug}`) ?? [];

  const featureEntry = (
    node: FeatureNode,
    kind: string,
    parent: string | undefined,
  ): SnapshotEntry => ({
    registry: "feature",
    id: node.id,
    slug: node.id,
    title: node.title,
    kind,
    ...(parent === undefined ? {} : { parent }),
    data: prune(node as unknown as Record<string, unknown>, "children"),
    outward: [
      {
        field: "surfaces",
        refs: (node.surfaces ?? []).map((label) => ({ label })),
      },
    ].filter((citation) => citation.refs.length > 0),
    inward: inwardOf("feature", node.id),
    claimsCarried: [...(carried.get(node.id) ?? [])].toSorted(),
  });
  for (const { node, depth, parent } of allFeatureNodes()) {
    push(featureEntry(node, depth === 0 ? "pillar" : "node", parent));
  }

  const clusterEntry = (cluster: HumanBenefitCluster): SnapshotEntry => ({
    registry: "benefit",
    id: cluster.id,
    slug: cluster.id,
    title: cluster.title,
    kind: "cluster",
    data: prune(cluster as unknown as Record<string, unknown>, "benefits"),
    outward: [],
    inward: inwardOf("benefit", cluster.id),
  });
  const benefitEntry = (
    cluster: HumanBenefitCluster,
    entry: HumanBenefitEntry,
  ): SnapshotEntry => ({
    registry: "benefit",
    id: entry.id,
    slug: entry.id,
    title: entry.title,
    kind: "benefit",
    parent: cluster.id,
    data: entry as unknown as Record<string, unknown>,
    outward: [
      {
        field: "drawsOn",
        refs: entry.drawsOn.map((id) => ({
          registry: "feature",
          slug: id,
          label: titles.get(id) ?? id,
        })),
      },
      {
        field: "claims",
        refs: (entry.claims ?? []).map((slug) => ({
          registry: "claims",
          slug,
          label: slug,
        })),
      },
    ].filter((citation) => citation.refs.length > 0),
    inward: inwardOf("benefit", entry.id),
  });
  for (const cluster of HUMAN_BENEFIT_CANON) {
    push(clusterEntry(cluster));
    for (const entry of cluster.benefits) push(benefitEntry(cluster, entry));
  }

  const agentClusterEntry = (
    cluster: AgentBenefitCluster,
  ): SnapshotEntry => ({
    registry: "agent-benefit",
    id: cluster.id,
    slug: cluster.id,
    title: cluster.title,
    kind: "cluster",
    data: prune(cluster as unknown as Record<string, unknown>, "benefits"),
    outward: [],
    inward: inwardOf("agent-benefit", cluster.id),
  });
  const agentBenefitEntry = (
    cluster: AgentBenefitCluster,
    entry: AgentBenefitEntry,
  ): SnapshotEntry => ({
    registry: "agent-benefit",
    id: entry.id,
    slug: entry.id,
    title: entry.title,
    kind: "agent benefit",
    parent: cluster.id,
    data: entry as unknown as Record<string, unknown>,
    outward: [
      {
        field: "drawsOn",
        refs: entry.drawsOn.map((id) => ({
          registry: "feature",
          slug: id,
          label: titles.get(id) ?? id,
        })),
      },
      {
        field: "supportedBy",
        refs: (entry.supportedBy ?? []).map((id) => ({
          registry: "feature",
          slug: id,
          label: titles.get(id) ?? id,
        })),
      },
      {
        field: "hints",
        refs: (entry.hints ?? []).map((label) => ({ label })),
      },
      {
        field: "claims",
        refs: (entry.claims ?? []).map((slug) => ({
          registry: "claims",
          slug,
          label: slug,
        })),
      },
    ].filter((citation) => citation.refs.length > 0),
    inward: inwardOf("agent-benefit", entry.id),
  });
  for (const cluster of AGENT_BENEFIT_CANON) {
    push(agentClusterEntry(cluster));
    for (const entry of cluster.benefits) {
      push(agentBenefitEntry(cluster, entry));
    }
  }

  const territoryEntry = (territory: DemandTerritory): SnapshotEntry => ({
    registry: "demand",
    id: territory.id,
    slug: territory.id,
    title: territory.title,
    kind: "territory",
    data: prune(territory as unknown as Record<string, unknown>, "entries"),
    outward: [{
      field: "counterpart",
      refs: [{
        registry: "benefit",
        slug: territory.counterpart,
        label: clusterTitles.get(territory.counterpart) ??
          territory.counterpart,
      }],
    }],
    inward: inwardOf("demand", territory.id),
  });
  const demandEntry = (
    territory: DemandTerritory,
    entry: DemandEntry,
  ): SnapshotEntry => ({
    registry: "demand",
    id: entry.id,
    slug: entry.id,
    title: entry.title,
    kind: "demand",
    parent: territory.id,
    data: entry as unknown as Record<string, unknown>,
    outward: entry.answer.benefits === undefined ? [] : [{
      field: "answer.benefits",
      refs: entry.answer.benefits.map((id) => ({
        registry: "benefit",
        slug: id,
        label: benefitTitles.get(id) ?? id,
      })),
    }],
    inward: inwardOf("demand", entry.id),
  });
  for (const territory of DEMAND_CANON) {
    push(territoryEntry(territory));
    for (const entry of territory.entries) push(demandEntry(territory, entry));
  }

  const tenetEntry = (tenet: PracticeTenet): SnapshotEntry => ({
    registry: "practice",
    id: tenet.id,
    slug: tenet.id,
    title: tenet.title,
    kind: "tenet",
    data: tenet as unknown as Record<string, unknown>,
    outward: [
      {
        field: "mechanisms",
        refs: tenet.mechanisms.map((id) => ({
          registry: "feature",
          slug: id,
          label: titles.get(id) ?? id,
        })),
      },
      {
        field: "yields",
        refs: tenet.yields.map((id) => ({
          registry: "benefit",
          slug: id,
          label: clusterTitles.get(id) ?? id,
        })),
      },
      {
        field: "agentYields",
        refs: tenet.agentYields.map((id) => ({
          registry: "agent-benefit",
          slug: id,
          label: agentBenefitTitles.get(id) ?? id,
        })),
      },
      {
        field: "upheld",
        refs: Object.values(tenet.upheld).flat().map((key) => ({
          label: String(key),
        })),
      },
    ].filter((citation) => citation.refs.length > 0),
    inward: inwardOf("practice", tenet.id),
  });
  for (const tenet of PRACTICE_CANON) push(tenetEntry(tenet));

  for (const entry of GLOSSARY) {
    push({
      registry: "glossary",
      id: entry.term,
      slug: slugify(entry.term),
      title: entry.term,
      kind: "term",
      data: entry as unknown as Record<string, unknown>,
      outward: [],
      inward: inwardOf("glossary", slugify(entry.term)),
    });
  }

  for (const [slug, claim] of Object.entries(CLAIMS)) {
    push({
      registry: "claims",
      id: slug,
      slug,
      title: claim.title,
      kind: "claim",
      data: claim as unknown as Record<string, unknown>,
      outward: [],
      inward: inwardOf("claims", slug),
    });
  }
  return entries;
}

/** Render every canon page with markers installed, canonically formatted. */
async function buildPages(): Promise<SnapshotPage[]> {
  // The atlas is read-only in the editor, and re-rendering it would resolve
  // every declared set's members (one thunk shells out to git); the committed
  // page is the same bytes without the permissions.
  const atlas = await Deno.readTextFile(
    join(REPO_ROOT, "project", "map", REGISTRY_ATLAS_PAGE_REL),
  );
  setProseAnnotator(markerAnnotator);
  let rendered: readonly [string, string, string, boolean][];
  try {
    rendered = [
      ["feature-canon", FEATURE_CANON_PAGE_REL, renderFeatureCanonDoc(), true],
      [
        "feature-canon-plain",
        FEATURE_CANON_PLAIN_PAGE_REL,
        renderFeatureCanonPlainDoc(),
        true,
      ],
      [
        "feature-canon-human-benefits",
        FEATURE_CANON_HUMAN_BENEFITS_PAGE_REL,
        renderFeatureCanonHumanBenefitsDoc(),
        true,
      ],
      [
        "feature-canon-agent-benefits",
        FEATURE_CANON_AGENT_BENEFITS_PAGE_REL,
        renderFeatureCanonAgentBenefitsDoc(),
        true,
      ],
      [
        "demand-canon",
        join("_internal", "brand", "demand-canon.md"),
        renderBrandDoc("demand-canon"),
        true,
      ],
      [
        "practice-canon",
        PRACTICE_CANON_PAGE_REL,
        renderPracticeCanonDoc(),
        true,
      ],
      [
        "the-practice",
        PRACTICE_PUBLIC_PAGE_REL,
        renderPracticePublicDoc(),
        true,
      ],
      [
        "glossary",
        join("00-orientation", "glossary.md"),
        renderGlossaryDoc(),
        true,
      ],
      [
        "claims-and-evidence",
        join("_internal", "brand", "claims-and-evidence.md"),
        renderBrandDoc("claims-and-evidence"),
        true,
      ],
      ["registry-atlas", REGISTRY_ATLAS_PAGE_REL, atlas, false],
    ];
  } finally {
    setProseAnnotator(undefined);
  }
  const titles: Readonly<Record<string, string>> = {
    "feature-canon": "Feature canon",
    "feature-canon-plain": "The complete feature guide",
    "feature-canon-human-benefits": "Human Benefit Canon",
    "feature-canon-agent-benefits": "Agent Benefit Canon",
    "demand-canon": "Demand canon",
    "practice-canon": "Practice canon",
    "the-practice": "The practice",
    "glossary": "Glossary",
    "claims-and-evidence": "Claims and evidence",
    "registry-atlas": "Registry atlas",
  };
  const pages: SnapshotPage[] = [];
  for (const [id, rel, markdown, annotated] of rendered) {
    const mapRel = join("project", "map", rel);
    const formatted = await formatMarkdownText(mapRel, markdown);
    const body = readFrontmatterBlock(formatted)?.body ?? formatted;
    pages.push({
      id,
      rel: mapRel,
      title: titles[id] ?? id,
      body,
      full: formatted,
      annotated,
    });
  }
  return pages;
}

/** The retired-synonym and plain-register patterns, serialized for the wire. */
function buildLint(): Snapshot["lint"] {
  const retired: LintPattern[] = retiredSynonyms().map(
    ({ term, synonym }) => {
      const pattern = retiredPattern(synonym);
      return {
        name: synonym.phrase,
        source: pattern.source,
        flags: pattern.flags,
        plain: term,
      };
    },
  );
  const plainPoliced: LintPattern[] = [
    ...plainPolicedTerms().map((term) => ({
      name: term.name,
      source: term.matcher.source,
      flags: term.matcher.flags,
      plain: term.plain,
    })),
    ...Object.entries(PLAIN_GENERAL_JARGON).map(([name, row]) => ({
      name,
      source: row.match,
      flags: "i",
      plain: row.plain,
    })),
  ];
  return { retired, plainPoliced };
}

/** The registries' guard rosters, straight from the meta-registry. */
function buildGuards(): RegistryGuards[] {
  const rosters: RegistryGuards[] = [];
  for (const [registry, setId] of Object.entries(REGISTRY_SET_IDS)) {
    const entry = CANONICAL_SETS.find((set) => set.id === setId);
    rosters.push({ registry, guards: entry === undefined ? [] : entry.guards });
  }
  return rosters;
}

/** Read the canon-feeding standards and their limits from discern.toml. */
async function buildStandards(): Promise<StandardReading[]> {
  const readings: StandardReading[] = [
    { name: "plain_reading_grade", value: plainReadingGrade() },
  ];
  try {
    const config = parseToml(
      await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
    ) as Record<string, unknown>;
    const standards = config["standards"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    for (const reading of readings) {
      const declared = standards?.[reading.name];
      if (declared === undefined) continue;
      const limit = declared["limit"];
      const direction = declared["direction"];
      if (typeof limit === "number") {
        Object.assign(reading, { limit });
      }
      if (typeof direction === "string") {
        Object.assign(reading, { direction });
      }
    }
  } catch {
    // The editor degrades to valueless readings when the config is unreadable.
  }
  return readings;
}

/** Assemble the complete snapshot. */
export async function buildSnapshot(): Promise<Snapshot> {
  return {
    pages: await buildPages(),
    entries: buildEntries(),
    pickers: await buildPickerCatalog(),
    lint: buildLint(),
    guards: buildGuards(),
    standards: await buildStandards(),
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await buildSnapshot()));
}
