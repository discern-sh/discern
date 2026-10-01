/** Main-checkout children keep failures visible and return control. */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { runChild } from "../src/engine/desk/flows/children.ts";
import type { DeskFlowContext } from "../src/engine/desk/flows/context.ts";
import { initialDeskProduct } from "../src/engine/desk/desk_state.ts";
import { failedOutcome } from "../src/engine/desk/live.ts";
import { makeOut } from "../src/engine/output.ts";
import { InteractionCancelled } from "../src/lib/terminal_interaction.ts";
import {
  DESK_CONFIG,
  DESK_ROOT,
  deskTranscript,
  scriptedDeskRuntime,
} from "./fixtures/desk_session.ts";
import type { DeskRuntime } from "../src/engine/desk/desk.ts";

/** A flow context over the main checkout with `patch` as its runtime. */
function mainContext(patch: Partial<DeskRuntime>): DeskFlowContext {
  return {
    root: DESK_ROOT,
    config: DESK_CONFIG,
    runtime: scriptedDeskRuntime(deskTranscript(), patch),
    state: initialDeskProduct({
      trunk: "main",
      preferences: { schema_version: 2 },
    }),
  };
}

Deno.test("main-checkout children diagnose Git, pager, shell, and editor failures and return", async () => {
  const messages: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => messages.push(text),
    stderr: (text) => messages.push(text),
  });
  let pauses = 0;
  let inspections = 0;
  let editors = 0;
  const pages: string[] = [];
  const context = mainContext({
    pause: () => {
      pauses += 1;
    },
    git: (args, root) => {
      assertEquals(root, DESK_ROOT);
      if (args[0] === "status") inspections += 1;
      const failed = inspections === 1
        ? args[0] === "status"
        : inspections === 2 && args[0] === "diff";
      return {
        success: !failed,
        stdout: "",
        stderr: inspections === 1 ? "broken index" : "",
      };
    },
    pager: (page) => {
      pages.push(page);
      return { shown: false };
    },
    interactive: (_command, args, root, env) => {
      assertEquals(args, []);
      assertEquals(root, DESK_ROOT);
      assertStringIncludes(JSON.stringify(env), "DESK");
      return 7;
    },
    editor: () =>
      ++editors === 1
        ? {}
        : editors === 2
        ? { reason: "Choose an editor" }
        : { editor: { command: "editor", program: "editor", args: [] } },
    openEditor: (editor, root) => {
      assertEquals(editor.command, "editor");
      assertEquals(root, DESK_ROOT);
      return 9;
    },
  });
  const outcomes = [];
  for (
    const child of [
      { kind: "diff" },
      { kind: "diff" },
      { kind: "diff" },
      { kind: "shell" },
      { kind: "editor" },
      { kind: "editor" },
      { kind: "editor" },
    ] as const
  ) {
    outcomes.push(await runChild(context, out, child));
  }
  const said = [
    ...outcomes.map((outcome) => outcome.message?.text ?? ""),
    ...messages,
  ].join("\n");
  for (
    const text of [
      "broken index",
      "Git returned no diagnostic",
      "pager could not open",
      "The shell exited with status 7",
      "No editor is available",
      "Choose an editor",
      "The editor exited with status 9",
    ]
  ) {
    assertStringIncludes(said, text);
  }
  assertEquals(pages, ["No local changes.\n\nNo tracked diff."]);
  assertEquals(pauses, 2, "only children that failed wait to be read");
  assertEquals(
    outcomes.map((outcome) => outcome.ok),
    [false, false, false, false, false, false, false],
  );
});

Deno.test("an effect that is cancelled, refused, or fails at length says so in one line", () => {
  assertEquals(failedOutcome(new InteractionCancelled(), "discern done"), {
    command: "discern done",
    ok: false,
    message: { tone: "muted", text: "Cancelled; nothing more ran" },
  });
  assertEquals(failedOutcome(new Error("locked"), "discern park").message, {
    tone: "danger",
    text: "locked",
  });
  const long = failedOutcome(new Error("first\nsecond"), "discern drop");
  assertEquals(long.message?.text, "It didn't complete");
  assertEquals(long.result?.markdown, "first\nsecond");
});
