/**
 * Command-surface hints: failure recovery, documentation lookup, unknown
 * commands, and MCP session currency. Entries are registered here and fired
 * only through `HINTS` in `../hints.ts`.
 */

import { discernCommand, flag } from "../command_reference.ts";
import { worktreeContinuityPolicy } from "../operating_policies.ts";
import { CMD, defineHint, restartSessionHint } from "./define.ts";

/** The commands catalog, keyed by hint id. */
export const COMMAND_HINTS = {
  "result-completion-failed": defineHint<{ verb: string }>({
    id: "result-completion-failed",
    category: "next-step",
    audience: "all",
    when: "A reported success fails its required result completion contract.",
    example: { verb: "accept" },
    template: ({ verb }): string =>
      `Inspect the preserved effects and failure reported by discern ${verb}. Run discern status in the affected project and follow any recorded recovery action. Report the inconsistent result as a defect; do not repeat an effectful command merely to obtain its output.`,
  }),

  /**
   * Registered fallback for a failure whose domain-specific recovery has not
   * supplied a narrower hint. The serialization invariant makes this an
   * actionable floor, not the preferred ceiling for tailored remedies.
   */
  "failure-recovery": defineHint<{ verb: string }>({
    id: "failure-recovery",
    category: "next-step",
    audience: "all",
    when:
      "A failed result has no more specific registered recovery instruction.",
    family: "failure-recovery",
    example: { verb: "doctor" },
    template: (): string =>
      "Use this result's message or first diagnostic to correct the reported problem before retrying.",
  }),

  /** A docs/map ambiguity can only recover by selecting one exact candidate. */
  "docs-choose-candidate": defineHint({
    id: "docs-choose-candidate",
    category: "next-step",
    audience: "all",
    when: "A docs or map target resolves to more than one entry.",
    family: "docs-recovery",
    example: undefined,
    template: (): string =>
      "Choose one exact path from the listed candidates, then re-run the same command with that path as its target.",
    interactiveTemplate: (): string =>
      "Choose one exact path from the listed candidates, then re-run the same " +
      "command with that path as its target.",
  }),

  /** A missing docs/map target recovers through structured suggestions or the
   * verb's index, rather than by guessing from a message alone. */
  "docs-find-target": defineHint({
    id: "docs-find-target",
    category: "next-step",
    audience: "all",
    when: "A docs or map target does not resolve.",
    family: "docs-recovery",
    example: undefined,
    template: (): string =>
      "Use an exact suggested path when one is listed; otherwise run the same command without a target to inspect its index, then retry with one returned path.",
    interactiveTemplate: (): string =>
      "Use an exact suggested path when one is listed; otherwise run the same " +
      "command without a target to inspect its index, then retry with one " +
      "returned path.",
  }),

  /** The optional canonical suggestion in an unknown-command refusal. */
  "unknown-command-suggestion": defineHint<{ command: string }>({
    id: "unknown-command-suggestion",
    category: "next-step",
    audience: "all",
    when: "An unknown command has a canonical suggestion.",
    family: "unknown-command",
    example: { command: "status" },
    template: ({ command }): string =>
      `Did you mean ${discernCommand(command)}?`,
  }),

  /** The standing documentation pointer closing every unknown-command refusal. */
  "unknown-command-help": defineHint({
    id: "unknown-command-help",
    category: "next-step",
    audience: "all",
    when: "An unknown command refusal needs its documentation route.",
    family: "unknown-command",
    example: undefined,
    template: (): string =>
      `Run ${discernCommand("docs")} for the documentation, or ${
        discernCommand("", flag("help"))
      } to list the commands.`,
  }),

  /**
   * The MCP-specific start re-root guardrail. It distinguishes the server's
   * automatic tool re-aim from the file operations the connected agent must
   * move, gives the fallback for a fixed working root, and names the split-state
   * consequence.
   * Agent-audience: it fires only over MCP and instructs the connected agent.
   */
  "start-mcp-re-root": defineHint<{ path: string }>({
    id: "start-mcp-re-root",
    category: "guardrail",
    audience: "agent",
    delivery: "mcp",
    when:
      "`start` runs through the Model Context Protocol and the connected agent must re-root before editing.",
    family: "start-result",
    example: { path: "/workspace/project.worktrees/hint-registry" },
    template: ({ path }): string =>
      `${
        worktreeContinuityPolicy(CMD.start)
      } Re-root or cd into ${path} before ` +
      `editing. discern's MCP tools already ` +
      `target this worktree. \`discern_done\`, \`discern_update\`, and ` +
      `\`discern_accept\` follow it automatically. If you can't change your ` +
      `working root, prefix every shell command with ` +
      `\`cd ${path} && …\` and pass \`path="${path}"\` to every discern MCP tool. ` +
      `Otherwise, edits land on the trunk while the gate runs in the worktree, ` +
      `and the two states diverge.`,
  }),

  /**
   * Version-mismatch lead-in to the shared restart-session lifecycle fact. It keeps
   * the cross-build rewrite risk explicit until the caller restarts.
   */
  "mcp-version-mismatch": defineHint<{
    serverVersion: string;
    installedVersion: string;
  }>({
    id: "mcp-version-mismatch",
    category: "next-step",
    audience: "all",
    delivery: "mcp",
    when:
      "The running Model Context Protocol server version differs from the installed build.",
    family: "restart-session",
    example: { serverVersion: "1.4.0", installedVersion: "1.5.0" },
    template: ({ serverVersion, installedVersion }): string =>
      restartSessionHint(
        `Restart your agent session or reload its MCP servers to replace MCP ` +
          `server v${serverVersion} with installed v${installedVersion}. Until ` +
          `then, its results can conflict with the current CLI and rewrite ` +
          `generated files from different builds.`,
      ),
  }),
} as const;
