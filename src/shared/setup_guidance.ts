/**
 * Closed, executable guidance contracts used by the setup brief.
 *
 * The setup journey asks an unfamiliar agent to make bounded judgments about
 * diagnostic reporters, Map scope, and worktree readiness. Those judgments must
 * not live only as examples in prose: this module owns the small canonical sets
 * and pure policies, while `templates/setup/instructions.md` carries tokens that
 * render from them. Tests can therefore exercise future members and representative
 * repository shapes without maintaining a second copy of the guidance.
 */

import { dirname, isAbsolute, relative, resolve } from "@std/path";

export const SETUP_PROJECT_NAME_SOURCES = [
  "readme-title",
  "package-name",
  "project-metadata",
  "directory-fallback",
] as const;
export type SetupProjectNameSource = typeof SETUP_PROJECT_NAME_SOURCES[number];

export interface SetupProjectNameEvidence {
  readonly source: SetupProjectNameSource;
  readonly value: string;
  readonly location: string;
}

export interface SetupProjectNameRecommendation {
  readonly proposed: string;
  readonly evidence: readonly SetupProjectNameEvidence[];
  readonly fallbackOnly: boolean;
  readonly conflicting: readonly SetupProjectNameEvidence[];
}

/**
 * Recommend project identity from project-owned evidence. Strong metadata beats
 * a checkout directory or clone suffix; the owner still confirms the result.
 */
export function recommendSetupProjectName(
  candidates: readonly SetupProjectNameEvidence[],
): SetupProjectNameRecommendation {
  const usable = candidates.filter((candidate) => candidate.value.trim() !== "")
    .map((candidate) => ({ ...candidate, value: candidate.value.trim() }));
  if (usable.length === 0) {
    throw new Error("Setup project-name recommendation needs one candidate.");
  }
  const strong = usable.filter((candidate) =>
    candidate.source !== "directory-fallback"
  );
  const pool = strong.length > 0 ? strong : usable;
  const scores = new Map<
    string,
    { value: string; count: number; first: number }
  >();
  for (const [index, candidate] of pool.entries()) {
    const key = candidate.value.toLocaleLowerCase();
    const current = scores.get(key);
    scores.set(key, {
      value: current?.value ?? candidate.value,
      count: (current?.count ?? 0) + 1,
      first: current?.first ?? index,
    });
  }
  const ranked = [...scores.values()].sort((a, b) =>
    b.count - a.count || a.first - b.first
  );
  const winner = ranked[0];
  if (winner === undefined) {
    throw new Error("Setup project-name recommendation has no usable value.");
  }
  const evidence = pool.filter((candidate) =>
    candidate.value.toLocaleLowerCase() === winner.value.toLocaleLowerCase()
  );
  return {
    proposed: winner.value,
    evidence,
    fallbackOnly: strong.length === 0,
    conflicting: strong.filter((candidate) =>
      candidate.value.toLocaleLowerCase() !== winner.value.toLocaleLowerCase()
    ),
  };
}

export interface SetupReferencedPath {
  readonly sourceFile: string;
  readonly reference: string;
  readonly resolved: string;
  readonly apparentRole: string;
  readonly location: "inside-project" | "outside-project";
  readonly destinationReadAllowed: false;
}

/** Classify a project-file path reference without touching its destination. */
export function classifySetupReferencedPath(
  projectRoot: string,
  sourceFile: string,
  reference: string,
  apparentRole: string,
): SetupReferencedPath {
  const absoluteRoot = resolve(projectRoot);
  const absoluteSource = isAbsolute(sourceFile)
    ? resolve(sourceFile)
    : resolve(absoluteRoot, sourceFile);
  const resolvedReference = isAbsolute(reference)
    ? resolve(reference)
    : resolve(dirname(absoluteSource), reference);
  const fromRoot = relative(absoluteRoot, resolvedReference);
  const outside = fromRoot === ".." ||
    fromRoot.startsWith("../") || fromRoot.startsWith("..\\") ||
    isAbsolute(fromRoot);
  return {
    sourceFile,
    reference,
    resolved: resolvedReference,
    apparentRole,
    location: outside ? "outside-project" : "inside-project",
    destinationReadAllowed: false,
  };
}

export interface SetupExternalInspectionDirection {
  readonly sourceFile: string;
  readonly resolved: string;
  readonly ownerDirected: true;
  readonly purpose: string;
}

/** Record the bounded owner direction required before an external read. */
export function authorizeSetupExternalInspection(
  reference: SetupReferencedPath,
  purpose: string,
): SetupExternalInspectionDirection {
  if (reference.location !== "outside-project") {
    throw new Error(
      "Only a repository-external reference needs this direction.",
    );
  }
  if (purpose.trim() === "") {
    throw new Error("External inspection direction needs a specific purpose.");
  }
  return {
    sourceFile: reference.sourceFile,
    resolved: reference.resolved,
    ownerDirected: true,
    purpose: purpose.trim(),
  };
}

/** Apply the boundary before any caller-provided external reader can run. */
export async function inspectSetupExternalReference<T>(
  reference: SetupReferencedPath,
  direction: SetupExternalInspectionDirection | undefined,
  reader: (resolvedPath: string) => Promise<T>,
): Promise<T> {
  if (
    direction === undefined || !direction.ownerDirected ||
    direction.sourceFile !== reference.sourceFile ||
    direction.resolved !== reference.resolved
  ) {
    throw new Error(
      `Owner direction is required before reading repository-external path ${reference.resolved}.`,
    );
  }
  return await reader(reference.resolved);
}

/** The worktree-readiness categories every setup must inspect. */
export const SETUP_READINESS_CATEGORIES = [
  {
    id: "untracked-file-database",
    resource: "Untracked file database",
    inspect:
      "Does each worktree need its own file, migration, or seed instead of sharing the main checkout's file?",
    response:
      "Create or copy a per-worktree file through one-shot setup, then prove the smoke command uses it.",
  },
  {
    id: "tracked-binary-database",
    resource: "Tracked binary database",
    inspect:
      "Will concurrent worktrees mutate the tracked file, and are binary merges acceptable?",
    response:
      "Git already carries the file, so add no provisioning recipe unless the project needs one; record an owner decision when concurrent mutation or binary merging is unsafe.",
  },
  {
    id: "local-service",
    resource: "Local service",
    inspect:
      "Does each worktree need a separate database, emulator, container, or process?",
    response:
      "Use a declared per-worktree resource only after its create, destroy, cost, and data policy are settled.",
  },
  {
    id: "hosted-shared-service",
    resource: "Hosted or shared service",
    inspect:
      "Can parallel work safely share it, and who owns the data, credentials, quotas, and cost?",
    response:
      "Prefer an isolated disposable target; otherwise record the sharing risk and leave the resource choice to the owner.",
  },
  {
    id: "environment",
    resource: "Environment and secrets",
    inspect: "Which untracked files or values must exist in a fresh worktree?",
    response:
      "Use supported environment inheritance or one-shot setup without committing secrets.",
  },
  {
    id: "dependencies",
    resource: "Dependencies and generated runtime state",
    inspect:
      "What is absent from a fresh checkout, and how can convergence stay fast when current?",
    response:
      "Use an idempotent check-then-install ensure command; a new dependency still needs owner consent.",
  },
  {
    id: "ports",
    resource: "Ports",
    inspect: "Can simultaneous worktrees bind the same fixed port?",
    response:
      "Use the supported per-worktree port value and pass it to the project's command instead of inventing a second allocator.",
  },
  {
    id: "owner-gated-resource",
    resource: "Other cost- or data-bearing resource",
    inspect:
      "Would creation, mutation, or teardown spend money, touch durable data, or broaden access?",
    response:
      "Stop for an owner decision; if unresolved, record one concrete ledger item with the evidence and consequence.",
  },
] as const;

/** Render the readiness authority into the one authored setup-page token. */
export function renderSetupReadinessTable(): string {
  return [
    "| Readiness category | Inspect | Supported response |",
    "| --- | --- | --- |",
    ...SETUP_READINESS_CATEGORIES.map((row) =>
      `| **${row.resource}** | ${row.inspect} | ${row.response} |`
    ),
  ].join("\n");
}

export type SetupReporterAction =
  | "normal"
  | "structured"
  | "structured-on-failure";

/** Facts that determine whether a reporter helps the captured Gate result. */
export interface SetupReporterProfile {
  readonly recognized: boolean;
  readonly captured: boolean;
  readonly preservesExitStatus: boolean;
  readonly improvesFailureDiagnostics: boolean;
  readonly normalOutputMachineReadable: boolean;
  readonly structuredOutputVerbose: boolean;
  readonly failureOnlyAvailable: boolean;
}

/**
 * Select the least noisy reporter mode that can improve a failed diagnostic.
 * A correct exit status is a hard boundary; file-only or unrecognized output
 * cannot justify changing the routine Gate command.
 */
export function setupReporterAction(
  profile: SetupReporterProfile,
): SetupReporterAction {
  if (
    !profile.recognized || !profile.captured ||
    !profile.preservesExitStatus || !profile.improvesFailureDiagnostics ||
    profile.normalOutputMachineReadable
  ) {
    return "normal";
  }
  if (profile.structuredOutputVerbose) {
    return profile.failureOnlyAvailable ? "structured-on-failure" : "normal";
  }
  return "structured";
}

/** Representative reporter families rendered into the setup page and tested. */
export const SETUP_REPORTER_EXAMPLES: ReadonlyArray<{
  readonly family: string;
  readonly profile: SetupReporterProfile;
  readonly guidance: string;
}> = [
  {
    family: "JUnit or XML written only to a file",
    profile: {
      recognized: true,
      captured: false,
      preservesExitStatus: true,
      improvesFailureDiagnostics: true,
      normalOutputMachineReadable: false,
      structuredOutputVerbose: true,
      failureOnlyAvailable: false,
    },
    guidance:
      "Keep concise terminal output for the Gate. On failure, expose or inspect the report artifact without replacing the tool's exit status.",
  },
  {
    family: "Bounded JSON stream on stdout or stderr",
    profile: {
      recognized: true,
      captured: true,
      preservesExitStatus: true,
      improvesFailureDiagnostics: true,
      normalOutputMachineReadable: false,
      structuredOutputVerbose: false,
      failureOnlyAvailable: false,
    },
    guidance:
      "Use the structured stream when it remains concise and the original process status reaches discern.",
  },
  {
    family: "TAP-like normal output",
    profile: {
      recognized: true,
      captured: true,
      preservesExitStatus: true,
      improvesFailureDiagnostics: true,
      normalOutputMachineReadable: true,
      structuredOutputVerbose: false,
      failureOnlyAvailable: false,
    },
    guidance:
      "Keep the normal command: its captured output is already useful to machines and people.",
  },
  {
    family: "Inherently verbose structured mode",
    profile: {
      recognized: true,
      captured: true,
      preservesExitStatus: true,
      improvesFailureDiagnostics: true,
      normalOutputMachineReadable: false,
      structuredOutputVerbose: true,
      failureOnlyAvailable: true,
    },
    guidance:
      "Keep the green path concise and enable or parse structured detail only after failure.",
  },
  {
    family: "Wrapper that masks the original status",
    profile: {
      recognized: true,
      captured: true,
      preservesExitStatus: false,
      improvesFailureDiagnostics: true,
      normalOutputMachineReadable: false,
      structuredOutputVerbose: false,
      failureOnlyAvailable: false,
    },
    guidance:
      "Reject the wrapper. Diagnostic parsing never outranks a correct failing exit status.",
  },
];

/** Render reporter examples from the same profiles the policy tests exercise. */
export function renderSetupReporterTable(): string {
  return [
    "| Reporter family | Gate policy | Why |",
    "| --- | --- | --- |",
    ...SETUP_REPORTER_EXAMPLES.map((example) =>
      `| **${example.family}** | \`${
        setupReporterAction(example.profile)
      }\` | ${example.guidance} |`
    ),
  ].join("\n");
}

/** Evidence for one durable subsystem boundary considered during setup. */
export interface SetupBoundaryEvidence {
  readonly name: string;
  readonly primary: boolean;
  readonly durable: boolean;
  readonly reducesFutureReading: boolean;
}

/** A concrete unresolved item eligible for the deferred-work ledger. */
export interface SetupLedgerCandidate {
  readonly title: string;
  readonly evidence: string;
  readonly kind: "decision" | "defect" | "aspiration" | "fact";
  readonly alreadyExpressedByConfig: boolean;
}

/** The bounded Map and ledger recommendation produced by the setup heuristic. */
export interface SetupDocumentationScope {
  readonly pages: readonly string[];
  readonly ledgerItems: readonly string[];
}

/**
 * Apply setup's proportional documentation floor. Exactly one primary boundary
 * is always selected; additional pages require both a durable boundary and a
 * demonstrable reduction in future repository reading. Ledger entries require
 * a concrete title and evidence, must be an unresolved decision or defect, and
 * must not repeat a fact already expressed by configuration.
 */
export function recommendSetupDocumentationScope(
  boundaries: readonly SetupBoundaryEvidence[],
  ledger: readonly SetupLedgerCandidate[],
): SetupDocumentationScope {
  const primaries = boundaries.filter((candidate) => candidate.primary);
  const primary = primaries[0];
  if (primary === undefined || primaries.length !== 1) {
    throw new Error(
      "Setup documentation scope requires exactly one primary subsystem boundary.",
    );
  }
  const pages = boundaries
    .filter((candidate) =>
      candidate === primary ||
      (candidate.durable && candidate.reducesFutureReading)
    )
    .map((candidate) => candidate.name);
  const ledgerItems = ledger
    .filter((candidate) =>
      candidate.title.trim().length > 0 &&
      candidate.evidence.trim().length > 0 &&
      (candidate.kind === "decision" || candidate.kind === "defect") &&
      !candidate.alreadyExpressedByConfig
    )
    .map((candidate) => candidate.title);
  return { pages, ledgerItems };
}

/** Render three calibrated examples without hand-counting their outcomes. */
export function renderSetupScopeExamples(): string {
  const examples: ReadonlyArray<{
    readonly label: string;
    readonly boundaries: readonly SetupBoundaryEvidence[];
    readonly ledger: readonly SetupLedgerCandidate[];
  }> = [
    {
      label: "Small project",
      boundaries: [{
        name: "primary runtime",
        primary: true,
        durable: true,
        reducesFutureReading: true,
      }],
      ledger: [],
    },
    {
      label: "Medium project",
      boundaries: [
        {
          name: "primary runtime",
          primary: true,
          durable: true,
          reducesFutureReading: true,
        },
        {
          name: "delivery boundary",
          primary: false,
          durable: true,
          reducesFutureReading: true,
        },
        {
          name: "small helper folder",
          primary: false,
          durable: false,
          reducesFutureReading: false,
        },
      ],
      ledger: [{
        title: "Choose the deployment retry policy",
        evidence: "Two active implementations disagree in code.",
        kind: "decision",
        alreadyExpressedByConfig: false,
      }],
    },
    {
      label: "Multi-subsystem project",
      boundaries: [
        {
          name: "primary runtime",
          primary: true,
          durable: true,
          reducesFutureReading: true,
        },
        {
          name: "data boundary",
          primary: false,
          durable: true,
          reducesFutureReading: true,
        },
        {
          name: "external integration boundary",
          primary: false,
          durable: true,
          reducesFutureReading: true,
        },
      ],
      ledger: [{
        title: "Resolve shared test-data ownership",
        evidence: "Parallel suites mutate the same hosted fixture set.",
        kind: "defect",
        alreadyExpressedByConfig: false,
      }],
    },
  ];
  return examples.map((example) => {
    const scope = recommendSetupDocumentationScope(
      example.boundaries,
      example.ledger,
    );
    return `- **${example.label}:** ${scope.pages.length} substantive subsystem page${
      scope.pages.length === 1 ? "" : "s"
    } (${
      scope.pages.join(", ")
    }); ${scope.ledgerItems.length} concrete ledger item${
      scope.ledgerItems.length === 1 ? "" : "s"
    }${
      scope.ledgerItems.length === 0
        ? "."
        : ` (${scope.ledgerItems.join(", ")}).`
    }`;
  }).join("\n");
}
