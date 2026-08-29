/** Main-checkout diagnosis and bounded recent-completion views. */

import type { StatusData } from "../../shared/result_schemas.ts";
import { terminalContextAtSize } from "../../lib/terminal.ts";
import {
  groupedSelectionEntries,
  isInteractionCancelled,
} from "../../lib/terminal_interaction.ts";
import type { Out } from "../output.ts";
import { userShell } from "../user_shell.ts";
import type { DeskRuntime } from "./desk.ts";
import { clearDeskBoard, echoDeskCommand } from "./presentation.ts";
import { deskSessionEnv } from "./session.ts";
import {
  DESK_ROUTES,
  deskCompositionReserveRows,
  renderDeskMainCheckoutDetail,
  renderDeskRecentCompleted,
} from "./view.ts";

/** Inspect and enter main without presenting it as agent-owned task work. */
export async function actOnMainCheckout(
  out: Out,
  root: string,
  data: StatusData,
  runtime: DeskRuntime,
): Promise<void> {
  clearDeskBoard(out);
  const viewport = runtime.size();
  const terminal = terminalContextAtSize(out.terminal, viewport);
  const detail = renderDeskMainCheckoutDetail(data, viewport, terminal);
  out.raw(`${detail.text}\n`);
  while (true) {
    let action: string;
    try {
      action = await runtime.select({
        message: "Choose a main checkout action",
        options: groupedSelectionEntries([{
          id: "main-inspection",
          label: "Main checkout",
          items: [{
            name: "Inspect status and diff",
            description: "Read local Git changes without changing main.",
            value: "inspect",
          }, {
            name: "Open a shell at main",
            description: "Exit the shell to return to the Desk.",
            value: "shell",
          }, {
            name: "Open an editor at main",
            description:
              "Use the configured editor without starting agent work.",
            value: "editor",
          }],
        }, {
          id: "main-navigation",
          label: "Desk",
          items: [{ name: "Back", value: DESK_ROUTES.back }],
        }]),
        reservedRows: deskCompositionReserveRows(detail.rows, viewport.rows),
      });
    } catch (error) {
      if (!isInteractionCancelled(error)) throw error;
      return;
    }
    if (action === DESK_ROUTES.back) return;
    if (action === "inspect") {
      const [status, diff] = await Promise.all([
        runtime.git(["status", "--short", "--branch"], root),
        runtime.git(["diff", "--stat", "HEAD"], root),
      ]);
      if (!status.success || !diff.success) {
        const failed = !status.success ? status : diff;
        const command = !status.success
          ? "git status --short --branch"
          : "git diff --stat HEAD";
        out.warn(
          `${command} failed in ${root}: ${
            failed.stderr.trim() || "Git returned no diagnostic."
          } Repair the reported Git state, then refresh the Desk.`,
        );
        await runtime.pause(out);
        continue;
      }
      const page = [
        "# Main checkout",
        "",
        "Command: git status --short --branch",
        "",
        status.stdout.trim() || "No local changes.",
        "",
        "Command: git diff --stat HEAD",
        "",
        diff.stdout.trim() || "No tracked diff.",
      ].join("\n");
      const shown = await runtime.pager(page);
      if (!shown.shown) {
        out.warn("The pager could not open the main checkout review.");
        await runtime.pause(out);
      }
      continue;
    }
    if (action === "shell") {
      const shell = userShell();
      echoDeskCommand(out, `${shell}  (cwd: ${root})`);
      out.info("Exit the shell to return to the Desk.");
      const code = await runtime.interactive(
        shell,
        [],
        root,
        deskSessionEnv(),
      );
      if (code !== 0) {
        out.warn(`Shell exited with status ${code}.`);
        await runtime.pause(out);
      }
      continue;
    }
    const editor = await runtime.editor(root);
    if (editor.editor === undefined) {
      out.warn(editor.reason ?? "No editor is available.");
      await runtime.pause(out);
      continue;
    }
    echoDeskCommand(out, `${editor.editor.command} .  (cwd: ${root})`);
    const code = await runtime.openEditor(editor.editor, root);
    if (code !== 0) {
      out.warn(`Editor exited with status ${code}.`);
      await runtime.pause(out);
    }
  }
}

/** Show the bounded local completion tail and return to the root picker. */
export async function showRecentCompleted(
  out: Out,
  data: StatusData,
  runtime: DeskRuntime,
): Promise<void> {
  clearDeskBoard(out);
  const viewport = runtime.size();
  const terminal = terminalContextAtSize(out.terminal, viewport);
  const detail = renderDeskRecentCompleted(data, viewport, terminal);
  out.raw(`${detail.text}\n`);
  await runtime.pause(out);
}
