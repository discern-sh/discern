/**
 * A live Desk over the real package runtime, for behavioral tests.
 *
 * `deskSession` runs `runDesk` with a scripted runtime on a held-open fake
 * terminal and a manual clock: keys go through the package's real decoder,
 * the product's timers and the package's share one clock that only the test
 * advances, and every effect lands on runtime seams the test records. Nothing
 * here waits on real time or touches a real worktree.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_APPLICATION_SETTLE_MS,
  TERMINAL_LONE_ESCAPE_DELAY_MS,
  type TerminalApplicationContext,
  type TerminalApplicationState,
  type TerminalKeyName,
} from "discern-design-system/cli/interactive";
import {
  captureTerminalFrame,
  FakeTerminalIO,
  ManualTerminalClock,
  TERMINAL_KEY_SEQUENCES,
} from "discern-design-system/cli/interactive/testing";
import { runTerminalApplication } from "../../src/lib/terminal_interaction.ts";
import type { TerminalColorDepth } from "discern-design-system/cli";
import {
  type DeskRuntime,
  type DeskTermination,
  runDesk,
} from "../../src/engine/desk/desk.ts";
import { statusResult } from "../../src/engine/status/status.ts";
import type { CliModelProvider } from "../../src/shared/cli_reference_codegen.ts";
import {
  DESK_FORM_PREVIEW_MS,
  DESK_LIST_ID,
} from "../../src/engine/desk/desk_state.ts";
import { DESK_SELECTION_SETTLE_MS } from "../../src/engine/desk/live.ts";
import type { Scheduler, TimeoutHandle } from "../../src/shared/scheduler.ts";
import { makeOut, type Out } from "../../src/engine/output.ts";
import type { TerminalContext } from "../../src/lib/terminal.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../../src/shared/config_schema.ts";
import type {
  AcceptPreviewData,
  StartData,
  StatusData,
  StatusFleetEntry,
} from "../../src/shared/result_schemas.ts";
import { Logger } from "../../src/lib/log.ts";
import type { EnginePlan } from "../../src/shared/result.ts";
import type {
  LifecycleContext,
  PreparedStart,
} from "../../src/engine/worktree/lifecycle.ts";
import { freshTipSeenState } from "../../src/engine/desk/tips.ts";
import { DISCERN_VERSION } from "../../src/lib/version.ts";
import type { DocsBrowserRequest } from "../../src/commands/docs.ts";
import { resolveDocsBrowserLink } from "../../src/commands/docs_links.ts";
import { fixtureEffortGrant } from "../effort_grant_fixtures.ts";
import {
  mainFleetEntry,
  observedFleetEntry,
  statusData,
} from "../status_fleet.ts";
import {
  processAllowance,
  settlePending,
  waitForPendingCondition,
} from "../waiting.ts";

/** The main checkout every scripted Desk runs from. */
export const DESK_ROOT = "/project";

/** The wall time the manual clock starts at. */
export const DESK_NOW = Date.parse("2026-07-11T12:00:00Z");

/** The configuration every scripted Desk loads. */
export const DESK_CONFIG: DiscernConfig = configSchema.parse({
  project: { slug: "demo" },
  repository: { trunk: "main" },
});

/** The lifecycle context scripted effects receive. */
export const DESK_CONTEXT: LifecycleContext = {
  root: DESK_ROOT,
  cwd: DESK_ROOT,
  config: DESK_CONFIG,
  log: new Logger({ json: true, noColor: true }),
};

/** Narration the Desk printed, in order, by stream. */
export interface DeskTranscript {
  readonly out: Out;
  readonly stdout: string[];
  readonly stderr: string[];
}

/** Capture desk narration in ordered stdout and stderr arrays. */
export function deskTranscript(
  terminal: TerminalContext = makeOut(false).terminal,
): DeskTranscript {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: {
      color: terminal.color,
      terminal,
      info: (message) => stdout.push(`info:${message}`),
      ok: (message) => stdout.push(`ok:${message}`),
      warn: (message) => stderr.push(`warn:${message}`),
      error: (message) => stderr.push(`error:${message}`),
      errorBlock: (message) => stderr.push(`error:${message}`),
      heading: (message) => stdout.push(`heading:${message}`),
      group: () => stdout.push(""),
      raw: (message) => stdout.push(message),
    },
  };
}

/** Both narration streams, joined for order-insensitive assertions. */
export function joinedTranscript(output: DeskTranscript): string {
  return [...output.stdout, ...output.stderr].join("\n");
}

/** A fully observed task row at `path`, active an hour before the clock. */
export function deskTaskEntry(
  branch: string,
  path: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return observedFleetEntry({
    branch,
    path,
    last_activity: "2026-07-11T11:00:00Z",
    ...patch,
  });
}

const START_COMMIT = "a".repeat(40);

/** One retained start preview for the scripted Desk boundary. */
export function preparedStart(
  title = "New task",
  patch: Partial<PreparedStart["plan"]> = {},
): PreparedStart {
  const plan = {
    id: "new-task",
    branch: "agent/new-task",
    worktreePath: "/worktrees/new-task",
    from: "main",
    fromCommit: START_COMMIT,
    trunk: "main",
    title,
    resources: [],
    ...patch,
  };
  return {
    plan,
    taskMetadata: {
      schema_version: 1,
      title: plan.title,
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      created_from: { ref: plan.from, commit: plan.fromCommit },
    },
    reproduceCmd: "discern start",
  };
}

/** Project a scripted retained start into the public start payload. */
export function startedTask(prepared: PreparedStart): StartData {
  const { plan } = prepared;
  return {
    id: plan.id,
    branch: plan.branch,
    path: plan.worktreePath,
    from: plan.from,
    task: {
      id: plan.id,
      branch: plan.branch,
      title: plan.title,
      title_source: "recorded",
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      created_from: { ref: plan.from, commit: plan.fromCommit },
    },
    ...(plan.note === undefined ? {} : { name_note: plan.note }),
  };
}

/**
 * A two-document manual the scripted Desk reads: a home page that links to
 * a guide and to a page on the web, and the guide.
 */
export const DESK_MANUAL_FIXTURE: DocsBrowserRequest = {
  message: "Manual fixture",
  entries: [
    { kind: "group-heading", id: "pages", name: "Pages" },
    {
      kind: "document",
      id: "home",
      name: "Manual home",
      path: "README.md",
      source:
        "# Manual home\n\nRead the [guide](guide.md) or [the website](https://example.com/docs).\n",
    },
    {
      kind: "document",
      id: "guide",
      name: "Guide",
      path: "guide.md",
      source: "# Guide\n\nGuide body text.\n",
    },
    { kind: "group-heading", id: "actions", name: "Actions" },
    {
      kind: "action",
      id: "online",
      name: "Read the docs online",
      value: { kind: "read-online" },
    },
    { kind: "exit", id: "back", name: "Back to the desk" },
  ],
  resolveLink: resolveDocsBrowserLink,
};

/** A runtime whose every seam is scripted; `patch` overrides any of them. */
export function scriptedDeskRuntime(
  output: DeskTranscript,
  patch: Partial<DeskRuntime> = {},
): DeskRuntime {
  const data = statusData([mainFleetEntry(DESK_ROOT)]);
  return {
    manual: () => DESK_MANUAL_FIXTURE,
    canInteract: () => true,
    inDeskSession: () => false,
    findRoot: () => DESK_ROOT,
    loadConfig: () => DESK_CONFIG,
    status: () => ({ ok: true, data }),
    mainRepoPath: () => DESK_ROOT,
    grantEffortPlan: () => ({
      title: "Landing pre-authorization plan",
      details: [],
      steps: [],
    }),
    grantEffort: (_path, branch) => ({
      status: "granted",
      grant: fixtureEffortGrant(branch),
    }),
    clearEffortGrantPlan: () => ({
      title: "Landing pre-authorization revocation plan",
      details: [],
      steps: [],
    }),
    clearEffortGrant: () => true,
    makeOut: () => output.out,
    error: (message) => output.stderr.push(`console:${message}`),
    application: () => {
      throw new Error("A scripted Desk runs inside deskSession.");
    },
    terminations: () => scriptedTermination(),
    raise: () => {},
    pause: () => {},
    lifecycle: () => DESK_CONTEXT,
    done: () => ({ ok: true, verb: "done" }),
    donePlan: () => ({ ok: true, verb: "done" }),
    acceptPlan: () => ({ ok: true, verb: "accept" }),
    accept: () => {},
    submit: (path, options) => ({
      ok: true,
      verb: "accept",
      data: {
        revision: {
          path,
          branch: "agent/test",
          head: "a".repeat(40),
          proof: { candidate_id: "candidate", proof_id: "proof" },
        },
        submission: {
          state: options.dryRun ? "planned" : "queued",
          authority: { kind: "authorized", source: "effort-grant" },
        },
      },
    }),
    update: () => {},
    updatePlan: () => ({ ok: true, verb: "update" }),
    setup: () => {},
    setupPlan: () => ({ title: "Setup plan", details: [], steps: [] }),
    drop: () => {},
    dropPlan: () => ({ title: "Drop plan", details: [], steps: [] }),
    park: () => {},
    parkPlan: () => ({ title: "Park plan", details: [], steps: [] }),
    reclaim: () => {},
    reclaimPlan: () => ({ title: "Reclaim plan", details: [], steps: [] }),
    git: () => ({ success: true, stdout: "", stderr: "" }),
    proof: () => ({ status: "missing" }),
    landedProof: () => ({ status: "missing" }),
    operationRecord: () => undefined,
    pager: () => ({ shown: true }),
    editor: () => ({ reason: "No editor configured." }),
    openEditor: () => 0,
    interactive: () => 0,
    detectAgents: () => [],
    startPlan: (_ctx, opts) =>
      preparedStart(opts.title ?? "Random codename", {
        ...(opts.brief === undefined ? {} : { brief: opts.brief }),
        ...(opts.from === undefined ? {} : { from: opts.from }),
      }),
    start: (_ctx, prepared) => startedTask(prepared),
    renamePlan: (_ctx, title) => ({
      ok: true,
      verb: "worktree rename",
      dry_run: true,
      plan: { title: `Change title to ${title}`, details: [], steps: [] },
    }),
    rename: (_ctx, title) => ({
      ok: true,
      verb: "worktree rename",
      message: `Changed the task title to ${JSON.stringify(title)}.`,
    }),
    scripts: () => [],
    runScript: () => 0,
    openBrowser: (url) => ({
      status: "opened",
      launch: { command: "open", args: [url] },
    }),
    fileDigest: (path) => `digest:${path}`,
    now: () => DESK_NOW,
    scheduler: {
      scheduleTimeout: () => {
        throw new Error("A scripted Desk schedules on its session clock.");
      },
      cancelTimeout: () => {},
      scheduleInterval: () => {
        throw new Error("The Desk schedules no intervals.");
      },
      cancelInterval: () => {},
    },
    readTipState: () => freshTipSeenState(DISCERN_VERSION),
    writeTipState: () => {},
    readPreferences: () => ({ schema_version: 2 }),
    writePreferences: () => ({ status: "saved" }),
    recordTipShown: () => {},
    ...patch,
  };
}

/** A termination nothing signals unless a test ends the session itself. */
export function scriptedTermination(): DeskTermination & {
  readonly end: (signal: Deno.Signal) => void;
} {
  const controller = new AbortController();
  let received: Deno.Signal | undefined;
  const end = (signal: Deno.Signal): void => {
    received ??= signal;
    controller.abort();
  };
  return {
    signal: controller.signal,
    interrupt: () => end("SIGINT"),
    release: () => received,
    end,
  };
}

/** A scheduler whose timers fire only when the manual clock advances. */
export function clockScheduler(clock: ManualTerminalClock): Scheduler {
  const timers = new Map<TimeoutHandle, () => void>();
  let next = 0;
  return {
    scheduleTimeout: (callback, delayMs) => {
      const handle = ++next;
      timers.set(
        handle,
        clock.delay(() => {
          timers.delete(handle);
          callback();
        }, delayMs),
      );
      return handle;
    },
    cancelTimeout: (handle) => {
      timers.get(handle)?.();
      timers.delete(handle);
    },
    scheduleInterval: () => {
      throw new Error("The Desk schedules no intervals.");
    },
    cancelInterval: () => {},
  };
}

/**
 * A held-open fake terminal that knows when the Desk has consumed every key
 * and is waiting for the next one: that is when a key's synchronous effects
 * (its callbacks and the view they returned) have all applied.
 */
export class DeskTerminal extends FakeTerminalIO {
  readonly #chunks: Uint8Array[] = [];
  #waiter: ((chunk: Uint8Array | null) => void) | undefined;
  #closed = false;

  /** Whether the Desk is blocked on input with nothing left to read. */
  idle(): boolean {
    return this.#waiter !== undefined && this.#chunks.length === 0;
  }

  override read(): Promise<Uint8Array | null> {
    const next = this.#chunks.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (this.#closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#waiter = (chunk) => {
        this.#waiter = undefined;
        resolve(chunk);
      };
    });
  }

  override enqueue(value: string | Uint8Array): void {
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value)
      : value.slice();
    if (this.#waiter !== undefined) this.#waiter(bytes);
    else this.#chunks.push(bytes);
  }

  override close(): void {
    this.#closed = true;
    this.#waiter?.(null);
  }
}

/** Options for one scripted Desk session. */
export interface DeskSessionOptions {
  readonly columns?: number;
  readonly rows?: number;
  readonly unicode?: boolean;
  /** The terminal's colours; the fake terminal's own default otherwise. */
  readonly colorDepth?: TerminalColorDepth;
  /** Runtime seams; the rest come from {@linkcode scriptedDeskRuntime}. */
  readonly runtime?: Partial<DeskRuntime>;
  readonly output?: DeskTranscript;
  /** Leave the first survey unanswered; the session starts painting only. */
  readonly loading?: boolean;
  /** The live command tree final checks and landing need. */
  readonly cliModel?: CliModelProvider;
  /**
   * Run production effects against a real project: only the terminal, the
   * timers, and `runtime`'s seams are replaced. The clock stays real time.
   */
  readonly production?: boolean;
}

/** A running Desk and the instruments around it. */
export interface DeskSession {
  readonly io: DeskTerminal;
  readonly clock: ManualTerminalClock;
  readonly output: DeskTranscript;
  /** The package's read-only state. */
  state(): TerminalApplicationState;
  /** The visible screen, as plain text. */
  screen(): string;
  /** Named keys or literal text, one input each, each read before the next. */
  press(...inputs: readonly (TerminalKeyName | string)[]): Promise<void>;
  /** Type text as one input, as a paste would arrive. */
  type(text: string): Promise<void>;
  /** Move the top menu's highlight to an item and run it. */
  choose(itemId: string): Promise<void>;
  /** Search the palette and run the item the query highlights. */
  palette(query: string, itemId: string): Promise<void>;
  /** Escape, which lands once its continuation window passes on the
   * session clock: advance past it and wait for its effect. */
  escape(effect: () => boolean, describe: string): Promise<void>;
  /** Wait for a condition the Desk reaches on its own. */
  until(condition: () => boolean, describe: string): Promise<void>;
  /** Wait until the screen shows `text`. */
  shows(text: string): Promise<void>;
  /** Move the clock, firing every timer that falls due. */
  advance(milliseconds: number): void;
  /**
   * Let the list's settle window pass, so membership and order changes held
   * back while keys were pressed apply.
   */
  settle(): void;
  /** Select a list item and let the selection settle. */
  select(itemId: string): Promise<void>;
  /** Let a form's typing pause so its preview reads, and wait for it. */
  settleForm(): Promise<void>;
  /** Move focus to one of the top layer's buttons and press it; the
   * confirm button unless another is named. */
  confirm(button?: string): Promise<void>;
  /** The top layer's id, if one is open. */
  top(): string | undefined;
  /** Wait for a layer to open on top. */
  opened(layerId: string): Promise<void>;
  /**
   * Wait for the operation a confirm started beside the screen to end: its
   * progress sheet gives way to the inbox, a result, or the next question.
   */
  operated(): Promise<void>;
  /** Quit with Ctrl+C, which quits under any layer, and wait for the exit code. */
  quit(): Promise<number>;
  /** The session's exit code once it ends. */
  readonly exit: Promise<number>;
}

/**
 * Run one Desk session, quitting it once `body` finishes. A failing body
 * closes the terminal, waits for the session to end, and rethrows its error
 * as `describe` words it.
 */
export async function withDeskSession(
  options: DeskSessionOptions,
  body: (desk: DeskSession) => Promise<void>,
  describe: (error: unknown) => unknown = (error) => error,
): Promise<DeskSession> {
  const desk = await deskSession(options);
  try {
    await body(desk);
    await desk.operated();
  } catch (error) {
    desk.io.close();
    await desk.exit.catch(() => undefined);
    throw describe(error);
  }
  assertEquals(await desk.quit(), 0, "the Desk quits cleanly");
  return desk;
}

/** Start a Desk and wait for its first survey to paint. */
export async function deskSession(
  options: DeskSessionOptions = {},
): Promise<DeskSession> {
  const io = new DeskTerminal([], {
    holdOpen: true,
    columns: options.columns ?? 120,
    rows: options.rows ?? 40,
    unicode: options.unicode ?? true,
    ...(options.colorDepth === undefined
      ? {}
      : { colorDepth: options.colorDepth }),
  });
  const clock = new ManualTerminalClock();
  const output = options.output ?? deskTranscript();
  let live: TerminalApplicationContext<unknown> | undefined;
  let surveys = 0;
  const scripted = options.production === true
    ? undefined
    : scriptedDeskRuntime(output);
  const status = options.runtime?.status ?? scripted?.status ??
    ((root: string) => statusResult(root, { all: true }));
  const runtime: Partial<DeskRuntime> = {
    ...scripted,
    ...(scripted === undefined ? {} : { now: () => DESK_NOW + clock.now() }),
    scheduler: clockScheduler(clock),
    ...options.runtime,
    status: async (root) => {
      const result = await status(root);
      surveys += 1;
      return result;
    },
    application: (application, termination) =>
      runTerminalApplication({
        ...application,
        start: (context) => {
          live = context;
          return application.start?.(context);
        },
      }, {
        io,
        clock,
        interactive: () => true,
        abortSignal: termination.signal,
      }),
  };
  const exit = runDesk(
    options.cliModel === undefined ? {} : { cliModel: options.cliModel },
    runtime,
  );
  // One load-safe budget for the whole session: a hung wait fails the test
  // once, never once per wait.
  const allowance = processAllowance();
  const until = async (
    condition: () => boolean,
    describe: string,
  ): Promise<void> => {
    try {
      await waitForPendingCondition(exit, condition, describe, { allowance });
    } catch (error) {
      const shown = captureTerminalFrame(io.output(), io.size()).text;
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${shown}`,
        { cause: error },
      );
    }
  };
  const context = (): TerminalApplicationContext<unknown> => {
    assert(live !== undefined, "the Desk did not start");
    return live;
  };
  const state = (): TerminalApplicationState => context().state;
  const screen = (): string =>
    captureTerminalFrame(io.output(), io.size()).text;
  await until(
    () => live !== undefined && io.idle() && (options.loading === true || surveys > 0),
    "the Desk's first paint",
  );
  const press = async (
    ...inputs: readonly (TerminalKeyName | string)[]
  ): Promise<void> => {
    for (const input of inputs) {
      assert(input !== "escape", "Escape lands late; use escape()");
      if (isKeyName(input)) io.enqueueKeys(input);
      else io.enqueue(input);
      await until(() => io.idle(), `the Desk to read ${JSON.stringify(input)}`);
    }
  };
  const top = (): string | undefined => state().topLayerId;
  // A form reads its preview once typing pauses; a sheet reads its subject
  // as it opens. Either way, wait until the top layer is read.
  const settleForm = async (): Promise<void> => {
    const layer = top();
    assert(layer !== undefined, "no layer is open");
    clock.advance(DESK_FORM_PREVIEW_MS);
    await until(
      () =>
        state().layers[layer] !== undefined &&
        !screen().includes("Checking current state"),
      `${layer} to finish reading`,
    );
  };
  const focused = (): string | undefined => {
    const layer = top();
    return layer === undefined
      ? undefined
      : state().layers[layer]?.focusedControlId;
  };
  return {
    io,
    clock,
    output,
    state,
    screen,
    press,
    type: async (text) => {
      io.enqueue(text);
      await until(() => io.idle(), `the Desk to read ${JSON.stringify(text)}`);
    },
    choose: async (itemId) => {
      for (let step = 0; step < 60; step += 1) {
        if (focused() === `item:${itemId}`) {
          await press("enter");
          return;
        }
        await press("down");
      }
      throw new Error(`${top()} has no item ${itemId}`);
    },
    palette: async (query, itemId) => {
      await press("ctrl-k");
      await until(() => top() === "palette", "the palette to open");
      io.enqueue(query);
      await until(
        () => state().layers.palette?.highlightedId === itemId,
        `the palette to highlight ${itemId} for ${JSON.stringify(query)}`,
      );
      await press("enter");
    },
    escape: async (effect, describe) => {
      io.enqueueKeys("escape");
      // The reader holds a lone Escape for its continuation window, timed on
      // the session clock once it has taken the byte.
      await until(() => io.idle(), "the Desk to read Escape");
      clock.advance(TERMINAL_LONE_ESCAPE_DELAY_MS);
      await until(effect, describe);
    },
    until,
    shows: (text) =>
      until(() => screen().includes(text), `the screen to show ${text}`),
    advance: (milliseconds) => clock.advance(milliseconds),
    settle: () => clock.advance(DEFAULT_APPLICATION_SETTLE_MS),
    select: async (itemId) => {
      context().select(DESK_LIST_ID, itemId, { reveal: true });
      await until(
        () => state().lists[DESK_LIST_ID]?.selectedId === itemId,
        `${itemId} to be selected`,
      );
      clock.advance(DESK_SELECTION_SETTLE_MS);
    },
    settleForm: () => settleForm(),
    confirm: async (button = "confirm") => {
      const layer = top();
      assert(layer !== undefined, "no layer is open to confirm");
      await settleForm();
      for (let step = 0; step < 24; step += 1) {
        if (state().layers[layer]?.focusedControlId === `button:${button}`) {
          await press("enter");
          return;
        }
        await press("tab");
      }
      throw new Error(`${layer} has no reachable ${button} button`);
    },
    top,
    opened: (layerId) =>
      until(() => top() === layerId, `${layerId} to open on top`),
    operated: () =>
      until(() => top() !== "progress", "the operation to end"),
    quit: async () => {
      io.enqueueKeys("ctrl-c");
      const code = await settlePending(exit, "the Desk to quit", {
        allowance,
      });
      io.close();
      return code;
    },
    exit,
  };
}

/** Whether an input names a key rather than text to type. */
function isKeyName(input: string): input is TerminalKeyName {
  return Object.hasOwn(TERMINAL_KEY_SEQUENCES, input);
}

/** A survey of the main checkout plus `fleet`, with any patch. */
export function deskSurvey(
  fleet: readonly StatusFleetEntry[] = [],
  patch: Partial<StatusData> = {},
): StatusData {
  return statusData([mainFleetEntry(DESK_ROOT), ...fleet], patch);
}

/** The head every landable fixture task stands at. */
export const LANDABLE_HEAD = "3f9c2e1".padEnd(40, "0");

/** A complete landing preview at `head`. */
export function acceptPreview(head: string): AcceptPreviewData {
  return {
    lands: { head, commits: 4, files: 61, insertions: 2023, deletions: 2038 },
    authority: {
      kind: "conversation-required",
      covered_paths: 0,
      uncovered_paths: 61,
    },
    queue_walk: [],
    ends_grant: false,
    leaves_queue: false,
  };
}

/** A ready task the session lands, at its own head. */
export function landable(head = LANDABLE_HEAD): StatusFleetEntry {
  return deskTaskEntry("agent/alpha", "/worktrees/alpha", {
    id: "alpha",
    ahead: 4,
    behind: 0,
    clean: true,
    registration: { head, locked: false, prunable: false },
    gate_proof: { status: "honored", head, recorded: "2026-07-11T11:40:00Z" },
    proof_honored: true,
  });
}

/** A Land review's session seams: its preview, and the landings it ran. */
export function landing(
  landed: unknown[],
  preview: Partial<AcceptPreviewData> = {},
  plan: EnginePlan = {
    title: "Acceptance plan",
    details: ["Branch: agent/alpha"],
    steps: [],
  },
): Partial<DeskRuntime> {
  return {
    acceptPlan: () => ({
      ok: true,
      verb: "accept",
      dry_run: true,
      plan,
      data: { preview: { ...acceptPreview(LANDABLE_HEAD), ...preview } },
    }),
    accept: (_ctx, options) => {
      landed.push(options);
    },
  };
}

