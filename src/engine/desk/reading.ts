/** Desk reading routes compose the package viewport; every input owner is suspended by its caller. */
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import {
  type ConfirmationRequestOptions,
  runTerminalApplication,
  type TerminalApplicationRuntime,
} from "../../lib/terminal_interaction.ts";
import { terminalLine } from "../../lib/terminal.ts";

/** Product contents of a local reading or consent route. */
export interface DeskReading {
  readonly title: string;
  readonly source: string;
  readonly actions?: readonly {
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly disabled?: boolean;
  }[];
  readonly confirmation?: {
    readonly question: string;
    readonly options: ConfirmationRequestOptions;
  };
}

/** Keep observed names literal in Markdown prose. */
export function deskLiteral(value: string): string {
  return terminalLine(value).replace(/[\\`*_{}\[\]<>#|]/gu, "\\$&");
}

/** Read locally and return the activated action; Escape always leaves the route. */
export async function readDeskScreen(
  request: DeskReading,
  runtime: TerminalApplicationRuntime = {},
): Promise<string> {
  let selected = "back";
  const actions = request.confirmation === undefined
    ? request.actions ?? [{ id: "back", label: "Back" }]
    : [
      { id: "back", label: request.confirmation.options.noLabel },
      { id: "apply", label: request.confirmation.options.yesLabel },
    ];
  await runTerminalApplication<string>({
    view: {
      title: terminalLine(request.title),
      focusedRegionId: "desk-reading-content",
      help: "Tab choices/read  Esc back",
      regions: [{
        kind: "choices",
        id: "desk-reading-actions",
        search: true,
        title: request.confirmation?.question ?? "Actions",
        entries: actions.map((action, index) => ({
          ...action,
          id: `desk-reading-choice-${index}`,
          value: action.id,
        })),
      }, {
        kind: "reading",
        id: "desk-reading-content",
        title: "Review",
        content: createCliBlock(renderMarkdownCli, { source: request.source }),
      }],
    },
    onAction: ({ value }) => {
      selected = value;
      return { kind: "exit" };
    },
    onKey: (key) =>
      key.kind === "named" && key.name === "escape"
        ? { kind: "exit" }
        : undefined,
  }, runtime);
  return selected;
}
