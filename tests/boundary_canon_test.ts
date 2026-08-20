/**
 * The Boundary Canon is one closed set with three derived projections. These
 * guards hold registry identity, evidence reachability, claim references,
 * renderer enrollment, and the two LLM-export reading paths to that authority.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  allBoundaryProjections,
  BOUNDARIES,
  type ProductBoundary,
  type ProjectedBoundary,
  renderBoundaryCanonDoc,
} from "../scripts/brand/boundaries.ts";
import { CLAIMS, type ClaimSlug } from "../scripts/brand/claims.ts";
import { parseDiscernToml } from "../src/lib/toml_render.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Assert one string set contains no duplicates. */
function assertUnique(label: string, values: readonly string[]): void {
  assertEquals(new Set(values).size, values.length, `${label} must be unique`);
}

/** Assert one value is a stable, citable registry id. */
function assertKebabId(label: string, value: string): void {
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    `${label} ${value} must be kebab-case`,
  );
}

/** The boundary authority widened to its declared optional-field shape. */
function boundaries(): readonly ProductBoundary<ClaimSlug>[] {
  return BOUNDARIES as readonly ProductBoundary<ClaimSlug>[];
}

Deno.test("Boundary Canon records and projections form one valid closed set", async () => {
  const records = boundaries();
  const projections = allBoundaryProjections();
  assert(records.length > 0, "the Boundary Canon has no records");
  for (const kind of ["refusal", "identity", "absence"] as const) {
    assert(
      projections.some((projection) => projection.kind === kind),
      `the Boundary Canon has no ${kind} projections`,
    );
  }

  assertUnique("boundary ids", records.map((boundary) => boundary.id));
  assertUnique("boundary titles", records.map((boundary) => boundary.title));
  assertUnique(
    "projection ids",
    projections.map((projection) => projection.id),
  );
  assertUnique(
    "projection titles",
    projections.map((projection) => projection.title),
  );
  assertUnique(
    "boundary and projection ids",
    [
      ...records.map((boundary) => boundary.id),
      ...projections.map((projection) => projection.id),
    ],
  );

  const claimSlugs = new Set(Object.keys(CLAIMS));
  for (const boundary of records) {
    assertKebabId("boundary id", boundary.id);
    assertEquals(boundary.title, boundary.title.trim());
    assertEquals(boundary.scope, boundary.scope.trim());
    assert(
      boundary.refusals !== undefined ||
        boundary.identities !== undefined ||
        boundary.absences !== undefined,
      `${boundary.id} has no projection`,
    );
    if (boundary.stability !== "enduring") {
      assert(
        boundary.horizon !== undefined && boundary.horizon.trim().length > 0,
        `${boundary.id}: ${boundary.stability} boundaries need a horizon`,
      );
    }
    for (const claim of boundary.claims ?? []) {
      assert(
        claimSlugs.has(claim),
        `${boundary.id} cites unknown claim ${claim}`,
      );
    }
    for (const evidence of boundary.evidence) {
      assertEquals(evidence.path, evidence.path.trim());
      assertEquals(evidence.summary, evidence.summary.trim());
      const info = await Deno.stat(join(REPO_ROOT, evidence.path)).catch(
        () => undefined,
      );
      assert(
        info?.isFile === true,
        `${boundary.id}: evidence path does not exist: ${evidence.path}`,
      );
    }
  }

  for (const projection of projections) {
    assertKebabId("projection id", projection.id);
    assertEquals(projection.title, projection.title.trim());
    assertEquals(projection.statement, projection.statement.trim());
    assert(
      records.some((boundary) => boundary.id === projection.boundaryId),
      `${projection.id} cites unknown boundary ${projection.boundaryId}`,
    );
  }
  for (const kind of ["refusal", "identity", "absence"] as const) {
    const orders = projections
      .filter((projection) => projection.kind === kind)
      .map((projection) => projection.order);
    assertEquals(
      orders,
      Array.from({ length: orders.length }, (_, index) => index + 1),
      `${kind} projection order must be contiguous from one`,
    );
  }
});

Deno.test("Boundary Canon renderer enrolls every projection and record in authority order", () => {
  const rendered = renderBoundaryCanonDoc();
  const projections = allBoundaryProjections();
  const kinds: readonly ProjectedBoundary["kind"][] = [
    "refusal",
    "identity",
    "absence",
  ];
  let previousSection = -1;
  for (const kind of kinds) {
    const section = kind === "refusal"
      ? "## Behavioral refusals"
      : kind === "identity"
      ? "## Mistaken identities"
      : "## Structural absences";
    const sectionIndex = rendered.indexOf(section);
    assert(
      sectionIndex > previousSection,
      `${section} is missing or out of order`,
    );
    previousSection = sectionIndex;

    let previousProjection = sectionIndex;
    for (const projection of projections.filter((item) => item.kind === kind)) {
      const marker = `Projection: \`${projection.id}\``;
      const projectionIndex = rendered.indexOf(marker);
      assert(
        projectionIndex > previousProjection,
        `${projection.id} is missing or out of ${kind} authority order`,
      );
      previousProjection = projectionIndex;
    }
  }

  let previousRecord = rendered.indexOf("## Boundary records");
  for (const boundary of boundaries()) {
    const marker = `### ${boundary.id}`;
    const recordIndex = rendered.indexOf(marker);
    assert(
      recordIndex > previousRecord,
      `${boundary.id} is missing or out of record order`,
    );
    previousRecord = recordIndex;
  }
});

Deno.test("Boundary Canon sits between trust context and claims in both export scopes", async () => {
  const text = await Deno.readTextFile(join(REPO_ROOT, "discern.toml"));
  const raw = parseDiscernToml(text).raw;
  const scopes = raw.scopes as Record<string, { paths?: unknown }>;
  const boundaryPath = "${map.dir}_internal/brand/boundary-canon.md";
  const trustPath = "${map.dir}00-orientation/trust-and-data.md";
  const claimsPath = "${map.dir}_internal/brand/claims-and-evidence.md";
  for (const name of ["big-picture", "commercial-picture"] as const) {
    const paths = scopes[name]?.paths;
    assert(
      Array.isArray(paths) && paths.every((path) => typeof path === "string"),
      `[scopes.${name}].paths must be a string array`,
    );
    const trust = paths.indexOf(trustPath);
    const boundary = paths.indexOf(boundaryPath);
    const claims = paths.indexOf(claimsPath);
    assert(
      trust >= 0 && boundary > trust && claims > boundary,
      `[scopes.${name}] must read trust → Boundary Canon → claims`,
    );
  }
});
