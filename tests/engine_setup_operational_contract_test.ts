/** Registry-driven guards for setup's bounded operational journey. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { walk } from "@std/fs";
import {
  recommendSetupDocumentationScope,
  SETUP_READINESS_CATEGORIES,
  SETUP_REPORTER_EXAMPLES,
  setupReporterAction,
} from "../src/shared/setup_guidance.ts";
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
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  SetupDoneDataSchema,
  SetupDoneOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  renderResultMarkdown,
  RESULT_MARKDOWN_PRESENTERS,
} from "../src/shared/result_markdown.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const BRIEF = join(REAL_TEMPLATES, "setup", "instructions.md");

Deno.test("every setup page projects the complete operational spine into its human rendering", async () => {
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
  }
});

Deno.test("setup's stable page graph gathers evidence before synthesis and smokes before final documentation", async () => {
  const brief = parseSetupBrief(await Deno.readTextFile(BRIEF));
  const order = brief.pages.map((page) => page.step);
  assertEquals(order, SETUP_PAGE_REGISTRY.map((entry) => entry.step));
  assert(order.indexOf(1) < order.indexOf(7));
  assert(order.indexOf(8) < order.indexOf(6));
  assert(
    brief.pages.find((page) => page.step === 8)?.spine.what_not_to_do.some(
      (action) => action.includes("bare `discern start`"),
    ),
  );
  const probeActions = brief.pages.find((page) => page.step === 8)?.spine
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
  assertThrows(
    () => recommendSetupDocumentationScope([], []),
    Error,
    "exactly one primary",
  );
});

Deno.test("shipped setup relay choices stay neutral and keep each consent fact atomic", () => {
  const context = {
    worktreePath: "/repo.worktrees",
    docsExists: false,
    gitRepo: true,
    agents: {
      wired: [{ label: "Codex", name: "codex" }],
      detected: true,
    },
  } as const;
  const relay = consentRelayItems(context);
  const confirmations = consentConfirmations(context);
  const message = consentMessage(context);
  assertEquals(
    relay.map((item) => item.id),
    [
      "quality",
      "worktrees",
      "instructions",
      "footprint",
      "plan",
      "reversibility",
    ],
  );
  assert(confirmations.some((item) => item.id === "cost"));
  for (const item of relay) assert(message.includes(`- ${item.text}`));
  for (const [index, item] of confirmations.entries()) {
    assert(message.includes(`${index + 1}. ${item.text}`));
  }
  const forbidden = /most capable|\bexpert\b|\bqualified\b|\bsafe model\b/i;
  for (const item of confirmations) {
    assert(!forbidden.test(item.text), `self-certifying option: ${item.text}`);
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
      join(dir, SOURCE_PATHS.map.defaultPath, "00-orientation"),
      {
        recursive: true,
      },
    );
    await Deno.mkdir(join(dir, SOURCE_PATHS.map.defaultPath, "10-runtime"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(dir, SOURCE_PATHS.todo.defaultPath),
      "# Open work\n\n- [ ] **Resolve retries.** Evidence: src/retry.ts\n" +
        "- [x] **Finished item.** remove me\n" +
        "- [ ] Plain unresolved decision\n",
    );
    const done = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(done.code, 0, done.output);
    const envelope = SetupDoneOutputSchema.parse(JSON.parse(done.stdout));
    const data = SetupDoneDataSchema.parse(envelope.data);
    const inventory = data.inventory;
    assert(done.stdout.length <= SETUP_RESULT_MAX_CHARS);
    assertEquals(inventory.map_regions, {
      count: 2,
      items: ["00-orientation", "10-runtime"],
    });
    assertEquals(inventory.ledger_items, {
      count: 2,
      items: ["Resolve retries.", "Plain unresolved decision"],
    });
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
    const human = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(human.code, 0, human.output);
    assert(human.output.length <= SETUP_RESULT_MAX_CHARS);
    const markdown = await runAgent(dir, [
      "setup",
      "done",
      "--force",
      "--markdown",
    ]);
    assertEquals(markdown.code, 0, markdown.output);
    assert(markdown.stdout.includes("without Gate Proof"));
    assert(markdown.stdout.includes("Map regions"));
    assert(!markdown.stdout.includes("discern setup accept"));
    assert(!markdown.stdout.includes("discern improvement"));
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
  const falseClaims: string[] = [];
  for await (const entry of walk(REAL_TEMPLATES, { includeDirs: false })) {
    const text = await Deno.readTextFile(entry.path);
    if (
      /discern start[^\n]*(moves you|changes (?:the )?directory)/i.test(text)
    ) {
      falseClaims.push(entry.path);
    }
  }
  assertEquals(falseClaims, []);
  const commandSurface = await Deno.readTextFile(
    join(REPO_ROOT, "src", "engine", "dispatch.ts"),
  );
  assert(commandSurface.includes("then print its path"));
  assert(
    !/discern start[^.\n]*(moves you|changes (?:the )?directory)/i.test(
      commandSurface,
    ),
  );
  const rootHelp = await Deno.readTextFile(join(REPO_ROOT, "src", "main.ts"));
  assert(rootHelp.includes("re-root at the returned worktree path"));
  assert(
    !/discern start[^.\n]*(moves you|changes (?:the )?directory)/i.test(
      rootHelp,
    ),
  );
  for (
    const rel of [
      "setup/skeleton/docs/80-development/README.md",
      "setup/skeleton/docs/80-development/getting-started.md",
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
