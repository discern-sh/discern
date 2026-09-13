/** Cancellation ownership shared by public execution and its nested effects. */
import { AsyncLocalStorage } from "./module_loading.ts";

const operationSignal = new AsyncLocalStorage<AbortSignal>();

/** The current executor's signal; cleanup may explicitly install a fresh scope. */
export function currentOperationSignal(): AbortSignal | undefined {
  return operationSignal.getStore();
}

/** Keep nested effects attached until the executor has settled its durable result. */
export async function runWithOperationSignal<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  return await operationSignal.run(signal, run);
}
