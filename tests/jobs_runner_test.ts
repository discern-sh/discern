import { assert, assertEquals } from "@std/assert";
import { runParallel, runSerial } from "../src/engine/jobs/runner.ts";
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
