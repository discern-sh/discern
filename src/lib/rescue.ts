import { dirname, join, relative } from "@std/path";
import { ensureDir, walk } from "@std/fs";

export const RESCUE_DIR = ".discern-rescue";
export const GUIDANCE_BASELINES_REL = join(
  RESCUE_DIR,
  "guidance-baselines.json",
);
const GENERATED_RESCUE_DIR = join(RESCUE_DIR, "generated");
const SKILLS_RESCUE_DIR = join(RESCUE_DIR, "skills");

export interface GuidanceBaseline {
  content: string;
}

export type GuidanceBaselines = Record<string, GuidanceBaseline>;

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function safeArtifactName(path: string): string {
  return path.replaceAll("\\", "__").replaceAll("/", "__");
}

export async function readGuidanceBaselines(
  root: string,
): Promise<GuidanceBaselines> {
  try {
    const parsed = JSON.parse(
      await Deno.readTextFile(join(root, GUIDANCE_BASELINES_REL)),
    ) as unknown;
    if (
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ) {
      const out: GuidanceBaselines = {};
      for (const [path, record] of Object.entries(parsed)) {
        if (
          record !== null && typeof record === "object" &&
          typeof (record as { content?: unknown }).content === "string"
        ) {
          out[path] = { content: (record as { content: string }).content };
        }
      }
      return out;
    }
  } catch {
    // Missing or corrupt rescue metadata disables baseline-aware classification for
    // this run; the caller will fall back to conservative rescue.
  }
  return {};
}

export async function writeGuidanceBaselines(
  root: string,
  baselines: GuidanceBaselines,
): Promise<void> {
  const ordered: GuidanceBaselines = {};
  for (const key of Object.keys(baselines).sort()) {
    const record = baselines[key];
    if (record !== undefined) {
      ordered[key] = record;
    }
  }
  const out = join(root, GUIDANCE_BASELINES_REL);
  await ensureDir(dirname(out));
  await Deno.writeTextFile(out, stableJson(ordered));
}

export function guidanceRescueRel(sourceRel: string): string {
  return join(
    GENERATED_RESCUE_DIR,
    `${safeArtifactName(sourceRel)}.rescued.md`,
  );
}

export function skillRescueRel(skillsRel: string, skillName: string): string {
  return join(SKILLS_RESCUE_DIR, safeArtifactName(skillsRel), skillName);
}

export async function writeGuidanceRescue(
  root: string,
  sourceRel: string,
  body: string,
): Promise<string | undefined> {
  if (body.trim() === "") {
    return undefined;
  }
  const destRel = guidanceRescueRel(sourceRel);
  const destAbs = join(root, destRel);
  await ensureDir(dirname(destAbs));
  const block = [
    `# Rescued edits from ${sourceRel}`,
    "",
    "discern found content in a generated agent file that was not present in",
    "the last generated baseline or in the new render. The generated file was",
    "recompiled; move any durable guidance below into guidance.md, then delete",
    "this rescue file once handled.",
    "",
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");

  let next = block;
  try {
    const existing = await Deno.readTextFile(destAbs);
    if (existing.includes(body.trim())) {
      return destRel;
    }
    next = `${existing.trimEnd()}\n\n---\n\n${block}`;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  await Deno.writeTextFile(destAbs, next);
  return destRel;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function uniqueRescueRel(root: string, baseRel: string): Promise<string> {
  if (!(await pathExists(join(root, baseRel)))) {
    return baseRel;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseRel}.${i}`;
    if (!(await pathExists(join(root, candidate)))) {
      return candidate;
    }
  }
  throw new Error(`could not find a free rescue path for ${baseRel}`);
}

export async function moveAsideToRescue(
  root: string,
  fromAbs: string,
  baseDestRel: string,
): Promise<string> {
  const destRel = await uniqueRescueRel(root, baseDestRel);
  const destAbs = join(root, destRel);
  await ensureDir(dirname(destAbs));
  await Deno.rename(fromAbs, destAbs);
  return destRel;
}

export async function listRescuedArtifacts(root: string): Promise<string[]> {
  const dir = join(root, RESCUE_DIR);
  const artifacts: string[] = [];
  try {
    for await (
      const entry of walk(dir, { includeDirs: false, followSymlinks: false })
    ) {
      const rel = relative(root, entry.path);
      if (rel === GUIDANCE_BASELINES_REL) {
        continue;
      }
      artifacts.push(rel);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
  return artifacts.sort();
}

export function rescueHint(paths: readonly string[]): string {
  const sample = paths.slice(0, 3).join(", ");
  const more = paths.length > 3 ? `, and ${paths.length - 3} more` : "";
  return `discern rescued generated-artifact content under ${RESCUE_DIR}/ (${sample}${more}). Move durable guidance into guidance.md and durable skills into [skills].dir, then delete the rescue files once handled.`;
}
