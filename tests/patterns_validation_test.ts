/** Validation economics preserves verdict, identity and comparison boundaries. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildStreamFacts,
  type Detector,
  type DetectorReport,
  runDetector,
} from "../src/engine/logbook/detectors.ts";
import { routeDetectorReports } from "../src/engine/logbook/routing.ts";
import type { LogbookEvent, VerbEvent } from "../src/engine/logbook/schema.ts";
import {
  canaryMiss,
  detector,
  failedValidationCycle,
  redDone,
  repeatedGreenRuns,
  run,
  step,
  t,
  timedRun,
  validation,
  verb,
} from "./patterns_event_fixtures.ts";

Deno.test("patterns validation streaks require completed failures, not interruption or coordination", () => {
  for (const outcome of ["cancelled", "skipped", "unavailable"] as const) {
    const events = run(Array.from({ length: 6 }, (_, i) =>
      redDone({
        invocation: `interrupted-${i}`,
        steps: [{ ...step("test", 1, "Test"), outcome }],
      })));
    assertEquals(
      runDetector(detector("done-thrash"), buildStreamFacts(events, "main"))
        .findings,
      [],
    );
    assertEquals(
      runDetector(
        detector("loops-to-green"),
        buildStreamFacts([...events, verb({ at: t(9), verb: "done" })], "main"),
      ).findings,
      [],
    );
  }
  const failed = run(Array.from({ length: 4 }, (_, i) =>
    redDone({
      invocation: `failed-${i}`,
      steps: [{ ...step("test", 1, "Test"), outcome: "failed" }],
    })));
  const read = (events: LogbookEvent[]): ReturnType<typeof runDetector> =>
    runDetector(detector("done-thrash"), buildStreamFacts(events, "main"));
  assertEquals(read(failed).findings.length, 1);
  assertEquals(
    read(failed.flatMap((event) => [event, event])).findings,
    read(failed).findings,
  );
  for (
    const error of [
      "awaiting_consent",
      "awaiting_variance",
      "awaiting_declaration",
      "awaiting_standard_approval",
    ]
  ) {
    assertEquals(
      runDetector(
        detector("refusal-loop"),
        buildStreamFacts(
          run(
            Array.from(
              { length: 4 },
              () => ({ verb: "accept", outcome: "refused", error }),
            ),
          ),
          "main",
        ),
      ).findings,
      [],
    );
  }
});

Deno.test("validation findings censor conflicting invocation copies without joining across the gap", () => {
  const events = timedRun(Array.from({ length: 8 }, (_, i) => ({
    invocation: `timed-${i}`,
    duration_ms: i < 4 ? 10_000 : 20_000,
  })));
  const first = events[0];
  assert(first?.kind === "verb");
  const conflicting = { ...first, gate_ran: false };
  assertEquals(
    runDetector(
      detector("duration-creep"),
      buildStreamFacts([...events, conflicting], "main"),
    ).findings,
    [],
  );
  const repeated = repeatedGreenRuns();
  assert(repeated !== undefined);
  const middle = repeated[1];
  assert(middle?.kind === "verb");
  assertEquals(
    runDetector(
      detector("sequence-anomaly"),
      buildStreamFacts([...repeated, { ...middle, gate_ran: false }], "main"),
    ).findings,
    [],
  );
  const failed = run(
    Array.from({ length: 4 }, (_, i) => redDone({ invocation: `red-${i}` })),
  );
  const red = failed[1];
  assert(red?.kind === "verb");
  assertEquals(
    runDetector(
      detector("done-thrash"),
      buildStreamFacts([...failed, { ...red, steps: [] }], "main"),
    ).findings,
    [],
  );
});

Deno.test("canary drift routes distinct completed failures into advisory improvement hints", () => {
  const events = run(Array.from({ length: 5 }, (_, i) => canaryMiss(i)));
  const read = (input: LogbookEvent[]): DetectorReport =>
    runDetector(detector("canary-drift"), buildStreamFacts(input, "main"));
  const report = read(events);
  assertEquals(report.findings.length, 1);
  assertEquals(report.findings[0]?.evidence.failing_invocations, 5);
  assertEquals(report.findings[0]?.evidence.diagnostic_rows, 5);
  assertEquals(
    read(events.flatMap((event) => [event, event])).findings,
    report.findings,
  );
  assertEquals(routeDetectorReports([report]).improvement.length, 1);
  assertEquals(routeDetectorReports([report]).done.length, 0);
  for (const outcome of ["cancelled", "skipped", "failed"] as const) {
    const changed = events.map((event): LogbookEvent =>
      event.kind === "verb"
        ? {
          ...event,
          steps: [{ ...step("canary", 1, "Check"), outcome }, {
            ...step("test", 1, "Test"),
            outcome: "failed",
          }],
        }
        : event
    );
    assertEquals(read(changed).findings, []);
  }
  const unknown = events.map((event): LogbookEvent => {
    if (event.kind !== "verb") return event;
    const { invocation: _identity, ...rest } = event;
    return rest;
  });
  assertEquals(read(unknown).status, "insufficient-evidence");
  assertEquals(
    read(
      events.map((event) =>
        event.kind === "verb" ? { ...event, diagnostics: [] } : event
      ),
    ).status,
    "insufficient-evidence",
  );
  const modern = events.map((event): LogbookEvent =>
    event.kind === "verb"
      ? {
        ...event,
        validation: validation("failed", {
          mode: "full-gate",
          siblings: [{ id: "canary", stage: "check", outcome: "passed" }],
        }),
      }
      : event
  );
  assertEquals(read(modern).findings[0]?.evidence.failing_invocations, 5);
  const ambiguous = modern.map((event): LogbookEvent =>
    event.kind === "verb" && event.validation !== undefined
      ? {
        ...event,
        validation: {
          ...event.validation,
          execution: {
            ...event.validation.execution,
            jobs: [
              ...event.validation.execution.jobs,
              ...event.validation.execution.jobs,
            ],
          },
        },
      }
      : event
  );
  assertEquals(read(ambiguous).status, "insufficient-evidence");
  const latest = events.at(-1);
  assert(latest?.kind === "verb");
  assertEquals(
    read([...events, { ...latest, diagnostics: [] }]).status,
    "insufficient-evidence",
  );
  assertEquals(
    read(
      events.map((event, i) =>
        event.kind === "verb" ? { ...event, epoch: `epoch-${i}` } : event
      ),
    ).status,
    "insufficient-evidence",
  );
});

Deno.test("validation findings keep repeated future schemas and contradictory invocations unknown", () => {
  const future = run([
    {
      verb: "test",
      invocation: "future-red",
      validation: validation("failed", { version: 2 }),
    },
    {
      verb: "test",
      invocation: "future-green",
      validation: validation("passed", { version: 2 }),
    },
  ]);
  assertEquals(
    runDetector(detector("same-tree-flake"), buildStreamFacts(future, "main"))
      .findings,
    [],
  );
  const red = verb({ invocation: "one", validation: validation("failed") });
  const green = { ...red, validation: validation("passed") };
  assertEquals(
    runDetector(
      detector("same-tree-flake"),
      buildStreamFacts([red, green], "main"),
    ).findings,
    [],
  );
});

Deno.test("decision evidence separates differing setups from matched conditions", () => {
  const fixture = failedValidationCycle();
  assert(fixture !== undefined);
  const events = fixture.map((event, i): LogbookEvent =>
    event.kind === "verb" ? { ...event, epoch: `setup-${i}` } : event
  );
  const report = runDetector(
    detector("done-thrash"),
    buildStreamFacts(events, "main"),
  );
  const basis = report.findings[0]?.basis;
  assert(basis !== undefined);
  assert(
    !basis.matched_conditions.some((condition) =>
      condition.dimension === "config-epoch"
    ),
  );
  assert(
    basis.differing_conditions.some((condition) =>
      condition.dimension === "config-epoch" && condition.distinct === 4
    ),
  );
});

Deno.test("explicit rerun requests do not imply execution or previously judged trees", () => {
  const events = run([
    { invocation: "rerun-executed", flags: ["rerun"], gate_ran: true },
    {
      invocation: "rerun-refused",
      flags: ["rerun"],
      gate_ran: false,
      outcome: "failed",
      error: "awaiting_consent",
    },
    { invocation: "rerun-unknown", flags: ["confirmed"] },
  ]);
  const report = runDetector(
    detector("confirmed-rerun"),
    buildStreamFacts([...events, ...events], "main"),
  );
  const finding = report.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.confirmed_runs, 3);
  assertEquals(finding.evidence.executed_runs, 1);
  assertEquals(finding.evidence.unexecuted_runs, 1);
  assertEquals(finding.evidence.execution_unknown_runs, 1);
  assert(!finding.observed.includes("already-judged"));
});

/** Validation comparisons use the ordinary local stream without configured cohort context. */
function report(detector: Detector, events: LogbookEvent[]): DetectorReport {
  return runDetector(detector, buildStreamFacts(events, "main"));
}

Deno.test("validation ordering requires positive execution evidence, not caller coordinates", () => {
  const ordering = detector("sequence-anomaly");
  const cases: Partial<VerbEvent>[][] = [
    [{ verb: "accept", branch: "main" }, { verb: "accept", branch: "main" }],
    [{ verb: "accept", outcome: "refused", error: "awaiting_consent" }, {
      verb: "accept",
      outcome: "refused",
      error: "incomplete",
    }],
    Array.from({ length: 3 }, () => ({ verb: "done", gate_ran: false })),
    Array.from({ length: 3 }, () => ({ verb: "done" })),
    Array.from({ length: 3 }, () => ({
      verb: "done",
      gate_ran: true,
      flags: ["rerun"],
      validation: validation("passed", { mode: "full-gate" }),
    })),
    Array.from({ length: 3 }, (_, i) => ({
      verb: "done",
      gate_ran: true,
      validation: validation("passed", {
        mode: "full-gate",
        setup: `setup-${i}`,
      }),
    })),
  ];
  for (const events of cases) {
    assertEquals(
      report(
        ordering,
        run(events.map((event, i) => ({
          invocation: `observed-${i}`,
          ...event,
        }))),
      ).findings,
      [],
      JSON.stringify(events),
    );
  }
});

Deno.test("validation ordering finds repeated green executions for an unrelated future job", () => {
  const events = run(Array.from({ length: 3 }, (_, i) => ({
    verb: "done",
    gate_ran: true,
    invocation: `physical-${i}`,
    validation: validation("passed", {
      mode: "full-gate",
      job: "future-contract-check",
    }),
  })));
  const findings = report(detector("sequence-anomaly"), events).findings;
  assertEquals(findings.length, 1);
  assertEquals(findings[0]?.evidence.repeated_executions, 2);
  assert(findings[0]?.basis !== undefined);
  const duplicateDelivery = [...events, ...events];
  assertEquals(
    report(detector("sequence-anomaly"), duplicateDelivery).findings,
    findings,
  );
  const interrupted = events.flatMap((
    event,
  ) => [event, verb({ outcome: "failed" })]);
  assertEquals(report(detector("sequence-anomaly"), interrupted).findings, []);
});

Deno.test("duration-creep excludes reused gates, unknown waits, duplicate deliveries, and missing size", () => {
  const baseline = Array.from({ length: 8 }, (_, i) =>
    verb({
      invocation: `timed-${i}`,
      at: t(i),
      gate_ran: true,
      waited_ms: 0,
      duration_ms: i < 4 ? 10_000 : 20_000,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
    }));
  const creep = detector("duration-creep");
  const reused = baseline.map((event) => ({ ...event, gate_ran: false }));
  assertEquals(report(creep, reused).findings, []);
  const unknownWait = baseline.map((event) => {
    const copy = { ...event };
    delete copy.waited_ms;
    return copy;
  });
  assertEquals(report(creep, unknownWait).findings, []);
  const unknownSize = baseline.map((event) => {
    const copy = { ...event };
    delete copy.change;
    return copy;
  });
  assertEquals(report(creep, unknownSize).findings, []);
  assertEquals(
    report(creep, [...baseline, ...baseline]).findings,
    report(creep, baseline).findings,
  );
  assert(report(creep, baseline).findings[0]?.basis !== undefined);
});

/** Four comparable cancelled-job/later-failure relationships with enough
 * completed-job samples for the fail-fast ledger's estimator. */
function failFastLedgerEvents(
  completedTailS: number,
  laterRoundS: number,
): LogbookEvent[] {
  return timedRun(
    Array.from({ length: 4 }).flatMap(() => [
      redDone({
        duration_ms: 5_000,
        steps: [
          { ...step("lint", 1), outcome: "failed" },
          { ...step("test", 0), outcome: "cancelled" },
        ],
      }),
      redDone({
        duration_ms: laterRoundS * 1_000,
        steps: [
          step("lint", 1),
          { ...step("test", completedTailS), outcome: "failed" },
        ],
      }),
    ]),
  );
}

Deno.test("fail-fast ledger distinguishes command observations from job-duration estimates", () => {
  const audit = report(
    detector("masked-failures"),
    failFastLedgerEvents(100, 10),
  );
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.cancelled_jobs, 4);
  assertEquals(finding.evidence.later_distinct_failures, 4);
  assertEquals(finding.evidence.additional_gate_rounds, 4);
  assertEquals(finding.evidence.later_round_command_seconds, 40);
  assertEquals(finding.evidence.estimated_job_tail_seconds, 400);
  assertEquals(finding.evidence.tail_duration_samples, 4);
  assertEquals(
    finding.basis?.values.estimated_job_tail_seconds?.kind,
    "estimated",
  );
  assertEquals(
    finding.basis?.values.later_round_command_seconds?.kind,
    "observed",
  );
  assert(!finding.next_step?.includes("fail_fast = false"));
  assertStringIncludes(finding.observed, "does not establish");
});

Deno.test("fail-fast ledger does not choose a policy from unlike duration totals", () => {
  const audit = report(
    detector("masked-failures"),
    failFastLedgerEvents(10, 100),
  );
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.estimated_job_tail_seconds, 40);
  assertEquals(finding.evidence.later_round_command_seconds, 400);
  assertEquals(finding.evidence.recommendation_supported, 0);
  assert(!finding.next_step?.includes("fail_fast = false"));
  assertStringIncludes(finding.next_step ?? "", "controlled");
});

Deno.test("fail-fast ledger deduplicates delivery and keeps missing cancelled duration unknown", () => {
  const events = failFastLedgerEvents(100, 10);
  const duplicated = report(
    detector("masked-failures"),
    events.flatMap((event) => [event, event]),
  );
  assertEquals(duplicated.findings[0]?.evidence.additional_gate_rounds, 4);
  assertEquals(duplicated.findings[0]?.evidence.tail_duration_samples, 4);
  const missing = events.map((event): LogbookEvent =>
    event.kind !== "verb" ? event : {
      ...event,
      steps: event.steps?.map((step) => {
        if (step.outcome !== "cancelled") return step;
        const { duration_s: _duration, ...rest } = step;
        return rest;
      }) ?? [],
    }
  );
  const finding = report(detector("masked-failures"), missing).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.unestimated_tail_jobs, 4);
  assertEquals(finding.evidence.estimated_job_tail_seconds, undefined);
});

Deno.test("fail-fast ledger routes an unresolved tradeoff to a controlled experiment", () => {
  const audit = report(
    detector("masked-failures"),
    failFastLedgerEvents(100, 100),
  );
  const finding = audit.findings[0];
  assert(finding !== undefined);
  assertStringIncludes(finding.next_step ?? "", "controlled");
  assert(!finding.next_step?.includes("fail_fast = false"));
});

Deno.test("fail-fast ledger keeps invalid durations and unknown execution out of estimates", () => {
  for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const events = failFastLedgerEvents(100, 10).map((event): LogbookEvent =>
      event.kind !== "verb" ? event : { ...event, duration_ms: invalid }
    );
    const finding = report(detector("masked-failures"), events).findings[0];
    assert(finding !== undefined);
    assertEquals(finding.evidence.additional_gate_rounds, 4);
    assertEquals(finding.evidence.unknown_later_round_durations, 4);
    assertEquals(finding.evidence.later_round_command_seconds, undefined);
  }
  const unknownExecution = failFastLedgerEvents(100, 10).map(
    (event): LogbookEvent => {
      if (event.kind !== "verb") return event;
      const { gate_ran: _execution, ...rest } = event;
      return rest;
    },
  );
  const finding =
    report(detector("masked-failures"), unknownExecution).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.unestimated_tail_jobs, 4);
  assertEquals(finding.evidence.estimated_job_tail_seconds, undefined);
});

Deno.test("fail-fast ledger never compares adjacent failures across setup boundaries", () => {
  const events = failFastLedgerEvents(100, 10).map((event, index) =>
    event.kind === "verb" && index % 2 === 1
      ? { ...event, epoch: "other-setup" }
      : event
  );
  const audit = runDetector(
    detector("masked-failures"),
    buildStreamFacts(events, "main"),
  );
  assertEquals(audit.findings, []);
});

Deno.test("fail-fast ledger preserves unknown sample identities and excludes cancellation without a failed verdict", () => {
  const events = failFastLedgerEvents(100, 10);
  const unidentified = events.map((event): LogbookEvent => {
    if (event.kind !== "verb") return event;
    const { invocation: _invocation, ...rest } = event;
    return rest;
  });
  const finding = report(detector("masked-failures"), unidentified).findings[0];
  assert(finding !== undefined);
  assertEquals(finding.evidence.tail_duration_samples, 0);
  assertEquals(finding.evidence.unestimated_tail_jobs, 4);
  assertEquals(finding.evidence.estimated_job_tail_seconds, undefined);
  const cancelled = events.map((event): LogbookEvent =>
    event.kind !== "verb" ? event : {
      ...event,
      steps: event.steps?.map((step) =>
        step.label === "lint" ? { ...step, outcome: "cancelled" } : step
      ) ?? [],
    }
  );
  assertEquals(report(detector("masked-failures"), cancelled).findings, []);
});
