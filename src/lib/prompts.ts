/**
 * The `setup` wizard: resolve a complete `SetupConfig` from CLI flags and, when
 * interactive, from prompts. Every prompt has a flag equivalent so the whole
 * wizard is skippable for CI/agent runs (`--yes` + flags). Prompts are only
 * ever reached on a TTY with `--yes` absent.
 */

import { Checkbox, Confirm, Input, Select } from "@cliffy/prompt";
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

/** Process-wide CLI choice set once by `main` from the global `--plain` flag. */
let plainMode = false;

/** Thread the global static-output choice into every prompt choke point. */
export function setPlainMode(enabled: boolean): void {
  plainMode = enabled;
}

/** Whether the global CLI requested static, non-interactive output. */
export function plainModeEnabled(): boolean {
  return plainMode;
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
 * Whether interactive prompts may be shown. `--yes`, global `--plain`, CI, and
 * either non-terminal stream independently veto interaction. The environment
 * and stream probe are injectable so the whole decision is testable without
 * mutating process-global state or manufacturing a terminal.
 */
export function canPrompt(
  yes: boolean,
  env: EnvReader = Deno.env,
  streams: () => { stdin: boolean; stdout: boolean } = () => ({
    stdin: Deno.stdin.isTerminal(),
    stdout: Deno.stdout.isTerminal(),
  }),
): boolean {
  return interactionAllowed(yes, plainMode, env, streams);
}

/** Pure form of the interaction policy for exhaustive unit testing. */
export function interactionAllowed(
  yes: boolean,
  plain: boolean,
  env: EnvReader,
  streams: () => { stdin: boolean; stdout: boolean },
): boolean {
  const ci = env.get("CI")?.trim().toLowerCase();
  if (yes || plain || (ci !== undefined && ci !== "" && ci !== "false")) {
    return false;
  }
  const terminal = streams();
  return terminal.stdin && terminal.stdout;
}

/** Cliffy option types and guarded calls: every prompt in the product routes here. */
export type SelectPromptOptions<T> = Parameters<typeof Select.prompt<T>>[0];
export type CheckboxPromptOptions<T> = Parameters<typeof Checkbox.prompt<T>>[0];
export type InputPromptOptions = Parameters<typeof Input.prompt>[0];
export type SelectPromptOption<T> = SelectPromptOptions<T>["options"][number];
export type SelectPromptGroup<T> =
  & HumanOutputGroup<SelectPromptOption<T>>
  & { label: string };

/** Build a prompt's option list from named semantic groups. Every populated
 * group receives a ruled heading with one empty row above it, including the
 * first, so task rows and navigation/actions never collapse into one flat list. */
export function groupedSelectOptions<T>(
  groups: readonly SelectPromptGroup<T>[],
  decorateRule: (rule: string) => string = (rule) => rule,
): SelectPromptOption<T>[] {
  return populatedHumanOutputGroups(groups).flatMap((group) => [
    Select.separator(
      `\n  ${decorateRule(`── ${group.label} ──`)}`,
    ) as SelectPromptOption<T>,
    ...group.items,
  ]);
}

/** Refuse a named prompt unless terminal input and output are available. */
function requireInteraction(name: string): void {
  if (!canPrompt(false)) {
    throw new Error(
      `${name} needs an interactive terminal; remove --plain, leave CI, and attach terminal stdin and stdout.`,
    );
  }
}

/** Guard interactive policy before delegating to Cliffy's single-choice prompt. */
export function selectPrompt<T>(
  options: SelectPromptOptions<T>,
): ReturnType<typeof Select.prompt<T>> {
  requireInteraction("this selection");
  return Select.prompt<T>(options);
}

/** Guard interactive policy before delegating to Cliffy's multi-choice prompt. */
export function checkboxPrompt<T>(
  options: CheckboxPromptOptions<T>,
): ReturnType<typeof Checkbox.prompt<T>> {
  requireInteraction("this selection");
  return Checkbox.prompt<T>(options);
}

/** Guard interactive policy before asking for free-form text. */
export function inputPrompt(options: InputPromptOptions): Promise<string> {
  requireInteraction("this question");
  return Input.prompt(options);
}

/** Guard interactive policy before asking a yes-or-no question with a default. */
export function confirmationPrompt(
  message: string,
  defaultTo: boolean,
): Promise<boolean> {
  requireInteraction("this confirmation");
  return Confirm.prompt({ message, default: defaultTo });
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
 * machine-authorized path. The `json` guard is load-bearing: Cliffy's
 * `Confirm` renders to stdout and blocks on input, so reaching it under `--json`
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
  return await confirmationPrompt(message, true);
}

/** Default project name from the current directory's basename. */
function defaultNameFromCwd(): string {
  const cwd = Deno.cwd();
  const base = cwd.split("/").filter(Boolean).pop() ?? "app";
  return base;
}
