/** CI reports compare against the fetched policy while strict completion owns predecessor selection. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";

/** Project recorded readings onto validated envelopes. */
async function observedRecords(root: string): Promise<CompletionRecord[]> {
  return (await observeCompletionRecords(root)).records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
}

Deno.test("a standalone CI report uses the pre-push policy even when current main contains the change", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const base = await gitOut(root, "rev-parse", "main");
    const config = await Deno.readTextFile(`${path}/discern.toml`);
    await Deno.writeTextFile(
      `${path}/discern.toml`,
      config.replace("limit = 90", "limit = 80"),
    );
    await git(path, "add", "discern.toml");
    await git(path, "commit", "-m", "Change held limit");
    await git(root, "merge", "--ff-only", "agent/public-done");
    const strict = await runAgent(root, [
      "done",
      "--policy-base",
      "HEAD",
      "--json",
    ]);
    assertEquals(strict.code, 1, strict.output);
    assert(strict.output.includes("invalid_arguments"), strict.output);
    // The CLI and MCP paths share one refusal naming the live comparison.
    assert(
      strict.output.includes("checks against the trunk's current tip"),
      strict.output,
    );
    const report = await runAgent(root, [
      "done",
      "--ci",
      "--standalone",
      "--policy-base",
      base,
      "--json",
    ]);
    assertEquals(report.code, 1, report.output);
    assert(report.output.includes("loosened"), report.output);
    // The pushed checkout is the trunk tip, so only the policy base can show
    // what the push changed.
    const preview = await runAgent(root, [
      "done",
      "--ci",
      "--standalone",
      "--policy-base",
      base,
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    assert(preview.output.includes("scopes changed: code"), preview.output);
    assertEquals(
      (await observedRecords(root)).filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "candidate"
      ),
      [],
    );
  });
});

Deno.test("a complete CI report runs each declared producer and measurement without queue Proof", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const base = await gitOut(root, "rev-parse", "main");
    const result = await runAgent(path, [
      "done",
      "--ci",
      "--standalone",
      "--policy-base",
      base,
      "--json",
    ]);
    assertEquals(result.code, 0, result.output);
    assert(result.output.includes('"mode":"report"'), result.output);
    assert(result.output.includes('"name":"coverage"'), result.output);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    assertEquals(
      (await observedRecords(root)).filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "candidate"
      ),
      [],
    );
  });
});

Deno.test("a post-landing report names moved standards policy and measures the pushed configuration", async () => {
  await withTempDir(async (root) => {
    const origin = join(root, "origin");
    await Deno.mkdir(origin);
    const effort = await project(
      origin,
      `[standards.size]
run = "echo DISCERN_METRIC size 105"
direction = "down"
limit = 100`,
    );
    const base = await gitOut(origin, "rev-parse", "main");
    const configPath = join(effort, "discern.toml");
    const original = await Deno.readTextFile(configPath);
    // One push carries two commits that move two limits.
    await Deno.writeTextFile(
      configPath,
      original.replace("limit = 100", "limit = 103"),
    );
    await git(effort, "commit", "-am", "Raise size budget");
    const landed = original.replace("limit = 100", "limit = 105").replace(
      "limit = 90",
      "limit = 80",
    );
    await Deno.writeTextFile(configPath, landed);
    await git(effort, "commit", "-am", "Set final budgets");
    await git(origin, "merge", "--ff-only", "agent/public-done");
    const checkout = join(root, "hosted");
    await git(root, "clone", "--quiet", "--no-local", origin, checkout);
    const fail = ["done", "--ci", "--standalone", "--policy-base", base];
    const report = [...fail, "--policy-changes", "report", "--json"];
    const sizeRaised = "standard 'size': ceiling 100 -> 105";
    const floorLowered = "standard 'coverage': floor 90 -> 80";

    const refused = await runAgent(checkout, [...fail, "--json"]);
    assertEquals(refused.code, 1, refused.output);
    assert(refused.output.includes(sizeRaised), refused.output);
    assert(refused.output.includes(floorLowered), refused.output);

    const named = await runAgent(checkout, report);
    assertEquals(named.code, 0, named.output);
    const { data } = decodeCliResult(named, "done");
    assert(data && "standards_limits" in data);
    assertEquals(data.standards_limits?.status, "reported");
    for (const change of [sizeRaised, floorLowered]) {
      assert(data.standards_limits?.reason?.includes(change), named.output);
    }
    assert(
      named.output.includes(`reported, not enforced: ${floorLowered}`),
      named.output,
    );
    assertEquals(
      data.standards?.find((reading) => reading.name === "size")?.value,
      105,
    );
    assertEquals(await Deno.readTextFile(join(checkout, "executions")), "t");

    // A report trusts committed policy only.
    await Deno.writeTextFile(join(checkout, "discern.toml"), original);
    const dirty = await runAgent(checkout, report);
    assertEquals(dirty.code, 1, dirty.output);
    assert(dirty.output.includes("dirty_worktree"), dirty.output);

    /** Commit one further policy state on the hosted checkout. */
    const push = async (title: string, config: string): Promise<void> => {
      await Deno.writeTextFile(join(checkout, "discern.toml"), config);
      await git(
        checkout,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.org",
        "commit",
        "-am",
        title,
      );
    };
    // A deleted standard leaves nothing to measure: it fails by default, and a
    // report names it beside the limit that still differs. The direct verifier
    // tests cover each redefinition.
    const deleted = "standard 'size' was deleted";
    const withoutSize = landed.split("[standards.size]")[0];
    assert(withoutSize !== undefined);
    await push("Delete the standard", withoutSize);
    const strict = await runAgent(checkout, [...fail, "--json"]);
    assertEquals(strict.code, 1, strict.output);
    assert(strict.output.includes(deleted), strict.output);
    const reported = await runAgent(checkout, report);
    assertEquals(reported.code, 0, reported.output);
    assert(
      reported.output.includes(`not enforced: ${floorLowered}`) &&
        reported.output.includes(`; ${deleted}`),
      reported.output,
    );
    // A report still measures: a value over the pushed ceiling fails it.
    await push("Breach the pushed limit", landed.replace("= 105", "= 104"));
    const breached = await runAgent(checkout, report);
    assertEquals(breached.code, 1, breached.output);
    assert(breached.output.includes('"verdict":"regressed"'), breached.output);

    // A report exists only for a standalone CI run against a declared base.
    for (const flags of [["--ci", "--standalone"], ["--policy-base", base]]) {
      const result = await runAgent(checkout, [
        "done",
        ...flags,
        "--policy-changes",
        "report",
        "--json",
      ]);
      assertEquals(result.code, 1, result.output);
      assert(result.output.includes("invalid_arguments"), result.output);
    }
  });
});
