/** Consumer application policy and composition over the real package runtime. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  captureTerminalFrame,
  encodeTerminalKeys,
  FakeTerminalIO,
} from "discern-design-system/cli/interactive/testing";
import {
  InteractionCancelled as PackageCancelled,
  NonInteractiveTerminalError,
} from "discern-design-system/cli/interactive";
import {
  InteractionCancelled,
  requestSelection,
  runTerminalApplication,
  type SelectionRequestOptions,
  type SelectionsRequestOptions,
} from "../src/lib/terminal_interaction.ts";
import {
  applicationView,
  consumerApplication,
} from "./fixtures/terminal_application.ts";

Deno.test("application policy refuses before effects and preserves package capability refusal", async () => {
  const io = new FakeTerminalIO([], { interactive: false });
  await assertRejects(
    () =>
      runTerminalApplication(consumerApplication(async () => {}), {
        io,
        interactive: () => false,
      }),
    Error,
    "needs an interactive terminal",
  );
  assertEquals(io.writes, []);
  await assertRejects(
    () =>
      runTerminalApplication(consumerApplication(async () => {}), {
        io,
        interactive: () => true,
      }),
    NonInteractiveTerminalError,
  );
  assertEquals(io.rawTransitions, []);
});

Deno.test("application updates, availability and foreground return share the product boundary", async () => {
  const io = new FakeTerminalIO([
    encodeTerminalKeys("down", "enter", "up", "enter", "end", "enter"),
  ]);
  let children = 0;
  const state = await runTerminalApplication(
    consumerApplication(() => {
      assertEquals(io.rawTransitions.at(-1), false);
      children++;
      return Promise.resolve();
    }),
    { io, interactive: () => true },
  );
  assertEquals(children, 1);
  assertEquals(state.positions.actions?.selectedId, "quit");
  assert(typeof state.view.tip === "string");
  assertStringIncludes(state.view.tip, "Refresh complete");
  assertEquals(io.rawTransitions, [true, false, true, false]);
  assertEquals(io.resizeListenerCount, 0);
});

Deno.test("application cancellation normalizes after cleanup and unexpected errors retain identity", async () => {
  const fault = new Error("provider failed");
  for (const error of [new PackageCancelled("cancelled"), fault]) {
    const io = new FakeTerminalIO([], { holdOpen: true });
    const caught = await assertRejects(() =>
      runTerminalApplication({
        view: applicationView(false),
        start: (context) => context.fail(error),
      }, { io, interactive: () => true })
    );
    if (error === fault) assertEquals(caught, fault);
    else assert(caught instanceof InteractionCancelled);
    assertEquals(io.rawTransitions, [true, false]);
    assertEquals(io.resizeListenerCount, 0);
    io.close();
  }
});

Deno.test("application frames remain bounded through every required geometry", async () => {
  for (
    const size of [{ columns: 80, rows: 24 }, { columns: 120, rows: 30 }, {
      columns: 60,
      rows: 50,
    }, { columns: 24, rows: 8 }]
  ) {
    for (const unicode of [true, false]) {
      const io = new FakeTerminalIO([encodeTerminalKeys("escape")], {
        ...size,
        unicode,
      });
      await runTerminalApplication(consumerApplication(async () => {}), {
        io,
        interactive: () => true,
      });
      const captured = captureTerminalFrame(io.output(), size);
      assertStringIncludes(
        captured.frame,
        size.columns < 32 ? "Resize" : "Terminal foundation",
      );
      if (!unicode) {
        assertEquals(
          [...captured.frame].every((character) =>
            character.charCodeAt(0) < 128
          ),
          true,
        );
      }
    }
  }
});

Deno.test("single-choice menu presentation leaves multi-select contracts unchanged", async () => {
  const menu: SelectionRequestOptions<string>["presentation"] = "menu";
  type MultiAdmitsMenu = "menu" extends
    NonNullable<SelectionsRequestOptions<string>["presentation"]> ? true
    : false;
  const admitsMenu: MultiAdmitsMenu = false;
  assertEquals(admitsMenu, false);
  for (const search of [false, true]) {
    const io = new FakeTerminalIO([
      encodeTerminalKeys("enter", "down", "enter"),
    ]);
    assertEquals(
      await requestSelection({
        message: "Choose",
        presentation: menu,
        search,
        options: [{ name: "Unavailable", value: "no", disabled: true }, {
          name: "Available",
          value: "yes",
        }],
      }, { io, interactive: () => true }),
      "yes",
    );
  }
});

Deno.test("application forwards cooperative abort and preserves foreground failures", async () => {
  const abort = new AbortController();
  const io = new FakeTerminalIO([], { holdOpen: true });
  await assertRejects(
    () =>
      runTerminalApplication({
        view: applicationView(false),
        start: () => abort.abort(),
      }, { io, interactive: () => true, abortSignal: abort.signal }),
    InteractionCancelled,
  );
  assertEquals(io.rawTransitions, [true, false]);
  io.close();
  const fault = new Error("foreground failed");
  const childIo = new FakeTerminalIO([encodeTerminalKeys("enter")]);
  assertEquals(
    await assertRejects(() =>
      runTerminalApplication(consumerApplication(() => Promise.reject(fault)), {
        io: childIo,
        interactive: () => true,
      })
    ),
    fault,
  );
  assertEquals(childIo.rawTransitions, [true, false]);
});
