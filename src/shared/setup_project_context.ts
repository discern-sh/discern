/** Derive the qualitative project context setup relays at completion. */

import { join } from "@std/path";
import { readTextIfExists } from "./fs_presence.ts";

export interface SetupPrimarySubsystem {
  region: string;
  page: string;
  title: string;
  start_here: string;
  boundary: string;
  non_obvious_invariant: string;
}

export interface SetupProjectContext {
  primary_subsystem: SetupPrimarySubsystem | null;
  principles: { count: number; items: string[] };
  instruction_sources: string[];
}

/** The first paragraph under one exact level-2 heading. */
function sectionParagraph(
  markdown: string,
  heading: string,
): string | undefined {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+${heading}\\s*$`, "i").test(line.trim())
  );
  if (start < 0) return undefined;
  const paragraph: string[] = [];
  let began = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s+/.test(line.trim())) break;
    if (/^\s*<!--/.test(line)) continue;
    if (line.trim() === "") {
      if (began) break;
      continue;
    }
    began = true;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(" ").trim();
  return text === "" ? undefined : text;
}

/** Region ids eligible to be the durable primary subsystem. Orientation and
 * development regions are supporting context, not the project's primary system. */
async function primaryRegionNames(
  root: string,
  mapDir: string,
): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(join(root, mapDir))) {
      if (
        entry.isDirectory && !entry.name.startsWith("_") &&
        !["orientation", "development"].includes(
          entry.name.replace(/^\d+-/, ""),
        )
      ) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names.toSorted();
}

/** Derive a handoff from the first subsystem or the root of a new project.
 * Structured sections enrich the summary but do not determine completion. */
export async function deriveSetupPrimarySubsystem(
  root: string,
  mapDir: string,
): Promise<SetupPrimarySubsystem | null> {
  const region = (await primaryRegionNames(root, mapDir))[0] ?? "";
  const page = join(mapDir, region, "README.md");
  const markdown = await readTextIfExists(join(root, page));
  if (markdown === undefined) return null;
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const startHere = sectionParagraph(markdown, "Start here") ?? `Read ${page}.`;
  const boundary = sectionParagraph(markdown, "Boundary") ??
    markdown.replaceAll(/<!--[\s\S]*?-->/g, "").split("\n").find((line) =>
      /^[A-Za-z]/.test(line)
    )?.trim();
  const invariant = sectionParagraph(markdown, "Important constraint") ??
    sectionParagraph(markdown, "Non-obvious invariant") ?? "";
  if (
    title === undefined || title === "" || startHere === undefined ||
    boundary === undefined
  ) {
    return null;
  }
  return {
    region,
    page,
    title,
    start_here: startHere,
    boundary,
    non_obvious_invariant: invariant,
  };
}

/** Parse principle names from the same heading contract setup completion checks. */
export function setupPrincipleNames(markdown: string): string[] {
  const names: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^##\s+(?:\d+\.\s*)?(.+?)\s*$/);
    const name = match?.[1]?.trim();
    if (name === undefined || /what these add up to/i.test(name)) continue;
    names.push(name.replaceAll(/[_*`]/g, ""));
  }
  return names;
}

/** Derive the qualitative context the completion result and relay consume. */
export async function deriveSetupProjectContext(
  root: string,
  mapDir: string,
  instructionSources: readonly string[],
): Promise<SetupProjectContext> {
  const principlesText = await readSetupOrientation(
    root,
    mapDir,
    "design-principles.md",
  );
  const principles = principlesText === undefined
    ? []
    : setupPrincipleNames(principlesText);
  return {
    primary_subsystem: await deriveSetupPrimarySubsystem(root, mapDir),
    principles: { count: principles.length, items: principles },
    instruction_sources: [...instructionSources],
  };
}

/** Read a setup orientation page with optional numeric ordering prefixes. */
export async function readSetupOrientation(
  root: string,
  mapDir: string,
  leaf: string,
): Promise<string | undefined> {
  try {
    const regions = [];
    for await (const entry of Deno.readDir(join(root, mapDir))) {
      if (
        entry.isDirectory && entry.name.replace(/^\d+-/, "") === "orientation"
      ) regions.push(entry.name);
    }
    for (const region of regions.toSorted()) {
      const text = await readTextIfExists(join(root, mapDir, region, leaf));
      if (text !== undefined) return text;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return undefined;
}
