/** POSIX process-group ownership shared by command runners. */

/** Grace for descendants left behind after their direct command exited. */
export const OWNED_DESCENDANT_GRACE_MS = 100;

/** Signal only the process group led by `pid`; false means it is already gone. */
export function signalProcessGroup(
  pid: number,
  signal: Deno.Signal,
): boolean {
  try {
    Deno.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop descendants left in a detached command's group after its leader settles.
 * A clean leader exit is not evidence that a backgrounded hook or shell child
 * stopped writing. Give cooperative cleanup one bounded grace, then sweep the
 * exact group the caller created.
 */
export async function quiesceProcessGroup(pid: number): Promise<void> {
  if (Deno.build.os === "windows") return;
  if (!signalProcessGroup(pid, "SIGTERM")) return;
  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, OWNED_DESCENDANT_GRACE_MS)
  );
  signalProcessGroup(pid, "SIGKILL");
}
