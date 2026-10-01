/** Minimal consumer composition; package code owns every terminal mechanic. */
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import type {
  ApplicationKeyBinding,
  TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import type { TerminalApplicationOptions } from "../../src/lib/terminal_interaction.ts";

/** A grouped list with a following detail and a replaceable reading block. */
export function applicationView(
  updated: boolean,
): TerminalApplicationView<string> {
  const notes = createCliBlock(renderMarkdownCli, {
    source: `# A small consumer\n\n${
      updated
        ? "The provider published a new immutable view."
        : "The provider has not updated yet."
    }\n\nThe package fits this content to the terminal.\n\nThe child borrows the normal terminal and returns here.\n\n${
      "More notes to exercise detail scroll.\n\n".repeat(12)
    }`,
  });
  return {
    header: {
      leading: [{ text: "Terminal foundation", role: "title" }],
      trailing: [{
        text: updated ? "Refresh complete" : "Waiting for the live update",
        tone: "muted",
      }],
    },
    body: {
      kind: "master-detail",
      list: {
        id: "actions",
        groups: [{
          id: "samples",
          title: "Sample actions",
          items: [
            {
              id: "child",
              title: "Run harmless child",
              marker: { unicode: "›", ascii: ">" },
              primary: "child",
            },
            {
              // No primary action: the row can be inspected but never runs.
              id: "unavailable",
              title: "Unavailable sample",
              marker: { unicode: "×", ascii: "x", tone: "faint" },
            },
            {
              id: "quit",
              title: "Finish",
              marker: { unicode: "·", ascii: "-" },
              primary: "quit",
            },
          ],
        }],
      },
      detail: {
        follows: "actions",
        content: {
          child: [{ kind: "block", content: notes }],
          unavailable: [{
            kind: "text",
            runs: [{ text: "This sample can be inspected but cannot run." }],
          }],
          quit: [{ kind: "text", runs: [{ text: "Leave the application." }] }],
        },
      },
    },
    footer: {
      left: [{ key: "enter", label: "Choose" }],
      right: [{ key: "q", label: "Quit" }],
    },
    windowTitle: "Terminal foundation",
    tooSmallHints: [{ key: "q", label: "Quit" }],
  };
}

/** The fixture's one binding: `q` leaves from anywhere on the base layer. */
export const APPLICATION_KEYMAP: readonly ApplicationKeyBinding<string>[] = [
  { key: "q", action: "quit" },
];

/** Publish asynchronously without putting discovery or effects in key handlers. */
export function consumerApplication(
  foreground: () => Promise<void>,
): TerminalApplicationOptions<string> {
  return {
    view: applicationView(false),
    keymap: APPLICATION_KEYMAP,
    start: (context) => {
      queueMicrotask(() => context.update(applicationView(true)));
    },
    onAction: (action) => {
      if (action === "unavailable") {
        throw new Error("unavailable choice activated");
      }
      return action === "quit"
        ? { kind: "exit" }
        : { kind: "foreground", run: foreground };
    },
  };
}
