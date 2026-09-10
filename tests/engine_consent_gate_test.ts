import { project } from "./completion_public_fixture.ts";
/**
 * The consent-gated-verb class (ADR 0086 → ADR 0134). Two acts refuse, read-only,
 * without an explicit `--confirmed` attestation: scaffolding a fresh install
 * (`setup begin`) and landing a branch on the trunk (`accept`). Each refusal
 * re-serves the moment the flag stands in for — the setup conversation, or the
 * owner's acceptance of a landing.
 *
 * This suite holds the whole class to one refusal contract, driven off the shared
 * `CONSENT_GATED_VERBS` registry: a future gated verb enrols by adding an entry
 * (and a probe), and fails here until it refuses with the shared slug and names
 * its recovery. It then pins accept's own surface — the refusal shape, that a
 * confirmed call is byte-identical to the prior success path, that a dry-run needs
 * no attestation, and that the setup-flow landing (a separate path) never double-
 * gates. Accept's refusals and preview are read-only, so the class probe's
 * proven worktree carries them as follow-on steps and lands once at the end.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, dirname, join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  proveSetupBranchForAcceptance,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  AWAITING_CONSENT_SLUG,
  CONSENT_GATED_VERBS,
  type ConsentGatedVerbId,
  type ConsentSurface,
} from "../src/shared/consent.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import {
  type CliJsonResultCommand,
  type CliResultEnvelope,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

/** Decode consent-gated lifecycle output for authority and no-effect assertions. */
function parseJson<Command extends CliJsonResultCommand>(
  stdout: string,
  command: Command,
): CliResultForCommand<Command> {
  return decodeCliResult(stdout, command);
}

/** A gate whose only check passes iff `taboo.txt` is absent — mirrors the proven
 * accept-gate scaffold so the confirmed success path is exercised end to end. */
const CONFIG_CHECK = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
].join("\n");

const CHECK_NO_TABOO = ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join(
  "\n",
);

/** Scaffold main + a worktree carrying committed, gate-passing work — the state
 * an agent is in at the review moment, ready to land. */
async function worktreeReadyToLand(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG_CHECK);
  await writeExecutable(join(dir, "check.sh"), CHECK_NO_TABOO);
  await gitInit(dir);
  const wt = await addWorktree(dir, "consent");
  await Deno.writeTextFile(join(wt, "feature.txt"), "branch work\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: work", "--no-gpg-sign");
  const done = await runAgent(wt, ["done", "--json"]);
  assertEquals(done.code, 0, done.output);
  return wt;
}

/** A fresh, discern-less repo — the state `setup begin` scaffolds from. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
  await gitInit(dir);
}

/** The meaning every available surface must carry without paraphrase. */
const CONSENT_MEANING_DIMENSIONS = [
  "act",
  "consequence",
  "scope",
  "continuation",
] as const;
type ConsentMeaningDimension = (typeof CONSENT_MEANING_DIMENSIONS)[number];

interface ConsentSurfaceObservation {
  readonly refused: boolean;
  /** Raw public fields from that surface; exact contract facts must occur here. */
  readonly evidence: readonly string[];
}

interface ConsentProbeResult {
  readonly env: CliResultEnvelope;
  readonly mutated: boolean;
  readonly meaning: Readonly<Record<ConsentMeaningDimension, string>>;
  readonly surfaces: Partial<
    Readonly<Record<ConsentSurface, ConsentSurfaceObservation>>
  >;
  /**
   * Verb-specific surface checks that reuse the probe's fixture after the
   * class assertions pass: read-only refusals and previews first, the one
   * effectful step last.
   */
  readonly followOn?: (t: Deno.TestContext) => Promise<void>;
}

/** Accept's own surface, driven on the proven worktree the class probe built. */
function acceptFollowOn(
  dir: string,
  wt: string,
): (t: Deno.TestContext) => Promise<void> {
  return async (t) => {
    await t.step(
      "accept: refuses without --confirmed, re-serving the review moment (slug + hint, nothing landed)",
      async () => {
        const r = await runAgent(wt, ["accept", "--json"]);
        assertEquals(r.code, 1, r.output);
        const env = parseJson(r.stdout, "accept");
        assert(typeof env.message === "string");
        assertEquals(env.ok, false);
        assertEquals(env.verb, "accept");
        assertEquals(env.error, AWAITING_CONSENT_SLUG);
        assertHasHint(env, HINTS["accept-awaiting-confirmation"]);
        assertStringIncludes((env.hints ?? []).join("\n"), "--confirmed");
        // Read-only: the worktree survives and nothing reached the trunk.
        assert(await targetExists(wt), `worktree must survive\n${r.output}`);
        assertEquals(
          await targetExists(join(dir, "feature.txt")),
          false,
          "no work may land without the attestation",
        );

        // The terminal presentation carries the relay message too, and is
        // equally mutation-free.
        const terminal = await runAgent(wt, ["accept"]);
        assertEquals(terminal.code, 1, terminal.output);
        assertTerminalTextIncludes(terminal.output, env.message);
        assert(
          await targetExists(wt),
          "the terminal refusal must not touch the worktree",
        );
      },
    );

    await t.step(
      "accept: --dry-run previews without the attestation (consent gates writes, not previews)",
      async () => {
        const r = await runAgent(wt, ["accept", "--dry-run", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseJson(r.stdout, "accept");
        assertEquals(env.ok, true);
        assertEquals(env.dry_run, true);
        // A preview lands nothing — the worktree and trunk are untouched.
        assert(await targetExists(wt), "a dry-run lands nothing");
        assertEquals(await targetExists(join(dir, "feature.txt")), false);
      },
    );

    await t.step(
      "accept: --confirmed preserves the conversation-consent landing path",
      async () => {
        const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseJson(r.stdout, "accept");
        assert(env.data !== undefined && !("issues" in env.data));
        assert(typeof env.data.proof_line === "string");
        assertEquals(env.ok, true);
        assertEquals(env.verb, "accept");
        assertEquals(env.data.queue?.[0]?.consent, { source: "conversation" });
        assertStringIncludes(
          env.data.proof_line,
          "landed with conversation consent",
        );
        // The landing happened: worktree gone, branch work on the trunk, proof line carried.
        assertEquals(
          await targetExists(wt),
          false,
          `should have landed\n${r.output}`,
        );
        assert(
          await targetExists(join(dir, "feature.txt")),
          "branch work should be on the trunk",
        );
        assert(!("proof" in env.data));
      },
    );
  };
}

/**
 * Run one gated verb without authority across every surface it declares. A new
 * registry member cannot compile without a probe; adding a surface to a member
 * fails the class assertion until that rendering is observed too.
 */
const PROBES = {
  "accept-emergency": async (dir) => {
    const wt = await project(dir, ["local"]);
    const before = await gitOut(dir, "rev-parse", "main");
    const argv = ["accept", "emergency", "--reason", "Restore service"];
    const json = await runAgent(wt, [...argv, "--json"]);
    const env = parseJson(json.stdout, "accept");
    const markdown = await runAgent(wt, [...argv, "--markdown"]);
    const terminal = await runAgent(wt, argv);
    const tool = TOOLS.find((candidate) => candidate.name === "discern_accept");
    assert(tool !== undefined);
    const mcp = await runTool(
      tool,
      new WorkingRoot(wt),
      { action: "emergency", reason: "Restore service" },
      undefined,
      () => Promise.resolve(undefined),
    );
    const mixed = await runTool(
      tool,
      new WorkingRoot(wt),
      { reason: "Restore service", confirmed: true },
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(mixed.structuredContent?.ok, false);
    assertStringIncludes(
      String(mixed.structuredContent?.message),
      "action: emergency",
    );
    const mixedCli = await runAgent(wt, [
      "accept",
      "--reason",
      "Restore service",
      "--confirmed",
      "--json",
    ]);
    assertEquals(mixedCli.code, 1, mixedCli.output);
    assertEquals(
      parseJson(mixedCli.stdout, "accept").error,
      "invalid_arguments",
    );
    return {
      env,
      mutated: before !== await gitOut(dir, "rev-parse", "main"),
      meaning: {
        act: "Emergency plan",
        consequence: "No passing Proof",
        scope: "displayed local emergency integration",
        continuation: "--confirmed",
      },
      surfaces: {
        json: { refused: json.code === 1, evidence: [JSON.stringify(env)] },
        markdown: { refused: markdown.code === 1, evidence: [markdown.stdout] },
        terminal: { refused: terminal.code === 1, evidence: [terminal.output] },
        mcp: {
          refused: mcp.structuredContent?.ok === false,
          evidence: [JSON.stringify(mcp.structuredContent)],
        },
      },
    };
  },
  "setup-begin": async (dir) => {
    await freshRepo(dir);
    const json = await runAgent(dir, ["setup", "begin", "--json"]);
    const env = parseJson(json.stdout, "setup begin");
    assert(env.data !== undefined && "command" in env.data);
    assert(typeof env.message === "string");
    assert(typeof env.data.command === "string");
    assert(typeof env.data.instructions === "string");
    const markdown = await runAgent(dir, ["setup", "begin", "--markdown"]);
    const terminal = await runAgent(dir, ["setup", "begin"]);
    // Mutated iff the fresh scaffold wrote its config.
    const mutated = await targetExists(join(dir, "discern.toml"));
    return {
      env,
      mutated,
      meaning: {
        act: "Setup needs the owner's consent",
        consequence: "before it writes anything",
        scope: join(dirname(dir), `${basename(dir)}.worktrees`),
        continuation: env.data.command,
      },
      surfaces: {
        json: {
          refused: json.code === 1 && env.ok === false &&
            env.error === AWAITING_CONSENT_SLUG,
          evidence: [env.message, env.data.instructions, env.data.command],
        },
        markdown: {
          refused: markdown.code === 1,
          evidence: [markdown.stdout],
        },
        terminal: {
          refused: terminal.code === 1,
          evidence: [terminal.output],
        },
      },
    };
  },
  "accept": async (dir) => {
    const wt = await worktreeReadyToLand(dir);
    const json = await runAgent(wt, ["accept", "--json"]);
    const env = parseJson(json.stdout, "accept");
    assert(typeof env.message === "string");
    const markdown = await runAgent(wt, ["accept", "--markdown"]);
    const terminal = await runAgent(wt, ["accept"]);
    const tool = TOOLS.find((candidate) => candidate.name === "discern_accept");
    assert(
      tool !== undefined,
      "discern_accept must be in the MCP tool registry",
    );
    const mcp = await runTool(
      tool,
      new WorkingRoot(wt),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    const mcpEnv = mcp.structuredContent;
    // Mutated iff the branch work fast-forwarded onto the trunk, or the worktree
    // was removed — either would mean the refusal touched the tree.
    const mutated = (await targetExists(join(dir, "feature.txt"))) ||
      !(await targetExists(wt));
    return {
      env,
      mutated,
      meaning: {
        act: "the owner's recorded approval",
        consequence: "not landed",
        scope: "current source",
        continuation: "confirmed",
      },
      surfaces: {
        json: {
          refused: json.code === 1 && env.ok === false &&
            env.error === AWAITING_CONSENT_SLUG,
          evidence: [env.message, ...(env.hints ?? [])],
        },
        markdown: {
          refused: markdown.code === 1,
          evidence: [markdown.stdout],
        },
        terminal: {
          refused: terminal.code === 1,
          evidence: [terminal.output],
        },
        mcp: {
          refused: mcp.isError === true &&
            mcpEnv.error === AWAITING_CONSENT_SLUG,
          evidence: [
            String(mcpEnv.message ?? ""),
            ...((mcpEnv.hints ?? []) as string[]),
          ],
        },
      },
      followOn: acceptFollowOn(dir, wt),
    };
  },
} satisfies Record<
  ConsentGatedVerbId,
  (dir: string) => Promise<ConsentProbeResult>
>;

Deno.test("consent class: every consent-gated verb refuses without its attestation, mutation-free; accept then re-serves, previews, and lands on the same proven worktree", async (t) => {
  for (const verb of CONSENT_GATED_VERBS) {
    const probe = PROBES[verb.id];
    assert(
      probe !== undefined,
      `consent-gated verb "${verb.id}" has no refusal probe — wire one so the ` +
        `class contract covers it`,
    );
    await withTempDir(async (dir) => {
      const observed: ConsentProbeResult = await probe(dir);
      const { env, meaning, mutated, surfaces } = observed;
      // Refused, read-only, with the one shared slug the class recognises.
      assertEquals(env.ok, false, `${verb.id}: ${JSON.stringify(env)}`);
      assertEquals(
        env.error,
        AWAITING_CONSENT_SLUG,
        `${verb.id} must refuse with the shared consent slug`,
      );
      assert(
        !mutated,
        `${verb.id}: an awaiting-consent refusal must write nothing`,
      );
      assertEquals(
        Object.keys(surfaces).sort(),
        [...verb.surfaces].sort(),
        `${verb.id}: probe every declared public surface`,
      );
      for (const surface of verb.surfaces) {
        const observation = surfaces[surface];
        assert(
          observation !== undefined,
          `${verb.id}: missing ${surface} observation`,
        );
        assert(observation.refused, `${verb.id}: ${surface} must refuse`);
        const publicText = observation.evidence.join("\n");
        for (const dimension of CONSENT_MEANING_DIMENSIONS) {
          assertTerminalTextIncludes(
            publicText,
            meaning[dimension],
            `${verb.id}: ${surface} omits the exact ${dimension}`,
          );
        }
      }
      // The JSON envelope also names the shared attestation vocabulary.
      assertStringIncludes(
        JSON.stringify(env),
        verb.flag,
        `${verb.id} must name its ${verb.flag} recovery`,
      );
      if (observed.followOn !== undefined) {
        await observed.followOn(t);
      }
    });
  }
});

Deno.test("accept: terminal success reports the same conversation-consent evidence", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeReadyToLand(dir);

    const landed = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(landed.code, 0, landed.output);
    assertTerminalTextIncludes(
      landed.output,
      "landed with conversation consent",
      "the interactive completion must report the authority used",
    );
    assertEquals(await targetExists(wt), false, landed.output);
  });
});

Deno.test("setup accept lands the setup branch with no consent flag — the handshake already collected consent (no double gate)", async () => {
  await withTempDir(async (dir) => {
    await freshRepo(dir);

    // The setup handshake collects consent at `begin --confirmed` (ADR 0086)…
    assertEquals(
      (await runAgent(dir, ["setup", "begin", "--confirmed"])).code,
      0,
    );
    await proveSetupBranchForAcceptance(dir);

    // …so the setup-flow landing needs no second attestation: `setup accept` —
    // a separate main-checkout path, never the worktree accept core — lands clean
    // without a `--confirmed` flag, and does not refuse with awaiting_consent.
    const land = await runAgent(dir, ["setup", "accept"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
  });
});
