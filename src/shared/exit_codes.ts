/**
 * The complete CLI exit-status contract. Runtime constants and both manual
 * tables derive from this registry, so a status cannot ship undocumented.
 */

export interface ExactExitStatus {
  readonly kind: "exact";
  readonly id:
    | "success"
    | "controlled-failure"
    | "usage"
    | "internal-error"
    | "await-timeout"
    | "executable-not-found"
    | "sighup"
    | "sigint"
    | "sigterm";
  readonly code: number;
  readonly label: string;
  readonly contract: string;
}

export interface ExitStatusClass {
  readonly kind: "class";
  readonly id: "child-passthrough" | "signal-passthrough";
  readonly label: string;
  readonly contract: string;
}

export type ExitStatusEntry = ExactExitStatus | ExitStatusClass;

export const EXIT_STATUS_REGISTRY = [
  {
    kind: "exact",
    id: "success",
    code: 0,
    label: "`0`",
    contract:
      "The command completed successfully. A bare predicate exits `0` when true.",
  },
  {
    kind: "exact",
    id: "controlled-failure",
    code: 1,
    label: "`1`",
    contract:
      "A controlled failure or refusal, a false bare predicate, or an unmet enforcement threshold.",
  },
  {
    kind: "exact",
    id: "usage",
    code: 2,
    label: "`2`",
    contract:
      "The command grammar or arguments were invalid, including a bare quiet-result invocation.",
  },
  {
    kind: "exact",
    id: "internal-error",
    code: 70,
    label: "`70`",
    contract: "discern crashed on an unexpected internal error.",
  },
  {
    kind: "exact",
    id: "await-timeout",
    code: 124,
    label: "`124`",
    contract:
      "`discern await` reached its call budget before the watched condition held; its result includes the continuation handle.",
  },
  {
    kind: "exact",
    id: "executable-not-found",
    code: 127,
    label: "`127`",
    contract:
      "A child executable selected by an exec-style boundary could not be started.",
  },
  {
    kind: "exact",
    id: "sighup",
    code: 129,
    label: "`129`",
    contract:
      "An interrupted run preserved the conventional status derived from SIGHUP.",
  },
  {
    kind: "exact",
    id: "sigint",
    code: 130,
    label: "`130`",
    contract:
      "An interrupted run preserved the conventional status derived from SIGINT.",
  },
  {
    kind: "exact",
    id: "sigterm",
    code: 143,
    label: "`143`",
    contract:
      "An interrupted run preserved the conventional status derived from SIGTERM.",
  },
  {
    kind: "class",
    id: "child-passthrough",
    label: "Child status",
    contract:
      "`discern queue -- <command>` and `discern scripts <name>` preserve a started child's own exit status.",
  },
  {
    kind: "class",
    id: "signal-passthrough",
    label: "Other signal status",
    contract:
      "A platform-reported child signal preserves its conventional signal status when available.",
  },
] as const satisfies readonly ExitStatusEntry[];

type ExactExitId = ExactExitStatus["id"];

/** Resolve one exact status by stable registry id. */
export function exactExitCode(id: ExactExitId): number {
  const entry = EXIT_STATUS_REGISTRY.find((candidate) =>
    candidate.kind === "exact" && candidate.id === id
  );
  if (entry === undefined || entry.kind !== "exact") {
    throw new TypeError(`Unknown exact exit status: ${id}`);
  }
  return entry.code;
}

export const EXIT_SUCCESS = exactExitCode("success");
export const EXIT_CONTROLLED_FAILURE = exactExitCode("controlled-failure");
export const EXIT_USAGE = exactExitCode("usage");
export const EXIT_INTERNAL_ERROR = exactExitCode("internal-error");
export const EXIT_AWAIT_TIMEOUT = exactExitCode("await-timeout");
export const EXIT_EXECUTABLE_NOT_FOUND = exactExitCode("executable-not-found");
export const EXIT_SIGHUP = exactExitCode("sighup");
export const EXIT_SIGINT = exactExitCode("sigint");
export const EXIT_SIGTERM = exactExitCode("sigterm");

/** Render the one table used by every manual projection. */
export function renderExitStatusTable(): string {
  return [
    "| Exit status | Contract |",
    "| --- | --- |",
    ...EXIT_STATUS_REGISTRY.map((entry) =>
      `| ${entry.label} | ${entry.contract} |`
    ),
  ].join("\n");
}

export const EXIT_STATUS_TABLE_BEGIN =
  "<!-- BEGIN GENERATED: CLI exit statuses -->";
export const EXIT_STATUS_TABLE_END =
  "<!-- END GENERATED: CLI exit statuses -->";

/** Replace the marker-delimited manual projection from the registry. */
export function replaceExitStatusTable(document: string): string {
  const start = document.indexOf(EXIT_STATUS_TABLE_BEGIN);
  const end = document.indexOf(EXIT_STATUS_TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("manual is missing the CLI exit-status markers");
  }
  const before = document.slice(0, start + EXIT_STATUS_TABLE_BEGIN.length);
  const after = document.slice(end);
  return `${before}\n\n${renderExitStatusTable()}\n\n${after}`;
}
