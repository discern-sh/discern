/** An independent consumer's context must also stay outside module evaluation. */
import { AsyncLocalStorage } from "../../../src/shared/module_loading.ts";
export const caller = new AsyncLocalStorage<string>();
export const state = { evaluations: 0 };
