/**
 * Drive the desk's real interactive-child boundary
 * through an interrupt delivered to this process's PID.
 *
 * The desk launches agents and scripts with `resumeAfterInterrupt`, so its
 * contract inverts the CLI verbs': the interrupted child's whole tree must
 * stop and be reaped, while the desk session itself SURVIVES to render the
 * next menu. The spawned child records its own PID and self-signals this
 * driver, and the driver then reports whether it resumed and whether the
 * child died — the suite asserts on that JSON.
 *
 * argv: `<signal> <child-pid-file>`.
 */

import { runDeskInteractiveChild } from "../../src/engine/desk/desk.ts";
import { waitUntil } from "../waiting.ts";
import { readPidIfReady } from "../process_id.ts";

function signalArg(value: string | undefined): Deno.Signal {
  switch (value) {
    case "SIGINT":
    case "SIGTERM":
    case "SIGHUP":
      return value;
    default:
      throw new Error(`unsupported fixture signal: ${value}`);
  }
}

const signal = signalArg(Deno.args[0]);
const pidFile = Deno.args[1];
if (pidFile === undefined) {
  throw new Error("usage: desk_interactive_driver <signal> <child-pid-file>");
}

const child = new URL("self_signalling_child.ts", import.meta.url).pathname;

const code = await runDeskInteractiveChild(
  Deno.execPath(),
  ["run", "-A", child, "desk", String(Deno.pid), signal, pidFile],
  Deno.cwd(),
  {},
);

// Reaching here at all is the resume half of the contract. The other half:
// the interrupted child must be gone.
const childPid = await readPidIfReady(pidFile);
if (childPid === undefined) throw new Error("the Desk child did not publish its PID");
let childAlive = true;
await waitUntil(() => {
  if (!childAlive) return true;
  try {
    Deno.kill(childPid, "SIGCONT");
    return false;
  } catch {
    childAlive = false;
    return true;
  }
}, "the interrupted Desk child to exit", {
  timeoutMs: 5_000,
  intervalMs: 50,
});

console.log(JSON.stringify({ resumed: true, code, childAlive }));
