/**
 * One boundary turns a gate verb into an observable long operation: the run is
 * journalled behind a reconnect handle, and a live terminal presenter can
 * register mid-run once the output policy exists. Every gate verb shares this
 * wrapper so no verb grows a second progress model.
 */
import { runGit } from "../../shared/subprocess.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { withCompletionObserver } from "../completion/events.ts";
import { withOperationJournal } from "../completion/operation_journal.ts";
import {
  type GateProgressPresenterSlot,
  gateProgressPresenterSlot,
} from "./progress_presenter.ts";

/** Run one gate verb as a journalled, presenter-observable operation. */
export async function observedGateOperation<T>(
  root: string,
  verb: string,
  signal: AbortSignal | undefined,
  body: (presenterSlot: GateProgressPresenterSlot) => Promise<T>,
  result: (value: T) => DiscernResult,
): Promise<T> {
  const branchRun = await runGit(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    { cwd: root },
  );
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  const presenterSlot = gateProgressPresenterSlot();
  // The presenter scope encloses the journal so the handle announcement the
  // journal emits at start reaches the terminal once a presenter registers.
  return await withCompletionObserver(
    (fact) => presenterSlot.observe(fact),
    () =>
      withOperationJournal(root, {
        verb,
        path: root,
        ...(branch === "" ? {} : { branch }),
      }, () =>
        body(presenterSlot), {
        result,
        ...(signal === undefined ? {} : { signal }),
      }),
  );
}
