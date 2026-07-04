import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { runParallel, runSerial } from "../src/engine/jobs/runner.ts";
import { finalCode } from "../src/engine/jobs/command.ts";
import {
  capText,
  CAPTURE_CAP,
  normalizeCapturedOutput,
} from "../src/shared/result.ts";
import type { Job } from "../src/engine/jobs/types.ts";

const CWD = Deno.cwd();

function hasDroppedC0Control(s: string): boolean {
  return s.split("").some((ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 && code !== 0x0a && code !== 0x09;
  });
}

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
    cwd: CWD,
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  assertEquals(r.ok, true);
  assertEquals(r.results.map((x) => x.code), [0, 0, 0]);
  assert(s.text().includes("── a ─ ok"), s.text());
});

Deno.test("runParallel: every job executes in its required cwd", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-job-cwd-" });
  try {
    const sink = makeSink();
    const result = await runParallel([
      { label: "where", command: "pwd > observed.cwd" },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      write: sink.write,
    });
    assertEquals(result.ok, true);
    assertEquals(
      (await Deno.readTextFile(join(dir, "observed.cwd"))).trim(),
      await Deno.realPath(dir),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("spawnJob tells captured commands they are not running in a terminal", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-job-env-" });
  try {
    const sink = makeSink();
    const result = await runParallel([
      {
        label: "env",
        command: 'printf \'%s:%s\' "$NO_COLOR" "$TERM" > observed.env',
      },
      {
        label: "override",
        command:
          'NO_COLOR=custom TERM=xterm sh -c \'printf "%s:%s" "$NO_COLOR" "$TERM" > observed-override.env\'',
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      write: sink.write,
    });
    assertEquals(result.ok, true);
    assertEquals(await Deno.readTextFile(join(dir, "observed.env")), "1:dumb");
    assertEquals(
      await Deno.readTextFile(join(dir, "observed-override.env")),
      "custom:xterm",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runParallel: fail-fast cancels the slow sibling promptly", async () => {
  const s = makeSink();
  const start = performance.now();
  const jobs: Job[] = [
    { label: "fail", command: "exit 3" },
    { label: "slow", command: "sleep 30" },
  ];
  const r = await runParallel(jobs, {
    cwd: CWD,
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
  ], {
    cwd: CWD,
    stream: false,
    failFast: false,
    color: false,
    write: s.write,
  });
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
    cwd: CWD,
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
  ], {
    cwd: CWD,
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  assertEquals(r.ok, false);
  assert(s.text().includes("── noisy ─ FAILED (exit 1)"), s.text());
  assert(s.text().includes("hello-stdout"), s.text());
  assert(s.text().includes("oops-stderr"), s.text());
});

Deno.test("a genuinely failed job carries diagnostic output; a passing one carries only an artifact", async () => {
  const s = makeSink();
  const r = await runParallel([
    { label: "fail", command: "echo why-it-failed >&2; exit 1" },
    { label: "pass", command: "echo all-good; true" },
  ], {
    cwd: CWD,
    stream: false,
    failFast: false,
    color: false,
    write: s.write,
  });
  const fail = r.results.find((x) => x.label === "fail");
  const pass = r.results.find((x) => x.label === "pass");
  // The failure's result carries the captured output (the Tier-0 diagnostic payload).
  assert(fail?.output !== undefined, "expected the failed job to carry output");
  assertStringIncludes(fail.output, "why-it-failed");
  assertEquals(fail.cancelled, undefined);
  assertEquals(fail.outputLines, 1);
  assertEquals(fail.errorLikeLines, 0);
  assert(
    fail.outputPath !== undefined,
    "expected the failed job to expose its full output artifact",
  );
  assertStringIncludes(
    await Deno.readTextFile(fail.outputPath),
    "why-it-failed",
  );
  // A passing job stays diagnostically lean, but its full output remains inspectable.
  assertEquals(pass?.output, undefined);
  assertEquals(pass?.outputLines, 1);
  assertEquals(pass?.errorLikeLines, 0);
  assert(
    pass?.outputPath !== undefined,
    "expected the passing job to expose its full output artifact",
  );
  assertStringIncludes(await Deno.readTextFile(pass.outputPath), "all-good");
});

Deno.test("stream-mode failed jobs retain a capped head and tail for diagnostics", async () => {
  const command = [
    "deno eval",
    "'const enc = new TextEncoder();",
    'await Deno.stdout.write(enc.encode("STREAM-HEAD\\n"));',
    "await Deno.stdout.write(new Uint8Array(1_500_000).fill(88));",
    'await Deno.stdout.write(enc.encode("\\nSTREAM-TAIL\\n"));',
    "Deno.exit(1);'",
  ].join(" ");
  const r = await runParallel([
    { label: "stream-fail", command },
  ], {
    cwd: CWD,
    stream: true,
    failFast: false,
    color: false,
    write: () => {},
  });

  const fail = r.results.find((x) => x.label === "stream-fail");
  assertEquals(r.ok, false);
  assert(fail?.output !== undefined, "streamed failure should carry output");
  assertStringIncludes(fail.output, "STREAM-HEAD");
  assertStringIncludes(fail.output, "STREAM-TAIL");
  assertStringIncludes(fail.output, "bytes elided");
  assertMatch(fail.output, /\d+ bytes elided/);
  assert(
    fail.output.length < 1_200_000,
    `stream diagnostic capture should be capped, got ${fail.output.length} chars`,
  );
});

Deno.test("a fail-fast-cancelled sibling is flagged cancelled and carries no output", async () => {
  const s = makeSink();
  const r = await runParallel([
    { label: "boom", command: "exit 1" },
    { label: "victim", command: "echo partial; sleep 30" },
  ], {
    cwd: CWD,
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  const victim = r.results.find((x) => x.label === "victim");
  // The killed sibling is not a real failure: flagged cancelled, no diagnostic output.
  assertEquals(victim?.cancelled, true);
  assertEquals(victim?.output, undefined);
  // …and the banner says "cancelled", not "FAILED".
  assertStringIncludes(s.text(), "── victim ─ cancelled");
});

Deno.test("a sibling that TRAPS SIGTERM and exits non-zero is still cancelled, not a failure", async () => {
  // Regression guard: deriving `cancelled` from the OS signal alone misses a process
  // that traps SIGTERM and exits via its handler (signal===null, code!==0) — a common
  // pattern (test runners, dev servers). Such a sibling must NOT be reported as a
  // genuine failure with a bogus diagnostic. Keyed on the abort signal, it isn't.
  const s = makeSink();
  const r = await runParallel([
    { label: "boom", command: "exit 2" },
    { label: "trapper", command: "trap 'exit 7' TERM; sleep 30" },
  ], {
    cwd: CWD,
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });
  const trapper = r.results.find((x) => x.label === "trapper");
  assertEquals(trapper?.cancelled, true, JSON.stringify(trapper));
  assertEquals(
    trapper?.output,
    undefined,
    "a cancelled sibling owes no diagnostic",
  );
  // The genuine failure (boom) is NOT marked cancelled — it keeps its real verdict.
  const boom = r.results.find((x) => x.label === "boom");
  assertEquals(boom?.cancelled, undefined);
  assertEquals(boom?.code, 2);
});

Deno.test("fail-fast escalates to SIGKILL when a sibling ignores SIGTERM", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-job-sigkill-" });
  try {
    const start = performance.now();
    const r = await runParallel([
      {
        label: "boom",
        command: "while [ ! -f stubborn.ready ]; do sleep 0.05; done; exit 2",
      },
      {
        label: "stubborn",
        command: 'trap "" TERM; : > stubborn.ready; sleep 30',
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      write: () => {},
    });
    const elapsed = performance.now() - start;

    const stubborn = r.results.find((x) => x.label === "stubborn");
    assertEquals(r.ok, false);
    assertEquals(stubborn?.cancelled, true, JSON.stringify(stubborn));
    assertEquals(stubborn?.output, undefined);
    assert(elapsed < 10_000, `expected SIGKILL escalation, took ${elapsed}ms`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("capText: returns short text unchanged, head+tail caps an overflow", () => {
  const small = capText("just a little");
  assertEquals(small.truncated, false);
  assertEquals(small.text, "just a little");

  const big = capText("A".repeat(10_000) + "B".repeat(10_000));
  assert(big.truncated, "expected the 20k string to be truncated");
  assert(
    big.text.length <= CAPTURE_CAP,
    "capped text should stay within the inline bound",
  );
  assertStringIncludes(big.text, "chars elided"); // the middle marker
  assert(big.text.startsWith("A"), "head retained");
  assert(big.text.endsWith("B"), "tail retained");
});

Deno.test("normalizeCapturedOutput: strips terminal controls and keeps visible progress state", () => {
  const input = [
    "\x1b[32mCheck\x1b[0m src/main.ts",
    "progress 10%\rprogress 50%\rprogress done",
    "\x1b]8;;https://example.test\x1b\\click here\x1b]8;;\x1b\\",
    "bell\x07back\bspace\tkeeps-tab",
  ].join("\n");
  const normalized = normalizeCapturedOutput(input);

  assertEquals(
    normalized,
    [
      "Check src/main.ts",
      "progress done",
      "click here",
      "bellbackspace\tkeeps-tab",
    ].join("\n"),
  );
  assert(!normalized.includes("\x1b"), normalized);
  assert(!normalized.includes("\r"), normalized);
  assert(!hasDroppedC0Control(normalized), normalized);
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
    cwd: CWD,
    stream: true,
    failFast: true,
    color: false,
    write: s.write,
  });
  assert(s.text().includes("── j │ one"), s.text());
  assert(s.text().includes("── j │ two"), s.text());
});
