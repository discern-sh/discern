/** Minimal consumer composition; package code owns every terminal mechanic. */
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import type { TerminalApplicationView } from "discern-design-system/cli/interactive";
import type { TerminalApplicationOptions } from "../../src/lib/terminal_interaction.ts";

/** Two regions with stable identities and a replaceable reading block. */
export function applicationView(
  updated: boolean,
): TerminalApplicationView<string> {
  return {
    title: "Terminal foundation",
    tip: updated
      ? "Refresh complete. Tab switches regions."
      : "Waiting for the live update.",
    regions: [{
      kind: "choices",
      id: "actions",
      title: "Sample actions",
      entries: [
        {
          id: "child",
          label: "Run harmless child",
          value: "child",
          description: "Return to this selection after one line of input.",
        },
        {
          id: "unavailable",
          label: "Unavailable sample",
          value: "unavailable",
          disabled: true,
          description: "This choice can be inspected but cannot run.",
        },
        { id: "quit", label: "Finish", value: "quit" },
      ],
    }, {
      kind: "reading",
      id: "notes",
      title: "Field notes",
      content: createCliBlock(renderMarkdownCli, {
        source: `# A small consumer\n\n${
          updated
            ? "The provider published a new immutable view."
            : "The provider has not updated yet."
        }\n\nUse Tab to reach either region. The package fits this content to the terminal.\n\nThe child borrows the normal terminal and returns here.\n\n${
          "More notes to exercise reading scroll.\n\n".repeat(12)
        }`,
      }),
    }],
  };
}

/** Publish asynchronously without putting discovery or effects in key handlers. */
export function consumerApplication(
  foreground: () => Promise<void>,
): TerminalApplicationOptions<string> {
  return {
    view: applicationView(false),
    start: (context) => {
      queueMicrotask(() => context.update(applicationView(true)));
    },
    onAction: ({ value }) => {
      if (value === "unavailable") {
        throw new Error("unavailable choice activated");
      }
      return value === "quit"
        ? { kind: "exit" }
        : { kind: "foreground", run: foreground };
    },
  };
}
