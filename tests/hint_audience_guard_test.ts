/**
 * Audience guards for the hints channel.
 *
 * The class of defect: an interactive human renderer prints the raw `hints[]`
 * channel, so an agent-audience entry reaches a person it was never written
 * for. The registry owns the drop (`interactiveHintTexts` for wire arrays,
 * `interactiveHints` for fired pairs) — a renderer that loops the channel
 * directly bypasses it, and the bypass stays invisible until an agent-audience
 * entry happens to fire on that surface.
 *
 * The law: outside `src/shared/hints.ts` (which owns the channel), no `for…of`
 * iterates a `.hints` member. Renderers print a projection; builders compose
 * with `hintTexts`/`appendHintTexts`, which are not iteration. Reading a
 * single element (a failure headline) stays legal — the guard targets the
 * render-the-channel shape, the one way every historical bypass was written.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SRC = join(REPO_ROOT, "src");

/** The channel-owning module: the one legal home for raw hint iteration. */
const CHANNEL_OWNER = "src/shared/hints.ts";

/** A `for…of` over some object's `.hints` member, `?? []` fallbacks included. */
const RAW_HINT_LOOP = /for\s*\(\s*const\s+\w+\s+of\s+\(?\s*[\w.?]*\.hints\b/;

Deno.test("interactive renderers never iterate the raw hints channel", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    const rel = relative(REPO_ROOT, entry.path);
    if (rel === CHANNEL_OWNER) {
      continue;
    }
    const source = await Deno.readTextFile(entry.path);
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (RAW_HINT_LOOP.test(line)) {
        offenders.push(`${rel}:${index + 1} ${line.trim()}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "raw hints-channel iteration outside the registry — render " +
      "`interactiveHintTexts(result.hints)` (or `interactiveHints(fired)`) " +
      `so agent-audience entries stay wire-only:\n  ${offenders.join("\n  ")}`,
  );
});
