/** Create a suite-owned temp directory and optionally survive until killed. */

import { suiteTempDir } from "../temp_dir.ts";
import { realDelay } from "../waiting.ts";

const dir = await suiteTempDir();
await Deno.stdout.write(new TextEncoder().encode(`${dir}\n`));
if (Deno.args[0] === "keep-alive") {
  await realDelay("suite-temp-child-lifetime", 60_000);
}
