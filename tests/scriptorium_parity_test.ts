/**
 * The scriptorium's parity guard: the annotated render — the studio's editing
 * surface — is pinned to the committed canon pages. Markers must strip back to
 * the plain render byte for byte, survive canonical formatting without
 * changing it, cover every canon entry, and the syntax-level enumeration must
 * agree with the evaluated registries (scripts/feature_registry.ts,
 * scripts/practice_registry.ts, scripts/glossary_registry.ts,
 * scripts/brand/claims.ts) on exactly which entries exist. Any drift here
 * means the editor is showing something the canon does not say.
 */

import { assert, assertEquals } from "@std/assert";
import {
  MARK_CLOSE,
  MARK_OPEN,
  MARK_SEP,
  markerAnnotator,
  parseRefToken,
  refToken,
  setProseAnnotator,
  slugify,
  stripAnnotationMarkers,
} from "../scripts/scriptorium/annotation.ts";
import {
  fieldLeaves,
  openRegistryProject,
  registryEntries,
} from "../scripts/scriptorium/registry_ast.ts";
import { fieldSpecFor } from "../scripts/scriptorium/fields.ts";
import { REPO_ROOT } from "../scripts/scriptorium/root.ts";
import {
  allBenefitEntries,
  allFeatureNodes,
  BENEFIT_CANON,
  renderFeatureCanonBenefitsDoc,
  renderFeatureCanonDoc,
  renderFeatureCanonPlainDoc,
} from "../scripts/feature_registry.ts";
import {
  PRACTICE_CANON,
  renderPracticeCanonDoc,
  renderPracticePublicDoc,
} from "../scripts/practice_registry.ts";
import { GLOSSARY, renderGlossaryDoc } from "../scripts/glossary_registry.ts";
import { CLAIMS } from "../scripts/brand/claims.ts";
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
    id: "feature-canon-benefits",
    rel: "project/map/_internal/feature-canon-benefits.md",
    render: renderFeatureCanonBenefitsDoc,
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

Deno.test("every declared field resolves to studio semantics that fit its literal", () => {
  const project = openRegistryProject(REPO_ROOT);
  for (const entry of registryEntries(project, REPO_ROOT)) {
    for (const leaf of fieldLeaves(entry)) {
      const spec = fieldSpecFor(entry.registry, entry.kind, leaf.path);
      assert(
        spec !== undefined,
        `${entry.registry} ${entry.id} · ${leaf.path}: the studio has no semantics for this field`,
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

Deno.test("the syntax enumeration and the evaluated registries agree on ids", () => {
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
      ...BENEFIT_CANON.map((cluster) => cluster.id),
      ...allBenefitEntries().map(({ entry }) => entry.id),
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
