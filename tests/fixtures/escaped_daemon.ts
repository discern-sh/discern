/** Escaped daemon fixture: wait for its leader, mark readiness, then hold pipes. */

import { realDelay, waitUntil } from "../waiting.ts";

const parent = Number(Deno.args[0]);
const holdMs = Number(Deno.args[1]);
const marker = Deno.args[2];
if (!Number.isSafeInteger(parent) || parent <= 0 || !Number.isFinite(holdMs)) {
  throw new Error("escaped daemon fixture requires parent PID and hold milliseconds");
}

await waitUntil(() => {
  try {
    Deno.kill(parent, "SIGCONT");
    return false;
  } catch {
    return true;
  }
}, "the escaped daemon's leader to exit");
if (marker !== undefined) await Deno.writeTextFile(marker, "up");
await realDelay("escaped-daemon-hold", holdMs);
