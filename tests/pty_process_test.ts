import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { ptyOutputContains, runPtyProcess } from "./fixtures/pty_process.ts";
import { realPtyTest } from "./real_pty.ts";
import { readPidIfReady } from "./process_id.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const PTY_CHILD_PROGRAM = join(
  REPO_ROOT,
  "tests",
  "fixtures",
  "pty_child_program.ts",
);

/** Build argv for one executable child scenario. */
function childArgs(scenario: string, ...args: string[]): string[] {
  return ["run", "--quiet", "-A", PTY_CHILD_PROGRAM, scenario, ...args];
}

realPtyTest({
  name: "PTY input requires an opt-in before continuing a lone Escape write",
  contracts: ["line-discipline"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await assertRejects(
      () =>
        runPtyProcess({
          command: Deno.execPath(),
          args: childArgs("raw-three-byte"),
          cwd: REPO_ROOT,
          input: [{
            waitFor: "unrelated input reader ready",
            steps: [
              { bytes: "\x1b" },
              { delayMs: 5, bytes: "[B" },
            ],
          }],
        }),
      TypeError,
      "must not leave a lone Escape byte before later input",
    );

    const allowed = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("raw-three-byte"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: "unrelated input reader ready",
        steps: [
          { bytes: "\x1b", allowLoneEscape: true },
          { delayMs: 5, bytes: "[B" },
        ],
      }],
    });
    assertEquals(allowed.code, 0, allowed.transcript);
    assertStringIncludes(allowed.transcript, "observed:27,91,66");
  },
});

realPtyTest({
  name:
    "PTY input waits for observed child readiness instead of elapsed startup time",
  contracts: ["line-discipline", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("slow-raw"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: "fresh sibling ready",
        capture: {
          name: "ready",
          when: ptyOutputContains("fresh sibling ready"),
        },
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

realPtyTest({
  name: "PTY completion timeout starts after the final scripted input phase",
  contracts: ["process-lifecycle"],
  canary: false,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("progressing-raw"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: "progress phase one",
        steps: [{ bytes: "a" }],
      }, {
        waitFor: "progress phase two",
        steps: [{ bytes: "b" }],
      }],
      timeoutMs: 1_500,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "progress complete");
  },
});

realPtyTest({
  name: "PTY user-input modes keep the wrapper pipe open until the child exits",
  contracts: ["eof-delivery", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const modes = [
      {
        name: "immediate",
        options: { initialInput: "x" },
      },
      {
        name: "readiness-gated",
        options: {
          input: [{
            waitFor: "unrelated reader ready",
            steps: [{ bytes: "x" }],
          }],
        },
      },
    ] as const;
    const violations: string[] = [];

    for (const mode of modes) {
      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: childArgs("held-input"),
        cwd: REPO_ROOT,
        ...mode.options,
        timeoutMs: 3_000,
      });

      assertEquals(result.code, 0, `${mode.name}: ${result.transcript}`);
      if (!result.transcript.includes("input-state:open")) {
        violations.push(`${mode.name}: ${JSON.stringify(result.transcript)}`);
      }
    }
    assertEquals(violations, []);
  },
});

realPtyTest({
  name: "PTY wrapper cannot consume the command's SHELL override",
  contracts: ["platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const script = join(dir, "script");
      const commandShell = join(dir, "command-shell");
      await Deno.writeTextFile(
        script,
        [
          "#!/bin/sh",
          // Emulate util-linux script(1): its -c command is interpreted by the
          // wrapper's own $SHELL before the target process can start.
          'if [ "$2" = "-e" ]; then',
          '  exec "${SHELL:-/bin/sh}" -c "$4"',
          "fi",
          // Accept the BSD argv shape too, so the Linux contract remains
          // executable on every Unix development host.
          "shift 2",
          'exec "${SHELL:-/bin/sh}" -c \'exec "$@"\' discern-script "$@"',
          "",
        ].join("\n"),
      );
      await Deno.chmod(script, 0o755);
      await Deno.writeTextFile(
        commandShell,
        [
          "#!/bin/sh",
          'echo "wrapper intercepted command"',
          "exit 0",
          "",
        ].join("\n"),
      );
      await Deno.chmod(commandShell, 0o755);

      const result = await runPtyProcess({
        command: Deno.execPath(),
        args: childArgs("shell-reporting"),
        cwd: REPO_ROOT,
        env: {
          PATH: `${dir}:${Deno.env.get("PATH") ?? ""}`,
          SHELL: commandShell,
        },
      });

      assertEquals(result.code, 0, result.transcript);
      assertStringIncludes(result.transcript, `command-shell:${commandShell}`);
    });
  },
});

realPtyTest({
  name: "PTY keyframe waits for its own condition after early input readiness",
  contracts: ["platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("multi-write-frame"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: "frame begins",
        capture: {
          name: "delayed-frame",
          when: ptyOutputContains("frame complete"),
        },
        steps: [{ bytes: "x" }],
      }],
      timeoutMs: 3_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(
      result.keyframes["delayed-frame"] ?? "",
      "frame complete",
    );
  },
});

realPtyTest({
  name: "PTY ordered readiness markers capture a complete multi-write frame",
  contracts: ["platform-transport"],
  canary: false,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("multi-write-frame"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: ["frame begins", "frame complete"],
        capture: {
          name: "settled-frame",
          when: ptyOutputContains("frame complete"),
        },
        steps: [{ bytes: "x" }],
      }],
      timeoutMs: 3_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(
      result.keyframes["settled-frame"] ?? "",
      "frame complete",
    );
  },
});

realPtyTest({
  name: "PTY input phases accept a positive condition over fresh output",
  contracts: ["platform-transport"],
  canary: false,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: Deno.execPath(),
      args: childArgs("multi-write-frame"),
      cwd: REPO_ROOT,
      input: [{
        waitFor: ptyOutputContains(["frame begins", "frame complete"]),
        steps: [{ bytes: "x" }],
      }],
      timeoutMs: 3_000,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "frame complete");
  },
});

realPtyTest({
  name: "PTY process applies scripted terminal geometry",
  contracts: ["resize-delivery", "control-rendering"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const result = await runPtyProcess({
      command: "sh",
      args: [
        "-c",
        'stty size; printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\\n" "$TERM" "$COLORTERM" "$LANG" "$LC_ALL" "$CI" "$NO_COLOR" "$FORCE_COLOR" "$COLUMNS" "$LINES"',
      ],
      cwd: REPO_ROOT,
      geometry: { columns: 97, rows: 31 },
      keepInputOpen: true,
    });

    assertEquals(result.code, 0, result.transcript);
    assertStringIncludes(result.transcript, "31 97");
    assertStringIncludes(
      result.transcript,
      "xterm-256color||en_US.UTF-8||false|||97|31",
    );
    assert(result.transcriptBytes.length > 0);
    assertEquals(
      new TextDecoder().decode(result.transcriptBytes),
      result.transcript,
    );
  },
});

realPtyTest({
  name: "PTY timeout kills the real descendant after observed readiness",
  contracts: ["signal-delivery", "process-lifecycle"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const pidPath = join(dir, "child.pid");
      const error = await assertRejects(
        () =>
          runPtyProcess({
            command: Deno.execPath(),
            args: childArgs("hanging", pidPath),
            cwd: REPO_ROOT,
            input: [{
              waitFor: "timeout child ready",
              steps: [{}],
            }],
            timeoutMs: 800,
          }),
        Error,
        "exceeded 800ms",
      );
      assertStringIncludes(error.message, "phase 1/1 complete");
      assertStringIncludes(error.message, "timeout child ready");

      const pid = await readPidIfReady(pidPath);
      assert(pid !== undefined);
      const probe = await new Deno.Command("ps", {
        args: ["-p", String(pid), "-o", "pid="],
        stdout: "piped",
        stderr: "null",
      }).output();
      assertEquals(
        probe.success && new TextDecoder().decode(probe.stdout).trim() !== "",
        false,
        `PTY timeout left child ${pid} running`,
      );
    });
  },
});
