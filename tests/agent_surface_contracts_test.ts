/**
 * Class guard for operational agent copy outside the Map.
 *
 * The materializer's effective Skill set and the setup template resolver own
 * membership. A Skill's `SKILL.md` owns its classification and contract;
 * supporting Markdown inherits that contract and joins the lexical corpus.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  type AgentSurfaceContract,
  parseAgentSurfaceContract,
  renderAgentSurfaceContract,
} from "../scripts/agent_contract.ts";
import {
  agentSurfaceLexicalIssues,
  formatAgentLexicalIssues,
  NON_OPERATIONAL_AGENT_SEGMENTS,
  operationalAgentCorpusFiles,
  operationalAgentSurfaces,
  operationalContractFailures,
  operationalSetupSurfaces,
  operationalSkillSurface,
} from "../scripts/agent_surface_contracts.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const config = await loadConfig(REPO_ROOT);

const READ_ONLY_CONTRACT: AgentSurfaceContract = {
  effectful: false,
  cross_worktree: false,
  authority_sensitive: false,
  relay_bearing: false,
  recoverable: false,
  targets: ["stable: the named review subject"],
  sequence: [
    "act: inspect the named subject",
    "verify: return findings grounded in that subject",
  ],
  stop_conditions: ["The named subject is unavailable."],
};

const FULL_CONTRACT: AgentSurfaceContract = {
  effectful: true,
  cross_worktree: true,
  authority_sensitive: true,
  relay_bearing: true,
  recoverable: true,
  targets: [
    "root: the absolute worktree path returned by the creator",
    "stable: the literal branch returned by the creator",
  ],
  sequence: [
    "act: make the authorized change in the named worktree",
    "verify: run the declared completion check in that worktree",
  ],
  stop_conditions: ["The required authority is absent."],
  recovery: [
    "The worktree is unavailable. => Report its absolute path and stop.",
  ],
  authority:
    "The recorded grant covers only the named worktree and final landing.",
  authority_check:
    "command: `discern accept` re-verifies the grant against changed paths.",
  relay_message:
    "I verified <evidence> on <target>. The next valid action is <next_action>.",
  relay_facts: ["evidence", "target", "next_action"],
};

/** Render a minimal Markdown surface around a typed contract fixture. */
function markdownWithContract(contract: AgentSurfaceContract): string {
  return `# Future procedure\n\n${renderAgentSurfaceContract(contract)}\n`;
}

Deno.test("every enrolled operational agent surface satisfies its classified contract", async () => {
  const surfaces = await operationalAgentSurfaces(REPO_ROOT, config);
  assert(
    surfaces.some((surface) => surface.kind === "setup-brief"),
    "the setup brief must remain in the operational-surface universe",
  );
  assert(
    surfaces.some((surface) => surface.source === "bundled") &&
      surfaces.some((surface) => surface.source === "authored"),
    "both Skill source containers must remain enrolled",
  );
  const failures = operationalContractFailures(REPO_ROOT, surfaces);
  assertEquals(
    failures,
    [],
    "every diagnostic names its source line, missing field, and accepted form:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("a read-only surface legitimately omits conditional contract fields", () => {
  assertEquals(
    parseAgentSurfaceContract(markdownWithContract(READ_ONLY_CONTRACT)).issues,
    [],
  );
});

Deno.test("contract controls reject every mechanically incomplete field family", () => {
  const rendered = markdownWithContract(FULL_CONTRACT);
  const cases = [
    {
      field: "targets",
      text: rendered
        .replace(
          /targets = \[[^\n]+/,
          'targets = ["path: sibling/notes.md"]',
        ),
    },
    {
      field: "sequence",
      text: rendered.replace(
        /sequence = \[[^\n]+/,
        'sequence = ["act: start", "act: continue"]',
      ),
    },
    {
      field: "stop_conditions",
      text: rendered.replace(/^stop_conditions = .*\n/m, ""),
    },
    {
      field: "recovery",
      text: rendered.replace(/^recovery = .*\n/m, ""),
    },
    {
      field: "authority",
      text: rendered.replace(/^authority = .*\n/m, ""),
    },
    {
      field: "authority_check",
      text: rendered.replace(/^authority_check = .*\n/m, ""),
    },
    {
      field: "relay_message",
      text: rendered.replace(
        /^relay_message = .*\n/m,
        'relay_message = "I verified <evidence>."\n',
      ),
    },
    {
      field: "relay_facts",
      text: rendered.replace(/^relay_facts = .*\n/m, ""),
    },
  ] as const;
  for (const fixture of cases) {
    const issues = parseAgentSurfaceContract(fixture.text).issues;
    assert(
      issues.some((entry) => entry.field === fixture.field),
      `${fixture.field}: expected its contract check to fail, got ${
        JSON.stringify(issues)
      }`,
    );
    assert(
      issues.some((entry) => entry.message.includes("accepted form:")),
      `${fixture.field}: the diagnostic must teach the correction`,
    );
  }
});

Deno.test("false classifications reject conditional ceremony", () => {
  const issues = parseAgentSurfaceContract(
    markdownWithContract(FULL_CONTRACT).replace(
      "authority_sensitive = true",
      "authority_sensitive = false",
    ),
  ).issues;
  assertEquals(
    issues.filter((entry) =>
      entry.field === "authority" || entry.field === "authority_check"
    ).map((entry) => entry.field),
    ["authority", "authority_check"],
  );
  assert(
    issues.every((entry) => entry.message.includes("accepted form:")),
    JSON.stringify(issues),
  );
});

Deno.test("a future setup brief auto-enrolls and fails at its source", async () => {
  await withTempDir(async (dir) => {
    const sourceFile = join(dir, "handoff.md");
    await Deno.writeTextFile(
      sourceFile,
      "# Hand off setup\n\nRelay the result.\n",
    );
    const surfaces = await operationalSetupSurfaces(dir);
    assertEquals(surfaces.map((surface) => surface.id), ["setup:handoff"]);
    const failures = operationalContractFailures(dir, surfaces);
    assert(
      failures.some((failure) =>
        failure.startsWith("handoff.md:1:") &&
        failure.includes("missing contract field 'effectful'") &&
        failure.includes("accepted form:")
      ),
      failures.join("\n"),
    );
  });
});

Deno.test("a future effectful Skill auto-enrolls and fails at its source", async () => {
  await withTempDir(async (dir) => {
    const name = "chart-an-unfamiliar-current";
    const skillDir = join(dir, "skills", name);
    await Deno.mkdir(skillDir, { recursive: true });
    await Deno.writeTextFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        `name: ${name}`,
        "description: Chart a changing current and record the route.",
        "---",
        "",
        "# Chart the current",
        "",
        "Change the route, then say it is complete.",
      ].join("\n"),
    );
    const fixtureConfig = {
      ...config,
      skills: { ...config.skills, dir: "skills", exclude: [] },
    };
    const surfaces = await operationalAgentSurfaces(dir, fixtureConfig);
    const future = surfaces.find((surface) => surface.id === `skill:${name}`);
    assert(future !== undefined, "the new authored directory must auto-enroll");
    const failures = operationalContractFailures(dir, [future]);
    assert(
      failures.some((failure) =>
        failure.startsWith(`skills/${name}/SKILL.md:1:`) &&
        failure.includes("missing contract field 'effectful'") &&
        failure.includes("accepted form:")
      ),
      failures.join("\n"),
    );
  });
});

Deno.test("generated DiscernAgent rules hold the enrolled non-Map corpus at zero", async () => {
  const surfaces = await operationalAgentSurfaces(REPO_ROOT, config);
  const files = operationalAgentCorpusFiles(surfaces);
  const issues = await agentSurfaceLexicalIssues(REPO_ROOT, files);
  const failures = formatAgentLexicalIssues(issues);
  assertEquals(
    failures,
    [],
    "fix the authored Skill or setup source; generated/materialized copies are not the authority:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("lexical controls reject fresh bad copy and exempt literal examples", async () => {
  await withTempDir(async (dir) => {
    const bad = join(dir, "future-instructions.md");
    await Deno.writeTextFile(
      bad,
      "# Route the work\n\nUse your best judgment, then see above.\n",
    );
    const badIssues = await agentSurfaceLexicalIssues(REPO_ROOT, [bad]);
    assertEquals(
      [...new Set(badIssues.map((entry) => entry.check))].sort(),
      [
        "DiscernAgent.BestJudgment",
        "DiscernAgent.PositionalReference",
      ],
    );
    assert(
      badIssues.every((entry) => entry.file === bad && entry.line === 3),
      JSON.stringify(badIssues),
    );

    const literal = join(dir, "literal-examples.md");
    await Deno.writeTextFile(
      literal,
      "# Literal examples\n\nReject `use your best judgment` and `see above`.\n",
    );
    const literalIssues = await agentSurfaceLexicalIssues(REPO_ROOT, [literal]);
    assertEquals(literalIssues, []);
  });
});

Deno.test("supporting Skill Markdown auto-enrolls while skeleton payloads do not", async () => {
  await withTempDir(async (dir) => {
    const skillDir = join(dir, "navigate-the-archive");
    await Deno.mkdir(join(skillDir, "notes"), { recursive: true });
    await Deno.mkdir(join(skillDir, "skeleton"), { recursive: true });
    await Deno.writeTextFile(
      join(skillDir, "SKILL.md"),
      markdownWithContract(READ_ONLY_CONTRACT),
    );
    await Deno.writeTextFile(join(skillDir, "notes", "route.md"), "Route.");
    await Deno.writeTextFile(
      join(skillDir, "skeleton", "README.md"),
      "Payload.",
    );
    const surface = await operationalSkillSurface({
      name: "navigate-the-archive",
      source: "authored",
      srcAbs: skillDir,
      overridesBundled: false,
    });
    assertEquals(
      surface.sourceFiles.map((file) => file.slice(skillDir.length + 1)),
      ["SKILL.md", "notes/route.md"],
    );
    assertStringIncludes(
      NON_OPERATIONAL_AGENT_SEGMENTS.get("skeleton") ?? "",
      "output templates",
    );
  });
});
