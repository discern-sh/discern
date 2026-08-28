import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  parseTerminalCaptureInputScript,
  TERMINAL_REVIEW_GUIDE,
  terminalCaptureHandoff,
} from "../scripts/terminal_capture.ts";
import { terminalReviewResponse } from "../scripts/terminal_review.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const DENO_TASKS_SCHEMA = z.object({
  tasks: z.record(z.string(), z.string()),
}).passthrough();

const ROOT = fromFileUrl(new URL("../", import.meta.url));
const HTML = "<!doctype html><title>Status</title><pre>Status</pre>";

Deno.test("terminal capture hands reviewers to the rendered-review workflow", () => {
  assertEquals(
    terminalCaptureHandoff("/tmp/after-status.html"),
    `/tmp/after-status.html\nReview: ${TERMINAL_REVIEW_GUIDE}`,
  );
  assertEquals(
    TERMINAL_REVIEW_GUIDE,
    "project/map/80-development/reviewing-terminal-output.md",
  );
});

Deno.test("terminal capture scripts require independent keyframe readiness", () => {
  const phases = parseTerminalCaptureInputScript([{
    waitFor: "frame begins",
    capture: { name: "complete", when: "frame complete" },
    steps: [{ bytes: "x" }],
  }]);
  const capture = phases[0]?.capture;
  assertEquals(capture?.name, "complete");
  assertEquals(
    capture?.when.test({
      stdout: "frame begins",
      stderr: "",
      transcript: "frame begins",
      phaseStdout: "frame begins",
      phaseStderr: "",
    }),
    false,
  );
  assertEquals(
    capture?.when.test({
      stdout: "frame begins\nframe complete",
      stderr: "",
      transcript: "frame begins\nframe complete",
      phaseStdout: "frame begins\nframe complete",
      phaseStderr: "",
    }),
    true,
  );

  assertThrows(
    () =>
      parseTerminalCaptureInputScript([{
        waitFor: "frame begins",
        captureAs: "complete",
        steps: [{ bytes: "x" }],
      }]),
    TypeError,
    "capture { name, when }",
  );
});

Deno.test("terminal review serves one self-contained artifact at the root", async () => {
  const response = terminalReviewResponse(
    HTML,
    new Request("http://127.0.0.1:4321/"),
  );

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertStringIncludes(
    response.headers.get("content-security-policy") ?? "",
    "default-src 'none'",
  );
  assertEquals(await response.text(), HTML);
});

Deno.test("terminal review refuses mutation and every non-root path", async () => {
  const head = terminalReviewResponse(
    HTML,
    new Request("http://127.0.0.1:4321/", { method: "HEAD" }),
  );
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");

  const post = terminalReviewResponse(
    HTML,
    new Request("http://127.0.0.1:4321/", { method: "POST" }),
  );
  assertEquals(post.status, 405);
  assertEquals(post.headers.get("allow"), "GET, HEAD");

  const sibling = terminalReviewResponse(
    HTML,
    new Request("http://127.0.0.1:4321/another-file.html"),
  );
  assertEquals(sibling.status, 404);
});

Deno.test("terminal review task grants only artifact read and loopback network access", async () => {
  const config = decodeWith(
    DENO_TASKS_SCHEMA,
    await Deno.readTextFile(join(ROOT, "deno.json")),
  );
  assertEquals(
    config.tasks["terminal:review"],
    "deno run --allow-read --allow-net=127.0.0.1 scripts/terminal_review.ts",
  );
});
