import { runOwnedChild } from "../../src/engine/owned_child.ts";

function signalArg(value: string | undefined): Deno.Signal {
  switch (value) {
    case "SIGINT":
    case "SIGTERM":
      return value;
    default:
      throw new Error(`unsupported fixture signal: ${value}`);
  }
}

const signal = signalArg(Deno.args[0]);
const ignoreSignal = Deno.args[1] === "ignore";
const child = new URL("self_signalling_child.ts", import.meta.url).pathname;
const result = await runOwnedChild(Deno.execPath(), {
  args: [
    "run",
    "-A",
    child,
    "owned",
    String(Deno.pid),
    signal,
    "-",
    ...(ignoreSignal ? ["ignore"] : []),
  ],
  resumeAfterInterrupt: true,
});
console.log(JSON.stringify({
  interruptedBy: result.interruptedBy,
  code: result.status.code,
  signal: result.status.signal,
  success: result.status.success,
}));
