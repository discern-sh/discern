/**
 * The closed policy model for discern's published product manual.
 *
 * This module is dependency-light because the build, repository checks,
 * checkpoint matcher, terminal command, MCP adapter, and website all need the
 * same corpus boundary. Markdown discovery and rendering remain neutral; this
 * registry decides which discovered paths can belong to the manual and what
 * editorial purposes its pages may declare.
 */

/** The fixed repository source for discern's product manual. */
export const REPOSITORY_MANUAL_REL = "project/manual";

/** One editorial purpose and the checkpoint that judges it. */
export interface ManualKindRegistration {
  readonly kind: ManualKind;
  readonly checkpointId: ManualCheckpointId;
  /** Whether the reading-complexity measure includes this kind. */
  readonly measuresReadingComplexity: boolean;
}

/** The five purpose-specific manual checkpoints. */
export type ManualCheckpointId =
  | "manual-tutorial-comprehension"
  | "manual-guide-comprehension"
  | "manual-explanation-comprehension"
  | "manual-reference-comprehension"
  | "manual-troubleshooting-comprehension";

/** The checkpoint governing additions or replacements in the promoted journey. */
export const MANUAL_FRONT_DOOR_CHECKPOINT_ID =
  "manual-front-door-promotion" as const;

/** The closed editorial purposes a manual page can serve. */
export const MANUAL_KINDS = [
  "tutorial",
  "guide",
  "explanation",
  "reference",
  "troubleshooting",
] as const;

export type ManualKind = (typeof MANUAL_KINDS)[number];

/** Human-readable label for one registered manual purpose. */
export function manualKindLabel(kind: ManualKind): string {
  return `${kind.charAt(0).toLocaleUpperCase()}${kind.slice(1)}`;
}

/**
 * Every manual kind and its policy, in the programme's canonical order. A new
 * member joins publication validation, prose projection, and checkpoint
 * enrolment through this one registry.
 */
export const MANUAL_KIND_REGISTRY: readonly ManualKindRegistration[] = [
  {
    kind: "tutorial",
    checkpointId: "manual-tutorial-comprehension",
    measuresReadingComplexity: true,
  },
  {
    kind: "guide",
    checkpointId: "manual-guide-comprehension",
    measuresReadingComplexity: true,
  },
  {
    kind: "explanation",
    checkpointId: "manual-explanation-comprehension",
    measuresReadingComplexity: true,
  },
  {
    kind: "reference",
    checkpointId: "manual-reference-comprehension",
    measuresReadingComplexity: false,
  },
  {
    kind: "troubleshooting",
    checkpointId: "manual-troubleshooting-comprehension",
    measuresReadingComplexity: true,
  },
];

const MANUAL_KIND_SET: ReadonlySet<string> = new Set(
  MANUAL_KIND_REGISTRY.map((entry) => entry.kind),
);

/** Whether an untrusted frontmatter value is a registered manual kind. */
export function isManualKind(value: unknown): value is ManualKind {
  return typeof value === "string" && MANUAL_KIND_SET.has(value);
}

/** One top-level manual section and its route identity. */
export interface ManualSectionRegistration {
  readonly dir: string;
  readonly slug: string;
}

/** The complete manual section set, in navigation order. */
export const MANUAL_SECTION_REGISTRY: readonly ManualSectionRegistration[] = [
  { dir: "00-start", slug: "start" },
  { dir: "10-guides", slug: "guides" },
  { dir: "20-understand", slug: "understand" },
  { dir: "30-reference", slug: "reference" },
  { dir: "40-troubleshooting", slug: "troubleshooting" },
];

/**
 * Destination decisions for the normalized search names that collided during
 * the Map-to-manual migration. New collisions fail validation until one page
 * receives explicit ownership here.
 */
export const MANUAL_ALIAS_OWNER_OVERRIDES: Readonly<Record<string, string>> = {
  "--markdown": "reference-results-and-mcp",
  "checkpoints": "explanation-checkpoints",
  "coupling": "guide-improve-the-practice",
  "declared met": "reference-proof-and-checkpoint-formats",
  "declared unmet": "reference-proof-and-checkpoint-formats",
  "discern accept": "reference-cli",
  "discern start": "reference-cli",
  "discern update": "reference-cli",
  "discern await": "reference-cli",
  "discern checkpoints": "reference-cli",
  "discern coupling": "reference-cli",
  "discern desk": "reference-cli",
  "discern done": "reference-cli",
  "discern identity": "reference-cli",
  "discern improvement": "reference-cli",
  "discern patterns": "reference-cli",
  "discern standards": "reference-cli",
  "discern status": "reference-cli",
  "discern tidy": "reference-cli",
  "discern enter": "reference-cli",
  "discern_checkpoint_input": "reference-environment-variables",
  "discern_checkpoints": "reference-results-and-mcp",
  "discern_match": "reference-proof-and-checkpoint-formats",
  "gate": "explanation-proof",
  "getting started": "start-index",
  "install": "start-first-success",
  "instructions": "guide-write-project-instructions",
  "json result": "reference-results-and-mcp",
  "markdown result": "reference-results-and-mcp",
  "structuredcontent": "reference-results-and-mcp",
  "landing authority": "explanation-proof",
  "logbook": "reference-logbook",
  "map": "explanation-instructions-skills-and-map",
  "open question": "explanation-checkpoints",
  "patterns": "explanation-evidence-and-improvement",
  "practice": "explanation-practice-and-roles",
  "practice health": "guide-improve-the-practice",
  "prerequisites": "reference-platforms-and-providers",
  "proof format": "reference-proof-and-checkpoint-formats",
  "proof": "explanation-proof",
  "proof note schema": "reference-proof-and-checkpoint-formats",
  "proof note": "reference-proof-and-checkpoint-formats",
  "skill": "explanation-instructions-skills-and-map",
  "skills": "guide-create-and-manage-skills",
  "standards": "explanation-standards",
  "tidy": "guide-maintain-or-remove-discern",
  "upgrade": "guide-maintain-or-remove-discern",
  "variance": "explanation-checkpoints",
  "worktree": "explanation-worktrees-and-trunk",
};

const MANUAL_SECTION_SET: ReadonlySet<string> = new Set(
  MANUAL_SECTION_REGISTRY.map((entry) => entry.dir),
);

/** Whether a top-level directory is a registered manual section. */
export function isManualSection(value: string): boolean {
  return MANUAL_SECTION_SET.has(value);
}

/**
 * Whether a path relative to the manual root belongs to the canonical corpus.
 * The root README and Markdown below registered sections are admitted;
 * underscore-prefixed or nested hidden regions are not.
 */
export function isManualMarkdownPath(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  if (normalized === "README.md") return true;
  const parts = normalized.split("/");
  if (
    parts.length < 2 || !isManualSection(parts[0] ?? "") ||
    parts.some((part) => part === "" || part === "." || part === "..") ||
    parts.slice(1, -1).some((part) => part.startsWith("_"))
  ) {
    return false;
  }
  return (parts.at(-1) ?? "").toLowerCase().endsWith(".md");
}

/** Resolve one registered kind by its checkpoint id. */
export function manualKindForCheckpoint(
  checkpointId: string,
): ManualKind | undefined {
  return MANUAL_KIND_REGISTRY.find((entry) =>
    entry.checkpointId === checkpointId
  )?.kind;
}
