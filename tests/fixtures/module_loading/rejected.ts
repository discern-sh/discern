/** Rejected evaluation must restore the awaiting invocation's context too. */
import { assertEquals } from "@std/assert";
import { currentOperationLocks } from "../../../src/shared/operation_lock_context.ts";
import { caller } from "./state.ts";
assertEquals(currentOperationLocks(), undefined);
assertEquals(caller.getStore(), undefined);
throw new Error("Module evaluation rejected");
