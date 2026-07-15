import type { ComponentMeta } from "./types/component-meta.ts";

/** Generated framework-neutral facts for one component stylesheet. */
export interface ComponentRegistryEntry {
  readonly meta: ComponentMeta;
  readonly css: string;
  readonly dependencies: readonly string[];
  readonly ownedClasses: readonly `discern-${string}`[];
  readonly publicTokenNames: readonly `--discern-${string}`[];
}
