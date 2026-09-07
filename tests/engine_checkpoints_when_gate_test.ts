/** Checkpoint when gate journeys with independently owned fixtures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { readTextIfExists, targetExists } from "../src/shared/fs_presence.ts";
import {
  CHECK_OK,
  CONFIG_ADVISE,
  CONFIG_ONE_CHECKPOINT,
  parseCheckpointGateJson,
  parseJson,
  QUESTION_API,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("done: an indeterminate stop records its drop and serves full evidence", async () => {
  await withTempDir(async (dir) => {
    const config = `${CONFIG_ONE_CHECKPOINT}\nwhen = "sh probe.sh"\n`;
    const wt = await worktreeWithApiChange(dir, config);
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho probe-invalid\nexit 7\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "add probe", "--no-gpg-sign");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.drops?.[0]?.reason, "when_invalid_exit");
    assertEquals(env.data.checkpoints.drops?.[0]?.checkpoint, "api-review");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertStringIncludes(r.output, "probe-invalid");
  });
});

Deno.test("done: an indeterminate advise predicate stays non-blocking over full evidence", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      `${CONFIG_ADVISE}\nwhen = "sh probe.sh"\n`,
    );
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho advise-indeterminate\nexit 7\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "add advise probe", "--no-gpg-sign");

    const result = await runAgent(wt, ["done", "--json"]);
    assertEquals(result.code, 0, result.output);
    const envelope = parseCheckpointGateJson(result.stdout);
    assertEquals(envelope.data.checkpoints.outstanding, undefined);
    assertEquals(envelope.data.checkpoints.advise?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertEquals(
      envelope.data.checkpoints.drops?.some((entry) =>
        entry.reason === "when_invalid_exit" &&
        entry.checkpoint === "api-review"
      ),
      true,
    );
    assertStringIncludes(result.stdout, "advise-indeterminate");
  });
});

Deno.test("done: the when text governs from the merge-base while it executes from the worktree", async () => {
  await withTempDir(async (dir) => {
    // Trunk: a `when` probe that FIRES, named by the governing config.
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho trunk-probe >> probe-ran.log\nexit 0\n",
    );
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      "probe-ran.log\nhijack-ran.log\n",
      { append: true },
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    // The branch rewrites the probe to PASS — and tries to hijack the policy
    // by pointing its own config at a command that would fire.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 10\n",
    );
    await writeExecutable(
      join(wt, "hijack.sh"),
      "#!/usr/bin/env sh\necho hijack >> hijack-ran.log\nexit 0\n",
    );
    await writeConfig(
      wt,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh hijack.sh"
question = "${QUESTION_API}"
`,
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "feat: extend the api",
      "--no-gpg-sign",
    );

    // The governing TEXT is the merge-base's `sh probe.sh`; the script it
    // resolves is the WORKTREE's copy, which passes — so nothing fires, and
    // the branch's hijack command never ran.
    const quiet = await runAgent(wt, ["done", "--json"]);
    assertEquals(quiet.code, 0, quiet.output);
    const ran = await Deno.readTextFile(join(wt, "probe-ran.log"));
    assertStringIncludes(ran, "wt-probe");
    assert(!ran.includes("trunk-probe"), ran);
    assertEquals(
      await targetExists(join(wt, "hijack-ran.log")),
      false,
      "the branch's own `when` text must never run",
    );

    // The same governing text over a firing worktree probe interlocks.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 0\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe fires", "--no-gpg-sign");
    const fired = await runAgent(wt, ["done", "--json"]);
    assertEquals(fired.code, 1, fired.output);
    const env = parseCheckpointGateJson(fired.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "spec-drift");

    // Once served, the checkpoint remains interlocked even if the same
    // worktree probe later passes. Trigger state controls opening, not erasure.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 10\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe passes", "--no-gpg-sign");
    const inactive = await runAgent(wt, ["done", "--json"]);
    assertEquals(inactive.code, 1, inactive.output);
    const inactiveEnv = parseCheckpointGateJson(inactive.stdout);
    assertEquals(inactiveEnv.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      inactiveEnv.data.checkpoints.outstanding?.[0]?.id,
      "spec-drift",
    );
  });
});

Deno.test("done: when matches cannot escape their structural selector", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho 'DISCERN_MATCH README.md'\nexit 0\n",
    );
    await Deno.writeTextFile(join(dir, "README.md"), "stable context\n");
    await gitInit(dir);

    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v1\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "add api", "--no-gpg-sign");

    const opened = await runAgent(wt, ["done", "--json"]);
    assertEquals(opened.code, 1, opened.output);
    const openedEnv = parseCheckpointGateJson(opened.stdout);
    assertEquals(openedEnv.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // The selector-matched content is the subject. Revising it must reopen the
    // open question even though the probe keeps declaring an unrelated stable path.
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v2\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "revise api", "--no-gpg-sign");
    const reopened = await runAgent(wt, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assertEquals(parseJson(reopened.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("done: an unpreparable when input serves full evidence and runs nothing", async () => {
  // With the engine subprocess's temp home pointed at an absent directory,
  // the registered when input file cannot be created: the input phase fails,
  // the command never runs, and the run carries the typed input drop instead
  // of a spawn or exit account.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho ran >> when-ran.log\nexit 0\n",
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "poisoned-temp");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "change api", "--no-gpg-sign");

    const absent = join(dir, "absent-temp-home");
    const result = await runAgent(wt, ["done", "--json"], {
      env: { TMPDIR: absent, TMP: absent, TEMP: absent },
    });
    const envelope = parseCheckpointGateJson(result.stdout);
    const drop = envelope.data.checkpoints.drops?.find((entry) =>
      entry.reason === "when_input_failed"
    );
    assert(
      drop !== undefined,
      `expected a when_input_failed drop: ${result.output}`,
    );
    assertEquals((drop as { checkpoint?: string }).checkpoint, "api-review");
    assertEquals(
      (await readTextIfExists(join(wt, "when-ran.log"))) ?? "",
      "",
      "an unpreparable input must never run the command",
    );
    assertEquals(
      envelope.error,
      AWAITING_DECLARATION_SLUG,
      "an indeterminate stop must interlock over structural evidence",
    );
    assertEquals(envelope.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
  });
});
