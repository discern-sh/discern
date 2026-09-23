/** Text delivery preserves requested collections, failures, and recovered actions. */
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  MCP_RESULT_CONTRACTS,
  resultPresenterForVerb,
} from "../src/shared/result_contracts.ts";
import { type DiscernResult, verbatimStepLabel } from "../src/shared/result.ts";
import { serializeResult } from "../src/shared/result_serialization.ts";
import { renderResultMarkdown } from "../src/shared/result_markdown.ts";
import {
  providerTrustData,
  TRUST_ACTION_KINDS,
  TRUST_FACT_KINDS,
} from "../src/shared/provider_trust.ts";
import { fire, HINTS, hintTexts } from "../src/shared/hints.ts";

/** Render through the same registered presenter used by CLI and MCP. */
function markdown(
  verb: string,
  data: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): string {
  return renderResultMarkdown(
    { ok: true, verb, data, ...extras },
    resultPresenterForVerb(verb),
    resultPresenterForVerb,
  );
}

/** Populate beyond the routine list cap with unrelated future identities. */
function rows(): string[] {
  return Array.from({ length: 9 }, (_, index) => `orbit-evidence-${index}`);
}

for (const verb of ["docs", "map"]) {
  Deno.test(`${verb} returns its complete requested index and region details in text`, () => {
    const docs = rows().map((id) => ({
      target: id,
      path: `manual/${id}.md`,
      title: `Title ${id}`,
      description: `Description ${id}`,
    }));
    const output = markdown(verb, {
      count: docs.length,
      docs,
      regions: [{
        name: "region-orbit",
        title: "Orbit region",
        description: "Region purpose",
        page_count: 9,
        pages_changed_at: "2026-09-12",
        code_changes_since: 17,
      }],
    });
    for (const doc of docs) {
      assertStringIncludes(output, doc.target);
      assertStringIncludes(output, doc.description);
    }
    for (const fact of ["region-orbit", "Region purpose", "2026-09-12", "17"]) {
      assertStringIncludes(output, fact);
    }
  });
}

Deno.test("doctor preserves every problem and every requested execution step", () => {
  const ids = rows();
  const output = markdown("doctor", {
    checks: ids.map((id) => ({
      name: id,
      status: "fail",
      detail: `Problem ${id}`,
      fix: `repair-${id}`,
    })),
    execution_model: [{
      verb: "future-verb",
      when: "When orbit moves",
      steps: ids.map((id) => ({
        kind: "job",
        label: id,
        actor: "project",
        note: `command-${id}`,
        hint: `expectation-${id}`,
        condition: `condition-${id}`,
      })),
    }],
  });
  for (const id of ids) {
    for (
      const prefix of ["repair-", "command-", "expectation-", "condition-"]
    ) assertStringIncludes(output, `${prefix}${id}`);
  }
  assertStringIncludes(output, "When orbit moves");
});

Deno.test("standards reports every exact limit change", () => {
  const pins = rows().map((name, index) => ({
    name,
    from: 100 + index,
    to: 70 + index,
    measured: 70 + index,
  }));
  const output = markdown("standards", { pinned: pins });
  for (const pin of pins) {
    assertStringIncludes(output, pin.name);
    assertStringIncludes(output, `${pin.from} → ${pin.to}`);
  }
});

Deno.test("progress keeps failures after many producers and renders its retained recovery", () => {
  const next = fire(HINTS["accept-requires-strict-proof"]);
  const output = markdown("progress", {
    handle: "R1-TEST-TEST-00",
    operation: { verb: "done", path: "/workspace/orbit" },
    executor: "gone",
    outcome: "failed",
    account: [
      ...rows().map((id) => `Recorded ${id}.`),
      "orbit failure. Reproduce: focused-orbit-check",
    ],
    result: {
      ok: false,
      verb: "done",
      message: "Retained failure",
      diagnostics: [{
        tool: "orbit-check",
        message: "Retained diagnostic",
        reproduce_cmd: "retained-reproduce",
        output_path: "/tmp/orbit-output",
      }],
      hints: hintTexts([next]),
    },
  });
  for (
    const fact of [
      "R1-TEST-TEST-00",
      "focused-orbit-check",
      "Retained diagnostic",
      "retained-reproduce",
      "/tmp/orbit-output",
      next.text,
    ]
  ) assertStringIncludes(output, fact);
});

Deno.test("progress renders the retained Proof and await continuation without re-running", () => {
  const proof = "> **Proof:** Gate passed for `agent/orbit` at `abc123`.";
  const result = { ok: true, verb: "done", data: { proof: { line: proof } } };
  assertStringIncludes(markdown("progress", { account: [], result }), proof);
  const resumed = markdown("progress", {
    account: [],
    result: {
      ok: true,
      verb: "await",
      data: {
        condition: "green",
        met: false,
        resume: "C1-ORBIT-RESUME",
        elapsed_ms: 1000,
      },
    },
  });
  assertStringIncludes(resumed, "C1-ORBIT-RESUME");
});

Deno.test("routine acquisition telemetry stays out of progress while actual waiting is explained", () => {
  const input = {
    account: [],
    timings: [{
      category: "capacity-acquisition",
      interval_id: "orbit",
      started_at: 0,
      finished_at: 2,
    }],
  };
  const routine = markdown("progress", input);
  assert(!routine.includes("timing interval"));
  assert(!routine.includes("capacity-acquisition"));
  const waiting = markdown("progress", {
    ...input,
    timings: [{
      category: "capacity-wait",
      interval_id: "orbit-queued",
      started_at: 0,
      finished_at: 2300,
    }],
  });
  assertStringIncludes(waiting, "test-run capacity");
  assertStringIncludes(waiting, "2.3 s");
});

Deno.test("every registered MCP presenter preserves envelope-level diagnostics and recovery", () => {
  const diagnostic = {
    tool: "unrelated-future-check",
    message: "ACTIONABLE-ORBIT-FAILURE",
    reproduce_cmd: "repair-orbit",
    output_path: "/tmp/orbit-diagnostic",
  };
  const hint = fire(HINTS["accept-requires-strict-proof"]);
  for (const contract of MCP_RESULT_CONTRACTS) {
    const output = renderResultMarkdown({
      ok: false,
      verb: contract.verb,
      message: "Observed failure",
      diagnostics: [diagnostic],
      hints: hintTexts([hint]),
    }, contract.presenter);
    for (
      const fact of [
        diagnostic.message,
        diagnostic.reproduce_cmd,
        diagnostic.output_path,
        hint.text,
      ]
    ) assertStringIncludes(output, fact, contract.mcpTool);
  }
  assertEquals(
    new Set(MCP_RESULT_CONTRACTS.map((entry) => entry.mcpTool)).size,
    MCP_RESULT_CONTRACTS.length,
  );
});

Deno.test("required plan effects and judgment questions cannot disappear beyond a summary cap", () => {
  const ids = rows();
  const plan = {
    title: "Future plan",
    details: [],
    steps: ids.map((id) => ({
      label: id,
      disposition: "run",
      note: `effect-${id}`,
    })),
  };
  for (const contract of MCP_RESULT_CONTRACTS) {
    const output = renderResultMarkdown({
      ok: true,
      verb: contract.verb,
      dry_run: true,
      plan,
    }, contract.presenter);
    for (const id of ids) {
      assertStringIncludes(output, `effect-${id}`, contract.mcpTool);
    }
  }
  const questions = ids.map((id) => ({
    id,
    question: `judge-${id}`,
    mode: "stop",
  }));
  for (
    const [verb, data] of [["done", {
      checkpoints: { review: { status: "unreviewed", unreviewed: questions } },
    }], ["checkpoints", { checkpoints: questions }]] as const
  ) {
    const output = markdown(verb, data);
    for (const id of ids) assertStringIncludes(output, `judge-${id}`);
  }
});

Deno.test("a future presenter with a retained result must use the registry and retain its actions", () => {
  const child = {
    ok: true,
    verb: "unrelated-future",
    hints: ["Inspect the orbit before continuing."],
  };
  const parent = { ok: true, verb: "unrelated-parent" };
  const presenter = (): {
    state: string;
    retainedResult: Record<string, unknown>;
  } => ({ state: "Recovered orbit", retainedResult: child });
  assertThrows(
    () => renderResultMarkdown(parent, presenter),
    Error,
    "presenter resolver",
  );
  const output = renderResultMarkdown(
    parent,
    presenter,
    resultPresenterForVerb,
  );
  assertStringIncludes(output, "Inspect the orbit before continuing.");
});

Deno.test("native retained step logs and bounded nesting remain readable", () => {
  const native = {
    ok: false,
    verb: "test",
    steps: [{
      step: {
        kind: "job",
        label: verbatimStepLabel("orbit"),
        disposition: "run",
      },
      outcome: "failed",
      outputPath: "/tmp/native-orbit.log",
    }],
    waitedMs: 2300,
    message: "Native failure",
    hints: hintTexts([fire(HINTS["accept-requires-strict-proof"])]),
  } satisfies DiscernResult;
  for (const result of [native, serializeResult(native)]) {
    const output = markdown("progress", { account: [], result });
    assertStringIncludes(output, "`orbit`: failed");
    assertStringIncludes(output, "/tmp/native-orbit.log");
    assertStringIncludes(output, "Waited 2.3 s");
    assert(!output.includes("unnamed step"));
  }
  let nested: Record<string, unknown> = native;
  for (let depth = 0; depth < 8; depth++) {
    nested = {
      ok: true,
      verb: "progress",
      data: { account: [], result: nested },
    };
  }
  assertStringIncludes(
    markdown("progress", {
      account: [],
      record_path: "/tmp/record-orbit.json",
      result: nested,
    }),
    "/tmp/record-orbit.json",
  );
});

Deno.test("doctor renders every provider trust action and literal fact from the canonical vocabularies", () => {
  const trust = providerTrustData("future-provider", {
    required: true,
    explanation: "Trust is required here.",
    actions: TRUST_ACTION_KINDS.map((kind) => ({
      kind,
      instruction: `Action ${kind}`,
      facts: TRUST_FACT_KINDS.map((fact) => ({
        kind: fact,
        value: `literal-${fact}`,
      })),
    })),
  });
  const output = markdown("doctor", { provider_trust: [trust] });
  for (const kind of TRUST_ACTION_KINDS) {
    assertStringIncludes(output, `Action ${kind}`);
  }
  for (const kind of TRUST_FACT_KINDS) {
    assertStringIncludes(output, `literal-${kind}`);
  }
});

Deno.test("requested query rows and setup blockers retain every returned entry", () => {
  const ids = rows();
  const cases: {
    verb: string;
    data: Record<string, unknown>;
    extras?: Record<string, unknown>;
  }[] = [
    {
      verb: "docs",
      data: {
        results: ids.map((id) => ({
          target: id,
          title: id,
          snippet: `snippet-${id}`,
        })),
        count: ids.length,
      },
    },
    {
      verb: "map",
      data: {
        results: ids.map((id) => ({ target: id, title: id })),
        count: ids.length,
      },
    },
    {
      verb: "checkpoints",
      data: { economics: { rows: ids.map((id) => ({ id })) } },
    },
    {
      verb: "setup verify",
      data: { conflicts: ids.map((id) => ({ detail: id })) },
    },
    {
      verb: "setup done",
      data: { unmet: ids.map((id) => ({ describe: id })) },
    },
    {
      verb: "config",
      data: { issues: ids.map((id) => ({ path: id, message: id })) },
      extras: { ok: false, error: "invalid_config" },
    },
    {
      verb: "coupling",
      data: {
        partners: ids.map((id) => ({ path: id })),
        commits: ids.map((id) => ({ sha: `sha-${id}`, subject: id })),
      },
    },
    {
      verb: "patterns",
      data: {
        findings: ids.map((id) => ({
          summary: id,
          observed: `observation-${id}`,
          next_step: `investigate-${id}`,
        })),
      },
    },
    {
      verb: "scripts",
      data: { scripts: ids.map((id) => ({ name: id, description: id })) },
    },
    {
      verb: "skills list",
      data: {
        skills: ids.map((id, index) => ({
          name: id,
          source: "project",
          excluded: index % 2 === 0,
        })),
      },
    },
  ];
  for (const entry of cases) {
    const output = markdown(entry.verb, entry.data, entry.extras);
    for (const id of ids) assertStringIncludes(output, id, entry.verb);
    assert(!output.includes("omitted"), entry.verb);
    if (entry.verb === "patterns") {
      for (const id of ids) assertStringIncludes(output, `investigate-${id}`);
    }
  }
});

Deno.test("skills list marks excluded and overriding skills instead of dropping them", () => {
  const output = markdown("skills list", {
    skills: [
      {
        name: "orbit-override",
        source: "authored",
        overrides_bundled: true,
        has_bundled: true,
        excluded: false,
      },
      {
        name: "orbit-excluded",
        source: "bundled",
        overrides_bundled: false,
        has_bundled: true,
        excluded: true,
      },
    ],
  });
  assertStringIncludes(
    output,
    "Found 1 effective skill and 1 excluded by `[skills].exclude`.",
  );
  assertStringIncludes(
    output,
    "`orbit-override`: authored, overrides the bundled skill.",
  );
  assertStringIncludes(
    output,
    "`orbit-excluded`: bundled, excluded by `[skills].exclude`.",
  );
});
