/** In-process capability for recording children owned by a candidate execution. */
import { AsyncLocalStorage } from "async_hooks";
import { kill } from "process";

export interface ExecutionChildTicket {
  started(pid: number, isolated: boolean): Promise<void>;
  settled(): Promise<void>;
}
export interface ExecutionChildren {
  planned(): Promise<ExecutionChildTicket>;
}
const CHILDREN = new AsyncLocalStorage<ExecutionChildren>();

/** Install only for the duration of the native exclusive execution. */
export async function withExecutionChildren<T>(
  children: ExecutionChildren,
  operation: () => Promise<T>,
): Promise<T> {
  return await CHILDREN.run(children, operation);
}

/** Persist intent before spawn; outside candidate execution there is no receipt. */
export async function planExecutionChild(): Promise<
  ExecutionChildTicket | undefined
> {
  return await CHILDREN.getStore()?.planned();
}

/** Only ESRCH proves absence. Permissions, unsupported signals and live PIDs do not. */
export function executionChildAbsent(pid: number, isolated: boolean): boolean {
  try {
    kill(isolated ? -pid : pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}
