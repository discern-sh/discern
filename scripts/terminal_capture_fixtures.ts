/** Regenerate the reviewed flagship terminal captures deliberately. */

import { ensureDir } from "@std/fs";
import { fromFileUrl, join } from "@std/path";
import {
  captureFlagshipTerminalScreens,
  FLAGSHIP_CAPTURE_DIRECTORY,
  FLAGSHIP_COMMANDS,
} from "../tests/fixtures/flagship_terminal_captures.ts";
import {
  compileDiscernCaptureBinary,
  renderTerminalCaptureHtml,
  serializeTerminalCapture,
} from "../tests/fixtures/terminal_command_capture.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Compile once, then refresh both machine-readable and visual evidence. */
async function main(): Promise<void> {
  const temp = await Deno.makeTempDir({
    dir: "/tmp",
    prefix: "discern-terminal-binary-",
  });
  const executable = join(
    temp,
    Deno.build.os === "windows" ? "discern.exe" : "discern",
  );
  try {
    await compileDiscernCaptureBinary(REPO_ROOT, executable);
    const captures = await captureFlagshipTerminalScreens(executable);
    await ensureDir(FLAGSHIP_CAPTURE_DIRECTORY);
    for (const command of FLAGSHIP_COMMANDS) {
      const capture = captures[command.name];
      if (capture === undefined) {
        throw new Error(`missing generated capture: ${command.name}`);
      }
      await Deno.writeTextFile(
        join(FLAGSHIP_CAPTURE_DIRECTORY, `${command.name}.json`),
        serializeTerminalCapture(capture),
      );
      await Deno.writeTextFile(
        join(FLAGSHIP_CAPTURE_DIRECTORY, `${command.name}.html`),
        renderTerminalCaptureHtml(capture),
      );
    }
    console.log(FLAGSHIP_CAPTURE_DIRECTORY);
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => undefined);
  }
}

if (import.meta.main) await main();
