/**
 * The pure instruction renderer + currency check (ADR 0034). `renderAgentFiles` is
 * the single source the writer (`compileInstructions`) and the checker
 * (`checkInstructionCurrent`) share, so the check agrees with what `discern refresh`
 * writes by construction. Fast: no subprocess.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { compileInstructions } from "../src/engine/instructions.ts";
import {
  agentFileOwnershipPatterns,
  checkInstructionCurrent,
  instructionContext,
  matchesInstructionOwnership,
  renderAgentFiles,
} from "../src/engine/instruction_render.ts";
import { providerFor } from "../src/lib/providers.ts";
import { OPERATING_POLICIES } from "../src/shared/operating_policies.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";
import { defaultMapPath } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** A temp project emitting both providers, with one user instruction source. */
async function scaffold(
  tmp: string,
  agents = '["claude_code", "codex"]',
): Promise<void> {
  await Deno.writeTextFile(
    join(tmp, "discern.toml"),
    [
      "[project]",
      `agents = ${agents}`,
      "[instructions]",
      'sources = ["instructions.md"]',
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(join(tmp, "instructions.md"), "# Mine\nA rule.\n");
}

Deno.test("queue instructions state the configured cap and disappear when uncapped", async () => {
  for (const cap of [0, 1, 7]) {
    await withTempDir(async (root) => {
      await scaffold(root);
      await Deno.writeTextFile(
        join(root, "discern.toml"),
        `\n[gate]\nconcurrent_test_runs = ${cap}\n`,
        { append: true },
      );
      const body = (await renderAgentFiles(root)).get("AGENTS.md");
      assert(body !== undefined);
      assertEquals(
        body.includes("Use the test queue"),
        cap > 0,
      );
      if (cap > 0) {
        assertStringIncludes(
          body,
          "\n- **Use the test queue.**",
        );
        assert(!body.split("\n").some((line) => /[\t ]$/u.test(line)));
        assertStringIncludes(
          body,
          `${cap} concurrent test run${cap === 1 ? "" : "s"}`,
        );
        assertStringIncludes(body, "discern queue -- <command>");
      }
    });
  }
});

Deno.test("renderAgentFiles: AGENTS.md is the full body; CLAUDE.md is the @AGENTS.md pointer", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const files = await renderAgentFiles(dir);
    assertEquals([...files.keys()].sort(), ["AGENTS.md", "CLAUDE.md"]);
    const agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assert(
      agents.startsWith("# Working in this project"),
      "the canonical file opens with the instructions — no banner",
    );
    assertStringIncludes(
      agents,
      "\n---\n\n# Mine\nA rule.\n",
      "the shipped instructions and user instructions are separated by one Markdown rule",
    );
    assert(agents.includes("A rule."), "the user source is appended");
    assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: authored local Markdown destinations keep their project targets for every provider", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "discern"), { recursive: true });
    await Deno.mkdir(join(dir, "policy"), { recursive: true });
    const primary = [
      "# Portable policy",
      "",
      "[inline](./contributing.md)",
      "[parent](../README.md)",
      '![image](./assets/diagram.png "Diagram")',
      '[angle](<guide folder/file.md> "Angle title")',
      '[titled](guide.md "Guide title")',
      String.raw`[escaped](<guide\ file.md>)`,
      "[nested](assets/(draft)/guide.md)",
      "[query](guide.md?mode=compact#part)",
      "[reference][guide]",
      "",
      '[guide]: guide.md#section "Reference title"',
      "",
      "[external](https://example.com/guide.md)",
      "[mail](mailto:guide@example.com)",
      "[root](/README.md)",
      "[fragment](#section)",
      "`[code](./code-lookalike.md)`",
      "",
      "```md",
      "[fenced](./fenced-lookalike.md)",
      "```",
      "",
    ].join("\n");
    await Deno.writeTextFile(
      join(dir, "discern", "instructions.md"),
      primary,
    );
    await Deno.writeTextFile(
      join(dir, "policy", "instructions.md"),
      "[second source](./review.md)\n",
    );

    for (const name of AGENT_NAMES) {
      await Deno.writeTextFile(
        join(dir, "discern.toml"),
        [
          "[project]",
          `agents = ["${name}"]`,
          "[instructions]",
          'sources = ["discern/instructions.md", "policy/instructions.md"]',
          "",
        ].join("\n"),
      );
      const files = await renderAgentFiles(dir);
      assertEquals(
        files.size,
        1,
        `${name} should emit one full-body file alone`,
      );
      const [entry] = [...files];
      assert(entry !== undefined);
      const [path, body] = entry;
      const expected = [
        "[inline](discern/contributing.md)",
        "[parent](README.md)",
        '![image](discern/assets/diagram.png "Diagram")',
        '[angle](<discern/guide folder/file.md> "Angle title")',
        '[titled](discern/guide.md "Guide title")',
        String.raw`[escaped](<discern/guide\ file.md>)`,
        "[nested](discern/assets/(draft)/guide.md)",
        "[query](discern/guide.md?mode=compact#part)",
        '[guide]: discern/guide.md#section "Reference title"',
        "[second source](policy/review.md)",
      ];
      for (const needle of expected) {
        assertStringIncludes(
          body,
          needle,
          `${name} changed a local target while compiling ${path}`,
        );
      }
      for (
        const untouched of [
          "[external](https://example.com/guide.md)",
          "[mail](mailto:guide@example.com)",
          "[root](/README.md)",
          "[fragment](#section)",
          "`[code](./code-lookalike.md)`",
          "[fenced](./fenced-lookalike.md)",
        ]
      ) {
        assertStringIncludes(
          body,
          untouched,
          `${name} rewrote a non-local or literal destination in ${path}`,
        );
      }
    }
  }, { prefix: "discern-link-base-test-" });
});

Deno.test("renderAgentFiles: every generated provider file has one canonical final newline", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir, JSON.stringify(AGENT_NAMES));
    for (const [path, body] of await renderAgentFiles(dir)) {
      assert(
        body.endsWith("\n") && !body.endsWith("\n\n"),
        `${path} must end in exactly one newline`,
      );
    }
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: discern's own authored links resolve from the compiled root", async () => {
  const root = fromFileUrl(new URL("../", import.meta.url));
  const agents = (await renderAgentFiles(root)).get("AGENTS.md");
  assert(agents !== undefined);
  for (
    const target of [
      "src/shared/result.ts",
      "src/engine/mcp/server.ts",
    ]
  ) {
    assertStringIncludes(
      agents,
      `](${target})`,
      `${target} must be relative to the compiled root file`,
    );
    assert(await Deno.stat(join(root, target)));
  }
  assertEquals(agents.includes("](../src/"), false);
});

Deno.test("renderAgentFiles: Cursor configuration does not change the generic worktree instructions", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir, '["cursor"]');
    const files = await renderAgentFiles(dir);
    const agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assertStringIncludes(agents, "from the main checkout");
    assertStringIncludes(agents, "Keep one worktree for the whole effort");
    assertStringIncludes(agents, "If you can't change your working root");
    assert(
      !/(external file protection|approval-gates external edits)/i.test(agents),
      "compiled instructions must not condition an agent on Cursor's human-visible approval state",
    );
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: the compiled file opens as the project's own — [project].name, else the slug", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "voyager-2"\nagents = ["codex"]\n[instructions]\nsources = ["instructions.md"]\n',
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
      '[project]\nname = "Voyager 2"\nslug = "voyager-2"\nagents = ["codex"]\n[instructions]\nsources = ["instructions.md"]\n',
    );
    files = await renderAgentFiles(dir);
    agents = files.get("AGENTS.md");
    assert(agents !== undefined);
    assert(
      agents.startsWith("# Working in Voyager 2"),
      "[project].name wins over the slug in the H1",
    );
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: every reuse-canonical agent configured alone emits the canonical it reads", async () => {
  const reuseAgents = AGENT_NAMES.filter((name) =>
    providerFor(name)?.instructionFile.reuseCanonical === true
  );
  assert(
    reuseAgents.length > 0,
    "expected at least one reuse-canonical provider",
  );

  for (const name of reuseAgents) {
    await withTempDir(async (dir) => {
      await scaffold(dir, `["${name}"]`);
      const provider = providerFor(name);
      assert(provider !== undefined);
      const gf = provider.instructionFile;
      const files = await renderAgentFiles(dir);
      assertEquals(
        [...files.keys()],
        [gf.path],
        `${name} must render the canonical instruction file it reads`,
      );
      const body = files.get(gf.path);
      assert(body !== undefined);
      assert(
        body.includes("A rule."),
        `${name} canonical instructions should carry the compiled body`,
      );
    }, { prefix: "discern-render-test-" });
  }
});

Deno.test("renderAgentFiles: internal map slots never reach provider output", async () => {
  // The provider registry is the enrollment source: a new integration that emits
  // a full agent file joins this guard without adding its name here.
  for (const name of AGENT_NAMES) {
    await withTempDir(async (dir) => {
      await scaffold(dir, `["${name}"]`);
      for (const [path, body] of await renderAgentFiles(dir)) {
        assert(
          !body.includes("discern:map-regions"),
          `${name} leaked the internal map slot through ${path}`,
        );
      }
    }, { prefix: "discern-render-test-" });
  }
});

Deno.test("checkInstructionCurrent: clean after a compile; flags a hand-edit stale and a delete missing", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    await compileInstructions(dir);
    // Freshly compiled → everything matches what refresh would write.
    assertEquals(await checkInstructionCurrent(dir), []);

    // Hand-edit AGENTS.md → stale, carrying both expected and actual (for a diff).
    const agentsPath = join(dir, "AGENTS.md");
    const original = await Deno.readTextFile(agentsPath);
    await Deno.writeTextFile(agentsPath, `${original}\nstray edit\n`);
    const afterEdit = await checkInstructionCurrent(dir);
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
    const afterDelete = await checkInstructionCurrent(dir);
    assertEquals(afterDelete.length, 1);
    const missing = afterDelete[0];
    assert(missing !== undefined);
    assertEquals([missing.path, missing.reason], ["CLAUDE.md", "missing"]);
  }, { prefix: "discern-render-test-" });
});

Deno.test("compile converges when [instructions].sources globs the generated files' location", async () => {
  // sources = ["*.md"] matches the root-level markdown the user meant — AND the
  // AGENTS.md/CLAUDE.md the compiler itself writes there. The outputs must be
  // excluded from source resolution: otherwise each refresh embeds the previous
  // compiled body (unbounded growth) and the currency check reads the freshly
  // written file as a new source, reporting `stale` forever — a blocked gate
  // whose prescribed remediation (`discern refresh`) can never clear it.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      [
        "[project]",
        'agents = ["claude_code", "codex"]',
        "[instructions]",
        'sources = ["*.md"]',
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(join(dir, "instructions.md"), "# Mine\nA rule.\n");

    await compileInstructions(dir);
    const first = await Deno.readTextFile(join(dir, "AGENTS.md"));
    // Current immediately after a refresh — the self-defeating loop is the bug.
    assertEquals(await checkInstructionCurrent(dir), []);

    await compileInstructions(dir);
    const second = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertEquals(second, first, "consecutive refreshes must be byte-identical");
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: two renders of the same committed inputs are byte-identical (deterministic)", async () => {
  // Built-in sections read committed config and the map's top-level structure,
  // so the compile output cannot vary between runs over the same tree.
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const a = await renderAgentFiles(dir);
    const b = await renderAgentFiles(dir);
    assertEquals([...a.keys()].sort(), [...b.keys()].sort());
    for (const [path, body] of a) {
      assertEquals(b.get(path), body, `${path} must render identically twice`);
    }
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: map regions enroll automatically without leaf churn", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir, '["codex"]');
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
      "adding a leaf inside an existing region must not churn agent instructions",
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
    assert(
      expanded !== first,
      "a new top-level region must refresh instructions",
    );
    const config = await loadConfig(dir);
    const provider = providerFor("codex");
    assert(provider !== undefined);
    const patterns = await agentFileOwnershipPatterns(
      dir,
      config,
      [provider.instructionFile],
    );
    assert(
      patterns.some((pattern) => matchesInstructionOwnership(pattern, first)),
      "ownership comparison accepts an older generated region payload",
    );
    assert(
      !patterns.some((pattern) =>
        matchesInstructionOwnership(
          pattern,
          first.replace("# Mine", "# Changed"),
        )
      ),
      "authored instructions outside the owned slot must remain significant",
    );
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: the built-in instructions reflect config (interpolation is real, not cosmetic)", async () => {
  // Bare = schema defaults (branch_prefix agent/, trunk main, no standards,
  // no resources). Rich = custom branch/main, a standard, and a resource declared.
  await withTempDir(async (bare) => {
    await withTempDir(async (rich) => {
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
      assert(
        bareBody !== richBody,
        "config must change the rendered instructions",
      );

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

      // {{#if has_standards}} selects configured instructions or the adoption seed.
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
        !bareBody.includes(
          "Standards protect measured limits",
        ),
        "an unconfigured project omits the configured standards instructions",
      );
      assert(
        richBody.includes("Standards protect measured limits"),
        "a configured project gets the standards instructions",
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
      assert(
        richBody.includes("--resource <name>"),
        "resource flag documented",
      );
      assert(
        !richBody.includes("No per-worktree resources are configured."),
        "a configured project omits the resources adoption seed",
      );

      const acceptance = OPERATING_POLICIES.find((policy) =>
        policy.id === "accept-on-handoff"
      );
      assert(acceptance !== undefined);
      for (const body of [bareBody, richBody]) {
        for (const probe of acceptance.probes) {
          assert(probe.test(body), `acceptance policy is preserved: ${probe}`);
        }
      }
      assert(
        bareBody.includes(
          "authority-aware next action: report and wait when consent is needed",
        ),
        "the runtime result, not static prose, chooses the landing route",
      );
      assert(
        bareBody.includes(
          "report and wait when consent is needed, or proceed under the verified authority",
        ),
        "a green finish still needs one verified source of landing authority",
      );
      for (
        const [meaning, needle] of [
          [
            "new editing work starts from the main checkout",
            "For a new effort requiring edits",
          ],
          [
            "read-only work still orients",
            "including investigation-only and resumed sessions",
          ],
          [
            "read-only investigation need not create a checkout",
            "Read-only investigation does not require creating a worktree",
          ],
          [
            "entry moves the agent's own file operations",
            "move your file operations to the returned path",
          ],
          [
            "later fixes and sessions keep the returned checkout",
            "Keep one worktree for the whole effort",
          ],
          [
            "shell operations target the assigned checkout",
            "prefix shell commands with `cd <path> &&`",
          ],
          [
            "MCP calls target their assigned checkout",
            "pass `path` to discern tools that accept it",
          ],
          [
            "update replaces pre-checks and hand merges",
            "no Git pre-check or hand-merge is needed",
          ],
          [
            "await discovery routes to its call contract",
            "follow its continuation or recovery instructions",
          ],
          [
            "atomic history stays explicit",
            "Commit each logical change separately",
          ],
          [
            "staging is the agent's responsibility",
            "staging and committing remain your responsibility",
          ],
          [
            "completion checks a committed tree",
            "on the clean, committed final tree",
          ],
          [
            "another effort's checkout stays off limits",
            "Never adopt another effort's worktree",
          ],
          [
            "completion is distinct from landing",
            "It lands nothing",
          ],
          [
            "owner updates connect evidence to the task",
            "consequences for the requested work",
          ],
          [
            "routine implementation choices stay with the agent",
            "Continue authorized investigation and repair",
          ],
        ] as const
      ) {
        assertStringIncludes(
          bareBody,
          needle,
          `worktree instructions lost this operational safeguard: ${meaning}`,
        );
      }
    }, { prefix: "discern-tmpl-rich-" });
  }, { prefix: "discern-tmpl-bare-" });
});

Deno.test("renderAgentFiles: every mentioned skill disappears when excluded", async () => {
  for (
    const skill of [
      "discern-teach-the-project",
      "discern-set-the-standard",
    ]
  ) {
    await withTempDir(async (included) => {
      await withTempDir(async (excluded) => {
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
            `exclude = ["${skill}"]`,
            "",
          ].join("\n"),
        );

        const includedBody = (await renderAgentFiles(included)).get(
          "AGENTS.md",
        );
        const excludedBody = (await renderAgentFiles(excluded)).get(
          "AGENTS.md",
        );
        assert(includedBody !== undefined && excludedBody !== undefined);
        assertStringIncludes(includedBody, skill);
        assert(
          !excludedBody.includes(skill),
          `compiled instructions must not name excluded skill ${skill}`,
        );
      }, { prefix: "discern-skill-excluded-" });
    }, { prefix: "discern-skill-included-" });
  }
});

Deno.test("every bundled skill mention is inside its has_skill predicate", async () => {
  const files = await structuralGuardScope({
    guard: "tests/instruction_render_test.ts#bundled-skill-mentions",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "Bundled skill mentions exist only in shipped instruction and skill Markdown.",
      include: (path) =>
        path.startsWith("templates/instructions/") ||
        path.startsWith("templates/skills/"),
    },
  });
  const skills = new Set(
    files.flatMap((path) => {
      const match = /^templates\/skills\/([^/]+)\/SKILL\.md$/u.exec(path);
      return match?.[1] === undefined ? [] : [match[1]];
    }),
  );
  const token =
    /\{\{#if\s+([a-z0-9_]+)\}\}|\{\{\/if\}\}|`(discern-[a-z0-9-]+)`/gu;
  for (
    const path of files.filter((candidate) =>
      candidate.startsWith("templates/instructions/") &&
      candidate.endsWith(".md")
    )
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    const name = path.slice("templates/instructions/".length);
    const predicates: string[] = [];
    for (const match of text.matchAll(token)) {
      const opened = match[1];
      const skill = match[2];
      if (opened !== undefined) {
        predicates.push(opened);
      } else if (match[0] === "{{/if}}") {
        predicates.pop();
      } else if (skill !== undefined && skills.has(skill)) {
        const expected = `has_skill_${skill.replaceAll("-", "_")}`;
        assert(
          predicates.includes(expected),
          `${name}: \`${skill}\` must be gated by {{#if ${expected}}}`,
        );
      }
    }
  }
});

Deno.test("renderAgentFiles: the never-edit sentence names the project's real generated files (config-derived)", async () => {
  // generated_agent_files / materialized_skills_dirs derive from [project].agents
  // through the SAME registry renderAgentFiles / materializeSkills write to, so the
  // names base.md prints can never drift from the files actually produced.
  await withTempDir(async (solo) => {
    await withTempDir(async (multi) => {
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
    }, { prefix: "discern-genfiles-multi-" });
  }, { prefix: "discern-genfiles-solo-" });
});

Deno.test("checkInstructionCurrent: a templated, non-default config compiles current (no drift)", async () => {
  // Proves the templated output a refresh writes is exactly what the currency
  // check recomputes — the ADR 0034 invariant, exercised with live interpolation.
  await withTempDir(async (dir) => {
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
    await compileInstructions(dir);
    assertEquals(await checkInstructionCurrent(dir), []);
  }, { prefix: "discern-tmpl-currency-" });
});

Deno.test("renderAgentFiles: base instructions are MCP-first with a CLI fallback (no envelope dump or roster)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const body = (await renderAgentFiles(dir)).get("AGENTS.md");
    assert(body !== undefined);
    // MCP-first stance + the unreachable-server fallback are present...
    assert(
      body.includes("MCP tools** as the primary interface"),
      "states MCP-first",
    );
    assert(
      body.includes("When MCP is unavailable"),
      "carries the fallback instruction",
    );
    assert(
      body.includes("If the CLI is also unavailable"),
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
  }, { prefix: "discern-render-test-" });
});

Deno.test("renderAgentFiles: every instructions template input is config-driven — no hardcoded value can creep in", async () => {
  // Class guard for "built-in instructions states a discern.toml-configurable value but
  // hardcodes one literal instead of interpolating it" — the bug behind the
  // instructions.sources filename. Driven off the SSOT,
  // instructionContext's own variable set: every exposed {{var}} MUST have a case here
  // proving its value flows from config into the compiled instructions. A newly exposed
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
    concurrent_test_runs: {
      toml: '[gate]\nconcurrent_test_runs = 7\n[project]\nagents = ["codex"]\n',
      expect: "7 concurrent test runs",
    },
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
    instruction_sources: {
      toml:
        '[project]\nagents = ["codex"]\n[instructions]\nsources = ["zz-rules.md"]\n',
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
    has_test_run_cap: {
      toml: "[gate]\nconcurrent_test_runs = 0\n",
      expect: false,
    },
    single_test_run: {
      toml: "[gate]\nconcurrent_test_runs = 7\n",
      expect: false,
    },
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
    has_checkpoints: {
      toml: [
        "[checkpoints.zz-probe-review]",
        'paths = ["zz-probe/**"]',
        'question = "A probe change states what it verified."',
        "",
      ].join("\n"),
      expect: true,
    },
    has_skill_discern_teach_the_project: {
      toml: '[skills]\nexclude = ["discern-teach-the-project"]\n',
      expect: false,
    },
    has_skill_discern_set_the_standard: {
      toml: '[skills]\nexclude = ["discern-set-the-standard"]\n',
      expect: false,
    },
  };

  const renderBody = async (toml: string): Promise<string> => {
    return await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, "discern.toml"), toml);
      await Deno.writeTextFile(join(dir, "zz-rules.md"), "# sentinel source\n");
      const body = (await renderAgentFiles(dir)).get("AGENTS.md");
      assert(body !== undefined, `no AGENTS.md rendered for:\n${toml}`);
      return body;
    }, { prefix: "discern-var-case-" });
  };

  // SSOT coverage: the cases must name EXACTLY the context's variables — a new var
  // can't ship without a guard, and a removed one can't leave a dead case behind.
  let baselinePreds: Record<string, boolean> = {};
  await withTempDir(async (probe) => {
    await Deno.writeTextFile(
      join(probe, "discern.toml"),
      '[project]\nagents = ["codex"]\n',
    );
    const ctx = instructionContext(await loadConfig(probe));
    baselinePreds = { ...ctx.preds };
    assertEquals(
      Object.keys(cases).sort(),
      Object.keys(ctx.vars).sort(),
      "every instructions {{var}} needs a config-driven case here (and vice versa)",
    );
    assertEquals(
      Object.keys(predicateCases).sort(),
      Object.keys(ctx.preds).sort(),
      "every instructions {{#if}} needs a config-driven case here (and vice versa)",
    );
  }, { prefix: "discern-var-probe-" });

  const baseline = await renderBody('[project]\nagents = ["codex"]\n');
  for (const [name, c] of Object.entries(cases)) {
    if (c.contextOnly === true) {
      // Not consumed by any built-in section: prove the context value itself
      // flows from config (the rendered-skill surface reads the same context).
      await withTempDir(async (dir) => {
        await Deno.writeTextFile(join(dir, "discern.toml"), c.toml);
        const ctx = instructionContext(await loadConfig(dir));
        assertEquals(
          ctx.vars[name],
          c.expect,
          `${name}: the configured value must flow into the instruction context`,
        );
      }, { prefix: "discern-var-ctx-" });
      continue;
    }
    const body = await renderBody(c.toml);
    assert(
      body !== baseline,
      `${name}: changing its config must change the compiled instructions`,
    );
    if (c.expect !== undefined) {
      assert(
        body.includes(c.expect),
        `${name}: the configured value "${c.expect}" must appear in the instructions`,
      );
    }
  }
  for (const [name, c] of Object.entries(predicateCases)) {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, "discern.toml"), c.toml);
      const ctx = instructionContext(await loadConfig(dir));
      assertEquals(
        ctx.preds[name],
        c.expect,
        `${name}: the configured value must flow into the instruction context`,
      );
    }, { prefix: "discern-pred-case-" });
    // A predicate guards conditional prose, so its case must flip the baseline
    // value and provably change the compiled body — a context-only check would
    // let a branch compile to nothing without any test noticing.
    assert(
      c.expect !== baselinePreds[name],
      `${name}: the case must flip the baseline predicate so its rendered effect is provable`,
    );
    const body = await renderBody(c.toml);
    assert(
      body !== baseline,
      `${name}: flipping its predicate must change the compiled instructions`,
    );
  }

  // The conditional the checkpoint contract depends on, pinned by content: a
  // checkpoint-free project pays no compiled checkpoint prose, and a governed
  // one receives the section.
  assert(
    !baseline.toLowerCase().includes("checkpoint"),
    "a checkpoint-free project must compile no checkpoint prose",
  );
  assert(
    (await renderBody(predicateCases.has_checkpoints?.toml ?? "")).includes(
      "## Checkpoints",
    ),
    "a governed project must compile the checkpoint section",
  );
});
