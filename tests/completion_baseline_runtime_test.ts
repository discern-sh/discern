/** Behavioral coverage of literal input, bounded captures, and host adapters. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join, toFileUrl } from "@std/path";
import {
  parseProjectScriptArguments,
  simpleCommandArgv,
} from "../src/engine/desk/literal_argv.ts";
import { generatedMergeChecks } from "../src/engine/doctor/generated_merge.ts";
import {
  PRODUCER_CAPTURE_BYTES,
  runCapturedCommands,
} from "../src/engine/jobs/captured.ts";
import {
  abortableWait,
  terminalPlaybackPort,
} from "../src/lib/terminal_animation.ts";
import { openInBrowser } from "../src/lib/open_browser.ts";
import { denoMetadata } from "../src/shared/deno_metadata.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import type { Scheduler } from "../src/shared/scheduler.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("literal argument boundaries preserve quoted words and refuse incomplete editor syntax", () => {
  for (
    const [input, args] of [
      ["  alpha\t'' \"\" beta  ", ["alpha", "", "", "beta"]],
      ['\'a b\' c\\ d "e\\"f"', ["a b", "c d", 'e"f']],
      ["'$(data)' \"a;b\"", ["$(data)", "a;b"]],
    ] as const
  ) {
    assertEquals(parseProjectScriptArguments(input), { ok: true, args });
    assertEquals(simpleCommandArgv(input), [...args]);
  }
  for (const input of ["x\\", '"x\\', "'x", '"x']) {
    assertEquals(parseProjectScriptArguments(input).ok, false, input);
    assertEquals(simpleCommandArgv(input), undefined, input);
  }
  for (
    const input of ['"$HOME"', '"`date`"', "editor;next", "editor*", "$(cmd)"]
  ) {
    assertEquals(simpleCommandArgv(input), undefined, input);
    assertEquals(parseProjectScriptArguments(input).ok, true, input);
  }
  assertEquals(simpleCommandArgv(" \t "), undefined);
});

Deno.test("terminal frame waits cancel on abort and detach abort listeners after delivery", async () => {
  let callback: (() => void) | undefined;
  let schedules = 0;
  let cancellations = 0;
  const scheduler: Scheduler = {
    scheduleTimeout: (fn, delay) => {
      assertEquals(delay, 42);
      callback = fn;
      return ++schedules;
    },
    cancelTimeout: (handle) => {
      assertEquals(handle, schedules);
      cancellations++;
    },
    scheduleInterval: () => {
      throw new Error("frame waits do not repeat");
    },
    cancelInterval: () => {
      throw new Error("frame waits do not repeat");
    },
  };
  const before = new AbortController();
  before.abort();
  await assertRejects(
    () => abortableWait(42, before.signal, scheduler),
    DOMException,
    "interrupted",
  );
  assertEquals(schedules, 0);
  const during = new AbortController();
  const interrupted = abortableWait(42, during.signal, scheduler);
  during.abort();
  await assertRejects(() => interrupted, DOMException, "interrupted");
  assertEquals(cancellations, 1);
  const after = new AbortController();
  const writes: string[] = [];
  const port = terminalPlaybackPort((text) => writes.push(text), scheduler);
  const completed = port.wait(42, after.signal);
  assert(callback !== undefined);
  callback();
  await completed;
  after.abort();
  assertEquals(cancellations, 1);
  port.write("frame");
  assertEquals(writes, ["frame"]);
});

Deno.test("failed Deno metadata preserves a command diagnostic", async () => {
  await withTempDir(async (root) => {
    await assertRejects(
      () => denoMetadata(root, ["info", "missing-module.ts"]),
      Error,
      "failed:",
    );
  });
});

Deno.test("producer output beyond the complete-capture bound fails and retains its reproduction file", async () => {
  await withTempDir(async (root) => {
    const result = await runCapturedCommands({
      root,
      label: "oversized-protocol",
      timeout: 60,
      signal: new AbortController().signal,
      environment: {},
      commands: [
        [
          Deno.execPath(),
          "eval",
          `await Deno.stdout.write(new Uint8Array(${
            PRODUCER_CAPTURE_BYTES + 1
          }));`,
        ].map(quoteCommandWord).join(" "),
      ],
    });
    assertEquals(result.result.status, "failed");
    assertEquals(result.capture_complete, false);
    assertEquals(result.stdout.length, 0);
    assertStringIncludes(result.result.failureMessage ?? "", "byte bound");
    assertEquals(
      (await Deno.stat(result.output_path)).size,
      PRODUCER_CAPTURE_BYTES + 1,
    );
    const empty = await runCapturedCommands({
      root,
      label: "empty-protocol",
      timeout: 60,
      signal: new AbortController().signal,
      environment: {},
      commands: [],
    });
    assertEquals(empty.capture_complete, true);
    assertEquals(empty.stdout.length, 0);
    assertEquals(empty.result.status, "ok");
  });
});

Deno.test("browser adapter executes literal argv and preserves launcher failures", async () => {
  await withTempDir(async (root) => {
    const launcher = join(root, "xdg-open");
    await Deno.writeTextFile(
      launcher,
      '#!/bin/sh\nprintf "%s" "$1" > "$BROWSER_ARGUMENT"\nexit 7\n',
    );
    await Deno.chmod(launcher, 0o755);
    const url = "https://example.test/a?literal=$(never-run)&x=1";
    const program = `import { openInBrowser } from ${
      JSON.stringify(toFileUrl(join(REPO_ROOT, "src/lib/open_browser.ts")).href)
    }; console.log(JSON.stringify(await openInBrowser(${
      JSON.stringify(url)
    }, { os: 'linux' })));`;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["eval", program],
      env: { PATH: root, BROWSER_ARGUMENT: join(root, "argument") },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(output.success, new TextDecoder().decode(output.stderr));
    assertStringIncludes(
      new TextDecoder().decode(output.stdout),
      "xdg-open exited with status 7",
    );
    assertEquals(await Deno.readTextFile(join(root, "argument")), url);
  });
  const failure = await openInBrowser("https://example.test", {
    os: "linux",
    run: () => Promise.reject("launcher unavailable"),
  });
  assertEquals(failure.status, "failed");
  if (failure.status === "failed") {
    assertEquals(failure.message, "launcher unavailable");
  }
});

Deno.test("generated merge doctor diagnoses an unavailable Git checkout", async () => {
  await withTempDir(async (root) => {
    const checks = await generatedMergeChecks(root, [], ["AGENTS.md"], [
      "AGENTS.md",
    ]);
    assert(checks.length > 0);
    assert(checks.every((check) => !check.ok));
    assert(checks.some((check) => check.detail.includes("Git")));
    assert(checks.every((check) => check.fix !== undefined));
  });
});
