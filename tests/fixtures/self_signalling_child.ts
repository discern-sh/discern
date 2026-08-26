/** Child process that signals its parent, then stays alive for forwarding tests. */

import { realDelay } from "../waiting.ts";

const mode = Deno.args[0];
const parentPid = Number(Deno.args[1]);
const signal = Deno.args[2] as Deno.Signal | undefined;
const pidFile = Deno.args[3];
const ignoreSignal = Deno.args[4] === "ignore";
if (
  (mode !== "owned" && mode !== "desk") ||
  !Number.isSafeInteger(parentPid) ||
  parentPid <= 0 ||
  (signal !== "SIGINT" && signal !== "SIGTERM" && signal !== "SIGHUP")
) {
  throw new Error("self-signalling child requires mode, parent PID, and signal");
}
if (pidFile !== undefined && pidFile !== "-") {
  await Deno.writeTextFile(pidFile, String(Deno.pid));
}
if (ignoreSignal) Deno.addSignalListener(signal, () => {});

if (mode === "owned") {
  await realDelay("self-signal-owned-trigger", 100);
  Deno.kill(parentPid, signal);
  await realDelay("self-signal-owned-lifetime", 30_000);
} else {
  await realDelay("self-signal-desk-trigger", 150);
  Deno.kill(parentPid, signal);
  await realDelay("self-signal-desk-lifetime", 30_000);
}
