import { assertEquals, assertStringIncludes } from "@std/assert";
import { MCP_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import {
  PUBLIC_SCHEMA_PUBLICATIONS,
  renderPublicSchemaReference,
  replacePublicSchemaReference,
} from "../src/shared/public_schemas.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const mcpReferencePath =
  `${REPO_AUTHORED_PATHS.map}/70-reference/mcp-and-results.md`;
const mcpReference = await Deno.readTextFile(mcpReferencePath);

Deno.test("the public MCP tools table is total over the result-contract registry", () => {
  const documented = [
    ...mcpReference.matchAll(/^\| `(discern_[a-z_]+)`\s+\|/gm),
  ]
    .map((match) => match[1] ?? "")
    .sort();
  const registered = MCP_RESULT_CONTRACTS.map((contract) => contract.mcpTool)
    .sort();
  assertEquals(documented, registered);
});

Deno.test("every MCP tool name is a search alias on the public contract page", () => {
  const frontmatter = mcpReference.split("\n---\n")[0] ?? "";
  for (const contract of MCP_RESULT_CONTRACTS) {
    assertStringIncludes(frontmatter, `  - ${contract.mcpTool}`);
  }
});

Deno.test("the public contract reference publishes every versioned schema", () => {
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    assertStringIncludes(mcpReference, publication.id);
    assertStringIncludes(mcpReference, publication.artifactPath);
  }
});

Deno.test("the public schema reference matches the registry generator (run `deno task codegen`)", async () => {
  const generated = replacePublicSchemaReference(
    mcpReference,
    renderPublicSchemaReference(),
  );
  assertEquals(
    mcpReference,
    await canonicalGeneratedMarkdown(mcpReferencePath, generated),
    `${REPO_AUTHORED_PATHS.mapRel}/70-reference/mcp-and-results.md is stale — run \`deno task codegen\``,
  );
});
