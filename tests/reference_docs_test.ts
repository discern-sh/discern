import { assertEquals, assertStringIncludes } from "@std/assert";
import { MCP_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

const mcpReference = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.map}/70-reference/mcp-and-results.md`,
);

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
