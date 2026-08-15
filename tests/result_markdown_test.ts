import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  CLI_JSON_RESULT_CONTRACTS,
  resultPresenterForVerb,
} from "../src/shared/result_contracts.ts";
import {
  renderResultMarkdown,
  type ResultMarkdownPresenter,
} from "../src/shared/result_markdown.ts";
import { fire, HINTS, hintTexts } from "../src/shared/hints.ts";
import { projectStatusResult } from "../src/shared/result_wire.ts";
import { StatusOutputSchema } from "../src/shared/result_schemas.ts";
import {
  confirmedBeginCommand,
  confirmedBeginCommandReference,
} from "../src/shared/setup_messages.ts";

const PROOF_SENTINEL = "FULL-PROOF-PAGE".repeat(8_000);
const UNCOVERED = Array.from(
  { length: 9 },
  (_, index) => ({ path: `src/path-${index}.ts`, scopes: ["code"] }),
);

const FULL_PROOF = {
  branch: "agent/presentation",
  trunk: "main",
  head: "abc123def456",
  files_total: 3,
  insertions: 21,
  deletions: 8,
  line:
    "Proof: gate passed on agent/presentation @ abc123def456 · 3 files +21 −8 vs main",
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

Deno.test("every public result contract selects an authored Markdown presenter", () => {
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    assertEquals(typeof contract.presenter, "function", contract.id);
    assertEquals(resultPresenterForVerb(contract.verb), contract.presenter);
  }
});

Deno.test("Markdown orders state, evidence, boundary, and the immediate action at the tail", () => {
  const notice = fire(HINTS["status-fleet-logbook-disabled"]);
  const guardrail = fire(HINTS["gate-prove-it-works"]);
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
    hints: hintTexts([notice, guardrail, immediate, later]),
  };
  const presenter = resultPresenterForVerb("status");
  const rendered = renderResultMarkdown(result, presenter);

  const stateAt = rendered.indexOf("## Current state");
  const evidenceAt = rendered.indexOf("## Evidence");
  const boundaryAt = rendered.indexOf("## Authority and boundaries");
  const actionAt = rendered.indexOf("## Next action");
  assert(stateAt >= 0 && stateAt < evidenceAt, rendered);
  assert(evidenceAt < boundaryAt, rendered);
  assert(boundaryAt < actionAt, rendered);
  assertStringIncludes(rendered, notice.text);
  assertStringIncludes(rendered, guardrail.text);
  assertStringIncludes(rendered, `Later: ${later.text}`);
  assert(
    rendered.trimEnd().endsWith(immediate.text),
    `the immediate action must close the context:\n${rendered}`,
  );
  assertEquals(renderResultMarkdown(result, presenter), rendered);
  assert(!rendered.includes("\u001b["), rendered);
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
  assertStringIncludes(markdown, "Fleet: 1 active worktree.");
  assertStringIncludes(markdown, "plus 3 more");
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

Deno.test("setup consent keeps the consent exchange ahead of its confirmed command", () => {
  const guidance = "Ask the owner which checks must block completion.";
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
      data: { guidance, command },
      hints: hintTexts([consent]),
    },
    resultPresenterForVerb("setup"),
  );

  assertStringIncludes(rendered, guidance);
  assertStringIncludes(rendered, `then run \`${command}\``);
  assert(
    rendered.trimEnd().endsWith(consent.text),
    `the complete consent action must close the result:\n${rendered}`,
  );
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
  // The helper body and the capText marker are the two sanctioned spellings
  // (identifier uses are excluded). A new hand-rolled "N additional things
  // omitted." line must route through omitted() so count and noun agree.
  assertEquals(occurrences.length, 2, "route overflow lines through omitted()");
});
