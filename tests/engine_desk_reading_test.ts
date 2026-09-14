/** Product reading and consent routes keep input, focus, and long evidence local. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  captureTerminalFrame,
  encodeTerminalKeys,
  FakeTerminalIO,
} from "discern-design-system/cli/interactive/testing";
import { assertTerminalTextIncludes } from "./helpers.ts";
import { readDeskScreen } from "../src/engine/desk/reading.ts";

Deno.test("Desk consent defaults to cancel and keeps long evidence inside every viewport", async () => {
  for (
    const geometry of [
      { columns: 80, rows: 24 },
      { columns: 132, rows: 40 },
      { columns: 80, rows: 48 },
      { columns: 40, rows: 24 },
      { columns: 80, rows: 16 },
    ]
  ) {
    for (const unicode of [true, false]) {
      const io = new FakeTerminalIO([encodeTerminalKeys("tab", "enter")], {
        ...geometry,
        unicode,
      });
      assertEquals(
        await readDeskScreen({
          title: "Review the selected task",
          source: Array.from(
            { length: 100 },
            (_, i) =>
              `Paragraph ${i}: café 東京 — long task evidence remains readable.`,
          )
            .join("\n\n"),
          confirmation: {
            question: "Queue this revision?",
            options: {
              defaultTo: false,
              noLabel: "Cancel",
              yesLabel: "Join the landing queue",
            },
          },
        }, {
          io,
          interactive: () => true,
        }),
        "back",
      );
      const frame = captureTerminalFrame(io.output(), geometry).frame;
      assertTerminalTextIncludes(
        io.output(),
        "Paragraph 0:",
        "the plan is visible before the choice",
      );
      assertStringIncludes(frame, "Cancel");
      assertStringIncludes(frame, "Join the landing queue");
      assertStringIncludes(frame, "Esc back");
      assertEquals(io.rawTransitions, [true, false]);
      assertEquals(io.resizeListenerCount, 0);
    }
  }
});

Deno.test("Desk reading scroll and consent focus survive a resize without activating an effect", async () => {
  let resizedReading = "";
  const io = new FakeTerminalIO([
    encodeTerminalKeys("tab", "down", "tab", "page-down"),
  ], { columns: 80, rows: 24 });
  io.enqueueResize(40, 24);
  io.enqueueKeys("tab", "up", "enter");
  assertEquals(
    await readDeskScreen({
      title: "Drop review",
      source: Array.from({ length: 60 }, (_, i) => `Review line ${i}.`).join(
        "\n\n",
      ),
      confirmation: {
        question: "Drop the reviewed task?",
        options: { defaultTo: false, noLabel: "Cancel", yesLabel: "Drop" },
      },
    }, {
      io,
      interactive: () => true,
      observe: (event) => {
        if (event.size.columns === 40) {
          const frame = captureTerminalFrame(io.output(), io.size()).frame;
          if (frame.includes("Review line")) resizedReading = frame;
        }
      },
    }),
    "back",
  );
  assertStringIncludes(resizedReading, "Review line");
  const frame = captureTerminalFrame(io.output(), io.size()).frame;
  assertStringIncludes(frame, "Cancel");
  assertEquals(
    resizedReading.includes("Review line 0."),
    false,
    "reading position survives resize",
  );
  assertEquals(io.rawTransitions, [true, false]);
});

Deno.test("Desk reading keeps opaque action values separate from package widget identities", async () => {
  for (const value of ["\x00back", "\x00diff", "task/path with spaces"]) {
    const io = new FakeTerminalIO([encodeTerminalKeys("tab", "enter")], {
      columns: 80,
      rows: 24,
    });
    assertEquals(
      await readDeskScreen({
        title: "Review",
        source: "Read the selected evidence.",
        actions: [{ id: value, label: "Open evidence" }],
      }, { io, interactive: () => true }),
      value,
    );
  }
});
