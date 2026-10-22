/**
 * Canonical project-tree artifact enumeration.
 *
 * The ADR 0099 write boundary, the ownership forcing function, and the
 * install-surface inventory all consume this one normalized list. Configurable
 * sources and provider artifacts keep their declarations in their existing
 * registries; this module combines them with fixed project shims and the
 * configured worktree environment paths.
 */

import { AGENT_NAMES, type DiscernConfig } from "../shared/config_schema.ts";
import type { AgentName } from "./config.ts";
import {
  ARTIFACT_PROVENANCE,
  COMMENT_INCAPABLE_ARTIFACT,
  commentCapableNonContextArtifact,
  declaredFileOwnership,
  declaredWrittenArtifactClass,
  discernProjectPayloadLicense,
  FILE_OWNERSHIP_BUCKETS,
  type FileOwnershipDeclaration,
  type FileOwnershipKind,
  PROVIDER_LOCAL,
  type WrittenArtifactClass,
  type WrittenArtifactClassDeclaration,
} from "../shared/file_ownership.ts";
import { SOURCE_PATHS } from "../shared/paths_registry.ts";
import { resolveSourcePaths } from "../shared/source_path_resolution.ts";
import { PROVIDERS, wiredMcp } from "./providers.ts";
import {
  MATERIALIZED_MANIFEST,
  SKILLS_IGNORE_FILE,
} from "./skill_ownership.ts";

/** Whether one declaration admits one file or every file below a directory. */
export type ArtifactPathKind = "file" | "directory";

/** One project-relative path declaration and its File ownership answer. */
export interface ArtifactPathEntry {
  readonly id: string;
  readonly path: string;
  readonly pathKind: ArtifactPathKind;
  readonly ownership: FileOwnershipDeclaration;
  /** Required for Shared and Generated entries; absent on sources and provider state. */
  readonly writtenArtifact?: WrittenArtifactClassDeclaration;
  readonly description: string;
}

/** A path discern continues to write or maintain after setup. */
interface WrittenArtifactPathEntry extends ArtifactPathEntry {
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
}

/** Fixed project-tree paths outside the source and provider registries. */
export const FIXED_PROJECT_ARTIFACTS: readonly WrittenArtifactPathEntry[] = [
  {
    id: "fixed:config",
    path: "discern.toml",
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE.config,
    ),
    description:
      "Project configuration. discern maintains its fixed scaffold and ruled banners.",
  },
  {
    id: "fixed:gitignore",
    path: ".gitignore",
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE.gitignore,
    ),
    description: "Project ignore rules. discern maintains its marked block.",
  },
  {
    id: "fixed:gitattributes",
    path: ".gitattributes",
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE.gitattributes,
    ),
    description:
      "Project attributes. discern maintains its marked generated-artifact and Markdown-diff block.",
  },
];

/** Project configured environment files into shared written-artifact entries. */
function environmentArtifacts(
  config: DiscernConfig,
): WrittenArtifactPathEntry[] {
  return config.worktree.env_files.map((path, index) => ({
    id: `fixed:environment:${index}`,
    path,
    pathKind: "file",
    ownership: { shared: true },
    writtenArtifact: commentCapableNonContextArtifact(
      ARTIFACT_PROVENANCE.worktreeEnvironment,
    ),
    description:
      "Worktree environment file. discern maintains inherited entries plus DISCERN_* identity and resource entries; inheritance may create the first configured file.",
  }));
}

/** Materialize configured source-path declarations as ownership entries. */
export function sourceArtifactPaths(
  config: DiscernConfig,
): ArtifactPathEntry[] {
  return resolveSourcePaths(config).map(({ name, path, pathKind }) => {
    const entry = SOURCE_PATHS[name];
    return {
      id: `source:${name}`,
      path,
      pathKind,
      ownership: entry.ownership,
      description: entry.description,
    };
  });
}

/** Flatten each provider's integration and local-state declarations into path entries. */
function providerArtifacts(
  agents: readonly AgentName[] = AGENT_NAMES,
): ArtifactPathEntry[] {
  const entries: ArtifactPathEntry[] = [];
  for (const name of agents) {
    const provider = PROVIDERS[name];
    entries.push({
      id: `provider:${name}:instructions`,
      path: provider.instructionFile.path,
      pathKind: "file",
      ownership: provider.instructionFile.ownership,
      writtenArtifact: provider.instructionFile.writtenArtifact,
      description:
        "Agent file compiled from the configured instruction sources.",
    });
    if (provider.skillsDir !== undefined) {
      const dir = provider.skillsDir.path;
      entries.push({
        id: `provider:${name}:skills`,
        path: dir,
        pathKind: "directory",
        ownership: provider.skillsDir.ownership,
        writtenArtifact: provider.skillsDir.writtenArtifact,
        description:
          `Skills directory. discern maintains the skills its \`${MATERIALIZED_MANIFEST}\` names; other entries stay their installers'.`,
      }, {
        id: `provider:${name}:skills-record`,
        path: `${dir}/${MATERIALIZED_MANIFEST}`,
        pathKind: "file",
        ownership: { generated: true },
        writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
        description: "Names the skills discern placed in this directory.",
      }, {
        id: `provider:${name}:skills-ignore`,
        path: `${dir}/${SKILLS_IGNORE_FILE}`,
        pathKind: "file",
        ownership: { generated: true },
        writtenArtifact: commentCapableNonContextArtifact(
          ARTIFACT_PROVENANCE.skillsIgnore,
        ),
        description:
          "Ignores only the skills discern placed in this directory.",
      });
    }
    const mcp = wiredMcp(provider);
    if (mcp !== undefined) {
      entries.push({
        id: `provider:${name}:mcp`,
        path: mcp.configFile,
        pathKind: "file",
        ownership: mcp.ownership,
        writtenArtifact: mcp.writtenArtifact,
        description:
          "Provider configuration. discern maintains its registered entries.",
      });
    }
    if (provider.hooks !== undefined) {
      entries.push({
        id: `provider:${name}:hooks`,
        path: provider.hooks.settingsFile,
        pathKind: "file",
        ownership: provider.hooks.ownership,
        writtenArtifact: provider.hooks.writtenArtifact,
        description:
          "Provider configuration. discern maintains its registered entries.",
      });
    }
    if (provider.worktreeApp !== undefined) {
      entries.push({
        id: `provider:${name}:worktree-app`,
        path: provider.worktreeApp.configFile,
        pathKind: "file",
        ownership: provider.worktreeApp.ownership,
        writtenArtifact: provider.worktreeApp.writtenArtifact,
        description:
          "Provider app configuration. discern maintains its setup and cleanup entries.",
      });
    }
    if (provider.projectRules !== undefined) {
      entries.push({
        id: `provider:${name}:project-rules`,
        path: provider.projectRules.rulesFile,
        pathKind: "file",
        ownership: provider.projectRules.ownership,
        writtenArtifact: provider.projectRules.writtenArtifact,
        description:
          "Provider rules entry maintained by discern. Neighboring rules remain the project's.",
      });
    }
    for (const local of provider.localState ?? []) {
      entries.push({
        id: `provider:${name}:local:${local.path}`,
        path: local.path,
        pathKind: "file",
        ownership: local.ownership,
        description: local.ownership[PROVIDER_LOCAL] ??
          "Provider-created machine-local state.",
      });
    }
  }
  return entries;
}

/** Append distinct ownership prose without repeating an already-contained sentence. */
function mergeDescription(current: string, incoming: string): string {
  if (current === incoming || current.includes(incoming)) {
    return current;
  }
  return `${current} ${incoming}`;
}

/** Coalesce declarations by path and reject conflicting kinds or ownership classes. */
function normalizeArtifacts(
  declarations: readonly ArtifactPathEntry[],
): ArtifactPathEntry[] {
  const byPath = new Map<string, ArtifactPathEntry>();
  for (const declaration of declarations) {
    const kind = declaredFileOwnership(declaration);
    const writtenClass = writtenArtifactClass(declaration);
    const key = declaration.path;
    const current = byPath.get(key);
    if (current === undefined) {
      byPath.set(key, declaration);
      continue;
    }
    const currentKind = declaredFileOwnership(current);
    const currentWrittenClass = writtenArtifactClass(current);
    if (current.pathKind !== declaration.pathKind) {
      throw new Error(
        `${declaration.path} is declared as both a file and a directory`,
      );
    }
    if (currentKind !== kind) {
      throw new Error(
        `${declaration.path} has conflicting ownership declarations: ` +
          `${currentKind} and ${kind}`,
      );
    }
    if (currentWrittenClass !== writtenClass) {
      throw new Error(
        `${declaration.path} has conflicting written-artifact classes: ` +
          `${currentWrittenClass ?? "none"} and ${writtenClass ?? "none"}`,
      );
    }
    byPath.set(key, {
      ...current,
      id: `${current.id},${declaration.id}`,
      description: mergeDescription(
        current.description,
        declaration.description,
      ),
    });
  }
  return [...byPath.values()];
}

/**
 * Every project-tree path discern writes or maintains, plus declared
 * provider-local state that discern only keeps outside Git.
 */
export function projectArtifactPaths(
  config: DiscernConfig,
): ArtifactPathEntry[] {
  return normalizeArtifacts([
    ...sourceArtifactPaths(config),
    ...FIXED_PROJECT_ARTIFACTS,
    ...environmentArtifacts(config),
    ...providerArtifacts(),
  ]);
}

/**
 * The integration files discern writes for these agents and expects Git to
 * track: every Shared file a provider declares, so a bare clone carries
 * discern's wiring. Skills directories are Shared too, but Git ignores
 * discern's own entries there by design, and agent files are compiled
 * outputs the agent commits itself. Unknown agent names contribute nothing.
 */
export function trackedSharedProviderPaths(
  agents: readonly string[],
): string[] {
  const known = AGENT_NAMES.filter((name) => agents.includes(name));
  return normalizeArtifacts(providerArtifacts(known))
    .filter((entry) =>
      entry.pathKind === "file" && declaredFileOwnership(entry) === "shared"
    )
    .map((entry) => entry.path);
}

/** True when `rel` is inside one registered file or directory path. */
export function artifactPathMatches(
  entry: ArtifactPathEntry,
  rel: string,
): boolean {
  if (entry.pathKind === "file") {
    return rel === entry.path;
  }
  const prefix = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
  return rel.startsWith(prefix);
}

/** Whether discern may write this registered entry. */
export function isDiscernWriteTarget(entry: ArtifactPathEntry): boolean {
  return declaredFileOwnership(entry) !== PROVIDER_LOCAL;
}

/**
 * The provenance class for an artifact discern continues to write or maintain.
 * Project-owned seeds and provider-local state return undefined and must not
 * carry a declaration. A Shared comment-capable artifact must name the scope its
 * marker claims; a Generated one must not, because its marker claims the file.
 */
export function writtenArtifactClass(
  entry: ArtifactPathEntry,
): WrittenArtifactClass | undefined {
  const ownership = declaredFileOwnership(entry);
  const isWritten = ownership === "shared" || ownership === "generated";
  if (!isWritten) {
    if (entry.writtenArtifact !== undefined) {
      throw new Error(
        `${entry.id} is ${ownership} and must not declare a written-artifact class`,
      );
    }
    return undefined;
  }
  const artifactClass = declaredWrittenArtifactClass({
    id: entry.id,
    writtenArtifact: entry.writtenArtifact ?? {},
  });
  const scope = entry.writtenArtifact?.["comment-capable-non-context"]?.scope;
  if (
    artifactClass === "comment-capable-non-context" &&
    (ownership === "shared") !== (scope !== undefined)
  ) {
    throw new Error(
      ownership === "shared"
        ? `${entry.id} is shared and must name the scope its provenance marker claims`
        : `${entry.id} is generated and its provenance marker must claim the whole file, not a scope`,
    );
  }
  return artifactClass;
}

/** Marker delimiting the generated inventory within the development page. */
export const ARTIFACT_INVENTORY_START =
  "<!-- BEGIN GENERATED: project artifact ownership -->";
export const ARTIFACT_INVENTORY_END =
  "<!-- END GENERATED: project artifact ownership -->";

const OWNERSHIP_LABELS: Readonly<Record<FileOwnershipKind, string>> = {
  "project-owned": "Project-owned",
  shared: "Shared",
  generated: "Generated",
  "provider-local": "Provider-local",
};

const WRITTEN_ARTIFACT_LABELS: Readonly<Record<WrittenArtifactClass, string>> =
  {
    "context-loaded": "Context-loaded",
    "comment-incapable": "Comment-incapable",
    "comment-capable-non-context": "Comment-capable non-context",
  };

/** Escape pipes and flatten line breaks so prose remains inside one table cell. */
function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Format a file as inline code and a directory as its recursive path pattern. */
function displayedPath(entry: ArtifactPathEntry): string {
  const path = entry.pathKind === "directory"
    ? `${entry.path.replace(/\/$/, "")}/**`
    : entry.path;
  return `\`${path}\``;
}

/** Align headings and rows into a deterministic Markdown table. */
function renderMarkdownTable(
  headings: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  const widths = headings.map((heading, index) =>
    Math.max(
      heading.length,
      ...rows.map((row) => row[index]?.length ?? 0),
    )
  );
  const line = (cells: readonly string[]): string =>
    `| ${
      cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
        .join(
          " | ",
        )
    } |`;
  return [
    line(headings),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map(line),
  ];
}

/** Render the exhaustive registry-derived Markdown inventory. */
export function renderArtifactInventory(
  entries: readonly ArtifactPathEntry[],
): string {
  const order: readonly FileOwnershipKind[] = [
    ...FILE_OWNERSHIP_BUCKETS,
    PROVIDER_LOCAL,
  ];
  const sorted = [...entries].sort((a, b) => {
    const ownershipOrder = order.indexOf(declaredFileOwnership(a)) -
      order.indexOf(declaredFileOwnership(b));
    return ownershipOrder !== 0 ? ownershipOrder : a.path.localeCompare(b.path);
  });
  const rows = sorted.map((entry) => {
    const artifactClass = writtenArtifactClass(entry);
    const payloadLicense = discernProjectPayloadLicense(entry);
    return [
      displayedPath(entry),
      OWNERSHIP_LABELS[declaredFileOwnership(entry)],
      artifactClass === undefined
        ? "—"
        : WRITTEN_ARTIFACT_LABELS[artifactClass],
      payloadLicense ?? "—",
      markdownCell(entry.description),
    ];
  });
  return [
    ARTIFACT_INVENTORY_START,
    "<!-- This table is generated from the ownership registries. -->",
    "",
    ...renderMarkdownTable(
      [
        "Path",
        "Ownership",
        "Provenance class",
        "discern-authored portions",
        "What discern maintains",
      ],
      rows,
    ),
    "",
    ARTIFACT_INVENTORY_END,
  ].join("\n");
}

/** Replace the generated inventory block without changing the rest of the page. */
export function replaceArtifactInventory(
  document: string,
  inventory: string,
): string {
  const start = document.indexOf(ARTIFACT_INVENTORY_START);
  const end = document.indexOf(ARTIFACT_INVENTORY_END);
  if (start < 0 || end < start) {
    throw new Error(
      "install-surface.md is missing the generated artifact inventory markers",
    );
  }
  const after = end + ARTIFACT_INVENTORY_END.length;
  return `${document.slice(0, start)}${inventory}${document.slice(after)}`;
}
