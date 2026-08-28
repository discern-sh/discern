/**
 * The `setup` wizard: resolve a complete `SetupConfig` from CLI flags and, when
 * interactive, from terminal requests. Every requested value has a flag
 * equivalent, so the whole wizard is skippable for CI/agent runs (`--yes` +
 * flags). Requests are only reached on a TTY with `--yes` absent.
 */

import {
  renderDestructiveActionNoticeCli,
  renderDialogCli,
} from "discern-design-system/cli";
import {
  createSequentialForm,
  InteractionCancelled as PackageInteractionCancelled,
  type InteractionChoicePresentation,
  type InteractionCompletionPolicy,
  type InteractionEntry,
  type InteractionRuntime as PackageInteractionRuntime,
  type MarkdownBrowserEntry as PackageMarkdownBrowserEntry,
  type MarkdownBrowserLinkResolution as PackageMarkdownBrowserLinkResolution,
  type MarkdownBrowserLinkResolverInput
    as PackageMarkdownBrowserLinkResolverInput,
  type MarkdownBrowserOptions as PackageMarkdownBrowserOptions,
  MarkdownBrowserRefusalError as PackageMarkdownBrowserRefusalError,
  type MarkdownBrowserResumableState as PackageMarkdownBrowserResumableState,
  requestAcknowledgement as packageRequestAcknowledgement,
  requestConfirmation as packageRequestConfirmation,
  requestMarkdownBrowser as packageRequestMarkdownBrowser,
  requestSearch as packageRequestSearch,
  requestSelection as packageRequestSelection,
  requestSelections as packageRequestSelections,
  requestText as packageRequestText,
  type SelectionsRequestOptions as PackageSelectionsRequestOptions,
  type TerminalIO,
} from "discern-design-system/cli/interactive";
import { bestEffortSync } from "../shared/best_effort.ts";
import {
  type AgentName,
  DEFAULTS,
  isValidSlug,
  KNOWN_AGENTS,
  parseAgents,
  parseSourceGlobs,
  type SetupConfig,
  SLUG_RULE,
  slugify,
} from "./config.ts";
import type { ConfirmationLabels } from "../shared/confirmation.ts";
import { PROVIDERS } from "./providers.ts";
import type { Logger } from "./log.ts";
import { normalizeMapDir } from "../shared/map_path.ts";
import type { EnvReader } from "../shared/env.ts";
import { runGit, SPAWN_FAILED } from "../shared/subprocess.ts";
import {
  type HumanOutputGroup,
  populatedHumanOutputGroups,
} from "../shared/result.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../shared/environment_variables.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalInteractionIo,
  terminalLine,
  terminalMultiline,
  terminalSize,
} from "./terminal.ts";

/** Process-wide CLI choice set once by `main` from the global `--plain` flag. */
let plainMode = false;
/** Process-wide quiet-result choice set once by `main` from a result-format flag. */
let jsonMode = false;

/** Thread the global static-output choice into every interaction choke point. */
export function setPlainMode(enabled: boolean): void {
  plainMode = enabled;
}

/** Thread the global quiet-result choice into every interaction choke point. */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/** Whether the global CLI requested static, non-interactive output. */
export function plainModeEnabled(): boolean {
  return plainMode;
}

/** Whether the global CLI requested a quiet result format. */
export function jsonModeEnabled(): boolean {
  return jsonMode;
}

/** Raw flag values passed to `setup` (all optional; undefined → ask/default). */
export interface InitFlags {
  name?: string | undefined;
  slug?: string | undefined;
  branchPrefix?: string | undefined;
  sourceGlobs?: string | undefined;
  brief?: string | undefined;
  agents?: string | undefined;
  map?: string | undefined;
  yes?: boolean | undefined;
}

/** Resolve the `--brief` flag value: a literal, or `@path` read from disk. */
export async function resolveBrief(value: string): Promise<string> {
  if (!value.startsWith("@")) {
    return value;
  }
  const path = value.slice(1);
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read brief file "${path}": ${message}`);
  }
}

/**
 * Whether interactive input may be requested. `--yes`, global `--plain`, global
 * `--json`, CI, and either non-terminal stream independently veto interaction.
 * The environment and stream probe are injectable so the whole decision is
 * testable without manufacturing a terminal.
 */
export function canInteract(
  yes: boolean,
  env: EnvReader = Deno.env,
  streams: () => { stdin: boolean; stdout: boolean } = () => ({
    stdin: Deno.stdin.isTerminal(),
    stdout: Deno.stdout.isTerminal(),
  }),
): boolean {
  return interactionAllowed(yes, plainMode, jsonMode, env, streams);
}

/** Pure form of the interaction policy for exhaustive unit testing. */
export function interactionAllowed(
  yes: boolean,
  plain: boolean,
  json: boolean,
  env: EnvReader,
  streams: () => { stdin: boolean; stdout: boolean },
): boolean {
  const ci = env.get("CI")?.trim().toLowerCase();
  if (
    yes || plain || json ||
    (ci !== undefined && ci !== "" && ci !== "false")
  ) {
    return false;
  }
  const terminal = streams();
  return terminal.stdin && terminal.stdout;
}

type MaybePromise<T> = T | Promise<T>;
type InteractionValidation = true | string;

/** One framework-neutral product choice. `id` is required for non-primitives. */
export interface SelectionOption<T> {
  readonly kind?: "choice";
  readonly id?: string;
  readonly name: string;
  /** Secondary product text, such as a filename or destination. */
  readonly description?: string;
  readonly value: T;
  readonly disabled?: boolean;
  /** Initial multi-select state retained for the docs export picker. */
  readonly checked?: boolean;
}

/** One first-class semantic heading. It carries no selectable value. */
export interface SelectionHeading {
  readonly kind: "group-heading";
  readonly id: string;
  readonly name: string;
  /** Secondary product text describing the grouped destination. */
  readonly description?: string;
}

/** Choices and structural headings accepted by the product interaction adapter. */
export type SelectionEntry<T> = SelectionOption<T> | SelectionHeading;

/** Narrow a shared selection entry without duplicating heading vocabulary. */
export function isSelectionHeading<T>(
  entry: SelectionEntry<T>,
): entry is SelectionHeading {
  return entry.kind === "group-heading";
}

/** One semantic heading in the product's Markdown-browser corpus. */
export interface MarkdownBrowserGroupHeading {
  readonly kind: "group-heading";
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/** One admitted Markdown document supplied to the package browser. */
export interface MarkdownBrowserDocument {
  readonly kind: "document";
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Stable forward-slash path relative to the admitted corpus root. */
  readonly path: string;
  /** Markdown source; the package remains the rendering and safety authority. */
  readonly source: string;
}

/** One product action returned only after the package restores the terminal. */
export interface MarkdownBrowserAction<Action> {
  readonly kind: "action";
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly value: Action;
}

/** One explicit browser exit kept distinct from product actions. */
export interface MarkdownBrowserExit {
  readonly kind: "exit";
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

/** Product-owned corpus data accepted by the Markdown-browser adapter. */
export type MarkdownBrowserEntry<Action> =
  | MarkdownBrowserGroupHeading
  | MarkdownBrowserDocument
  | MarkdownBrowserAction<Action>
  | MarkdownBrowserExit;

/** Admitted document fact supplied to product link resolution. */
export interface MarkdownBrowserDocumentFact {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

/** Product context for resolving one link inside the admitted corpus. */
export interface MarkdownBrowserLinkResolverInput {
  readonly sourceDocumentId: string;
  readonly sourcePath: string;
  readonly destination: string;
  readonly availableDocuments: readonly MarkdownBrowserDocumentFact[];
}

/** Closed product outcomes for an admitted Markdown destination. */
export type MarkdownBrowserLinkResolution =
  | {
    readonly kind: "document";
    readonly documentId: string;
    readonly fragment?: string;
  }
  | { readonly kind: "fragment"; readonly fragment: string }
  | { readonly kind: "external"; readonly destination: string }
  | { readonly kind: "unresolved"; readonly message?: string };

/** Package state retained opaquely across product-owned external effects. */
export type MarkdownBrowserResumeState = PackageMarkdownBrowserResumableState;

/** Framework-neutral options for one complete Markdown browsing request. */
export interface MarkdownBrowserRequestOptions<Action> {
  readonly message: string;
  readonly entries: readonly MarkdownBrowserEntry<Action>[];
  readonly searchLabel?: string;
  readonly initialState?: MarkdownBrowserResumeState;
  readonly documentMeasure?: number;
  readonly mouse?: boolean;
  readonly resolveLink?: (
    input: MarkdownBrowserLinkResolverInput,
  ) => MaybePromise<MarkdownBrowserLinkResolution>;
}

/** Product result after the complete-frame terminal has been restored. */
export type MarkdownBrowserRequestResult<Action> =
  | {
    readonly kind: "action";
    readonly id: string;
    readonly value: Action;
    readonly state: MarkdownBrowserResumeState;
  }
  | {
    readonly kind: "external-link";
    readonly id: string;
    readonly destination: string;
    readonly sourceDocumentId: string;
    readonly sourcePath: string;
    readonly state: MarkdownBrowserResumeState;
  }
  | {
    readonly kind: "exit";
    readonly id: string;
    readonly state: MarkdownBrowserResumeState;
  }
  | {
    readonly kind: "refused";
    readonly reason: "ansi-control-unavailable" | "terminal-too-small";
    readonly columns: number;
    readonly rows: number;
  };

/** Framework-neutral options for one product selection request. */
export interface SelectionRequestOptions<T> {
  readonly message: string;
  readonly options: readonly SelectionEntry<T>[];
  readonly default?: T;
  readonly hint?: string;
  readonly required?: boolean | string;
  /** Successful-frame cleanup owned by the package request driver. */
  readonly completion?: InteractionCompletionPolicy;
  /** Form chrome or the quieter long-lived browsing treatment. */
  readonly presentation?: InteractionChoicePresentation;
  readonly validate?: (value: T) => MaybePromise<InteractionValidation>;
  /** Use the package search request rather than a static selection request. */
  readonly search?: boolean;
  readonly searchLabel?: string;
  /** Hard ceiling on visible choice rows, below the viewport-derived budget. */
  readonly maxRows?: number;
  /** Rows the caller's composition occupies above this request. The package
   * fitter reserves them while measuring the complete interaction frame. */
  readonly reservedRows?: number;
}

/** Framework-neutral options for one product multi-selection request. */
export interface SelectionsRequestOptions<T> {
  readonly message: string;
  readonly options: readonly SelectionEntry<T>[];
  readonly default?: readonly T[];
  readonly hint?: string;
  readonly minOptions?: number;
  /** Successful-frame cleanup owned by the package request driver. */
  readonly completion?: InteractionCompletionPolicy;
  /** Form chrome or the quieter long-lived browsing treatment. */
  readonly presentation?: InteractionChoicePresentation;
  readonly validate?: (
    value: readonly T[],
  ) => MaybePromise<InteractionValidation>;
  /** Hard ceiling on visible choice rows, below the viewport-derived budget. */
  readonly maxRows?: number;
  /** Rows the caller's composition occupies above this request. The package
   * fitter reserves them while measuring the complete interaction frame. */
  readonly reservedRows?: number;
}

/** Framework-neutral options for one product text request. */
export interface TextRequestSettings {
  readonly message: string;
  readonly default?: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly required?: boolean | string;
  /** Canonicalise a submitted value before required and caller validation. */
  readonly transform?: (value: string) => string;
  readonly validate?: (value: string) => MaybePromise<InteractionValidation>;
}

export type TextRequestOptions = string | TextRequestSettings;

export type SelectionGroup<T> =
  & HumanOutputGroup<SelectionOption<T>>
  & { label: string; description?: string };

/** Injectable interaction runtime used by focused tests and terminal harnesses. */
export interface TerminalInteractionRuntime {
  readonly io?: TerminalIO;
  readonly interactive?: (yes: boolean) => boolean;
  /** Environment read for the diagnostics trace lookup; defaults to the process. */
  readonly env?: EnvReader;
  /** Package session inherited by requests inside one sequential form. */
  readonly packageRuntime?: PackageInteractionRuntime;
}

/** Requests a sequential-form step may compose through the product boundary. */
export interface SequentialInteractionRequests {
  select<T>(options: SelectionRequestOptions<T>): Promise<T>;
  text(options: TextRequestOptions): Promise<string>;
  confirm(
    message: string,
    options: ConfirmationRequestOptions,
  ): Promise<boolean>;
}

/** One conditionally applicable step in a package-owned sequential form. */
export interface SequentialFormRequestStep {
  readonly id: string;
  readonly label: string;
  readonly run: (
    values: Readonly<Record<string, unknown>>,
    previous: unknown,
    requests: SequentialInteractionRequests,
  ) => MaybePromise<unknown>;
  readonly when?: (values: Readonly<Record<string, unknown>>) => boolean;
  /** Non-sensitive progress text shown after this step completes. */
  readonly summarize?: (value: unknown) => string;
}

/** Product vocabulary for one sequential interaction. */
export interface SequentialFormRequestOptions {
  readonly message: string;
  readonly hint?: string;
  readonly steps: readonly SequentialFormRequestStep[];
}

/** Product cancellation meaning for Ctrl+C and terminal end-of-input. */
export class InteractionCancelled extends Error {
  override readonly name = "InteractionCancelled";

  constructor() {
    super("Interaction cancelled.");
  }
}

/** Test whether an error is the product's normalized interaction cancellation. */
export function isInteractionCancelled(
  error: unknown,
): error is InteractionCancelled {
  return error instanceof InteractionCancelled;
}

/** Give one package interaction a leading semantic boundary outside its frame.
 * Every terminal fact and effect delegates unchanged; only the first nonempty
 * write receives the one newline that separates it from prior output. */
export function withInteractionBoundary(target: TerminalIO): TerminalIO {
  let boundaryPending = true;
  const listenResize = target.listenResize === undefined
    ? undefined
    : (handler: () => void): () => void =>
      target.listenResize?.(handler) ??
        (() => {});
  return {
    isInteractive: () => target.isInteractive(),
    capabilities: () => target.capabilities(),
    size: () => target.size(),
    read: () => target.read(),
    setRawMode: (enabled) => target.setRawMode(enabled),
    write: (value): void => {
      if (boundaryPending && value.length > 0) {
        boundaryPending = false;
        target.write("\n");
      }
      target.write(value);
    },
    ...(listenResize === undefined ? {} : { listenResize }),
  };
}

/** Build first-class package headings from named semantic groups. */
export function groupedSelectionEntries<T>(
  groups: readonly SelectionGroup<T>[],
): SelectionEntry<T>[] {
  const populatedIds = new Set(
    populatedHumanOutputGroups(groups).map((group) => group.id),
  );
  return groups.filter((group) => populatedIds.has(group.id)).flatMap(
    (group) => {
      if (group.label === undefined) {
        throw new TypeError(
          `selection group ${JSON.stringify(group.id)} needs a label`,
        );
      }
      return [
        {
          kind: "group-heading",
          id: group.id,
          name: group.label,
          ...(group.description === undefined
            ? {}
            : { description: group.description }),
        } as const,
        ...group.items,
      ];
    },
  );
}

/**
 * Diagnostics: when the registered trace variable names a file, every request
 * appends one JSON line of sizing evidence — the viewport at open, each height
 * reading the package driver sampled, each write's line count, the derived row
 * budget, and the outcome. Observation only: every terminal fact and byte
 * passes through unchanged, and a trace fault never disturbs the interaction.
 */
function interactionTraceTarget(
  env: EnvReader = Deno.env,
): string | undefined {
  try {
    const path = env.get(
      DISCERN_ENVIRONMENT_VARIABLES.interactionTrace,
    );
    return path === undefined || path === "" ? undefined : path;
  } catch {
    // discern-best-effort: terminal-interaction-trace-target-fallback
    return undefined;
  }
}

interface InteractionTraceWrite {
  readonly lines: number;
  readonly control?: true;
}

interface InteractionTraceBudget {
  readonly rows: number;
  readonly reserved: number;
  readonly maxRows?: number;
  readonly derived: number;
}

interface InteractionTrace {
  readonly io: TerminalIO;
  readonly settle: (outcome: string) => void;
}

/** Bound each recorded sequence so a long session cannot grow one record. */
const INTERACTION_TRACE_LIMIT = 500;

/** The last derived budget, joined onto the next request's trace record. */
let pendingBudgetTrace: InteractionTraceBudget | undefined;

/** Wrap one request's io so its sizing evidence can be flushed at settle. */
function traceInteractionIo(target: string, io: TerminalIO): InteractionTrace {
  const opened = io.size();
  const sizeRows: number[] = [];
  const writes: InteractionTraceWrite[] = [];
  const budget = pendingBudgetTrace;
  pendingBudgetTrace = undefined;
  const listenResize = io.listenResize === undefined
    ? undefined
    : (handler: () => void): () => void =>
      io.listenResize?.(handler) ??
        (() => {});
  return {
    io: {
      isInteractive: () => io.isInteractive(),
      capabilities: () => io.capabilities(),
      size: (): { columns: number; rows: number } => {
        const size = io.size();
        if (sizeRows.length < INTERACTION_TRACE_LIMIT) {
          sizeRows.push(size.rows);
        }
        return size;
      },
      read: () => io.read(),
      setRawMode: (enabled) => io.setRawMode(enabled),
      write: (value): void => {
        io.write(value);
        if (writes.length < INTERACTION_TRACE_LIMIT) {
          writes.push({
            lines: value.split("\n").length - 1,
            ...(value.charCodeAt(0) === 27 ? { control: true as const } : {}),
          });
        }
      },
      ...(listenResize === undefined ? {} : { listenResize }),
    },
    settle: (outcome): void => {
      bestEffortSync("terminal-interaction-trace-write", () => {
        // Records carry no clock: append order is the diagnostic timeline.
        Deno.writeTextFileSync(
          target,
          `${
            JSON.stringify({
              opened,
              ...(budget === undefined ? {} : { budget }),
              sizeRows,
              writes,
              outcome,
            })
          }\n`,
          { append: true },
        );
      });
    },
  };
}

/** Never derive a visible-row budget narrower than the package's own default
 * window, so a mis-measured composition can only widen a menu, not crush it. */
const MINIMUM_DERIVED_INTERACTION_ROWS = 5;

/** The one leading boundary row {@link withInteractionBoundary} writes. */
const INTERACTION_BOUNDARY_ROWS = 1;

/**
 * Resolve the visible-row budget for one choice request from the live terminal
 * height at request time: the injected interaction io when a harness supplies
 * one, otherwise the shared process adapter. The caller's `maxRows` remains a
 * hard ceiling and keeps its package validation. The request forwards
 * `reservedRows` separately, so the package measures the complete frame against
 * the viewport left by the caller's composition.
 */
function visibleRowBudget(
  options: { readonly maxRows?: number; readonly reservedRows?: number },
  runtime: TerminalInteractionRuntime,
): number {
  const injected = runtime.io?.size().rows;
  const rows = Number.isFinite(injected) && (injected ?? 0) > 0
    ? Math.floor(injected as number)
    : terminalSize().rows;
  const reserved =
    Number.isFinite(options.reservedRows) && (options.reservedRows ?? 0) > 0
      ? Math.floor(options.reservedRows as number)
      : 0;
  const derived = Math.max(
    MINIMUM_DERIVED_INTERACTION_ROWS,
    rows - INTERACTION_BOUNDARY_ROWS,
  );
  const budget = options.maxRows === undefined
    ? derived
    : Math.min(options.maxRows, derived);
  if (interactionTraceTarget(runtime.env) !== undefined) {
    pendingBudgetTrace = {
      rows,
      reserved,
      ...(options.maxRows === undefined ? {} : { maxRows: options.maxRows }),
      derived: budget,
    };
  }
  return budget;
}

/** Refuse a named interaction unless terminal input and output are available. */
function requireInteraction(
  name: string,
  runtime: TerminalInteractionRuntime,
): void {
  if (plainMode || jsonMode) {
    throw new Error(
      `${name} needs an interactive terminal; remove --plain and --json, leave CI, and attach terminal stdin and stdout.`,
    );
  }
  if (!(runtime.interactive ?? canInteract)(false)) {
    throw new Error(
      `${name} needs an interactive terminal; remove --plain and --json, leave CI, and attach terminal stdin and stdout.`,
    );
  }
}

/** Compare product choice values while treating repeated NaN as one value. */
function sameValue(left: unknown, right: unknown): boolean {
  return left === right || (Number.isNaN(left) && Number.isNaN(right));
}

/** Stable implicit id for a primitive value; complex values require an id. */
function primitiveChoiceId(value: unknown): string | undefined {
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value === "bigint") return `bigint:${String(value)}`;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (Object.is(value, -0)) return "number:-0";
    return `number:${String(value)}`;
  }
  return undefined;
}

/** Encode arbitrary identity text into a control-free, lossless ASCII key. */
function encodedIdentity(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Package identity for one product semantic group. */
function packageGroupId(id: string): string {
  return `group:${encodedIdentity(id)}`;
}

/** Package identity for one explicitly named product choice or browser row. */
function packageExplicitChoiceId(id: string): string {
  return `id:${encodedIdentity(id)}`;
}

interface AdaptedChoices<T> {
  readonly entries: readonly InteractionEntry<T>[];
  readonly idFor: (value: T) => string | undefined;
}

/** Validate product identity and map it once into the package choice contract. */
function adaptChoices<T>(
  entries: readonly SelectionEntry<T>[],
  rejectNullishValues = false,
): AdaptedChoices<T> {
  const values: T[] = [];
  const productIds = new Set<string>();
  const groupIds = new Set<string>();
  const explicitIds = new Set<string>();
  const valueIds: Array<{ readonly value: T; readonly id: string }> = [];
  const adapted = entries.map((entry, index): InteractionEntry<T> => {
    if (entry.kind === "group-heading") {
      if (entry.id.trim() === "") {
        throw new TypeError(`selection group ${index + 1} has a blank id`);
      }
      if (groupIds.has(entry.id)) {
        throw new TypeError(
          `selection group id ${JSON.stringify(entry.id)} is repeated`,
        );
      }
      const label = terminalLine(entry.name);
      if (label.trim() === "") {
        throw new TypeError(
          `selection group ${JSON.stringify(entry.id)} has a blank label`,
        );
      }
      groupIds.add(entry.id);
      const productId = packageGroupId(entry.id);
      productIds.add(productId);
      return {
        kind: "group-heading",
        id: productId,
        label,
        ...(entry.description === undefined
          ? {}
          : { description: terminalLine(entry.description) }),
      };
    }

    if (
      rejectNullishValues && (entry.value === null || entry.value === undefined)
    ) {
      throw new TypeError(
        "A single-selection choice cannot use null or undefined as its value.",
      );
    }
    if (values.some((value) => sameValue(value, entry.value))) {
      throw new TypeError(
        `selection choice ${index + 1} repeats a selectable value`,
      );
    }
    values.push(entry.value);
    const implicit = primitiveChoiceId(entry.value);
    if (entry.id === undefined && implicit === undefined) {
      throw new TypeError(
        `selection choice ${
          index + 1
        } needs an explicit id because its value is not a supported primitive`,
      );
    }
    if (entry.id !== undefined) {
      if (entry.id.trim() === "") {
        throw new TypeError(`selection choice ${index + 1} has a blank id`);
      }
      if (explicitIds.has(entry.id)) {
        throw new TypeError(
          `selection choice id ${JSON.stringify(entry.id)} is repeated`,
        );
      }
      explicitIds.add(entry.id);
    }
    const productId = entry.id === undefined
      ? `value:${encodedIdentity(implicit ?? "")}`
      : packageExplicitChoiceId(entry.id);
    if (productIds.has(productId)) {
      throw new TypeError(
        `selection choice id ${JSON.stringify(entry.id)} is repeated`,
      );
    }
    productIds.add(productId);
    valueIds.push({ value: entry.value, id: productId });
    return {
      id: productId,
      label: terminalLine(entry.name),
      ...(entry.description === undefined
        ? {}
        : { description: terminalLine(entry.description) }),
      value: entry.value,
      ...(entry.disabled === undefined ? {} : { disabled: entry.disabled }),
    };
  });

  return {
    entries: adapted,
    idFor: (value) =>
      valueIds.find((candidate) => sameValue(candidate.value, value))?.id,
  };
}

interface AdaptedMarkdownBrowserEntries<Action> {
  readonly entries: readonly PackageMarkdownBrowserEntry<Action>[];
  readonly productIdForPackageId: (id: string) => string | undefined;
  readonly packageDocumentIdForProductId: (id: string) => string | undefined;
}

/** Validate and map a complete product corpus through the shared ID authority. */
function adaptMarkdownBrowserEntries<Action>(
  entries: readonly MarkdownBrowserEntry<Action>[],
): AdaptedMarkdownBrowserEntries<Action> {
  const groupIds = new Set<string>();
  const selectableIds = new Set<string>();
  const productByPackage = new Map<string, string>();
  const documentPackageByProduct = new Map<string, string>();
  const adapted = entries.map(
    (entry, index): PackageMarkdownBrowserEntry<Action> => {
      const group = entry.kind === "group-heading";
      const ids = group ? groupIds : selectableIds;
      if (entry.id.trim() === "") {
        throw new TypeError(
          `Markdown browser ${group ? "group" : "entry"} ${
            index + 1
          } has a blank id.`,
        );
      }
      if (ids.has(entry.id)) {
        throw new TypeError(
          `Markdown browser ${group ? "group" : "entry"} id ${
            JSON.stringify(entry.id)
          } is repeated.`,
        );
      }
      ids.add(entry.id);
      const packageId = group
        ? packageGroupId(entry.id)
        : packageExplicitChoiceId(entry.id);
      productByPackage.set(packageId, entry.id);
      const label = terminalLine(entry.name);
      if (label.trim() === "") {
        throw new TypeError(
          `Markdown browser entry ${
            JSON.stringify(entry.id)
          } has a blank label.`,
        );
      }
      const description = entry.description === undefined
        ? undefined
        : terminalLine(entry.description);
      switch (entry.kind) {
        case "group-heading":
          return {
            kind: entry.kind,
            id: packageId,
            label,
            ...(description === undefined ? {} : { description }),
          };
        case "document":
          documentPackageByProduct.set(entry.id, packageId);
          return {
            kind: entry.kind,
            id: packageId,
            label,
            ...(description === undefined ? {} : { description }),
            path: entry.path,
            source: entry.source,
          };
        case "action":
          return {
            kind: entry.kind,
            id: packageId,
            label,
            ...(description === undefined ? {} : { description }),
            value: entry.value,
          };
        case "exit":
          return {
            kind: entry.kind,
            id: packageId,
            label,
            ...(description === undefined ? {} : { description }),
          };
      }
    },
  );
  return {
    entries: adapted,
    productIdForPackageId: (id) => productByPackage.get(id),
    packageDocumentIdForProductId: (id) => documentPackageByProduct.get(id),
  };
}

/** Translate one product resolver outcome back into package corpus identity. */
function packageMarkdownBrowserResolution<Action>(
  resolution: MarkdownBrowserLinkResolution,
  entries: AdaptedMarkdownBrowserEntries<Action>,
): PackageMarkdownBrowserLinkResolution {
  if (resolution.kind !== "document") return resolution;
  const documentId = entries.packageDocumentIdForProductId(
    resolution.documentId,
  );
  if (documentId === undefined) {
    throw new TypeError(
      `Markdown browser resolver returned unknown document id ${
        JSON.stringify(resolution.documentId)
      }.`,
    );
  }
  return {
    kind: "document",
    documentId,
    ...(resolution.fragment === undefined
      ? {}
      : { fragment: resolution.fragment }),
  };
}

/** Adapt package link facts into the product's stable corpus identities. */
async function resolveMarkdownBrowserLink<Action>(
  input: PackageMarkdownBrowserLinkResolverInput,
  entries: AdaptedMarkdownBrowserEntries<Action>,
  resolver: NonNullable<MarkdownBrowserRequestOptions<Action>["resolveLink"]>,
): Promise<PackageMarkdownBrowserLinkResolution> {
  const sourceDocumentId = entries.productIdForPackageId(
    input.sourceDocumentId,
  );
  if (sourceDocumentId === undefined) {
    throw new TypeError(
      "Markdown browser link source is not an admitted product document.",
    );
  }
  const availableDocuments = input.availableDocuments.map((document) => {
    const id = entries.productIdForPackageId(document.id);
    if (id === undefined) {
      throw new TypeError(
        "Markdown browser link inventory contains an unknown document.",
      );
    }
    return {
      id,
      name: terminalLine(document.label),
      path: document.path,
    };
  });
  const resolution = await resolver({
    sourceDocumentId,
    sourcePath: input.sourcePath,
    destination: input.destination,
    availableDocuments,
  });
  return packageMarkdownBrowserResolution(resolution, entries);
}

/** Adapt the product validator's true/string convention to the package. */
function packageValidator<T>(
  validate: ((value: T) => MaybePromise<InteractionValidation>) | undefined,
): ((value: T) => Promise<string | undefined>) | undefined {
  if (validate === undefined) return undefined;
  return async (value): Promise<string | undefined> => {
    const verdict = await validate(value);
    return verdict === true ? undefined : terminalLine(verdict);
  };
}

interface PackageInteractionSession {
  readonly runtime: PackageInteractionRuntime & { readonly io: TerminalIO };
  /** Start a package form with the same traced IO and presentation runtime. */
  readonly sequentialForm: (
    options: Readonly<{ label: string; hint?: string }>,
  ) => ReturnType<typeof createSequentialForm>;
  /** End a frame whose unexpected exception bypassed the package's finish. */
  readonly terminateUnexpectedFrame: () => void;
  /** Flush this request's diagnostic trace record, when tracing is active. */
  readonly settleTrace?: (outcome: string) => void;
}

interface PackageInteractionSessionOptions {
  /** Inline requests need one boundary; alternate-screen requests do not. */
  readonly leadingBoundary: boolean;
  /** Inline painters need a final newline when an unexpected fault bypasses finish. */
  readonly terminateUnexpectedFrame: boolean;
  /** Give a typed non-value outcome its own trace label before rethrowing it. */
  readonly errorOutcome?: (error: unknown) => string | undefined;
}

/** Construct one package runtime after policy has allowed interaction. */
function packageInteractionRuntime(
  runtime: TerminalInteractionRuntime,
  options: PackageInteractionSessionOptions = {
    leadingBoundary: true,
    terminateUnexpectedFrame: true,
  },
): PackageInteractionSession {
  let target: TerminalIO;
  let theme: PackageInteractionRuntime["theme"];
  let motif: PackageInteractionRuntime["motif"];
  const inherited = runtime.packageRuntime;
  if (runtime.io !== undefined) {
    target = runtime.io;
    theme = inherited?.theme;
    motif = inherited?.motif;
  } else if (inherited?.io !== undefined) {
    target = inherited.io;
    theme = inherited.theme;
    motif = inherited.motif;
  } else {
    const terminal = terminalContext();
    target = terminalInteractionIo(terminal);
    theme = terminal.themeVariant;
    motif = terminal.motif;
  }

  const output = options.leadingBoundary
    ? withInteractionBoundary(target)
    : target;
  const listenResize = output.listenResize === undefined
    ? undefined
    : (handler: () => void): () => void =>
      output.listenResize?.(handler) ?? (() => {});
  let wrote = false;
  const io: TerminalIO = {
    isInteractive: () => output.isInteractive(),
    capabilities: () => output.capabilities(),
    size: () => output.size(),
    read: () => output.read(),
    setRawMode: (enabled) => output.setRawMode(enabled),
    write: (value): void => {
      output.write(value);
      if (value.length > 0) wrote = true;
    },
    ...(listenResize === undefined ? {} : { listenResize }),
  };
  const tracePath = interactionTraceTarget(runtime.env);
  const trace = tracePath === undefined
    ? undefined
    : traceInteractionIo(tracePath, io);
  const packageRuntime = {
    ...(inherited ?? {}),
    io: trace?.io ?? io,
    ...(theme === undefined ? {} : { theme }),
    ...(motif === undefined ? {} : { motif }),
  } satisfies PackageInteractionRuntime & { readonly io: TerminalIO };
  return {
    runtime: packageRuntime,
    sequentialForm: (formOptions) =>
      createSequentialForm(Object.assign({}, packageRuntime, formOptions)),
    ...(trace === undefined ? {} : { settleTrace: trace.settle }),
    terminateUnexpectedFrame: (): void => {
      if (!options.terminateUnexpectedFrame || !wrote) return;
      bestEffortSync("terminal-interaction-frame-newline", () => {
        // The public driver restores raw mode and the cursor on every exception,
        // but only its submitted/cancelled paths finish the painter. This
        // semantic newline leaves an unexpected-error frame complete without
        // entering the painter's replaceable-frame cursor accounting.
        target.write("\n");
      });
    },
  };
}

type PackageInteractionOperation<Options, Value> = (
  options: Options,
  runtime: PackageInteractionRuntime,
) => Promise<Value>;

/** Run every public request through one cancellation and restoration boundary. */
async function runInteractionRequest<Options, Value>(
  operation: PackageInteractionOperation<Options, Value>,
  options: Options,
  runtime: TerminalInteractionRuntime,
  sessionOptions: PackageInteractionSessionOptions = {
    leadingBoundary: true,
    terminateUnexpectedFrame: true,
  },
): Promise<Value> {
  const session = packageInteractionRuntime(runtime, sessionOptions);
  let outcome = "value";
  try {
    return await operation(options, session.runtime);
  } catch (error) {
    if (error instanceof PackageInteractionCancelled) {
      outcome = "cancelled";
      throw new InteractionCancelled();
    }
    outcome = sessionOptions.errorOutcome?.(error) ?? "error";
    session.terminateUnexpectedFrame();
    throw error;
  } finally {
    session.settleTrace?.(outcome);
  }
}

/** Request the package's complete Markdown browser through the product boundary. */
export async function requestMarkdownBrowser<Action>(
  options: MarkdownBrowserRequestOptions<Action>,
  runtime: TerminalInteractionRuntime = {},
): Promise<MarkdownBrowserRequestResult<Action>> {
  requireInteraction("the documentation browser", runtime);
  const entries = adaptMarkdownBrowserEntries(options.entries);
  const linkResolver = options.resolveLink;
  const packageOptions: PackageMarkdownBrowserOptions<Action> = {
    label: terminalLine(options.message),
    entries: entries.entries,
    ...(options.searchLabel === undefined
      ? {}
      : { placeholder: terminalLine(options.searchLabel) }),
    ...(options.initialState === undefined
      ? {}
      : { initialState: options.initialState }),
    ...(options.documentMeasure === undefined
      ? {}
      : { documentMeasure: options.documentMeasure }),
    ...(options.mouse === undefined ? {} : { mouse: options.mouse }),
    ...(linkResolver === undefined ? {} : {
      resolveLink: (input: PackageMarkdownBrowserLinkResolverInput) =>
        resolveMarkdownBrowserLink(input, entries, linkResolver),
    }),
  };
  const result = await (async () => {
    try {
      return await runInteractionRequest(
        packageRequestMarkdownBrowser,
        packageOptions,
        runtime,
        {
          leadingBoundary: false,
          terminateUnexpectedFrame: false,
          errorOutcome: (error) =>
            error instanceof PackageMarkdownBrowserRefusalError
              ? `refused:${error.reason}`
              : undefined,
        },
      );
    } catch (error) {
      if (error instanceof PackageMarkdownBrowserRefusalError) {
        return {
          kind: "refused" as const,
          reason: error.reason,
          columns: error.columns,
          rows: error.rows,
        };
      }
      throw error;
    }
  })();
  if (result.kind === "refused") return result;
  if (result.kind === "external-link") {
    const sourceDocumentId = entries.productIdForPackageId(
      result.sourceDocumentId,
    );
    if (sourceDocumentId === undefined) {
      throw new TypeError(
        "Markdown browser returned an unknown external-link source.",
      );
    }
    return {
      kind: result.kind,
      id: result.id,
      destination: result.destination,
      sourceDocumentId,
      sourcePath: result.sourcePath,
      state: result.state,
    };
  }
  const id = entries.productIdForPackageId(result.id);
  if (id === undefined) {
    throw new TypeError(
      `Markdown browser returned unknown entry id ${
        JSON.stringify(result.id)
      }.`,
    );
  }
  return result.kind === "action"
    ? {
      kind: result.kind,
      id,
      value: result.value,
      state: result.state,
    }
    : { kind: result.kind, id, state: result.state };
}

/** Guard policy before delegating to the package selection or search request. */
export async function requestSelection<T>(
  options: SelectionRequestOptions<T>,
  runtime: TerminalInteractionRuntime = {},
): Promise<T> {
  requireInteraction("this selection", runtime);
  const choices = adaptChoices(options.options, true);
  const initialId = options.default === undefined
    ? undefined
    : choices.idFor(options.default);
  if (options.default !== undefined && initialId === undefined) {
    throw new TypeError(
      `A ${
        options.search === true ? "search" : "select"
      } default does not name a selection choice.`,
    );
  }
  const validate = packageValidator(options.validate);
  const required = typeof options.required === "string"
    ? terminalLine(options.required)
    : options.required;
  const shared = {
    label: terminalLine(options.message),
    choices: choices.entries,
    ...(options.hint === undefined ? {} : { hint: terminalLine(options.hint) }),
    ...(required === undefined ? {} : { required }),
    ...(options.completion === undefined
      ? {}
      : { completion: options.completion }),
    ...(options.presentation === undefined
      ? {}
      : { presentation: options.presentation }),
    ...(validate === undefined ? {} : {
      validate: async (value: T | undefined): Promise<string | undefined> =>
        value === undefined ? undefined : await validate(value),
    }),
    ...(options.reservedRows === undefined
      ? {}
      : { reservedRows: options.reservedRows }),
    visibleCount: visibleRowBudget(options, runtime),
  };
  const value = options.search === true
    ? await runInteractionRequest(packageRequestSearch<T>, {
      label: shared.label,
      search: choices.entries,
      ...(shared.hint === undefined ? {} : { hint: shared.hint }),
      ...(shared.required === undefined ? {} : { required: shared.required }),
      ...(shared.completion === undefined
        ? {}
        : { completion: shared.completion }),
      ...(shared.presentation === undefined
        ? {}
        : { presentation: shared.presentation }),
      ...(shared.validate === undefined ? {} : { validate: shared.validate }),
      ...(shared.reservedRows === undefined
        ? {}
        : { reservedRows: shared.reservedRows }),
      visibleCount: shared.visibleCount,
      ...(options.searchLabel === undefined
        ? {}
        : { placeholder: terminalLine(options.searchLabel) }),
      ...(initialId === undefined ? {} : { initialId }),
    }, runtime)
    : await runInteractionRequest(packageRequestSelection<T>, {
      ...shared,
      ...(initialId === undefined ? {} : { initialId }),
    }, runtime);
  if (value === undefined) {
    throw new InteractionCancelled();
  }
  return value;
}

/** Guard policy before delegating to the package multi-selection request. */
export async function requestSelections<T>(
  options: SelectionsRequestOptions<T>,
  runtime: TerminalInteractionRuntime = {},
): Promise<T[]> {
  requireInteraction("this selection", runtime);
  const choices = adaptChoices(options.options);
  const initialIds = new Set<string>();
  for (const entry of options.options) {
    if (entry.kind !== "group-heading" && entry.checked === true) {
      const id = choices.idFor(entry.value);
      if (id !== undefined) initialIds.add(id);
    }
  }
  for (const value of options.default ?? []) {
    const id = choices.idFor(value);
    if (id === undefined) {
      throw new TypeError(
        "A multi-selection default does not name a selection choice.",
      );
    }
    initialIds.add(id);
  }
  const callerValidator = packageValidator(options.validate);
  const validate: PackageSelectionsRequestOptions<T>["validate"] = async (
    values,
  ): Promise<string | undefined> => {
    if (
      options.minOptions !== undefined && values.length < options.minOptions
    ) {
      const noun = options.minOptions === 1 ? "option" : "options";
      return terminalLine(`Select at least ${options.minOptions} ${noun}.`);
    }
    return await callerValidator?.(values);
  };
  const values = await runInteractionRequest(packageRequestSelections<T>, {
    label: terminalLine(options.message),
    choices: choices.entries,
    initialIds: [...initialIds],
    ...(options.hint === undefined ? {} : { hint: terminalLine(options.hint) }),
    validate,
    ...(options.completion === undefined
      ? {}
      : { completion: options.completion }),
    ...(options.presentation === undefined
      ? {}
      : { presentation: options.presentation }),
    ...(options.reservedRows === undefined
      ? {}
      : { reservedRows: options.reservedRows }),
    visibleCount: visibleRowBudget(options, runtime),
  }, runtime);
  return [...values];
}

/** Guard policy before asking for package-backed free-form text. */
export async function requestText(
  options: TextRequestOptions,
  runtime: TerminalInteractionRuntime = {},
): Promise<string> {
  requireInteraction("this question", runtime);
  const settings = typeof options === "string" ? { message: options } : options;
  const validate = packageValidator(settings.validate);
  const required = typeof settings.required === "string"
    ? terminalLine(settings.required)
    : settings.required;
  return await runInteractionRequest(packageRequestText, {
    label: terminalLine(settings.message),
    ...(settings.default === undefined
      ? {}
      : { initialValue: settings.default }),
    ...(settings.hint === undefined
      ? {}
      : { hint: terminalLine(settings.hint) }),
    ...(settings.placeholder === undefined
      ? {}
      : { placeholder: terminalLine(settings.placeholder) }),
    ...(required === undefined ? {} : { required }),
    ...(settings.transform === undefined
      ? {}
      : { transform: settings.transform }),
    ...(validate === undefined ? {} : { validate }),
  }, runtime);
}

/** Complete behavior and copy for one package-backed confirmation request. */
export interface ConfirmationRequestOptions extends ConfirmationLabels {
  readonly defaultTo: boolean;
}

/** Guard policy before asking a package-backed yes-or-no question. */
export async function requestConfirmation(
  message: string,
  options: ConfirmationRequestOptions,
  runtime: TerminalInteractionRuntime = {},
): Promise<boolean> {
  requireInteraction("this confirmation", runtime);
  return await runInteractionRequest(packageRequestConfirmation, {
    label: terminalLine(message),
    initialValue: options.defaultTo,
    noLabel: terminalLine(options.noLabel),
    yesLabel: terminalLine(options.yesLabel),
  }, runtime);
}

/** Wait below caller-owned content through the package's compact continuation. */
export async function requestCompactAcknowledgement(
  runtime: TerminalInteractionRuntime = {},
): Promise<void> {
  requireInteraction("this continuation", runtime);
  await runInteractionRequest(
    packageRequestAcknowledgement,
    { presentation: "compact" as const },
    runtime,
  );
}

/**
 * Compose conditional text, selection, and confirmation steps through one
 * package-owned form. Ctrl+U returns to the prior applicable step; cancellation
 * is normalized to the same product error as every individual request.
 */
export async function requestSequentialForm(
  options: SequentialFormRequestOptions,
  runtime: TerminalInteractionRuntime = {},
): Promise<Record<string, unknown>> {
  requireInteraction("this task form", runtime);
  const session = packageInteractionRuntime(runtime);
  const parent = session.runtime;
  const form = session.sequentialForm({
    label: terminalLine(options.message),
    ...(options.hint === undefined ? {} : { hint: terminalLine(options.hint) }),
  });
  for (const step of options.steps) {
    form.add({
      id: step.id,
      label: terminalLine(step.label),
      ...(step.when === undefined ? {} : { when: step.when }),
      ...(step.summarize === undefined ? {} : {
        summarize: (value): string =>
          terminalLine(step.summarize?.(value) ?? ""),
      }),
      run: async (values, previous, stepRuntime): Promise<unknown> => {
        const childRuntime: TerminalInteractionRuntime = {
          io: parent.io,
          interactive: () => true,
          ...(runtime.env === undefined ? {} : { env: runtime.env }),
          packageRuntime: stepRuntime,
        };
        const requests: SequentialInteractionRequests = {
          select: <T>(request: SelectionRequestOptions<T>): Promise<T> =>
            requestSelection(request, childRuntime),
          text: (request): Promise<string> =>
            requestText(request, childRuntime),
          confirm: (message, request): Promise<boolean> =>
            requestConfirmation(message, request, childRuntime),
        };
        try {
          return await step.run(values, previous, requests);
        } catch (error) {
          if (error instanceof InteractionCancelled) {
            throw new PackageInteractionCancelled(error.message);
          }
          throw error;
        }
      },
    });
  }
  let outcome = "value";
  try {
    return await form.submit();
  } catch (error) {
    if (error instanceof PackageInteractionCancelled) {
      outcome = "cancelled";
      throw new InteractionCancelled();
    }
    outcome = "error";
    throw error;
  } finally {
    session.settleTrace?.(outcome);
  }
}

/** Canonical whitespace policy shared by single-line product text requests. */
function trimRequestedText(value: string): string {
  return value.trim();
}

/** Canonical comma-and-space spelling for the setup source-glob answer. */
function canonicalSourceGlobs(value: string): string {
  return parseSourceGlobs(value).join(", ");
}

/** Ask Git itself whether the prefix can begin every discern worktree branch. */
async function validateBranchPrefix(
  value: string,
  cwd: string = Deno.cwd(),
): Promise<InteractionValidation> {
  const result = await runGit(
    ["check-ref-format", "--branch", `${value}discern-probe`],
    { cwd },
  );
  if (result.success) return true;
  return result.code === SPAWN_FAILED
    ? "Git is required to validate the branch prefix."
    : "Enter a Git-safe branch prefix, such as agent/.";
}

/**
 * Resolve the full `SetupConfig`. In non-interactive mode every value comes from
 * a flag or its default; in interactive mode unset values are requested, seeded
 * with those same defaults. Throws on an invalid `--slug` flag (no silent
 * coercion of an explicit choice).
 */
export async function resolveSetupConfig(
  flags: InitFlags,
  log: Logger,
): Promise<SetupConfig> {
  const interactive = canInteract(flags.yes ?? false);

  // 1. Project name.
  let projectName = flags.name?.trim() ?? "";
  if (!projectName && interactive) {
    projectName = await requestText({
      message: "Project name",
      default: defaultNameFromCwd(),
      required: "Enter a project name.",
      transform: trimRequestedText,
    });
  }
  if (!projectName) {
    projectName = defaultNameFromCwd();
  }

  // 2. Slug (default = kebab-cased name; validate shape).
  const defaultSlug = slugify(projectName) || "app";
  let slug: string;
  if (flags.slug !== undefined) {
    slug = flags.slug.trim();
    if (!isValidSlug(slug)) {
      throw new Error(`invalid --slug "${slug}": ${SLUG_RULE}`);
    }
  } else if (interactive) {
    slug = await requestText({
      message: "Slug",
      default: defaultSlug,
      required: "Enter a slug.",
      transform: trimRequestedText,
      validate: (value) => isValidSlug(value) || `Slug must be ${SLUG_RULE}.`,
    });
  } else {
    slug = defaultSlug;
  }

  // 3. Branch prefix.
  let branchPrefix = flags.branchPrefix?.trim();
  if (branchPrefix === undefined && interactive) {
    branchPrefix = await requestText({
      message: "Branch prefix for worktrees",
      default: DEFAULTS.branchPrefix,
      required: "Enter a branch prefix.",
      transform: trimRequestedText,
      validate: validateBranchPrefix,
    });
  }
  if (branchPrefix === undefined || branchPrefix === "") {
    branchPrefix = DEFAULTS.branchPrefix;
  }

  // 4. Primary source globs.
  let sourceGlobs: string[];
  if (flags.sourceGlobs !== undefined) {
    sourceGlobs = parseSourceGlobs(flags.sourceGlobs);
  } else if (interactive) {
    const answer = await requestText({
      message: "Primary source globs (comma-separated)",
      default: DEFAULTS.sourceGlobs.join(", "),
      required: "Enter at least one source glob.",
      transform: canonicalSourceGlobs,
    });
    sourceGlobs = parseSourceGlobs(answer);
  } else {
    sourceGlobs = [...DEFAULTS.sourceGlobs];
  }
  if (sourceGlobs.length === 0) {
    sourceGlobs = [...DEFAULTS.sourceGlobs];
  }

  // 5. Free-text brief.
  let brief: string;
  if (flags.brief !== undefined) {
    brief = await resolveBrief(flags.brief);
  } else if (interactive) {
    brief = await requestText({
      message: "What are you building? (one or two sentences)",
      default: "",
      transform: trimRequestedText,
    });
  } else {
    brief = "";
  }

  // 6. Which agent files to emit. A deliberately EMPTY agents flag ("" — e.g. an
  // explicit `[instructions] agents = []` round-tripping through a re-scaffold, ADR 0125)
  // means no agents and is honored verbatim; only input that named agents and matched
  // NONE of them (all unknown) falls back to the default pair as the repair path.
  let agents: AgentName[];
  if (flags.agents !== undefined) {
    const { agents: parsed, unknown } = parseAgents(flags.agents);
    if (unknown.length > 0) {
      log.warn(`ignoring unknown agent(s): ${unknown.join(", ")}`);
    }
    agents = parsed.length > 0 || unknown.length === 0
      ? parsed
      : [...DEFAULTS.agents];
  } else if (interactive) {
    agents = await requestSelections({
      message: "Which agent instruction files should be emitted?",
      options: KNOWN_AGENTS.map((a) => ({
        name: `${PROVIDERS[a].label} (${PROVIDERS[a].instructionFile.path})`,
        value: a,
      })),
      default: [...DEFAULTS.agents],
      minOptions: 1,
    }) as AgentName[];
  } else {
    agents = [...DEFAULTS.agents];
  }

  const mapDir = normalizeMapDir(flags.map ?? DEFAULTS.mapDir);

  return {
    projectName,
    slug,
    branchPrefix,
    sourceGlobs,
    brief,
    agents,
    mapDir,
  };
}

/**
 * Whether a confirmation interaction may actually be shown. `--json` forbids it
 * outright — evaluated BEFORE the interaction check, so quiet result mode is
 * off-limits to the interaction even when a TTY is attached — then the shared
 * `--yes` / `--plain` / CI / stream policy applies. The gate is
 * injectable purely so this decision is testable without a real terminal.
 */
export function confirmationAllowed(
  yes: boolean,
  json: boolean,
  interactive: (yes: boolean) => boolean = canInteract,
): boolean {
  if (json) {
    return false;
  }
  return interactive(yes);
}

/** Product facts required before a person authorizes a destructive action. */
export interface DestructiveConfirmationCopy {
  /** Imperative name for the act being authorized. */
  readonly label: string;
  /** Exact object or bounded set the action can change. */
  readonly scope: string;
  /** Consequence of continuing. */
  readonly impact: string;
  /** What can restore the affected state, or an honest absence of recovery. */
  readonly recovery: string;
  /** Who may authorize the action. */
  readonly authority?: string;
  /** The final yes-or-no continuation request. */
  readonly continuation: string;
  /** Short action labels shown on the confirmation Switch. */
  readonly labels: ConfirmationLabels;
}

/** Human delivery facts kept separate from the semantic confirmation copy. */
export interface ConfirmationPresentationOptions {
  readonly yes: boolean;
  readonly json: boolean;
  readonly terminal: TerminalContext;
  readonly present: (frame: string) => void;
}

/** Product facts required before a person authorizes a bounded, reversible act. */
export interface ConfirmationDialogCopy {
  /** Imperative name for the act being authorized. */
  readonly label: string;
  /** Exact object or bounded set the action can change. */
  readonly scope: string;
  /** Consequence of continuing. */
  readonly consequence: string;
  /** The final yes-or-no continuation request. */
  readonly continuation: string;
  /** Short action labels shown on the confirmation Switch. */
  readonly labels: ConfirmationLabels;
}

/** Injectable confirmation effects that prove suppression and ordering. */
export interface ConfirmationRequestRuntime {
  readonly interactive?: (yes: boolean) => boolean;
  readonly request?: (
    message: string,
    options: ConfirmationRequestOptions,
  ) => Promise<boolean>;
}

/** Render one package-owned destructive review from terminal-safe product facts. */
export function renderDestructiveConfirmation(
  copy: DestructiveConfirmationCopy,
  terminal: TerminalContext,
): string {
  return terminal.presenter.present(renderDestructiveActionNoticeCli, {
    label: terminalLine(copy.label),
    scope: terminalMultiline(copy.scope),
    impact: terminalMultiline(copy.impact),
    recovery: terminalMultiline(copy.recovery),
    ...(copy.authority === undefined
      ? {}
      : { authority: terminalMultiline(copy.authority) }),
    tone: "danger",
  });
}

/** Render one package-owned neutral review from terminal-safe product facts. */
export function renderConfirmationDialog(
  copy: ConfirmationDialogCopy,
  terminal: TerminalContext,
): string {
  return terminal.presenter.present(renderDialogCli, {
    kicker: terminalLine("Confirm"),
    title: terminalLine(copy.label),
    body: terminalMultiline(
      `Scope: ${copy.scope}\nConsequence: ${copy.consequence}`,
    ),
    actions: [terminalLine("Cancel"), terminalLine("Continue")],
    status: "open",
  });
}

/** Ask one cancellation-aware package confirmation through an injected request. */
async function requestProceed(
  message: string,
  labels: ConfirmationLabels,
  request: (
    message: string,
    options: ConfirmationRequestOptions,
  ) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await request(message, { defaultTo: true, ...labels });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return false;
  }
}

/**
 * A friendly confirmation request. At this low-level seam a suppressed
 * interaction returns true; effectful callers first require explicit `--yes` when the
 * shared policy forbids interaction, while `--json` callers keep their existing
 * machine-authorized path. The `json` guard is load-bearing: an interactive
 * confirmation renders to stdout and blocks on input, so reaching it under `--json`
 * would corrupt the single-envelope machine stream and hang a non-interactive
 * caller that happens to hold a TTY. Machine mode therefore takes the same
 * auto-proceed path as `--yes` — the verb still emits exactly one envelope.
 */
export async function confirmProceed(
  message: string,
  labels: ConfirmationLabels,
  yes: boolean,
  json = false,
): Promise<boolean> {
  if (!confirmationAllowed(yes, json)) {
    return true;
  }
  return await requestProceed(message, labels, requestConfirmation);
}

/**
 * Present scope, impact, authority, and recovery immediately before a destructive
 * confirmation. Suppressed interactions present nothing, preserving `--yes` and
 * machine output byte-for-byte.
 */
export async function confirmDestructiveAction(
  copy: DestructiveConfirmationCopy,
  options: ConfirmationPresentationOptions,
  runtime: ConfirmationRequestRuntime = {},
): Promise<boolean> {
  const interactive = runtime.interactive ?? canInteract;
  if (!confirmationAllowed(options.yes, options.json, interactive)) {
    return true;
  }
  options.present(renderDestructiveConfirmation(copy, options.terminal));
  return await requestProceed(
    copy.continuation,
    copy.labels,
    runtime.request ?? requestConfirmation,
  );
}

/**
 * Present a neutral act, scope, and consequence immediately before a bounded
 * confirmation. Suppressed interactions present nothing.
 */
export async function confirmDialogAction(
  copy: ConfirmationDialogCopy,
  options: ConfirmationPresentationOptions,
  runtime: ConfirmationRequestRuntime = {},
): Promise<boolean> {
  const interactive = runtime.interactive ?? canInteract;
  if (!confirmationAllowed(options.yes, options.json, interactive)) {
    return true;
  }
  options.present(renderConfirmationDialog(copy, options.terminal));
  return await requestProceed(
    copy.continuation,
    copy.labels,
    runtime.request ?? requestConfirmation,
  );
}

/** Default project name from the current directory's basename. */
function defaultNameFromCwd(cwd: string = Deno.cwd()): string {
  const base = cwd.split("/").filter(Boolean).pop() ?? "app";
  return base;
}
