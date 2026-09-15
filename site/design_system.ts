/** Discern's complete, site-owned selection from the published design system. */

import type {
  ComponentGroup,
  RuntimeAssetSelection,
} from "discern-design-system";
import { WORKFLOW_COMPONENTS } from "./workflow_registry.ts";

interface SiteDesignSystemBundle {
  readonly output: `pages/assets/design-system/${string}/`;
  readonly routes: readonly `/${string}`[];
  readonly groups: readonly ComponentGroup[];
  readonly components: readonly string[];
  readonly assets: readonly RuntimeAssetSelection[];
}

/**
 * The single source of truth for route bundles and optional runtime assets.
 * Component dependencies are deliberately left to the package emitter.
 */
export const DESIGN_SYSTEM_BUNDLES = {
  docs: {
    output: "pages/assets/design-system/docs/",
    routes: ["/docs", "/map"],
    groups: ["Docs"],
    components: [
      "icon",
      "icon-button",
      "theme-toggle",
      "brand",
      "kicker",
      "table",
      "breadcrumbs",
      ...WORKFLOW_COMPONENTS,
      "table-of-contents",
    ],
    assets: ["fonts"],
  },
  compositions: {
    output: "pages/assets/design-system/compositions/",
    routes: ["/", "/agents", "/trust"],
    groups: ["Marketing", "Editorial"],
    components: [
      "icon",
      "button",
      "icon-button",
      "theme-toggle",
      "brand",
      "cluster",
      "grid",
      "badge",
      "heading",
      "kicker",
      "tag",
      "window",
      "skip-link",
      "harmonic-backdrop",
    ],
    assets: ["fonts"],
  },
} as const satisfies Record<string, SiteDesignSystemBundle>;

export type DesignSystemBundleName = keyof typeof DESIGN_SYSTEM_BUNDLES;

/** Return the public URL for one file emitted into a selected bundle. */
export function designSystemAssetPath(
  bundle: DesignSystemBundleName,
  file: string,
): string {
  const output = DESIGN_SYSTEM_BUNDLES[bundle].output;
  return `/${output.slice("pages/".length)}${file}`;
}
