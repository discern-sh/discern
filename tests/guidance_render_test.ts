/**
 * The pure guidance renderer + currency check (ADR 0034). `renderAgentFiles` is
 * the single source the writer (`compileGuidelines`) and the checker
 * (`checkGuidanceCurrent`) share, so the check agrees with what `discern refresh`
 * writes by construction. Fast: no subprocess.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { compileGuidelines } from "../src/engine/guidelines.ts";
import {
  checkGuidanceCurrent,
  guidanceContext,
  renderAgentFiles,
} from "../src/engine/guidance_render.ts";
import { providerFor } from "../src/lib/providers.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";

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
    assertStringIncludes(
      agents,
      "\n---\n\n# Mine\nA rule.\n",
      "the shipped guidance and user guidance are separated by one Markdown rule",
    );
    assert(agents.includes("A rule."), "the user source is appended");
    assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: every reuse-canonical agent configured alone emits the canonical it reads", async () => {
  const reuseAgents = AGENT_NAMES.filter((name) =>
    providerFor(name)?.guidanceFile.reuseCanonical === true
  );
  assert(
    reuseAgents.length > 0,
    "expected at least one reuse-canonical provider",
  );

  for (const name of reuseAgents) {
    const dir = await scaffold(`["${name}"]`);
    try {
      const provider = providerFor(name);
      assert(provider !== undefined);
      const gf = provider.guidanceFile;
      const files = await renderAgentFiles(dir);
      assertEquals(
        [...files.keys()],
        [gf.path],
        `${name} must render the canonical guidance file it reads`,
      );
      const body = files.get(gf.path);
      assert(body !== undefined);
      assert(
        body.includes("A rule."),
        `${name} canonical guidance should carry the compiled body`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
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

Deno.test("compile converges when [guidance].sources globs the generated files' location", async () => {
  // sources = ["*.md"] matches the root-level markdown the user meant — AND the
  // AGENTS.md/CLAUDE.md the compiler itself writes there. The outputs must be
  // excluded from source resolution: otherwise each refresh embeds the previous
  // compiled body (unbounded growth) and the currency check reads the freshly
  // written file as a new source, reporting `stale` forever — a blocked gate
  // whose prescribed remediation (`discern refresh`) can never clear it.
  const dir = await Deno.makeTempDir({ prefix: "discern-render-test-" });
  try {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[guidance]",
        'agents = ["claude_code", "codex"]',
        'sources = ["*.md"]',
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(join(dir, "guidance.md"), "# Mine\nA rule.\n");

    await compileGuidelines(dir);
    const first = await Deno.readTextFile(join(dir, "AGENTS.md"));
    // Current immediately after a refresh — the self-defeating loop is the bug.
    assertEquals(await checkGuidanceCurrent(dir), []);

    await compileGuidelines(dir);
    const second = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertEquals(second, first, "consecutive refreshes must be byte-identical");
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
  // Bare = schema defaults (branch_prefix agent/, main_branch main, no standards,
  // no resources). Rich = custom branch/main, a standard, and a resource declared.
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
        "[standards.coverage]",
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
    assert(bareBody.includes("branch prefix `agent/`"), "bare branch prefix");
    assert(richBody.includes("branch prefix `wt/`"), "rich branch prefix");
    // The integration branch interpolates too (asserted on the backticked token,
    // since prose line-wrapping may separate it from neighbouring words).
    assert(bareBody.includes("`main`"), "bare integration branch");
    assert(richBody.includes("`trunk`"), "rich integration branch");
    assert(
      !richBody.includes("`main`"),
      "custom main_branch replaces the default",
    );

    // {{#if has_standards}} drops the whole section unless a standard is declared.
    assert(
      !bareBody.includes("## Quality standards"),
      "no inert standard prose",
    );
    assert(
      richBody.includes("## Quality standards"),
      "standard section present",
    );

    // {{#if has_worktree_resources}} gates the resource-lifecycle detail.
    assert(
      !bareBody.includes("per-worktree external"),
      "no inert resource prose",
    );
    assert(
      richBody.includes("per-worktree external"),
      "resource detail present",
    );
    assert(richBody.includes("--resource <name>"), "resource flag documented");

    assert(
      bareBody.includes("explicit user handoff/land request"),
      "acceptance requires an explicit user ask",
    );
    assert(
      bareBody.includes("relay the receipt to your owner and stop"),
      "a green finish routes through the review moment, not straight to landing",
    );
    assert(
      bareBody.includes("call it only once they explicitly ask you to land"),
      "green finish is not treated as permission to accept",
    );
  } finally {
    await Deno.remove(bare, { recursive: true });
    await Deno.remove(rich, { recursive: true });
  }
});

Deno.test("renderAgentFiles: the never-edit sentence names the project's real generated files (config-derived)", async () => {
  // generated_agent_files / materialized_skills_dirs derive from [guidance].agents
  // through the SAME registry renderAgentFiles / materializeSkills write to, so the
  // names base.md prints can never drift from the files actually produced.
  const solo = await Deno.makeTempDir({ prefix: "discern-genfiles-solo-" });
  const multi = await Deno.makeTempDir({ prefix: "discern-genfiles-multi-" });
  try {
    await Deno.writeTextFile(
      join(solo, "discern.toml"),
      '[guidance]\nagents = ["codex"]\n',
    );
    await Deno.writeTextFile(
      join(multi, "discern.toml"),
      '[guidance]\nagents = ["claude_code", "codex", "gemini"]\n',
    );
    const soloBody = (await renderAgentFiles(solo)).get("AGENTS.md");
    const multiBody = (await renderAgentFiles(multi)).get("AGENTS.md");
    assert(soloBody !== undefined && multiBody !== undefined);

    // Solo: codex alone → only its file and skills dir are named. (Anchored on the
    // parenthesised list, not the preceding prose, so a line-wrap can't break it.)
    assert(soloBody.includes("(`AGENTS.md`"), soloBody);
    assert(soloBody.includes("(`.agents/skills`)"), soloBody);
    assert(!soloBody.includes("CLAUDE.md"), "no agent it doesn't generate");

    // Multi: every configured agent's file is named, deduping the shared skills dir
    // (codex + gemini both materialize into .agents/skills).
    assert(
      multiBody.includes("`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`"),
      multiBody,
    );
    assert(
      multiBody.includes("`.claude/skills`, `.agents/skills`"),
      "codex + gemini share .agents/skills — deduped, not listed twice",
    );
    // Config-derived: a different agent set yields a different list.
    assert(soloBody !== multiBody, "the file list tracks [guidance].agents");
  } finally {
    await Deno.remove(solo, { recursive: true });
    await Deno.remove(multi, { recursive: true });
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
        "[standards.coverage]",
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
    assert(body.includes("primary surface"), "states MCP-first");
    assert(
      body.includes("MCP server is **unreachable**"),
      "carries the fallback instruction",
    );
    assert(body.includes("discern_done"), "names the gate as a tool");
    // ...and the de-duplicated content is gone (cut, not relocated twice).
    assert(
      !body.includes("Machine-readable output"),
      "the verbose --json/MCP section is removed",
    );
    assert(
      !body.includes("discern_impact"),
      "the enumerated tool roster is cut",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: every guidance variable is config-driven — no hardcoded value can creep in", async () => {
  // Class guard for "built-in guidance states a discern.toml-configurable value but
  // hardcodes one literal instead of interpolating it" — the bug behind the
  // guidance.sources filename. Driven off the SSOT,
  // guidanceContext's own variable set: every exposed {{var}} MUST have a case here
  // proving its value flows from config into the compiled guidance. A newly exposed
  // var fails until its case is added, and replacing any {{var}} with a hardcoded
  // literal makes that case's render stop tracking config.
  //
  // `expect` is a sentinel that must reach the output.
  // `contextOnly` marks a var no built-in section consumes yet (it exists for the
  // rendered-skill surface — ADR 0102): its case proves the CONTEXT value flows
  // from config, and starts failing the render checks the moment a section adopts
  // it without a real case here.
  const cases: Record<
    string,
    { toml: string; expect?: string; contextOnly?: boolean }
  > = {
    branch_prefix: {
      toml:
        '[project]\nbranch_prefix = "zz-wt/"\n[guidance]\nagents = ["codex"]\n',
      expect: "zz-wt/",
    },
    main_branch: {
      toml:
        '[project]\nmain_branch = "zztrunk"\n[guidance]\nagents = ["codex"]\n',
      expect: "zztrunk",
    },
    docs_dir: {
      toml: '[docs]\ndir = "zz-docs/"\n[guidance]\nagents = ["codex"]\n',
      expect: "zz-docs/",
    },
    todo_path: {
      toml:
        '[project]\ntodo = "zz-ledger.md"\n[guidance]\nagents = ["codex"]\n',
      expect: "zz-ledger.md",
      contextOnly: true,
    },
    skills_dir: {
      toml: '[skills]\ndir = "zz-playbooks"\n[guidance]\nagents = ["codex"]\n',
      expect: "zz-playbooks",
      contextOnly: true,
    },
    recipes_dir: {
      toml: '[recipes]\ndir = "zz-tools"\n[guidance]\nagents = ["codex"]\n',
      expect: "zz-tools",
      contextOnly: true,
    },
    guidance_sources: {
      toml: '[guidance]\nagents = ["codex"]\nsources = ["zz-rules.md"]\n',
      expect: "zz-rules.md",
    },
    generated_agent_files: {
      toml: '[guidance]\nagents = ["codex", "gemini"]\n',
      expect: "GEMINI.md",
    },
    materialized_skills_dirs: {
      toml: '[guidance]\nagents = ["codex", "claude_code"]\n',
      expect: ".claude/skills",
    },
  };

  const renderBody = async (toml: string): Promise<string> => {
    const dir = await Deno.makeTempDir({ prefix: "discern-var-case-" });
    try {
      await Deno.writeTextFile(join(dir, "discern.toml"), toml);
      await Deno.writeTextFile(join(dir, "zz-rules.md"), "# sentinel source\n");
      const body = (await renderAgentFiles(dir)).get("AGENTS.md");
      assert(body !== undefined, `no AGENTS.md rendered for:\n${toml}`);
      return body;
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  };

  // SSOT coverage: the cases must name EXACTLY the context's variables — a new var
  // can't ship without a guard, and a removed one can't leave a dead case behind.
  const probe = await Deno.makeTempDir({ prefix: "discern-var-probe-" });
  try {
    await Deno.writeTextFile(
      join(probe, "discern.toml"),
      '[guidance]\nagents = ["codex"]\n',
    );
    const ctx = guidanceContext(await loadConfig(probe));
    assertEquals(
      Object.keys(cases).sort(),
      Object.keys(ctx.vars).sort(),
      "every guidance {{var}} needs a config-driven case here (and vice versa)",
    );
  } finally {
    await Deno.remove(probe, { recursive: true });
  }

  const baseline = await renderBody('[guidance]\nagents = ["codex"]\n');
  for (const [name, c] of Object.entries(cases)) {
    if (c.contextOnly === true) {
      // Not consumed by any built-in section: prove the context value itself
      // flows from config (the rendered-skill surface reads the same context).
      const dir = await Deno.makeTempDir({ prefix: "discern-var-ctx-" });
      try {
        await Deno.writeTextFile(join(dir, "discern.toml"), c.toml);
        const ctx = guidanceContext(await loadConfig(dir));
        assertEquals(
          ctx.vars[name],
          c.expect,
          `${name}: the configured value must flow into the guidance context`,
        );
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
      continue;
    }
    const body = await renderBody(c.toml);
    assert(
      body !== baseline,
      `${name}: changing its config must change the compiled guidance`,
    );
    if (c.expect !== undefined) {
      assert(
        body.includes(c.expect),
        `${name}: the configured value "${c.expect}" must appear in the guidance`,
      );
    }
  }
});
