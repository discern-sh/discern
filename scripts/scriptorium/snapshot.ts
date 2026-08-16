/**
 * The scriptorium's evaluated view of the canon: every page rendered by the
 * real renderers with annotation markers installed, plus the structured data
 * the studio surfaces — entries, the citation web, the lint patterns, the
 * guard roster, and the standards the canons feed.
 *
 * The server runs this module as a fresh subprocess per refresh, so a
 * just-patched registry is re-imported from disk with no stale module cache,
 * and a registry that fails to evaluate takes down one snapshot run rather
 * than the studio.
 */

import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { markerAnnotator, setProseAnnotator, slugify } from "./annotation.ts";
import { REPO_ROOT } from "./root.ts";
import {
  allBenefitEntries,
  allFeatureNodes,
  BENEFIT_CANON,
  type BenefitCluster,
  type BenefitEntry,
  FEATURE_CANON_BENEFITS_PAGE_REL,
  FEATURE_CANON_PAGE_REL,
  FEATURE_CANON_PLAIN_PAGE_REL,
  type FeatureNode,
  PLAIN_GENERAL_JARGON,
  plainPolicedTerms,
  renderFeatureCanonBenefitsDoc,
  renderFeatureCanonDoc,
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
import { renderBrandDoc } from "../brand_registry.ts";
import { CANONICAL_SETS, REGISTRY_ATLAS_PAGE_REL } from "../canonical_sets.ts";
import { plainReadingGrade } from "../plain_reading_grade_lib.ts";
import { formatMarkdownText } from "../../src/lib/tidy_format.ts";
import { readFrontmatterBlock } from "../../src/lib/frontmatter.ts";

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

/** A cross-reference to another canon entry or an out-of-studio label. */
export interface CitationRef {
  /** Present when the target is a studio entry the reader can navigate to. */
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

/** A serialized lint pattern the studio applies as-you-type. */
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

/** Everything the studio knows about the canon at one instant. */
export interface Snapshot {
  readonly pages: readonly SnapshotPage[];
  readonly entries: readonly SnapshotEntry[];
  readonly lint: {
    readonly retired: readonly LintPattern[];
    readonly plainPoliced: readonly LintPattern[];
  };
  readonly guards: readonly RegistryGuards[];
  readonly standards: readonly StandardReading[];
}

/** The set ids the five prose registries carry in the meta-registry. */
const REGISTRY_SET_IDS: Readonly<Record<string, string>> = {
  feature: "feature-canon",
  benefit: "benefit-canon",
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
    BENEFIT_CANON.map((cluster) => [cluster.id, cluster.title]),
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
  for (const { cluster, entry } of allBenefitEntries()) {
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
  for (const tenet of PRACTICE_CANON) {
    const from = { registry: "practice", slug: tenet.id, label: tenet.title };
    for (const id of tenet.mechanisms) cite("feature", id, from, "mechanisms");
    for (const id of tenet.yields) cite("benefit", id, from, "yields");
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
      { field: "hints", refs: (node.hints ?? []).map((label) => ({ label })) },
    ].filter((citation) => citation.refs.length > 0),
    inward: inwardOf("feature", node.id),
    claimsCarried: [...(carried.get(node.id) ?? [])].toSorted(),
  });
  for (const { node, depth, parent } of allFeatureNodes()) {
    push(featureEntry(node, depth === 0 ? "pillar" : "node", parent));
  }

  const clusterEntry = (cluster: BenefitCluster): SnapshotEntry => ({
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
    cluster: BenefitCluster,
    entry: BenefitEntry,
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
  for (const cluster of BENEFIT_CANON) {
    push(clusterEntry(cluster));
    for (const entry of cluster.benefits) push(benefitEntry(cluster, entry));
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
  // The atlas is read-only in the studio, and re-rendering it would resolve
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
        "feature-canon-benefits",
        FEATURE_CANON_BENEFITS_PAGE_REL,
        renderFeatureCanonBenefitsDoc(),
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
    "feature-canon-benefits": "Benefit canon",
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

/** The five registries' guard rosters, straight from the meta-registry. */
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
    // The studio degrades to valueless readings when the config is unreadable.
  }
  return readings;
}

/** Assemble the complete snapshot. */
export async function buildSnapshot(): Promise<Snapshot> {
  return {
    pages: await buildPages(),
    entries: buildEntries(),
    lint: buildLint(),
    guards: buildGuards(),
    standards: await buildStandards(),
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(await buildSnapshot()));
}
