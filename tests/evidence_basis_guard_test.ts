/**
 * Every public claim and every product boundary names an inspectable basis,
 * and every guard in that basis points back.
 *
 * A `guard` entry names a test module under `tests/` whose module-level doc
 * comment carries one `Guards:` line citing `claim:<slug>` or
 * `boundary:<id>`. The forward sweep walks both registries: every basis
 * path exists, a structural claim and a boundary that publishes a refusal
 * each carry at least one guard, and each cited guard file carries the
 * matching citation. The reverse sweep reads every top-level test module's
 * citation and requires the registry row it names, so a test cannot claim
 * to hold something the registry never recorded, and a registry row cannot
 * point at a test that never agreed to hold it.
 *
 * The citation is deliberately authored, never generated: it is the test
 * author's statement that the module exercises the claim or boundary, and
 * the registry summary beside the path says what that exercise proves.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  BOUNDARIES,
  type ProductBoundary,
} from "../scripts/brand/boundaries.ts";
import { CLAIMS, type ClaimSlug } from "../scripts/brand/claims.ts";
import type { Claim, EvidenceSource } from "../scripts/brand/model.ts";
import { fileExists } from "../src/shared/fs_presence.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** One `kind:id` citation parsed from a `Guards:` line. */
interface GuardCitation {
  readonly kind: "claim" | "boundary";
  readonly id: string;
}

const CITATION_TOKEN = /^(claim|boundary):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const CITATION_LINE = /^\s*\*?\s*Guards:\s*(.*?)\s*$/;

/** The first block comment when it precedes every declaration; else nothing. */
function moduleDocBlock(text: string): string | undefined {
  const open = text.indexOf("/**");
  if (open === -1) return undefined;
  const firstDeclaration = text.search(
    /^(?:import|export|const|let|function|Deno\.test)\b/m,
  );
  if (firstDeclaration !== -1 && open > firstDeclaration) return undefined;
  const close = text.indexOf("*/", open);
  return close === -1 ? undefined : text.slice(open, close + 2);
}

/**
 * The citations a test module makes, or the reason its `Guards:` line is
 * malformed. A module with no `Guards:` line cites nothing.
 */
export function guardCitations(
  text: string,
): { citations: GuardCitation[]; error?: string } {
  const block = moduleDocBlock(text);
  if (block === undefined) return { citations: [] };
  const lines = block.split("\n").filter((line) => CITATION_LINE.test(line));
  if (lines.length === 0) return { citations: [] };
  if (lines.length > 1) {
    return { citations: [], error: "carries more than one Guards: line" };
  }
  const payload = (lines[0] ?? "").replace(CITATION_LINE, "$1");
  const citations: GuardCitation[] = [];
  for (const token of payload.split(/[,\s]+/).filter((t) => t !== "")) {
    const match = CITATION_TOKEN.exec(token);
    if (match === null) {
      return {
        citations: [],
        error: `cites '${token}', which is not claim:<slug> or boundary:<id>`,
      };
    }
    citations.push({
      kind: match[1] as GuardCitation["kind"],
      id: match[2] ?? "",
    });
  }
  return { citations };
}

/** Every registry row that names a basis, flattened to one shape. */
interface BasisRow {
  readonly kind: "claim" | "boundary";
  readonly id: string;
  readonly needsGuard: boolean;
  readonly basis: readonly EvidenceSource[];
}

/** Both registries as basis rows: claims need a guard when structural,
 * boundaries when they publish a refusal. */
function basisRows(): BasisRow[] {
  const claims: Readonly<Record<string, Claim>> = CLAIMS;
  const boundaries: readonly ProductBoundary<ClaimSlug>[] = BOUNDARIES;
  return [
    ...Object.entries(claims).map(([id, claim]) => ({
      kind: "claim" as const,
      id,
      needsGuard: claim.evidence.includes("structural"),
      basis: claim.basis,
    })),
    ...boundaries.map((boundary) => ({
      kind: "boundary" as const,
      id: boundary.id,
      needsGuard: boundary.refusals !== undefined,
      basis: boundary.evidence,
    })),
  ];
}

const TEST_MODULES = await structuralGuardScope({
  guard: "tests/evidence_basis_guard_test.ts#guard-citations",
  universe: "authored-ts",
  narrow: {
    reason:
      "Guard evidence names top-level test modules; only they may carry a Guards: citation.",
    include: (rel) => /^tests\/[^/]+_test\.ts$/.test(rel),
  },
});

Deno.test("every claim and boundary basis exists, and enforced rows carry a cited guard", async () => {
  const failures: string[] = [];
  for (const row of basisRows()) {
    const label = `${row.kind}:${row.id}`;
    if (row.basis.length === 0) failures.push(`${label} names no basis`);
    const guards = row.basis.filter((item) => item.kind === "guard");
    if (row.needsGuard && guards.length === 0) {
      failures.push(
        row.kind === "claim"
          ? `${label} is structural but names no guard — add the test that fails when its mechanism regresses`
          : `${label} publishes a refusal but names no guard — add the test that fails when the refusal regresses`,
      );
    }
    for (const item of row.basis) {
      if (!(await fileExists(join(REPO_ROOT, item.path)))) {
        failures.push(`${label} names a missing path: ${item.path}`);
        continue;
      }
      if (item.kind !== "guard") continue;
      if (!/^tests\/[^/]+_test\.ts$/.test(item.path)) {
        failures.push(
          `${label} names a guard outside the top-level test modules: ${item.path}`,
        );
        continue;
      }
      const parsed = guardCitations(
        await Deno.readTextFile(join(REPO_ROOT, item.path)),
      );
      if (parsed.error !== undefined) {
        failures.push(`${item.path} ${parsed.error}`);
        continue;
      }
      const cited = parsed.citations.some((citation) =>
        citation.kind === row.kind && citation.id === row.id
      );
      if (!cited) {
        failures.push(
          `${item.path} is named as a guard for ${label} but its module doc comment has no "Guards: ${label}" citation`,
        );
      }
    }
  }
  assertEquals(
    failures,
    [],
    `the inspectable basis and its guards disagree:\n  ${
      failures.join("\n  ")
    }`,
  );
});

Deno.test("every Guards: citation in a test module names a live row that lists the module", async () => {
  const rows = new Map(
    basisRows().map((row) => [`${row.kind}:${row.id}`, row]),
  );
  const failures: string[] = [];
  let cited = 0;
  for (const rel of TEST_MODULES) {
    const parsed = guardCitations(
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    );
    if (parsed.error !== undefined) {
      failures.push(`${rel} ${parsed.error}`);
      continue;
    }
    for (const citation of parsed.citations) {
      cited += 1;
      const label = `${citation.kind}:${citation.id}`;
      const row = rows.get(label);
      if (row === undefined) {
        failures.push(
          `${rel} cites ${label}, which is not a live registry row`,
        );
        continue;
      }
      const listed = row.basis.some((item) =>
        item.kind === "guard" && item.path === rel
      );
      if (!listed) {
        failures.push(
          `${rel} cites ${label}, but that row does not list it as a guard — add the basis entry with what the test proves`,
        );
      }
    }
  }
  assert(cited > 0, "no test module carries a Guards: citation");
  assertEquals(
    failures,
    [],
    `stale or unrecorded guard citations:\n  ${failures.join("\n  ")}`,
  );
});

Deno.test("the citation parser reads one Guards: line in the module doc comment and nothing else", () => {
  const cited = [
    "/**",
    " * A test module.",
    " *",
    " * Guards: claim:proof-exact-tree, boundary:exact-tree-proof",
    " */",
    'import { x } from "./x.ts";',
  ].join("\n");
  assertEquals(guardCitations(cited), {
    citations: [
      { kind: "claim", id: "proof-exact-tree" },
      { kind: "boundary", id: "exact-tree-proof" },
    ],
  });

  assertEquals(
    guardCitations("/** No citation here. */\nimport {} from 'x';"),
    {
      citations: [],
    },
  );

  const belowCode = [
    'import { x } from "./x.ts";',
    "/** Guards: claim:proof-exact-tree */",
    "function f() {}",
  ].join("\n");
  assertEquals(guardCitations(belowCode), { citations: [] });

  const malformed = "/**\n * Guards: guard:proof-exact-tree\n */\n";
  assert(guardCitations(malformed).error?.includes("guard:proof-exact-tree"));

  const doubled = "/**\n * Guards: claim:a\n * Guards: claim:b\n */\n";
  assert(guardCitations(doubled).error?.includes("more than one"));
});
