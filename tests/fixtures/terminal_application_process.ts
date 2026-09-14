/** Native-read and foreground canary using discern's actual interaction boundary. */
import { DenoTerminalIO } from "discern-design-system/cli/interactive";
import {
  productionTerminalContext,
  setTerminalContext,
  terminalProcessContext,
} from "../../src/lib/terminal.ts";
import {
  runTerminalApplication,
  withInteractionBoundary,
} from "../../src/lib/terminal_interaction.ts";
import { consumerApplication } from "./terminal_application.ts";

let cancellations = 0;
class NativeReadProbe extends DenoTerminalIO {
  override cancelRead(): boolean {
    const cancelled = super.cancelRead();
    if (cancelled) cancellations++;
    return cancelled;
  }
}
const native = new NativeReadProbe({
  readBufferSize: 1,
  environment: terminalProcessContext().environment,
});
setTerminalContext(
  await productionTerminalContext({
    theme: "dark",
    backgroundIo: withInteractionBoundary(native),
  }),
);

async function foreground(): Promise<void> {
  const result = await new Deno.Command("sh", {
    args: [
      "-c",
      "printf 'CHILD_READY\\n'; read answer; test \"$answer\" = hello || exit 3; printf 'CHILD_RECEIVED_HELLO\\n'",
    ],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error("child input was lost");
}
const options = consumerApplication(foreground);
await runTerminalApplication(options);
if (Deno.args.includes("--pending-read")) {
  if (cancellations < 1) {
    throw new Error("no pending native read was cancelled");
  }
  await foreground();
  await runTerminalApplication(options);
}
console.log(`APPLICATION_RETURNED cancellations=${cancellations}`);
