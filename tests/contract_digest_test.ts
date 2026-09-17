/**
 * The contract digest renders every registered publication as tidy-stable
 * Markdown: pipes stay escaped, code spans stay balanced, tables keep their
 * column count, and the marker splice touches nothing outside its block. What
 * each section says is driven off the registries and the committed artifacts:
 * the policy sentences, the stability markers, the vocabularies, and the
 * resources all come from there, never from a list kept in the renderer.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  clip,
  DIGEST_BEGIN,
  DIGEST_END,
  renderContractDigest,
  spliceDigest,
} from "../scripts/contract_digest.ts";
import {
  isObject,
  type JsonObject,
  type JsonValue,
} from "../scripts/public_contract_compatibility_common.ts";
import { EXIT_STATUS_REGISTRY } from "../src/shared/exit_codes.ts";
import { ERROR_FAILURE_RECOVERY } from "../src/shared/hints.ts";
import {
  compatibilityContract,
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  MANIFEST_STABILITY_FIELD,
  PUBLIC_SCHEMA_PUBLICATIONS,
  PUBLIC_SCHEMA_STABILITY_KEY,
  type PublicSchemaPublication,
  RESULT_SCHEMA_ID,
  STABILITY_TIER_EVOLVING,
} from "../src/shared/public_schemas.ts";
import {
  RESULT_DECISION_VOCABULARIES,
  RESULT_OPEN_VOCABULARIES,
  RESULT_VOCABULARY_KEYWORD,
} from "../src/shared/result.ts";
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

/** Read one committed artifact as the JSON object the digest renders from. */
async function artifactOf(
  publication: PublicSchemaPublication,
): Promise<JsonObject> {
  const value: JsonValue = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, publication.artifactPath)),
  );
  assert(isObject(value), `${publication.artifactPath} is not a JSON object`);
  return value;
}

/** The digest lines from one publication's lettered heading to the next. */
function sectionOf(publication: PublicSchemaPublication): string {
  const heading = `\`${publication.artifactPath}\`, policy`;
  const lines = digest.split("\n");
  const start = lines.findIndex((line) =>
    line.startsWith("## ") && line.includes(heading)
  );
  assert(start >= 0, `${publication.artifactPath} has no section heading`);
  const end = lines.findIndex((line, index) =>
    index > start && line.startsWith("## ")
  );
  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

/** Read an array of JSON objects, skipping other members. */
function records(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Read an all-string JSON array in its recorded order. */
function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.flatMap((member) => typeof member === "string" ? [member] : [])
    : [];
}

/** Render one value the way the digest's code spans do. */
function span(value: JsonValue | undefined): string {
  return `\`${String(value ?? "")}\``;
}

/** Collapse whitespace so a formatted paragraph compares with its source sentence. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Collect the first schema node carrying each vocabulary keyword, independently of the renderer's walk. */
function vocabularyEnums(
  value: JsonValue | undefined,
  found: Map<string, string[]> = new Map(),
): Map<string, string[]> {
  if (Array.isArray(value)) {
    for (const member of value) vocabularyEnums(member, found);
  } else if (isObject(value)) {
    const key = value[RESULT_VOCABULARY_KEYWORD];
    if (typeof key === "string" && !found.has(key)) {
      found.set(key, strings(value.enum));
    }
    for (const child of Object.values(value)) vocabularyEnums(child, found);
  }
  return found;
}

/** Whether a manifest record or schema node carries the evolving tier under `marker`. */
function evolving(node: JsonValue | undefined, marker: string): boolean {
  return isObject(node) && node[marker] === STABILITY_TIER_EVOLVING;
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

Deno.test("every section states its publication's contract and same-major policy verbatim", () => {
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const section = flat(sectionOf(publication));
    assertStringIncludes(
      section,
      flat(publication.contract),
      `${publication.artifactPath} does not state its contract`,
    );
    assertStringIncludes(
      section,
      flat(compatibilityContract(publication.compatibility)),
      `${publication.artifactPath} does not state its policy`,
    );
  }
});

Deno.test("every evolving command, tool, contract, and config section is marked, and no stable one is", async () => {
  const marker = ` (${STABILITY_TIER_EVOLVING})`;
  const expectMarked = (
    section: string,
    name: string,
    isEvolving: boolean,
  ): void => {
    assertEquals(
      section.includes(`${span(name)}${marker}`),
      isEvolving,
      `${name} should ${
        isEvolving ? "" : "not "
      }be marked ${STABILITY_TIER_EVOLVING}`,
    );
  };
  let members = 0;
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const artifact = await artifactOf(publication);
    const section = sectionOf(publication);
    for (const command of records(artifact.commands)) {
      expectMarked(
        section,
        strings(command.path).join(" ") || "(root)",
        evolving(command, MANIFEST_STABILITY_FIELD),
      );
      members += 1;
    }
    for (const tool of records(artifact.tools)) {
      expectMarked(
        section,
        String(tool.name),
        evolving(tool, MANIFEST_STABILITY_FIELD),
      );
      members += 1;
    }
    for (const contract of records(artifact["x-discern-contracts"])) {
      expectMarked(
        section,
        String(contract.verb),
        evolving(contract, MANIFEST_STABILITY_FIELD),
      );
      members += 1;
    }
    if (
      publication.compatibility === CONFIG_SCHEMA_COMPATIBILITY_POLICY &&
      isObject(artifact.properties)
    ) {
      for (const [name, node] of Object.entries(artifact.properties)) {
        expectMarked(
          section,
          `[${name}]`,
          evolving(node, PUBLIC_SCHEMA_STABILITY_KEY),
        );
        members += 1;
      }
    }
  }
  assert(
    members > 0,
    "no artifact carried a command, tool, contract, or section",
  );
});

Deno.test("every open vocabulary an artifact publishes at its root is listed with its members", async () => {
  let listed = 0;
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const artifact = await artifactOf(publication);
    const section = sectionOf(publication);
    for (const [key, vocabulary] of Object.entries(RESULT_OPEN_VOCABULARIES)) {
      if (!Array.isArray(artifact[key])) continue;
      const members = strings(artifact[key]);
      const row = `| ${span(key)} | ${vocabulary.name} | ${
        members.map(span).join(", ")
      } |`;
      if (!flat(section).includes(row)) {
        // A vocabulary whose members carry their own attribute gets its own
        // table under a heading that names the key, one row per member.
        const lines = section.split("\n");
        assert(
          lines.some((line) =>
            line.startsWith("### ") && line.includes(span(key))
          ),
          `${publication.artifactPath} lists ${key} neither as a row nor as a table`,
        );
        for (const member of members) {
          assert(
            lines.some((line) => flat(line).startsWith(`| ${span(member)} |`)),
            `${publication.artifactPath} does not list ${member} of ${key}`,
          );
        }
      }
      listed += 1;
    }
  }
  assert(listed > 0, "no artifact published an open vocabulary at its root");
});

Deno.test("every published error slug carries its recovery class from the hint registry", async () => {
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const artifact = await artifactOf(publication);
    const lines = sectionOf(publication).split("\n");
    for (const [slug, recovery] of Object.entries(ERROR_FAILURE_RECOVERY)) {
      const published = Object.keys(RESULT_OPEN_VOCABULARIES).some((key) =>
        strings(artifact[key]).includes(slug)
      );
      if (!published) continue;
      assert(
        lines.some((line) =>
          flat(line).startsWith(`| ${span(slug)} | ${recovery} |`)
        ),
        `${publication.artifactPath} does not class ${slug} as ${recovery}`,
      );
    }
  }
});

Deno.test("closed vocabularies are listed with the members each artifact carries, and the results section lists the whole registry", async () => {
  const results = PUBLIC_SCHEMA_PUBLICATIONS.find((publication) =>
    publication.id === RESULT_SCHEMA_ID
  );
  assert(results !== undefined, "the result schema is not registered");
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const artifact = await artifactOf(publication);
    const section = flat(sectionOf(publication));
    const carried = vocabularyEnums(artifact);
    for (
      const [key, vocabulary] of Object.entries(RESULT_DECISION_VOCABULARIES)
    ) {
      const members = carried.get(key);
      if (members === undefined && publication !== results) continue;
      assertStringIncludes(
        section,
        flat(
          `| ${span(key)} | ${vocabulary.name} | ${
            (members ?? []).map(span).join(", ")
          } |`,
        ),
        `${publication.artifactPath} does not list ${key} with its members`,
      );
    }
  }
});

Deno.test("every MCP resource and resource template is listed with its kind and URI", async () => {
  let listed = 0;
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const artifact = await artifactOf(publication);
    const resources = records(artifact.resources);
    if (resources.length === 0) continue;
    const section = flat(sectionOf(publication));
    for (const resource of resources) {
      assertStringIncludes(
        section,
        `| ${span(resource.name)} | ${String(resource.kind)} | ${
          span(resource.uri)
        } |`,
        `${publication.artifactPath} does not list ${resource.name}`,
      );
      listed += 1;
    }
  }
  assert(listed > 0, "no manifest carried a resource");
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
