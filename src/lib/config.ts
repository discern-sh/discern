/**
 * Resolved configuration for an `setup` run, plus the default values and the
 * slug-validation rule. Centralising defaults here keeps them one source of
 * truth shared by the wizard, the non-interactive path, and the tests.
 */

import type { TokenMap } from "./template.ts";
import { generatedArtifactMarkerBody } from "../shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../shared/file_ownership.ts";
import type { EnvReader } from "../shared/env.ts";
import { renderTomlStringList } from "./toml_render.ts";
import { KIT_VERSION } from "./version.ts";

// The native agent/provider vocabulary is derived from the shared identity
// catalogue, then re-exported by the canonical schema under `AGENT_NAMES`. The
// wizard, config document, generated editor schema, and logbook detector therefore
// share one identity source without making signal-only agents setup choices.
import { AGENT_NAMES, DEFAULT_AGENTS } from "../shared/config_schema.ts";
import { MAP_DIR_REFERENCE } from "../shared/map_path.ts";
import { SOURCE_PATH_NAMES, SOURCE_PATHS } from "../shared/paths_registry.ts";
import { neutralAgentScopePaths } from "./providers.ts";

/** The agent/provider files the kit knows how to emit. */
export const KNOWN_AGENTS = AGENT_NAMES;
export type AgentName = (typeof AGENT_NAMES)[number];

// The known-job vocabulary, gate stages, and slug validation are defined once
// in the shared engine/installer module and re-exported here so existing
// installer imports (`from "../lib/config.ts"`) keep resolving.
export {
  isKnownJob,
  isValidSlug,
  jobStage,
  KNOWN_JOBS,
  knownJobList,
  SLUG_RULE,
  stageIsValid,
  stageList,
  STAGES,
} from "../shared/capabilities.ts";
export type { KnownJob, Stage } from "../shared/capabilities.ts";

/** Default values for every wizard answer. */
export const DEFAULTS = {
  branchPrefix: "agent/",
  sourceGlobs: ["src/**", "app/**"],
  // Default to the two built-in providers; gemini is opt-in.
  agents: [...DEFAULT_AGENTS] as AgentName[],
  mapDir: SOURCE_PATHS.map.defaultPath,
  gotchasDoc: "",
  scopesPreviewable: ['"public/**"'],
} as const;

/** Render one registry path as a scope pattern. The map keeps its live config
 * reference; other directories gain the trailing slash the scope matcher uses
 * for prefix matching. */
function neutralSourceScopePath(
  name: (typeof SOURCE_PATH_NAMES)[number],
): string {
  const entry = SOURCE_PATHS[name];
  if (name === "map") {
    return MAP_DIR_REFERENCE;
  }
  return entry.pathKind === "directory"
    ? `${entry.defaultPath.replace(/\/+$/, "")}/`
    : entry.defaultPath;
}

const DOCUMENTATION_SCOPE_SOURCES = ["map", "todo"] as const;

/** The pure-documentation paths a fresh install seeds under `[scopes.map]`. */
export function defaultDocumentationScopePaths(): string[] {
  return DOCUMENTATION_SCOPE_SOURCES.map(neutralSourceScopePath);
}

/** The fresh documentation paths, quoted for template substitution. */
export function defaultDocumentationScopes(): string[] {
  return defaultDocumentationScopePaths().map((path) => `"${path}"`);
}

/** The agent-instruction paths a fresh install seeds under
 * `[scopes.guidance]`. Every gate-neutral authored source outside the narrow
 * documentation set enrolls here, and materialized skills derive from the
 * provider registry. */
export function defaultGuidanceScopePaths(): string[] {
  return [
    ...SOURCE_PATH_NAMES
      .filter((name) =>
        SOURCE_PATHS[name].gateNeutral &&
        !(DOCUMENTATION_SCOPE_SOURCES as readonly string[]).includes(name)
      )
      .map(neutralSourceScopePath),
    ...neutralAgentScopePaths(),
  ];
}

/** The fresh guidance paths, quoted for template substitution. */
export function defaultGuidanceScopes(): string[] {
  return defaultGuidanceScopePaths().map((path) => `"${path}"`);
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
  mapDir?: string | undefined;
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
export function tokensFromConfig(
  config: SetupConfig,
  env: EnvReader = Deno.env,
): TokenMap {
  return {
    project_name: config.projectName,
    project_slug: config.slug,
    branch_prefix: config.branchPrefix,
    agents_array: renderTomlStringList(config.agents),
    map_dir: config.mapDir ?? DEFAULTS.mapDir,
    gotchas_doc: DEFAULTS.gotchasDoc,
    scopes_neutral: defaultDocumentationScopes().join(", "),
    scopes_guidance: defaultGuidanceScopes().join(", "),
    scopes_web: renderTomlStringList(config.sourceGlobs),
    scopes_previewable: DEFAULTS.scopesPreviewable.join(", "),
    artifact_provenance_marker: generatedArtifactMarkerBody(
      ARTIFACT_PROVENANCE_SOURCES.config,
      env,
    ),
    kit_version: KIT_VERSION,
  };
}
