/**
 * The `when` executor (`src/engine/checkpoints/when.ts`): both decisive
 * outcomes and every indeterminate lifecycle family, plus match-line parsing and
 * the v1 execution boundary (the command text may come from the governing
 * config, but everything it references resolves from the candidate worktree).
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { join } from "@std/path";
import { tmpdir } from "os";
import { withTempDir } from "./helpers.ts";
import { writeExecutable } from "./engine_helpers.ts";
import {
  CHECKPOINT_WHEN_OUTPUT_BYTES,
  CHECKPOINT_WHEN_TIMEOUT_SECONDS,
  type CheckpointWhenInput,
  parseDiscernMatches,
  runWhenCommand,
} from "../src/engine/checkpoints/when.ts";
import {
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
} from "../src/shared/temp_artifacts.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { targetExists } from "../src/shared/fs_presence.ts";

const CheckpointWhenInputSchema = z.object({
  version: z.literal(1),
  checkpoint: z.object({ id: z.string(), mode: z.enum(["stop", "advise"]) }),
  policy_commit: z.string(),
  changed_files: z.array(z.object({
    path: z.string(),
    kind: z.enum(["added", "modified", "deleted"]),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
  })),
  history: z.object({
    count: z.number().int().nonnegative(),
    fingerprint: z.string(),
  }).optional(),
});

const INPUT: CheckpointWhenInput = {
  version: 1,
  checkpoint: { id: "probe", mode: "stop" },
  policy_commit: "abc123",
  changed_files: [{
    path: "src/a.ts",
    kind: "modified",
    insertions: 2,
    deletions: 1,
    binary: false,
  }],
  history: { count: 2, fingerprint: "ordered-history" },
};

/** Wait until a child has written its synchronization marker. */
async function waitForPath(
  path: string,
  pending: Promise<unknown>,
): Promise<void> {
  await waitForPendingCondition(
    pending,
    async () => await targetExists(path),
    `child marker ${path}`,
    { intervalMs: 5 },
  );
}

/** List registered checkpoint-input artifacts in the test temp directory. */
async function checkpointInputArtifacts(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(tmpdir())) {
    if (
      entry.isFile &&
      entry.name.startsWith(TEMP_ARTIFACT_KINDS.checkpointInput) &&
      entry.name.endsWith(TEMP_ARTIFACT_SUFFIX)
    ) names.push(entry.name);
  }
  return names.sort();
}

Deno.test("when: the shipped budget is the ten-second pre-flight contract", () => {
  // The fixed wall-clock budget is a published contract ("a pre-flight
  // condition answers in seconds"): docs and questions describe it, and every
  // production call site relies on the default. Changing it is a deliberate
  // decision that starts here.
  assertEquals(CHECKPOINT_WHEN_TIMEOUT_SECONDS, 10);
});

Deno.test("when: exit 0 fires (no declared matches)", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await runWhenCommand(dir, "probe", "true"), {
      kind: "fire",
      matches: [],
    });
  });
});

Deno.test("when: receives one versioned structured input and always removes it", async () => {
  await withTempDir(async (dir) => {
    const captured = join(dir, "captured.json");
    const pathRecord = join(dir, "input-path.txt");
    const modeRecord = join(dir, "input-mode.txt");
    const command =
      `cp "$DISCERN_CHECKPOINT_INPUT" "${captured}"; printf %s "$DISCERN_CHECKPOINT_INPUT" > "${pathRecord}"; (stat -c %a "$DISCERN_CHECKPOINT_INPUT" 2>/dev/null || stat -f %Lp "$DISCERN_CHECKPOINT_INPUT") > "${modeRecord}"; exit 0`;
    assertEquals(
      await runWhenCommand(dir, "probe", command, { input: INPUT }),
      {
        kind: "fire",
        matches: [],
      },
    );
    assertEquals(
      decodeWith(
        CheckpointWhenInputSchema,
        await Deno.readTextFile(captured),
      ),
      { ...INPUT, changed_files: [...INPUT.changed_files] },
    );
    assertEquals((await Deno.readTextFile(modeRecord)).trim(), "600");
    const inputPath = await Deno.readTextFile(pathRecord);
    await assertRejects(() => Deno.stat(inputPath), Deno.errors.NotFound);
  });
});

Deno.test("when: bounded protocol output accepts the exact cap and is indeterminate one byte over", async () => {
  await withTempDir(async (dir) => {
    const exact =
      `yes x | tr -d '\\n' | head -c ${CHECKPOINT_WHEN_OUTPUT_BYTES}; exit 10`;
    assertEquals(await runWhenCommand(dir, "probe", exact), { kind: "pass" });
    const over = await runWhenCommand(
      dir,
      "probe",
      `yes x | tr -d '\\n' | head -c ${
        CHECKPOINT_WHEN_OUTPUT_BYTES + 1
      }; exit 10`,
    );
    assert(over.kind === "error");
    assertEquals(over.reason, "when_output_limit");
  });
});

Deno.test("when: a pre-aborted external signal is indeterminate as cancelled", async () => {
  await withTempDir(async (dir) => {
    const controller = new AbortController();
    controller.abort();
    const out = await runWhenCommand(dir, "probe", "tail -f /dev/null", {
      input: INPUT,
      signal: controller.signal,
    });
    assert(out.kind === "error");
    assertEquals(out.reason, "when_cancelled");
  });
});

Deno.test("when: spawn failure after input creation leaves no temporary input", async () => {
  await withTempDir(async (dir) => {
    const before = await checkpointInputArtifacts();
    const out = await runWhenCommand(
      join(dir, "missing-cwd"),
      "probe",
      "true",
      { input: INPUT },
    );
    assert(out.kind === "error");
    assertEquals(out.reason, "when_spawn_failed");
    assertEquals(await checkpointInputArtifacts(), before);
  });
});

Deno.test("when: removes structured input after pass, failure, timeout, and cancellation", async () => {
  await withTempDir(async (dir) => {
    for (
      const [name, command, options] of [
        ["pass", "exit 10", {}],
        ["failure", "exit 7", {}],
        ["timeout", "tail -f /dev/null", { timeoutS: 0.05 }],
      ] as const
    ) {
      const record = join(dir, `${name}.txt`);
      await runWhenCommand(
        dir,
        "probe",
        `printf %s "$DISCERN_CHECKPOINT_INPUT" > "${record}"; ${command}`,
        { input: INPUT, ...options },
      );
      const inputPath = await Deno.readTextFile(record);
      await assertRejects(() => Deno.stat(inputPath), Deno.errors.NotFound);
    }

    const controller = new AbortController();
    const record = join(dir, "cancel.txt");
    const pending = runWhenCommand(
      dir,
      "probe",
      `printf %s "$DISCERN_CHECKPOINT_INPUT" > "${record}"; tail -f /dev/null`,
      { input: INPUT, signal: controller.signal },
    );
    await waitForPath(record, pending);
    controller.abort();
    await pending;
    const inputPath = await Deno.readTextFile(record);
    await assertRejects(() => Deno.stat(inputPath), Deno.errors.NotFound);
  });
});

Deno.test("when: exit 10 passes", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await runWhenCommand(dir, "probe", "exit 10"), {
      kind: "pass",
    });
  });
});

Deno.test("when: exits 1, 127, and every other non-protocol status are indeterminate", async () => {
  await withTempDir(async (dir) => {
    for (const exit of [1, 3, 127]) {
      const out = await runWhenCommand(
        dir,
        "probe",
        `echo boom-detail; exit ${exit}`,
      );
      assert(out.kind === "error");
      assertEquals(out.reason, "when_invalid_exit");
      assertStringIncludes(out.advisory, `exited ${exit}`);
      assertStringIncludes(out.advisory, "exit 0 fires, exit 10 passes");
      assertStringIncludes(out.advisory, "indeterminate");
      assertStringIncludes(out.advisory, "boom-detail");
    }
  });
});

Deno.test("when: an input-cleanup failure overrides a decisive command result", async () => {
  await withTempDir(async (dir) => {
    const record = join(dir, "cleanup-input-path.txt");
    const out = await runWhenCommand(
      dir,
      "probe",
      `input="$DISCERN_CHECKPOINT_INPUT"; printf %s "$input" > "${record}"; rm "$input"; mkdir "$input"; touch "$input/child"; exit 0`,
      { input: INPUT },
    );
    assert(out.kind === "error");
    assertEquals(out.reason, "when_input_cleanup_failed");
    assertStringIncludes(out.advisory, "indeterminate");
    await Deno.remove(await Deno.readTextFile(record), { recursive: true });
  });
});

Deno.test("when: a timeout is indeterminate with an account naming the budget", async () => {
  await withTempDir(async (dir) => {
    const out = await runWhenCommand(dir, "probe", "tail -f /dev/null", {
      timeoutS: 1,
    });
    assert(out.kind === "error");
    assertStringIncludes(out.advisory, "did not finish within 1s");
    assertStringIncludes(out.advisory, "indeterminate");
  });
});

Deno.test("when: DISCERN_MATCH lines declare the subject paths", async () => {
  await withTempDir(async (dir) => {
    const out = await runWhenCommand(
      dir,
      "probe",
      [
        "echo 'DISCERN_MATCH src/a.ts'",
        "echo 'DISCERN_MATCH docs/with space.md'",
        "echo '[probe] DISCERN_MATCH ./src/b.ts'", // prefixed line + ./ strip
        "echo 'DISCERN_MATCH src/a.ts'", // duplicate collapses
        "true",
      ].join("; "),
    );
    assertEquals(out, {
      kind: "fire",
      matches: ["src/a.ts", "docs/with space.md", "src/b.ts"],
    });
  });
});

Deno.test("when: the command runs in the worktree and its referenced scripts come from it", async () => {
  await withTempDir(async (dir) => {
    // The governing config would pin only the TEXT "scripts/probe.sh"; the
    // script's CONTENT resolves from the candidate worktree — the v1 boundary.
    await writeExecutable(
      join(dir, "scripts", "probe.sh"),
      "#!/bin/sh\necho DISCERN_MATCH from-worktree.txt\nexit 0\n",
    );
    const first = await runWhenCommand(dir, "probe", "scripts/probe.sh");
    assertEquals(first, { kind: "fire", matches: ["from-worktree.txt"] });
    // Edit the script in the worktree: the same command text now passes.
    await writeExecutable(
      join(dir, "scripts", "probe.sh"),
      "#!/bin/sh\nexit 10\n",
    );
    assertEquals(await runWhenCommand(dir, "probe", "scripts/probe.sh"), {
      kind: "pass",
    });
  });
});

Deno.test("parseDiscernMatches drops unusable declarations and keeps order", () => {
  const out = parseDiscernMatches(
    [
      "DISCERN_MATCH b.txt",
      "DISCERN_MATCH ", // empty — dropped
      "DISCERN_MATCH /etc/passwd", // absolute — dropped
      "DISCERN_MATCH ../outside.txt", // escapes the root — dropped
      "DISCERN_MATCH a/../..", // escapes the root — dropped
      "no marker on this line",
      "DISCERN_MATCHX not-a-token", // not the whole token
      "prefix DISCERN_MATCH a.txt\r", // CR-terminated line
    ].join("\n"),
  );
  assertEquals(out, ["b.txt", "a.txt"]);
});
