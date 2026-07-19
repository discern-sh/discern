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
const childSource = [
  ...(ignoreSignal
    ? [`Deno.addSignalListener("${signal}", () => {});`]
    : []),
  `setTimeout(() => Deno.kill(${Deno.pid}, "${signal}"), 100);`,
  "await new Promise((resolve) => setTimeout(resolve, 30_000));",
].join("\n");
const result = await runOwnedChild(Deno.execPath(), {
  args: ["eval", childSource],
  resumeAfterInterrupt: true,
});
console.log(JSON.stringify({
  interruptedBy: result.interruptedBy,
  code: result.status.code,
  signal: result.status.signal,
  success: result.status.success,
}));
