/**
 * Drive the desk's REAL launch wiring — `DEFAULT_DESK_RUNTIME.interactive` —
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

import { DEFAULT_DESK_RUNTIME } from "../../src/engine/desk/desk.ts";

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

const childSource = [
  `await Deno.writeTextFile(${JSON.stringify(pidFile)}, String(Deno.pid));`,
  `setTimeout(() => Deno.kill(${Deno.pid}, ${JSON.stringify(signal)}), 150);`,
  "await new Promise((resolve) => setTimeout(resolve, 30_000));",
].join("\n");

const code = await DEFAULT_DESK_RUNTIME.interactive(
  Deno.execPath(),
  ["eval", childSource],
  Deno.cwd(),
  {},
);

// Reaching here at all is the resume half of the contract. The other half:
// the interrupted child must be gone.
const childPid = Number((await Deno.readTextFile(pidFile)).trim());
let childAlive = Number.isFinite(childPid) && childPid > 0;
const deadline = Date.now() + 5_000;
while (childAlive && Date.now() < deadline) {
  try {
    Deno.kill(childPid, "SIGCONT");
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch {
    childAlive = false;
  }
}

console.log(JSON.stringify({ resumed: true, code, childAlive }));
