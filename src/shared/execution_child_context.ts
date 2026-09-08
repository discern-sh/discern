/** In-process capability for recording children owned by a candidate execution. */
import { AsyncLocalStorage } from "./module_loading.ts";
import { kill } from "process";

export interface ExecutionChildTicket {
  started(pid: number, isolated: boolean): Promise<void>;
  settled(): Promise<void>;
}
export interface ExecutionChildren {
  planned(): Promise<ExecutionChildTicket>;
}
const CHILDREN = new AsyncLocalStorage<ExecutionChildren | undefined>();

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
  const observer = CHILDREN.getStore();
  if (observer === undefined) return undefined;
  // Receipt publication performs its own administration reads. Instrumenting
  // those reads would recursively demand another receipt before the first one.
  const ticket = await CHILDREN.run(undefined, () => observer.planned());
  return {
    started: (pid, isolated) =>
      CHILDREN.run(undefined, () => ticket.started(pid, isolated)),
    settled: () => CHILDREN.run(undefined, () => ticket.settled()),
  };
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
