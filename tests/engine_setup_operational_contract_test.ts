/** Registry-driven guards for setup's bounded operational journey. */

import { commitSetupAuthoring } from "./fixtures/setup_completion_harness.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  authorizeSetupExternalInspection,
  classifySetupReferencedPath,
  inspectSetupExternalReference,
  recommendSetupDocumentationScope,
  recommendSetupProjectName,
  SETUP_READINESS_CATEGORIES,
  SETUP_REPORTER_EXAMPLES,
  setupReporterAction,
} from "../src/shared/setup_guidance.ts";
import {
  assertSetupHumanSurfaceConsumption,
  projectSetupHumanMoment,
  renderSetupOwnerMoment,
  selectSetupRecommendation,
  SETUP_DECISION_DELEGATION,
  SETUP_DECISION_KINDS,
  SETUP_HUMAN_MOMENTS,
  SETUP_HUMAN_SURFACES,
  setupHumanMomentFactIds,
  SetupHumanMomentSchema,
  setupHumanMomentsForSurface,
  type SetupHumanSurface,
  validateSetupHumanMomentRegistry,
} from "../src/shared/setup_experience.ts";
import {
  parseSetupBrief,
  renderSetupPage,
  SETUP_PAGE_REGISTRY,
  SETUP_RESULT_MAX_CHARS,
} from "../src/shared/setup_pages.ts";
import {
  consentConfirmations,
  consentMessage,
  consentRelayItems,
} from "../src/shared/setup_messages.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  deriveSetupPrimarySubsystem,
  deriveSetupProjectContext,
} from "../src/shared/setup_project_context.ts";
import {
  SetupDoneDataSchema,
  SetupDoneOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  renderResultMarkdown,
  RESULT_MARKDOWN_PRESENTERS,
} from "../src/shared/result_markdown.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { providerSetupFacts } from "../src/lib/providers.ts";
import {
  assertSetupResultNextAction,
  isSingleRunnableSetupCommand,
} from "../src/shared/setup_next_action.ts";

const BRIEF = join(REAL_TEMPLATES, "setup", "instructions.md");

Deno.test("every setup result route is one runnable command", () => {
  for (
    const command of [
      "discern setup begin",
      "discern setup begin --name 'A name; still one argument' --confirmed",
      "git init",
      "git checkout discern-setup",
    ]
  ) {
    assert(
      isSingleRunnableSetupCommand(command),
      `expected one runnable setup command: ${command}`,
    );
    assertSetupResultNextAction({
      verb: "setup begin",
      data: { next_action: command },
    });
  }
  for (
    const compound of [
      "git init && discern setup verify",
      "git checkout main; discern setup begin",
      "discern setup begin | tee setup.log",
      "discern $(printf setup)",
      "discern `printf setup`",
      "discern setup\ndiscern status",
    ]
  ) {
    assert(
      !isSingleRunnableSetupCommand(compound),
      `compound setup route escaped the guard: ${compound}`,
    );
    assertThrows(
      () =>
        assertSetupResultNextAction({
          verb: "setup done",
          data: { next_action: compound },
        }),
      Error,
      "one runnable data.next_action",
    );
  }
  assertThrows(
    () => assertSetupResultNextAction({ verb: "setup verify" }),
    Error,
    "one runnable data.next_action",
  );
});

Deno.test("setup's shipped journey carries no retired pillar or dispatcher vocabulary", async () => {
  const files = await structuralGuardScope({
    guard:
      "tests/engine_setup_operational_contract_test.ts#retired-setup-vocabulary",
    universe: "authored-text",
    narrow: {
      reason:
        "The setup relay and skeleton are the only surfaces governed by this retired first-use vocabulary.",
      include: (rel) =>
        rel.startsWith("templates/setup/") ||
        rel === "src/shared/setup_messages.ts" ||
        rel === "src/shared/hints.ts",
    },
  });
  const offenders: string[] = [];
  for (const rel of files) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\bpillars?\b|\bdispatcher\b/iu.test(source)) offenders.push(rel);
  }
  assertEquals(offenders, []);
});

Deno.test("setup pages form one sequential numbered journey", () => {
  assertEquals(
    SETUP_PAGE_REGISTRY.map((entry) => entry.step),
    SETUP_PAGE_REGISTRY.map((_, index) => index),
    "setup page numbers must follow their presentation order",
  );
  assertEquals(
    SETUP_PAGE_REGISTRY.map((entry) => entry.nextCommand),
    SETUP_PAGE_REGISTRY.map((_, index, entries) =>
      index === entries.length - 1
        ? "discern setup done"
        : `discern setup step ${index + 1}`
    ),
    "each page must name the next sequential command",
  );
  assertEquals(
    SETUP_HUMAN_SURFACES.filter((surface) => surface.startsWith("step-")),
    SETUP_PAGE_REGISTRY.map((entry) => `step-${entry.step}`),
    "every numbered page must enroll in the human-moment surface registry",
  );
});

Deno.test("the shipped Map seed teaches a responsibility hierarchy with optional numbering", async () => {
  const body = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup/skeleton/map/README.md"),
  );
  assertStringIncludes(body, "Extend the closest existing section first");
  assertStringIncludes(body, "Numbered folders are an optional reading order");
  assertStringIncludes(body, "orientation/README.md");
  assertStringIncludes(body, "development/README.md");
});

Deno.test("every setup human moment carries its complete semantic contract", () => {
  validateSetupHumanMomentRegistry(SETUP_HUMAN_MOMENTS);

  const futureSibling = {
    id: "storage-selection",
    surfaces: ["step-1"],
    kind: "decision",
    decision_kind: "documentation-claim-gap",
    phase: "project inspection",
    applicability: {
      kind: "when",
      evidence_id: "storage-choice",
      condition: "Two durable storage systems remain viable.",
    },
    purpose: "Choose the project's durable storage system.",
    owner_outcome: "Future sessions configure the chosen storage system.",
    why: "A silent storage choice would constrain later data work.",
    current_action: "Compare the supported contract and migration consequence.",
    authority: "The owner chooses which data contract the project adopts.",
    reversibility: "Changing later requires a data migration.",
    recovery: "Keep both candidates unconfigured and preserve the evidence.",
    recommendation: "Choose the existing project-supported system.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Configure only the storage system the owner chooses.",
    },
    options: [
      {
        id: "existing",
        label: "Use existing storage",
        consequence: "Setup preserves the current data contract.",
        owner_action: "Confirm the existing storage contract.",
        agent_action: "Keep the current storage wiring.",
        recommended: true,
      },
      {
        id: "replacement",
        label: "Choose replacement storage",
        consequence: "Setup records the migration as unresolved.",
        owner_action: "Choose the replacement contract.",
        agent_action: "Record the migration consequence without applying it.",
        recommended: false,
      },
    ],
    relay: {
      protection: "verbatim-list",
      message:
        "Choose whether the current contract stays or the migration consequence remains open.",
      experienced:
        "Keep the current storage contract or retain the migration as an open decision.",
    },
  } as const;
  assert(
    SetupHumanMomentSchema.safeParse(futureSibling).success,
    "the unrelated future decision is a valid positive control",
  );

  const missingWhy = structuredClone(futureSibling) as Record<string, unknown>;
  delete missingWhy.why;
  const missingCurrentAction = structuredClone(futureSibling) as Record<
    string,
    unknown
  >;
  delete missingCurrentAction.current_action;
  const missingWait = structuredClone(futureSibling) as Record<string, unknown>;
  delete missingWait.agent_behavior;
  const missingOwnerAction = structuredClone(futureSibling);
  delete (missingOwnerAction.options[0] as { owner_action?: string })
    .owner_action;
  const missingAgentAction = structuredClone(futureSibling);
  delete (missingAgentAction.options[0] as { agent_action?: string })
    .agent_action;
  const selfCertifying = structuredClone(futureSibling);
  (selfCertifying.options[0] as { label: string }).label =
    "I am the most capable model";
  for (
    const [role, candidate] of [
      ["why", missingWhy],
      ["current action", missingCurrentAction],
      ["wait boundary", missingWait],
      ["owner action", missingOwnerAction],
      ["agent action", missingAgentAction],
      ["neutral option label", selfCertifying],
    ] as const
  ) {
    assert(
      !SetupHumanMomentSchema.safeParse(candidate).success,
      `a future decision must fail without its ${role}`,
    );
  }
  assertThrows(
    () => assertSetupHumanSurfaceConsumption("welcome", ["first-use-value"]),
    Error,
    "model-selection",
    "a fixed lifecycle consumer must fail when it omits a registered sibling",
  );
});

Deno.test("every setup page projects its operational spine and stable semantic fact ids", async () => {
  const brief = parseSetupBrief(await Deno.readTextFile(BRIEF));
  for (const page of brief.pages) {
    const rendered = renderSetupPage(page);
    const markdown = renderResultMarkdown(
      { ok: true, verb: "setup step", data: page },
      RESULT_MARKDOWN_PRESENTERS.setupStep,
    );
    const facts = [
      page.spine.phase,
      page.spine.stable_target,
      ...page.spine.files_to_read,
      ...page.spine.must_do,
      ...page.spine.authority_boundaries,
      ...page.spine.human_decisions,
      ...page.spine.what_not_to_do,
      page.spine.completion_check,
      ...page.spine.stop_conditions,
      ...page.spine.recovery,
      ...(page.spine.relay ?? []),
      page.spine.next_action,
    ];
    const moments = setupHumanMomentsForSurface(
      `step-${page.step}` as SetupHumanSurface,
    );
    assertEquals(
      page.spine.owner_moments,
      moments.map(projectSetupHumanMoment),
      `Step ${page.step} must derive its typed moment state from the registry`,
    );
    for (const fact of facts) {
      assert(
        rendered.includes(fact),
        `Step ${page.step} human rendering dropped: ${fact}`,
      );
      assert(
        markdown.includes(fact),
        `Step ${page.step} Markdown rendering dropped: ${fact}`,
      );
    }
    for (const moment of moments) {
      const projection = projectSetupHumanMoment(moment);
      assertEquals(
        projection.fact_ids,
        setupHumanMomentFactIds(moment),
        `${moment.id} must derive fact enrollment without English matching`,
      );
      assert(rendered.includes(moment.owner_outcome));
      assert(rendered.includes(moment.authority));
      assert(rendered.includes(moment.reversibility));
      assert(rendered.includes(moment.recovery));
    }
  }
});

Deno.test("conditional owner moments emit neither a decision nor wait without trigger evidence", () => {
  const conditional = SETUP_HUMAN_MOMENTS.find((moment) =>
    moment.id === "worktree-resource-policy"
  );
  assert(conditional !== undefined);
  assertEquals(renderSetupOwnerMoment(conditional, "novice"), undefined);
  assertEquals(
    renderSetupOwnerMoment(conditional, "novice", {
      evidenceId: "worktree-resource-consequence",
      satisfied: false,
      detail: "No shared resource or durable-data collision was found.",
    }),
    undefined,
  );
  const served = renderSetupOwnerMoment(conditional, "novice", {
    evidenceId: "worktree-resource-consequence",
    satisfied: true,
    detail: "Two tasks would mutate the same database.",
  });
  assert(served !== undefined);
  assert(served.waitsForOwner);
});

Deno.test("every decision kind has a closed delegation policy and consequential kinds reject the action", () => {
  assertEquals(
    Object.keys(SETUP_DECISION_DELEGATION).sort(),
    [
      ...SETUP_DECISION_KINDS,
    ].sort(),
  );
  const decisions = SETUP_HUMAN_MOMENTS.filter((moment) =>
    moment.kind === "decision"
  );
  assertEquals(
    decisions.map((moment) => moment.decision_kind).sort(),
    [...SETUP_DECISION_KINDS].sort(),
  );
  for (
    const consequential of [
      "model-selection",
      "project-intent-gap",
      "gate-protection-change",
      "authored-source-collision",
      "owner-policy-conflict",
      "worktree-resource-policy",
      "external-reference-inspection",
      "landing-choice",
    ] as const
  ) {
    assertEquals(
      SETUP_DECISION_DELEGATION[consequential].allowed,
      false,
      `${consequential} must retain an explicit owner choice`,
    );
  }
  for (const moment of decisions) {
    if (moment.kind !== "decision") continue;
    const policy = SETUP_DECISION_DELEGATION[moment.decision_kind];
    if (policy.allowed) {
      const selection = selectSetupRecommendation(moment, "use-recommendation");
      assert(selection.ownerDirected);
      assertEquals(
        selection.selectedOption,
        moment.options.find((option) => option.recommended)?.id,
      );
    } else {
      assertThrows(
        () => selectSetupRecommendation(moment, "use-recommendation"),
        Error,
        policy.reason,
      );
    }
  }
});

Deno.test("project identity prefers repository metadata over a clone suffix and still requires confirmation", () => {
  const recommendation = recommendSetupProjectName([
    { source: "readme-title", value: "Atlas", location: "README.md" },
    { source: "package-name", value: "Atlas", location: "package.json" },
    {
      source: "directory-fallback",
      value: "atlas-copy-2",
      location: ".",
    },
  ]);
  assertEquals(recommendation.proposed, "Atlas");
  assertEquals(recommendation.fallbackOnly, false);
  assertEquals(recommendation.evidence.length, 2);
});

Deno.test("repository-external references are reported before any destination read", async () => {
  const reference = classifySetupReferencedPath(
    "/project",
    "config/local.json",
    "/other/checkout/data.json",
    "a source-data checkout",
  );
  assertEquals(reference.location, "outside-project");
  assertEquals(reference.destinationReadAllowed, false);
  assertEquals(
    classifySetupReferencedPath(
      "/project",
      "config/local.json",
      "../../other/checkout/data.json",
      "a source-data checkout",
    ).location,
    "outside-project",
  );
  assertEquals(
    classifySetupReferencedPath(
      "/project",
      "config/local.json",
      "../data/project.json",
      "project data",
    ).location,
    "inside-project",
  );
  let reads = 0;
  await assertRejects(
    async () => {
      await inspectSetupExternalReference(reference, undefined, () => {
        reads += 1;
        return Promise.resolve("unexpected");
      });
    },
    Error,
    "Owner direction is required",
  );
  assertEquals(reads, 0);

  const direction = authorizeSetupExternalInspection(
    reference,
    "confirm whether the project depends on that data layout",
  );
  const value = await inspectSetupExternalReference(
    reference,
    direction,
    (path) => {
      reads += 1;
      return Promise.resolve(path);
    },
  );
  assertEquals(value, "/other/checkout/data.json");
  assertEquals(reads, 1);
});

Deno.test("setup's sequential page graph gathers evidence before synthesis and smokes before final documentation", async () => {
  const brief = parseSetupBrief(await Deno.readTextFile(BRIEF));
  const order = brief.pages.map((page) => page.step);
  assertEquals(order, SETUP_PAGE_REGISTRY.map((entry) => entry.step));
  assert(order.indexOf(1) < order.indexOf(6));
  assert(order.indexOf(7) < order.indexOf(8));
  assert(
    brief.pages.find((page) => page.step === 7)?.spine.what_not_to_do.some(
      (action) => action.includes("bare `discern start`"),
    ),
  );
  const probeActions = brief.pages.find((page) => page.step === 7)?.spine
    .must_do.join(" ") ?? "";
  assert(probeActions.includes("structural worktree probe"));
  assert(probeActions.includes("committed completion-marker HEAD"));
});

Deno.test("worktree readiness keeps every resource class distinct, including tracked binary databases", () => {
  assertEquals(
    SETUP_READINESS_CATEGORIES.map((category) => category.id),
    [
      "untracked-file-database",
      "tracked-binary-database",
      "local-service",
      "hosted-shared-service",
      "environment",
      "dependencies",
      "ports",
      "owner-gated-resource",
    ],
  );
  const tracked = SETUP_READINESS_CATEGORIES.find((category) =>
    category.id === "tracked-binary-database"
  );
  assert(tracked?.inspect.includes("concurrent worktrees"));
  assert(tracked?.inspect.includes("binary merges"));
  assert(tracked?.response.includes("no provisioning recipe"));
});

Deno.test("reporter policy keeps green output concise and never masks failure status", () => {
  const decisions = Object.fromEntries(
    SETUP_REPORTER_EXAMPLES.map((example) => [
      example.family,
      setupReporterAction(example.profile),
    ]),
  );
  assertEquals(decisions["JUnit or XML written only to a file"], "normal");
  assertEquals(
    decisions["Bounded JSON stream on stdout or stderr"],
    "structured",
  );
  assertEquals(decisions["TAP-like normal output"], "normal");
  assertEquals(
    decisions["Inherently verbose structured mode"],
    "structured-on-failure",
  );
  assertEquals(decisions["Wrapper that masks the original status"], "normal");
  assertEquals(
    setupReporterAction({
      recognized: true,
      captured: true,
      preservesExitStatus: true,
      improvesFailureDiagnostics: false,
      normalOutputMachineReadable: false,
      structuredOutputVerbose: false,
      failureOnlyAvailable: false,
    }),
    "normal",
  );
});

Deno.test("documentation scope meets the primary floor without rewarding repository size or generic TODOs", () => {
  const primary = {
    name: "runtime",
    primary: true,
    durable: true,
    reducesFutureReading: true,
  } as const;
  assertEquals(recommendSetupDocumentationScope([primary], []).pages, [
    "runtime",
  ]);
  const medium = recommendSetupDocumentationScope([
    primary,
    {
      name: "delivery",
      primary: false,
      durable: true,
      reducesFutureReading: true,
    },
    {
      name: "helpers",
      primary: false,
      durable: false,
      reducesFutureReading: false,
    },
  ], [
    {
      title: "Improve the project someday",
      evidence: "A general aspiration",
      kind: "aspiration",
      alreadyExpressedByConfig: false,
    },
    {
      title: "The formatter is configured",
      evidence: "discern.toml already records it",
      kind: "fact",
      alreadyExpressedByConfig: true,
    },
    {
      title: "Resolve retry ownership",
      evidence: "two implementations differ",
      kind: "decision",
      alreadyExpressedByConfig: false,
    },
  ]);
  assertEquals(medium.pages, ["runtime", "delivery"]);
  assertEquals(medium.ledgerItems, ["Resolve retry ownership"]);
  assertEquals(recommendSetupDocumentationScope([], []), {
    pages: [],
    ledgerItems: [],
  });
  assertThrows(
    () =>
      recommendSetupDocumentationScope([{ ...primary, primary: false }], []),
    Error,
    "exactly one primary",
  );
});

Deno.test("shipped setup relay choices stay neutral and keep each consent fact atomic", () => {
  const facts = providerSetupFacts("codex");
  const context = {
    worktreePath: "/repo.worktrees",
    worktreeEnvFiles: [".env", ".env.local"],
    inheritedEnvNames: [],
    docsExists: false,
    gitRepo: true,
    agents: {
      wired: [{
        label: facts.label,
        name: facts.agent,
        instructionFile: facts.instructionFile,
        writtenFiles: facts.writtenFiles,
        ...(facts.generatedSkillsDir === undefined
          ? {}
          : { generatedSkillsDir: facts.generatedSkillsDir }),
        trust: facts.trust,
        disclosures: facts.disclosures,
      }],
      evidence: "detected-on-this-machine",
    },
  } as const;
  const relay = consentRelayItems(context);
  const confirmations = consentConfirmations(context);
  const message = consentMessage(context);
  assertEquals(
    relay.map((item) => item.key),
    [
      "lasting-outcome",
      "footprint",
      "repository-boundary",
      "provider-codex-1",
      "provider-codex-2",
      "plan",
      "reversibility",
    ],
  );
  assert(confirmations.some((item) => item.key === "cost"));
  assert(message.includes("Current provider/model (self-declared)"));
  assert(message.includes("never copy the placeholder"));
  for (const item of relay) assert(message.includes(`- ${item.message}`));
  for (const [index, item] of confirmations.entries()) {
    assert(message.includes(`${index + 1}. ${item.message}`));
  }
  const forbidden = /most capable|\bexpert\b|\bqualified\b|\bsafe model\b/i;
  for (const item of confirmations) {
    assert(
      !forbidden.test(item.message),
      `self-certifying option: ${item.message}`,
    );
  }
});

Deno.test("setup preserves an existing project aggregate command byte-for-byte", async () => {
  await withTempDir(async (dir) => {
    const projectFile = join(dir, "deno.json");
    const original =
      '{\n  "tasks": { "check": "deno fmt --check && deno test" }\n}\n';
    await Deno.writeTextFile(projectFile, original);
    await Deno.writeTextFile(join(dir, "main.ts"), "export const value = 1;\n");
    await gitInit(dir);
    const result = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--model",
      "unreported",
    ]);
    assertEquals(result.code, 0, result.output);
    assertEquals(await Deno.readTextFile(projectFile), original);
  });
});

Deno.test("setup completion carries canonical Map, ledger, and job inventories", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(
      join(dir, SOURCE_PATHS.map.defaultPath, "orientation"),
      {
        recursive: true,
      },
    );
    await Deno.mkdir(join(dir, SOURCE_PATHS.map.defaultPath, "10-runtime"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, SOURCE_PATHS.map.defaultPath, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin at `src/runtime.ts`.\n\n" +
        "## Boundary\n\nThe runtime owns command execution.\n\n" +
        "## Non-obvious invariant\n\nEvery command preserves child exit status.\n",
    );
    await Deno.writeTextFile(
      join(
        dir,
        SOURCE_PATHS.map.defaultPath,
        "orientation",
        "design-principles.md",
      ),
      "# Design principles\n\n## 1. Preserve status\n\nA rule.\n\n" +
        "## 2. Plan effects\n\nAnother rule.\n\n" +
        "## 3. Keep context current\n\nA third rule.\n",
    );
    await Deno.writeTextFile(
      join(dir, SOURCE_PATHS.todo.defaultPath),
      "# Open work\n\n- [ ] **Resolve retries.** Evidence: src/retry.ts\n" +
        "- [x] **Finished item.** remove me\n" +
        "- [ ] Plain unresolved decision\n",
    );
    await gitInit(dir);
    const done = await runAgent(dir, ["setup", "done", "--unproven", "--json"]);
    assertEquals(done.code, 0, done.output);
    const envelope = decodeCliResult(done.stdout, "setup done");
    const data = SetupDoneDataSchema.parse(envelope.data);
    const inventory = data.inventory;
    assert(done.stdout.length <= SETUP_RESULT_MAX_CHARS);
    assertEquals(inventory.map_regions, {
      count: 2,
      items: ["10-runtime", "orientation"],
    });
    assertEquals(inventory.ledger_items, {
      count: 2,
      items: ["Resolve retries.", "Plain unresolved decision"],
    });
    assertEquals(inventory.project_context.primary_subsystem?.title, "Runtime");
    assertEquals(inventory.project_context.principles.items, [
      "Preserve status",
      "Plan effects",
      "Keep context current",
    ]);
    assertEquals(inventory.project_context.instruction_sources, [
      SOURCE_PATHS.instructions.defaultPath,
    ]);
    const jobCount = Object.values(inventory.jobs).flat().length;
    assert(jobCount > 0);
    const contradictory = {
      ...envelope,
      data: {
        ...data,
        optional_improvement: {
          verb: "improvement",
          command: "discern improvement --json",
          after: "activation_verified",
        },
      },
    };
    assert(
      !SetupDoneOutputSchema.safeParse(contradictory).success,
      "a forced result must not validate with pre-activation improvement advice",
    );
    await commitSetupAuthoring(dir);
    const human = await runAgent(dir, ["setup", "done", "--unproven"]);
    assertEquals(human.code, 0, human.output);
    assert(human.output.length <= SETUP_RESULT_MAX_CHARS);
    const markdown = await runAgent(dir, [
      "setup",
      "done",
      "--unproven",
      "--markdown",
    ]);
    assertEquals(markdown.code, 0, markdown.output);
    assert(markdown.stdout.includes("without gate Proof"));
    assert(markdown.stdout.includes("project-guide areas"));
    assert(!markdown.stdout.includes("discern setup accept"));
    assert(!markdown.stdout.includes("discern improvement"));
  });
});

Deno.test("setup qualitative completion context derives from the first durable subsystem authority", async () => {
  await withTempDir(async (dir) => {
    const mapDir = "discern/map";
    await Deno.mkdir(join(dir, mapDir, "orientation"), {
      recursive: true,
    });
    await Deno.mkdir(join(dir, mapDir, "10-runtime"), { recursive: true });
    await Deno.mkdir(join(dir, mapDir, "development"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, mapDir, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin at `src/runtime.ts`.\n\n" +
        "## Boundary\n\nOwns command execution.\n\n" +
        "## Non-obvious invariant\n\nPreserve child status.\n",
    );
    await Deno.writeTextFile(
      join(dir, mapDir, "orientation", "design-principles.md"),
      "# Principles\n\n## 1. Preserve status\n\nText.\n\n" +
        "## 2. Plan effects\n\nText.\n\n" +
        "## What these add up to\n\nSummary.\n",
    );
    const context = await deriveSetupProjectContext(
      dir,
      mapDir,
      ["discern/instructions.md"],
    );
    assertEquals(context.primary_subsystem?.region, "10-runtime");
    assertEquals(
      context.primary_subsystem?.start_here,
      "Begin at `src/runtime.ts`.",
    );
    assertEquals(
      context.primary_subsystem?.boundary,
      "Owns command execution.",
    );
    assertEquals(
      context.primary_subsystem?.non_obvious_invariant,
      "Preserve child status.",
    );
    assertEquals(context.principles.items, ["Preserve status", "Plan effects"]);

    await Deno.writeTextFile(
      join(dir, mapDir, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin here.\n\n## Boundary\n\nOwns execution.\n",
    );
    const withoutConstraint = await deriveSetupPrimarySubsystem(dir, mapDir);
    assert(withoutConstraint !== null);
    assertEquals(withoutConstraint.boundary, "Owns execution.");
    assertEquals(withoutConstraint.non_obvious_invariant, "");
  });
});

Deno.test("first MCP registration during unfinished setup defers restart to the landing handoff", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "export const value = 1;\n");
    await gitInit(dir);
    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--model",
      "unreported",
      "--json",
    ]);
    assertEquals(begin.code, 0, begin.output);
    const serialized = begin.stdout;
    assert(!serialized.includes("Restart your coding agent now"));
    assert(serialized.includes("do not restart now"), serialized);
  });
});

Deno.test("every shipped start description states that start returns a path", async () => {
  const files = await structuralGuardScope({
    guard:
      "tests/engine_setup_operational_contract_test.ts#start-path-descriptions",
    universe: "authored-text",
    narrow: {
      reason:
        "This wording contract governs shipped templates and the two CLI command descriptions.",
      include: (rel) =>
        rel.startsWith("templates/") ||
        rel === "src/engine/dispatch.ts" ||
        rel === "src/main.ts",
    },
  });
  const falseClaims: string[] = [];
  for (const rel of files.filter((path) => path.startsWith("templates/"))) {
    const text = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (
      /discern start[^\n]*(moves you|changes (?:the )?directory)/i.test(text)
    ) {
      falseClaims.push(rel);
    }
  }
  assertEquals(falseClaims, []);
  const commandSurface = await Deno.readTextFile(
    join(REPO_ROOT, "src/engine/dispatch.ts"),
  );
  assert(commandSurface.includes("then print its path"));
  assert(
    !/discern start[^.\n]*(moves you|changes (?:the )?directory)/i.test(
      commandSurface,
    ),
  );
  const rootHelp = await Deno.readTextFile(join(REPO_ROOT, "src/main.ts"));
  assert(rootHelp.includes("re-root at the returned worktree path"));
  assert(
    !/discern start[^.\n]*(moves you|changes (?:the )?directory)/i.test(
      rootHelp,
    ),
  );
  for (
    const rel of [
      "setup/skeleton/map/development/getting-started.md",
    ]
  ) {
    assert(
      (await Deno.readTextFile(join(REAL_TEMPLATES, rel))).includes(
        "returns its path",
      ),
      rel,
    );
  }
});
