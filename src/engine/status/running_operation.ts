/** The calling checkout's long operation while its executor is still running. */
import type { StatusData } from "../../shared/result_schemas.ts";
import { operationProgressResult } from "../completion/progress_result.ts";

/**
 * The fact a resumed session needs before it is told to start another run:
 * the verb, the effort, the handle that reads the run back, and its latest
 * recorded sentence. Read-only; a missing or finished operation is absent.
 */
export async function callingCheckoutRunningOperation(
  root: string,
): Promise<StatusData["operation"]> {
  const read = await operationProgressResult(root);
  if (
    !read.ok || read.data === undefined || read.data.executor !== "running" ||
    read.data.outcome !== undefined
  ) return undefined;
  const { handle, operation, progress } = read.data;
  return {
    verb: operation.verb,
    ...(operation.branch === undefined ? {} : { branch: operation.branch }),
    handle,
    ...(progress === undefined ? {} : { latest: progress.reason }),
  };
}
