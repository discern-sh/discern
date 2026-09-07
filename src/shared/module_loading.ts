/** Lazy module evaluation belongs to the process, outside invocation capabilities. */
import { AsyncLocalStorage } from "async_hooks";

// Context owners import this constructor here, so this baseline is captured
// before any of them can install invocation state.
export { AsyncLocalStorage };
const inModuleContext = AsyncLocalStorage.snapshot();

/** Load code without donating the caller's locks, child ownership or observers.
 * The awaiting continuation keeps its caller context, including on rejection. */
export async function loadModule<T>(loader: () => Promise<T>): Promise<T> {
  return await inModuleContext(loader);
}
