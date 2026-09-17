/** Generated, versioned manifests for discern's frozen v1 registries. */

import { z } from "@zod/zod";
import { buildCli } from "../src/main.ts";
import {
  type CliArg,
  cliCommandModel,
  IMPLICIT_COMMAND_FLAGS,
  IMPLICIT_ROOT_FLAGS,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import { RESOURCES, TOOLS } from "../src/engine/mcp/server.ts";
import {
  CLI_COMPATIBILITY_POLICY,
  CLI_MANIFEST_ID,
  CONVENTIONS_COMPATIBILITY_POLICY,
  CONVENTIONS_MANIFEST_ID,
  MANIFEST_STABILITY_FIELD,
  MCP_TOOLS_COMPATIBILITY_POLICY,
  MCP_TOOLS_MANIFEST_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  type StabilityTier,
} from "../src/shared/public_schemas.ts";
import {
  type ResultContract,
  resultContractForCommand,
  resultContractForMcpTool,
} from "../src/shared/result_contracts.ts";
import {
  DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  DISCERN_ENVIRONMENT_VARIABLES,
  type DiscernEnvironmentVariableDefinition,
  publicEnvironmentVariableDefinitions,
} from "../src/shared/environment_variables.ts";
import { BUNDLED_SKILL_NAMES } from "../src/lib/skills.ts";
import {
  BUILT_IN_CHECKPOINTS,
  CHECKPOINT_WHEN_FIRE_EXIT_CODE,
  CHECKPOINT_WHEN_INPUT_FIELDS,
  CHECKPOINT_WHEN_INPUT_VERSION,
  CHECKPOINT_WHEN_MATCH_LINE_PREFIX,
  CHECKPOINT_WHEN_PASS_EXIT_CODE,
} from "../src/shared/checkpoints.ts";
import { QUESTION_IDS } from "../src/shared/questions.ts";
import { HIDDEN_VERBS } from "../src/shared/hidden_verbs.ts";
import {
  WORKTREE_FIELDS,
  WORKTREE_IDENTITY_FIELDS,
} from "../src/shared/worktree_identity_fields.ts";
import { WORKTREE_IDENTITY_CONTRACT } from "../src/shared/worktree_identity_contract.ts";
import { GIT_CONVENTIONS } from "../src/shared/git_conventions.ts";
import { EXIT_STATUS_REGISTRY } from "../src/shared/exit_codes.ts";
import { DISCERN_METRIC_LINE_PREFIX } from "../src/engine/validation/metrics.ts";
import { PROVIDERS } from "../src/lib/providers.ts";

export type ContractManifest = Readonly<Record<string, unknown>>;

/** One command record in the generated CLI grammar manifest. */
export interface CliManifestCommand {
  path: string[];
  description: string;
  aliases: string[];
  hidden: boolean;
  hidden_when: string | null;
  /** Present only for an evolving command; a stable command carries no tier. */
  stability?: StabilityTier;
  positionals: CliArg[];
  usage: string;
  flags: Array<{
    spellings: string[];
    description: string;
    type_definition: string;
    arity: number;
    value_types: string[];
    default: unknown;
    hidden: boolean;
    global: boolean;
  }>;
}

/** The typed portion of the generated CLI grammar manifest. */
export type CliContractManifest = ContractManifest & {
  commands: CliManifestCommand[];
};

/** Committed artifacts owned by this generator. */
export const CONTRACT_MANIFEST_ARTIFACTS = [
  "schema/discern-mcp-tools.json",
  "schema/discern-cli.json",
  "schema/discern-conventions.json",
] as const;

/** Render one manifest using the repository-wide stable JSON convention. */
export function renderContractManifest(manifest: ContractManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** The stability field a manifest record carries when its contract is evolving. */
function recordStability(
  contract: ResultContract | undefined,
): { stability?: StabilityTier } {
  return contract?.stability === undefined
    ? {}
    : { [MANIFEST_STABILITY_FIELD]: contract.stability };
}

/** Turn an ordered string registry into an append-only object membership map. */
function membership(values: readonly string[]): Record<string, true> {
  return Object.fromEntries(values.map((value) => [value, true]));
}

/** Repository-coordinate subset of the Git registry's mixed concerns. */
function publicGitConventions(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(GIT_CONVENTIONS).filter(([key]) =>
      key !== "bounds" && key !== "no_attribution_effects"
    ),
  );
}

/** Exact request-side payload advertised by `tools/list`, plus every readable resource and template. */
export function buildMcpToolsManifest(): ContractManifest {
  return {
    $id: MCP_TOOLS_MANIFEST_ID,
    format: 1,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: MCP_TOOLS_COMPATIBILITY_POLICY,
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      description: tool.description,
      ...recordStability(resultContractForMcpTool(tool.name)),
      inputSchema: z.toJSONSchema(z.strictObject(tool.inputSchema), {
        io: "input",
      }),
      ...(tool.annotations === undefined
        ? {}
        : { annotations: { ...tool.annotations } }),
    })),
    resources: Object.values(RESOURCES).map((resource) => ({
      name: resource.name,
      kind: resource.kind,
      uri: resource.uri,
    })),
  };
}

/** CLI grammar projected from the fully attached typed command model. */
export function buildCliManifest(): CliContractManifest {
  const commands = [...walkCliCommands(cliCommandModel(buildCli(false)))];
  return {
    $id: CLI_MANIFEST_ID,
    format: 1,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: CLI_COMPATIBILITY_POLICY,
    implicit_flags: {
      command: [...IMPLICIT_COMMAND_FLAGS],
      root: [...IMPLICIT_ROOT_FLAGS],
    },
    commands: commands.map((command) => {
      const top = command.path.length === 1 ? command.path[0] : undefined;
      const hidden = top === undefined ? undefined : HIDDEN_VERBS[top];
      return {
        path: [...command.path],
        description: command.description,
        aliases: [...command.aliases],
        hidden: command.hidden,
        hidden_when: hidden?.when ?? null,
        ...recordStability(resultContractForCommand(command.path.join(" "))),
        positionals: command.args.map((argument) => ({ ...argument })),
        usage: command.usage,
        flags: command.options.map((option) => ({
          spellings: [...option.flags],
          description: option.description,
          type_definition: option.type_definition,
          arity: option.arity,
          value_types: [...option.value_types],
          default: option.default_value,
          hidden: option.hidden,
          global: option.global,
        })),
      };
    }),
  };
}

/** Provider-owned file coordinates and hook event spellings. */
function providerConventions(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([name, provider]) => {
      const mcpFile = provider.mcp.kind === "wired"
        ? provider.mcp.integration.configFile
        : provider.mcp.kind === "pending"
        ? provider.mcp.targetFile
        : undefined;
      const hookEvents = provider.hooks === undefined ? {} : Object.fromEntries(
        provider.hooks.commands.map((command) => [
          command.event,
          command.kind,
        ]),
      );
      return [name, {
        instruction_file: provider.instructionFile.path,
        ...(provider.skillsDir === undefined
          ? {}
          : { skills_directory: provider.skillsDir.path }),
        ...(mcpFile === undefined ? {} : { mcp_file: mcpFile }),
        ...(provider.hooks === undefined
          ? {}
          : { hooks_file: provider.hooks.settingsFile }),
        hook_events: hookEvents,
        ...(provider.worktreeApp === undefined
          ? {}
          : { worktree_app_file: provider.worktreeApp.configFile }),
        ...(provider.projectRules === undefined
          ? {}
          : { project_rules_file: provider.projectRules.rulesFile }),
        local_state_files: Object.fromEntries(
          (provider.localState ?? []).map((entry) => [entry.path, true]),
        ),
      }];
    }),
  );
}

/** Frozen names and values spanning every v1 convention registry. */
export function buildConventionsManifest(
  environmentVariableDefinitions: Readonly<
    Record<string, DiscernEnvironmentVariableDefinition>
  > = DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
): ContractManifest {
  return {
    $id: CONVENTIONS_MANIFEST_ID,
    format: 1,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: CONVENTIONS_COMPATIBILITY_POLICY,
    environment_variables: membership(
      publicEnvironmentVariableDefinitions(environmentVariableDefinitions).map(
        (definition) => definition.name,
      ),
    ),
    bundled_skills: membership(BUNDLED_SKILL_NAMES),
    exit_statuses: Object.fromEntries(
      EXIT_STATUS_REGISTRY.map((entry) => [
        entry.id,
        entry.kind === "exact" ? entry.code : entry.kind,
      ]),
    ),
    script_protocols: {
      metric: {
        line_prefix: DISCERN_METRIC_LINE_PREFIX,
        line_grammar: `${DISCERN_METRIC_LINE_PREFIX} <name> <number>`,
      },
      checkpoint_when: {
        input_environment_variable:
          DISCERN_ENVIRONMENT_VARIABLES.checkpointInput,
        input_version: CHECKPOINT_WHEN_INPUT_VERSION,
        input_fields: [...CHECKPOINT_WHEN_INPUT_FIELDS],
        match_line_prefix: CHECKPOINT_WHEN_MATCH_LINE_PREFIX,
        fire_exit_status: CHECKPOINT_WHEN_FIRE_EXIT_CODE,
        pass_exit_status: CHECKPOINT_WHEN_PASS_EXIT_CODE,
      },
    },
    checkpoints: Object.fromEntries(
      Object.entries(BUILT_IN_CHECKPOINTS).map(([id, checkpoint]) => [
        id,
        checkpoint.question,
      ]),
    ),
    questions: membership(QUESTION_IDS),
    identity: {
      stored_fields: membership(WORKTREE_IDENTITY_FIELDS),
      selectable_fields: membership(WORKTREE_FIELDS),
      derivation: {
        checksum: WORKTREE_IDENTITY_CONTRACT.checksum,
        port_base: WORKTREE_IDENTITY_CONTRACT.portBase,
        port_span: WORKTREE_IDENTITY_CONTRACT.portSpan,
        dns_label_limit: WORKTREE_IDENTITY_CONTRACT.dnsLabelLimit,
        database_inputs: [...WORKTREE_IDENTITY_CONTRACT.databaseInputs],
        branch_inputs: [...WORKTREE_IDENTITY_CONTRACT.branchInputs],
        seed_input: WORKTREE_IDENTITY_CONTRACT.seedInput,
        slug_collision_prefix: WORKTREE_IDENTITY_CONTRACT.slugCollisionPrefix,
      },
    },
    providers: providerConventions(),
    git: publicGitConventions(),
  };
}

/** Render the MCP tools manifest as stable committed JSON. */
export function renderMcpToolsManifest(): string {
  return renderContractManifest(buildMcpToolsManifest());
}

/** Render the CLI grammar manifest as stable committed JSON. */
export function renderCliManifest(): string {
  return renderContractManifest(buildCliManifest());
}

/** Render the conventions manifest as stable committed JSON. */
export function renderConventionsManifest(): string {
  return renderContractManifest(buildConventionsManifest());
}
