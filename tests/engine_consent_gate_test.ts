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
 * gates.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  AWAITING_CONSENT_SLUG,
  CONSENT_GATED_VERBS,
} from "../src/shared/consent.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** Decode consent-gated lifecycle output for authority and no-effect assertions. */
// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
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
  return wt;
}

/** A fresh, discern-less repo — the state `setup begin` scaffolds from. */
async function freshRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
  await gitInit(dir);
}

/**
 * One consent-gated verb's refusal probe: run the verb WITHOUT its attestation in
 * an arranged temp repo, and report the parsed refusal envelope plus whether
 * anything mutated. Keyed by the registry id — a member with no probe fails the
 * class test (fail-closed), so a newly gated verb must wire one here.
 */
const PROBES: Record<
  string,
  // deno-lint-ignore no-explicit-any
  (dir: string) => Promise<{ code: number; env: any; mutated: boolean }>
> = {
  "setup-begin": async (dir) => {
    await freshRepo(dir);
    const r = await runAgent(dir, ["setup", "begin", "--json"]);
    // Mutated iff the fresh scaffold wrote its config.
    const mutated = await exists(join(dir, "discern.toml"));
    return { code: r.code, env: parseJson(r.stdout), mutated };
  },
  "accept": async (dir) => {
    const wt = await worktreeReadyToLand(dir);
    const r = await runAgent(wt, ["accept", "--json"]);
    // Mutated iff the branch work fast-forwarded onto the trunk, or the worktree
    // was removed — either would mean the refusal touched the tree.
    const mutated = (await exists(join(dir, "feature.txt"))) ||
      !(await exists(wt));
    return { code: r.code, env: parseJson(r.stdout), mutated };
  },
};

Deno.test("consent class: every consent-gated verb refuses without its attestation, mutation-free", async () => {
  for (const verb of CONSENT_GATED_VERBS) {
    const probe = PROBES[verb.id];
    assert(
      probe !== undefined,
      `consent-gated verb "${verb.id}" has no refusal probe — wire one so the ` +
        `class contract covers it`,
    );
    await withTempDir(async (dir) => {
      const { code, env, mutated } = await probe(dir);
      // Refused, read-only, with the one shared slug the class recognises…
      assertEquals(code, 1, `${verb.id} must refuse (exit 1)`);
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
      // …and the recovery names the attestation flag, wherever the verb carries
      // it (accept in a hint, setup in data.command).
      assertStringIncludes(
        JSON.stringify(env),
        verb.flag,
        `${verb.id} must name its ${verb.flag} recovery`,
      );
    });
  }
});

Deno.test("accept: refuses without --confirmed, re-serving the review moment (slug + hint, nothing landed)", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeReadyToLand(dir);

    const r = await runAgent(wt, ["accept", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "accept");
    assertEquals(env.error, AWAITING_CONSENT_SLUG);
    assertHasHint(env, HINTS["accept-awaiting-confirmation"]);
    assertHasHint(env, HINTS["accept-review-via-status"]);
    assertStringIncludes(env.message, "--confirmed");
    // Read-only: the worktree survives and nothing reached the trunk.
    assert(await exists(wt), `worktree must survive\n${r.output}`);
    assertEquals(
      await exists(join(dir, "feature.txt")),
      false,
      "no work may land without the attestation",
    );

    // The human render carries the relay message too (dual-addressed), and is
    // equally mutation-free.
    const human = await runAgent(wt, ["accept"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.output, env.message);
    assert(await exists(wt), "the human refusal must not touch the worktree");
  });
});

Deno.test("accept: --confirmed preserves the conversation-consent landing path", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeReadyToLand(dir);

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.verb, "accept");
    assertEquals(env.data.consent, { source: "conversation" });
    assertStringIncludes(
      env.data.proof_line,
      "landed with conversation consent",
    );
    // The landing happened: worktree gone, branch work on the trunk, receipt carried.
    assertEquals(await exists(wt), false, `should have landed\n${r.output}`);
    assert(
      await exists(join(dir, "feature.txt")),
      "branch work should be on the trunk",
    );
    assertStringIncludes(env.data.proof, "### Receipt");
  });
});

Deno.test("accept: --dry-run previews without the attestation (consent gates writes, not previews)", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeReadyToLand(dir);

    const r = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.dry_run, true);
    // A preview lands nothing — the worktree and trunk are untouched.
    assert(await exists(wt), "a dry-run lands nothing");
    assertEquals(await exists(join(dir, "feature.txt")), false);
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

    // …so the setup-flow landing needs no second attestation: `setup accept` —
    // a separate main-checkout path, never the worktree accept core — lands clean
    // without a `--confirmed` flag, and does not refuse with awaiting_consent.
    const land = await runAgent(dir, ["setup", "accept"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
  });
});
