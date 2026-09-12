/**
 * The declaration-interlock class — a third refusal contract beside the
 * consent-gated class, never inside it (consent awaits the owner; a
 * declaration is the caller's own act), and the registry facts the
 * acceptance variance contract shares with it.
 *
 * Driven off the `DECLARATION_GATED_VERBS` registry: a future member enrols
 * by adding an entry (and a probe), and fails here until every declared
 * surface refuses with the shared slug, batches the complete serving, states
 * its no-effects claim, and names its resolution. Each probe crosses the CLI
 * boundary once per surface family — `--json` and the terminal — and
 * projects the Markdown surface from that same envelope through the
 * production presenter; the MCP surface runs the server's own dispatch
 * in-process, as do the MCP declaration-parameter journeys below the class
 * matrix.
 */

import { assert, assertEquals } from "@std/assert";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
  DECLARATION_GATED_VERBS,
  type DeclarationGatedVerbId,
  type DeclarationSurface,
  VARIANCE_GATED_ACCEPTANCE,
} from "../src/shared/declarations.ts";
import { ERROR_SLUGS } from "../src/shared/result.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  checkpointedWorktree,
  CONFIG_ONE_STOP,
  QUESTION,
} from "./engine_checkpoints_accept_fixture.ts";
import {
  jsonSurface,
  markdownSurface,
  mcpSurface,
  runMcp,
  type SurfaceObservation,
  terminalSurface,
} from "./engine_checkpoints_surfaces.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

/** The meaning every declared surface must carry without paraphrase: the
 * served checkpoint, its question, the no-effects claim, and the resolution. */
interface DeclarationProbeResult {
  readonly mutated: boolean;
  readonly meaning: readonly string[];
  readonly surfaces: Partial<
    Readonly<Record<DeclarationSurface, SurfaceObservation>>
  >;
}

const PROBES = {
  done: async (dir: string): Promise<DeclarationProbeResult> => {
    const wt = await checkpointedWorktree(dir);
    const json = await runAgent(wt, ["done", "--json"]);
    const env = decodeCliResult(json.stdout, "done");
    const terminal = await runAgent(wt, ["done"]);
    const mcp = await runMcp("discern_done", wt, {});
    // Mutated iff a gate job ran or the project tree changed; the open question
    // record and logbook line live inside .git and are the stated writes.
    const mutated = (await gitOut(wt, "status", "--porcelain")) !== "";
    return {
      mutated,
      meaning: [
        "api-review",
        QUESTION,
        "--met",
        "--unmet",
        "--why",
        "No gate job ran",
        "tree is unchanged",
      ],
      surfaces: {
        json: jsonSurface(json, env),
        // Markdown and terminal are prose surfaces: the machine slug rides
        // json/mcp, while these must refuse with the same complete serving.
        markdown: markdownSurface(json, env, "done"),
        terminal: terminalSurface(terminal, AWAITING_DECLARATION_SLUG),
        mcp: mcpSurface(mcp),
      },
    };
  },
} satisfies Record<
  DeclarationGatedVerbId,
  (dir: string) => Promise<DeclarationProbeResult>
>;

Deno.test("declaration class: both slugs are registered error vocabulary with their own contracts", () => {
  // Distinctness from the consent slug is a compile-time fact of the literal
  // types; membership in the closed error vocabulary is the runtime claim.
  assert(ERROR_SLUGS.includes(AWAITING_DECLARATION_SLUG));
  assert(ERROR_SLUGS.includes(AWAITING_VARIANCE_SLUG));
  assertEquals(VARIANCE_GATED_ACCEPTANCE.slug, AWAITING_VARIANCE_SLUG);
  assertEquals(VARIANCE_GATED_ACCEPTANCE.command, "accept");
});

Deno.test("declaration class: every enrolled verb refuses with the shared slug, the complete serving, and no effects", async () => {
  for (const verb of DECLARATION_GATED_VERBS) {
    const probe = PROBES[verb.id];
    assert(
      probe !== undefined,
      `declaration-gated verb "${verb.id}" has no refusal probe — wire one so ` +
        `the class contract covers it`,
    );
    await withTempDir(async (dir) => {
      const observed = await probe(dir);
      assert(
        !observed.mutated,
        `${verb.id}: an awaiting-declaration refusal must not change the project tree`,
      );
      assertEquals(
        Object.keys(observed.surfaces).sort(),
        [...verb.surfaces].sort(),
        `${verb.id}: probe every declared public surface`,
      );
      for (const surface of verb.surfaces) {
        const observation = observed.surfaces[surface];
        assert(
          observation !== undefined,
          `${verb.id}: missing ${surface} observation`,
        );
        assert(observation.refused, `${verb.id}: ${surface} must refuse`);
        assertEquals(
          observation.slug,
          AWAITING_DECLARATION_SLUG,
          `${verb.id}: ${surface} must carry the shared declaration slug`,
        );
        for (const fact of observed.meaning) {
          assertTerminalTextIncludes(
            observation.evidence,
            fact,
            `${verb.id}: ${surface} omits ${JSON.stringify(fact)}`,
          );
        }
      }
    });
  }
});

Deno.test("MCP done records one strict unmet declaration per call and composes successive calls", async () => {
  await withTempDir(async (dir) => {
    const config = `${CONFIG_ONE_STOP}
[checkpoints.risk-notes]
paths = ["api/**"]
question = "The changed surface records its operational risks."
`;
    const wt = await checkpointedWorktree(dir, config);

    const first = await runMcp("discern_done", wt, {
      unmet: {
        id: "api-review",
        why: "The documentation follows in a separately reviewed change.",
      },
    });
    assertEquals(first.isError, true);
    assertEquals(first.env.error, AWAITING_DECLARATION_SLUG);
    const firstData = first.env.data as {
      checkpoints?: { outstanding?: { id: string }[] };
    };
    assertEquals(
      firstData.checkpoints?.outstanding?.map((entry) => entry.id),
      ["risk-notes"],
    );

    const second = await runMcp("discern_done", wt, {
      unmet: {
        id: "risk-notes",
        why:
          "The owner must decide whether the remaining operational risk is acceptable.",
      },
    });
    assertEquals(second.isError, false, JSON.stringify(second.env));
    const secondData = second.env.data as {
      checkpoints?: { declared_unmet?: { id: string }[] };
    };
    assertEquals(
      secondData.checkpoints?.declared_unmet?.map((entry) => entry.id).sort(),
      ["api-review", "risk-notes"],
    );
  });
});

Deno.test("mcp: declarations travel the tool parameters — met records and unlocks; an invalid unmet records nothing", async () => {
  // The spec's MCP half of the declaration contract: `met: ["<id>", …]` and
  // `unmet: {id, why}` are tool parameters, validated exactly like the flags.
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    const refused = await runMcp("discern_done", wt, {});
    assert(refused.isError, "the interlock must refuse the bare call");

    // A mis-shaped rationale is rejected before any write: the follow-up
    // bare call still refuses with the same awaiting contract.
    const invalid = await runMcp("discern_done", wt, {
      unmet: { id: "api-review", why: "line one\nline two" },
    });
    assert(invalid.isError, "a mis-shaped rationale must not record");
    const still = await runMcp("discern_done", wt, {});
    assert(still.isError, "nothing was recorded, so the refusal stands");
    assertEquals(still.env.error, AWAITING_DECLARATION_SLUG);

    // The met array records the caller's judgment and the gate proceeds in
    // the same call.
    const met = await runMcp("discern_done", wt, { met: ["api-review"] });
    assert(!met.isError, JSON.stringify(met.env));
    const checkpoints = (met.env.data as {
      checkpoints: { declared_met?: { id: string }[] };
    }).checkpoints;
    assertEquals(checkpoints.declared_met?.[0]?.id, "api-review");
  });
});
