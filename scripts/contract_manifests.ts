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
import { MCP_SHELL_ONLY_VERBS, TOOLS } from "../src/engine/mcp/server.ts";
import {
  CLI_COMPATIBILITY_POLICY,
  CLI_MANIFEST_ID,
  CONVENTIONS_COMPATIBILITY_POLICY,
  CONVENTIONS_MANIFEST_ID,
  MCP_TOOLS_COMPATIBILITY_POLICY,
  MCP_TOOLS_MANIFEST_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
} from "../src/shared/public_schemas.ts";
import { DISCERN_ENVIRONMENT_VARIABLE_NAMES } from "../src/shared/environment_variables.ts";
import { BUNDLED_SKILL_NAMES } from "../src/lib/skills.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_NAMESPACE,
} from "../src/shared/git_admin_paths.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";
import { QUESTION_IDS } from "../src/shared/questions.ts";
import { HIDDEN_VERBS } from "../src/shared/hidden_verbs.ts";
import {
  WORKTREE_FIELDS,
  WORKTREE_IDENTITY_FIELDS,
} from "../src/shared/worktree_identity_fields.ts";
import { WORKTREE_IDENTITY_CONTRACT } from "../src/shared/worktree_identity_contract.ts";
import { GIT_CONVENTIONS } from "../src/shared/git_conventions.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { PROVIDERS } from "../src/lib/providers.ts";

export type ContractManifest = Readonly<Record<string, unknown>>;

/** One command record in the generated CLI grammar manifest. */
export interface CliManifestCommand {
  path: string[];
  description: string;
  aliases: string[];
  hidden: boolean;
  hidden_when: string | null;
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

/** Turn an ordered string registry into an append-only object membership map. */
function membership(values: readonly string[]): Record<string, true> {
  return Object.fromEntries(values.map((value) => [value, true]));
}

/** Exact request-side payload advertised by `tools/list`, in live tool order. */
export function buildMcpToolsManifest(): ContractManifest {
  return {
    $id: MCP_TOOLS_MANIFEST_ID,
    format: 1,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: MCP_TOOLS_COMPATIBILITY_POLICY,
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      description: tool.description,
      inputSchema: z.toJSONSchema(z.strictObject(tool.inputSchema), {
        io: "input",
      }),
      ...(tool.annotations === undefined
        ? {}
        : { annotations: { ...tool.annotations } }),
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
        : null;
      const hookEvents = provider.hooks === undefined ? {} : Object.fromEntries(
        provider.hooks.commands.map((command) => [
          command.event,
          command.kind,
        ]),
      );
      return [name, {
        instruction_file: provider.instructionFile.path,
        skills_directory: provider.skillsDir?.path ?? null,
        mcp_file: mcpFile,
        hooks_file: provider.hooks?.settingsFile ?? null,
        hook_events: hookEvents,
        worktree_app_file: provider.worktreeApp?.configFile ?? null,
        project_rules_file: provider.projectRules?.rulesFile ?? null,
        local_state_files: Object.fromEntries(
          (provider.localState ?? []).map((entry) => [entry.path, true]),
        ),
      }];
    }),
  );
}

/** Frozen names and values spanning every v1 convention registry. */
export function buildConventionsManifest(): ContractManifest {
  return {
    $id: CONVENTIONS_MANIFEST_ID,
    format: 1,
    [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: CONVENTIONS_COMPATIBILITY_POLICY,
    environment_variables: membership(DISCERN_ENVIRONMENT_VARIABLE_NAMES),
    bundled_skills: membership(BUNDLED_SKILL_NAMES),
    git_admin_state: {
      namespace: GIT_ADMIN_STATE_NAMESPACE,
      entries: Object.fromEntries(
        Object.entries(GIT_ADMIN_STATE).map(([key, entry]) => [
          key,
          { ...entry },
        ]),
      ),
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
    hidden_verbs: Object.fromEntries(
      Object.entries(HIDDEN_VERBS).map(([name, entry]) => [
        name,
        { when: entry.when },
      ]),
    ),
    shell_only_verbs: Object.fromEntries(MCP_SHELL_ONLY_VERBS),
    providers: providerConventions(),
    local_formats: Object.fromEntries(
      Object.values(ON_DISK_FORMATS).map((format) => [
        format.id,
        {
          ...(format.location.kind === "git-note"
            ? { version: format.version }
            : {}),
          version_field: format.versionField,
          newer_version_policy: format.newerVersionPolicy,
          location: format.location,
        },
      ]),
    ),
    git: GIT_CONVENTIONS,
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
