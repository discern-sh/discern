/** Repeatable visual evidence from executed release Desk journeys. */
import { resolve } from "@std/path";
import { captureTerminalFrame } from "discern-design-system/cli/interactive/testing";
import { withRealPtyBoundary } from "../tests/real_pty.ts";
import { releaseDeskJourney } from "../tests/fixtures/release_desk_journey.ts";

/** Capture each executed viewport and terminal-restoration result. */
async function main(): Promise<void> {
  const directory = resolve(Deno.args[0] ?? ".scratch/release-desk-review");
  await Deno.mkdir(directory, { recursive: true });
  const artifacts: string[] = [];
  await withRealPtyBoundary({
    name: "Release Desk visual review",
    contracts: [
      "line-discipline",
      "terminal-modes",
      "control-rendering",
      "process-lifecycle",
    ],
    canary: false,
  }, async () => {
    for (
      const variant of [
        { name: "wide", columns: 120, rows: 30, failure: false, resize: false },
        {
          name: "fallback",
          columns: 80,
          rows: 24,
          failure: true,
          resize: false,
        },
        {
          name: "minimum",
          columns: 32,
          rows: 10,
          failure: true,
          resize: false,
        },
        {
          name: "resize",
          columns: 100,
          rows: 28,
          failure: false,
          resize: true,
        },
      ]
    ) {
      const result = await releaseDeskJourney(
        variant,
        variant.failure,
        variant.resize,
      );
      for (const [name, raw] of Object.entries(result.keyframes)) {
        const geometry =
          variant.resize && ["resized", "returned", "refreshed"].includes(name)
            ? { columns: 40, rows: 20 }
            : variant;
        const frame = captureTerminalFrame(raw, geometry);
        const id = `${variant.name}-${name}`;
        await Deno.writeTextFile(
          `${directory}/${id}.html`,
          `<!doctype html><meta charset="utf-8"><title>${id}</title>${frame.html}`,
        );
        await Deno.writeTextFile(
          `${directory}/${id}.json`,
          JSON.stringify(
            {
              geometry,
              inspection: frame.geometry,
              terminal: result.terminal,
              text: frame.frame,
            },
            null,
            2,
          ) + "\n",
        );
        artifacts.push(`${id}.html`);
      }
      await Deno.writeTextFile(
        `${directory}/${variant.name}-transcript.txt`,
        result.transcript,
      );
      console.log(`Captured ${variant.name}`);
    }
  });
  await Deno.writeTextFile(
    `${directory}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>Release Desk review</title><h1>Release Desk review</h1><ul>${
      artifacts.map((path) => `<li><a href="${path}">${path}</a></li>`).join("")
    }</ul>`,
  );
  console.log(`${directory}/index.html`);
}
if (import.meta.main) await main();
