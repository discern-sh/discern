/**
 * The editor's design-system bundle: emitted at server boot into the
 * gitignored scratch tree, so the browser chrome wears the house style
 * without committing generated assets or joining the site's build.
 */

import { join, toFileUrl } from "@std/path";
import { emitDesignSystemRuntime } from "discern-design-system/runtime";
import { SITE_APPEARANCE } from "../../site/appearance.ts";

/** Where the emitted bundle lives, relative to the repository root. */
export const CANON_EDITOR_ASSET_DIR: readonly string[] = [
  ".scratch",
  "canon-editor",
  "assets",
  "design-system",
];

/**
 * Emit the editor's selection of the design system — editorial prose styles
 * plus the fonts — and return the bundle directory. The emitter replaces the
 * directory's contents, so a stale bundle from an earlier version cannot
 * linger.
 */
export async function emitCanonEditorAssets(root: string): Promise<string> {
  const dir = join(root, ...CANON_EDITOR_ASSET_DIR);
  await Deno.mkdir(dir, { recursive: true });
  await emitDesignSystemRuntime({
    outputRoot: new URL(`${toFileUrl(dir).href}/`),
    groups: ["Editorial"],
    components: ["icon-button", "badge", "divider"],
    assets: ["fonts"],
    appearanceScopes: SITE_APPEARANCE.appearanceScopes,
  });
  return dir;
}
