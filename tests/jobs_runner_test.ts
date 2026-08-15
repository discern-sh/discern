import { setActiveInvocationId } from "../src/engine/logbook/invocation_context.ts";
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
import { escapedDaemonCommand } from "./helpers.ts";

const CWD = Deno.cwd();

/** Detect forbidden C0 bytes while allowing captured newlines and tabs. */
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

Deno.test("runParallel: observer sees starts up front and settlements in real completion order", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-job-observer-" });
  try {
    const events: string[] = [];
    const result = await runParallel([
      {
        label: "slow",
        command: "while [ ! -f release ]; do sleep 0.01; done; sleep 0.1",
      },
      { label: "fast", command: ": > release" },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      quiet: true,
      observer: {
        started: (job): void => {
          events.push(`started:${job.label}`);
        },
        settled: (job): void => {
          events.push(`settled:${job.label}`);
        },
      },
    });

    assertEquals(result.ok, true);
    assertEquals(events.slice(0, 2), ["started:slow", "started:fast"]);
    assert(
      events.indexOf("settled:fast") < events.indexOf("settled:slow"),
      events.join(", "),
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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

Deno.test("spawnJob runs captured commands with the non-interactive CI env contract", async () => {
  // Pins the full CAPTURE_ENV contract so a future edit can't silently drop a key:
  // NO_COLOR/TERM=dumb (tools emit plain, parseable output off a terminal) and CI=1
  // (the honest local-CI signal that flips watch-vs-single-run runners into their
  // single-run form, so a bare `test = "<runner>"` never enters watch mode and hangs
  // the gate). A command that sets its own values still overrides them.
  const dir = await Deno.makeTempDir({ prefix: "discern-job-env-" });
  try {
    const sink = makeSink();
    const result = await runParallel([
      {
        label: "env",
        command: 'printf \'%s:%s:%s\' "$NO_COLOR" "$TERM" "$CI" > observed.env',
      },
      {
        label: "override",
        command:
          'NO_COLOR=custom TERM=xterm CI=0 sh -c \'printf "%s:%s:%s" "$NO_COLOR" "$TERM" "$CI" > observed-override.env\'',
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      write: sink.write,
    });
    assertEquals(result.ok, true);
    assertEquals(
      await Deno.readTextFile(join(dir, "observed.env")),
      "1:dumb:1",
    );
    assertEquals(
      await Deno.readTextFile(join(dir, "observed-override.env")),
      "custom:xterm:0",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("spawnJob stamps the recording invocation into DISCERN_SPAWNED_BY", async () => {
  // A `discern` invoked by a job is a self-invocation: the runner passes the
  // recording invocation's id so the Logbook can attribute the child to the
  // run that spawned it instead of scoring it as somebody's decision.
  const dir = await Deno.makeTempDir({ prefix: "discern-job-spawned-" });
  try {
    setActiveInvocationId("11111111-2222-4333-8444-555555555555");
    const sink = makeSink();
    const result = await runParallel([
      {
        label: "spawned",
        command: "printf '%s' \"$DISCERN_SPAWNED_BY\" > observed.spawned",
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      write: sink.write,
    });
    assertEquals(result.ok, true);
    assertEquals(
      await Deno.readTextFile(join(dir, "observed.spawned")),
      "11111111-2222-4333-8444-555555555555",
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
  assert(elapsed < 10_000, `expected interaction cancel, took ${elapsed}ms`);
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

Deno.test("job labels are inert while buffered child-output bytes stay raw", async () => {
  const s = makeSink();
  const label = "job\x1b[31m\nspoof\u009b";
  const child = "\x1b[35mchild\x1b[0m\n";
  const r = await runParallel([
    {
      label,
      command: "printf '\\033[35mchild\\033[0m\\n'",
    },
  ], {
    cwd: CWD,
    stream: false,
    failFast: true,
    color: false,
    write: s.write,
  });

  assertEquals(r.ok, true);
  assertEquals(r.results[0]?.label, label);
  assertStringIncludes(
    s.text(),
    "── job␛[31m␊spoof<U+009B> ─ ok",
  );
  assertEquals(s.text().includes("\x1b[31m"), false);
  assertStringIncludes(s.text(), child);
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

Deno.test("runParallel: an external abort tree-kills every in-flight job promptly", async () => {
  // The class this guards: an externally-initiated shutdown (an MCP client
  // cancelling its call, the server shutting down) must reach the detached job
  // groups — they are in their own process groups, so nothing but the runner's
  // controller can kill them. Regression here means orphaned gate runs.
  const dir = await Deno.makeTempDir({ prefix: "discern-job-abort-" });
  try {
    const external = new AbortController();
    const start = performance.now();
    const run = runParallel([
      // Record the grandchild's PID so the test can prove the whole process
      // GROUP died, not just the direct `sh`.
      {
        label: "slow",
        command: "sh -c 'echo $$ > inner.pid; sleep 30' & wait",
      },
      { label: "slow-too", command: "sleep 30" },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      signal: external.signal,
      write: () => {},
    });
    // Give the jobs a moment to start, then cancel from outside.
    while (!(await Deno.stat(join(dir, "inner.pid")).catch(() => null))) {
      await new Promise((r) => setTimeout(r, 25));
    }
    external.abort();
    const r = await run;
    const elapsed = performance.now() - start;

    assertEquals(r.ok, false);
    for (const label of ["slow", "slow-too"]) {
      const job = r.results.find((x) => x.label === label);
      assertEquals(job?.cancelled, true, JSON.stringify(job));
    }
    assert(elapsed < 10_000, `expected interaction abort, took ${elapsed}ms`);
    // The grandchild (the backgrounded inner sh) must be dead too.
    const innerPid = Number(
      (await Deno.readTextFile(join(dir, "inner.pid"))).trim(),
    );
    await waitForExit(innerPid);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runParallel: an external abort stays bounded when an escaped descendant holds the pipes", async () => {
  // Every kill source (fail-fast, an MCP client cancelling, the process
  // interrupt watcher) funnels into the same abort → tree-kill path, but a
  // descendant that re-parented into its own session survives the group kill
  // while holding the job's stdout/stderr. The kill path must cancel the
  // pending drains after its grace instead of waiting out the daemon —
  // before the bound, a wedged run also ABSORBED process interrupts, since
  // the signal watcher re-raises only once the last run settles.
  const dir = await Deno.makeTempDir({ prefix: "discern-job-escape-abort-" });
  try {
    const external = new AbortController();
    const run = runParallel([
      { label: "wedge", command: escapedDaemonCommand(15, "daemon.up") },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      signal: external.signal,
      write: () => {},
    });
    // Wait until the daemon holds the pipes, then cancel from outside.
    while (!(await Deno.stat(join(dir, "daemon.up")).catch(() => null))) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const start = performance.now();
    external.abort();
    const r = await run;
    const elapsed = performance.now() - start;

    assertEquals(r.ok, false);
    assertEquals(r.results[0]?.cancelled, true, JSON.stringify(r.results[0]));
    assert(
      elapsed < 10_000,
      `the abort should settle within the kill grace, took ${elapsed}ms`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runParallel: an already-aborted signal cancels before any job runs", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-job-preabort-" });
  try {
    const external = new AbortController();
    external.abort();
    const r = await runParallel([
      { label: "never", command: "echo ran > ran.txt; sleep 30" },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      signal: external.signal,
      write: () => {},
    });
    assertEquals(r.ok, false);
    assertEquals(r.results[0]?.cancelled, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("runSerial: an external abort kills the running job and skips the rest", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-serial-abort-" });
  try {
    const external = new AbortController();
    const run = runSerial([
      { label: "current", command: "echo $$ > current.pid; sleep 30" },
      { label: "after", command: "echo ran > after.txt" },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      signal: external.signal,
      write: () => {},
    });
    while (!(await Deno.stat(join(dir, "current.pid")).catch(() => null))) {
      await new Promise((r) => setTimeout(r, 25));
    }
    external.abort();
    const r = await run;

    assertEquals(r.ok, false);
    assertEquals(r.results.map((x) => x.label), ["current"]);
    assertEquals(r.results[0]?.cancelled, true);
    // The job after the abort never started (absent → finish reports "skipped").
    assertEquals(
      await Deno.stat(join(dir, "after.txt")).catch(() => null),
      null,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** Poll until a PID no longer exists (signal 0 probes without sending). */
async function waitForExit(pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      Deno.kill(pid, "SIGCONT");
    } catch {
      return; // gone
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`process ${pid} still alive after abort`);
}

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

Deno.test("stream mode makes configured labels inert without rewriting child bytes", async () => {
  const s = makeSink();
  const label = "stream\x1b[31m\nspoof\u009b";
  const child = "\x1b[35mchild\x1b[0m";
  await runParallel([{
    label,
    command: "printf '\\033[35mchild\\033[0m\\n'",
  }], {
    cwd: CWD,
    stream: true,
    failFast: true,
    color: false,
    write: s.write,
  });
  assertStringIncludes(
    s.text(),
    `── stream␛[31m␊spoof<U+009B> │ ${child}`,
  );
  assertEquals(s.text().includes("\x1b[31m"), false);
});
