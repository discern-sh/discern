/** This module evaluates cold, even when the surrounding suite has warm imports. */
import { assertEquals } from "@std/assert";
import { currentOperationLocks } from "../../../src/shared/operation_lock_context.ts";
import { emitCompletionProgress } from "../../../src/engine/completion/events.ts";
import { caller, state } from "./state.ts";
assertEquals(currentOperationLocks(), undefined);
assertEquals(caller.getStore(), undefined);
emitCompletionProgress({
  phase: "pending",
  state: "module",
  candidate_id: null,
  reason: "Module initialization",
});
state.evaluations++;
export const value = 43;
