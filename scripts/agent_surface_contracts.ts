/**
 * Derived universe and lexical check for discern's operational agent copy.
 *
 * Skill membership comes from `resolveEffectiveSkills`, the same authority the
 * materializer uses. Every Markdown instruction in an effective Skill joins the
 * lexical corpus; `skeleton/` descendants are payload templates, so they are the
 * one declared exclusion. The setup brief comes from `resolveSetupDir`, the same
 * template resolver `setup begin` uses.
 */

import { walk } from "@std/fs";
import { basename, dirname, join, relative, resolve } from "@std/path";
import type { DiscernConfig } from "../src/shared/config_schema.ts";
import {
  resolveEffectiveSkills,
  type SkillEntry,
  type SkillSource,
} from "../src/lib/skills.ts";
import { resolveSetupDir } from "../src/lib/paths.ts";
import {
  type AgentContractIssue,
  type AgentSurfaceContract,
  parseAgentSurfaceContract,
} from "./agent_contract.ts";
import { blankFrontmatter } from "./prose_lib.ts";
import { runVale } from "./vale_lib.ts";

export type OperationalAgentSurfaceKind = "skill" | "setup-brief";

/** One contract-bearing unit. Supporting Skill files inherit their SKILL.md's
 * contract and still enter `sourceFiles` for lexical review. */
export interface OperationalAgentSurface {
  readonly id: string;
  readonly kind: OperationalAgentSurfaceKind;
  readonly source: SkillSource | "setup";
  readonly sourceFile: string;
  readonly sourceFiles: readonly string[];
  readonly contract?: AgentSurfaceContract;
  readonly issues: readonly AgentContractIssue[];
}

/** One generated DiscernAgent Vale finding on an authored source. */
export interface AgentSurfaceLexicalIssue {
  readonly file: string;
  readonly line?: number;
  readonly col?: number;
  readonly check: string;
  readonly message: string;
}

/** Payloads copied into a project but not followed as instructions in place. */
export const NON_OPERATIONAL_AGENT_SEGMENTS = new Map([
  [
    "skeleton",
    "files copied into a project are output templates, not operational instructions followed in place",
  ],
]);

/** Render a repo-relative path when the source belongs to this checkout. */
function displayPath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.startsWith("..") ? path : rel;
}

/** Every operational Markdown file below one source directory. */
export async function operationalInstructionFiles(
  sourceDir: string,
): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(sourceDir, { exts: [".md"], includeDirs: false })
  ) {
    const segments = relative(sourceDir, entry.path).split(/[\\/]/);
    if (
      segments.some((segment) => NON_OPERATIONAL_AGENT_SEGMENTS.has(segment))
    ) {
      continue;
    }
    files.push(entry.path);
  }
  return files.sort();
}

/** Read one effective Skill as a contract-bearing operational surface. */
export async function operationalSkillSurface(
  skill: SkillEntry,
): Promise<OperationalAgentSurface> {
  const sourceFile = join(skill.srcAbs, "SKILL.md");
  const text = await Deno.readTextFile(sourceFile);
  const parsed = parseAgentSurfaceContract(text);
  const base = {
    id: `skill:${skill.name}`,
    kind: "skill" as const,
    source: skill.source,
    sourceFile,
    sourceFiles: await operationalInstructionFiles(skill.srcAbs),
    issues: parsed.issues,
  };
  return parsed.contract === undefined
    ? base
    : { ...base, contract: parsed.contract };
}

/** Resolve every setup brief from the template directory. A future Markdown
 * brief joins automatically; `skeleton/` remains an output-payload exclusion. */
export async function operationalSetupSurfaces(
  setupDir: string,
): Promise<OperationalAgentSurface[]> {
  const files = await operationalInstructionFiles(setupDir);
  return await Promise.all(files.map(async (sourceFile) => {
    const parsed = parseAgentSurfaceContract(
      await Deno.readTextFile(sourceFile),
    );
    const rel = relative(setupDir, sourceFile).replace(/\.md$/, "");
    const base = {
      id: `setup:${rel}`,
      kind: "setup-brief" as const,
      source: "setup" as const,
      sourceFile,
      sourceFiles: [sourceFile],
      issues: parsed.issues,
    };
    return parsed.contract === undefined
      ? base
      : { ...base, contract: parsed.contract };
  }));
}

/** Resolve the complete current corpus from the materializer and setup template
 * authorities. A new effective Skill joins without this function changing. */
export async function operationalAgentSurfaces(
  root: string,
  config: DiscernConfig,
): Promise<OperationalAgentSurface[]> {
  const skills = await resolveEffectiveSkills(root, config);
  const surfaces = await Promise.all(skills.map(operationalSkillSurface));
  surfaces.push(...await operationalSetupSurfaces(await resolveSetupDir()));
  return surfaces.sort((a, b) => a.id.localeCompare(b.id));
}

/** Flatten contract failures with stable source locations and accepted forms. */
export function operationalContractFailures(
  root: string,
  surfaces: readonly OperationalAgentSurface[],
): string[] {
  return surfaces.flatMap((surface) =>
    surface.issues.map((entry) =>
      `${displayPath(root, surface.sourceFile)}:${entry.line}: ${entry.message}`
    )
  );
}

/** Deduplicated Markdown corpus belonging to all enrolled surfaces. */
export function operationalAgentCorpusFiles(
  surfaces: readonly OperationalAgentSurface[],
): string[] {
  return [...new Set(surfaces.flatMap((surface) => surface.sourceFiles))]
    .sort();
}

/** Recognize Vale's decoded object rows. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Run the generated DiscernAgent Vale style over the non-Map agent corpus.
 * The check-name prefix is the enrollment source, so a future generated agent
 * lexical rule joins without a copied pattern or id list. */
export async function agentSurfaceLexicalIssues(
  repoRoot: string,
  files: readonly string[],
): Promise<AgentSurfaceLexicalIssue[]> {
  const stage = await Deno.makeTempDir({ prefix: "discern-agent-copy-" });
  const stagedToSource = new Map<string, string>();
  try {
    for (const [index, file] of files.entries()) {
      const staged = join(
        stage,
        String(index).padStart(4, "0"),
        basename(file),
      );
      await Deno.mkdir(dirname(staged), { recursive: true });
      await Deno.writeTextFile(
        staged,
        blankFrontmatter(await Deno.readTextFile(file)),
      );
      stagedToSource.set(resolve(staged), file);
    }

    const run = await runVale(repoRoot, [
      "--minAlertLevel",
      "suggestion",
      "--output=JSON",
      stage,
    ]);
    const decoder = new TextDecoder();
    const stdout = decoder.decode(run.stdout);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      const stderr = decoder.decode(run.stderr).trim();
      throw new Error(
        `Vale returned unreadable JSON for the agent-copy corpus${
          stderr === "" ? "" : `: ${stderr}`
        }`,
        { cause: error },
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(
        "Vale returned a non-object result for the agent-copy corpus",
      );
    }

    const issues: AgentSurfaceLexicalIssue[] = [];
    for (const [stagedPath, alerts] of Object.entries(parsed)) {
      if (!Array.isArray(alerts)) continue;
      const source = stagedToSource.get(resolve(stagedPath));
      if (source === undefined) {
        throw new Error(
          `Vale reported an unenrolled staged path: ${stagedPath}`,
        );
      }
      for (const alert of alerts) {
        if (!isRecord(alert)) continue;
        const check = alert.Check;
        if (typeof check !== "string" || !check.startsWith("DiscernAgent.")) {
          continue;
        }
        const row: AgentSurfaceLexicalIssue = {
          file: displayPath(repoRoot, source),
          check,
          message: typeof alert.Message === "string"
            ? alert.Message
            : "Agent-copy lexical rule failed.",
        };
        if (typeof alert.Line === "number") {
          Object.assign(row, { line: alert.Line });
        }
        const col = Array.isArray(alert.Span) ? alert.Span[0] : undefined;
        if (typeof col === "number") {
          Object.assign(row, { col });
        }
        issues.push(row);
      }
    }
    return issues.sort((a, b) =>
      a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) ||
      a.check.localeCompare(b.check)
    );
  } finally {
    await Deno.remove(stage, { recursive: true }).catch(() => {});
  }
}

/** Human-readable source-located lexical diagnostics. */
export function formatAgentLexicalIssues(
  issues: readonly AgentSurfaceLexicalIssue[],
): string[] {
  return issues.map((entry) =>
    `${entry.file}${entry.line === undefined ? "" : `:${entry.line}`}${
      entry.col === undefined ? "" : `:${entry.col}`
    }: ${entry.check}: ${entry.message}`
  );
}
