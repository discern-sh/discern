/** Acquire one advisory slot lock and retain it until the crash-safety test kills us. */

import { realDelay } from "../waiting.ts";

const [path, ready] = Deno.args;
if (path === undefined || ready === undefined) {
  throw new Error("slot lock holder fixture requires lock and readiness paths");
}
const file = await Deno.open(path, { read: true, write: true, create: true });
const locked = await file.tryLock(true);
await Deno.writeTextFile(ready, locked ? "locked" : "failed");
await realDelay("slot-lock-holder-lifetime", 1_000_000);
