/**
 * The `setup` wizard: resolve a complete `SetupConfig` from CLI flags and, when
 * interactive, from prompts. Every prompt has a flag equivalent so the whole
 * wizard is skippable for CI/agent runs (`--yes` + flags). Prompts are only
 * ever reached on a TTY with `--yes` absent.
 */

import {
  DenoTerminalIO,
  type MultiselectPromptOptions as PackageMultiselectPromptOptions,
  PromptCancelled as PackagePromptCancelled,
  type PromptChoiceEntry,
  promptConfirm as packagePromptConfirm,
  promptMultiselect as packagePromptMultiselect,
  type PromptRuntime as PackagePromptRuntime,
  promptSearch as packagePromptSearch,
  promptSelect as packagePromptSelect,
  promptText as packagePromptText,
  type TerminalIO,
} from "discern-design-system/cli/interactive";
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
import { PROVIDERS } from "./providers.ts";
import type { Logger } from "./log.ts";
import { normalizeMapDir } from "../shared/map_path.ts";
import type { EnvReader } from "../shared/env.ts";
import {
  type HumanOutputGroup,
  populatedHumanOutputGroups,
} from "../shared/result.ts";
import { terminalContext, terminalLine } from "./terminal.ts";

/** Process-wide CLI choice set once by `main` from the global `--plain` flag. */
let plainMode = false;
/** Process-wide machine-output choice set once by `main` from global `--json`. */
let jsonMode = false;

/** Thread the global static-output choice into every prompt choke point. */
export function setPlainMode(enabled: boolean): void {
  plainMode = enabled;
}

/** Thread the global machine-output choice into every prompt choke point. */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/** Whether the global CLI requested static, non-interactive output. */
export function plainModeEnabled(): boolean {
  return plainMode;
}

/** Whether the global CLI requested the JSON machine protocol. */
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
 * Whether interactive prompts may be shown. `--yes`, global `--plain`, global
 * `--json`, CI, and either non-terminal stream independently veto interaction.
 * The environment and stream probe are injectable so the whole decision is
 * testable without manufacturing a terminal.
 */
export function canPrompt(
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
type PromptValidation = true | string;

/** One framework-neutral product choice. `id` is required for non-primitives. */
export interface SelectPromptOption<T> {
  readonly kind?: "choice";
  readonly id?: string;
  readonly name: string;
  readonly value: T;
  readonly disabled?: boolean;
  /** Initial multi-select state retained for the docs export picker. */
  readonly checked?: boolean;
}

/** One first-class semantic heading. It carries no selectable value. */
export interface SelectPromptHeading {
  readonly kind: "group-heading";
  readonly id: string;
  readonly name: string;
}

/** Choices and structural headings accepted by the product prompt adapter. */
export type SelectPromptEntry<T> = SelectPromptOption<T> | SelectPromptHeading;

/** Framework-neutral options for a product single-choice prompt. */
export interface SelectPromptOptions<T> {
  readonly message: string;
  readonly options: readonly SelectPromptEntry<T>[];
  readonly default?: T;
  readonly hint?: string;
  readonly required?: boolean | string;
  readonly validate?: (value: T) => MaybePromise<PromptValidation>;
  /** Use the package search prompt rather than a static select prompt. */
  readonly search?: boolean;
  readonly searchLabel?: string;
  readonly maxRows?: number;
}

/** Framework-neutral options for a product multiple-choice prompt. */
export interface CheckboxPromptOptions<T> {
  readonly message: string;
  readonly options: readonly SelectPromptEntry<T>[];
  readonly default?: readonly T[];
  readonly hint?: string;
  readonly minOptions?: number;
  readonly validate?: (value: readonly T[]) => MaybePromise<PromptValidation>;
  readonly maxRows?: number;
}

/** Framework-neutral options for a product text prompt. */
export interface InputPromptSettings {
  readonly message: string;
  readonly default?: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly required?: boolean | string;
  readonly validate?: (value: string) => MaybePromise<PromptValidation>;
}

export type InputPromptOptions = string | InputPromptSettings;

export type SelectPromptGroup<T> =
  & HumanOutputGroup<SelectPromptOption<T>>
  & { label: string };

/** Injectable prompt runtime used by focused tests and real-terminal harnesses. */
export interface DiscernPromptRuntime {
  readonly io?: TerminalIO;
  readonly interactive?: (yes: boolean) => boolean;
}

/** Product cancellation meaning for Ctrl+C and terminal end-of-input. */
export class PromptCancellation extends Error {
  override readonly name = "PromptCancellation";

  constructor() {
    super("Prompt cancelled.");
  }
}

/** Test whether an error is the product's normalized prompt cancellation. */
export function isPromptCancellation(
  error: unknown,
): error is PromptCancellation {
  return error instanceof PromptCancellation;
}

/** Give one package prompt a leading semantic boundary outside its frame.
 * Every terminal fact and effect delegates unchanged; only the first nonempty
 * write receives the one newline that separates the prompt from prior output. */
export function withPromptBoundary(target: TerminalIO): TerminalIO {
  let boundaryPending = true;
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
  };
}

/** Build first-class package headings from named semantic groups. */
export function groupedSelectOptions<T>(
  groups: readonly SelectPromptGroup<T>[],
): SelectPromptEntry<T>[] {
  return populatedHumanOutputGroups(groups).flatMap((group) => {
    if (group.label === undefined) {
      throw new TypeError(
        `prompt group ${JSON.stringify(group.id)} needs a label`,
      );
    }
    return [
      { kind: "group-heading", id: group.id, name: group.label } as const,
      ...group.items,
    ];
  });
}

/** Refuse a named prompt unless terminal input and output are available. */
function requireInteraction(
  name: string,
  runtime: DiscernPromptRuntime,
): void {
  if (plainMode || jsonMode) {
    throw new Error(
      `${name} needs an interactive terminal; remove --plain and --json, leave CI, and attach terminal stdin and stdout.`,
    );
  }
  if (!(runtime.interactive ?? canPrompt)(false)) {
    throw new Error(
      `${name} needs an interactive terminal; remove --plain and --json, leave CI, and attach terminal stdin and stdout.`,
    );
  }
}

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

interface AdaptedChoices<T> {
  readonly entries: readonly PromptChoiceEntry<T>[];
  readonly idFor: (value: T) => string | undefined;
}

/** Validate product identity and map it once into the package choice contract. */
function adaptChoices<T>(
  entries: readonly SelectPromptEntry<T>[],
  rejectNullishValues = false,
): AdaptedChoices<T> {
  const values: T[] = [];
  const productIds = new Set<string>();
  const groupIds = new Set<string>();
  const explicitIds = new Set<string>();
  const valueIds: Array<{ readonly value: T; readonly id: string }> = [];
  const adapted = entries.map((entry, index): PromptChoiceEntry<T> => {
    if (entry.kind === "group-heading") {
      if (entry.id.trim() === "") {
        throw new TypeError(`prompt group ${index + 1} has a blank id`);
      }
      if (groupIds.has(entry.id)) {
        throw new TypeError(
          `prompt group id ${JSON.stringify(entry.id)} is repeated`,
        );
      }
      const label = terminalLine(entry.name);
      if (label.trim() === "") {
        throw new TypeError(
          `prompt group ${JSON.stringify(entry.id)} has a blank label`,
        );
      }
      groupIds.add(entry.id);
      const productId = `group:${encodedIdentity(entry.id)}`;
      productIds.add(productId);
      return {
        kind: "group-heading",
        id: productId,
        label,
      };
    }

    if (
      rejectNullishValues && (entry.value === null || entry.value === undefined)
    ) {
      throw new TypeError(
        "A single-select prompt choice cannot use null or undefined as its value.",
      );
    }
    if (values.some((value) => sameValue(value, entry.value))) {
      throw new TypeError(
        `prompt choice ${index + 1} repeats a selectable value`,
      );
    }
    values.push(entry.value);
    const implicit = primitiveChoiceId(entry.value);
    if (entry.id === undefined && implicit === undefined) {
      throw new TypeError(
        `prompt choice ${
          index + 1
        } needs an explicit id because its value is not a supported primitive`,
      );
    }
    if (entry.id !== undefined) {
      if (entry.id.trim() === "") {
        throw new TypeError(`prompt choice ${index + 1} has a blank id`);
      }
      if (explicitIds.has(entry.id)) {
        throw new TypeError(
          `prompt choice id ${JSON.stringify(entry.id)} is repeated`,
        );
      }
      explicitIds.add(entry.id);
    }
    const productId = entry.id === undefined
      ? `value:${encodedIdentity(implicit ?? "")}`
      : `id:${encodedIdentity(entry.id)}`;
    if (productIds.has(productId)) {
      throw new TypeError(
        `prompt choice id ${JSON.stringify(entry.id)} is repeated`,
      );
    }
    productIds.add(productId);
    valueIds.push({ value: entry.value, id: productId });
    return {
      id: productId,
      label: terminalLine(entry.name),
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

/** Keep a semantic heading only when its group has a matching choice. */
function filterChoices<T>(
  entries: readonly PromptChoiceEntry<T>[],
  query: string,
): readonly PromptChoiceEntry<T>[] {
  const needle = query.toLowerCase();
  if (needle === "") return entries;
  const matches = (label: string): boolean =>
    label.toLowerCase().includes(needle);
  const filtered: PromptChoiceEntry<T>[] = [];
  for (let index = 0; index < entries.length;) {
    const entry = entries[index];
    if (entry?.kind !== "group-heading") {
      if (entry !== undefined && matches(entry.label)) filtered.push(entry);
      index += 1;
      continue;
    }
    const choices: PromptChoiceEntry<T>[] = [];
    let next = index + 1;
    while (next < entries.length && entries[next]?.kind !== "group-heading") {
      const choice = entries[next];
      if (
        choice !== undefined && (matches(entry.label) || matches(choice.label))
      ) {
        choices.push(choice);
      }
      next += 1;
    }
    if (choices.length > 0) filtered.push(entry, ...choices);
    index = next;
  }
  return filtered;
}

/** Adapt the product validator's true/string convention to the package. */
function packageValidator<T>(
  validate: ((value: T) => MaybePromise<PromptValidation>) | undefined,
): ((value: T) => Promise<string | undefined>) | undefined {
  if (validate === undefined) return undefined;
  return async (value): Promise<string | undefined> => {
    const verdict = await validate(value);
    return verdict === true ? undefined : terminalLine(verdict);
  };
}

interface PackagePromptSession {
  readonly runtime: PackagePromptRuntime;
  /** End a frame whose unexpected exception bypassed the package's finish. */
  readonly terminateUnexpectedFrame: () => void;
}

/** Construct one package runtime after policy has allowed interaction. */
function packageRuntime(runtime: DiscernPromptRuntime): PackagePromptSession {
  let target: TerminalIO;
  let theme: PackagePromptRuntime["theme"];
  if (runtime.io !== undefined) {
    target = runtime.io;
  } else {
    const terminal = terminalContext();
    target = new DenoTerminalIO({
      environment: terminal.environment,
    });
    theme = terminal.themeVariant;
  }

  const boundary = withPromptBoundary(target);
  let wrote = false;
  const io: TerminalIO = {
    isInteractive: () => boundary.isInteractive(),
    capabilities: () => boundary.capabilities(),
    size: () => boundary.size(),
    read: () => boundary.read(),
    setRawMode: (enabled) => boundary.setRawMode(enabled),
    write: (value): void => {
      boundary.write(value);
      if (value.length > 0) wrote = true;
    },
  };
  return {
    runtime: {
      io,
      ...(theme === undefined ? {} : { theme }),
    },
    terminateUnexpectedFrame: (): void => {
      if (!wrote) return;
      try {
        // The public driver restores raw mode and the cursor on every exception,
        // but only its submitted/cancelled paths finish the painter. This
        // semantic newline leaves an unexpected-error frame complete without
        // entering the painter's replaceable-frame cursor accounting.
        target.write("\n");
      } catch {
        // The original prompt fault remains authoritative over cleanup failure.
      }
    },
  };
}

type PackagePromptOperation<Options, Value> = (
  options: Options,
  runtime: PackagePromptRuntime,
) => Promise<Value>;

/** Run every public prompt through one cancellation and restoration boundary. */
async function productPrompt<Options, Value>(
  operation: PackagePromptOperation<Options, Value>,
  options: Options,
  runtime: DiscernPromptRuntime,
): Promise<Value> {
  const session = packageRuntime(runtime);
  try {
    return await operation(options, session.runtime);
  } catch (error) {
    if (error instanceof PackagePromptCancelled) {
      throw new PromptCancellation();
    }
    session.terminateUnexpectedFrame();
    throw error;
  }
}

/** Guard policy before delegating to the package single-choice/search prompt. */
export async function selectPrompt<T>(
  options: SelectPromptOptions<T>,
  runtime: DiscernPromptRuntime = {},
): Promise<T> {
  requireInteraction("this selection", runtime);
  if (options.search === true && options.default !== undefined) {
    throw new TypeError(
      "A search prompt cannot restore an initial selection with the published interaction API.",
    );
  }
  const choices = adaptChoices(options.options, true);
  const validate = packageValidator(options.validate);
  const required = typeof options.required === "string"
    ? terminalLine(options.required)
    : options.required;
  const shared = {
    label: terminalLine(options.message),
    choices: choices.entries,
    ...(options.hint === undefined ? {} : { hint: terminalLine(options.hint) }),
    ...(required === undefined ? {} : { required }),
    ...(validate === undefined ? {} : {
      validate: async (value: T | undefined): Promise<string | undefined> =>
        value === undefined ? undefined : await validate(value),
    }),
    ...(options.maxRows === undefined ? {} : { visibleCount: options.maxRows }),
  };
  const value = options.search === true
    ? await productPrompt(packagePromptSearch<T>, {
      label: shared.label,
      search: (query) => filterChoices(choices.entries, query),
      ...(shared.hint === undefined ? {} : { hint: shared.hint }),
      ...(shared.required === undefined ? {} : { required: shared.required }),
      ...(shared.validate === undefined ? {} : { validate: shared.validate }),
      ...(shared.visibleCount === undefined
        ? {}
        : { visibleCount: shared.visibleCount }),
      ...(options.searchLabel === undefined
        ? {}
        : { placeholder: terminalLine(options.searchLabel) }),
    }, runtime)
    : await productPrompt(packagePromptSelect<T>, {
      ...shared,
      ...((): { readonly initialId?: string } => {
        if (options.default === undefined) return {};
        const initialId = choices.idFor(options.default);
        if (initialId === undefined) {
          throw new TypeError(
            "A select default does not name a prompt choice.",
          );
        }
        return { initialId };
      })(),
    }, runtime);
  if (value === undefined) {
    throw new PromptCancellation();
  }
  return value;
}

/** Guard policy before delegating to the package multiple-choice prompt. */
export async function checkboxPrompt<T>(
  options: CheckboxPromptOptions<T>,
  runtime: DiscernPromptRuntime = {},
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
        "A multi-select default does not name a prompt choice.",
      );
    }
    initialIds.add(id);
  }
  const callerValidator = packageValidator(options.validate);
  const validate: PackageMultiselectPromptOptions<T>["validate"] = async (
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
  const values = await productPrompt(packagePromptMultiselect<T>, {
    label: terminalLine(options.message),
    choices: choices.entries,
    initialIds: [...initialIds],
    ...(options.hint === undefined ? {} : { hint: terminalLine(options.hint) }),
    validate,
    ...(options.maxRows === undefined ? {} : { visibleCount: options.maxRows }),
  }, runtime);
  return [...values];
}

/** Guard policy before asking for package-backed free-form text. */
export async function inputPrompt(
  options: InputPromptOptions,
  runtime: DiscernPromptRuntime = {},
): Promise<string> {
  requireInteraction("this question", runtime);
  const settings = typeof options === "string" ? { message: options } : options;
  const validate = packageValidator(settings.validate);
  const required = typeof settings.required === "string"
    ? terminalLine(settings.required)
    : settings.required;
  return await productPrompt(packagePromptText, {
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
    ...(validate === undefined ? {} : { validate }),
  }, runtime);
}

/** Guard policy before asking a package-backed yes-or-no question. */
export async function confirmationPrompt(
  message: string,
  defaultTo: boolean,
  runtime: DiscernPromptRuntime = {},
): Promise<boolean> {
  requireInteraction("this confirmation", runtime);
  return await productPrompt(packagePromptConfirm, {
    label: terminalLine(message),
    initialValue: defaultTo,
  }, runtime);
}

/**
 * Resolve the full `SetupConfig`. In non-interactive mode every value comes from
 * a flag or its default; in interactive mode unset values are prompted, seeded
 * with those same defaults. Throws on an invalid `--slug` flag (no silent
 * coercion of an explicit choice).
 */
export async function resolveSetupConfig(
  flags: InitFlags,
  log: Logger,
): Promise<SetupConfig> {
  const interactive = canPrompt(flags.yes ?? false);

  // 1. Project name.
  let projectName = flags.name?.trim() ?? "";
  if (!projectName && interactive) {
    projectName = (await inputPrompt({
      message: "Project name",
      default: defaultNameFromCwd(),
    })).trim();
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
    slug = (await inputPrompt({
      message: "Slug",
      default: defaultSlug,
      validate: (value) =>
        isValidSlug(value.trim()) || `Slug must be ${SLUG_RULE}.`,
    })).trim();
  } else {
    slug = defaultSlug;
  }

  // 3. Branch prefix.
  let branchPrefix = flags.branchPrefix?.trim();
  if (branchPrefix === undefined && interactive) {
    branchPrefix = (await inputPrompt({
      message: "Branch prefix for worktrees",
      default: DEFAULTS.branchPrefix,
    })).trim();
  }
  if (branchPrefix === undefined || branchPrefix === "") {
    branchPrefix = DEFAULTS.branchPrefix;
  }

  // 4. Primary source globs.
  let sourceGlobs: string[];
  if (flags.sourceGlobs !== undefined) {
    sourceGlobs = parseSourceGlobs(flags.sourceGlobs);
  } else if (interactive) {
    const answer = await inputPrompt({
      message: "Primary source globs (comma-separated)",
      default: DEFAULTS.sourceGlobs.join(", "),
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
    brief = await inputPrompt({
      message: "What are you building? (one or two sentences)",
      default: "",
    });
  } else {
    brief = "";
  }

  // 6. Which agent files to emit. A deliberately EMPTY agents flag ("" — e.g. an
  // explicit `[guidance] agents = []` round-tripping through a re-scaffold, ADR 0125)
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
    agents = await checkboxPrompt({
      message: "Which agent instruction files should be emitted?",
      options: KNOWN_AGENTS.map((a) => ({
        name: `${PROVIDERS[a].label} (${PROVIDERS[a].guidanceFile.path})`,
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
 * Whether a confirmation prompt may actually be shown. `--json` forbids it
 * outright — evaluated BEFORE the interaction check, so machine mode is
 * off-limits to the prompt even when a TTY is attached — then the shared
 * `--yes` / `--plain` / CI / stream policy applies. The gate is
 * injectable purely so this decision is testable without a real terminal.
 */
export function promptAllowed(
  yes: boolean,
  json: boolean,
  interactive: (yes: boolean) => boolean = canPrompt,
): boolean {
  if (json) {
    return false;
  }
  return interactive(yes);
}

/**
 * A friendly confirmation prompt. At this low-level seam a suppressed prompt
 * returns true; effectful callers first require their explicit `--yes` when the
 * shared policy forbids interaction, while `--json` callers keep their existing
 * machine-authorized path. The `json` guard is load-bearing: an interactive
 * confirmation renders to stdout and blocks on input, so reaching it under `--json`
 * would corrupt the single-envelope machine stream and hang a non-interactive
 * caller that happens to hold a TTY. Machine mode therefore takes the same
 * auto-proceed path as `--yes` — the verb still emits exactly one envelope.
 */
export async function confirmProceed(
  message: string,
  yes: boolean,
  json = false,
): Promise<boolean> {
  if (!promptAllowed(yes, json)) {
    return true;
  }
  try {
    return await confirmationPrompt(message, true);
  } catch (error) {
    if (!isPromptCancellation(error)) throw error;
    return false;
  }
}

/** Default project name from the current directory's basename. */
function defaultNameFromCwd(): string {
  const cwd = Deno.cwd();
  const base = cwd.split("/").filter(Boolean).pop() ?? "app";
  return base;
}
