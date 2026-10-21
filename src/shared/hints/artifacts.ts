/**
 * Generated-artifact hints: currency drift in agent files, materialized skills,
 * provider integrations, and tracked refresh output, plus `discern refresh` and
 * `discern skills` results. Entries are registered here and fired only through
 * `HINTS` in `../hints.ts`.
 */

import { discernCommand } from "../command_reference.ts";
import { productSentence } from "../product_sentence.ts";
import {
  CMD,
  defineHint,
  generatedDriftHint,
  restartSessionHint,
  unsourcedAgentLineChoices,
} from "./define.ts";

/** The artifacts catalog, keyed by hint id. */
export const ARTIFACT_HINTS = {
  /**
   * discern-owned ignored artifacts are tracked despite the managed ignore
   * contract. The caller supplies the canonical path summary and repair command.
   */
  "tracked-ignored-artifacts": defineHint<{
    pathSummary: string;
    repairCommand: string;
  }>({
    id: "tracked-ignored-artifacts",
    category: "next-step",
    audience: "all",
    when: "Git tracks discern-managed ignored artifacts.",
    example: {
      pathSummary: ".claude/skills/discern-write-adr",
      repairCommand: "git rm -r --cached -- .claude/skills/discern-write-adr",
    },
    template: ({ pathSummary, repairCommand }): string =>
      `Run \`${repairCommand}\` to remove the discern-managed ignored artifacts ` +
      `from the Git index, then run ${CMD.refresh}. Affected paths: ${pathSummary}.`,
  }),

  /**
   * Compiled instruction files are present but untracked and not ignored. Committing
   * them puts the same instructions in reach of agents reading a fresh clone.
   */
  "untracked-agent-files": defineHint<{ paths: readonly string[] }>({
    id: "untracked-agent-files",
    category: "next-step",
    audience: "all",
    when: "Generated agent files are untracked and not ignored.",
    example: { paths: ["AGENTS.md", "CLAUDE.md"] },
    template: ({ paths }): string =>
      `Commit the untracked agent files (${
        paths.join(", ")
      }) so cloud and out-of-tool agents read the same instructions from a fresh clone.`,
  }),

  /** Missing agent-file context for the shared generated-drift remedy. */
  "generated-agent-files-missing": defineHint<{ paths: string }>({
    id: "generated-agent-files-missing",
    category: "next-step",
    audience: "all",
    when: "A generated agent file is missing.",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(`Agent files are missing (${paths}).`),
  }),

  /** Stale agent-file context plus its authored-source instruction. */
  "generated-agent-files-stale": defineHint<{ paths: string }>({
    id: "generated-agent-files-stale",
    category: "next-step",
    audience: "all",
    when: "A generated agent file differs from its authored sources.",
    family: "generated-drift",
    example: { paths: "AGENTS.md, CLAUDE.md" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Agent files are out of date (${paths}).`,
        "Make intended instructions changes in [instructions].sources. Refresh overwrites agent files.",
      ),
  }),

  /** Agent files hold lines a refresh would discard because no source makes them. */
  "generated-agent-files-unsourced": defineHint<{ paths: string }>({
    id: "generated-agent-files-unsourced",
    category: "next-step",
    audience: "all",
    when:
      "A generated agent file holds lines that no instruction source produces.",
    family: "generated-drift",
    example: { paths: "AGENTS.md" },
    template: ({ paths }): string =>
      `Agent files hold lines that no instruction source produces (${paths}), and a refresh discards them. ${
        unsourcedAgentLineChoices(`run ${CMD.refresh} to discard them.`)
      }`,
  }),

  /** Missing materialized-skills context for the shared generated-drift remedy. */
  "materialized-skills-missing": defineHint<{ dirs: string }>({
    id: "materialized-skills-missing",
    category: "next-step",
    audience: "all",
    when: "A materialized skill directory is missing.",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(`Materialized skills are missing (${dirs}).`),
  }),

  /** Stale materialized-skills context plus its authored-source instruction. */
  "materialized-skills-stale": defineHint<{ dirs: string }>({
    id: "materialized-skills-stale",
    category: "next-step",
    audience: "all",
    when: "A materialized skill differs from its authored source.",
    family: "generated-drift",
    example: { dirs: ".claude/skills" },
    template: ({ dirs }): string =>
      generatedDriftHint(
        `Materialized skills are out of date (${dirs}).`,
        "Make intended skill changes in [skills].dir. Refresh overwrites the materialized copies.",
      ),
  }),

  /**
   * An entry discern did not place holds a name discern needs in a shared
   * skills directory. Refresh refuses to replace it, so the remedy is a choice
   * about which side keeps the name.
   */
  "materialized-skills-conflict": defineHint<{ details: string }>({
    id: "materialized-skills-conflict",
    category: "next-step",
    audience: "all",
    when:
      "An entry discern did not place holds a name discern needs in a skills directory.",
    example: {
      details:
        ".claude/skills/notes exists and discern did not place it, so discern will not replace it with the authored skill of the same name",
    },
    template: ({ details }): string =>
      `discern left entries it did not place untouched, although it needs their names: ${details}. Free each name, then run ${CMD.refresh}: rename the other entry, or rename the discern-side skill under [skills].dir or list it in [skills].exclude. Delete an entry that is an earlier copy of discern's own output. Move the rules from an ignore file discern did not write into the root .gitignore, then delete that file.`,
  }),

  /** Missing provider-integration context for the shared generated-drift remedy. */
  "provider-integrations-missing": defineHint<{ paths: string }>({
    id: "provider-integrations-missing",
    category: "next-step",
    audience: "all",
    when: "A provider integration file is missing.",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Provider integration files are missing (${paths}).`,
      ),
  }),

  /** Provider-integration drift context plus its malformed-file recovery. */
  "provider-integrations-stale": defineHint<{ paths: string }>({
    id: "provider-integrations-stale",
    category: "next-step",
    audience: "all",
    when: "A provider integration file is stale or malformed.",
    family: "generated-drift",
    example: { paths: ".codex/config.toml" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Provider integration files need attention (${paths}).`,
        `If refresh reports a malformed settings file, repair it and run ${CMD.refresh} again.`,
      ),
  }),

  /** Stale maintained-ADR-index context for the shared generated-drift remedy. */
  "adr-index-stale": defineHint<{ path: string }>({
    id: "adr-index-stale",
    category: "next-step",
    audience: "all",
    when:
      "The maintained ADR index no longer matches the record files on disk.",
    family: "generated-drift",
    example: { path: "docs/_adr/README.md" },
    template: ({ path }): string =>
      generatedDriftHint(
        `The ADR index is out of date (${path}).`,
        "Edit the ADR records that own these entries. Refresh rewrites the generated lists between the markers.",
      ),
  }),

  /** Tracked refresh effects not covered by one of the focused stale hints. */
  "tracked-refresh-pending": defineHint<{ paths: string }>({
    id: "tracked-refresh-pending",
    category: "next-step",
    audience: "all",
    when: "The read-only refresh plan would change tracked project files.",
    family: "generated-drift",
    example: { paths: ".gitattributes, .mcp.json" },
    template: ({ paths }): string =>
      generatedDriftHint(
        `Tracked refresh artifacts are out of date (${paths}).`,
      ),
  }),

  /** A read-only tracked refresh transformation could not be derived. */
  "tracked-refresh-plan-failed": defineHint<{ reason: string }>({
    id: "tracked-refresh-plan-failed",
    category: "next-step",
    audience: "all",
    when: "Status cannot derive the tracked refresh plan.",
    family: "generated-drift",
    example: { reason: "could not read .mcp.json" },
    template: ({ reason }): string =>
      `${
        productSentence(
          `Tracked refresh convergence could not be checked: ${reason}`,
        )
      } Repair the named input, run ${CMD.refresh}, then run ${CMD.status} again.`,
  }),

  /**
   * First-registration lead-in to the shared restart-session lifecycle fact.
   */
  "refresh-mcp-first-install": defineHint({
    id: "refresh-mcp-first-install",
    category: "next-step",
    audience: "all",
    when:
      "`refresh` registers the Model Context Protocol server for the first time.",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "Restart your coding agent now, or reload its MCP servers, before trying to use the discern tools. This refresh registered the server for the first time, and the registration persists after restart.",
      ),
  }),

  /** First registration during setup defers reactivation until Proof and landing. */
  "refresh-mcp-setup-deferred": defineHint({
    id: "refresh-mcp-setup-deferred",
    category: "guardrail",
    audience: "all",
    when:
      "Instruction refresh first registers the Model Context Protocol server while setup is unfinished.",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      "Continue setup in this session; do not restart now. The completion handoff will ask you to start a fresh session only after setup is proved and landed, then give the exact activation check.",
  }),

  /**
   * A successful refresh changed one or more tracked Agent files or Shared files.
   * The changed paths stay in `data`; this hint carries only the commit action.
   */
  "refresh-commit-tracked-artifacts": defineHint({
    id: "refresh-commit-tracked-artifacts",
    category: "next-step",
    audience: "all",
    when: "`refresh` changes tracked generated artifacts.",
    family: "refresh-result",
    example: undefined,
    template: (): string =>
      "Commit the refreshed copies with the source change that produced them.",
  }),

  /** A partial refresh reports each failed artifact with the correction and
   * the command that converges the full set again. */
  "refresh-artifact-failed": defineHint<{ message: string }>({
    id: "refresh-artifact-failed",
    category: "next-step",
    audience: "all",
    when: "`refresh` cannot reconcile one of its managed artifacts.",
    family: "refresh-result",
    example: { message: "could not update a co-owned agent config" },
    template: ({ message }): string =>
      `Fix the refresh error, then run ${CMD.refresh}: ${message}`,
  }),

  /** A refresh overwrote agent files and discarded lines no source produces.
   * The per-file counts and previews also ride the result's data. */
  "refresh-agent-files-discarded": defineHint<{ files: string }>({
    id: "refresh-agent-files-discarded",
    category: "notice",
    audience: "all",
    when:
      "A refresh overwrites agent-file lines that no instruction source produces.",
    family: "refresh-result",
    example: { files: "AGENTS.md (6 lines, first `## Tool notes`)" },
    template: ({ files }): string =>
      `Refresh removed lines that no instruction source produces from ${files}. ${
        unsourcedAgentLineChoices("nothing more is needed.")
      }`,
  }),

  /** A successful skills eject leaves the authored override ready to edit. */
  "skills-eject-edit-override": defineHint({
    id: "skills-eject-edit-override",
    category: "next-step",
    audience: "all",
    when: "`skills eject` creates an authored override.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("skills list")
      } to locate the authored override, then edit that source.`,
  }),

  /** Ejection succeeded, but one or more configured agent directories still
   * need the override materialized. */
  "skills-eject-finish-materialization": defineHint({
    id: "skills-eject-finish-materialization",
    category: "next-step",
    audience: "all",
    when:
      "`skills eject` writes the override but cannot materialize it everywhere.",
    family: "skills-eject-recovery",
    example: undefined,
    template: (): string =>
      `Fix every reported materialization error, then run ${CMD.refresh} ` +
      "to materialize the ejected skill in every configured agent directory.",
    interactiveTemplate: (): string =>
      `Fix every reported materialization error, then run ${CMD.refresh} ` +
      "to materialize the ejected skill in every configured agent directory.",
  }),
} as const;
