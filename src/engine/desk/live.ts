/** Live Desk observation and routing. Terminal navigation stays in the package. */
import { bestEffort } from "../../shared/best_effort.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type Scheduler,
  SYSTEM_SCHEDULER,
  type TimeoutHandle,
} from "../../shared/scheduler.ts";
import type { TerminalApplicationContext } from "discern-design-system/cli/interactive";
import type { TerminalApplicationOptions } from "../../lib/terminal_interaction.ts";
import { isInteractionCancelled } from "../../lib/terminal_interaction.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import {
  buildDeskRows,
  type DeskRow,
  deskRowId,
  withDeskCapabilities,
} from "./model.ts";
import {
  DESK_KEYS,
  deskApplicationView,
  type DeskChoice,
  type DeskPage,
  type DeskSnapshot,
} from "./application_view.ts";

/** Effect and observation dependencies owned by Desk, never by a key transition. */
export interface LiveDeskDependencies {
  readonly observe: () => Promise<StatusData>;
  readonly capabilities: (row: DeskRow) => Promise<DeskRow>;
  readonly tip: (data: StatusData) => Promise<string | undefined>;
  readonly perform: (
    choice: DeskChoice,
    data: StatusData,
    row?: DeskRow,
  ) => Promise<string | void | { path?: string; message?: string }>;
  readonly now: () => number;
  readonly trunk: string;
  /** A completed observation waits this long before the next begins. */
  readonly refreshMs?: number;
  readonly scheduler?: Scheduler;
  readonly measure?: (
    kind: "discovery" | "capabilities",
    durationMs: number,
  ) => void;
}

/** Start once; at most one survey and one selected-task capability read run together. */
export function liveDesk(
  deps: LiveDeskDependencies,
): TerminalApplicationOptions<DeskChoice> {
  const scheduler = deps.scheduler ?? SYSTEM_SCHEDULER;
  const cancelTimer = (): void => {
    if (timer !== undefined) scheduler.cancelTimeout(timer);
    timer = undefined;
  };
  let snapshot: DeskSnapshot = { rows: [], phase: "loading" };
  let page: DeskPage = "overview";
  const back: DeskPage[] = [];
  const focusByPage = new Map<DeskPage, string>();
  let selectedId: string | undefined;
  let context: TerminalApplicationContext<DeskChoice> | undefined;
  let alive = true;
  let foreground = false;
  let generation = 0;
  let capabilityGeneration = 0;
  let timer: TimeoutHandle | undefined;
  let survey: Promise<StatusData> | undefined;
  let detail: Promise<void> | undefined;
  let detailId: string | undefined;
  let tipSelected = false;
  let refreshJob: Promise<void> | undefined;
  let tipJob: Promise<void> | undefined;
  let feedback: string | undefined;
  const publish = (focus?: string): void => {
    if (!alive) return;
    const view = deskApplicationView(snapshot, page, selectedId);
    context?.update(
      focus === undefined || !view.regions.some((region) => region.id === focus)
        ? view
        : { ...view, focusedRegionId: focus },
    );
  };
  const show = (target: DeskPage, remember = true): void => {
    if (context) focusByPage.set(page, context.state.focusedRegionId);
    if (remember) back.push(page);
    page = target;
    const focus = target === "details"
      ? `task:${selectedId}:details`
      : target === "task"
      ? `task:${selectedId}:actions`
      : focusByPage.get(target);
    publish(focus);
  };
  const goBack = (): void => {
    if (context) focusByPage.set(page, context.state.focusedRegionId);
    if (page === "notice") {
      const { notice: _notice, ...remaining } = snapshot;
      snapshot = remaining;
    }
    page = back.pop() ?? "overview";
    publish(focusByPage.get(page));
  };
  const read = (): Promise<StatusData> => {
    if (survey !== undefined) return survey;
    const started = SYSTEM_CLOCK.monotonicNow();
    survey = deps.observe().then((data) => {
      if (
        data.fleet === undefined ||
        (data.git === null && data.fleet.length === 0)
      ) throw new Error("Fleet observation unavailable; Git state is unknown.");
      return data;
    }).finally(() => {
      survey = undefined;
      deps.measure?.("discovery", SYSTEM_CLOCK.monotonicNow() - started);
    });
    return survey;
  };
  const adopt = (data: StatusData): void => {
    const rows = buildDeskRows(data.fleet ?? [], new Map(), new Map(), {
      trunk: data.git?.trunk ?? deps.trunk,
      nowMs: deps.now(),
      fleetCollisions: data.fleet_collisions ?? [],
      adrCollisions: data.adr_collisions ?? [],
    });
    const previous = snapshot.rows.find((row) => deskRowId(row) === selectedId);
    let message: string | undefined = feedback;
    if (previous && !rows.some((row) => deskRowId(row) === selectedId)) {
      message = data.recent_completed_tasks?.some((task) =>
          task.branch === previous.entry.branch
        )
        ? "Task landed"
        : data.unlanded_branches?.includes(previous.entry.branch)
        ? "Task checkout closed; branch available to resume"
        : "Task no longer observed";
      page = "overview";
      back.length = 0;
      selectedId = undefined;
      capabilityGeneration++;
    }
    snapshot = {
      rows: rows.map((row) =>
        previous && deskRowId(row) === deskRowId(previous)
          ? withDeskCapabilities(row, previous, deps.trunk, deps.now())
          : row
      ),
      data,
      phase: "fresh",
      ...(snapshot.tip === undefined ? {} : { tip: snapshot.tip }),
      ...(snapshot.notice === undefined ? {} : { notice: snapshot.notice }),
      ...(message === undefined ? {} : { message }),
    };
    publish();
  };
  const loadDetail = (): void => {
    if (detail !== undefined) {
      if (selectedId !== detailId) capabilityGeneration++;
      return;
    }
    if (selectedId === undefined || foreground) return;
    capabilityGeneration++;
    const row = snapshot.rows.find((row) => deskRowId(row) === selectedId);
    if (row === undefined) return;
    const run = capabilityGeneration;
    const id = selectedId;
    detailId = id;
    const started = SYSTEM_CLOCK.monotonicNow();
    detail = deps.capabilities(row).then((current) => {
      if (!alive || run !== capabilityGeneration || selectedId !== id) return;
      // Status remains current even when capability discovery was slow.
      const fresh = snapshot.rows.find((candidate) =>
        deskRowId(candidate) === id
      );
      if (fresh === undefined) return;
      snapshot = {
        ...snapshot,
        rows: snapshot.rows.map((candidate) =>
          deskRowId(candidate) === id
            ? withDeskCapabilities(fresh, current, deps.trunk, deps.now())
            : candidate
        ),
      };
      publish();
    }, (error) => {
      if (!alive || run !== capabilityGeneration) return;
      snapshot = {
        ...snapshot,
        message: `Task capabilities unavailable: ${String(error)}`,
      };
      publish();
    }).finally(() => {
      detail = undefined;
      deps.measure?.("capabilities", SYSTEM_CLOCK.monotonicNow() - started);
      if (
        alive && run !== capabilityGeneration && selectedId !== undefined &&
        !foreground
      ) loadDetail();
    }).catch((error) => context?.fail(error));
  };
  const schedule = (): void => {
    if (!alive || foreground) return;
    cancelTimer();
    timer = scheduler.scheduleTimeout(() => {
      refresh();
    }, deps.refreshMs ?? 5000);
  };
  const refresh = (): void => {
    if (!alive || foreground || survey !== undefined) return;
    cancelTimer();
    const run = ++generation;
    snapshot = { ...snapshot, phase: snapshot.data ? "refreshing" : "loading" };
    publish();
    refreshJob = read().then((data) => {
      if (!alive || run !== generation) return;
      adopt(data);
      loadDetail();
      if (!tipSelected) {
        tipSelected = true;
        tipJob = (async () => {
          let tip: string | undefined;
          await bestEffort("desk-tip-presentation", async () => {
            tip = await deps.tip(data);
          });
          if (!alive || tip === undefined) return;
          snapshot = { ...snapshot, tip };
          publish();
        })().catch((error) => context?.fail(error));
      }
    }, (error) => {
      if (!alive || run !== generation) return;
      snapshot = {
        ...snapshot,
        phase: "stale",
        message: `Observation unavailable. Retry. ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
      publish();
    }).finally(schedule).catch((error) => context?.fail(error));
  };
  const effect = (
    choice: DeskChoice,
  ): { kind: "foreground"; run: () => Promise<void> } => ({
    kind: "foreground",
    run: async () => {
      foreground = true;
      generation++;
      capabilityGeneration++;
      cancelTimer();
      feedback = undefined;
      let performed = false;
      let issue = false;
      try {
        // An in-flight observation may predate the click; a fresh read begins after it.
        if (survey !== undefined) await Promise.allSettled([survey]);
        const data = await read();
        adopt(data);
        let row: DeskRow | undefined;
        if (choice.kind === "action") {
          row = snapshot.rows.find((candidate) =>
            deskRowId(candidate) === choice.id &&
            candidate.entry.path === choice.path &&
            candidate.entry.branch === choice.branch
          );
          if (row === undefined) {
            issue = true;
            snapshot = {
              ...snapshot,
              message: "The selected task changed; no action ran.",
            };
            return;
          }
          if (["agent", "scripts", "follow_up"].includes(choice.action)) {
            row = await deps.capabilities(row);
          }
          const offer = row.decision.actions.find((candidate) =>
            candidate.action === choice.action
          );
          if (offer?.availability !== "enabled") {
            issue = true;
            snapshot = {
              ...snapshot,
              message: offer?.availability === "disabled"
                ? offer.reason
                : "Action unavailable. Retry.",
            };
            return;
          }
        }
        performed = true;
        const outcome = await deps.perform(choice, data, row);
        const path = typeof outcome === "string" ? outcome : outcome?.path;
        const after = await read();
        adopt(after);
        if (typeof outcome === "object" && outcome.message !== undefined) {
          feedback = [snapshot.message, outcome.message].filter((
            message,
            index,
            all,
          ) => message !== undefined && all.indexOf(message) === index).join(
            ". ",
          );
          snapshot = { ...snapshot, message: feedback };
        }
        if (path !== undefined) {
          const created = snapshot.rows.find((candidate) =>
            candidate.entry.path === path
          );
          if (created) {
            selectedId = deskRowId(created);
            show("task");
          }
        }
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        if (performed) {
          try {
            adopt(await read());
          } catch {
            snapshot = { ...snapshot, phase: "stale" };
          }
        }
        if (!isInteractionCancelled(error)) {
          issue = true;
          snapshot = {
            ...snapshot,
            message: [snapshot.message, `Action did not complete: ${failure}`]
              .filter(Boolean).join(". "),
          };
        }
      } finally {
        foreground = false;
        if (issue) {
          snapshot = {
            ...snapshot,
            ...(snapshot.message ? { notice: snapshot.message } : {}),
          };
          show("notice");
        } else publish();
        loadDetail();
        schedule();
      }
    },
  });
  return {
    view: deskApplicationView(snapshot, page),
    start: (live) => {
      context = live;
      refresh();
      return () => {
        alive = false;
        if (refreshJob !== undefined) refreshJob = undefined;
        if (tipJob !== undefined) tipJob = undefined;
        generation++;
        capabilityGeneration++;
        cancelTimer();
      };
    },
    onKey: (key) => {
      if (key.kind === "named" && key.name === "escape") {
        if (page === "overview") return { kind: "exit" };
        goBack();
        return { kind: "handled" };
      }
      if (key.kind !== "text") return;
      const shortcut = DESK_KEYS.find((item) => item.key === key.text);
      if (!shortcut) return;
      if (shortcut.route === "quit") return { kind: "exit" };
      if (shortcut.route === "retry") refresh();
      else show(shortcut.route);
      return { kind: "handled" };
    },
    onAction: ({ value }) => {
      if (value.kind === "task") {
        selectedId = value.id;
        show("task");
        loadDetail();
        return { kind: "handled" };
      }
      if (value.kind === "route") {
        if (value.route === "quit") return { kind: "exit" };
        if (value.route === "retry") {
          refresh();
          return { kind: "handled" };
        }
        if (value.route === "back") {
          goBack();
          return { kind: "handled" };
        }
        if (
          [
            "help",
            "tip",
            "queue",
            "more",
            "details",
            "overview",
            "task",
            "notice",
          ]
            .includes(value.route)
        ) {
          show(value.route as DeskPage);
          return { kind: "handled" };
        }
      }
      return effect(value);
    },
  };
}
