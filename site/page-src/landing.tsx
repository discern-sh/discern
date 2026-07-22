/**
 * The authored homepage entry point. site/build.ts wraps this placeholder in
 * the shared document shell and emits the selected design-system resources.
 */

import { pageDocument } from "./document.ts";

export const HOMEPAGE_PLACEHOLDER =
  "<!-- Replace this comment with the new homepage design. -->";

/** Render the homepage shell for static serving. */
export function renderLanding(): string {
  return pageDocument({
    source: "landing.tsx",
    title: "discern",
    description:
      "discern provides project-owned checks and isolated worktrees for coding agents.",
    styles: ["fonts.css", "discern.css", "grain.css", "landing.css"],
    scripts: ["landing.js"],
    body: HOMEPAGE_PLACEHOLDER,
  });
}
