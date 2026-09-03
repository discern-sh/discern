/**
 * Class guard for operational agent copy outside the Map.
 *
 * Product resolvers own surface membership. A repository-only registry owns
 * classification and binds every structural field to prose agents receive.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { materializeSkills, type SkillEntry } from "../src/lib/skills.ts";
import {
  AGENT_CONTRACT_HEADING,
  type AgentContractDocument,
  agentContractEvidenceIssues,
  agentContractStructureIssues,
  agentCopyMetadataIssues,
  type AgentSurfaceContract,
} from "../scripts/agent_contract.ts";
import {
  AGENT_SURFACE_CONTRACTS,
  agentSurfaceLexicalIssues,
  formatAgentLexicalIssues,
  NON_OPERATIONAL_AGENT_SEGMENTS,
  operationalAgentCorpusFiles,
  operationalAgentSurfaces,
  operationalContractFailures,
  operationalMetadataFailures,
  operationalRegistryCoverageFailures,
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
  targets: [{
    kind: "stable",
    value: "the named review subject",
    evidence: { text: "Inspect the named review subject." },
  }],
  sequence: [
    { kind: "act", evidence: { text: "Inspect the named review subject." } },
    { kind: "verify", evidence: { text: "Return grounded findings." } },
  ],
  stop_conditions: [{ text: "Stop if the subject is unavailable." }],
};

const FULL_CONTRACT: AgentSurfaceContract = {
  effectful: true,
  cross_worktree: true,
  authority_sensitive: true,
  relay_bearing: true,
  recoverable: true,
  targets: [{
    kind: "root",
    value: "the absolute returned worktree path",
    evidence: { text: "Use the absolute returned worktree path." },
  }],
  sequence: [
    { kind: "act", evidence: { text: "Apply the authorized change." } },
    { kind: "verify", evidence: { text: "Verify the committed tree." } },
  ],
  stop_conditions: [{ text: "Stop when authority is absent." }],
  recovery: [{ text: "If the worktree is absent, report the path and stop." }],
  authority: {
    boundary: { text: "The recorded grant covers the named worktree." },
    command: "discern accept",
    recheck: { text: "Run `discern accept` to recheck the grant." },
  },
  relay: {
    message: { text: "I verified <evidence> on <target>." },
    facts: ["evidence", "target"],
  },
};

const FULL_DOCUMENT_TEXT = [
  "# Future procedure",
  "Use the absolute returned worktree path.",
  "Apply the authorized change.",
  "Stop when authority is absent.",
  "If the worktree is absent, report the path and stop.",
  "The recorded grant covers the named worktree.",
  "Run `discern accept` to recheck the grant.",
  "I verified <evidence> on <target>.",
  "Verify the committed tree.",
].join("\n\n");

/** Build one in-memory authored document for contract evidence tests. */
function fixtureDocument(text = FULL_DOCUMENT_TEXT): AgentContractDocument {
  return {
    relativePath: "SKILL.md",
    absolutePath: "/fixture/future/SKILL.md",
    text,
  };
}

/** Clone the complete fixture without one schema field. */
function withoutField(field: string): Record<string, unknown> {
  const raw = structuredClone(FULL_CONTRACT) as unknown as Record<
    string,
    unknown
  >;
  delete raw[field];
  return raw;
}

Deno.test("every derived operational surface has a prose-bound internal contract", async () => {
  const surfaces = await operationalAgentSurfaces(REPO_ROOT, config);
  assert(
    surfaces.some((surface) => surface.kind === "setup-brief"),
    "the setup brief must remain in the derived universe",
  );
  assert(
    surfaces.some((surface) => surface.source === "bundled") &&
      surfaces.some((surface) => surface.source === "authored"),
    "bundled and authored Skill containers must remain enrolled",
  );
  const failures = [
    ...operationalContractFailures(REPO_ROOT, surfaces),
    ...operationalRegistryCoverageFailures(surfaces),
  ];
  assertEquals(
    failures,
    [],
    "every diagnostic names the authored source, field, and accepted form:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("a read-only surface omits inapplicable recovery, authority, and relay fields", () => {
  assertEquals(agentContractStructureIssues(READ_ONLY_CONTRACT), []);
  const awaited = AGENT_SURFACE_CONTRACTS.get(
    "skill:discern-await-the-fleet",
  );
  assert(awaited !== undefined);
  assertEquals(awaited.effectful, false);
  assertEquals(awaited.authority_sensitive, false);
});

Deno.test("structural controls reject every incomplete field family", () => {
  const cases: Array<{ field: string; raw: unknown }> = [
    { field: "effectful", raw: withoutField("effectful") },
    { field: "targets", raw: withoutField("targets") },
    {
      field: "sequence",
      raw: {
        ...FULL_CONTRACT,
        sequence: [{
          kind: "verify",
          evidence: { text: "Verify the committed tree." },
        }],
      },
    },
    { field: "stop_conditions", raw: withoutField("stop_conditions") },
    { field: "recovery", raw: withoutField("recovery") },
    { field: "authority", raw: withoutField("authority") },
    { field: "relay_message", raw: withoutField("relay") },
    {
      field: "relay_facts",
      raw: {
        ...FULL_CONTRACT,
        relay: {
          message: { text: "I verified <evidence> on <target>." },
          facts: ["evidence"],
        },
      },
    },
  ];
  for (const fixture of cases) {
    const issues = agentContractStructureIssues(fixture.raw);
    assert(
      issues.some((entry) =>
        entry.field === fixture.field &&
        entry.message.includes("accepted form:")
      ),
      `${fixture.field}: ${JSON.stringify(issues)}`,
    );
  }
});

Deno.test("false classifications reject invented conditional ceremony", () => {
  const cases = [
    {
      ...READ_ONLY_CONTRACT,
      recovery: [{ text: "Retry." }],
    },
    {
      ...READ_ONLY_CONTRACT,
      authority: FULL_CONTRACT.authority,
    },
    {
      ...READ_ONLY_CONTRACT,
      relay: FULL_CONTRACT.relay,
    },
  ];
  for (const contract of cases) {
    const issues = agentContractStructureIssues(contract);
    assert(issues.length > 0, JSON.stringify(contract));
    assert(issues.every((entry) => entry.message.includes("accepted form:")));
  }
});

Deno.test("prose evidence must exist and preserve action order", () => {
  assertEquals(
    agentContractEvidenceIssues(
      FULL_CONTRACT,
      "SKILL.md",
      [fixtureDocument()],
    ),
    [],
  );

  const missing = agentContractEvidenceIssues(
    FULL_CONTRACT,
    "SKILL.md",
    [fixtureDocument(FULL_DOCUMENT_TEXT.replace(
      "If the worktree is absent, report the path and stop.",
      "",
    ))],
  );
  assert(
    missing.some((entry) =>
      entry.field === "recovery" &&
      entry.message.includes("accepted form:")
    ),
    JSON.stringify(missing),
  );

  const reversed = agentContractEvidenceIssues(
    FULL_CONTRACT,
    "SKILL.md",
    [fixtureDocument(
      FULL_DOCUMENT_TEXT.replace(
        "Apply the authorized change.",
        "Verify the committed tree.",
      ).replace(
        /Verify the committed tree\.\s*$/,
        "Apply the authorized change.",
      ),
    )],
  );
  assert(
    reversed.some((entry) =>
      entry.field === "sequence" &&
      entry.message.includes("not ordered")
    ),
    JSON.stringify(reversed),
  );
});

Deno.test("a future setup brief auto-enrolls and fails at its source", async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, "future-setup.md");
    await Deno.writeTextFile(source, "# Future setup\n\nDo the work.\n");
    const surfaces = await operationalSetupSurfaces(dir);
    const future = surfaces.find((surface) =>
      surface.id === "setup:future-setup"
    );
    assert(future !== undefined);
    const failures = operationalContractFailures(dir, [future]);
    assert(
      failures.some((failure) =>
        failure.startsWith("future-setup.md:1:") &&
        failure.includes("missing internal contract field 'effectful'") &&
        failure.includes("accepted form:")
      ),
      failures.join("\n"),
    );
  });
});

Deno.test("a future effectful Skill auto-enrolls and fails at its source", async () => {
  await withTempDir(async (dir) => {
    const name = "future-procedure";
    const sourceDir = join(dir, "skills", name);
    await Deno.mkdir(sourceDir, { recursive: true });
    await Deno.writeTextFile(
      join(sourceDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: Apply a future effectful procedure.\n---\n\n# Future procedure\n`,
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
        failure.includes("missing internal contract field 'effectful'") &&
        failure.includes("accepted form:")
      ),
      failures.join("\n"),
    );
  });
});

Deno.test("internal contract metadata stays out of authored and materialized agent copy", async () => {
  const surfaces = await operationalAgentSurfaces(REPO_ROOT, config);
  const files = operationalAgentCorpusFiles(surfaces);
  assertEquals(await operationalMetadataFailures(REPO_ROOT, files), []);

  await withTempDir(async (dir) => {
    const result = await materializeSkills(dir, config, [".agents/skills"]);
    assertEquals(result.errors, []);
    for (
      const surface of surfaces.filter((entry) => entry.source === "bundled")
    ) {
      const name = surface.id.replace(/^skill:/, "");
      const file = join(dir, ".agents/skills", name, "SKILL.md");
      const text = await Deno.readTextFile(file);
      assert(!text.includes(AGENT_CONTRACT_HEADING), file);
      assertEquals(agentCopyMetadataIssues(file, text), []);
    }
  });
});

Deno.test("metadata detector catches a renamed future sibling and permits an unrelated TOML key", () => {
  const hidden = agentCopyMetadataIssues(
    "future.md",
    "# Future\n\n## Internal policy\n\n```toml\neffectful = true\nrecoverable = true\n```\n",
  );
  assertEquals(hidden.length, 1);
  assertStringIncludes(hidden[0]?.message ?? "", "classification TOML");

  assertEquals(
    agentCopyMetadataIssues(
      "legitimate.md",
      '# Retry config\n\n```toml\nrecoverable = true\nname = "upload"\n```\n',
    ),
    [],
  );
});

Deno.test("generated DiscernAgent rules hold the enrolled non-Map corpus at zero", async () => {
  const surfaces = await operationalAgentSurfaces(REPO_ROOT, config);
  const files = operationalAgentCorpusFiles(surfaces);
  const failures = formatAgentLexicalIssues(
    await agentSurfaceLexicalIssues(REPO_ROOT, files),
  );
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
      ["DiscernAgent.BestJudgment", "DiscernAgent.PositionalReference"],
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
    assertEquals(await agentSurfaceLexicalIssues(REPO_ROOT, [literal]), []);
  });
});

Deno.test("supporting Skill Markdown auto-enrolls while skeleton payloads do not", async () => {
  await withTempDir(async (dir) => {
    const sourceDir = join(dir, "future-guide");
    await Deno.mkdir(join(sourceDir, "notes"), { recursive: true });
    await Deno.mkdir(join(sourceDir, "skeleton"), { recursive: true });
    await Deno.writeTextFile(join(sourceDir, "SKILL.md"), "# Guide\n");
    await Deno.writeTextFile(
      join(sourceDir, "notes", "procedure.md"),
      "# Procedure\n",
    );
    await Deno.writeTextFile(
      join(sourceDir, "skeleton", "payload.md"),
      "# Payload\n",
    );
    const skill: SkillEntry = {
      name: "future-guide",
      source: "authored",
      srcAbs: sourceDir,
      overrides_bundled: false,
    };
    const surface = await operationalSkillSurface(skill);
    assertEquals(
      surface.sourceFiles.map((file) => file.slice(sourceDir.length + 1)),
      ["SKILL.md", "notes/procedure.md"],
    );
    assertEquals(
      NON_OPERATIONAL_AGENT_SEGMENTS.get("skeleton"),
      "files copied into a project are output templates, not operational instructions followed in place",
    );
  });
});
