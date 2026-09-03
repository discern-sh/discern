/** Structural guard for repository identity and installer command literals. */

import { assertEquals } from "@std/assert";
import {
  REPOSITORY_LITERAL_POLICIES,
  type RepositoryLiteralKind,
} from "../scripts/repository_literal_policy.ts";
import {
  DISCERN_RAW_INSTALL_URL,
  DISCERN_REPOSITORY_SLUG,
  INSTALL_COMMAND,
} from "../src/shared/product_identity.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { join } from "@std/path";

const PERMANENT_REPOSITORY_SLUG = ["discern-sh", "discern"].join("/");
const RAW_INSTALL_COMMAND = `curl -fsSL ${DISCERN_RAW_INSTALL_URL} | sh`;
const KINDS: readonly RepositoryLiteralKind[] = [
  "current-repository",
  "permanent-repository",
  "canonical-install-command",
  "raw-install-command",
];

/** Count exact non-overlapping occurrences of one literal. */
function occurrences(source: string, literal: string): number {
  return source.split(literal).length - 1;
}

/** Project one file's literal counts through the identity authorities. */
function literalCounts(source: string): Record<RepositoryLiteralKind, number> {
  const comparable = source.replaceAll("\\/", "/");
  return {
    "current-repository": occurrences(comparable, DISCERN_REPOSITORY_SLUG),
    "permanent-repository": occurrences(
      comparable,
      PERMANENT_REPOSITORY_SLUG,
    ),
    "canonical-install-command": occurrences(comparable, INSTALL_COMMAND),
    "raw-install-command": occurrences(comparable, RAW_INSTALL_COMMAND),
  };
}

/** Find GitHub-discern slugs that bypass both known transition identities. */
function unknownRepositorySlugs(source: string): string[] {
  const comparable = source.replaceAll("\\/", "/");
  const found = new Set<string>();
  for (
    const pattern of [
      /github(?:usercontent)?\.com[/:]([A-Za-z0-9_.-]+\/discern)\b/gu,
      /--repo\s+([A-Za-z0-9_.-]+\/discern)\b/gu,
      /DISCERN_REPO:-([A-Za-z0-9_.-]+\/discern)\b/gu,
    ]
  ) {
    for (const match of comparable.matchAll(pattern)) {
      const slug = match[1];
      if (
        slug !== undefined && slug !== DISCERN_REPOSITORY_SLUG &&
        slug !== PERMANENT_REPOSITORY_SLUG
      ) {
        found.add(slug);
      }
    }
  }
  return [...found].sort();
}

Deno.test("repository and installer literals stay inside their authority or exact declared projections", async () => {
  const files = await structuralGuardScope({
    guard:
      "tests/repository_identity_guard_test.ts#repository-install-literals",
    universe: "authored-text",
    narrow: {
      reason:
        "Immutable ADRs and private planning evidence are not compiled or public identity consumers.",
      include: (rel) =>
        !rel.startsWith("project/map/_adr/") &&
        !rel.startsWith("project/map/_private/"),
    },
  });
  const policies = new Map(
    REPOSITORY_LITERAL_POLICIES.map((policy) => [policy.path, policy]),
  );
  assertEquals(
    policies.size,
    REPOSITORY_LITERAL_POLICIES.length,
    "literal-policy paths are unique",
  );
  const observed = new Set<string>();
  const failures: string[] = [];
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    const unknown = unknownRepositorySlugs(source);
    if (unknown.length > 0) {
      failures.push(`${rel}: unknown repository slug ${unknown.join(", ")}`);
    }
    const counts = literalCounts(source);
    if (KINDS.every((kind) => counts[kind] === 0)) continue;
    observed.add(rel);
    const policy = policies.get(rel);
    if (policy === undefined) {
      failures.push(`${rel}: identity literal has no declared projection`);
      continue;
    }
    for (const kind of KINDS) {
      if (
        DISCERN_REPOSITORY_SLUG === PERMANENT_REPOSITORY_SLUG &&
        (kind === "current-repository" || kind === "permanent-repository")
      ) {
        if (kind === "current-repository") {
          const expected = (policy.counts["current-repository"] ?? 0) +
            (policy.counts["permanent-repository"] ?? 0);
          if (counts[kind] !== expected) {
            failures.push(
              `${rel}: merged repository count ${
                counts[kind]
              }, expected ${expected}`,
            );
          }
        }
        continue;
      }
      const expected = policy.counts[kind] ?? 0;
      if (counts[kind] !== expected) {
        failures.push(
          `${rel}: ${kind} count ${counts[kind]}, expected ${expected}`,
        );
      }
    }
  }
  for (const policy of REPOSITORY_LITERAL_POLICIES) {
    if (!observed.has(policy.path)) {
      failures.push(`${policy.path}: stale literal policy (${policy.reason})`);
    }
  }
  assertEquals(
    failures,
    [],
    `repository/install authority drift:\n${failures.join("\n")}`,
  );
});

Deno.test("the repository guard catches future identities and undeclared commands", () => {
  const futureSlug = ["future-owner", "discern"].join("/");
  assertEquals(
    unknownRepositorySlugs(`https://github.com/${futureSlug}/releases`),
    [futureSlug],
  );
  const counts = literalCounts(`${INSTALL_COMMAND}\n${RAW_INSTALL_COMMAND}\n`);
  assertEquals(counts["canonical-install-command"], 1);
  assertEquals(counts["raw-install-command"], 1);
});
