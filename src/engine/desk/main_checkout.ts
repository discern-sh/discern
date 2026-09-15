/** Main-checkout diagnosis and bounded recent-completion views. */

import type { StatusData } from "../../shared/result_schemas.ts";
import { deskLiteral } from "./reading.ts";
import { isInteractionCancelled } from "../../lib/terminal_interaction.ts";
import type { Out } from "../output.ts";
import { userShell } from "../user_shell.ts";
import type { DeskRuntime } from "./desk.ts";
import { echoDeskCommand } from "./presentation.ts";
import { deskSessionEnv } from "./session.ts";
import { DESK_ROUTES } from "./view.ts";

/** Inspect and enter main without presenting it as agent-owned task work. */
export async function actOnMainCheckout(
  out: Out,
  root: string,
  data: StatusData,
  runtime: DeskRuntime,
): Promise<void> {
  while (true) {
    let action: string;
    try {
      action = await runtime.screen({
        title: "Main checkout",
        source: `${deskLiteral(root)}\n\nBranch: ${
          deskLiteral(data.git?.branch ?? "unknown")
        }\n\nInspect shared project state here. Start task work in its own worktree.`,
        actions: [
          { id: "back", label: "Back" },
          { id: "inspect", label: "Inspect status and diff" },
          { id: "shell", label: "Open a shell at main" },
          { id: "editor", label: "Open an editor at main" },
        ],
      });
    } catch (error) {
      if (!isInteractionCancelled(error)) throw error;
      return;
    }
    if (action === "back" || action === DESK_ROUTES.back) return;
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
          } Repair the reported Git state, then refresh the desk.`,
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
      out.info("Exit the shell to return to the desk.");
      const code = await runtime.interactive(
        shell,
        [],
        root,
        deskSessionEnv(),
        "desk shell",
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
  root: string,
  data: StatusData,
  runtime: Pick<DeskRuntime, "screen" | "git" | "landedProof">,
): Promise<void> {
  const tasks = data.recent_completed_tasks ?? [];
  while (true) {
    const choice = await runtime.screen({
      title: "Recent completed tasks",
      source: tasks.map((task) =>
        `### ${deskLiteral(task.branch)}\n\n${
          deskLiteral(task.head ?? "Revision unavailable")
        } · ${deskLiteral(task.completed_at)}\n\n${
          task.proof_line ?? "No Proof line recorded."
        }`
      ).join("\n\n") || "No completed tasks are recorded.",
      actions: [
        { id: "back", label: "Back" },
        ...tasks.map((task, index) => ({
          id: String(index),
          label: `${task.branch} · ${task.head ?? "unknown revision"}`,
          description: "Read the complete stored Proof and landing evidence",
          ...(task.head === undefined ? { disabled: true } : {}),
        })),
      ],
    });
    if (choice === "back" || choice === DESK_ROUTES.back) return;
    const task = tasks[Number(choice)];
    if (task?.head === undefined) continue;
    const resolved = await runtime.git([
      "rev-parse",
      "--verify",
      `${task.head}^{commit}`,
    ], root);
    if (!resolved.success) {
      await runtime.screen({
        title: "Stored Proof unavailable",
        source: deskLiteral(
          resolved.stderr || "The recorded revision could not be resolved.",
        ),
      });
      continue;
    }
    const record = await runtime.landedProof(root, resolved.stdout.trim());
    await runtime.screen({
      title: `Stored Proof · ${task.branch}`,
      source: record.status === "valid"
        ? [
          record.proof.markdown,
          ...(record.acceptance === undefined ? [] : [
            "## Landing evidence",
            "```json\n" + JSON.stringify(record.acceptance, null, 2) +
            "\n```",
          ]),
        ].join("\n\n")
        : `Stored record: ${record.status}.${
          "reason" in record ? ` ${deskLiteral(record.reason)}` : ""
        }${
          record.status === "unsupported"
            ? ` This build cannot read format ${deskLiteral(record.format)}.`
            : ""
        }`,
    });
  }
}
