/**
 * Resolved configuration for an `setup` run, plus the default values and the
 * slug-validation rule. Centralising defaults here keeps them one source of
 * truth shared by the wizard, the non-interactive path, and the tests.
 */

import type { TokenMap } from "./template.ts";
import { renderTomlStringList } from "./toml_render.ts";
import { KIT_VERSION } from "./version.ts";

// The agent/provider vocabulary (claude_code→CLAUDE.md, codex→AGENTS.md,
// gemini→GEMINI.md) is defined once on the canonical schema as `AGENT_NAMES` and
// re-exported here under the installer's long-standing name, so the wizard, the
// config document, and the generated editor JSON Schema share one list.
import { AGENT_NAMES, DEFAULT_AGENTS } from "../shared/config_schema.ts";
import { DOCS_DIR_REFERENCE } from "../shared/docs_path.ts";
import { NAMESPACE_DIR, SOURCE_PATHS } from "../shared/paths_registry.ts";
import { neutralAgentScopePaths } from "./providers.ts";

/** The agent/provider files the kit knows how to emit. */
export const KNOWN_AGENTS = AGENT_NAMES;
export type AgentName = (typeof AGENT_NAMES)[number];

// The capability vocabulary, gate stages, and slug validation are defined once
// in the shared engine/installer module and re-exported here so existing
// installer imports (`from "../lib/config.ts"`) keep resolving.
export {
  capabilityList,
  capStage,
  isKnownCapability,
  isValidSlug,
  KNOWN_CAPABILITIES,
  SLUG_RULE,
  stageIsValid,
  stageList,
  STAGES,
} from "../shared/capabilities.ts";
export type { Capability, Stage } from "../shared/capabilities.ts";

/** Default values for every wizard answer. */
export const DEFAULTS = {
  branchPrefix: "agent/",
  sourceGlobs: ["src/**", "app/**"],
  // Default to the two built-in providers; gemini is opt-in.
  agents: [...DEFAULT_AGENTS] as AgentName[],
  docsDir: SOURCE_PATHS.docs.defaultPath,
  gotchasDoc: "",
  scopesPreviewable: ['"public/**"'],
} as const;

/**
 * The neutral-scope globs a fresh install seeds (already TOML-quoted): docs, the
 * `discern/` namespace (guidance sources, authored skills, recipes, the ledger,
 * the brief — every default from the paths registry lives under it), and EVERY
 * known agent's generated dir — the last derived from the provider registry via
 * {@link neutralAgentScopePaths}, so adding an agent neutralizes its dir
 * automatically instead of leaving a hand-maintained `.claude/`-only list to
 * drift. Root-level *.md is treated as neutral by the classifier regardless.
 */
export function defaultNeutralScopes(): string[] {
  return [
    `"${DOCS_DIR_REFERENCE}"`,
    `"${NAMESPACE_DIR}"`,
    ...neutralAgentScopePaths().map((p) => `"${p}"`),
  ];
}

/** The fully-resolved answers that drive scaffolding. */
export interface SetupConfig {
  projectName: string;
  slug: string;
  branchPrefix: string;
  /** Source globs as the user gave them (unquoted), e.g. ["src/**", "app/**"]. */
  sourceGlobs: string[];
  /** The verbatim "what are you building?" answer, written to brief.md. */
  brief: string;
  agents: AgentName[];
  /** Project-relative home for discern's agent documentation tree. */
  docsDir?: string | undefined;
}

/**
 * Kebab-case a free-text project name into a default slug: lowercase, spaces and
 * underscores → dashes, drop other punctuation, collapse repeated dashes, trim.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse a comma-separated agents flag into the known set. Unknown names are
 * dropped and reported so the caller can warn; an empty result falls back to
 * the default (both agents) at the call site.
 */
export function parseAgents(
  input: string,
): { agents: AgentName[]; unknown: string[] } {
  const agents: AgentName[] = [];
  const unknown: string[] = [];
  for (const part of input.split(",").map((p) => p.trim()).filter(Boolean)) {
    if ((KNOWN_AGENTS as readonly string[]).includes(part)) {
      if (!agents.includes(part as AgentName)) {
        agents.push(part as AgentName);
      }
    } else {
      unknown.push(part);
    }
  }
  return { agents, unknown };
}

/** Split a comma-separated source-globs flag into trimmed, non-empty entries. */
export function parseSourceGlobs(input: string): string[] {
  return input.split(",").map((g) => g.trim()).filter(Boolean);
}

/** Build the full content-token map from a resolved config. */
export function tokensFromConfig(config: SetupConfig): TokenMap {
  return {
    project_name: config.projectName,
    project_slug: config.slug,
    branch_prefix: config.branchPrefix,
    agents_array: renderTomlStringList(config.agents),
    docs_dir: config.docsDir ?? DEFAULTS.docsDir,
    gotchas_doc: DEFAULTS.gotchasDoc,
    scopes_neutral: defaultNeutralScopes().join(", "),
    scopes_web: renderTomlStringList(config.sourceGlobs),
    scopes_previewable: DEFAULTS.scopesPreviewable.join(", "),
    kit_version: KIT_VERSION,
  };
}
