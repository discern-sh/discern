/**
 * Typed operational contract embedded in agent-facing Skills and briefs.
 *
 * The contract is a small TOML block under `## Operational contract`. Its
 * classification fields say which conditional guarantees apply; the remaining
 * fields carry stable targets, an ordered act/verify sequence, stop conditions,
 * recovery, authority verification, and an exact relay template. Parsing and
 * diagnostics live here so every surface and every fixture receives the same
 * accepted forms.
 */

import { parse as parseToml } from "@std/toml";

export const AGENT_CONTRACT_HEADING = "## Operational contract";

export const AGENT_CONTRACT_FIELDS = [
  "effectful",
  "cross_worktree",
  "authority_sensitive",
  "relay_bearing",
  "recoverable",
  "targets",
  "sequence",
  "stop_conditions",
  "recovery",
  "authority",
  "authority_check",
  "relay_message",
  "relay_facts",
] as const;

export type AgentContractField = (typeof AGENT_CONTRACT_FIELDS)[number];

interface AgentContractBase {
  readonly effectful: boolean;
  readonly cross_worktree: boolean;
  readonly targets: readonly string[];
  readonly sequence: readonly string[];
  readonly stop_conditions: readonly string[];
}

type RecoveryContract =
  | {
    readonly recoverable: true;
    readonly recovery: readonly string[];
  }
  | {
    readonly recoverable: false;
    readonly recovery?: never;
  };

type AuthorityContract =
  | {
    readonly authority_sensitive: true;
    readonly authority: string;
    readonly authority_check: string;
  }
  | {
    readonly authority_sensitive: false;
    readonly authority?: never;
    readonly authority_check?: never;
  };

type RelayContract =
  | {
    readonly relay_bearing: true;
    readonly relay_message: string;
    readonly relay_facts: readonly string[];
  }
  | {
    readonly relay_bearing: false;
    readonly relay_message?: never;
    readonly relay_facts?: never;
  };

/** One complete surface contract. Conditional fields exist only when the
 * matching classification is true. */
export type AgentSurfaceContract =
  & AgentContractBase
  & RecoveryContract
  & AuthorityContract
  & RelayContract;

/** One source-located contract defect. */
export interface AgentContractIssue {
  readonly field: AgentContractField | "contract";
  readonly line: number;
  readonly message: string;
}

/** Parsed contract plus every issue found. `contract` exists only at green. */
export interface ParsedAgentContract {
  readonly contract?: AgentSurfaceContract;
  readonly issues: readonly AgentContractIssue[];
}

const ACCEPTED_FORMS: Readonly<Record<AgentContractField, string>> = {
  effectful: "effectful = true | false",
  cross_worktree: "cross_worktree = true | false",
  authority_sensitive: "authority_sensitive = true | false",
  relay_bearing: "relay_bearing = true | false",
  recoverable: "recoverable = true | false",
  targets:
    'targets = ["root: <root source>", "path: /absolute/path", "stable: <identifier>"]',
  sequence:
    'sequence = ["act: <ordered action>", "verify: <completion evidence>"]',
  stop_conditions: 'stop_conditions = ["<condition that ends or pauses work>"]',
  recovery: 'recovery = ["<failed condition> => <next valid action>"]',
  authority: 'authority = "<who or what authorizes which effect>"',
  authority_check:
    'authority_check = "command: `<command>` <what it verifies>"',
  relay_message: 'relay_message = "I verified <fact_name>."',
  relay_facts: 'relay_facts = ["fact_name"]',
};

const TARGET_PREFIX = /^(?:root|path|stable):\s+\S/;
const SEQUENCE_PREFIX = /^(?:act|verify):\s+\S/;
const AUTHORITY_COMMAND = /^command:\s+`[^`]+`\s+\S/;
const RELAY_FACT = /^[a-z][a-z0-9_]*$/;

/** Recognize a parsed TOML table rather than a scalar or array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recognize an array whose every member is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

/** Locate a field assignment inside the fenced block for diagnostics. */
function assignmentLine(
  lines: readonly string[],
  openLine: number,
  field: string,
): number {
  const pattern = new RegExp(`^\\s*${field}\\s*=`);
  const offset = lines.findIndex((line) => pattern.test(line));
  return offset === -1 ? openLine : openLine + offset + 1;
}

/** Append one issue with the canonical accepted form for its field. */
function issue(
  issues: AgentContractIssue[],
  field: AgentContractIssue["field"],
  line: number,
  reason: string,
): void {
  const accepted = field === "contract"
    ? `add ${AGENT_CONTRACT_HEADING} followed by a fenced \`toml\` block`
    : ACCEPTED_FORMS[field];
  issues.push({
    field,
    line,
    message: `${reason}; accepted form: ${accepted}`,
  });
}

/** Read one required classification boolean and diagnose absence or type. */
function requiredBoolean(
  raw: Record<string, unknown>,
  field:
    | "effectful"
    | "cross_worktree"
    | "authority_sensitive"
    | "relay_bearing"
    | "recoverable",
  line: number,
  issues: AgentContractIssue[],
): boolean | undefined {
  const value = raw[field];
  if (typeof value !== "boolean") {
    issue(
      issues,
      field,
      line,
      value === undefined
        ? `missing contract field '${field}'`
        : `contract field '${field}' must be a boolean`,
    );
    return undefined;
  }
  return value;
}

/** Read one required non-empty string-array field. */
function requiredStrings(
  raw: Record<string, unknown>,
  field: "targets" | "sequence" | "stop_conditions",
  line: number,
  issues: AgentContractIssue[],
): string[] | undefined {
  const value = raw[field];
  if (
    !isStringArray(value) || value.length === 0 ||
    value.some((v) => v.trim() === "")
  ) {
    issue(
      issues,
      field,
      line,
      value === undefined
        ? `missing contract field '${field}'`
        : `contract field '${field}' must be a non-empty string array`,
    );
    return undefined;
  }
  return value;
}

/** Read one conditionally required non-empty string field. */
function optionalString(
  raw: Record<string, unknown>,
  field: "authority" | "authority_check" | "relay_message",
  line: number,
  issues: AgentContractIssue[],
): string | undefined {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    issue(
      issues,
      field,
      line,
      value === undefined
        ? `missing contract field '${field}'`
        : `contract field '${field}' must be a non-empty string`,
    );
    return undefined;
  }
  return value;
}

/** Read one conditionally required non-empty string-array field. */
function optionalStrings(
  raw: Record<string, unknown>,
  field: "recovery" | "relay_facts",
  line: number,
  issues: AgentContractIssue[],
): string[] | undefined {
  const value = raw[field];
  if (
    !isStringArray(value) || value.length === 0 ||
    value.some((v) => v.trim() === "")
  ) {
    issue(
      issues,
      field,
      line,
      value === undefined
        ? `missing contract field '${field}'`
        : `contract field '${field}' must be a non-empty string array`,
    );
    return undefined;
  }
  return value;
}

/** Reject conditional fields when their classification says they do not apply. */
function rejectInapplicable(
  raw: Record<string, unknown>,
  fields: readonly AgentContractField[],
  lines: readonly string[],
  openLine: number,
  issues: AgentContractIssue[],
  classification: AgentContractField,
): void {
  for (const field of fields) {
    if (raw[field] !== undefined) {
      issue(
        issues,
        field,
        assignmentLine(lines, openLine, field),
        `contract field '${field}' is present while '${classification}' is false; remove it or classify the surface truthfully`,
      );
    }
  }
}

/** Validate parsed contract data and construct its discriminated type at green. */
function validateContract(
  raw: Record<string, unknown>,
  blockLines: readonly string[],
  openLine: number,
): ParsedAgentContract {
  const issues: AgentContractIssue[] = [];
  const known = new Set<string>(AGENT_CONTRACT_FIELDS);
  for (const field of Object.keys(raw)) {
    if (!known.has(field)) {
      issues.push({
        field: "contract",
        line: assignmentLine(blockLines, openLine, field),
        message: `unknown agent contract field '${field}'; accepted fields: ${
          AGENT_CONTRACT_FIELDS.join(", ")
        }`,
      });
    }
  }

  const lineOf = (field: AgentContractField): number =>
    assignmentLine(blockLines, openLine, field);
  const effectful = requiredBoolean(
    raw,
    "effectful",
    lineOf("effectful"),
    issues,
  );
  const crossWorktree = requiredBoolean(
    raw,
    "cross_worktree",
    lineOf("cross_worktree"),
    issues,
  );
  const authoritySensitive = requiredBoolean(
    raw,
    "authority_sensitive",
    lineOf("authority_sensitive"),
    issues,
  );
  const relayBearing = requiredBoolean(
    raw,
    "relay_bearing",
    lineOf("relay_bearing"),
    issues,
  );
  const recoverable = requiredBoolean(
    raw,
    "recoverable",
    lineOf("recoverable"),
    issues,
  );
  const targets = requiredStrings(raw, "targets", lineOf("targets"), issues);
  const sequence = requiredStrings(raw, "sequence", lineOf("sequence"), issues);
  const stopConditions = requiredStrings(
    raw,
    "stop_conditions",
    lineOf("stop_conditions"),
    issues,
  );

  if (targets !== undefined) {
    if (targets.some((target) => !TARGET_PREFIX.test(target))) {
      issue(
        issues,
        "targets",
        lineOf("targets"),
        "every target must declare whether it is a root, path, or stable identifier",
      );
    }
    if (crossWorktree === true) {
      if (!targets.some((target) => target.startsWith("root:"))) {
        issue(
          issues,
          "targets",
          lineOf("targets"),
          "a cross-worktree surface must name the source of its working root",
        );
      }
      const relativePath = targets.find((target) => {
        if (!target.startsWith("path:")) return false;
        return !target.slice("path:".length).trimStart().startsWith("/");
      });
      if (relativePath !== undefined) {
        issue(
          issues,
          "targets",
          lineOf("targets"),
          `cross-worktree target '${relativePath}' is relative`,
        );
      }
    }
  }

  if (sequence !== undefined) {
    const validPrefixes = sequence.every((entry) =>
      SEQUENCE_PREFIX.test(entry)
    );
    const hasAction = sequence.some((entry) => entry.startsWith("act:"));
    const verifiesLast = sequence.at(-1)?.startsWith("verify:") === true;
    if (sequence.length < 2 || !validPrefixes || !hasAction || !verifiesLast) {
      issue(
        issues,
        "sequence",
        lineOf("sequence"),
        "the ordered sequence must contain an action and end with verification",
      );
    }
  }

  let recovery: string[] | undefined;
  if (recoverable === true) {
    recovery = optionalStrings(raw, "recovery", lineOf("recovery"), issues);
    if (
      recovery !== undefined &&
      recovery.some((entry) => !entry.includes(" => "))
    ) {
      issue(
        issues,
        "recovery",
        lineOf("recovery"),
        "every recovery must bind one failed condition to one next action with ' => '",
      );
    }
  } else if (recoverable === false) {
    rejectInapplicable(
      raw,
      ["recovery"],
      blockLines,
      openLine,
      issues,
      "recoverable",
    );
  }

  let authority: string | undefined;
  let authorityCheck: string | undefined;
  if (authoritySensitive === true) {
    authority = optionalString(raw, "authority", lineOf("authority"), issues);
    authorityCheck = optionalString(
      raw,
      "authority_check",
      lineOf("authority_check"),
      issues,
    );
    if (
      authorityCheck !== undefined && !AUTHORITY_COMMAND.test(authorityCheck)
    ) {
      issue(
        issues,
        "authority_check",
        lineOf("authority_check"),
        "the authority check must name the command that re-verifies the boundary",
      );
    }
  } else if (authoritySensitive === false) {
    rejectInapplicable(
      raw,
      ["authority", "authority_check"],
      blockLines,
      openLine,
      issues,
      "authority_sensitive",
    );
  }

  let relayMessage: string | undefined;
  let relayFacts: string[] | undefined;
  if (relayBearing === true) {
    relayMessage = optionalString(
      raw,
      "relay_message",
      lineOf("relay_message"),
      issues,
    );
    relayFacts = optionalStrings(
      raw,
      "relay_facts",
      lineOf("relay_facts"),
      issues,
    );
    if (
      relayFacts !== undefined &&
      (new Set(relayFacts).size !== relayFacts.length ||
        relayFacts.some((fact) => !RELAY_FACT.test(fact)))
    ) {
      issue(
        issues,
        "relay_facts",
        lineOf("relay_facts"),
        "relay facts must be unique lower_snake_case identifiers",
      );
    }
    if (relayMessage !== undefined && relayFacts !== undefined) {
      const missing = relayFacts.filter((fact) =>
        !relayMessage?.includes(`<${fact}>`)
      );
      const declared = new Set(relayFacts);
      const extra = [...relayMessage.matchAll(/<([a-z][a-z0-9_]*)>/g)]
        .map((match) => match[1])
        .filter((fact): fact is string =>
          fact !== undefined && !declared.has(fact)
        );
      if (missing.length > 0 || extra.length > 0) {
        issue(
          issues,
          "relay_message",
          lineOf("relay_message"),
          `relay placeholders and relay_facts must match (missing: ${
            missing.join(", ") || "none"
          }; undeclared: ${extra.join(", ") || "none"})`,
        );
      }
    }
  } else if (relayBearing === false) {
    rejectInapplicable(
      raw,
      ["relay_message", "relay_facts"],
      blockLines,
      openLine,
      issues,
      "relay_bearing",
    );
  }

  if (
    issues.length > 0 || effectful === undefined ||
    crossWorktree === undefined ||
    authoritySensitive === undefined || relayBearing === undefined ||
    recoverable === undefined || targets === undefined ||
    sequence === undefined ||
    stopConditions === undefined
  ) {
    return { issues };
  }

  const base = {
    effectful,
    cross_worktree: crossWorktree,
    targets,
    sequence,
    stop_conditions: stopConditions,
  };
  const recoveryPart = recoverable
    ? { recoverable: true as const, recovery: recovery ?? [] }
    : { recoverable: false as const };
  const authorityPart = authoritySensitive
    ? {
      authority_sensitive: true as const,
      authority: authority ?? "",
      authority_check: authorityCheck ?? "",
    }
    : { authority_sensitive: false as const };
  const relayPart = relayBearing
    ? {
      relay_bearing: true as const,
      relay_message: relayMessage ?? "",
      relay_facts: relayFacts ?? [],
    }
    : { relay_bearing: false as const };
  return {
    contract: { ...base, ...recoveryPart, ...authorityPart, ...relayPart },
    issues,
  };
}

/** Parse and validate the first operational-contract block in Markdown. */
export function parseAgentSurfaceContract(text: string): ParsedAgentContract {
  const lines = text.split("\n");
  const heading = lines.findIndex((line) =>
    line.trim() === AGENT_CONTRACT_HEADING
  );
  if (heading === -1) {
    const empty = validateContract({}, [], 1);
    return {
      issues: [
        {
          field: "contract",
          line: 1,
          message:
            `missing operational contract; accepted form: add ${AGENT_CONTRACT_HEADING} followed by a fenced \`toml\` block`,
        },
        ...empty.issues,
      ],
    };
  }

  let open = -1;
  let close = -1;
  for (let index = heading + 1; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    if (open === -1) {
      if (line === "```toml") open = index;
      if (/^#{1,2}\s/.test(line)) break;
      continue;
    }
    if (line === "```") {
      close = index;
      break;
    }
  }
  if (open === -1 || close === -1) {
    return {
      issues: [{
        field: "contract",
        line: heading + 1,
        message:
          `operational contract is missing its fenced \`toml\` block; accepted form: add ${AGENT_CONTRACT_HEADING} followed by a fenced \`toml\` block`,
      }],
    };
  }

  const blockLines = lines.slice(open + 1, close);
  let raw: unknown;
  try {
    raw = parseToml(blockLines.join("\n"));
  } catch (error) {
    return {
      issues: [{
        field: "contract",
        line: open + 2,
        message: `operational contract is not valid TOML: ${
          error instanceof Error ? error.message : String(error)
        }; accepted form: add ${AGENT_CONTRACT_HEADING} followed by a fenced \`toml\` block`,
      }],
    };
  }
  if (!isRecord(raw)) {
    return {
      issues: [{
        field: "contract",
        line: open + 2,
        message:
          `operational contract must be a TOML table; accepted form: add ${AGENT_CONTRACT_HEADING} followed by a fenced \`toml\` block`,
      }],
    };
  }
  return validateContract(raw, blockLines, open + 1);
}

/** Encode one TOML basic string with JSON's compatible escaping. */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/** Encode one compact TOML array of basic strings. */
function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

/** Render a validated contract in the canonical field order. */
export function renderAgentSurfaceContract(
  contract: AgentSurfaceContract,
): string {
  const parsed = validateContract(
    contract as unknown as Record<string, unknown>,
    [],
    1,
  );
  if (parsed.issues.length > 0) {
    throw new Error(
      `invalid agent surface contract: ${
        parsed.issues.map((entry) => entry.message).join("; ")
      }`,
    );
  }
  const lines = [
    AGENT_CONTRACT_HEADING,
    "",
    "```toml",
    `effectful = ${contract.effectful}`,
    `cross_worktree = ${contract.cross_worktree}`,
    `authority_sensitive = ${contract.authority_sensitive}`,
    `relay_bearing = ${contract.relay_bearing}`,
    `recoverable = ${contract.recoverable}`,
    `targets = ${tomlArray(contract.targets)}`,
    `sequence = ${tomlArray(contract.sequence)}`,
    `stop_conditions = ${tomlArray(contract.stop_conditions)}`,
  ];
  if (contract.recoverable) {
    lines.push(`recovery = ${tomlArray(contract.recovery)}`);
  }
  if (contract.authority_sensitive) {
    lines.push(`authority = ${tomlString(contract.authority)}`);
    lines.push(`authority_check = ${tomlString(contract.authority_check)}`);
  }
  if (contract.relay_bearing) {
    lines.push(`relay_message = ${tomlString(contract.relay_message)}`);
    lines.push(`relay_facts = ${tomlArray(contract.relay_facts)}`);
  }
  lines.push("```");
  return lines.join("\n");
}
