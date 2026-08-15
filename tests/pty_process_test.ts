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
  },
});
