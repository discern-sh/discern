/** Authored release-handoff presentation shared by CLI and desk result readers. */
import type { ResultMarkdownPresentation } from "./result_markdown.ts";
import { ReleasesDataSchema } from "./result_schemas.ts";
import { text } from "./result_markdown_values.ts";

/** Keep both addresses visible regardless of browser availability. */
export function presentReleases(
  result: Readonly<Record<string, unknown>>,
): ResultMarkdownPresentation {
  const state = text(result.message) ?? "Release information handoff.";
  const parsed = ReleasesDataSchema.safeParse(result.data);
  if (!parsed.success) return { state };
  const data = parsed.data;
  const write = data.state_write;
  return {
    state,
    evidence: [
      `Browser: ${data.urls.html}`,
      `JSON: ${data.urls.json}`,
      data.launch_attempted === true
        ? data.launch_succeeded === true
          ? "The browser launcher accepted the URL. Navigation was not verified."
          : `The browser launcher failed: ${
            data.launch_message ?? "unavailable"
          }. Open the URL yourself.`
        : "No browser launch was attempted.",
      write.status === "saved"
        ? "The clone-local handoff timestamp was recorded."
        : `Local timestamp: ${write.status}${
          write.reason ? ` — ${write.reason}` : ""
        }.`,
    ],
    boundary: [
      "The binary made no network request and installed nothing. Opening either URL sends only this process's version number as application data to discern.sh. A supplied version does not prove the on-disk binary; the timestamp does not prove a fetch.",
    ],
  };
}
