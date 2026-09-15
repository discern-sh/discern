/** Format dispatch over the shared release model and its HTML/text projections. */
import { renderReleaseErrorHtml } from "../ui/pages/ReleasesPage.tsx";
import type { ReleaseInputError } from "./model.ts";
export { renderReleaseHtml } from "../ui/pages/ReleasesPage.tsx";
export { releaseSections, renderReleaseText } from "./presentation.ts";

/** Invalid queries retain a useful explanation in every negotiated representation. */
export function renderReleaseError(
  error: ReleaseInputError,
  format: "html" | "text" | "json",
): string {
  if (format === "json") return JSON.stringify(error);
  if (format === "text") {
    return `Invalid release comparison: ${error.message}\n`;
  }
  return renderReleaseErrorHtml(error);
}
