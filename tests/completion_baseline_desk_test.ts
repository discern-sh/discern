/** Main-checkout recovery actions keep failures visible and return control. */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { DeskRuntime } from "../src/engine/desk/desk.ts";
import {
  actOnMainCheckout,
  showRecentCompleted,
} from "../src/engine/desk/main_checkout.ts";
import { DESK_ROUTES } from "../src/engine/desk/view.ts";
import { makeOut } from "../src/engine/output.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";
import { InteractionCancelled } from "../src/lib/terminal_interaction.ts";

/** Fail if a main-checkout action reaches an unrelated effect. */
function unrelated(): never {
  throw new Error("unexpected task effect from main checkout");
}

/** Enumerate the runtime port so new effects require an explicit fixture decision. */
function mainRuntime(patch: Partial<DeskRuntime>): DeskRuntime {
  return {
    canInteract: unrelated,
    inDeskSession: unrelated,
    findRoot: unrelated,
    loadConfig: unrelated,
    status: unrelated,
    mainRepoPath: unrelated,
    grantEffortPlan: unrelated,
    grantEffort: unrelated,
    clearEffortGrantPlan: unrelated,
    clearEffortGrant: unrelated,
    makeOut: unrelated,
    error: unrelated,
    select: unrelated,
    confirm: unrelated,
    input: unrelated,
    sequence: unrelated,
    pause: unrelated,
    lifecycle: unrelated,
    done: unrelated,
    donePlan: unrelated,
    acceptPlan: unrelated,
    accept: unrelated,
    update: unrelated,
    updatePlan: unrelated,
    setup: unrelated,
    setupPlan: unrelated,
    drop: unrelated,
    dropPlan: unrelated,
    park: unrelated,
    parkPlan: unrelated,
    reclaim: unrelated,
    reclaimPlan: unrelated,
    git: unrelated,
    proof: unrelated,
    pager: unrelated,
    editor: unrelated,
    openEditor: unrelated,
    interactive: unrelated,
    detectAgents: unrelated,
    startPlan: unrelated,
    start: unrelated,
    renamePlan: unrelated,
    rename: unrelated,
    scripts: unrelated,
    runScript: unrelated,
    openBrowser: unrelated,
    now: unrelated,
    readTipState: unrelated,
    writeTipState: unrelated,
    readPreferences: unrelated,
    writePreferences: unrelated,
    recordTipShown: unrelated,
    size: () => ({ columns: 100, rows: 40 }),
    ...patch,
  };
}

const MAIN: StatusData = {
  location: "main",
  root: "/project",
  project: "demo",
  worktree: null,
  git: null,
  standards: [],
  fleet: [],
};

Deno.test("main-checkout actions diagnose Git, pager, shell, and editor failures without leaving the desk", async () => {
  const actions = [
    "inspect",
    "inspect",
    "inspect",
    "shell",
    "editor",
    "editor",
    "editor",
    DESK_ROUTES.back,
  ];
  const messages: string[] = [];
  const pages: string[] = [];
  let pauses = 0;
  let inspections = 0;
  let editors = 0;
  const out = makeOut(false, {
    stdout: (s) => messages.push(s),
    stderr: (s) => messages.push(s),
  });
  const runtime = mainRuntime({
    select: () => actions.shift() ?? unrelated(),
    pause: () => {
      pauses++;
    },
    git: (args, root) => {
      assertEquals(root, "/project");
      if (args[0] === "status") inspections++;
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
      assertEquals(root, "/project");
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
      assertEquals(root, "/project");
      return 9;
    },
  });
  await actOnMainCheckout(out, "/project", MAIN, runtime);
  assertEquals(actions, []);
  assertEquals(pauses, 7);
  for (
    const text of [
      "broken index",
      "Git returned no diagnostic",
      "pager could not open",
      "Shell exited with status 7",
      "No editor is available",
      "Choose an editor",
      "Editor exited with status 9",
    ]
  ) {
    assertStringIncludes(messages.join("\n"), text);
  }
  assertStringIncludes(pages[0] ?? "", "No local changes.");
  assertStringIncludes(pages[0] ?? "", "No tracked diff.");
  await showRecentCompleted(out, MAIN, runtime);
  assertEquals(pauses, 8);
});

Deno.test("main-checkout selection handles cancellation but propagates other failures", async () => {
  const out = makeOut(false, { stdout: () => {}, stderr: () => {} });
  await actOnMainCheckout(
    out,
    "/project",
    MAIN,
    mainRuntime({
      select: () => {
        throw new InteractionCancelled();
      },
    }),
  );
  await assertRejects(
    () =>
      actOnMainCheckout(
        out,
        "/project",
        MAIN,
        mainRuntime({
          select: () => {
            throw new Error("selection failed");
          },
        }),
      ),
    Error,
    "selection failed",
  );
});
