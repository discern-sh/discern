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
import type { Command } from "@cliffy/command";
import {
  AcceptOutputSchema,
  AwaitOutputSchema,
  ConfigOutputSchema,
  CouplingOutputSchema,
  DeskOutputSchema,
  DiscernOutputSchema,
  DocsOutputSchema,
  DoctorOutputSchema,
  FinishOutputSchema,
  IdentityOutputSchema,
  ImpactOutputSchema,
  ImprovementOutputSchema,
  LicensesOutputSchema,
  MapOutputSchema,
  PatternsArchiveOutputSchema,
  PatternsArchivesOutputSchema,
  PatternsOutputSchema,
  PatternsResetOutputSchema,
  PrepareOutputSchema,
  PresetOutputSchema,
  RefreshOutputSchema,
  ScriptsOutputSchema,
  SetupAcceptOutputSchema,
  SetupDoneOutputSchema,
  SetupOutputSchema,
  SetupStepOutputSchema,
  SetupVerifyOutputSchema,
  SkillsEjectOutputSchema,
  SkillsListOutputSchema,
  SkillsOutputSchema,
  StandardsOutputSchema,
  StartOutputSchema,
  StatusOutputSchema,
  TestOutputSchema,
  TidyOutputSchema,
  TriangleOutputSchema,
  UninstallOutputSchema,
  UpdateOutputSchema,
  UpgradeOutputSchema,
  WorktreeDropOutputSchema,
  WorktreeOutputSchema,
  WorktreePruneOutputSchema,
  WorktreeSetupOutputSchema,
  WorktreeTeardownOutputSchema,
} from "./result_schemas.ts";

/**
 * The complete invocation matrix for a CLI predicate. Bare mode is the
 * shell-friendly exit-status contract; both JSON placements make the predicate
 * a successful observation whose boolean rides in the envelope.
 */
export const CLI_PREDICATE_INVOCATION_MODES = [
  { id: "bare", jsonFlag: "none", exit: "predicate" },
  { id: "json-global", jsonFlag: "before-command", exit: "success" },
  { id: "json-local", jsonFlag: "after-arguments", exit: "success" },
] as const;
export type CliPredicateInvocationMode =
  (typeof CLI_PREDICATE_INVOCATION_MODES)[number];

/** The two truth states every predicate contract must prove. */
export const CLI_PREDICATE_STATES = ["true", "false"] as const;
export type CliPredicateState = (typeof CLI_PREDICATE_STATES)[number];

/**
 * The schema-reference fields published for each result contract. Their roles
 * determine which new union alternatives are compatible within one major.
 */
export const RESULT_CONTRACT_REFERENCE_FIELDS = {
  cli: "schema",
  mcp: "mcpToolResultSchema",
} as const;

/** One option- or positional-selected predicate mode under a result contract. */
export interface CliJsonPredicateContract {
  /** Stable id used by behavioral fixtures and canonical-set enrollment. */
  id: string;
  /** Canonical command path that owns the predicate. */
  command: string;
  /** Option introducing the tested value; absent means a positional value. */
  option?: string | undefined;
  /** Path to the queried key/scope inside the serialized envelope. */
  subjectPath: readonly string[];
  /** Path to the boolean fact inside the serialized envelope. */
  presentPath: readonly string[];
}

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
  /** Additional predicate invocations selected inside one command path. */
  predicates?: readonly CliJsonPredicateContract[] | undefined;
}

export const CLI_JSON_RESULT_CONTRACTS: readonly ResultContract[] = [
  {
    // Deliberately contracted, not excluded: bare `discern --json` emits a real
    // DiscernResult on stdout — the machine-mode command-required refusal — so
    // the one-result protocol genuinely owns that stdout, and the generated
    // type documents the envelope a tool consumer actually receives. The
    // excluded paths (`help`, `mcp`, the hook namespace) hand stdout to some
    // OTHER protocol; the root does not.
    id: "discern",
    commands: ["discern"],
    verb: "discern",
    schema: DiscernOutputSchema,
  },
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
    id: "licenses",
    commands: ["licenses"],
    verb: "licenses",
    schema: LicensesOutputSchema,
  },
  {
    id: "triangle",
    commands: ["triangle"],
    verb: "triangle",
    schema: TriangleOutputSchema,
  },
  {
    id: "preset",
    commands: ["preset"],
    verb: "preset",
    schema: PresetOutputSchema,
  },
  {
    id: "map",
    commands: ["map"],
    verb: "map",
    schema: MapOutputSchema,
    mcpTool: "discern_map",
  },
  {
    id: "docs",
    commands: ["docs"],
    verb: "docs",
    schema: DocsOutputSchema,
    mcpTool: "discern_docs",
  },
  {
    id: "config",
    commands: [
      "config",
      "config set-job",
      "config set-scope",
      "config set-standard",
      "config set",
      "config get",
      "config array",
      "config has",
      "config subsections",
      "config keys",
    ],
    verb: "config",
    schema: ConfigOutputSchema,
    predicates: [{
      id: "configHas",
      command: "config has",
      subjectPath: ["data", "key"],
      presentPath: ["data", "present"],
    }],
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
    id: "standards",
    commands: ["standards"],
    verb: "standards",
    schema: StandardsOutputSchema,
    mcpTool: "discern_standards",
  },
  {
    id: "refresh",
    commands: ["refresh"],
    verb: "refresh",
    schema: RefreshOutputSchema,
    mcpTool: "discern_refresh",
  },
  {
    id: "tidy",
    commands: ["tidy"],
    verb: "tidy",
    schema: TidyOutputSchema,
  },
  {
    id: "impact",
    commands: ["impact"],
    verb: "impact",
    schema: ImpactOutputSchema,
    mcpTool: "discern_impact",
    predicates: [{
      id: "impactHas",
      command: "impact",
      option: "--has",
      subjectPath: ["data", "membership", "scope"],
      presentPath: ["data", "membership", "present"],
    }],
  },
  {
    id: "coupling",
    commands: ["coupling"],
    verb: "coupling",
    schema: CouplingOutputSchema,
    mcpTool: "discern_coupling",
  },
  {
    id: "await",
    commands: ["await"],
    verb: "await",
    schema: AwaitOutputSchema,
    mcpTool: "discern_await",
  },
  {
    id: "patterns",
    commands: ["patterns"],
    verb: "patterns",
    schema: PatternsOutputSchema,
    mcpTool: "discern_patterns",
  },
  {
    id: "patternsReset",
    commands: ["patterns reset"],
    verb: "patterns reset",
    schema: PatternsResetOutputSchema,
  },
  {
    id: "patternsArchive",
    commands: ["patterns archive"],
    verb: "patterns archive",
    schema: PatternsArchiveOutputSchema,
  },
  {
    id: "patternsArchives",
    commands: ["patterns archives"],
    verb: "patterns archives",
    schema: PatternsArchivesOutputSchema,
  },
  {
    id: "desk",
    commands: ["desk"],
    verb: "desk",
    schema: DeskOutputSchema,
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
    id: "identity",
    commands: ["identity"],
    verb: "identity",
    schema: IdentityOutputSchema,
  },
  {
    id: "scripts",
    commands: ["scripts"],
    verb: "scripts",
    schema: ScriptsOutputSchema,
  },
  {
    id: "worktree",
    commands: ["worktree"],
    verb: "worktree",
    schema: WorktreeOutputSchema,
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
    id: "skills",
    commands: ["skills"],
    verb: "skills",
    schema: SkillsOutputSchema,
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

/** A predicate contract with its parent envelope discriminator attached. */
export interface RegisteredCliJsonPredicateContract
  extends CliJsonPredicateContract {
  verb: string;
}

/**
 * Every predicate invocation flattened from the result-contract authority.
 * Tests consume this projection; they never maintain a parallel command list.
 */
export const CLI_JSON_PREDICATE_CONTRACTS:
  readonly RegisteredCliJsonPredicateContract[] = CLI_JSON_RESULT_CONTRACTS
    .flatMap((contract) =>
      (contract.predicates ?? []).map((predicate) => ({
        ...predicate,
        verb: contract.verb,
      }))
    );

/** One CLI command path that intentionally does not emit a public result. */
export interface CliJsonContractExclusion {
  /** Canonical, space-delimited path in the live Cliffy command tree. */
  command: string;
  /** Why this path cannot use the ordinary one-result envelope protocol. */
  reason: string;
}

/**
 * CLI commands that intentionally do not emit a public `DiscernResult` JSON
 * object. This is limited to protocols whose stdout is owned by something other
 * than the one-result CLI boundary.
 */
export const CLI_JSON_CONTRACT_EXCLUSIONS = [
  {
    command: "help",
    reason:
      "human-readable CLI reference; it mirrors the framework's --help output",
  },
  {
    command: "mcp",
    reason:
      "long-lived JSON-RPC stdio server; its stream is the MCP protocol, not one CLI result",
  },
  {
    command: "queue",
    reason:
      "exec-style wrapper; the child owns stdout, stderr, arguments, and exit status",
  },
  {
    command: "worktree hook",
    reason:
      "hidden namespace grouping the provider hook entry points; the group itself only routes",
  },
  {
    command: "worktree hook create",
    reason:
      "provider hook entry point; stdin and stdout belong to the provider hook protocol",
  },
  {
    command: "worktree hook remove",
    reason:
      "provider hook entry point; stdin and stdout belong to the provider hook protocol",
  },
  {
    command: "worktree ensure",
    reason:
      "provider session hook; stdout is injected as session context rather than returned to a CLI caller",
  },
] as const satisfies readonly CliJsonContractExclusion[];

/** The exact coverage diagnostics for the live CLI tree and result registry. */
export interface CliJsonContractCoverage {
  /** Real canonical command paths in neither the contract nor exclusion set. */
  uncontracted: string[];
  /** Contract declarations that do not resolve to a live command path. */
  staleContracts: string[];
  /** Exclusions that do not resolve to a live command path. */
  staleExclusions: string[];
  /** Canonical paths claimed by both a contract and an exclusion. */
  overlaps: string[];
  /** Canonical paths claimed by more than one result contract. */
  duplicateContracts: string[];
  /** Canonical paths excluded more than once. */
  duplicateExclusions: string[];
  /** Alias spellings in declarations; declarations publish canonical names. */
  nonCanonicalDeclarations: string[];
  /** Exclusions whose reason is blank. */
  reasonlessExclusions: string[];
}

/**
 * Normalize one space-delimited command path through the live Cliffy tree.
 * Aliases resolve to the registered command's canonical name at every depth.
 */
export function normalizeCliCommandPath(
  root: Command,
  commandPath: string,
): string | undefined {
  const tokens = commandPath.trim().split(/\s+/).filter((token) =>
    token.length > 0
  );
  if (tokens.length === 0) {
    return undefined;
  }
  if (
    tokens.length === 1 &&
    (tokens[0] === root.getName() ||
      root.getAliases().includes(tokens[0] ?? ""))
  ) {
    return root.getName();
  }
  const canonical: string[] = [];
  let current = root;
  for (const token of tokens) {
    const child = current.getCommands(true).find((candidate) =>
      candidate.getName() === token || candidate.getAliases().includes(token)
    );
    if (child === undefined) {
      return undefined;
    }
    canonical.push(child.getName());
    current = child as unknown as Command;
  }
  return canonical.join(" ");
}

/**
 * Every canonical command path in the built tree, including hidden provider
 * hooks. Hidden paths still dispatch, so they still require classification.
 */
export function registeredCliCommandPaths(root: Command): string[] {
  const paths: string[] = [root.getName()];
  const visit = (command: Command, prefix: readonly string[]): void => {
    for (const child of command.getCommands(true)) {
      const childPath = [...prefix, child.getName()];
      paths.push(childPath.join(" "));
      visit(child as unknown as Command, childPath);
    }
  };
  visit(root, []);
  return paths.sort();
}

/** The published result verb for one canonical command path. */
export function cliJsonResultVerb(commandPath: string): string | undefined {
  return CLI_JSON_RESULT_CONTRACTS.find((contract) =>
    contract.commands.includes(commandPath)
  )?.verb;
}

/**
 * Reconcile public result contracts and explicit protocol exclusions against
 * the actual nested command tree. The function accepts injected declarations
 * so tests can prove the predicate with synthetic future siblings.
 */
export function cliJsonContractCoverage(
  root: Command,
  contracts: readonly ResultContract[] = CLI_JSON_RESULT_CONTRACTS,
  exclusions: readonly CliJsonContractExclusion[] =
    CLI_JSON_CONTRACT_EXCLUSIONS,
): CliJsonContractCoverage {
  const live = registeredCliCommandPaths(root);
  const contractOwners = new Map<string, string[]>();
  const exclusionOwners = new Map<string, string[]>();
  const staleContracts: string[] = [];
  const staleExclusions: string[] = [];
  const nonCanonicalDeclarations: string[] = [];
  const reasonlessExclusions: string[] = [];

  for (const contract of contracts) {
    for (const declared of contract.commands) {
      const canonical = normalizeCliCommandPath(root, declared);
      if (canonical === undefined) {
        staleContracts.push(`${contract.id}: ${declared}`);
        continue;
      }
      if (canonical !== declared) {
        nonCanonicalDeclarations.push(
          `contract ${contract.id}: ${declared} -> ${canonical}`,
        );
      }
      const owners = contractOwners.get(canonical) ?? [];
      owners.push(contract.id);
      contractOwners.set(canonical, owners);
    }
  }

  for (const exclusion of exclusions) {
    if (exclusion.reason.trim().length === 0) {
      reasonlessExclusions.push(exclusion.command);
    }
    const canonical = normalizeCliCommandPath(root, exclusion.command);
    if (canonical === undefined) {
      staleExclusions.push(exclusion.command);
      continue;
    }
    if (canonical !== exclusion.command) {
      nonCanonicalDeclarations.push(
        `exclusion: ${exclusion.command} -> ${canonical}`,
      );
    }
    const owners = exclusionOwners.get(canonical) ?? [];
    owners.push(exclusion.command);
    exclusionOwners.set(canonical, owners);
  }

  return {
    uncontracted: live.filter((path) =>
      !contractOwners.has(path) && !exclusionOwners.has(path)
    ),
    staleContracts: staleContracts.sort(),
    staleExclusions: staleExclusions.sort(),
    overlaps: [...contractOwners.keys()].filter((path) =>
      exclusionOwners.has(path)
    ).sort(),
    duplicateContracts: [...contractOwners.entries()].flatMap((
      [path, owners],
    ) => owners.length > 1 ? [`${path}: ${owners.join(", ")}`] : []).sort(),
    duplicateExclusions: [...exclusionOwners.entries()].flatMap((
      [path, owners],
    ) => owners.length > 1 ? [`${path}: ${owners.join(", ")}`] : []).sort(),
    nonCanonicalDeclarations: nonCanonicalDeclarations.sort(),
    reasonlessExclusions: reasonlessExclusions.sort(),
  };
}

export const MCP_RESULT_CONTRACTS = CLI_JSON_RESULT_CONTRACTS.filter(
  (contract): contract is ResultContract & { mcpTool: string } =>
    contract.mcpTool !== undefined,
);
