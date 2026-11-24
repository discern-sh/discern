/**
 * The concurrent-commands limit: how many of one gate run's commands hold a
 * place at once, which waiting command takes the next free place, and how the
 * runtime override that asks for a limit is read.
 *
 * Every case here is deterministic: a command is a promise the test settles,
 * so no case depends on elapsed time.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type CommandLimit,
  commandLimitFromEnvironment,
  commandLimitHints,
  CONCURRENT_COMMANDS_VARIABLE,
  concurrentCommandsRequested,
  createCommandLimit,
  underCommandLimit,
} from "../src/engine/jobs/command_limit.ts";
import { EnvironmentValueError } from "../src/shared/environment_value.ts";

/**
 * Let every already-queued continuation run. The limit decides synchronously
 * and its callers resume through promise continuations alone, so a fixed count
 * of turns reaches a state no further turn can change.
 */
async function settleContinuations(): Promise<void> {
  for (let turn = 0; turn < 50; turn++) await Promise.resolve();
}

/** An environment holding only the override, or nothing. */
function environment(value?: string): { get(key: string): string | undefined } {
  return {
    get: (key) => key === CONCURRENT_COMMANDS_VARIABLE ? value : undefined,
  };
}

/** A command the test starts through the limit and finishes by hand. */
interface HeldCommand {
  readonly name: string;
  readonly settled: Promise<string>;
  finish(): void;
}

/** Submit one command; `started` records the order commands begin in. */
function submit(
  limit: CommandLimit,
  started: string[],
  name: string,
  turn: { budgetSeconds?: number; order?: number; signal?: AbortSignal } = {},
): HeldCommand {
  const hold = Promise.withResolvers<void>();
  const settled = limit.run(
    {
      budgetSeconds: turn.budgetSeconds,
      order: turn.order ?? 0,
      signal: turn.signal,
    },
    async () => {
      started.push(name);
      await hold.promise;
      return name;
    },
  );
  return { name, settled, finish: hold.resolve };
}

Deno.test("a limit never runs more commands than it has places", async () => {
  const limit = createCommandLimit(2);
  const started: string[] = [];
  const commands = ["a", "b", "c", "d", "e"].map((name, order) =>
    submit(limit, started, name, { order })
  );
  await settleContinuations();
  assertEquals(started, ["a", "b"]);
  assertEquals(limit.waited, 3);

  commands[0]?.finish();
  await commands[0]?.settled;
  await settleContinuations();
  assertEquals(started, ["a", "b", "c"]);

  for (const command of commands) command.finish();
  assertEquals(
    await Promise.all(commands.map((command) => command.settled)),
    ["a", "b", "c", "d", "e"],
  );
  assertEquals(started, ["a", "b", "c", "d", "e"]);
});

type WaitingTurn = readonly [
  name: string,
  turn: { budgetSeconds?: number; order?: number },
];

/**
 * Hold the single place, queue `waiting` behind it in the order given, then
 * let everything finish. The result is the order the commands started in.
 */
async function startOrderBehindOne(
  waiting: readonly WaitingTurn[],
): Promise<string[]> {
  const limit = createCommandLimit(1);
  const started: string[] = [];
  const commands = [
    submit(limit, started, "first", { budgetSeconds: 60 }),
    ...waiting.map(([name, turn]) => submit(limit, started, name, turn)),
  ];
  for (const command of commands) command.finish();
  await Promise.all(commands.map((command) => command.settled));
  return started;
}

Deno.test("the waiting command with the longest time limit starts first", async () => {
  // A command without a time limit is expected to outlast every bounded one;
  // two such commands keep their declared order.
  assertEquals(
    await startOrderBehindOne([
      ["short", { budgetSeconds: 120, order: 0 }],
      ["long", { budgetSeconds: 10_800, order: 1 }],
      ["unbounded", { budgetSeconds: 0, order: 2 }],
      ["no-limit", { order: 3 }],
      ["medium", { budgetSeconds: 1_800, order: 4 }],
    ]),
    ["first", "unbounded", "no-limit", "long", "medium", "short"],
  );
});

Deno.test("equal time limits start in declared order, then in arrival order", async () => {
  assertEquals(
    await startOrderBehindOne([
      ["third", { budgetSeconds: 1_800, order: 3 }],
      ["second", { budgetSeconds: 1_800, order: 2 }],
      ["same-a", { budgetSeconds: 1_800, order: 7 }],
      ["same-b", { budgetSeconds: 1_800, order: 7 }],
    ]),
    ["first", "second", "third", "same-a", "same-b"],
  );
});

Deno.test("a free place goes to the command that asks, whatever its time limit", async () => {
  const limit = createCommandLimit(2);
  const started: string[] = [];
  const commands = [5, 5, 10_800].map((budgetSeconds, order) =>
    submit(limit, started, `command-${order}`, { budgetSeconds, order })
  );
  await settleContinuations();
  assertEquals(started, ["command-0", "command-1"]);
  assertEquals(limit.waited, 1);
  for (const command of commands) command.finish();
  await Promise.all(commands.map((command) => command.settled));
});

Deno.test("a command abandoned while waiting never starts, and one that would wait under a stopped run is refused", async () => {
  const limit = createCommandLimit(1);
  const started: string[] = [];
  const stop = new AbortController();
  // A free place is taken as it would be with no limit, whatever the signal.
  const first = submit(limit, started, "first", { signal: stop.signal });
  const abandoned = submit(limit, started, "abandoned", {
    budgetSeconds: 10_800,
    signal: stop.signal,
  });
  const patient = submit(limit, started, "patient", { budgetSeconds: 60 });
  await settleContinuations();

  stop.abort(new Error("the run stopped"));
  await assertRejects(() => abandoned.settled, Error, "the run stopped");
  const late = submit(limit, started, "late", { signal: stop.signal });
  await assertRejects(() => late.settled, Error, "the run stopped");
  assertEquals(started, ["first"]);

  // The abandoned turns freed nothing and hold nothing.
  first.finish();
  patient.finish();
  assertEquals(await patient.settled, "patient");
  assertEquals(started, ["first", "patient"]);
});

Deno.test("a failing command frees its place", async () => {
  const limit = createCommandLimit(1);
  const started: string[] = [];
  const failing = limit.run(
    { budgetSeconds: 1, order: 0 },
    () => Promise.reject(new Error("command failed")),
  );
  const next = submit(limit, started, "next");
  await assertRejects(() => failing, Error, "command failed");
  next.finish();
  assertEquals(await next.settled, "next");
});

Deno.test("no limit runs every command at once", async () => {
  const started: string[] = [];
  const holds = ["a", "b", "c"].map((name) => {
    const hold = Promise.withResolvers<void>();
    const settled = underCommandLimit(
      undefined,
      { budgetSeconds: 1, order: 0 },
      async () => {
        started.push(name);
        await hold.promise;
      },
    );
    return { settled, finish: hold.resolve };
  });
  // With no limit each command begins inside its own call.
  assertEquals(started, ["a", "b", "c"]);
  for (const hold of holds) hold.finish();
  await Promise.all(holds.map((hold) => hold.settled));
});

Deno.test("a limit needs at least one whole place", () => {
  for (const places of [0, -1, 1.5, Number.NaN]) {
    assertThrows(() => createCommandLimit(places), RangeError);
  }
});

Deno.test("an unset or empty override asks for no limit", () => {
  assertEquals(concurrentCommandsRequested(environment()), undefined);
  assertEquals(concurrentCommandsRequested(environment("")), undefined);
  assertEquals(commandLimitFromEnvironment(environment()), undefined);
});

Deno.test("a positive whole number asks for that many places", () => {
  assertEquals(concurrentCommandsRequested(environment("1")), 1);
  assertEquals(concurrentCommandsRequested(environment("12")), 12);
  assertEquals(commandLimitFromEnvironment(environment("3"))?.limit, 3);
});

Deno.test("any other override value is refused by name", () => {
  for (const value of ["0", "-2", "two", "2.5", " 2", "2 ", "02", "1e3"]) {
    const error = assertThrows(
      () => concurrentCommandsRequested(environment(value)),
      EnvironmentValueError,
    );
    assertEquals(error.variable, CONCURRENT_COMMANDS_VARIABLE);
    assertEquals(error.value, value);
    assert(error.message.includes(CONCURRENT_COMMANDS_VARIABLE), error.message);
    assert(error.message.includes(JSON.stringify(value)), error.message);
  }
});

Deno.test("a result names the limit only when a command waited", async () => {
  assertEquals(commandLimitHints(undefined), []);
  const limit = createCommandLimit(1);
  await limit.run({ budgetSeconds: 1, order: 0 }, () => Promise.resolve());
  assertEquals(commandLimitHints(limit), []);

  const started: string[] = [];
  const first = submit(limit, started, "first");
  const second = submit(limit, started, "second");
  first.finish();
  second.finish();
  await Promise.all([first.settled, second.settled]);
  const [hint] = commandLimitHints(limit);
  assertEquals(hint?.id, "gate-commands-waited");
  assert(hint?.text.includes("at most 1 command at a time"), hint?.text);
  assert(hint?.text.includes("so 1 command waited"), hint?.text);
  assert(hint?.text.includes(CONCURRENT_COMMANDS_VARIABLE), hint?.text);
});
