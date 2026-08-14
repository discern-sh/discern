import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
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

const EARLY_EXIT_CHILD = `
console.log("primary input ready");
const input = new Uint8Array(1);
Deno.stdin.setRaw(true);
try {
  await Deno.stdin.read(input);
  console.log("completed after:" + input[0]);
} finally {
  Deno.stdin.setRaw(false);
}
`;

const FALLBACK_CHILD = `
Deno.stdin.setRaw(true);
try {
  const input = new Uint8Array(1);
  console.log("first station ready");
  await Deno.stdin.read(input);
  console.log("second station ready");
  await Deno.stdin.read(input);
  console.log("fallback observed:" + input[0]);
} finally {
  Deno.stdin.setRaw(false);
}
`;

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
        steps: [{ bytes: "\x03" }],
      }],
      timeoutMs: 2_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "observed:3");
  },
});

Deno.test({
  name: "PTY fallback input reaches a live child after its own marker",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", FALLBACK_CHILD],
      cwd: REPO_ROOT,
      input: [
        {
          waitFor: "first station ready",
          steps: [{ bytes: "A" }],
        },
        {
          waitFor: "second station ready",
          steps: [{ bytes: "B" }],
          skipIfExited: true,
        },
      ],
      timeoutMs: 2_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "fallback observed:66");
  },
});

Deno.test({
  name: "PTY fallback input accepts child exit before its readiness marker",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: ["eval", EARLY_EXIT_CHILD],
      cwd: REPO_ROOT,
      input: [
        {
          waitFor: "primary input ready",
          steps: [{ bytes: "A" }],
        },
        {
          waitFor: "unused fallback ready",
          steps: [{ bytes: "B" }],
          skipIfExited: true,
        },
      ],
      timeoutMs: 2_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "completed after:65");
  },
});
