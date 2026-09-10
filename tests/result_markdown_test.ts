import { completionEconomics } from "../src/engine/logbook/completion_economics.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  CLI_JSON_RESULT_CONTRACTS,
  resultPresenterForVerb,
} from "../src/shared/result_contracts.ts";
import { dryRunCapableVerbs } from "../src/main.ts";
import {
  renderResultMarkdown,
  type ResultMarkdownPresenter,
} from "../src/shared/result_markdown.ts";
import {
  defineHint,
  fire,
  fireOwnerAttention,
  type HintDef,
  HINTS,
  hintTexts,
} from "../src/shared/hints.ts";
import {
  checkoutOutcomeSentence,
  retainedCheckoutExplanation,
} from "../src/shared/result_completion.ts";
import { projectStatusResult } from "../src/shared/result_wire.ts";
import {
  ACCEPT_LANDING_STATE_FIELDS,
  AcceptDataSchema,
  StatusOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  confirmedBeginCommand,
  confirmedBeginCommandReference,
} from "../src/shared/setup_messages.ts";
import { extractCommandRefs } from "../src/shared/command_reference.ts";
import { productSentence } from "../src/shared/product_sentence.ts";

const PROOF_SENTINEL = "FULL-PROOF-PAGE".repeat(8_000);
const DRY_RUN_LEAD = "**Dry run: nothing changed.**";

Deno.test("routine diagnostics keep distinct failing rules visible among repeated instances", () => {
  const diagnostics = [
    {
      tool: "validator",
      severity: "warning",
      message: "Advisory finding.",
      reproduce_cmd: "inspect-advice",
      output: "WARNING_OUTPUT",
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      tool: "validator",
      severity: "error",
      rule: "checkout-exclusion",
      message: "The checkout lock is occupied.",
      reproduce_cmd: "discern status --verbose",
      output_path: "/tmp/lock-evidence-" + index,
    })),
    {
      tool: "validator",
      severity: "error",
      rule: "required-measurement",
      message: "The required measurement failed.",
      reproduce_cmd: "inspect-measurement",
    },
  ];
  const original = structuredClone(diagnostics);
  const rendered = renderResultMarkdown({
    ok: false,
    verb: "future",
    diagnostics,
  }, resultPresenterForVerb("future"));
  assertStringIncludes(rendered, "required-measurement");
  assertStringIncludes(rendered, "/tmp/lock-evidence-0");
  assertStringIncludes(rendered, "/tmp/lock-evidence-1");
  assertStringIncludes(rendered, "7 additional diagnostics omitted");
  assertEquals(rendered.includes("WARNING_OUTPUT"), false);
  assertEquals(diagnostics, original);
});

Deno.test("routine diagnostics coalesce exact repeats and preserve distinct evidence", () => {
  const repeated = {
    tool: "validation",
    severity: "error",
    message: "The checkout lock is occupied.",
    reproduce_cmd: "discern status --verbose",
    output_path: "/tmp/lock-evidence",
  };
  const diagnostics = [
    ...Array.from({ length: 8 }, () => ({ ...repeated })),
    { ...repeated, output_path: "/tmp/another-lock-evidence" },
    {
      ...repeated,
      message: "The required measurement failed.",
      rule: "required-measurement",
    },
  ];
  const original = structuredClone(diagnostics);
  const rendered = renderResultMarkdown({
    ok: false,
    verb: "future",
    diagnostics,
  }, resultPresenterForVerb("future"));
  assertStringIncludes(rendered, "Repeated 8 times.");
  assertStringIncludes(rendered, "/tmp/another-lock-evidence");
  assertStringIncludes(rendered, "required-measurement");
  assertEquals(rendered.includes("diagnostics omitted"), false);
  assertEquals(diagnostics, original);
});

Deno.test("routine diagnostic summaries bound large messages while preserving structured evidence", () => {
  const diagnostics = Array.from({ length: 20 }, (_, index) => ({
    tool: "future-check",
    severity: "error",
    rule: `finding-${index}`,
    message: `Finding ${index}: ${"detailed evidence ".repeat(2000)}`,
    reproduce_cmd: `run-focused-check ${index}`,
    output_path: `/tmp/evidence-${index}`,
  }));
  const original = structuredClone(diagnostics);
  const rendered = renderResultMarkdown({
    ok: false,
    verb: "future",
    diagnostics,
  }, resultPresenterForVerb("future"));
  assert(
    rendered.length < 8000,
    `routine summary contains ${rendered.length} characters`,
  );
  assertStringIncludes(rendered, "17 additional diagnostics omitted");
  assertStringIncludes(rendered, "/tmp/evidence-0");
  assertStringIncludes(rendered, "run-focused-check 0");
  assertEquals(diagnostics, original);
});
const UNCOVERED = Array.from(
  { length: 9 },
  (_, index) => ({
    path: `src/path-${index}.ts`,
    scopes: ["code"],
    ...(index >= 6 ? { generated: true } : {}),
  }),
);
const AUTHORITY_SUMMARY = {
  uncovered_scopes: ["code"],
  uncovered_generated_total: 3,
};

const FULL_PROOF = {
  branch: "agent/presentation",
  trunk: "main",
  head: "abc123def456",
  files_total: 3,
  insertions: 21,
  deletions: 8,
  line:
    "> **Proof:** Gate passed for `agent/presentation` at `abc123def456` · 3 files changed (+21 −8) vs `main` · View the full Proof: `discern status --verbose`",
  markdown: PROOF_SENTINEL,
};

/** Build a valid status result carrying every legacy full-Proof duplicate. */
function minimalStatusResult(): Record<string, unknown> {
  return {
    ok: true,
    verb: "status",
    data: {
      location: "worktree",
      root: "/workspace/project.worktrees/presentation",
      project: "example",
      worktree: null,
      git: {
        branch: "agent/presentation",
        trunk: "main",
        clean: true,
        changed_files: 0,
        behind_trunk: 0,
        ahead_trunk: 1,
      },
      standards: [],
      gate_proof: {
        status: "honored",
        proof: PROOF_SENTINEL,
        proof_line: FULL_PROOF.line,
        proof_data: FULL_PROOF,
      },
      landing_authority: {
        kind: "conversation-required",
        standing_scopes: ["map"],
        uncovered: UNCOVERED,
        ...AUTHORITY_SUMMARY,
      },
      landed_proof: {
        commit: "abc123def4567890",
        ref: "refs/notes/discern",
        proof: FULL_PROOF,
      },
      fleet: [{
        path: "/workspace/project",
        is_main: true,
        is_current: false,
        branch: "main",
        clean: true,
        changed_files: 0,
        ahead: 0,
        behind: 0,
      }, {
        path: "/workspace/project.worktrees/presentation",
        is_main: false,
        is_current: true,
        branch: "agent/presentation",
        clean: true,
        changed_files: 0,
        ahead: 1,
        behind: 0,
        proof_honored: true,
        proof: PROOF_SENTINEL,
        proof_line: FULL_PROOF.line,
        gate_proof: {
          status: "honored",
          proof: PROOF_SENTINEL,
          proof_line: FULL_PROOF.line,
          proof_data: FULL_PROOF,
        },
        landing_authority: {
          kind: "conversation-required",
          standing_scopes: ["map"],
          uncovered: UNCOVERED,
          ...AUTHORITY_SUMMARY,
        },
      }],
      fleet_collisions: [{
        branches: ["agent/presentation", "agent/other"],
        overlap: ["src/shared-result-sentinel.ts"],
        total: 1,
      }],
      adr_collisions: [{
        number: "0280",
        branches: ["agent/presentation", "agent/other"],
        paths: ["project/map/_adr/0280-sentinel.md"],
      }],
    },
  };
}

Deno.test("status Markdown preserves unknown Git counts instead of inventing zeroes", () => {
  const result = minimalStatusResult();
  const data = result.data as Record<string, unknown>;
  const git = data.git as Record<string, unknown>;
  git.ahead_trunk = "unknown";
  git.behind_trunk = "unknown";
  const fleet = data.fleet as Array<Record<string, unknown>>;
  const current = fleet[1];
  assert(current !== undefined);
  current.ahead = "unknown";
  current.behind = "unknown";

  const markdown = renderResultMarkdown(
    result,
    resultPresenterForVerb("status"),
  );
  assertStringIncludes(markdown, "unknown ahead and unknown behind");
  assertStringIncludes(markdown, "unknown ahead, unknown behind");
});

Deno.test("every public result contract selects an authored Markdown presenter", () => {
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    assertEquals(typeof contract.presenter, "function", contract.id);
    assertEquals(resultPresenterForVerb(contract.verb), contract.presenter);
  }
});

Deno.test("dry-run Markdown derives universal state and conditional plan grammar from the live command class", () => {
  const dryRunCommands = dryRunCapableVerbs();
  const enrolled = new Set(dryRunCommands);
  for (const command of dryRunCommands) {
    const contract = CLI_JSON_RESULT_CONTRACTS.find((candidate) =>
      candidate.commands.includes(command)
    );
    assert(contract !== undefined, `${command}: no public result contract`);
    const dry = {
      ok: true,
      verb: contract.verb,
      dry_run: true,
      data: {},
      plan: {
        title: "Future plan",
        details: ["Path: src/future.ts"],
        steps: [{
          kind: "git",
          label: "apply future change",
          disposition: "run",
          note: "src/future.ts",
        }],
      },
    };
    const rendered = renderResultMarkdown(dry, contract.presenter);
    assertStringIncludes(
      rendered,
      `## Current state\n\n${DRY_RUN_LEAD}\n\n`,
    );
    assertStringIncludes(rendered, "Would run `apply future change`");

    const applied = { ...dry, dry_run: false, plan: undefined };
    const appliedMarkdown = renderResultMarkdown(applied, contract.presenter);
    assert(!appliedMarkdown.includes(DRY_RUN_LEAD), command);
    assert(
      !appliedMarkdown.includes("Would run `apply future change`"),
      command,
    );
  }

  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    if (contract.commands.every((command) => !enrolled.has(command))) {
      const readOnly = renderResultMarkdown(
        { ok: true, verb: contract.verb, data: {} },
        contract.presenter,
      );
      assert(!readOnly.includes(DRY_RUN_LEAD), contract.id);
    }
  }
});

Deno.test("dry-run lead survives successful, refused, precondition, and no-op result states", () => {
  const cases = [
    { label: "successful", result: { ok: true } },
    {
      label: "refused",
      result: {
        ok: false,
        error: "confirmation_required",
        message: "Confirmation is required.",
      },
    },
    {
      label: "precondition",
      result: {
        ok: false,
        error: "precondition_failed",
        message: "The branch is behind trunk.",
      },
    },
    {
      label: "no-op",
      result: {
        ok: true,
        plan: { title: "No-op plan", details: [], steps: [] },
      },
    },
  ];
  for (const { label, result } of cases) {
    const rendered = renderResultMarkdown(
      { ...result, verb: "future", dry_run: true },
      resultPresenterForVerb("future"),
    );
    assertStringIncludes(
      rendered,
      `## Current state\n\n${DRY_RUN_LEAD}\n\n`,
      label,
    );
  }
});

Deno.test("Markdown orders state, evidence, boundary, and the immediate action at the tail", () => {
  const notice = fire(HINTS["status-fleet-logbook-disabled"]);
  const guardrail = fire(HINTS["gate-prove-it-works"]);
  const ownerAttention = fire(HINTS["status-fleet-member-stale"], {
    total: 1,
    names: ["unrelated-effort"],
  });
  const immediate = fire(HINTS["gate-trunk-advanced"]);
  const later = fire(HINTS["failure-recovery"], { verb: "status" });
  const result = {
    ok: false,
    verb: "status",
    error: "apply_failed",
    message: "Status could not finish.",
    data: {
      location: "worktree",
      root: "/workspace/project",
      worktree: null,
      git: null,
      standards: [],
    },
    hints: hintTexts([
      notice,
      guardrail,
      ownerAttention,
      immediate,
      later,
    ]),
  };
  const presenter = resultPresenterForVerb("status");
  const rendered = renderResultMarkdown(result, presenter);

  const stateAt = rendered.indexOf("## Current state");
  const evidenceAt = rendered.indexOf("## Evidence");
  const boundaryAt = rendered.indexOf("## Authority and boundaries");
  const ownerAttentionAt = rendered.indexOf("## Owner attention");
  const otherActionsAt = rendered.indexOf("## Other actions");
  const actionAt = rendered.indexOf("## Next action");
  assert(stateAt >= 0 && stateAt < evidenceAt, rendered);
  assert(evidenceAt < boundaryAt, rendered);
  assert(boundaryAt < ownerAttentionAt, rendered);
  assert(ownerAttentionAt < otherActionsAt, rendered);
  assert(otherActionsAt < actionAt, rendered);
  assertStringIncludes(rendered, notice.text);
  assertStringIncludes(rendered, guardrail.text);
  assertStringIncludes(rendered, ownerAttention.text);
  assertStringIncludes(rendered, `## Other actions\n\n${later.text}`);
  assert(
    rendered.trimEnd().endsWith(immediate.text),
    `the immediate action must close the context:\n${rendered}`,
  );
  assertEquals(renderResultMarkdown(result, presenter), rendered);
  assert(!rendered.includes("\u001b["), rendered);
});

Deno.test("owner-attention classification enrolls current and future fleet decisions", () => {
  const ownerHints = Object.values(HINTS)
    .filter((def) => def.category === "owner-attention")
    .map((def) => {
      const generic = def as HintDef<unknown>;
      const callerCommands = extractCommandRefs(
        generic.template(generic.example),
      ).filter((reference) => reference.executor === "caller");
      assertEquals(
        callerCommands,
        [],
        `${generic.id} gives an owner decision an agent-executed command`,
      );
      return fireOwnerAttention(generic, generic.example);
    });
  const next = fire(HINTS["status-continue-own-effort"]);
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "status",
      data: { location: "main", project: "example" },
      hints: hintTexts([...ownerHints, next]),
    },
    resultPresenterForVerb("status"),
  );
  const ownerSection = rendered.slice(
    rendered.indexOf("## Owner attention"),
    rendered.indexOf("## Next action"),
  );
  for (const hint of ownerHints) {
    assertStringIncludes(ownerSection, hint.text);
  }
  assert(rendered.trimEnd().endsWith(next.text), rendered);

  const futureSibling = defineHint({
    id: "status-future-sibling-decision",
    category: "next-step",
    audience: "agent",
    example: undefined,
    template: () => "Change an unrelated effort.",
  });
  assertThrows(
    () => fireOwnerAttention(futureSibling),
    Error,
    "classified as next-step",
  );
  const futureCommand = defineHint({
    id: "status-future-owner-command",
    category: "owner-attention",
    audience: "agent",
    example: undefined,
    template: () =>
      `Maintain the unrelated effort with ${
        HINTS["status-full-structured-detail"].template(undefined)
      }`,
  });
  assertThrows(
    () => fireOwnerAttention(futureCommand),
    Error,
    "agent-executed command",
  );
});

Deno.test("status wire and Markdown remove repeated Proof pages within a combined budget", () => {
  const projected = projectStatusResult(minimalStatusResult());
  StatusOutputSchema.parse(projected);
  const structured = JSON.stringify(projected);
  const markdown = renderResultMarkdown(
    projected,
    resultPresenterForVerb("status"),
  );

  assert(!structured.includes(PROOF_SENTINEL), structured.slice(0, 1_000));
  assert(!structured.includes("src/shared-result-sentinel.ts"), structured);
  assert(!structured.includes("0280-sentinel.md"), structured);
  assert(!markdown.includes(PROOF_SENTINEL), markdown.slice(0, 1_000));
  assertStringIncludes(structured, FULL_PROOF.line);
  assertStringIncludes(markdown, FULL_PROOF.line);
  assert(!markdown.includes(`- ${FULL_PROOF.line}`), markdown);
  assertStringIncludes(markdown, "Fleet: 1 active worktree.");
  assertStringIncludes(
    markdown,
    "The standing grant covers `map`. This change also touches scope `code` — 9 changed files (3 generated).",
  );
  assert(!markdown.includes("`main`: clean"), markdown);
  assert(
    structured.length + markdown.length < 8_000,
    `combined serialized result used ${
      structured.length + markdown.length
    } characters`,
  );

  const data = (projected.data ?? {}) as Record<string, unknown>;
  const fleet = data.fleet as Record<string, unknown>[];
  const active = fleet.find((entry) => entry.is_main !== true) ?? {};
  assert(!("proof_honored" in active));
  assert(!("proof_line" in active));
  const authority = active.landing_authority as Record<string, unknown>;
  assertEquals((authority.uncovered as unknown[]).length, 6);
  assertEquals(authority.uncovered_total, UNCOVERED.length);
});

Deno.test("status config refusals require their wire projection account", () => {
  const refusal = {
    ok: false,
    verb: "status",
    error: "invalid_config",
    data: {
      issues: [{
        path: "project.slgu",
        message: "Unknown key: project.slgu.",
      }],
    },
  };

  assert(
    !StatusOutputSchema.safeParse(refusal).success,
    "bare config issues are not a published status result",
  );
  assertEquals(
    StatusOutputSchema.parse(projectStatusResult(refusal)).data,
    {
      ...refusal.data,
      projection: { mode: "orientation" },
    },
  );
});

Deno.test("default status wire stays bounded as unrelated fleet state grows", () => {
  const result = minimalStatusResult();
  const data = result.data as Record<string, unknown>;
  const fleet = data.fleet as Record<string, unknown>[];
  const row = fleet[1] ?? {};
  data.fleet = [
    fleet[0],
    ...Array.from({ length: 80 }, (_, index) => ({
      ...row,
      path: `/workspace/project.worktrees/unrelated-${index}`,
      branch: `agent/unrelated-${index}`,
      id: `unrelated-${index}`,
    })),
  ];
  data.standards = Array.from(
    { length: 80 },
    (_, index) => `standard-${index}`,
  );
  data.unlanded_branches = Array.from(
    { length: 80 },
    (_, index) => `agent/parked-${index}`,
  );

  const projected = projectStatusResult(result);
  StatusOutputSchema.parse(projected);
  const structured = JSON.stringify(projected);
  const markdown = renderResultMarkdown(
    projected,
    resultPresenterForVerb("status"),
  );
  const projectedData = projected.data as Record<string, unknown>;
  const projection = projectedData.projection as Record<string, unknown>;
  const omitted = projection.omitted as Record<string, unknown>;

  assertEquals(projection.mode, "orientation");
  assertEquals((projectedData.fleet as unknown[]).length, 7);
  assertEquals(projectedData.fleet_total, 80);
  assertEquals(omitted.fleet, 74);
  assertEquals((projectedData.standards as unknown[]).length, 6);
  assertEquals(omitted.standards, 74);
  assertEquals((projectedData.unlanded_branches as unknown[]).length, 6);
  assertEquals(omitted.unlanded_branches, 74);
  assertEquals(Object.keys(omitted).sort(), [
    "fleet",
    "standards",
    "unlanded_branches",
  ]);
  assert(
    structured.length + markdown.length < 16_000,
    `bounded status result used ${
      structured.length + markdown.length
    } characters across structured and Markdown projections`,
  );
  assert(!structured.includes("agent/unrelated-79"), structured);
  assert(!structured.includes("agent/parked-79"), structured);

  // A fresh-named future collection enrolls without joining a projection list.
  const future = minimalStatusResult();
  const futureData = future.data as Record<string, unknown>;
  futureData.future_observations = Array.from(
    { length: 80 },
    (_, index) => `observation-${index}`,
  );
  futureData.future_groups = [{
    items: Array.from({ length: 8 }, (_, index) => `item-${index}`),
  }];
  const futureProjected = projectStatusResult(future);
  const futureProjectedData = futureProjected.data as Record<string, unknown>;
  assertEquals(
    (futureProjectedData.future_observations as unknown[]).length,
    6,
  );
  assertEquals(
    ((futureProjectedData.projection as Record<string, unknown>)
      .omitted as Record<string, unknown>).future_observations,
    74,
  );
  const futureOmitted = (futureProjectedData.projection as Record<
    string,
    unknown
  >).omitted as Record<string, number>;
  assertEquals(futureOmitted["future_groups[0].items"], 2);
  for (const [path, count] of Object.entries(futureOmitted)) {
    assert(
      /^(?:[a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*|\[[0-9]+\])*$/u.test(
        path,
      ),
      `omission path must use dotted keys and zero-based array indexes: ${path}`,
    );
    assert(Number.isInteger(count) && count > 0, `${path} omitted ${count}`);
  }

  const full = projectStatusResult(result, { wireProjection: "full" });
  StatusOutputSchema.parse(full);
  const fullData = full.data as Record<string, unknown>;
  assertEquals(
    fullData.projection,
    { mode: "full" },
  );
  assertEquals((fullData.fleet as unknown[]).length, 81);
  assertEquals((fullData.standards as unknown[]).length, 80);
  assertEquals((fullData.unlanded_branches as unknown[]).length, 80);
  assert(JSON.stringify(full).length > structured.length);
});

Deno.test("requested documentation remains intact in the Markdown projection", () => {
  const requested =
    "# Recovery guide\n\nRun `discern update`, then inspect the result.";
  const result = {
    ok: true,
    verb: "docs",
    data: {
      doc: {
        path: "70-reference/recovery.md",
        section: "70-reference",
        slug: "recovery",
        title: "Recovery guide",
        description: "How to recover.",
        target: "70-reference/recovery",
        content: requested,
      },
    },
  };
  const rendered = renderResultMarkdown(
    result,
    resultPresenterForVerb("docs"),
  );
  assertStringIncludes(rendered, requested);
  assertStringIncludes(rendered, "### Requested document");
});

Deno.test("documentation search Markdown reports the full and returned counts", () => {
  const results = Array.from({ length: 5 }, (_, index) => ({
    target: `10-guides/result-${index + 1}`,
    title: `Result ${index + 1}`,
    snippet: "Matching context.",
  }));
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "docs",
      data: {
        query: "finish work",
        count: 12,
        truncated: true,
        results,
      },
    },
    resultPresenterForVerb("docs"),
  );

  assertStringIncludes(
    rendered,
    "Found 12 documentation matches for `finish work`.",
  );
  assertStringIncludes(rendered, "Showing 5 highest-ranked matches of 12.");
  assert(!rendered.includes("Found 5 documentation matches"));
});

Deno.test("Markdown preserves whitespace-significant supporting payloads", () => {
  const payload = "  future sibling\ntrailing  ";
  const cases = [
    {
      label: "future presenter",
      rendered: renderResultMarkdown(
        { ok: true, verb: "future" },
        () => ({
          state: "Future result.",
          supportingMarkdown: [payload],
        }),
      ),
      expected: `## Evidence\n\n${payload}\n`,
    },
    {
      label: "diagnostic output",
      rendered: renderResultMarkdown(
        {
          ok: false,
          verb: "future",
          diagnostics: [{
            tool: "future-check",
            message: "Future failure.",
            output: payload,
          }],
        },
        resultPresenterForVerb("future"),
      ),
      expected: `\`\`\`text\n${payload}\n\`\`\``,
    },
    ...([
      ["setup", "Setup instructions"],
      ["setup verify", "Consent instructions"],
      ["setup step", "Step instructions"],
      ["setup done", "Completion instructions"],
    ] as const).map(([verb, heading]) => ({
      label: `${verb} instructions`,
      rendered: renderResultMarkdown(
        { ok: true, verb, data: { instructions: payload } },
        resultPresenterForVerb(verb),
      ),
      expected: `### ${heading}\n\n${payload}`,
    })),
    {
      label: "terminal art",
      rendered: renderResultMarkdown(
        { ok: true, verb: "triangle", data: { mark: "mark", art: payload } },
        resultPresenterForVerb("triangle"),
      ),
      expected: `\`\`\`text\n${payload}\n\`\`\``,
    },
    {
      label: "requested document",
      rendered: renderResultMarkdown(
        {
          ok: true,
          verb: "docs",
          data: { doc: { title: "Future document", content: payload } },
        },
        resultPresenterForVerb("docs"),
      ),
      expected: `### Requested document\n\n${payload}`,
    },
  ];

  const failures = cases.flatMap(({ label, rendered, expected }) =>
    rendered.includes(expected) ? [] : [label]
  );
  assertEquals(failures, []);
});

Deno.test("setup Markdown relays the canonical Proof used by structured results", () => {
  const inspection = {
    status: "honored",
    recorded: "abc123def4567890abc123def4567890abc123de",
    head: "abc123def4567890abc123def4567890abc123de",
    proof: FULL_PROOF.markdown,
    proof_line: FULL_PROOF.line,
    proof_data: FULL_PROOF,
  };
  const cases = [
    {
      verb: "setup done",
      data: {
        gate_proven: true,
        worktree_proven: true,
        proof: inspection,
        leftover: [],
      },
    },
    {
      verb: "setup accept",
      data: {
        landed: true,
        branch: "discern-setup",
        target: "main",
        fast_forward: true,
        branch_deleted: true,
        proof: inspection,
        validated_commit: inspection.head,
        merge_validated: false,
        local_artifacts_converged: true,
      },
    },
  ] as const;

  for (const result of cases) {
    const rendered = renderResultMarkdown(
      { ok: true, ...result },
      resultPresenterForVerb(result.verb),
    );
    assertStringIncludes(rendered, FULL_PROOF.line);
    assertEquals(rendered.split(FULL_PROOF.line).length - 1, 1);
    assert(!rendered.includes(`- ${FULL_PROOF.line}`), rendered);
  }
});

Deno.test("setup consent keeps the consent exchange ahead of its confirmed command", () => {
  const instructions = "Ask the owner which checks must block completion.";
  const command = confirmedBeginCommand();
  const consent = fire(HINTS["setup-awaiting-confirmation"], {
    command: confirmedBeginCommandReference(),
  });
  const rendered = renderResultMarkdown(
    {
      ok: false,
      verb: "setup",
      error: "awaiting_consent",
      message: "Setup needs the owner's consent before it writes anything.",
      data: { instructions, command },
      hints: hintTexts([consent]),
    },
    resultPresenterForVerb("setup"),
  );

  assertStringIncludes(rendered, instructions);
  assertStringIncludes(rendered, `then run \`${command}\``);
  assert(
    rendered.trimEnd().endsWith(consent.text),
    `the complete consent action must close the result:\n${rendered}`,
  );
});

Deno.test("setup Markdown presents the canonical human relay exactly once", () => {
  const relay = "I am now studying the repository before I configure it.";
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "setup",
      data: { human_relay: relay },
    },
    resultPresenterForVerb("setup"),
  );

  assertStringIncludes(rendered, `### Setup instructions\n\n${relay}`);
  assertEquals(rendered.split(relay).length - 1, 1);
});

Deno.test("setup acceptance Markdown explains why activation needs a fresh session", () => {
  const activation =
    "Start a fresh session so it can load the newly landed project instructions and MCP servers.";
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "setup accept",
      data: { landed: true, activation_context: activation },
    },
    resultPresenterForVerb("setup accept"),
  );

  assertStringIncludes(rendered, activation);
  assertEquals(rendered.split(activation).length - 1, 1);
});

Deno.test("documentation suggestions and coupling commits survive text-only delivery", () => {
  const docs = renderResultMarkdown(
    {
      ok: false,
      verb: "docs",
      error: "not_found",
      message: "No exact document matched.",
      data: {
        suggestions: [{
          path: "30-worktrees/status.md",
          section: "30-worktrees",
          slug: "status",
          title: "Status and session hints",
          description: "Read current worktree state.",
        }],
      },
    },
    resultPresenterForVerb("docs"),
  );
  assertStringIncludes(docs, "`30-worktrees/status.md`");

  const coupling = renderResultMarkdown(
    {
      ok: true,
      verb: "coupling",
      data: {
        mode: "evidence",
        partners: [],
        commits: [{
          sha: "abc123",
          date: "2026-08-14",
          subject: "Keep result projections aligned",
        }],
      },
    },
    resultPresenterForVerb("coupling"),
  );
  assertStringIncludes(coupling, "`abc123` (2026-08-14)");
  assertStringIncludes(coupling, "Keep result projections aligned");
});

Deno.test("common Markdown composition preserves authored terminal punctuation", () => {
  const authored = [
    ["fact", "A current fact", "A current fact."],
    ["period", "A current fact.", "A current fact."],
    ["question", "Is this current?", "Is this current?"],
    ["warning", "Stop!", "Stop!"],
  ] as const;
  for (const [label, value, expected] of authored) {
    assertEquals(productSentence(`  ${value}  `), expected, label);
    const future = renderResultMarkdown(
      { ok: true, verb: "future" },
      () => ({ state: productSentence(value) }),
    );
    assertStringIncludes(future, `## Current state\n\n${expected}`);

    const checkpoint = renderResultMarkdown(
      {
        ok: true,
        verb: "checkpoints",
        data: {
          checkpoints: [{
            id: label,
            mode: "stop",
            question: value,
            trigger: "paths docs/**",
            preview: { holds: false },
          }],
        },
      },
      resultPresenterForVerb("checkpoints"),
    );
    assertStringIncludes(checkpoint, `Question: ${value}`);
    if (/[.?!]$/u.test(value)) {
      assert(!checkpoint.includes(`${value}.`), `${label}: ${checkpoint}`);
    }

    const docs = renderResultMarkdown(
      {
        ok: false,
        verb: "docs",
        error: "not_found",
        message: "No exact document matched.",
        data: {
          suggestions: [{ path: `docs/${label}.md`, title: value }],
        },
      },
      resultPresenterForVerb("docs"),
    );
    assertStringIncludes(docs, `\`docs/${label}.md\`: ${expected}`);
    if (/[.?!]$/u.test(value)) {
      assert(!docs.includes(`${value}.`), `${label}: ${docs}`);
    }

    const scripts = renderResultMarkdown(
      {
        ok: true,
        verb: "scripts",
        data: { scripts: [{ name: label, description: value }] },
      },
      resultPresenterForVerb("scripts"),
    );
    assertStringIncludes(scripts, `\`${label}\`: ${expected}`);
    if (/[.?!]$/u.test(value)) {
      assert(!scripts.includes(`${value}.`), `${label}: ${scripts}`);
    }

    const awaited = fire(HINTS["await-not-yet"], {
      ...HINTS["await-not-yet"].example,
      summary: value,
    });
    const hinted = renderResultMarkdown(
      {
        ok: true,
        verb: "status",
        data: { location: "main", project: "example" },
        hints: hintTexts([awaited]),
      },
      resultPresenterForVerb("status"),
    );
    assertStringIncludes(hinted, `Not yet: ${expected} Continue`);
    if (/[.?!]$/u.test(value)) {
      assert(!hinted.includes(`${value}.`), `${label}: ${hinted}`);
    }
  }

  const opaque = [
    "`code?`",
    "../parent/file.ts",
    "v1.2.3",
    "Wait...",
    "main..feature",
  ];
  const block = "```text\nraw output?!..\n```";
  for (const value of opaque) assertEquals(productSentence(value), value);
  assertEquals(productSentence(block), block);
  const rendered = renderResultMarkdown(
    { ok: true, verb: "future" },
    () => ({
      state: "Future result.",
      evidence: opaque,
      supportingMarkdown: [block],
    }),
  );
  for (const value of opaque) assertStringIncludes(rendered, value);
  assertStringIncludes(rendered, block);
});

Deno.test("checkpoints Markdown carries the declared vocabulary and the variance boundary", () => {
  const result = {
    ok: true,
    verb: "checkpoints",
    data: {
      policy: "abc123def4567890",
      checkpoints: [
        {
          id: "api-review",
          mode: "stop",
          question: "A changed API surface is described in its docs.",
          trigger: "paths api/**",
          preview: { holds: true, matched: ["api/surface.ext"] },
          open_question: {
            state: "declared_unmet",
            definition_hash: "d".repeat(64),
            subject: "s".repeat(64),
            matched: ["api/surface.ext"],
            opened_at: "2026-08-18T00:00:00Z",
            declaration: {
              conclusion: "unmet",
              // Deliberately hostile: shell and Markdown metacharacters must
              // survive the projection opaquely, never interpreted.
              why: "The docs lag `rm -rf` and $(echo x) *the new surface*.",
              declared_at: "2026-08-18T00:01:00Z",
              current: true,
            },
            variance_required: true,
          },
        },
        {
          id: "risk-notes",
          mode: "advise",
          question: "A risky change names what could break.",
          trigger: "paths api/**",
          preview: { holds: true, matched: ["api/surface.ext"] },
        },
      ],
      ungoverned: [
        {
          id: "ghost",
          open_question: {
            state: "awaiting_declaration",
            definition_hash: "d".repeat(64),
            subject: "s".repeat(64),
            matched: ["api/surface.ext"],
            opened_at: "2026-08-18T00:00:00Z",
          },
        },
      ],
    },
  };
  const rendered = renderResultMarkdown(
    result,
    resultPresenterForVerb("checkpoints"),
  );
  // Agent evidence stays qualified; the boundary names the owner's decision.
  assertStringIncludes(rendered, "declared unmet");
  assertStringIncludes(rendered, "owner variance required to land");
  // The rationale renders through the code-span escaping boundary: the
  // embedded backtick run forces a longer fence, so the hostile text arrives
  // opaquely instead of as live Markdown emphasis or a broken span.
  assertStringIncludes(
    rendered,
    "Rationale: ``The docs lag `rm -rf` and $(echo x) *the new surface*.``",
  );
  assertStringIncludes(rendered, "authorize a variance");
  // A holding trigger serves its question; the seam states the empty history.
  assertStringIncludes(rendered, "would fire at done (1 matched)");
  assertStringIncludes(rendered, "A risky change names what could break.");
  assertStringIncludes(rendered, "No observed checkpoint history yet.");
  assertStringIncludes(rendered, "`ghost`");
  assert(!rendered.includes("\u001b["), rendered);
});

Deno.test("unregistered router results use the bounded envelope presenter", () => {
  const presenter: ResultMarkdownPresenter = resultPresenterForVerb(
    "retired-command",
  );
  const rendered = renderResultMarkdown(
    {
      ok: false,
      verb: "retired-command",
      error: "renamed_command",
      message: "That command has moved.",
    },
    presenter,
  );
  assertStringIncludes(rendered, "That command has moved.");
  assert(!rendered.includes("undefined"), rendered);
});

Deno.test("bounded-list overflow lines agree with their counts", () => {
  const fleetOf = (rows: number) =>
    Array.from({ length: rows }, (_, index) => ({
      path: `/workspace/project.worktrees/row-${index}`,
      is_main: false,
      is_current: false,
      branch: `agent/row-${index}`,
      clean: true,
      changed_files: 0,
      ahead: 0,
      behind: 0,
    }));
  const statusWith = (rows: number) =>
    renderResultMarkdown(
      {
        ok: true,
        verb: "status",
        data: { location: "main", project: "example", fleet: fleetOf(rows) },
      },
      resultPresenterForVerb("status"),
    );
  assertStringIncludes(statusWith(7), "1 additional fleet row omitted.");
  assertStringIncludes(statusWith(8), "2 additional fleet rows omitted.");
});

Deno.test("overflow sentences render only through the shared omitted() helper", async () => {
  const source = await Deno.readTextFile("src/shared/result_markdown.ts");
  const occurrences = source.match(/omitted(?!\()/g) ?? [];
  // The helper body, the capText marker, and status projection.omitted are the
  // three sanctioned spellings (identifier uses are excluded). A new
  // hand-rolled "N additional things omitted." line must route through
  // omitted() so count and noun agree.
  assertEquals(occurrences.length, 3, "route overflow lines through omitted()");
});

Deno.test("other actions group one hint family under its first item", () => {
  const header = fire(HINTS["coupling-diff-header"]);
  const partner = fire(HINTS["coupling-diff-partner"], {
    from: "src/main.ts",
    path: "tests/main_test.ts",
    cochanges: 4,
    of: 4,
    confidence: 1,
  });
  const strongPair = fire(HINTS["coupling-strong-pair"], {
    from: "src/main.ts",
    path: "tests/main_test.ts",
  });
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "coupling",
      data: {},
      hints: hintTexts([header, partner, strongPair]),
    },
    resultPresenterForVerb("coupling"),
  );
  assertStringIncludes(
    rendered,
    `## Other actions\n\n- ${partner.text}\n  - ${strongPair.text}`,
  );
  assert(rendered.trimEnd().endsWith(header.text), rendered);
});

Deno.test("non-ok steps nest beneath the steps summary", () => {
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "done",
      data: { scopes_changed: ["code"] },
      steps: [
        { label: "format", outcome: "ok" },
        { label: "standard:coverage", outcome: "skipped" },
        { label: "standard:binary_size", outcome: "skipped" },
      ],
    },
    resultPresenterForVerb("done"),
  );
  assertStringIncludes(
    rendered,
    "- Steps: 1 ok, 2 skipped.\n" +
      "  - `standard:coverage`: skipped.\n" +
      "  - `standard:binary_size`: skipped.",
  );
  assert(!rendered.includes("ended"), rendered);
});

Deno.test("a narrow coverage gap names authored stragglers and collapses generated files", () => {
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "done",
      data: {
        landing_authority: {
          kind: "conversation-required",
          standing_scopes: ["map"],
          uncovered: [
            { path: "src/a.ts", scopes: ["code"] },
            { path: "src/b.ts", scopes: ["code"] },
            { path: "schema/out.json", scopes: [], generated: true },
            { path: "types/out.d.ts", scopes: [], generated: true },
          ],
          uncovered_scopes: ["code"],
          uncovered_unscoped_total: 2,
          uncovered_generated_total: 2,
        },
      },
    },
    resultPresenterForVerb("done"),
  );
  assertStringIncludes(
    rendered,
    "Outside the `map` grant: `src/a.ts`, `src/b.ts`, plus 2 generated files.",
  );
  assert(!rendered.includes("schema/out.json"), rendered);
});

Deno.test("no recorded grant keeps the boundary to the conversation sentence", () => {
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "done",
      data: {
        landing_authority: {
          kind: "conversation-required",
          uncovered: [
            { path: "src/a.ts", scopes: ["code"] },
            { path: "src/b.ts", scopes: ["code"] },
          ],
          uncovered_scopes: ["code"],
        },
      },
    },
    resultPresenterForVerb("done"),
  );
  assertStringIncludes(
    rendered,
    "Landing requires approval from the current conversation.",
  );
  assert(!rendered.includes("src/a.ts"), rendered);
  assert(!rendered.includes("also touches"), rendered);
});

Deno.test("accept renders the landing state from its canonical fields", () => {
  const data = {
    root: "/workspace/project",
    consent: { source: "conversation" },
    scopes_changed: ["code"],
    landing: {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    },
  };
  AcceptDataSchema.parse(data);
  const rendered = renderResultMarkdown(
    { ok: true, verb: "accept", data },
    resultPresenterForVerb("accept"),
  );
  assertStringIncludes(
    rendered,
    "Trunk landed: yes; worktree removed: yes; branch deleted: yes.",
  );
  assertStringIncludes(rendered, "Landing used `conversation` consent.");
});

Deno.test("the accept presenter reads only canonical landing-state fields", async () => {
  const source = await Deno.readTextFile("src/shared/result_markdown.ts");
  const start = source.indexOf("const presentAccept: ResultMarkdownPresenter");
  assert(start !== -1, "presentAccept is no longer defined under that name");
  const end = source.indexOf("\nconst present", start);
  const body = end === -1 ? source.slice(start) : source.slice(start, end);
  // Scoped to presentAccept: other presenters bind `landing` to different
  // shapes (setup completion's landing), each with its own canon.
  const reads = [...body.matchAll(/\blanding\??\.([a-z_]+)/g)].map((match) =>
    match[1] ?? ""
  );
  assert(reads.length > 0, "presentAccept stopped reading landing fields");
  for (const field of reads) {
    assert(
      ACCEPT_LANDING_STATE_FIELDS.includes(field),
      `presentAccept reads landing.${field}; the canonical fields are ${
        ACCEPT_LANDING_STATE_FIELDS.join(", ")
      }`,
    );
  }
});

Deno.test("every presenter renders clean prose for empty and failed envelopes", () => {
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const empty = renderResultMarkdown(
      { ok: true, verb: contract.verb, data: {} },
      contract.presenter,
    );
    const failed = renderResultMarkdown(
      {
        ok: false,
        verb: contract.verb,
        error: "apply_failed",
        message: "The operation could not finish.",
      },
      contract.presenter,
    );
    for (const rendered of [empty, failed]) {
      assert(rendered.startsWith("# `discern"), `${contract.id}: ${rendered}`);
      assert(!rendered.includes("undefined"), `${contract.id}: ${rendered}`);
      assert(!rendered.includes("NaN"), `${contract.id}: ${rendered}`);
      assert(!rendered.includes("[object"), `${contract.id}: ${rendered}`);
    }
  }
});

Deno.test("durations and byte sizes render at readable units", () => {
  const awaited = renderResultMarkdown(
    {
      ok: true,
      verb: "await",
      data: { met: false, condition: "green", elapsed_ms: 60_000 },
    },
    resultPresenterForVerb("await"),
  );
  assertStringIncludes(awaited, "Waited 60 s.");
  const archive = renderResultMarkdown(
    {
      ok: true,
      verb: "patterns seal",
      data: { events: 14783, bytes: 16_000_000 },
    },
    resultPresenterForVerb("patterns seal"),
  );
  assertStringIncludes(archive, "Size: 16 MB.");
  assert(!archive.includes("16000000"), archive);
});

Deno.test("checkpoints Markdown renders observed economics when history exists", () => {
  const rendered = renderResultMarkdown(
    {
      ok: true,
      verb: "checkpoints",
      data: {
        policy: "abc123def4567890",
        checkpoints: [
          {
            id: "api-review",
            mode: "stop",
            question: "A changed API surface is described in its docs.",
            trigger: "paths api/**",
            preview: { holds: false, vetoed_by: "empty_matched_set" },
          },
        ],
        economics: {
          efforts: 2,
          omitted: 0,
          rows: [
            {
              id: "api-review",
              efforts_fired: 1,
              efforts_landed: 1,
              fires: 2,
              declared: 2,
              declared_unchanged: 1,
              declared_unmet: 1,
              reopened: 1,
              variances: 1,
              abandoned: 0,
              median_declare_s: 30,
            },
          ],
        },
      },
    },
    resultPresenterForVerb("checkpoints"),
  );
  assertStringIncludes(
    rendered,
    "Observed: `api-review` fired on 1 effort (2 servings); declared 2 " +
      "(1 on an unchanged subject, 1 unmet); 1 authorized variance across " +
      "1 landed; median time to declare 30s.",
  );
  assert(!rendered.includes("No observed checkpoint history yet."), rendered);
});

Deno.test("patterns Markdown carries completion economics without granting authority", () => {
  const result = {
    ok: true,
    verb: "patterns",
    data: { findings: [], completion: completionEconomics([]) },
  };
  const rendered = renderResultMarkdown(
    result,
    resultPresenterForVerb("patterns"),
  );
  for (
    const text of [
      "Native producer executions: unknown",
      "Approval-to-land:",
      "denominator unknown",
      "Observations grant no Proof",
    ]
  ) assertStringIncludes(rendered, text);
});

Deno.test("accept rows explain a kept checkout and omit retirement for unlanded work", () => {
  const row = {
    effort: "one",
    branch: "refs/heads/agent/one",
    source_head: "a".repeat(40),
    candidate_id: null,
    expected_trunk: null,
    target: null,
    retirement: "retained" as const,
    pending: [],
  };
  for (
    const reason of [
      "unreleased",
      "active-use",
      "moved-branch",
      "dirty",
      "ownership-uncertain",
      "a reason the engine recorded verbatim",
      undefined,
    ]
  ) {
    const data = {
      root: "/workspace/project",
      queue: [{
        ...row,
        state: "landed" as const,
        ...(reason === undefined ? {} : { retirement_reason: reason }),
      }],
    };
    AcceptDataSchema.parse(data);
    const rendered = renderResultMarkdown(
      { ok: true, verb: "accept", data },
      resultPresenterForVerb("accept"),
    );
    assertStringIncludes(
      rendered,
      reason === undefined ? "checkout kept." : `checkout kept (${reason}).`,
    );
    assertStringIncludes(rendered, retainedCheckoutExplanation(reason));
  }
  const retiredData = {
    root: "/workspace/project",
    queue: [{
      ...row,
      state: "landed" as const,
      retirement: "retired" as const,
    }],
  };
  AcceptDataSchema.parse(retiredData);
  assertStringIncludes(
    renderResultMarkdown(
      { ok: true, verb: "accept", data: retiredData },
      resultPresenterForVerb("accept"),
    ),
    "checkout retired.",
  );
  const pendingData = {
    root: "/workspace/project",
    queue: [{
      ...row,
      state: "pending" as const,
      pending: [{ kind: "missing-evidence", reason: "Run discern done." }],
    }],
  };
  AcceptDataSchema.parse(pendingData);
  const pending = renderResultMarkdown(
    { ok: true, verb: "accept", data: pendingData },
    resultPresenterForVerb("accept"),
  );
  assertStringIncludes(
    pending,
    "`refs/heads/agent/one`: pending; authority pending.",
  );
  assert(!pending.includes("retirement"), pending);
  assert(!pending.includes("convergence"), pending);
  assert(!pending.includes("checkout kept"), pending);
});

Deno.test("the checkout outcome is one sentence with the command that finishes cleanup", () => {
  assertEquals(
    checkoutOutcomeSentence({ retirement: "retired" }),
    "Its checkout was removed.",
  );
  for (
    const reason of [
      "unreleased",
      "active-use",
      "moved-branch",
      "dirty",
      "ownership-uncertain",
      undefined,
    ]
  ) {
    const kept = checkoutOutcomeSentence({
      retirement: "retained",
      ...(reason === undefined ? {} : { retirement_reason: reason }),
    });
    assert(kept.startsWith("Its checkout stayed. "), kept);
    assertStringIncludes(
      kept,
      "discern ",
      "every kept outcome names a command",
    );
  }
  const recovery = checkoutOutcomeSentence({
    retirement: "recovery",
    retirement_reason: "the capture failed",
  });
  assertStringIncludes(recovery, "the capture failed");
  assertStringIncludes(recovery, "run discern accept again");
});

Deno.test("accept rows are labelled from their recorded relation to the selected effort", () => {
  const row = (effort: string, relation: "selected" | "ahead" | "behind") => ({
    effort,
    branch: `refs/heads/agent/${effort}`,
    source_head: "a".repeat(40),
    candidate_id: null,
    expected_trunk: null,
    target: null,
    state: "pending" as const,
    relation,
    retirement: "retained" as const,
    pending: [{ kind: "queued", reason: "Waiting for the owner's approval." }],
  });
  const data = {
    root: "/workspace/project",
    selected_effort: "mine",
    queue: [
      row("earlier", "ahead"),
      row("mine", "selected"),
      row("later", "behind"),
    ],
  };
  AcceptDataSchema.parse(data);
  const rendered = renderResultMarkdown(
    { ok: true, verb: "accept", data },
    resultPresenterForVerb("accept"),
  );
  assertStringIncludes(rendered, "Selected effort `agent/mine`: not landed.");
  assertStringIncludes(
    rendered,
    "Ahead in the queue — `refs/heads/agent/earlier`",
  );
  assertStringIncludes(
    rendered,
    "Behind in the queue — `refs/heads/agent/later`",
  );
  assert(
    !rendered.includes("Ahead in the queue — `refs/heads/agent/later`"),
    rendered,
  );
});
