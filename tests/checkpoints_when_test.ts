/**
 * The `when` executor (`src/engine/checkpoints/when.ts`): all four protocol
 * outcomes — fire, pass, error exit, timeout — plus the match-line parsing and
 * the v1 execution boundary (the command text may come from the governing
 * config, but everything it references resolves from the candidate worktree).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { writeExecutable } from "./engine_helpers.ts";
import {
  parseDiscernMatches,
  runWhenCommand,
} from "../src/engine/checkpoints/when.ts";

Deno.test("when: exit 0 fires (no declared matches)", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await runWhenCommand(dir, "probe", "true"), {
      kind: "fire",
      matches: [],
    });
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
    assertStringIncludes(out.advisory, "0 fires, 1 passes");
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
