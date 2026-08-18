/**
 * The declaration-interlock class and the acceptance variance contract —
 * third and fourth refusal contracts beside the consent-gated class, never
 * inside it (consent awaits the owner; a declaration is the caller's own act;
 * a variance is the owner's decision about a declared-unmet conclusion).
 *
 * Driven off the `DECLARATION_GATED_VERBS` registry and the
 * `VARIANCE_GATED_ACCEPTANCE` contract: a future member enrols by adding an
 * entry (and a probe), and fails here until every declared surface refuses
 * with the shared slug, batches the complete serving, states its no-effects
 * claim, and names its resolution.
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
  DECLARATION_GATED_VERBS,
  type DeclarationGatedVerbId,
  type DeclarationSurface,
  VARIANCE_GATED_ACCEPTANCE,
} from "../src/shared/declarations.ts";
import { ERROR_SLUGS } from "../src/shared/result.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";

/** The wire fields these refusal probes read from an envelope. */
interface RefusalEnvelope {
  ok: boolean;
  verb: string;
  error?: string;
  message?: string;
  hints?: string[];
}

/** Decode a JSON result envelope. */
function parseJson(stdout: string): RefusalEnvelope {
  return JSON.parse(stdout.trim()) as RefusalEnvelope;
}

const CRITERION = "A changed surface is described in its docs before it lands.";
const RATIONALE = "The docs lag the new surface; a follow-up covers them.";

const CONFIG = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
criterion = "${CRITERION}"
`;

/** Scaffold main + a worktree with one committed change under `api/`. */
async function checkpointedWorktree(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG);
  await writeExecutable(
    join(dir, "check.sh"),
    "#!/usr/bin/env sh\nexit 0\n",
  );
  await gitInit(dir);
  const wt = await addWorktree(dir, "declared");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** Run one MCP tool by name against `root` and return its envelope pieces. */
async function runMcp(
  name: string,
  root: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; env: Record<string, unknown> }> {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  assert(tool !== undefined, `${name} must be in the MCP tool registry`);
  const outcome = await runTool(
    tool,
    new WorkingRoot(root),
    args,
    undefined,
    () => Promise.resolve(undefined),
  );
  return {
    isError: outcome.isError === true,
    env: outcome.structuredContent as Record<string, unknown>,
  };
}

/** What one surface observation must prove. */
interface SurfaceObservation {
  readonly refused: boolean;
  readonly slug: unknown;
  /** Raw public text; the exact contract facts must occur here. */
  readonly evidence: string;
}

/** The meaning every declared surface must carry without paraphrase: the
 * served checkpoint, its criterion, the no-effects claim, and the resolution. */
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
    const markdown = await runAgent(wt, ["done", "--markdown"]);
    const terminal = await runAgent(wt, ["done"]);
    const mcp = await runMcp("discern_done", wt, {});
    const env = parseJson(json.stdout);
    // Mutated iff a gate job ran or the project tree changed; the episode
    // record and logbook line live inside .git and are the stated writes.
    const status = await new Deno.Command("git", {
      args: ["status", "--porcelain"],
      cwd: wt,
      stdout: "piped",
    }).output();
    const mutated = new TextDecoder().decode(status.stdout).trim() !== "";
    return {
      mutated,
      meaning: [
        "api-review",
        CRITERION,
        "--met",
        "--unmet",
        "--why",
        "No gate job ran",
        "tree is unchanged",
      ],
      surfaces: {
        json: {
          refused: json.code === 1 && env.ok === false,
          slug: env.error,
          evidence: [env.message ?? "", ...(env.hints ?? [])].join("\n"),
        },
        // Markdown and terminal are prose surfaces: the machine slug rides
        // json/mcp, while these must refuse with the same complete serving.
        markdown: {
          refused: markdown.code === 1,
          slug: AWAITING_DECLARATION_SLUG,
          evidence: markdown.stdout,
        },
        terminal: {
          refused: terminal.code === 1,
          slug: AWAITING_DECLARATION_SLUG,
          evidence: terminal.output,
        },
        mcp: {
          refused: mcp.isError,
          slug: mcp.env.error,
          evidence: [
            String(mcp.env.message ?? ""),
            ...((mcp.env.hints ?? []) as string[]),
          ].join("\n"),
        },
      },
    };
  },
  accept: async (dir: string): Promise<DeclarationProbeResult> => {
    const wt = await checkpointedWorktree(dir);
    // Reach the accept-side precondition: a recorded conclusion staled by a
    // further committed revision to the matched path.
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint v2\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "revise the api", "--no-gpg-sign");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const json = await runAgent(wt, ["accept", "--json"]);
    const markdown = await runAgent(wt, ["accept", "--markdown"]);
    const terminal = await runAgent(wt, ["accept"]);
    const mcp = await runMcp("discern_accept", wt, {});
    const env = parseJson(json.stdout);
    const mutated = (await exists(join(dir, "api"))) || !(await exists(wt));
    return {
      mutated,
      meaning: [
        "api-review",
        "discern done",
        "Nothing has been landed",
      ],
      surfaces: {
        json: {
          refused: json.code === 1 && env.ok === false,
          slug: env.error,
          evidence: [env.message ?? "", ...(env.hints ?? [])].join("\n"),
        },
        markdown: {
          refused: markdown.code === 1,
          slug: AWAITING_DECLARATION_SLUG,
          evidence: markdown.stdout,
        },
        terminal: {
          refused: terminal.code === 1,
          slug: AWAITING_DECLARATION_SLUG,
          evidence: terminal.output,
        },
        mcp: {
          refused: mcp.isError,
          slug: mcp.env.error,
          evidence: [
            String(mcp.env.message ?? ""),
            ...((mcp.env.hints ?? []) as string[]),
          ].join("\n"),
        },
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

Deno.test("variance contract: every declared surface serves the same complete decision", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        RATIONALE,
        "--json",
      ])).code,
      0,
    );

    const meaning = [
      "api-review",
      CRITERION,
      RATIONALE,
      "declared unmet",
      "--confirmed",
      "--variance",
      "never authorize a variance",
      "Nothing has been landed",
    ];
    const json = await runAgent(wt, ["accept", "--json"]);
    const markdown = await runAgent(wt, ["accept", "--markdown"]);
    const terminal = await runAgent(wt, ["accept"]);
    const mcp = await runMcp("discern_accept", wt, {});
    const env = parseJson(json.stdout);
    const observations: Record<
      (typeof VARIANCE_GATED_ACCEPTANCE.surfaces)[number],
      SurfaceObservation
    > = {
      json: {
        refused: json.code === 1 && env.ok === false,
        slug: env.error,
        evidence: [env.message ?? "", ...(env.hints ?? [])].join("\n"),
      },
      markdown: {
        refused: markdown.code === 1,
        slug: AWAITING_VARIANCE_SLUG,
        evidence: markdown.stdout,
      },
      terminal: {
        refused: terminal.code === 1,
        slug: AWAITING_VARIANCE_SLUG,
        evidence: terminal.output,
      },
      mcp: {
        refused: mcp.isError,
        slug: mcp.env.error,
        evidence: [
          String(mcp.env.message ?? ""),
          ...((mcp.env.hints ?? []) as string[]),
        ].join("\n"),
      },
    };
    for (const surface of VARIANCE_GATED_ACCEPTANCE.surfaces) {
      const observation = observations[surface];
      assert(observation.refused, `${surface} must refuse`);
      assertEquals(
        observation.slug,
        AWAITING_VARIANCE_SLUG,
        `${surface} must carry the variance slug`,
      );
      for (const fact of meaning) {
        assertTerminalTextIncludes(
          observation.evidence,
          fact,
          `${surface} omits ${JSON.stringify(fact)}`,
        );
      }
    }
    // Every refusal above was read-only: worktree intact, trunk untouched.
    assert(await exists(wt));
    assertEquals(await exists(join(dir, "api", "surface.txt")), false);
  });
});
