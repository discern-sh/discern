/**
 * Public JSON result contracts for `discern <command> --json` and MCP tool
 * `structuredContent`.
 *
 * `result_schemas.ts` owns the runtime Zod shapes. This registry is the published
 * surface index: each JSON-emitting command path points at its schema, and MCP tools
 * name the same schema because the server returns the same serialized
 * `DiscernResult` object in `structuredContent`.
 */

import type { z } from "@zod/zod";
import {
  AcceptOutputSchema,
  ConfigOutputSchema,
  CouplingOutputSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  HelpOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  PrepareOutputSchema,
  PresetOutputSchema,
  RatchetsOutputSchema,
  RefreshOutputSchema,
  SetupAcceptOutputSchema,
  SetupDoneOutputSchema,
  SetupOutputSchema,
  SetupStepOutputSchema,
  SetupVerifyOutputSchema,
  SkillsEjectOutputSchema,
  SkillsListOutputSchema,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  UninstallOutputSchema,
  UpdateOutputSchema,
  UpgradeOutputSchema,
  WorktreeDropOutputSchema,
  WorktreePruneOutputSchema,
  WorktreeSetupOutputSchema,
  WorktreeTeardownOutputSchema,
} from "./result_schemas.ts";

export interface ResultContract {
  /** Stable id used for generated `$defs` and TypeScript type names. */
  id: string;
  /** Human CLI command paths that emit this result shape. */
  commands: readonly string[];
  /** The verb literal carried in the serialized envelope. */
  verb: string;
  /** Runtime schema for the serialized `DiscernResult`. */
  schema: z.ZodType;
  /** MCP tool name when this same result is exposed over MCP. */
  mcpTool?: string | undefined;
}

export const CLI_JSON_RESULT_CONTRACTS: readonly ResultContract[] = [
  {
    id: "setup",
    commands: ["setup", "setup begin"],
    verb: "setup",
    schema: SetupOutputSchema,
  },
  {
    id: "setupVerify",
    commands: ["setup verify"],
    verb: "setup verify",
    schema: SetupVerifyOutputSchema,
  },
  {
    id: "setupStep",
    commands: ["setup step"],
    verb: "setup step",
    schema: SetupStepOutputSchema,
  },
  {
    id: "setupDone",
    commands: ["setup done"],
    verb: "setup done",
    schema: SetupDoneOutputSchema,
  },
  {
    id: "setupAccept",
    commands: ["setup accept"],
    verb: "setup accept",
    schema: SetupAcceptOutputSchema,
  },
  {
    id: "upgrade",
    commands: ["upgrade"],
    verb: "upgrade",
    schema: UpgradeOutputSchema,
  },
  {
    id: "uninstall",
    commands: ["uninstall"],
    verb: "uninstall",
    schema: UninstallOutputSchema,
  },
  {
    id: "doctor",
    commands: ["doctor"],
    verb: "doctor",
    schema: DoctorOutputSchema,
    mcpTool: "discern_doctor",
  },
  {
    id: "preset",
    commands: ["preset"],
    verb: "preset",
    schema: PresetOutputSchema,
  },
  {
    id: "docs",
    commands: ["docs"],
    verb: "docs",
    schema: DocsOutputSchema,
    mcpTool: "discern_docs",
  },
  {
    id: "help",
    commands: ["help"],
    verb: "help",
    schema: HelpOutputSchema,
    mcpTool: "discern_help",
  },
  {
    id: "config",
    commands: [
      "config set-capability",
      "config set-check",
      "config set-scope",
      "config set-ratchet",
      "config set",
    ],
    verb: "config",
    schema: ConfigOutputSchema,
  },
  {
    id: "done",
    commands: ["done"],
    verb: "done",
    schema: FinishOutputSchema,
    mcpTool: "discern_done",
  },
  {
    id: "prepare",
    commands: ["prepare"],
    verb: "prepare",
    schema: PrepareOutputSchema,
    mcpTool: "discern_prepare",
  },
  {
    id: "test",
    commands: ["test"],
    verb: "test",
    schema: TestOutputSchema,
    mcpTool: "discern_test",
  },
  {
    id: "improvement",
    commands: ["improvement"],
    verb: "improvement",
    schema: ImprovementOutputSchema,
    mcpTool: "discern_improvement",
  },
  {
    id: "ratchets",
    commands: ["ratchets"],
    verb: "ratchets",
    schema: RatchetsOutputSchema,
    mcpTool: "discern_ratchets",
  },
  {
    id: "refresh",
    commands: ["refresh"],
    verb: "refresh",
    schema: RefreshOutputSchema,
    mcpTool: "discern_refresh",
  },
  {
    id: "impact",
    commands: ["impact"],
    verb: "impact",
    schema: ImpactOutputSchema,
    mcpTool: "discern_impact",
  },
  {
    id: "coupling",
    commands: ["coupling"],
    verb: "coupling",
    schema: CouplingOutputSchema,
    mcpTool: "discern_coupling",
  },
  {
    id: "status",
    commands: ["status"],
    verb: "status",
    schema: StatusOutputSchema,
    mcpTool: "discern_status",
  },
  {
    id: "start",
    commands: ["start"],
    verb: "start",
    schema: StartOutputSchema,
    mcpTool: "discern_start",
  },
  {
    id: "accept",
    commands: ["accept"],
    verb: "accept",
    schema: AcceptOutputSchema,
    mcpTool: "discern_accept",
  },
  {
    id: "update",
    commands: ["update"],
    verb: "update",
    schema: UpdateOutputSchema,
    mcpTool: "discern_update",
  },
  {
    id: "worktreeSetup",
    commands: ["worktree setup"],
    verb: "worktree setup",
    schema: WorktreeSetupOutputSchema,
  },
  {
    id: "worktreeTeardown",
    commands: ["worktree teardown"],
    verb: "worktree teardown",
    schema: WorktreeTeardownOutputSchema,
  },
  {
    id: "worktreeDrop",
    commands: ["worktree drop"],
    verb: "worktree drop",
    schema: WorktreeDropOutputSchema,
  },
  {
    id: "worktreePrune",
    commands: ["worktree prune"],
    verb: "worktree prune",
    schema: WorktreePruneOutputSchema,
  },
  {
    id: "skillsList",
    commands: ["skills list"],
    verb: "skills list",
    schema: SkillsListOutputSchema,
  },
  {
    id: "skillsEject",
    commands: ["skills eject"],
    verb: "skills eject",
    schema: SkillsEjectOutputSchema,
  },
] as const;

/** CLI commands that intentionally do not emit a public `DiscernResult` JSON object. */
export const CLI_JSON_CONTRACT_EXCLUSIONS = [
  "mcp",
  "identity",
  // The interactive human surface: `--json` gets only a structured
  // `interactive_only` refusal, never a data contract (ADR 0119).
  "desk",
  "config",
  "worktree",
  "worktree ensure",
  "worktree create",
  "worktree remove",
  "skills",
  "config get",
  "config array",
  "config has",
  "config subsections",
  "config keys",
] as const;

export const MCP_RESULT_CONTRACTS = CLI_JSON_RESULT_CONTRACTS.filter(
  (contract): contract is ResultContract & { mcpTool: string } =>
    contract.mcpTool !== undefined,
);
