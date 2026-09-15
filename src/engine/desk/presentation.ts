/** Small shared output operations used by Desk orchestration modules. */
import { renderCommandCli } from "discern-design-system/cli";
import { terminalLine } from "../../lib/terminal.ts";
import type { Out } from "../output.ts";

/** Render the copyable CLI equivalent of an action about to run. */
export function echoDeskCommand(out: Out, command: string): void {
  out.raw(`${
    out.terminal.presenter.present(renderCommandCli, {
      command: terminalLine(command),
    })
  }\n`);
}
