/**
 * Guards for provider docs that compensate for intentionally conservative
 * PATH-only setup detection.
 */

import { assertStringIncludes } from "@std/assert";

async function readDoc(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(`../${path}`, import.meta.url));
}

Deno.test("Cursor and Copilot docs signpost IDE-only users to explicit agents config", async () => {
  const cases = [
    {
      path: "docs/60-agent-integrations/cursor.md",
      agent: "cursor",
    },
    {
      path: "docs/60-agent-integrations/github-copilot.md",
      agent: "copilot",
    },
  ];

  for (const c of cases) {
    const doc = await readDoc(c.path);
    assertStringIncludes(doc, "Using the IDE, not the CLI?");
    assertStringIncludes(doc, "[guidance].agents");
    assertStringIncludes(doc, `agents = ["${c.agent}"]`);
    assertStringIncludes(doc, "discern refresh");
    assertStringIncludes(doc, "IDE marker detection");
  }
});
