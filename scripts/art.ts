/** Thin task entrypoint for the internal terminal-art gallery. */

import { runArtCommand } from "../art/terminal/gallery.ts";

export * from "../art/terminal/gallery.ts";

if (import.meta.main) {
  Deno.exit(await runArtCommand());
}
