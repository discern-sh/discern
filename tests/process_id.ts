/** Read process identity only after a fixture has written a positive PID. */
import { readTextIfExists } from "../src/shared/fs_presence.ts";

/** An absent or incomplete PID file does not establish process readiness. */
export async function readPidIfReady(
  path: string,
): Promise<number | undefined> {
  const text = (await readTextIfExists(path))?.trim();
  if (text === undefined || !/^[1-9]\d*$/u.test(text)) return undefined;
  const pid = Number(text);
  return Number.isSafeInteger(pid) ? pid : undefined;
}

/** Return the whole observed process tree only when every PID is ready. */
export async function readPidsIfReady(
  paths: readonly string[],
): Promise<number[] | undefined> {
  const pids: number[] = [];
  for (const path of paths) {
    const pid = await readPidIfReady(path);
    if (pid === undefined) return undefined;
    pids.push(pid);
  }
  return pids;
}
