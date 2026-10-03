/**
 * The manual inside the Desk: the documentation browser `discern docs`
 * runs, opened over the bundled manual in place of the inbox on the same
 * screen, with the same contents, keys and search. Escape from where it
 * opened, `q`, or its exit entry returns to the inbox as it was left. A page
 * the manual opens in the system browser opens while the screen stays, and
 * the browser says why when it can't.
 *
 * The session reads the manual once as it starts. Chosen before that read
 * finishes, the Desk hands the terminal over at once, saying it is reading
 * the manual, and the same browser opens on its own screen as soon as the
 * read is done; closing it returns to the inbox as it was left.
 */

import type { TerminalApplicationCommand } from "discern-design-system/cli/interactive";
import type { DocsBrowserRequest } from "../../commands/docs.ts";
import {
  type DocsBrowserChoice,
  docsBrowserPageResponder,
} from "../../commands/docs_links.ts";
import type { BrowserOpenResult } from "../../lib/open_browser.ts";
import {
  isInteractionCancelled,
  markdownBrowserCommand,
  type MarkdownBrowserRequestHandlers,
  type MarkdownBrowserRequestResult,
  type MarkdownBrowserResumeState,
} from "../../lib/terminal_interaction.ts";

/** What the manual's exit entry says inside the Desk. */
export const DESK_MANUAL_EXIT = "Back to the desk";

/** What the Desk says as it hands over the terminal before the manual is read. */
export const DESK_MANUAL_READING = "Reading the manual…";

/** The browser on a screen of its own, as `discern docs` runs it. */
export type DeskManualBrowser = (
  request: DocsBrowserRequest,
  handlers: MarkdownBrowserRequestHandlers<DocsBrowserChoice>,
) => Promise<MarkdownBrowserRequestResult<DocsBrowserChoice>>;

/** The manual, read once per session and opened as often as the owner asks. */
export interface DeskManual {
  /**
   * The command that opens it where its reader last left it, reporting
   * mouse input when `mouse` is set; `closed` runs as it closes, as one of
   * the Desk's own callbacks.
   */
  open(mouse: boolean, closed: () => void): TerminalApplicationCommand;
  /**
   * Browse it on a screen of its own, where its reader last left it, while
   * the Desk has handed over the terminal; settles once the reader closes
   * it.
   */
  browse(mouse: boolean): Promise<void>;
}

/**
 * The manual over one read corpus, opening its pages through `openPage`, and
 * on a screen of its own through `ownScreen`.
 */
export function deskManual(
  request: DocsBrowserRequest,
  openPage: (url: string) => Promise<BrowserOpenResult>,
  ownScreen: DeskManualBrowser,
): DeskManual {
  let place: MarkdownBrowserResumeState | undefined;
  const respond = docsBrowserPageResponder(openPage);
  const at = (mouse: boolean): DocsBrowserRequest => ({
    ...request,
    mouse,
    ...(place === undefined ? {} : { initialState: place }),
  });
  return {
    open: (mouse, closed) =>
      markdownBrowserCommand(at(mouse), {
        respond,
        onClose: (state) => {
          place = state;
          closed();
        },
      }),
    browse: async (mouse) => {
      try {
        const result = await ownScreen(at(mouse), { respond });
        if (result.kind !== "refused") place = result.state;
      } catch (error) {
        if (!isInteractionCancelled(error)) throw error;
      }
    },
  };
}
