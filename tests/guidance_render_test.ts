/**
 * The pure guidance renderer + currency check (ADR 0034). `renderAgentFiles` is
 * the single source the writer (`compileGuidelines`) and the checker
 * (`checkGuidanceCurrent`) share, so the check agrees with what `discern refresh`
 * writes by construction. Fast: no subprocess.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { compileGuidelines } from "../src/engine/guidelines.ts";
import {
  checkGuidanceCurrent,
  renderAgentFiles,
} from "../src/engine/guidance_render.ts";

/** A temp project emitting both providers, with one user guidance source. */
async function scaffold(
  agents = '["claude_code", "codex"]',
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "discern-render-test-" });
  await Deno.writeTextFile(
    join(tmp, "discern.toml"),
    ["[guidance]", `agents = ${agents}`, 'sources = ["guidance.md"]', ""].join(
      "\n",
    ),
  );
  await Deno.writeTextFile(join(tmp, "guidance.md"), "# Mine\nA rule.\n");
  return tmp;
}

Deno.test("renderAgentFiles: AGENTS.md is the full body; CLAUDE.md is the @AGENTS.md pointer", async () => {
  const dir = await scaffold();
  try {
    const files = await renderAgentFiles(dir);
    assertEquals([...files.keys()].sort(), ["AGENTS.md", "CLAUDE.md"]);
    const agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assert(
      agents.startsWith("# Working with the discern harness"),
      "the canonical file opens with the guidance — no banner",
    );
    assert(agents.includes("A rule."), "the user source is appended");
    assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("checkGuidanceCurrent: clean after a compile; flags a hand-edit stale and a delete missing", async () => {
  const dir = await scaffold();
  try {
    await compileGuidelines(dir);
    // Freshly compiled → everything matches what refresh would write.
    assertEquals(await checkGuidanceCurrent(dir), []);

    // Hand-edit AGENTS.md → stale, carrying both expected and actual (for a diff).
    const agentsPath = join(dir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, `${original}\nstray edit\n`);
    const afterEdit = await checkGuidanceCurrent(dir);
    assertEquals(afterEdit.length, 1);
    const stale = afterEdit[0];
    assert(stale !== undefined);
    assertEquals([stale.path, stale.reason], ["AGENTS.md", "stale"]);
    assertEquals(stale.expected, original);
    assert(stale.actual?.includes("stray edit"));

    // Restore, then delete CLAUDE.md → missing (the fresh-checkout state).
    await Deno.writeTextFile(agentsPath, original);
    await Deno.remove(join(dir, "CLAUDE.md"));
    const afterDelete = await checkGuidanceCurrent(dir);
    assertEquals(afterDelete.length, 1);
    const missing = afterDelete[0];
    assert(missing !== undefined);
    assertEquals([missing.path, missing.reason], ["CLAUDE.md", "missing"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("checkGuidanceCurrent: guidance feature off → nothing to render or check", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-render-off-" });
  try {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[features]\nguidance = false\n[guidance]\nagents = ["codex"]\n',
    );
    assertEquals((await renderAgentFiles(dir)).size, 0);
    assertEquals(await checkGuidanceCurrent(dir), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
