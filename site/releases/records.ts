/** Load the authored release records used by every release projection. */
import { isHostMetadataPath } from "../../src/shared/host_metadata.ts";
import { parse as parseYaml } from "@std/yaml";
import { z } from "@zod/zod";
import {
  compareVersions,
  parseVersion,
  versionFamily,
} from "../../src/shared/semver.ts";

export const RELEASE_RECORD_ROOT = new URL("./records/", import.meta.url);
const metadataSchema = z.strictObject({
  summary: z.string().trim().min(1).max(240),
  date: z.iso.date().optional(),
  codename: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}\p{Cf}]+$/u)
    .optional(),
});

export interface ReleaseSource {
  path: string;
  markdown: string;
}
export interface ReleaseRecord {
  version: string;
  summary: string;
  body: string;
  date?: string;
  codename?: string;
}
export interface AuthoredRelease extends ReleaseRecord {
  source: string;
  declaredCodename?: string;
}

/** Validate metadata and resolve each family's single declaration deterministically. */
export function parseReleaseRecords(
  sources: readonly ReleaseSource[],
): AuthoredRelease[] {
  const records = sources.map(({ path, markdown }): AuthoredRelease => {
    try {
      const filename = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
      if (!filename.endsWith(".md")) throw new Error("expected <semver>.md");
      const version = filename.slice(0, -3);
      parseVersion(version);
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
      if (match === null) {
        throw new Error("expected YAML metadata followed by release notes");
      }
      const metadata = metadataSchema.parse(
        parseYaml(match[1] ?? "", { schema: "core" }),
      );
      const body = (match[2] ?? "").trim();
      if (body.length === 0) throw new Error("release notes must not be empty");
      return {
        version,
        source: path,
        summary: metadata.summary,
        body,
        ...(metadata.date === undefined ? {} : { date: metadata.date }),
        ...(metadata.codename === undefined
          ? {}
          : { declaredCodename: metadata.codename }),
      };
    } catch (cause) {
      throw new Error(
        `${path}: invalid release record: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }
  }).sort((a, b) =>
    compareVersions(a.version, b.version) || a.source.localeCompare(b.source)
  );
  const families = new Map<string, AuthoredRelease[]>();
  for (const [index, record] of records.entries()) {
    const previous = records[index - 1];
    if (
      previous !== undefined &&
      compareVersions(previous.version, record.version) === 0
    ) {
      throw new Error(
        `${record.source}: duplicate release precedence ${record.version}; conflicts with ${previous.source}`,
      );
    }
    const family = versionFamily(record.version);
    const members = families.get(family) ?? [];
    members.push(record);
    families.set(family, members);
  }
  for (const [family, members] of families) {
    const declarations = members.filter((record) =>
      record.declaredCodename !== undefined
    );
    if (declarations.length > 1) {
      throw new Error(
        `family ${family}: competing codename declarations in ${
          declarations.map((r) => r.source).join(", ")
        }`,
      );
    }
    const declaring = declarations[0];
    if (declaring !== undefined && declaring !== members[0]) {
      throw new Error(
        `${declaring.source}: declare family ${family}'s codename in its earliest retained record ${
          members[0]?.source
        }`,
      );
    }
    if (declaring?.declaredCodename !== undefined) {
      for (const member of members) {
        member.codename = declaring.declaredCodename;
      }
    }
  }
  return records.reverse();
}

/** Enumerate regular Markdown records; every newly authored record auto-enrols. */
export async function loadReleaseRecords(
  root: URL = RELEASE_RECORD_ROOT,
): Promise<AuthoredRelease[]> {
  const sources: ReleaseSource[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (isHostMetadataPath(entry.name)) continue;
    if (!entry.isFile || !entry.name.endsWith(".md")) {
      throw new Error(
        `${root.pathname}${entry.name}: expected a regular <semver>.md release record`,
      );
    }
    sources.push({
      path: `${root.pathname}${entry.name}`,
      markdown: await Deno.readTextFile(new URL(entry.name, root)),
    });
  }
  return parseReleaseRecords(sources);
}

/** Require the package's exact numeric identity, including its build metadata. */
export function currentRelease(
  records: readonly AuthoredRelease[],
  version: string,
): AuthoredRelease {
  const record = records.find((record) => record.version === version);
  if (record === undefined) {
    throw new Error(
      `site/releases/records/${version}.md: missing current-version release record for deno.json ${version}`,
    );
  }
  return record;
}

/** Remove authoring locations and declarations from the public model. */
export function publicRelease(record: AuthoredRelease): ReleaseRecord {
  const { source: _source, declaredCodename: _declaration, ...result } = record;
  return result;
}

/** Hold every published family's resolved name, including its absence. */
export function assertPublishedCodenames(
  current: readonly AuthoredRelease[],
  published: readonly AuthoredRelease[],
): void {
  for (const record of published) {
    const retained = currentRelease(current, record.version);
    if (
      retained.codename !== record.codename ||
      retained.declaredCodename !== record.declaredCodename
    ) {
      throw new Error(
        `${retained.source}: published codename for family ${
          versionFamily(record.version)
        } changed; retain ${record.source} and its declaration`,
      );
    }
  }
}
