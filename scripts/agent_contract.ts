/**
 * Internal structural contracts for operational agent copy.
 *
 * Contracts live in the repository-only registry. Agent-facing Markdown owns
 * the instructions themselves; each structural field points at an exact prose
 * excerpt so the guard proves the shipped instruction still carries the fact.
 * No renderer consumes this model.
 */

export const AGENT_CONTRACT_HEADING = "## Operational contract";

export const AGENT_CLASSIFICATION_FIELDS = [
  "effectful",
  "cross_worktree",
  "authority_sensitive",
  "relay_bearing",
  "recoverable",
] as const;

export const AGENT_CONTRACT_FIELDS = [
  ...AGENT_CLASSIFICATION_FIELDS,
  "targets",
  "sequence",
  "stop_conditions",
  "recovery",
  "authority",
  "relay_message",
  "relay_facts",
] as const;

export type AgentClassificationField =
  (typeof AGENT_CLASSIFICATION_FIELDS)[number];
export type AgentContractField = (typeof AGENT_CONTRACT_FIELDS)[number];

/** An exact excerpt in the authored operational prose. */
export interface AgentProseEvidence {
  readonly text: string;
  /** Skill-relative supporting file. Omit for the surface's primary Markdown. */
  readonly file?: string;
}

export type AgentTargetKind = "root" | "path" | "stable";

/** One exact working root, path, or stable identifier carried by the prose. */
export interface AgentTargetBinding {
  readonly kind: AgentTargetKind;
  readonly value: string;
  readonly evidence: AgentProseEvidence;
}

/** One ordered action or verification point carried by the prose. */
export interface AgentSequenceBinding {
  readonly kind: "act" | "verify";
  readonly evidence: AgentProseEvidence;
}

interface AgentContractBase {
  readonly effectful: boolean;
  readonly cross_worktree: boolean;
  readonly targets: readonly AgentTargetBinding[];
  readonly sequence: readonly AgentSequenceBinding[];
  readonly stop_conditions: readonly AgentProseEvidence[];
}

type RecoveryContract =
  | {
    readonly recoverable: true;
    readonly recovery: readonly AgentProseEvidence[];
  }
  | {
    readonly recoverable: false;
    readonly recovery?: never;
  };

/** The prose boundary plus the command that checks authority again. */
export interface AgentAuthorityBinding {
  readonly boundary: AgentProseEvidence;
  readonly command: string;
  readonly recheck: AgentProseEvidence;
}

type AuthorityContract =
  | {
    readonly authority_sensitive: true;
    readonly authority: AgentAuthorityBinding;
  }
  | {
    readonly authority_sensitive: false;
    readonly authority?: never;
  };

/** A ready-to-send prose message and the facts its placeholders must carry. */
export interface AgentRelayBinding {
  readonly message: AgentProseEvidence;
  readonly facts: readonly string[];
}

type RelayContract =
  | {
    readonly relay_bearing: true;
    readonly relay: AgentRelayBinding;
  }
  | {
    readonly relay_bearing: false;
    readonly relay?: never;
  };

/** One repository-only contract. Conditional fields exist only when classified. */
export type AgentSurfaceContract =
  & AgentContractBase
  & RecoveryContract
  & AuthorityContract
  & RelayContract;

/** One source-located contract defect. */
export interface AgentContractIssue {
  readonly field: AgentContractField | "contract";
  readonly line: number;
  readonly file?: string;
  readonly message: string;
}

/** One operational Markdown document available as contract evidence. */
export interface AgentContractDocument {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly text: string;
}

/** Internal metadata that escaped into agent-facing Markdown. */
export interface AgentCopyMetadataIssue {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const ACCEPTED_FORMS: Readonly<Record<AgentContractField, string>> = {
  effectful: "effectful: true | false in the internal surface registry",
  cross_worktree:
    "cross_worktree: true | false in the internal surface registry",
  authority_sensitive:
    "authority_sensitive: true | false in the internal surface registry",
  relay_bearing: "relay_bearing: true | false in the internal surface registry",
  recoverable: "recoverable: true | false in the internal surface registry",
  targets:
    'targets: [{ kind: "root" | "path" | "stable", value: "<exact target>", evidence: { text: "<shipped prose>" } }]',
  sequence:
    'sequence: [{ kind: "act", evidence: { text: "<ordered prose>" } }, { kind: "verify", evidence: { text: "<completion prose>" } }]',
  stop_conditions: 'stop_conditions: [{ text: "<shipped stopping boundary>" }]',
  recovery: 'recovery: [{ text: "<failed condition and next valid action>" }]',
  authority:
    'authority: { boundary: { text: "<shipped authority boundary>" }, command: "<reverification command>", recheck: { text: "<shipped command instruction>" } }',
  relay_message:
    'relay: { message: { text: "<ready-to-send message with <fact> placeholders>" }, facts: ["fact"] }',
  relay_facts:
    'relay: { message: { text: "<ready-to-send message with <fact> placeholders>" }, facts: ["fact"] }',
};

/** Narrow an unknown schema node to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Append one diagnostic with the accepted internal form. */
function issue(
  issues: AgentContractIssue[],
  field: AgentContractIssue["field"],
  reason: string,
  file?: string,
  line = 1,
): void {
  const accepted = field === "contract"
    ? "register the derived surface in AGENT_SURFACE_CONTRACTS"
    : ACCEPTED_FORMS[field];
  const row: AgentContractIssue = {
    field,
    line,
    message: `${reason}; accepted form: ${accepted}`,
  };
  if (file !== undefined) Object.assign(row, { file });
  issues.push(row);
}

/** Read one required classification flag or report its defect. */
function requiredBoolean(
  raw: Record<string, unknown>,
  field: AgentClassificationField,
  issues: AgentContractIssue[],
): boolean | undefined {
  const value = raw[field];
  if (typeof value !== "boolean") {
    issue(
      issues,
      field,
      value === undefined
        ? `missing internal contract field '${field}'`
        : `internal contract field '${field}' must be a boolean`,
    );
    return undefined;
  }
  return value;
}

/** Read one required non-empty structural array or report its defect. */
function nonEmptyArray(
  raw: Record<string, unknown>,
  field: "targets" | "sequence" | "stop_conditions" | "recovery",
  issues: AgentContractIssue[],
): unknown[] | undefined {
  const value = raw[field];
  if (!Array.isArray(value) || value.length === 0) {
    issue(
      issues,
      field,
      value === undefined
        ? `missing internal contract field '${field}'`
        : `internal contract field '${field}' must be a non-empty array`,
    );
    return undefined;
  }
  return value;
}

/** Recognize an exact, optionally file-qualified prose binding. */
function evidenceIsValid(value: unknown): value is AgentProseEvidence {
  if (!isRecord(value) || typeof value.text !== "string" || value.text === "") {
    return false;
  }
  return value.file === undefined ||
    (typeof value.file === "string" && value.file !== "");
}

/** Validate the internal schema without consulting the authored prose. */
export function agentContractStructureIssues(
  value: unknown,
): AgentContractIssue[] {
  const issues: AgentContractIssue[] = [];
  if (!isRecord(value)) {
    for (const field of AGENT_CLASSIFICATION_FIELDS) {
      issue(issues, field, `missing internal contract field '${field}'`);
    }
    return issues;
  }

  const effectful = requiredBoolean(value, "effectful", issues);
  const crossWorktree = requiredBoolean(value, "cross_worktree", issues);
  const authoritySensitive = requiredBoolean(
    value,
    "authority_sensitive",
    issues,
  );
  const relayBearing = requiredBoolean(value, "relay_bearing", issues);
  const recoverable = requiredBoolean(value, "recoverable", issues);

  const targets = nonEmptyArray(value, "targets", issues);
  if (targets !== undefined) {
    for (const target of targets) {
      if (
        !isRecord(target) ||
        !["root", "path", "stable"].includes(String(target.kind)) ||
        typeof target.value !== "string" || target.value === "" ||
        !evidenceIsValid(target.evidence)
      ) {
        issue(
          issues,
          "targets",
          "each target must bind a named target to prose",
        );
        break;
      }
    }
    if (
      crossWorktree === true &&
      !targets.some((target) =>
        isRecord(target) && (target.kind === "root" || target.kind === "path")
      )
    ) {
      issue(
        issues,
        "targets",
        "a cross-worktree surface must bind an exact root or path",
      );
    }
  }

  const sequence = nonEmptyArray(value, "sequence", issues);
  if (sequence !== undefined) {
    const valid = sequence.every((entry) =>
      isRecord(entry) && (entry.kind === "act" || entry.kind === "verify") &&
      evidenceIsValid(entry.evidence)
    );
    if (!valid) {
      issue(
        issues,
        "sequence",
        "each sequence entry must bind an action kind to prose",
      );
    } else {
      const kinds = sequence.map((entry) =>
        isRecord(entry) ? entry.kind : undefined
      );
      if (kinds[0] !== "act" || kinds.at(-1) !== "verify") {
        issue(
          issues,
          "sequence",
          "the ordered sequence must begin with an action and end with verification",
        );
      }
      const firstVerify = kinds.indexOf("verify");
      if (
        firstVerify !== -1 &&
        kinds.slice(firstVerify + 1).some((kind) => kind === "act")
      ) {
        issue(
          issues,
          "sequence",
          "an action cannot follow verification in the ordered sequence",
        );
      }
    }
  }

  const stops = nonEmptyArray(value, "stop_conditions", issues);
  if (
    stops !== undefined &&
    !stops.every((entry) => evidenceIsValid(entry))
  ) {
    issue(
      issues,
      "stop_conditions",
      "each stop condition must cite shipped prose",
    );
  }

  if (recoverable === true) {
    const recovery = nonEmptyArray(value, "recovery", issues);
    if (
      recovery !== undefined &&
      !recovery.every((entry) => evidenceIsValid(entry))
    ) {
      issue(issues, "recovery", "each recovery must cite shipped prose");
    }
  } else if (recoverable === false && value.recovery !== undefined) {
    issue(
      issues,
      "recovery",
      "recoverable: false must omit recovery ceremony",
    );
  }

  if (authoritySensitive === true) {
    const authority = value.authority;
    if (
      !isRecord(authority) || !evidenceIsValid(authority.boundary) ||
      typeof authority.command !== "string" || authority.command === "" ||
      !evidenceIsValid(authority.recheck) ||
      !authority.recheck.text.includes(`\`${authority.command}\``)
    ) {
      issue(
        issues,
        "authority",
        "authority-sensitive surfaces must bind the boundary and a code-spanned reverification command to shipped prose",
      );
    }
  } else if (authoritySensitive === false && value.authority !== undefined) {
    issue(
      issues,
      "authority",
      "authority_sensitive: false must omit authority ceremony",
    );
  }

  if (relayBearing === true) {
    const relay = value.relay;
    if (
      !isRecord(relay) || !evidenceIsValid(relay.message) ||
      !Array.isArray(relay.facts) || relay.facts.length === 0 ||
      !relay.facts.every((fact) =>
        typeof fact === "string" && /^[a-z][a-z0-9_]*$/.test(fact)
      )
    ) {
      issue(
        issues,
        "relay_message",
        "relay-bearing surfaces must bind a ready-to-send message and named facts",
      );
    } else {
      const placeholders = [
        ...relay.message.text.matchAll(/<([a-z][a-z0-9_]*)>/g),
      ].map((match) => match[1]).filter((fact): fact is string =>
        fact !== undefined
      );
      const declared = [...new Set(relay.facts)].sort();
      const carried = [...new Set(placeholders)].sort();
      if (JSON.stringify(declared) !== JSON.stringify(carried)) {
        issue(
          issues,
          "relay_facts",
          "relay placeholders must equal the declared fact set",
        );
      }
    }
  } else if (relayBearing === false && value.relay !== undefined) {
    issue(
      issues,
      "relay_message",
      "relay_bearing: false must omit relay ceremony",
    );
  }

  void effectful;
  return issues;
}

/** Missing-registry diagnostics attach to the derived agent source. */
export function missingAgentContractIssues(): AgentContractIssue[] {
  return AGENT_CLASSIFICATION_FIELDS.map((field) => ({
    field,
    line: 1,
    message: `missing internal contract field '${field}'; accepted form: ${
      ACCEPTED_FORMS[field]
    }`,
  }));
}

/** Convert a character offset to a one-based source line. */
function lineForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

interface EvidencePosition {
  readonly fileIndex: number;
  readonly offset: number;
}

/** Resolve one evidence excerpt to its unique position in the corpus. */
function evidencePosition(
  field: AgentContractField,
  evidence: AgentProseEvidence,
  primaryRelativePath: string,
  documents: readonly AgentContractDocument[],
  issues: AgentContractIssue[],
): EvidencePosition | undefined {
  const rel = evidence.file ?? primaryRelativePath;
  const fileIndex = documents.findIndex((document) =>
    document.relativePath === rel
  );
  const document = fileIndex === -1 ? undefined : documents[fileIndex];
  if (document === undefined) {
    issue(
      issues,
      field,
      `prose evidence names unavailable operational file '${rel}'`,
      rel,
    );
    return undefined;
  }
  const offset = document.text.indexOf(evidence.text);
  if (offset === -1) {
    issue(
      issues,
      field,
      `shipped prose is missing the registered evidence ${
        JSON.stringify(evidence.text)
      }`,
      document.absolutePath,
    );
    return undefined;
  }
  if (
    document.text.indexOf(evidence.text, offset + evidence.text.length) !== -1
  ) {
    issue(
      issues,
      field,
      `registered prose evidence is ambiguous because it occurs more than once: ${
        JSON.stringify(evidence.text)
      }`,
      document.absolutePath,
      lineForOffset(document.text, offset),
    );
    return undefined;
  }
  return { fileIndex, offset };
}

/** Bind every structural field to prose that an end-user agent actually reads. */
export function agentContractEvidenceIssues(
  contract: AgentSurfaceContract,
  primaryRelativePath: string,
  documents: readonly AgentContractDocument[],
): AgentContractIssue[] {
  const issues: AgentContractIssue[] = [];
  const anchors: Array<{
    field: AgentContractField;
    evidence: AgentProseEvidence;
  }> = [
    ...contract.targets.map((entry) => ({
      field: "targets" as const,
      evidence: entry.evidence,
    })),
    ...contract.stop_conditions.map((evidence) => ({
      field: "stop_conditions" as const,
      evidence,
    })),
  ];
  if (contract.recoverable) {
    anchors.push(...contract.recovery.map((evidence) => ({
      field: "recovery" as const,
      evidence,
    })));
  }
  if (contract.authority_sensitive) {
    anchors.push(
      { field: "authority", evidence: contract.authority.boundary },
      { field: "authority", evidence: contract.authority.recheck },
    );
  }
  if (contract.relay_bearing) {
    anchors.push({
      field: "relay_message",
      evidence: contract.relay.message,
    });
  }
  for (const anchor of anchors) {
    evidencePosition(
      anchor.field,
      anchor.evidence,
      primaryRelativePath,
      documents,
      issues,
    );
  }

  let previous: EvidencePosition | undefined;
  for (const step of contract.sequence) {
    const current = evidencePosition(
      "sequence",
      step.evidence,
      primaryRelativePath,
      documents,
      issues,
    );
    if (
      current !== undefined && previous !== undefined &&
      (current.fileIndex < previous.fileIndex ||
        (current.fileIndex === previous.fileIndex &&
          current.offset <= previous.offset))
    ) {
      const currentDocument = documents[current.fileIndex];
      issue(
        issues,
        "sequence",
        "registered action and verification evidence is not ordered in the shipped prose",
        currentDocument?.absolutePath,
        currentDocument === undefined
          ? 1
          : lineForOffset(currentDocument.text, current.offset),
      );
    }
    if (current !== undefined) previous = current;
  }
  return issues;
}

/**
 * Find the retired schema in operational Markdown. The structural TOML check
 * catches the same mechanism under a renamed heading; a lone coincidental key
 * remains a legitimate TOML example.
 */
export function agentCopyMetadataIssues(
  file: string,
  text: string,
): AgentCopyMetadataIssue[] {
  const issues: AgentCopyMetadataIssue[] = [];
  const lines = text.split(/\r?\n/);
  let fenceStart: number | undefined;
  let fenceLanguage = "";
  let classificationCount = 0;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === AGENT_CONTRACT_HEADING) {
      issues.push({
        file,
        line: index + 1,
        message:
          "internal operational-contract metadata must stay outside agent-facing copy",
      });
    }
    const fence = line.match(/^\s*```([^\s`]*)/);
    if (fence === null) {
      if (
        fenceStart !== undefined && fenceLanguage === "toml" &&
        /^\s*(?:effectful|cross_worktree|authority_sensitive|relay_bearing|recoverable)\s*=/
          .test(
            line,
          )
      ) {
        classificationCount++;
      }
      continue;
    }
    if (fenceStart === undefined) {
      fenceStart = index + 1;
      fenceLanguage = fence[1] ?? "";
      classificationCount = 0;
      continue;
    }
    if (fenceLanguage === "toml" && classificationCount >= 2) {
      issues.push({
        file,
        line: fenceStart,
        message:
          "internal agent-surface classification TOML must stay outside shipped instructions",
      });
    }
    fenceStart = undefined;
    fenceLanguage = "";
    classificationCount = 0;
  }
  return issues;
}
