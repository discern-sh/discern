/**
 * The manual inside the Desk: the documentation browser `discern docs`
 * runs, opened over the bundled manual in place of the inbox on the same
 * screen, with the same contents, keys and search. Escape from where it
 * opened, `q`, or its exit entry returns to the inbox as it was left. A page
 * the manual opens in the system browser opens while the screen stays, and
 * the browser says why when it can't.
 */

import type { TerminalApplicationCommand } from "discern-design-system/cli/interactive";
import type { DocsBrowserRequest } from "../../commands/docs.ts";
import { docsBrowserPageResponder } from "../../commands/docs_links.ts";
import type { BrowserOpenResult } from "../../lib/open_browser.ts";
import {
  markdownBrowserCommand,
  type MarkdownBrowserResumeState,
} from "../../lib/terminal_interaction.ts";

/** What the manual's exit entry says inside the Desk. */
export const DESK_MANUAL_EXIT = "Back to the desk";

/** The manual, read once per session and opened as often as the owner asks. */
export interface DeskManual {
  /**
   * The command that opens it where its reader last left it, reporting
   * mouse input when `mouse` is set; `closed` runs as it closes, as one of
   * the Desk's own callbacks.
   */
  open(mouse: boolean, closed: () => void): TerminalApplicationCommand;
}

/** The manual over one read corpus, opening its pages through `openPage`. */
export function deskManual(
  request: DocsBrowserRequest,
  openPage: (url: string) => Promise<BrowserOpenResult>,
): DeskManual {
  let place: MarkdownBrowserResumeState | undefined;
  const respond = docsBrowserPageResponder(openPage);
  return {
    open: (mouse, closed) =>
      markdownBrowserCommand({
        ...request,
        mouse,
        ...(place === undefined ? {} : { initialState: place }),
      }, {
        respond,
        onClose: (state) => {
          place = state;
          closed();
        },
      }),
  };
}
