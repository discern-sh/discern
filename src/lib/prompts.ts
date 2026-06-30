/**
 * The `init` wizard: resolve a complete `InitConfig` from CLI flags and, when
 * interactive, from prompts. Every prompt has a flag equivalent so the whole
 * wizard is skippable for CI/agent runs (`--yes` + flags). Prompts are only
 * ever reached on a TTY with `--yes` absent.
 */

import { Checkbox, Confirm, Input } from "@cliffy/prompt";
import {
  type AgentName,
  DEFAULTS,
  type InitConfig,
  isValidSlug,
  KNOWN_AGENTS,
  parseAgents,
  parseSourceGlobs,
  SLUG_RULE,
  slugify,
} from "./config.ts";
import { PROVIDERS } from "./providers.ts";
import type { Logger } from "./log.ts";
import { normalizeDocsDir } from "../shared/docs_path.ts";

/** Raw flag values passed to `init` (all optional; undefined → ask/default). */
export interface InitFlags {
  name?: string | undefined;
  slug?: string | undefined;
  branchPrefix?: string | undefined;
  sourceGlobs?: string | undefined;
  brief?: string | undefined;
  agents?: string | undefined;
  docs?: string | undefined;
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

/** Whether interactive prompts may be shown (TTY in, TTY out, --yes absent). */
export function canPrompt(yes: boolean): boolean {
  return !yes && Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
}

/**
 * Resolve the full `InitConfig`. In non-interactive mode every value comes from
 * a flag or its default; in interactive mode unset values are prompted, seeded
 * with those same defaults. Throws on an invalid `--slug` flag (no silent
 * coercion of an explicit choice).
 */
export async function resolveInitConfig(
  flags: InitFlags,
  log: Logger,
): Promise<InitConfig> {
  const interactive = canPrompt(flags.yes ?? false);

  // 1. Project name.
  let projectName = flags.name?.trim() ?? "";
  if (!projectName && interactive) {
    projectName = (await Input.prompt({
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
    slug = (await Input.prompt({
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
    branchPrefix = (await Input.prompt({
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
    const answer = await Input.prompt({
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
    brief = await Input.prompt({
      message: "What are you building? (one or two sentences)",
      default: "",
    });
  } else {
    brief = "";
  }

  // 6. Which agent files to emit.
  let agents: AgentName[];
  if (flags.agents !== undefined) {
    const { agents: parsed, unknown } = parseAgents(flags.agents);
    if (unknown.length > 0) {
      log.warn(`ignoring unknown agent(s): ${unknown.join(", ")}`);
    }
    agents = parsed.length > 0 ? parsed : [...DEFAULTS.agents];
  } else if (interactive) {
    agents = await Checkbox.prompt({
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

  const docsDir = normalizeDocsDir(flags.docs ?? DEFAULTS.docsDir);

  return {
    projectName,
    slug,
    branchPrefix,
    sourceGlobs,
    brief,
    agents,
    docsDir,
  };
}

/** A friendly confirmation prompt; auto-yes when non-interactive. */
export async function confirmProceed(
  message: string,
  yes: boolean,
): Promise<boolean> {
  if (!canPrompt(yes)) {
    return true;
  }
  return await Confirm.prompt({ message, default: true });
}

/** Default project name from the current directory's basename. */
function defaultNameFromCwd(): string {
  const cwd = Deno.cwd();
  const base = cwd.split("/").filter(Boolean).pop() ?? "app";
  return base;
}
