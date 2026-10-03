/**
 * Inside an output capture, every process-output boundary writes to the
 * capture: narration, job bytes and result envelopes all arrive there and
 * nothing reaches the terminal, and nothing inside may prompt. Outside one,
 * the boundaries write to their own streams as before.
 */

import { assert, assertEquals } from "@std/assert";
import {
  type CapturedStream,
  withOutputCapture,
} from "../src/shared/output_capture.ts";
import {
  byteWriter,
  makeOut,
  writeStderr,
  writeStdout,
} from "../src/engine/output.ts";
import { Logger } from "../src/lib/log.ts";
import { emitResult } from "../src/shared/emit.ts";
import { canInteract } from "../src/lib/terminal_interaction.ts";
import { pinnedTerminal } from "./helpers.ts";
import { wholeStreamedOutput } from "../src/lib/live_tail.ts";

/** What reached the real streams while `work` ran. */
async function streams(
  work: () => Promise<void>,
): Promise<{ readonly process: string[] }> {
  const process: string[] = [];
  const decoder = new TextDecoder();
  const out = Deno.stdout.writeSync;
  const err = Deno.stderr.writeSync;
  const log = console.log;
  const error = console.error;
  Deno.stdout.writeSync = (bytes) => {
    process.push(decoder.decode(bytes));
    return bytes.length;
  };
  Deno.stderr.writeSync = (bytes) => {
    process.push(decoder.decode(bytes));
    return bytes.length;
  };
  console.log = (...args: unknown[]) => process.push(args.join(" "));
  console.error = (...args: unknown[]) => process.push(args.join(" "));
  try {
    await work();
  } finally {
    Deno.stdout.writeSync = out;
    Deno.stderr.writeSync = err;
    console.log = log;
    console.error = error;
  }
  return { process };
}

/** Write through every boundary once. */
function writeEverywhere(): void {
  new Logger({
    json: false,
    noColor: true,
    humanStream: "stdout",
    terminal: pinnedTerminal(),
  }).info("logger narration");
  new Logger({ json: false, noColor: true, terminal: pinnedTerminal() }).warn(
    "logger warning",
  );
  makeOut(false).info("engine narration");
  byteWriter("stdout")(new TextEncoder().encode("job bytes\n"));
  byteWriter("stderr")(new TextEncoder().encode("job errors\n"));
  writeStdout("raw stdout\n");
  writeStderr("raw stderr\n");
  emitResult({ ok: true, verb: "status" });
}

Deno.test("inside a capture every boundary writes to it and none to the terminal", async () => {
  const captured: [CapturedStream, string][] = [];
  let interactive: boolean | undefined;
  const { process } = await streams(() =>
    withOutputCapture({
      write: (stream, text) =>
        captured.push([stream, wholeStreamedOutput(text)]),
    }, () => {
      writeEverywhere();
      interactive = canInteract(false);
      return Promise.resolve();
    })
  );
  assertEquals(process, [], "nothing reached the terminal");
  assertEquals(interactive, false, "nothing inside a capture may prompt");
  const text = captured.map(([, written]) => written).join("");
  for (
    const written of [
      "logger narration",
      "logger warning",
      "engine narration",
      "job bytes",
      "job errors",
      "raw stdout",
      "raw stderr",
      '"verb":"status"',
    ]
  ) {
    assert(text.includes(written), `${written} reached the capture`);
  }
  assert(captured.some(([stream]) => stream === "stderr"));
  assert(captured.some(([stream]) => stream === "stdout"));
});

Deno.test("outside a capture the boundaries write to their own streams", async () => {
  const { process } = await streams(() => {
    writeEverywhere();
    return Promise.resolve();
  });
  const text = process.join("");
  for (const written of ["logger narration", "job bytes", "raw stderr"]) {
    assert(text.includes(written), `${written} reached its stream`);
  }
});
