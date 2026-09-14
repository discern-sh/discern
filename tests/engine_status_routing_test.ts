/**
 * Behind-trunk routing on the status surface: one policy decides where a
 * behind branch goes, so the hints can never contradict the landing queue.
 * A clean branch whose HEAD carries honored Proof routes to `accept` — the
 * landing composes and checks the moved trunk itself — while work still
 * being authored (dirty, or without Proof) keeps the update-then-prove
 * route. The class is guarded here behaviorally and by the operating-policy
 * probes in `agent_policy_parity_test.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "routing-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
].join("\n");

const GRANT_CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "routing-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
  "[scopes.notes]",
  'paths = ["notes/**"]',
  "",
  "[acceptance]",
  'pre_authorized = ["notes"]',
  "",
].join("\n");

/** Scaffold a refresh-converged trunk plus two efforts; land the first so the
 * second sits behind. */
async function behindFixture(
  dir: string,
  config: string,
  file: (wt: string) => string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(dir, "commit", "-q", "-m", "converge", "--no-gpg-sign");
  }
  const make = async (name: string): Promise<string> => {
    const wt = await addWorktree(dir, name);
    const target = join(wt, file(wt));
    await Deno.mkdir(join(target, ".."), { recursive: true });
    await Deno.writeTextFile(target, `${name}\n`);
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
    return wt;
  };
  const alpha = await make("alpha");
  const beta = await make("beta");
  assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
  assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
  assertEquals(
    (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
    0,
  );
  return beta;
}

/** The status hints for one checkout, as rendered strings. */
async function statusHints(wt: string): Promise<string[]> {
  const status = await runAgent(wt, ["status", "--json"]);
  assertEquals(status.code, 0, status.output);
  return [...(decodeCliResult(status.stdout, "status").hints ?? [])];
}

Deno.test("behind-trunk status follows proven, dirty, and committed-unproven transitions", async () => {
  await withTempDir(async (dir) => {
    const beta = await behindFixture(dir, CONFIG, () => "beta.txt");
    const hints = await statusHints(beta);
    const accepts = hints.filter((hint) =>
      hint.includes("`discern accept`") && hint.includes("composes")
    );
    assertEquals(accepts.length, 1, hints.join("\n"));
    assert(
      hints.every((hint) => !hint.includes("Run `discern update` directly")),
      `an update prescription survived for proven work:\n${hints.join("\n")}`,
    );
    // Trunk movement alone owes no re-proof either.
    assert(
      hints.every((hint) =>
        !hint.includes("Run `discern done` before handing off")
      ),
      hints.join("\n"),
    );

    // Dirty: authoring continues, so the update route stands.
    await Deno.writeTextFile(join(beta, "beta-wip.txt"), "wip\n");
    const dirtyHints = await statusHints(beta);
    assert(
      dirtyHints.some((hint) => hint.includes("Run `discern update` directly")),
      dirtyHints.join("\n"),
    );

    // Committed past the Proof (no honored Proof at HEAD): the same route.
    await git(beta, "add", "-A");
    await git(beta, "commit", "-q", "-m", "wip", "--no-gpg-sign");
    const unprovenHints = await statusHints(beta);
    assert(
      unprovenHints.some((hint) =>
        hint.includes("Run `discern update` directly")
      ),
      unprovenHints.join("\n"),
    );
    assert(
      unprovenHints.every((hint) => !hint.includes("honored Proof;")),
      unprovenHints.join("\n"),
    );
  });
});

Deno.test("a proven branch behind the trunk under a covering standing grant is told to accept now", async () => {
  await withTempDir(async (dir) => {
    const beta = await behindFixture(
      dir,
      GRANT_CONFIG,
      () => join("notes", "beta.txt"),
    );
    const hints = await statusHints(beta);
    const now = hints.filter((hint) =>
      hint.includes("standing grant") && hint.includes("run `discern accept`")
    );
    assertEquals(now.length, 1, hints.join("\n"));
  });
});
