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
  agentFileOwnershipPatterns,
  checkGuidanceCurrent,
  guidanceContext,
  matchesGuidanceOwnership,
  renderAgentFiles,
} from "../src/engine/guidance_render.ts";
import { providerFor } from "../src/lib/providers.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";
import { defaultMapPath } from "./engine_helpers.ts";

/** A temp project emitting both providers, with one user guidance source. */
async function scaffold(
  agents = '["claude_code", "codex"]',
): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "discern-render-test-" });
  await Deno.writeTextFile(
    join(tmp, "discern.toml"),
    [
      "[project]",
      `agents = ${agents}`,
      "[guidance]",
      'sources = ["guidance.md"]',
      "",
    ].join("\n"),
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
      agents.startsWith("# Working in this project"),
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

Deno.test("renderAgentFiles: Cursor configuration does not change the generic worktree instructions", async () => {
  const dir = await scaffold('["cursor"]');
  try {
    const files = await renderAgentFiles(dir);
    const agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assertStringIncludes(agents, "from the main checkout");
    assertStringIncludes(agents, "create your isolated worktree");
    assertStringIncludes(agents, "Can't change your working root?");
    assert(
      !/(external file protection|approval-gates external edits)/i.test(agents),
      "compiled guidance must not condition an agent on Cursor's human-visible approval state",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: the compiled file opens as the project's own — [project].name, else the slug", async () => {
  const dir = await scaffold();
  try {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "voyager-2"\nagents = ["codex"]\n[guidance]\nsources = ["guidance.md"]\n',
    );
    let files = await renderAgentFiles(dir);
    let agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assert(
      agents.startsWith("# Working in voyager-2"),
      "with no [project].name the H1 carries the slug verbatim",
    );

    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nname = "Voyager 2"\nslug = "voyager-2"\nagents = ["codex"]\n[guidance]\nsources = ["guidance.md"]\n',
    );
    files = await renderAgentFiles(dir);
    agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assert(
      agents.startsWith("# Working in Voyager 2"),
      "[project].name wins over the slug in the H1",
    );
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

Deno.test("renderAgentFiles: internal map slots never reach provider output", async () => {
  // The provider registry is the enrollment source: a new integration that emits
  // a full agent file joins this guard without adding its name here.
  for (const name of AGENT_NAMES) {
    const dir = await scaffold(`["${name}"]`);
    try {
      for (const [path, body] of await renderAgentFiles(dir)) {
        assert(
          !body.includes("discern:map-regions"),
          `${name} leaked the internal map slot through ${path}`,
        );
      }
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

    // Restore, then delete CLAUDE.md → missing (a not-yet-built or
    // deliberately-untracked tree — tolerated, never blocking).
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
        "[project]",
        'agents = ["claude_code", "codex"]',
        "[guidance]",
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

Deno.test("renderAgentFiles: two renders of the same committed inputs are byte-identical (deterministic)", async () => {
  // Built-in sections read committed config and the map's top-level structure,
  // so the compile output cannot vary between runs over the same tree.
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

Deno.test("renderAgentFiles: map regions enroll automatically without leaf churn", async () => {
  const dir = await scaffold('["codex"]');
  try {
    await Deno.mkdir(defaultMapPath(dir, "20-quality-gate"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "20-quality-gate", "README.md"),
      "# Quality gate\n\nHow the project proves changes.\n",
    );
    const first = (await renderAgentFiles(dir)).get("AGENTS.md");
    assert(first !== undefined);
    assertStringIncludes(first, "`20-quality-gate` — Quality gate");

    // A leaf joins search and the region index, but the compact generated list
    // depends only on the top-level region and its front-door title.
    await Deno.writeTextFile(
      defaultMapPath(dir, "20-quality-gate", "jobs.md"),
      "# Jobs\n\nOne leaf.\n",
    );
    assertEquals(
      (await renderAgentFiles(dir)).get("AGENTS.md"),
      first,
      "adding a leaf inside an existing region must not churn agent guidance",
    );

    await Deno.mkdir(defaultMapPath(dir, "30-worktrees"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      defaultMapPath(dir, "30-worktrees", "README.md"),
      "# Worktrees\n\nIsolated checkouts.\n",
    );
    const expanded = (await renderAgentFiles(dir)).get("AGENTS.md");
    assert(expanded !== undefined);
    assertStringIncludes(expanded, "`30-worktrees` — Worktrees");
    assert(expanded !== first, "a new top-level region must refresh guidance");
    const config = await loadConfig(dir);
    const provider = providerFor("codex");
    assert(provider !== undefined);
    const patterns = await agentFileOwnershipPatterns(
      dir,
      config,
      [provider.guidanceFile],
    );
    assert(
      patterns.some((pattern) => matchesGuidanceOwnership(pattern, first)),
      "ownership comparison accepts an older generated region payload",
    );
    assert(
      !patterns.some((pattern) =>
        matchesGuidanceOwnership(
          pattern,
          first.replace("# Mine", "# Changed"),
        )
      ),
      "authored guidance outside the owned slot must remain significant",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("renderAgentFiles: the built-in guidance reflects config (interpolation is real, not cosmetic)", async () => {
  // Bare = schema defaults (branch_prefix agent/, trunk main, no standards,
  // no resources). Rich = custom branch/main, a standard, and a resource declared.
  const bare = await Deno.makeTempDir({ prefix: "discern-tmpl-bare-" });
  const rich = await Deno.makeTempDir({ prefix: "discern-tmpl-rich-" });
  try {
    await Deno.writeTextFile(
      join(bare, "discern.toml"),
      '[project]\nagents = ["codex"]\n',
    );
    await Deno.writeTextFile(
      join(rich, "discern.toml"),
      [
        "[repository]",
        'branch_prefix = "wt/"',
        'trunk = "trunk"',
        "[project]",
        'agents = ["codex"]',
        "[standards.coverage]",
        'direction = "up"',
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
      "custom trunk replaces the default",
    );

    // {{#if has_standards}} selects configured guidance or the adoption seed.
    assert(
      bareBody.includes(
        "No quality standards yet. When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.",
      ),
      "an unconfigured project gets the standards adoption seed",
    );
    assert(
      bareBody.includes("## Quality standards"),
      "the standards adoption seed keeps its section heading",
    );
    assert(
      !bareBody.includes("Standards are **numbers that can never get worse**"),
      "an unconfigured project omits the configured standards guidance",
    );
    assert(
      richBody.includes("Standards are **numbers that can never get worse**"),
      "a configured project gets the standards guidance",
    );
    assert(
      !richBody.includes("No quality standards yet."),
      "a configured project omits the standards adoption seed",
    );

    // {{#if has_worktree_resources}} selects the lifecycle detail or its seed.
    assert(
      !bareBody.includes("per-worktree external"),
      "no inert resource prose",
    );
    assert(
      bareBody.includes(
        "No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.",
      ),
      "an unconfigured project gets the resources adoption seed",
    );
    assert(
      richBody.includes("per-worktree external"),
      "resource detail present",
    );
    assert(richBody.includes("--resource <name>"), "resource flag documented");
    assert(
      !richBody.includes("No per-worktree resources are configured."),
      "a configured project omits the resources adoption seed",
    );

    assert(
      bareBody.includes(
        "explicit consent from this conversation or machine-verified authority",
      ),
      "acceptance requires conversation consent or checked recorded authority",
    );
    assert(
      bareBody.includes("follow its authority-aware hint"),
      "the runtime result, not static prose, chooses the landing route",
    );
    assert(
      bareBody.includes(
        "either report the one-line receipt and stop, or land under the verified grant",
      ),
      "a green finish still needs one verified source of landing authority",
    );
    for (
      const [meaning, needle] of [
        [
          "start explains how to move the agent into the returned checkout",
          "re-root into the returned path: cd in, or start a session there",
        ],
        [
          "the no-re-root fallback applies to every shell command and discern tool",
          "Prefix every shell command with `cd <path> &&` and pass `path` to every discern tool",
        ],
        [
          "update replaces pre-checks and hand merges",
          "call it directly instead of pre-checking with git or hand-merging",
        ],
        [
          "from accepts an arbitrary ref and composes below the trunk",
          "`from` (any ref) — work composes below the trunk",
        ],
        [
          "await guidance states what the call watches",
          "watches a sibling or the trunk in one longest-safe call",
        ],
        [
          "an active await call produces no progress updates",
          "Do not surface progress updates until it returns",
        ],
        [
          "an unmet await continuation produces no update",
          "continue with `data.resume` without surfacing an update",
        ],
        [
          "await continuations have no fixed retry count",
          "Repeat without a fixed limit until the condition holds",
        ],
        [
          "a refusal follows recovery instead of continuing",
          "An `ok: false` refusal has no continuation. Do not resume it. Follow its recovery hint",
        ],
        [
          "atomic history survives acceptance",
          "commit each logical step — acceptance lands your branch history as-is",
        ],
        [
          "the gate receipt belongs to the final clean commit",
          "run `discern_done` once on the clean HEAD — acceptance honors that receipt",
        ],
        [
          "another clean worktree remains somebody else's line of work",
          "other efforts in flight, not a pool to claim from",
        ],
      ] as const
    ) {
      assertStringIncludes(
        bareBody,
        needle,
        `worktree guidance lost this operational safeguard: ${meaning}`,
      );
    }
  } finally {
    await Deno.remove(bare, { recursive: true });
    await Deno.remove(rich, { recursive: true });
  }
});

Deno.test("renderAgentFiles: excluding the teach skill removes its guidance reference", async () => {
  const included = await Deno.makeTempDir({
    prefix: "discern-teach-included-",
  });
  const excluded = await Deno.makeTempDir({
    prefix: "discern-teach-excluded-",
  });
  try {
    await Deno.writeTextFile(
      join(included, "discern.toml"),
      '[project]\nagents = ["codex"]\n',
    );
    await Deno.writeTextFile(
      join(excluded, "discern.toml"),
      [
        "[project]",
        'agents = ["codex"]',
        "[skills]",
        'exclude = ["discern-teach-the-project"]',
        "",
      ].join("\n"),
    );

    const includedBody = (await renderAgentFiles(included)).get("AGENTS.md");
    const excludedBody = (await renderAgentFiles(excluded)).get("AGENTS.md");
    assert(includedBody !== undefined && excludedBody !== undefined);
    assertStringIncludes(includedBody, "discern-teach-the-project");
    assert(
      !excludedBody.includes("discern-teach-the-project"),
      "compiled guidance must not name an excluded skill",
    );
  } finally {
    await Deno.remove(included, { recursive: true });
    await Deno.remove(excluded, { recursive: true });
  }
});

Deno.test("renderAgentFiles: the never-edit sentence names the project's real generated files (config-derived)", async () => {
  // generated_agent_files / materialized_skills_dirs derive from [project].agents
  // through the SAME registry renderAgentFiles / materializeSkills write to, so the
  // names base.md prints can never drift from the files actually produced.
  const solo = await Deno.makeTempDir({ prefix: "discern-genfiles-solo-" });
  const multi = await Deno.makeTempDir({ prefix: "discern-genfiles-multi-" });
  try {
    await Deno.writeTextFile(
      join(solo, "discern.toml"),
      '[project]\nagents = ["codex"]\n',
    );
    await Deno.writeTextFile(
      join(multi, "discern.toml"),
      '[project]\nagents = ["claude_code", "codex", "gemini"]\n',
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
    assert(soloBody !== multiBody, "the file list tracks [project].agents");
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
        "[repository]",
        'branch_prefix = "wt/"',
        "[project]",
        'agents = ["claude_code", "codex"]',
        "[standards.coverage]",
        'direction = "up"',
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
      body.includes("MCP tools unreachable"),
      "carries the fallback instruction",
    );
    assert(
      body.includes("CLI not on PATH"),
      "carries the fallback installation instruction",
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

Deno.test("renderAgentFiles: every guidance template input is config-driven — no hardcoded value can creep in", async () => {
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
    project_name: {
      toml: '[project]\nname = "ZZ Probe"\nagents = ["codex"]\n',
      expect: "ZZ Probe",
    },
    branch_prefix: {
      toml:
        '[repository]\nbranch_prefix = "zz-wt/"\n[project]\nagents = ["codex"]\n',
      expect: "zz-wt/",
    },
    main_branch: {
      toml: '[repository]\ntrunk = "zztrunk"\n[project]\nagents = ["codex"]\n',
      expect: "zztrunk",
    },
    map_dir: {
      toml: '[map]\ndir = "zz-docs/"\n[project]\nagents = ["codex"]\n',
      expect: "zz-docs/",
    },
    todo_path: {
      toml: '[project]\ntodo = "zz-ledger.md"\nagents = ["codex"]\n',
      expect: "zz-ledger.md",
      contextOnly: true,
    },
    skills_dir: {
      toml: '[skills]\ndir = "zz-playbooks"\n[project]\nagents = ["codex"]\n',
      expect: "zz-playbooks",
      contextOnly: true,
    },
    scripts_dir: {
      toml: '[scripts]\ndir = "zz-tools"\n[project]\nagents = ["codex"]\n',
      expect: "zz-tools",
      contextOnly: true,
    },
    guidance_sources: {
      toml:
        '[project]\nagents = ["codex"]\n[guidance]\nsources = ["zz-rules.md"]\n',
      expect: "zz-rules.md",
    },
    generated_agent_files: {
      toml: '[project]\nagents = ["codex", "gemini"]\n',
      expect: "GEMINI.md",
    },
    materialized_skills_dirs: {
      toml: '[project]\nagents = ["codex", "claude_code"]\n',
      expect: ".claude/skills",
    },
  };
  const predicateCases: Record<
    string,
    { toml: string; expect: boolean }
  > = {
    has_standards: {
      toml: [
        "[standards.coverage]",
        'direction = "up"',
        "limit = 80",
        'run = "echo DISCERN_METRIC coverage 80"',
        "",
      ].join("\n"),
      expect: true,
    },
    has_worktree_resources: {
      toml: [
        "[worktree.resources.db]",
        'create = "createdb x"',
        'destroy = "dropdb x"',
        "",
      ].join("\n"),
      expect: true,
    },
    has_teach_skill: {
      toml: '[skills]\nexclude = ["discern-teach-the-project"]\n',
      expect: false,
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
      '[project]\nagents = ["codex"]\n',
    );
    const ctx = guidanceContext(await loadConfig(probe));
    assertEquals(
      Object.keys(cases).sort(),
      Object.keys(ctx.vars).sort(),
      "every guidance {{var}} needs a config-driven case here (and vice versa)",
    );
    assertEquals(
      Object.keys(predicateCases).sort(),
      Object.keys(ctx.preds).sort(),
      "every guidance {{#if}} needs a config-driven case here (and vice versa)",
    );
  } finally {
    await Deno.remove(probe, { recursive: true });
  }

  const baseline = await renderBody('[project]\nagents = ["codex"]\n');
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
  for (const [name, c] of Object.entries(predicateCases)) {
    const dir = await Deno.makeTempDir({ prefix: "discern-pred-case-" });
    try {
      await Deno.writeTextFile(join(dir, "discern.toml"), c.toml);
      const ctx = guidanceContext(await loadConfig(dir));
      assertEquals(
        ctx.preds[name],
        c.expect,
        `${name}: the configured value must flow into the guidance context`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});
