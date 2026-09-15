/** Release information for terminal, Markdown, and desk readers. */
import type { Logger } from "../lib/log.ts";
import type { DiscernResult } from "./result.ts";
import type { ResultMarkdownPresentation } from "./result_markdown.ts";
import { type ReleasesData, ReleasesDataSchema } from "./result_schemas.ts";
import { text } from "./result_markdown_values.ts";

/** Explain the browser action and keep the manual fallback useful. */
function browserMessage(data: ReleasesData, dryRun: boolean): string {
  if (dryRun) return "Would open this page to check for updates:";
  if (data.launch_succeeded) return "Opening release notes in your browser:";
  if (data.launch_message !== undefined) {
    return "Couldn't open your browser. Use this link to check for updates:";
  }
  return "See what's changed and check for updates:";
}

/** The terminal shows the version and useful next action, without a report wrapper. */
export function printReleases(
  result: DiscernResult<ReleasesData>,
  log: Logger,
): void {
  log.result(result);
  log.heading(result.message ?? "Release information");
  if (result.data === undefined) return;
  log.info(browserMessage(result.data, result.dry_run === true));
  log.line(result.data.urls.html);
}

/** Structured readers retain both addresses for browser or tool use. */
export function presentReleases(
  result: Readonly<Record<string, unknown>>,
): ResultMarkdownPresentation {
  const state = text(result.message) ?? "Release information.";
  const parsed = ReleasesDataSchema.safeParse(result.data);
  if (!parsed.success) return { state };
  return {
    state,
    evidence: [
      browserMessage(parsed.data, result.dry_run === true),
      `Browser: ${parsed.data.urls.html}`,
      `JSON: ${parsed.data.urls.json}`,
    ],
  };
}
