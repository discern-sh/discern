import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { runPtyProcess } from "./fixtures/pty_process.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

const SLOW_RAW_CHILD = `
await new Promise((resolve) => setTimeout(resolve, 600));
Deno.stdin.setRaw(true);
try {
  console.log("fresh sibling ready");
  const input = new Uint8Array(1);
  const read = await Deno.stdin.read(input);
  console.log("observed:" + (read === null ? "eof" : input[0]));
} finally {
  Deno.stdin.setRaw(false);
}
`;

const RAW_THREE_BYTE_CHILD = `
Deno.stdin.setRaw(true);
try {
  console.log("unrelated input reader ready");
  const input = new Uint8Array(3);
  let offset = 0;
  while (offset < input.length) {
    const read = await Deno.stdin.read(input.subarray(offset));
    if (read === null) break;
    offset += read;
  }
  console.log("observed:" + [...input.subarray(0, offset)].join(","));
} finally {
  Deno.stdin.setRaw(false);
}
`;

const HANGING_CHILD = `
await Deno.writeTextFile(Deno.args[0], String(Deno.pid));
console.log("timeout child ready");
setInterval(() => undefined, 60_000);
`;

const PROGRESSING_RAW_CHILD = `
Deno.stdin.setRaw(true);
try {
  console.log("progress phase one");
  const first = new Uint8Array(1);
  await Deno.stdin.read(first);
  await new Promise((resolve) => setTimeout(resolve, 900));
  console.log("progress phase two");
  const second = new Uint8Array(1);
  await Deno.stdin.read(second);
  await new Promise((resolve) => setTimeout(resolve, 900));
  console.log("progress complete");
} finally {
  Deno.stdin.setRaw(false);
}
`;

const MULTI_WRITE_FRAME_CHILD = `
Deno.stdin.setRaw(true);
try {
  console.log("frame begins");
  await new Promise((resolve) => setTimeout(resolve, 350));
  console.log("frame middle");
  await new Promise((resolve) => setTimeout(resolve, 350));
  console.log("frame complete");
  const input = new Uint8Array(1);
  await Deno.stdin.read(input);
} finally {
  Deno.stdin.setRaw(false);
}
`;

Deno.test({
  name: "PTY input requires an opt-in before continuing a lone Escape write",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await assertRejects(
      () =>
        runPtyProcess({
          command: Deno.execPath(),
          args: ["eval", RAW_THREE_BYTE_CHILD],
          cwd: REPO_ROOT,
          input: [{
            waitFor: "unrelated input reader ready",
            steps: [
              { bytes: "\x1b" },
              { delayMs: 5, bytes: "[B" },
            ],
          }],
        }),
      TypeError,
      "must not leave a lone Escape byte before later input",
    );

    const allowed = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", RAW_THREE_BYTE_CHILD],
      cwd: REPO_ROOT,
      input: [{
        waitFor: "unrelated input reader ready",
        steps: [
          { bytes: "\x1b", allowLoneEscape: true },
          { delayMs: 5, bytes: "[B" },
        ],
      }],
    });
    assertEquals(allowed.code, 0, allowed.transcript);
    assertStringIncludes(allowed.transcript, "observed:27,91,66");
  },
});

Deno.test({
  name:
    "PTY input waits for observed child readiness instead of elapsed startup time",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", SLOW_RAW_CHILD],
      cwd: REPO_ROOT,
      input: [{
        waitFor: "fresh sibling ready",
        captureAs: "ready",
        steps: [{ bytes: "\x03" }],
      }],
      timeoutMs: 2_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "observed:3");
    assertStringIncludes(result.keyframes.ready ?? "", "fresh sibling ready");
    assertEquals(result.keyframes.ready?.includes("observed:3"), false);
  },
});

Deno.test({
  name: "PTY timeout renews when a scripted input phase makes progress",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", PROGRESSING_RAW_CHILD],
      cwd: REPO_ROOT,
      input: [{
        waitFor: "progress phase one",
        steps: [{ bytes: "a" }],
      }, {
        waitFor: "progress phase two",
        steps: [{ bytes: "b" }],
      }],
      timeoutMs: 1_500,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "progress complete");
  },
});

Deno.test({
  name: "PTY phase settling waits for one quiet output window",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", MULTI_WRITE_FRAME_CHILD],
      cwd: REPO_ROOT,
      input: [{
        waitFor: "frame begins",
        settleMs: 450,
        captureAs: "settled-frame",
        steps: [{ bytes: "x" }],
      }],
      timeoutMs: 3_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(
      result.keyframes["settled-frame"] ?? "",
      "frame complete",
    );
  },
});

Deno.test({
  name: "PTY process applies scripted terminal geometry",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: "sh",
      args: ["-c", "stty size"],
      cwd: REPO_ROOT,
      geometry: { columns: 97, rows: 31 },
      keepInputOpen: true,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "31 97");
    assert(result.transcriptBytes.length > 0);
    assertEquals(
      new TextDecoder().decode(result.transcriptBytes),
      result.transcript,
    );
  },
});

Deno.test({
  name: "PTY timeout kills the real descendant after observed readiness",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const pidPath = join(dir, "child.pid");
      const error = await assertRejects(
        () =>
          runPtyProcess({
            command: Deno.execPath(),
            args: ["eval", HANGING_CHILD, pidPath],
            cwd: REPO_ROOT,
            input: [{
              waitFor: "timeout child ready",
              steps: [{}],
            }],
            timeoutMs: 800,
          }),
        Error,
        "exceeded 800ms",
      );
      assertStringIncludes(error.message, "phase 1/1 complete");
      assertStringIncludes(error.message, "timeout child ready");

      const pid = (await Deno.readTextFile(pidPath)).trim();
      const probe = await new Deno.Command("ps", {
        args: ["-p", pid, "-o", "pid="],
        stdout: "piped",
        stderr: "null",
      }).output();
      assertEquals(
        probe.success && new TextDecoder().decode(probe.stdout).trim() !== "",
        false,
        `PTY timeout left child ${pid} running`,
      );
    });
  },
});
