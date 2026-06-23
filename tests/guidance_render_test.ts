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

Deno.test("renderAgentFiles: two renders of the same config are byte-identical (deterministic)", async () => {
  // The built-in sections are templated against a context built purely from
  // committed config (ADR 0034), so the compile output cannot vary run-to-run on
  // the same commit — the property the stateless currency check relies on.
  const dir = await scaffold();
  try {
    const a = await renderAgentFiles(dir);
    const b = await renderAgentFiles(dir);
    assertEquals([...a.keys()].sort(), [...b.keys()].sort());
    for (const [path, body] of a) {
      assertEquals(b.get(path), body, `${path} must render identically twice`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: the built-in guidance reflects config (interpolation is real, not cosmetic)", async () => {
  // Bare = schema defaults (branch_prefix agent/, main_branch main, no ratchets,
  // no resources). Rich = custom branch/main, a ratchet, and a resource declared.
  const bare = await Deno.makeTempDir({ prefix: "discern-tmpl-bare-" });
  const rich = await Deno.makeTempDir({ prefix: "discern-tmpl-rich-" });
  try {
    await Deno.writeTextFile(
      join(bare, "discern.toml"),
      '[guidance]\nagents = ["codex"]\n',
    );
    await Deno.writeTextFile(
      join(rich, "discern.toml"),
      [
        "[project]",
        'branch_prefix = "wt/"',
        'main_branch = "trunk"',
        "[guidance]",
        'agents = ["codex"]',
        "[ratchets.coverage]",
        "limit = 80",
        'run = "echo DISCERN_METRIC coverage 80"',
        "[worktree.resources.db]",
        'create = "createdb x"',
        'destroy = "dropdb x"',
        "",
      ].join("\n"),
    );

    const bareBody = (await renderAgentFiles(bare)).get("AGENTS.md");
    const richBody = (await renderAgentFiles(rich)).get("AGENTS.md");
    assert(bareBody !== undefined && richBody !== undefined);
    assert(bareBody !== richBody, "config must change the rendered guidance");

    // {{var}} interpolates the committed values.
    assert(bareBody.includes("prefixed `agent/`"), "bare branch prefix");
    assert(richBody.includes("prefixed `wt/`"), "rich branch prefix");
    // The integration branch interpolates too (asserted on the backticked token,
    // since prose line-wrapping may separate it from neighbouring words).
    assert(bareBody.includes("`main`"), "bare integration branch");
    assert(richBody.includes("`trunk`"), "rich integration branch");
    assert(
      !richBody.includes("`main`"),
      "custom main_branch replaces the default",
    );

    // {{#if has_ratchets}} drops the whole section unless a ratchet is declared.
    assert(!bareBody.includes("## Quality ratchets"), "no inert ratchet prose");
    assert(richBody.includes("## Quality ratchets"), "ratchet section present");

    // {{#if has_worktree_resources}} gates the resource-lifecycle detail.
    assert(
      !bareBody.includes("The git mechanics are generic"),
      "no inert resource prose",
    );
    assert(
      richBody.includes("The git mechanics are generic"),
      "resource detail present",
    );
    assert(richBody.includes("--resource <name>"), "resource flag documented");
  } finally {
    await Deno.remove(bare, { recursive: true });
    await Deno.remove(rich, { recursive: true });
  }
});

Deno.test("checkGuidanceCurrent: a templated, non-default config compiles current (no drift)", async () => {
  // Proves the templated output a refresh writes is exactly what the currency
  // check recomputes — the ADR 0034 invariant, exercised with live interpolation.
  const dir = await Deno.makeTempDir({ prefix: "discern-tmpl-currency-" });
  try {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[project]",
        'branch_prefix = "wt/"',
        "[guidance]",
        'agents = ["claude_code", "codex"]',
        "[ratchets.coverage]",
        "limit = 80",
        'run = "echo hi"',
        "[worktree.resources.db]",
        'create = "createdb x"',
        'destroy = "dropdb x"',
        "",
      ].join("\n"),
    );
    await compileGuidelines(dir);
    assertEquals(await checkGuidanceCurrent(dir), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: base guidance is MCP-first with a CLI fallback (no envelope dump or roster)", async () => {
  const dir = await scaffold();
  try {
    const body = (await renderAgentFiles(dir)).get("AGENTS.md");
    assert(body !== undefined);
    // MCP-first stance + the unreachable-server fallback are present...
    assert(body.includes("Prefer a tool"), "states MCP-first");
    assert(
      body.includes("isn't reachable"),
      "carries the fallback instruction",
    );
    assert(body.includes("discern_finish"), "names the gate as a tool");
    // ...and the de-duplicated content is gone (cut, not relocated twice).
    assert(
      !body.includes("Machine-readable output"),
      "the verbose --json/MCP section is removed",
    );
    assert(
      !body.includes("discern_changed_scopes"),
      "the enumerated tool roster is cut",
    );
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
