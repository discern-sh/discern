/**
 * Resolved configuration for an `init` run, plus the default values and the
 * slug-validation rule. Centralising defaults here keeps them one source of
 * truth shared by the wizard, the non-interactive path, and the tests.
 */

import type { TokenMap } from "./template.ts";
import { renderTomlStringList } from "./toml_render.ts";
import { KIT_VERSION } from "./version.ts";

/** The agent files the kit knows how to emit. */
export const KNOWN_AGENTS = ["claude_code", "codex"] as const;
export type AgentName = (typeof KNOWN_AGENTS)[number];

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
  agents: [...KNOWN_AGENTS] as AgentName[],
  gotchasDoc: "",
  scopesNeutral: ['"docs/"', '".icculus/"', '".claude/"'],
  scopesPreviewable: ['"public/**"'],
} as const;

/** The fully-resolved answers that drive scaffolding. */
export interface InitConfig {
  projectName: string;
  slug: string;
  branchPrefix: string;
  /** Source globs as the user gave them (unquoted), e.g. ["src/**", "app/**"]. */
  sourceGlobs: string[];
  /** The verbatim "what are you building?" answer, written to brief.md. */
  brief: string;
  agents: AgentName[];
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
export function tokensFromConfig(config: InitConfig): TokenMap {
  return {
    project_name: config.projectName,
    project_slug: config.slug,
    branch_prefix: config.branchPrefix,
    agents_array: renderTomlStringList(config.agents),
    gotchas_doc: DEFAULTS.gotchasDoc,
    scopes_neutral: DEFAULTS.scopesNeutral.join(", "),
    scopes_web: renderTomlStringList(config.sourceGlobs),
    scopes_previewable: DEFAULTS.scopesPreviewable.join(", "),
    kit_version: KIT_VERSION,
  };
}
