/** Discern's complete, site-owned selection from the published design system. */

import type {
  ComponentGroup,
  RuntimeAssetSelection,
} from "discern-design-system";

interface SiteDesignSystemBundle {
  readonly output: `pages/assets/design-system/${string}/`;
  readonly routes: readonly `/${string}`[];
  readonly groups: readonly ComponentGroup[];
  readonly components: readonly string[];
  readonly assets: readonly RuntimeAssetSelection[];
  readonly theme: "discern" | "none";
}

/**
 * The single source of truth for route bundles and optional runtime assets.
 * Component dependencies are deliberately left to the package emitter.
 */
export const DESIGN_SYSTEM_BUNDLES = {
  docs: {
    output: "pages/assets/design-system/docs/",
    routes: ["/docs"],
    groups: ["Docs"],
    components: [
      "icon",
      "icon-button",
      "heading",
      "kicker",
      "window",
      "badge",
      "breadcrumbs",
      "table",
      "table-of-contents",
      "theme-toggle",
    ],
    assets: ["fonts"],
    theme: "discern",
  },
  compositions: {
    output: "pages/assets/design-system/compositions/",
    routes: ["/", "/design-system-demo", "/content-design-demo"],
    groups: ["Marketing", "Editorial"],
    components: [
      "icon",
      "button",
      "icon-button",
      "badge",
      "heading",
      "kicker",
      "tag",
      "window",
      "terminal",
    ],
    assets: ["fonts", "grain"],
    theme: "discern",
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
