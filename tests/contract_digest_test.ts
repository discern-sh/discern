/**
 * The contract digest renders every registered publication as tidy-stable
 * Markdown: pipes stay escaped, code spans stay balanced, tables keep their
 * column count, and the marker splice touches nothing outside its block.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  clip,
  DIGEST_BEGIN,
  DIGEST_END,
  renderContractDigest,
  spliceDigest,
} from "../scripts/contract_digest.ts";
import { EXIT_STATUS_REGISTRY } from "../src/shared/exit_codes.ts";
import { PUBLIC_SCHEMA_PUBLICATIONS } from "../src/shared/public_schemas.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const digest = await renderContractDigest(REPO_ROOT);

/** Count the backticks on one line; an odd count means an open code span. */
function backticks(line: string): number {
  return line.split("`").length - 1;
}

/** Split a table row on its unescaped pipes. */
function cells(line: string): string[] {
  return line.split(/(?<!\\)\|/);
}

Deno.test("the digest covers every registered publication and the exit statuses", () => {
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    assert(
      digest.includes(`\`${publication.artifactPath}\`, policy`),
      `${publication.artifactPath} has no section heading`,
    );
  }
  assertStringIncludes(digest, "CLI exit statuses");
  for (const entry of EXIT_STATUS_REGISTRY) {
    assertStringIncludes(digest, `| ${entry.label} `);
  }
});

Deno.test("the digest is already in the tidy Markdown convention", async () => {
  assertEquals(
    await canonicalGeneratedMarkdown("contract-digest.md", digest),
    digest,
  );
});

Deno.test("every digest line keeps its code spans balanced", () => {
  const open = digest.split("\n").filter((line) => backticks(line) % 2 === 1);
  assertEquals(open, [], "lines with an unclosed code span");
});

Deno.test("every table row keeps its header's column count", () => {
  let headerCells: number | undefined;
  const mismatches: string[] = [];
  for (const line of digest.split("\n")) {
    if (!line.startsWith("|")) {
      headerCells = undefined;
      continue;
    }
    const count = cells(line).length;
    if (headerCells === undefined) {
      headerCells = count;
    } else if (count !== headerCells) {
      mismatches.push(line);
    }
  }
  assertEquals(
    mismatches,
    [],
    "rows whose cell count differs from their header",
  );
});

Deno.test("clip never leaves a code span open and keeps short text intact", () => {
  assertEquals(
    clip("Use `discern_update` when behind", 200),
    "Use `discern_update` when behind",
  );
  const cut = clip(
    "Use `discern_update` when the branch is behind the trunk and re-read the overlap report",
    24,
  );
  assertEquals(backticks(cut) % 2, 0, cut);
  assert(cut.endsWith("…"), cut);
  const inside = clip("Read `discern_update_overlap_report_fields` now", 16);
  assertEquals(backticks(inside) % 2, 0, inside);
});

Deno.test("spliceDigest replaces only the marker block and refuses a document without markers", () => {
  const document =
    `# Review\n\nprose before\n\n${DIGEST_BEGIN}\n\nold digest\n\n${DIGEST_END}\n\nprose after\n`;
  const spliced = spliceDigest(document, "# New digest\n\n| a |\n| --- |\n");
  assertStringIncludes(spliced, "prose before\n\n" + DIGEST_BEGIN);
  assertStringIncludes(spliced, DIGEST_END + "\n\nprose after\n");
  assertStringIncludes(spliced, "# New digest");
  assert(!spliced.includes("old digest"));
  assertThrows(
    () => spliceDigest("# Review without markers\n", "digest"),
    Error,
    "markers",
  );
});
