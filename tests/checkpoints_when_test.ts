/**
 * The `when` executor (`src/engine/checkpoints/when.ts`): all four protocol
 * outcomes — fire, pass, error exit, timeout — plus the match-line parsing and
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
import { waitUntil } from "./waiting.ts";
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
async function waitForPath(path: string): Promise<void> {
  await waitUntil(
    async () => await targetExists(path),
    `child marker ${path}`,
    { timeoutMs: 1_000, intervalMs: 5 },
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

Deno.test("when: bounded protocol output accepts the exact cap and fails open one byte over", async () => {
  await withTempDir(async (dir) => {
    const exact =
      `yes x | tr -d '\\n' | head -c ${CHECKPOINT_WHEN_OUTPUT_BYTES}; exit 1`;
    assertEquals(await runWhenCommand(dir, "probe", exact), { kind: "pass" });
    const over = await runWhenCommand(
      dir,
      "probe",
      `yes x | tr -d '\\n' | head -c ${
        CHECKPOINT_WHEN_OUTPUT_BYTES + 1
      }; exit 1`,
    );
    assert(over.kind === "error");
    assertEquals(over.reason, "when_output_limit");
  });
});

Deno.test("when: a pre-aborted external signal fails open as cancelled", async () => {
  await withTempDir(async (dir) => {
    const controller = new AbortController();
    controller.abort();
    const out = await runWhenCommand(dir, "probe", "sleep 30", {
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
        ["pass", "exit 1", {}],
        ["failure", "exit 7", {}],
        ["timeout", "sleep 30", { timeoutS: 0.05 }],
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
      `printf %s "$DISCERN_CHECKPOINT_INPUT" > "${record}"; sleep 30`,
      { input: INPUT, signal: controller.signal },
    );
    await waitForPath(record);
    controller.abort();
    await pending;
    const inputPath = await Deno.readTextFile(record);
    await assertRejects(() => Deno.stat(inputPath), Deno.errors.NotFound);
  });
});

Deno.test("when: exit 1 passes", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await runWhenCommand(dir, "probe", "false"), {
      kind: "pass",
    });
  });
});

Deno.test("when: any other exit fails open with an advisory naming the protocol", async () => {
  await withTempDir(async (dir) => {
    const out = await runWhenCommand(
      dir,
      "probe",
      "echo boom-detail; exit 3",
    );
    assert(out.kind === "error");
    assertStringIncludes(out.advisory, "exited 3");
    assertStringIncludes(out.advisory, "exit 0 fires, exit 1 passes");
    assertStringIncludes(out.advisory, "did not fire");
    assertStringIncludes(out.advisory, "boom-detail");
  });
});

Deno.test("when: a timeout fails open with an advisory naming the budget", async () => {
  await withTempDir(async (dir) => {
    const out = await runWhenCommand(dir, "probe", "sleep 30", {
      timeoutS: 1,
    });
    assert(out.kind === "error");
    assertStringIncludes(out.advisory, "did not finish within 1s");
    assertStringIncludes(out.advisory, "did not fire");
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
      "#!/bin/sh\nexit 1\n",
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
