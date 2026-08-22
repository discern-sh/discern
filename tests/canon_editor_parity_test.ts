/**
 * Canon Editor's parity guard: the annotated render and the editing
 * surface — is pinned to the committed canon pages. Markers must strip back to
 * the plain render byte for byte, survive canonical formatting without
 * changing it, cover every canon entry, and the syntax-level enumeration must
 * agree with the evaluated registries (scripts/feature_registry.ts,
 * scripts/brand/demand.ts, scripts/practice_registry.ts,
 * scripts/glossary_registry.ts, scripts/brand/claims.ts) on exactly which
 * entries exist. Any drift here
 * means the editor is showing something the canon does not say.
 */

import { assert, assertEquals } from "@std/assert";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MARK_SEP,
  markerAnnotator,
  parseRefToken,
  PROSE_REGISTRY_NAMES,
  refToken,
  setProseAnnotator,
  slugify,
  stripAnnotationMarkers,
} from "../scripts/canon_editor/annotation.ts";
import {
  fieldLeaves,
  openRegistryProject,
  PROSE_REGISTRIES,
  registryEntries,
} from "../scripts/canon_editor/registry_ast.ts";
import {
  fieldSpecFor,
  type PickerSource,
} from "../scripts/canon_editor/fields.ts";
import {
  buildPickerCatalog,
  WRITABLE_PICKER_SOURCES,
} from "../scripts/canon_editor/pickers.ts";
import { REPO_ROOT } from "../scripts/canon_editor/root.ts";
import {
  AGENT_BENEFIT_CANON,
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
  HUMAN_BENEFIT_CANON,
  renderFeatureCanonAgentBenefitsDoc,
  renderFeatureCanonDoc,
  renderFeatureCanonHumanBenefitsDoc,
  renderFeatureCanonPlainDoc,
  SURFACE_SETS,
} from "../scripts/feature_registry.ts";
import { liveFeatureSurfaceMembers } from "../scripts/feature_surface_catalog.ts";
import {
  PRACTICE_CANON,
  renderPracticeCanonDoc,
  renderPracticePublicDoc,
} from "../scripts/practice_registry.ts";
import { GLOSSARY, renderGlossaryDoc } from "../scripts/glossary_registry.ts";
import { CLAIMS } from "../scripts/brand/claims.ts";
import { allDemandEntries, DEMAND_CANON } from "../scripts/brand/demand.ts";
import { HINTS } from "../src/shared/hints.ts";
import { renderBrandDoc } from "../scripts/brand_registry.ts";
import { formatMarkdownText } from "../src/lib/tidy_format.ts";

interface CanonPage {
  readonly id: string;
  /** The committed page's repo-relative path — names the file for the tidy pass. */
  readonly rel: string;
  readonly render: () => string;
}

const PAGES: readonly CanonPage[] = [
  {
    id: "feature-canon",
    rel: "project/map/_internal/feature-canon.md",
    render: renderFeatureCanonDoc,
  },
  {
    id: "feature-canon-plain",
    rel: "project/map/_internal/feature-canon-plain.md",
    render: renderFeatureCanonPlainDoc,
  },
  {
    id: "feature-canon-human-benefits",
    rel: "project/map/_internal/feature-canon-human-benefits.md",
    render: renderFeatureCanonHumanBenefitsDoc,
  },
  {
    id: "feature-canon-agent-benefits",
    rel: "project/map/_internal/feature-canon-agent-benefits.md",
    render: renderFeatureCanonAgentBenefitsDoc,
  },
  {
    id: "demand-canon",
    rel: "project/map/_internal/brand/demand-canon.md",
    render: () => renderBrandDoc("demand-canon"),
  },
  {
    id: "practice-canon",
    rel: "project/map/_internal/practice-canon.md",
    render: renderPracticeCanonDoc,
  },
  {
    id: "the-practice",
    rel: "project/map/00-orientation/the-practice.md",
    render: renderPracticePublicDoc,
  },
  {
    id: "glossary",
    rel: "project/map/00-orientation/glossary.md",
    render: renderGlossaryDoc,
  },
  {
    id: "claims-and-evidence",
    rel: "project/map/_internal/brand/claims-and-evidence.md",
    render: () => renderBrandDoc("claims-and-evidence"),
  },
];

/** Render every canon page, with or without the marker annotator installed. */
function renderPages(annotated: boolean): Map<string, string> {
  if (annotated) setProseAnnotator(markerAnnotator);
  try {
    return new Map(PAGES.map((page) => [page.id, page.render()]));
  } finally {
    setProseAnnotator(undefined);
  }
}

const PLAIN = renderPages(false);
const ANNOTATED = renderPages(true);

/** Every ref token carried by a page's markers, in emission order. */
function refTokensIn(text: string): string[] {
  const pattern = new RegExp(`${MARK_OPEN}([^${MARK_SEP}]*)${MARK_SEP}`, "g");
  return [...text.matchAll(pattern)].map((match) => match[1] ?? "");
}

Deno.test("the annotated render strips back to the plain render, byte for byte", () => {
  for (const page of PAGES) {
    const plain = PLAIN.get(page.id) ?? "";
    const annotated = ANNOTATED.get(page.id) ?? "";
    for (const marker of [MARK_OPEN, MARK_SEP, MARK_CLOSE]) {
      assert(
        !plain.includes(marker),
        `${page.id}: the plain render leaks an annotation marker`,
      );
    }
    assert(
      annotated !== plain,
      `${page.id}: the annotator never reached this renderer`,
    );
    assertEquals(
      stripAnnotationMarkers(annotated),
      plain,
      `${page.id}: stripping the markers must restore the committed render`,
    );
  }
});

Deno.test("markers survive canonical formatting without changing it", async () => {
  for (const page of PAGES) {
    const plain = await formatMarkdownText(
      page.rel,
      PLAIN.get(page.id) ?? "",
    );
    const annotated = await formatMarkdownText(
      page.rel,
      ANNOTATED.get(page.id) ?? "",
    );
    assertEquals(
      stripAnnotationMarkers(annotated),
      plain,
      `${page.id}: markers changed the canonical formatting`,
    );
  }
});

Deno.test("every canon entry surfaces at least one annotated span", () => {
  const seen = new Set<string>();
  for (const page of PAGES) {
    for (const token of refTokensIn(ANNOTATED.get(page.id) ?? "")) {
      const ref = parseRefToken(token);
      assert(ref !== undefined, `unparseable ref token: ${token}`);
      seen.add(`${ref.registry}:${ref.entry}`);
      assertEquals(refToken(ref), token, "ref tokens round-trip losslessly");
    }
  }
  const project = openRegistryProject(REPO_ROOT);
  for (const entry of registryEntries(project, REPO_ROOT)) {
    assert(
      seen.has(`${entry.registry}:${entry.slug}`),
      `${entry.registry} ${entry.id} renders no annotated span — the editor cannot reach it`,
    );
  }
});

Deno.test("every declared field resolves to editor semantics that fit its literal", () => {
  const project = openRegistryProject(REPO_ROOT);
  for (const entry of registryEntries(project, REPO_ROOT)) {
    for (const leaf of fieldLeaves(entry)) {
      const spec = fieldSpecFor(entry.registry, entry.kind, leaf.path);
      assert(
        spec !== undefined,
        `${entry.registry} ${entry.id} · ${leaf.path}: the editor has no semantics for this field`,
      );
      if (spec.edit === "prose") {
        assert(
          leaf.kind === "string" || leaf.kind === "template",
          `${entry.registry} ${entry.id} · ${leaf.path}: prose semantics over a ${leaf.kind} literal`,
        );
      }
      if (spec.edit === "list") {
        assert(
          leaf.kind === "string-array" || leaf.kind === "array" ||
            leaf.kind === "computed",
          `${entry.registry} ${entry.id} · ${leaf.path}: list semantics over a ${leaf.kind} literal`,
        );
      }
      assert(
        spec.edit !== "nested",
        `${entry.registry} ${entry.id} · ${leaf.path}: a nested spec cannot terminate a leaf`,
      );
    }
  }
});

Deno.test("picker write-back and option handlers stay in two-way parity", async () => {
  const project = openRegistryProject(REPO_ROOT);
  const used = new Set<PickerSource>();
  const literalUses = new Set<PickerSource>();
  for (const entry of registryEntries(project, REPO_ROOT)) {
    for (const leaf of fieldLeaves(entry)) {
      const spec = fieldSpecFor(entry.registry, entry.kind, leaf.path);
      if (spec?.edit !== "list" || spec.write !== "picker") continue;
      used.add(spec.picker);
      if (leaf.kind === "string-array") literalUses.add(spec.picker);
    }
  }
  assertEquals(
    [...used].toSorted(),
    [...WRITABLE_PICKER_SOURCES].toSorted(),
    "every picker-marked field has one option handler, and no handler is orphaned",
  );
  assertEquals(
    [...literalUses].toSorted(),
    [...WRITABLE_PICKER_SOURCES].toSorted(),
    "every picker handler reaches at least one writable string-array literal",
  );

  const catalog = new Map(
    (await buildPickerCatalog()).map((entry) => [entry.source, entry.options]),
  );
  const values = (source: (typeof WRITABLE_PICKER_SOURCES)[number]): string[] =>
    (catalog.get(source) ?? []).map((option) => option.value);
  assertEquals(
    values("feature-node"),
    allFeatureNodes().map(({ node }) => node.id),
  );
  assertEquals(
    values("benefit-entry"),
    allHumanBenefitEntries().map(({ entry }) => entry.id),
  );
  assertEquals(values("claim"), Object.keys(CLAIMS));
  assertEquals(values("hint"), Object.keys(HINTS));
  const surfaceMembers = await liveFeatureSurfaceMembers();
  assertEquals(
    values("surface"),
    SURFACE_SETS.flatMap((set) =>
      surfaceMembers[set].map((member) => `${set}:${member}`)
    ),
  );
  for (const [source, options] of catalog) {
    const optionValues = options.map((option) => option.value);
    assertEquals(
      new Set(optionValues).size,
      optionValues.length,
      `${source} picker values are unique`,
    );
  }
});

Deno.test("the syntax enumeration and the evaluated registries agree on ids", () => {
  assertEquals(
    PROSE_REGISTRIES.map((registry) => registry.name),
    [...PROSE_REGISTRY_NAMES],
    "the registry specifications cover the name authority in reading order",
  );
  const project = openRegistryProject(REPO_ROOT);
  const byRegistry = new Map<string, string[]>();
  for (const entry of registryEntries(project, REPO_ROOT)) {
    const ids = byRegistry.get(entry.registry) ?? [];
    ids.push(entry.slug);
    byRegistry.set(entry.registry, ids);
  }
  assertEquals(
    byRegistry.get("feature")?.toSorted(),
    allFeatureNodes().map(({ node }) => node.id).toSorted(),
  );
  assertEquals(
    byRegistry.get("benefit")?.toSorted(),
    [
      ...HUMAN_BENEFIT_CANON.map((cluster) => cluster.id),
      ...allHumanBenefitEntries().map(({ entry }) => entry.id),
    ].toSorted(),
  );
  assertEquals(
    byRegistry.get("agent-benefit")?.toSorted(),
    [
      ...AGENT_BENEFIT_CANON.map((cluster) => cluster.id),
      ...allAgentBenefitEntries().map(({ entry }) => entry.id),
    ].toSorted(),
  );
  assertEquals(
    byRegistry.get("demand")?.toSorted(),
    [
      ...DEMAND_CANON.map((territory) => territory.id),
      ...allDemandEntries().map(({ entry }) => entry.id),
    ].toSorted(),
  );
  assertEquals(
    byRegistry.get("practice")?.toSorted(),
    PRACTICE_CANON.map((tenet) => tenet.id).toSorted(),
  );
  assertEquals(
    byRegistry.get("glossary")?.toSorted(),
    GLOSSARY.map((entry) => slugify(entry.term)).toSorted(),
  );
  assertEquals(
    byRegistry.get("claims")?.toSorted(),
    Object.keys(CLAIMS).toSorted(),
  );
});
