/** S05: the three limits and lookahead are distinct; their combined effect is derived once. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  completionCapacityFacts,
  describeCompletionCapacity,
} from "../src/engine/completion/capacity_facts.ts";
import { workCapacity } from "../src/engine/landing_queue/claims.ts";
import { orderedEntries } from "../src/engine/landing_queue/model.ts";
import { queueExample } from "./completion_queue_fixture.ts";

const ENVIRONMENT = (capacity: number, context = "local"): string => `
[execution.${context}]
kind = "borrowed"
prepare = "true"
restore = "true"
reusable = true
resources = []
ignored = []
inputs = ["**"]
capacity = ${capacity}
`;

/** Parse one config fragment and derive its capacity facts. */
function facts(
  toml: string,
  requested?: number,
): ReturnType<typeof completionCapacityFacts> {
  return completionCapacityFacts(parseConfigOrThrow(toml), requested);
}

Deno.test("S05 positive lookahead with completion concurrency 1 leaves no non-head slot", () => {
  const derived = facts(
    `[completion]\nconcurrency = 1\nlookahead = 1\n${ENVIRONMENT(1)}`,
  );
  assertEquals(derived.speculation, {
    kind: "no-slot",
    lookahead: 1,
    binding: "completion.concurrency",
  });
  const prose = describeCompletionCapacity(derived).join("\n");
  assertStringIncludes(prose, "reserved for the next effort to land");
  assertStringIncludes(prose, "Raise concurrency to 2 or more");
});

Deno.test("S05 legitimate unequal limits: concurrency 2, environment capacity 2, test cap 1, lookahead 1", () => {
  const derived = facts(
    `[completion]\nconcurrency = 2\nlookahead = 1\n[gate]\nconcurrent_test_runs = 1\n${
      ENVIRONMENT(2)
    }`,
  );
  assertEquals(derived.concurrency, 2);
  assertEquals(derived.lookahead, 1);
  assertEquals(derived.test_runs, 1);
  assertEquals(derived.environments, [{
    context: "local",
    capacity: 2,
    required: true,
  }]);
  // Two runs may each hold a queue slot; their test stages take turns.
  assertEquals(derived.overlap, {
    requested: 2,
    executions: 2,
    test_stages: 1,
    binding: "gate.concurrent_test_runs",
  });
  // One slot past the reserved head can speculate one position ahead.
  assertEquals(derived.speculation, {
    kind: "available",
    depth: 1,
    slots: 1,
    binding: "completion.concurrency",
  });
  const prose = describeCompletionCapacity(derived).join("\n");
  assertStringIncludes(
    prose,
    "`gate.concurrent_test_runs = 1` is the limit that binds",
  );
  assertStringIncludes(prose, "1 at a time");
});

Deno.test("positive lookahead without a declaration for a required context is not operational", () => {
  const derived = facts("[completion]\nconcurrency = 2\nlookahead = 1\n");
  assertEquals(derived.speculation, {
    kind: "undeclared",
    lookahead: 1,
    contexts: ["local"],
  });
  assertStringIncludes(
    describeCompletionCapacity(derived).join("\n"),
    "early validation is not operational",
  );
  // A declaration for a name outside the required contexts changes nothing.
  const inert = facts(
    `[completion]\nconcurrency = 2\nlookahead = 1\n${ENVIRONMENT(2, "ci")}`,
  );
  assertEquals(inert.environments, [{
    context: "ci",
    capacity: 2,
    required: false,
  }]);
  assertEquals(inert.speculation.kind, "undeclared");
});

Deno.test("lookahead 0 is the ordering-only default whatever the other limits say", () => {
  const derived = facts(
    `[completion]\nconcurrency = 4\n[gate]\nconcurrent_test_runs = 0\n${
      ENVIRONMENT(3)
    }`,
  );
  assertEquals(derived.speculation, { kind: "off" });
  assertEquals(derived.overlap, {
    requested: 2,
    executions: 2,
    test_stages: 2,
    binding: null,
  });
  assertStringIncludes(
    describeCompletionCapacity(derived).join("\n"),
    "validate and land in order",
  );
});

Deno.test("environment capacity binds speculation when it is the smaller spare", () => {
  const derived = facts(
    `[completion]\nconcurrency = 3\nlookahead = 2\n${ENVIRONMENT(1)}`,
  );
  assertEquals(derived.speculation, {
    kind: "available",
    depth: 2,
    slots: 1,
    binding: "execution.capacity",
  });
});

Deno.test("completion concurrency binds the requested overlap before the test cap does", () => {
  const derived = facts(
    "[completion]\nconcurrency = 2\n[gate]\nconcurrent_test_runs = 0\n",
    3,
  );
  assertEquals(derived.overlap, {
    requested: 3,
    executions: 2,
    test_stages: 2,
    binding: "completion.concurrency",
  });
  assertStringIncludes(
    describeCompletionCapacity(derived).join("\n"),
    "`completion.concurrency = 2` is the limit that binds",
  );
});

Deno.test("unequal limits are preserved, never aligned or merged", () => {
  const config = parseConfigOrThrow(
    `[completion]\nconcurrency = 3\nlookahead = 2\n[gate]\nconcurrent_test_runs = 5\n${
      ENVIRONMENT(4)
    }`,
  );
  const derived = completionCapacityFacts(config);
  assertEquals(
    [
      derived.concurrency,
      derived.lookahead,
      derived.test_runs,
      derived.environments[0]?.capacity,
    ],
    [3, 2, 5, 4],
  );
  assert(derived.speculation.kind === "available");
  assertEquals(derived.speculation.slots, 2);
});

Deno.test("a declared environment enables early validation only once setup has proved it", () => {
  const toml = `[completion]\nconcurrency = 2\nlookahead = 1\n${
    ENVIRONMENT(1)
  }`;
  // Configuration alone: the declaration is in place and a slot is spare.
  assertEquals(facts(toml).speculation.kind, "available");
  // With the record consulted, an unproved declaration is not operational.
  const unproven = completionCapacityFacts(parseConfigOrThrow(toml), 2, []);
  assertEquals(unproven.speculation, {
    kind: "unproven",
    lookahead: 1,
    contexts: ["local"],
  });
  assertStringIncludes(
    describeCompletionCapacity(unproven).join(" "),
    "has not been proven by `discern setup done`",
  );
  assertEquals(
    completionCapacityFacts(parseConfigOrThrow(toml), 2, ["local"]).speculation
      .kind,
    "available",
  );
  // Configuration problems are named first: no slot outranks no proof.
  assertEquals(
    completionCapacityFacts(
      parseConfigOrThrow(
        `[completion]\nconcurrency = 1\nlookahead = 1\n${ENVIRONMENT(1)}`,
      ),
      2,
      [],
    ).speculation.kind,
    "no-slot",
  );
});

Deno.test("the capacity facts agree with the work-claim gate about the spare non-head slot", () => {
  // A queue whose head is inactive and whose later efforts sit inside
  // lookahead: the facts name the spare slots; the enforcing gate must admit
  // exactly that many later efforts, for every concurrency the schema allows.
  const { queue } = queueExample(6);
  const entries = orderedEntries(queue);
  for (const concurrency of [1, 2, 3, 4]) {
    const config = parseConfigOrThrow(
      `[completion]\nconcurrency = ${concurrency}\nlookahead = 5\n${
        ENVIRONMENT(8)
      }`,
    );
    const derived = completionCapacityFacts(config, 2, ["local"]);
    const admitted =
      workCapacity(entries, "effort-1", config.completion) === undefined;
    assertEquals(
      admitted,
      derived.speculation.kind === "available",
      `concurrency ${concurrency}: facts ${derived.speculation.kind}, gate ${
        admitted ? "admits" : "refuses"
      }`,
    );
    if (derived.speculation.kind !== "available") continue;
    // With every spare slot occupied by earlier later efforts, the next one
    // waits; with one slot free, it is admitted.
    const slots = derived.speculation.slots;
    const occupied = entries.map((entry, index) =>
      index >= 1 && index <= slots
        ? { ...entry, state: "active" as const }
        : entry
    );
    assertEquals(
      workCapacity(occupied, `effort-${slots + 1}`, config.completion)?.kind,
      "capacity-unavailable",
      `concurrency ${concurrency}: ${slots} spare slots`,
    );
    const oneFree = occupied.map((entry, index) =>
      index === slots ? { ...entry, state: "provisional" as const } : entry
    );
    assertEquals(
      workCapacity(oneFree, `effort-${slots + 1}`, config.completion),
      undefined,
    );
  }
});
