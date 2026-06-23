import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { runParallel, runSerial } from "../src/engine/jobs/runner.ts";
import { capText, finalCode } from "../src/engine/jobs/command.ts";
import type { Job } from "../src/engine/jobs/types.ts";

/** A capturing output sink for assertions on banners + job output. */
function makeSink(): { write: (c: Uint8Array) => void; text: () => string } {
  const dec = new TextDecoder();
  let buf = "";
  return {
    write: (c: Uint8Array): void => {
      buf += dec.decode(c);
    },
    text: (): string => buf,
  };
}

Deno.test("runParallel: all jobs succeed; empty command is a no-op", async () => {
  const s = makeSink();
  const jobs: Job[] = [
    { label: "a", command: "true" },
    { label: "b", command: "exit 0" }, // `exit 0` records code 0, not a kill
    { label: "c", command: "" }, // empty → `:` no-op
  ];
  const r = await runParallel(jobs, {
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  assertEquals(r.ok, true);
  assertEquals(r.results.map((x) => x.code), [0, 0, 0]);
  assert(s.text().includes("── a ─ ok"), s.text());
});

Deno.test("runParallel: fail-fast cancels the slow sibling promptly", async () => {
  const s = makeSink();
  const start = performance.now();
  const jobs: Job[] = [
    { label: "fail", command: "exit 3" },
    { label: "slow", command: "sleep 30" },
  ];
  const r = await runParallel(jobs, {
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  const elapsed = performance.now() - start;
  assertEquals(r.ok, false);
  assertEquals(r.results.find((x) => x.label === "fail")?.code, 3);
  assert(elapsed < 10_000, `expected prompt cancel, took ${elapsed}ms`);
});

Deno.test("runParallel: without fail-fast every job runs to completion", async () => {
  const s = makeSink();
  const r = await runParallel([
    { label: "fail", command: "exit 1" },
    { label: "ok", command: "true" },
  ], { stream: false, failFast: false, color: false, write: s.write });
  assertEquals(r.ok, false);
  assertEquals(r.results.find((x) => x.label === "ok")?.code, 0);
});

Deno.test("runSerial: stops at the first failure; later jobs never run", async () => {
  const s = makeSink();
  const jobs: Job[] = [
    { label: "first", command: "true" },
    { label: "boom", command: "exit 2" },
    { label: "never", command: "true" },
  ];
  const r = await runSerial(jobs, {
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  assertEquals(r.ok, false);
  // 'never' is absent → finish marks it "skipped".
  assertEquals(r.results.map((x) => x.label), ["first", "boom"]);
});

Deno.test("buffered mode captures combined stdout+stderr after the banner", async () => {
  const s = makeSink();
  const r = await runParallel([
    {
      label: "noisy",
      command: "echo hello-stdout; echo oops-stderr >&2; exit 1",
    },
  ], { stream: false, failFast: true, color: false, write: s.write });
  assertEquals(r.ok, false);
  assert(s.text().includes("── noisy ─ FAILED (exit 1)"), s.text());
  assert(s.text().includes("hello-stdout"), s.text());
  assert(s.text().includes("oops-stderr"), s.text());
});

Deno.test("a genuinely failed job carries its captured output for the diagnostic; a passing one does not", async () => {
  const s = makeSink();
  const r = await runParallel([
    { label: "fail", command: "echo why-it-failed >&2; exit 1" },
    { label: "pass", command: "echo all-good; true" },
  ], { stream: false, failFast: false, color: false, write: s.write });
  const fail = r.results.find((x) => x.label === "fail");
  const pass = r.results.find((x) => x.label === "pass");
  // The failure's result carries the captured output (the Tier-0 diagnostic payload).
  assert(fail?.output !== undefined, "expected the failed job to carry output");
  assertStringIncludes(fail.output, "why-it-failed");
  assertEquals(fail.cancelled, undefined);
  // A passing job stays lean — no output, no cancelled flag.
  assertEquals(pass?.output, undefined);
});

Deno.test("a fail-fast-cancelled sibling is flagged cancelled and carries no output", async () => {
  const s = makeSink();
  const r = await runParallel([
    { label: "boom", command: "exit 1" },
    { label: "victim", command: "echo partial; sleep 30" },
  ], { stream: false, failFast: true, color: false, write: s.write });
  const victim = r.results.find((x) => x.label === "victim");
  // The killed sibling is not a real failure: flagged cancelled, no diagnostic output.
  assertEquals(victim?.cancelled, true);
  assertEquals(victim?.output, undefined);
});

Deno.test("capText: returns short text unchanged, head+tail caps an overflow", () => {
  const small = capText("just a little");
  assertEquals(small.truncated, false);
  assertEquals(small.text, "just a little");

  const big = capText("A".repeat(10_000) + "B".repeat(10_000));
  assert(big.truncated, "expected the 20k string to be truncated");
  assert(
    big.text.length < 20_000,
    "capped text should be shorter than the input",
  );
  assertStringIncludes(big.text, "bytes elided"); // the middle marker
  assert(big.text.startsWith("A"), "head retained");
  assert(big.text.endsWith("B"), "tail retained");
});

Deno.test("finalCode: a self-exited job keeps its real code; a signal-killed job reports 1", () => {
  // The regression this guards: a job that exited 0 must STAY 0 even when a
  // sibling's failure cancelled the stage just after it finished. The old code
  // keyed the result off the abort flag (which fires on EVERY sibling under
  // fail-fast), so an already-passed job got mis-reported as `failed (exit 1)`.
  // Keying off the signal instead distinguishes "killed mid-run" from "finished".
  assertEquals(finalCode(0, null), 0); // clean success stays success
  assertEquals(finalCode(3, null), 3); // a real failure keeps its own code
  // A job the fail-fast tree-kill terminated exits via signal — Deno reports
  // code 143 for SIGTERM / 137 for SIGKILL — and defaults to 1 (shell parity).
  assertEquals(finalCode(143, "SIGTERM"), 1);
  assertEquals(finalCode(137, "SIGKILL"), 1);
});

Deno.test("stream mode prefixes each output line", async () => {
  const s = makeSink();
  await runParallel([{ label: "j", command: "printf 'one\\ntwo\\n'" }], {
    stream: true,
    failFast: true,
    color: false,
    write: s.write,
  });
  assert(s.text().includes("── j │ one"), s.text());
  assert(s.text().includes("── j │ two"), s.text());
});
