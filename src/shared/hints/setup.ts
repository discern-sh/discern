/**
 * Installation hints: setup, doctor, upgrade, and configuration. Entries are
 * registered here and fired only through `HINTS` in `../hints.ts`.
 */

import { SOURCE_PATHS } from "../paths_registry.ts";
import {
  type CommandRef,
  discernCommand,
  flag,
  positional,
} from "../command_reference.ts";
import { productSentence } from "../product_sentence.ts";
import {
  CMD,
  defineHint,
  restartSessionHint,
  rootSectionList,
  setupUnfinishedHint,
} from "./define.ts";

/** The setup catalog, keyed by hint id. */
export const SETUP_HINTS = {
  /** Setup's refresh core reports each failed artifact with its next action. */
  "setup-refresh-artifact-failed": defineHint<{ message: string }>({
    id: "setup-refresh-artifact-failed",
    category: "next-step",
    audience: "all",
    when: "Setup cannot refresh one of its generated artifacts.",
    family: "setup-refresh",
    example: { message: "could not write .codex/config.toml" },
    template: ({ message }): string =>
      `Fix the setup refresh error, then run ${CMD.refresh}: ${message}`,
  }),

  /** A flag-less setup begin re-serves the full consent exchange and exact
   * attested continuation in structured fields. */
  "setup-awaiting-confirmation": defineHint<{ command: CommandRef }>({
    id: "setup-awaiting-confirmation",
    category: "next-step",
    audience: "all",
    when: "`setup begin` has no conversation-consent attestation.",
    family: "setup-consent",
    example: {
      command: discernCommand(
        "setup begin",
        flag("model", "unreported"),
        flag("confirmed"),
      ),
    },
    template: ({ command }): string =>
      "Present the setup instructions in this result to the owner, wait for their " +
      `answers, then run ${command}; its \`--confirmed\` flag attests that ` +
      "the relay carried the lasting outcome, exact footprint, repository boundary, provider permissions, plan, reversibility, " +
      "why the setup model affects future sessions, how the owner switches in " +
      "a fresh session, the current self-declared provider/model fact, the " +
      "agent's stop/continue boundary, every numbered confirmation, and the " +
      "time-and-tokens expectation.",
    interactiveTemplate: (): string =>
      "Review the setup instructions and answer its questions, then run the " +
      "displayed command only if the owner chose to continue in this session; " +
      "its `--confirmed` flag attests that every listed consent fact, the model " +
      "switch route, current self-declared provider/model fact, stop boundary, " +
      "and every numbered confirmation was carried.",
  }),

  /** `setup begin` found integration files the project's ignore rules
   * exclude and no owner choice for them, so it wrote nothing. */
  "setup-awaiting-ignored-files-choice": defineHint<{
    files: string;
    track: CommandRef;
    keepLocal: CommandRef;
  }>({
    id: "setup-awaiting-ignored-files-choice",
    category: "next-step",
    audience: "all",
    when:
      "`setup begin` finds untracked integration files the project's ignore rules exclude, with no owner choice for them.",
    family: "setup-consent",
    example: {
      files: "`.tool/config.json` (.gitignore:3: .tool/)",
      track: discernCommand(
        "setup begin",
        flag("ignored-integration-files", "track-anyway"),
      ),
      keepLocal: discernCommand(
        "setup begin",
        flag("ignored-integration-files", "keep-local"),
      ),
    },
    template: ({ files, track, keepLocal }): string =>
      `Ask the owner how setup treats the integration files the project's ignore rules exclude (${files}), and wait. ` +
      `Then repeat this \`setup begin\` with its other options unchanged: ${track} commits them anyway, and ${keepLocal} keeps them on this machine. ` +
      `If the owner changes the rule instead, wait for that commit, then run ${
        discernCommand("setup verify")
      }.`,
  }),

  /** Setup completion carries the unfinished files and checks as structured
   * evidence, so its recovery names those fields. */
  "setup-finish-incomplete": defineHint({
    id: "setup-finish-incomplete",
    category: "next-step",
    audience: "all",
    when: "`setup done` finds skeleton markers or unmet completion checks.",
    family: "setup-done-recovery",
    example: undefined,
    template: (): string =>
      `Complete every listed file and unmet check, then re-run ${CMD.setupDone}; ` +
      `use \`--unproven\` only ` +
      "to record completion without that Proof.",
    interactiveTemplate: (): string =>
      `Complete every listed file and unmet check, then re-run ${CMD.setupDone}; ` +
      "use `--unproven` only to record completion without that Proof.",
  }),

  /** Existing authored agent instructions were preserved in the canonical source. */
  "setup-instructions-preserved": defineHint<{
    paths: readonly string[];
    instructionRel: string;
  }>({
    id: "setup-instructions-preserved",
    category: "next-step",
    audience: "all",
    when:
      "Setup migrates existing authored instructions into the canonical source.",
    family: "setup-instructions-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      instructionRel: SOURCE_PATHS.instructions.defaultPath,
    },
    template: ({ paths, instructionRel }): string =>
      `Fold the instructions migrated from ${
        paths.join(", ")
      } into your conventions, then delete the import note from ${instructionRel}. ` +
      `Setup preserved the existing instructions there.`,
  }),

  /** A pre-existing agent file matched discern's own prior compiled output. */
  "setup-instructions-own-render-skipped": defineHint<{
    paths: readonly string[];
    instructionRel: string;
  }>({
    id: "setup-instructions-own-render-skipped",
    category: "notice",
    audience: "all",
    when: "Setup recognizes an agent file as its own prior compiled output.",
    family: "setup-instructions-migration",
    example: {
      paths: ["AGENTS.md", "CLAUDE.md"],
      instructionRel: SOURCE_PATHS.instructions.defaultPath,
    },
    template: ({ paths, instructionRel }): string =>
      `Skipped importing ${
        paths.join(", ")
      } into ${instructionRel}. It matches discern's own compiled output from an ` +
      `earlier setup. ${instructionRel} remains the canonical authored source.`,
  }),

  /** A completed setup on the dedicated setup branch is ready to land. */
  "setup-done-land-dedicated": defineHint<{
    branch: string;
    target: string;
    acceptCommand: CommandRef;
  }>({
    id: "setup-done-land-dedicated",
    category: "next-step",
    audience: "all",
    when: "Setup completes on the dedicated setup branch.",
    family: "setup-done-next",
    example: {
      branch: "discern-setup",
      target: "main",
      acceptCommand: discernCommand("setup accept"),
    },
    template: ({ branch, target, acceptCommand }): string =>
      `Land setup with ${acceptCommand}, or leave it for review. Setup remains ` +
      `on \`${branch}\`; \`${target}\` does not contain it yet.`,
  }),

  /** A setup performed on another feature branch must use the project's normal merge. */
  "setup-done-land-manually": defineHint<{
    branch: string;
    target: string;
    acceptCommand: CommandRef;
    setupBranch: string;
  }>({
    id: "setup-done-land-manually",
    category: "next-step",
    audience: "all",
    when: "Setup completes on another feature branch.",
    family: "setup-done-next",
    example: {
      branch: "feature/project-setup",
      target: "main",
      acceptCommand: discernCommand("setup accept"),
      setupBranch: "discern-setup",
    },
    template: ({ branch, target, acceptCommand, setupBranch }): string =>
      `Merge \`${branch}\` into \`${target}\` your usual way when ready. ` +
      `${acceptCommand} only lands the \`${setupBranch}\` branch.`,
  }),

  /** Provider integrations load at session start, so setup hands off reactivation. */
  "setup-reactivate-tools": defineHint({
    id: "setup-reactivate-tools",
    category: "next-step",
    audience: "all",
    when: "Setup completes but configured providers need session reactivation.",
    family: "setup-done-next",
    example: undefined,
    template: (): string =>
      "Before continuing, follow each provider-specific reactivation step carried with this result. discern's MCP tools, session hooks, and project rules are now wired, but coding agents load them at session start, so this session cannot use them yet:",
  }),

  /** Setup's optional improvement route after provider activation is proved. */
  "setup-improvement-after-activation": defineHint({
    id: "setup-improvement-after-activation",
    category: "next-step",
    audience: "agent",
    when:
      "Landed setup hands off the optional improvement review after activation succeeds.",
    family: "setup-done-next",
    example: undefined,
    template: (): string =>
      `Only after every applicable activation check succeeds, optionally run ${
        discernCommand("improvement", flag("json"))
      } and review the findings with the owner. This optional ongoing work follows completed setup.`,
  }),

  /** Unproven setup completion cannot enter landing or activation. */
  "setup-unproven-needs-proof": defineHint({
    id: "setup-unproven-needs-proof",
    category: "next-step",
    audience: "all",
    when:
      "Setup records an unproven completion event and therefore has no gate Proof.",
    family: "setup-done-next",
    example: undefined,
    template: (): string =>
      `Resolve the incomplete or red setup, commit the correction, then run ${
        discernCommand("setup done")
      } to replace it with a proven completion before landing or activation.`,
  }),

  /**
   * Doctor context for the shared unfinished-setup action. Doctor is a required
   * setup check, but a healthy result does not establish setup completion.
   */
  "setup-unfinished-doctor": defineHint({
    id: "setup-unfinished-doctor",
    category: "guardrail",
    audience: "all",
    when: "`doctor` runs while setup remains incomplete.",
    family: "setup-unfinished",
    example: undefined,
    template: (): string =>
      setupUnfinishedHint(
        `Running ${
          discernCommand("doctor")
        } is a required setup step. A healthy result proves install health only. It does not complete the setup brief or record setup completion.`,
      ),
  }),

  /** A failed install check already carries its specific fix in the report. */
  "doctor-failed-checks": defineHint({
    id: "doctor-failed-checks",
    category: "next-step",
    audience: "all",
    when: "`doctor` reports one or more failed install checks.",
    example: undefined,
    template: (): string =>
      `Apply the fix listed under each failed check, then run ${
        discernCommand("doctor")
      } again.`,
  }),

  /** Default structured doctor stays bounded; the execution model is opt-in. */
  "doctor-execution-model-verbose": defineHint({
    id: "doctor-execution-model-verbose",
    category: "notice",
    audience: "all",
    when:
      "A non-verbose structured doctor result omits the full execution model.",
    family: "doctor-detail",
    example: undefined,
    template: (): string =>
      `The bounded result keeps the per-verb execution model behind ${
        discernCommand("doctor", flag("verbose"), flag("json"))
      }; use it only when that detail is needed.`,
  }),

  /** Upgrade never checks the network, so it names the installed update channel. */
  "upgrade-newer-discern": defineHint<{ updateChannel: string }>({
    id: "upgrade-newer-discern",
    category: "notice",
    audience: "all",
    when: "`upgrade` reports the installed update channel.",
    example: { updateChannel: "run the installer again" },
    template: ({ updateChannel }): string =>
      `${productSentence(`To get a newer discern, ${updateChannel}`)} ` +
      `discern never checks the ` +
      `network for updates.`,
  }),

  /** A stale read-only check names the command that applies its pending work. */
  "upgrade-check-pending": defineHint({
    id: "upgrade-check-pending",
    category: "next-step",
    audience: "all",
    when:
      "`upgrade --check` finds pending migrations or install reconciliation.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("upgrade")
      } to apply pending migrations and reconcile this install.`,
  }),

  /** Post-upgrade lead-in to the shared restart-session lifecycle fact. */
  "upgrade-restart-session": defineHint({
    id: "upgrade-restart-session",
    category: "next-step",
    audience: "all",
    when: "`upgrade` completes while agent sessions still run the old server.",
    family: "restart-session",
    example: undefined,
    template: (): string =>
      restartSessionHint(
        "For every open agent session, restart it so its discern MCP server reloads this build, or reload its MCP servers directly, before continuing. A server process started before the upgrade still runs the old build.",
      ),
  }),

  /** Strict root rejection can mean a typo or a newer config than this process. */
  "config-unknown-root-sections": defineHint<{
    sections: readonly string[];
  }>({
    id: "config-unknown-root-sections",
    category: "next-step",
    audience: "all",
    when: "Strict config loading encounters one or more unknown root sections.",
    family: "restart-session",
    example: { sections: ["checkpoints", "reviews"] },
    template: ({ sections }): string => {
      const noun = sections.length === 1 ? "root section" : "root sections";
      const lifecycle = restartSessionHint(
        `The running discern process does not recognize the ${noun} ${
          rootSectionList(sections)
        }. If discern.toml or discern changed after this process started, the running process is stale. Otherwise, update the discern binary to the build the project expects or correct a likely section typo.`,
      );
      return `${lifecycle} Check ${
        discernCommand(
          "docs",
          positional("target", "config-reference"),
        )
      } and run ${
        discernCommand("doctor")
      } to verify the config and installation before retrying.`;
    },
  }),

  /** Non-root validation failures recover through their named issue paths. */
  "config-correct-validation": defineHint({
    id: "config-correct-validation",
    category: "next-step",
    audience: "all",
    when: "Config validation fails without an unknown root section.",
    family: "config-recovery",
    example: undefined,
    template: (): string =>
      `Correct each path named in the config issues. Check ${
        discernCommand(
          "docs",
          positional("target", "config-reference"),
        )
      }, then run ${
        discernCommand("doctor")
      } to verify the config before retrying.`,
  }),

  /** An empty known-job command records a deliberate deferred gate slot. */
  "config-job-deferred": defineHint<{ name: string }>({
    id: "config-job-deferred",
    category: "next-step",
    audience: "all",
    when: "A known job has an empty command.",
    example: { name: "integration" },
    template: ({ name }): string =>
      `Add an inline # comment explaining why "${name}" is deferred, or set a ` +
      `real command to enforce it. An empty command is present but a no-op, so ` +
      `the gate skips it.`,
  }),
} as const;
