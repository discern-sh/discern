/** Publication hygiene guards driven by repository file policy. */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { dirname, join, relative, resolve } from "@std/path";
import { z } from "@zod/zod";
import {
  CONTRIBUTOR_INTAKE_SURFACES,
  EDITOR_PATH_POLICIES,
  PERSONAL_TODO_HEADING_NAMES,
  REPOSITORY_COMMUNITY_FILE_POLICIES,
} from "../scripts/repository_files.ts";
import { CONTRIBUTOR_AGREEMENTS_OFFERED } from "../scripts/contributor_agreement.ts";
import { fileExists, targetExists } from "../src/shared/fs_presence.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { MAP_TIER_PUBLICATION_POSTURES } from "../src/lib/paths.ts";
import { mapPageKind } from "../src/lib/map_policy.ts";
import { extractDocLinks } from "../src/lib/docs_integrity.ts";
import { STATIC_REDIRECTS } from "../site/seo.tsx";

const text = async (rel: string): Promise<string> =>
  await Deno.readTextFile(join(REPO_ROOT, rel));

/** Return the registered personal attribution found in one TODO heading. */
function personalTodoHeadingAttribution(heading: string): string | undefined {
  return PERSONAL_TODO_HEADING_NAMES.find((name) =>
    new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`,
      "iu",
    ).test(heading)
  );
}

/** Normalize one editor exclusion into a repository-relative path. */
function normalizedEditorPath(raw: string): string {
  return raw.replace(/^\.\//u, "").replace(/\/\/\*$/u, "");
}

const EditorExclusionsSchema = z.record(z.string(), z.boolean());
const EditorSettingsSchema = z.object({
  "files.exclude": EditorExclusionsSchema.optional(),
  "search.exclude": EditorExclusionsSchema.optional(),
}).passthrough();

/** Read the exclusion paths declared by every shared editor configuration. */
async function configuredEditorExclusions(): Promise<Set<string>> {
  const files = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#editor-exclusions",
    universe: {
      kind: "specialized",
      name: "shared-editor-configuration",
      reason:
        "editor exclusion syntax is stored only in shared JSON and XML configuration",
      extensions: [".iml", ".json", ".xml"],
    },
    narrow: {
      reason:
        "only shared JetBrains and Visual Studio Code configuration defines editor exclusions",
      include: (rel) => rel.startsWith(".idea/") || rel.startsWith(".vscode/"),
    },
  });
  const exclusions = new Set<string>();
  for (const rel of files) {
    const source = await text(rel);
    if (rel.endsWith(".json")) {
      const settings = decodeWith(EditorSettingsSchema, source);
      for (const key of ["files.exclude", "search.exclude"] as const) {
        const group = settings[key];
        if (group === undefined) continue;
        for (const [candidate, enabled] of Object.entries(group)) {
          if (enabled === true) exclusions.add(normalizedEditorPath(candidate));
        }
      }
      continue;
    }
    const patterns = [
      /<excludeFolder\s+url="file:\/\/\$MODULE_DIR\$\/([^"]+)"/gu,
      /(?:^|\|\|)file:([^|]+?)(?=\/\/\*|\|\||")/gu,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const candidate = match[1];
        if (candidate !== undefined) {
          exclusions.add(normalizedEditorPath(candidate));
        }
      }
    }
  }
  return exclusions;
}

Deno.test("shared editor exclusions resolve to live paths or registered outputs", async () => {
  const exclusions = await configuredEditorExclusions();
  const generated = new Set(
    EDITOR_PATH_POLICIES.filter((entry) => entry.kind === "generated-output")
      .map((entry) => entry.path),
  );
  for (const exclusion of exclusions) {
    assert(
      generated.has(exclusion) ||
        await targetExists(join(REPO_ROOT, exclusion)),
      `${exclusion}: shared editor exclusion is neither live nor a registered generated output`,
    );
  }
  for (const output of generated) {
    assert(
      exclusions.has(output),
      `${output}: registered generated output is absent from shared editor exclusions`,
    );
  }
});

Deno.test("browser plugin tab state stays absent and ignored", async () => {
  const browserState = EDITOR_PATH_POLICIES.filter((entry) =>
    entry.kind === "private-browser-state"
  );
  assert(browserState.length > 0);
  const ignore = await text(".gitignore");
  for (const entry of browserState) {
    assertEquals(await fileExists(join(REPO_ROOT, entry.path)), false);
    assertMatch(
      ignore,
      new RegExp(
        `^/${entry.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
        "mu",
      ),
    );
  }
});

Deno.test("the community registry exactly owns GitHub files and root community contracts", async () => {
  const tracked = REPOSITORY_COMMUNITY_FILE_POLICIES.filter((entry) =>
    entry.state === "tracked"
  );
  const absent = REPOSITORY_COMMUNITY_FILE_POLICIES.filter((entry) =>
    entry.state === "intentionally-absent"
  );
  const registeredGitHub = tracked.map((entry) => entry.path)
    .filter((path) => path.startsWith(".github/"))
    .sort();
  const liveGitHub = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#community-files",
    universe: {
      kind: "specialized",
      name: "repository community text",
      reason:
        "GitHub community configuration spans Markdown, YAML, JSON, and extensionless generated metadata.",
      text: true,
    },
    narrow: {
      reason:
        "The community registry owns every tracked file beneath the repository's .github directory.",
      include: (rel) => rel.startsWith(".github/"),
    },
  });
  assertEquals(liveGitHub, registeredGitHub);
  for (const entry of tracked) {
    assert(
      await fileExists(join(REPO_ROOT, entry.path)),
      `${entry.path}: registered community file is absent`,
    );
  }
  for (const entry of absent) {
    assertEquals(
      await fileExists(join(REPO_ROOT, entry.path)),
      false,
      `${entry.path}: an intentionally absent community surface appeared; enroll its policy`,
    );
  }
});

Deno.test("every contributor surface projects the inactive agreement authority", async () => {
  const inactive = /\bintake(?: status:)? is inactive\b/iu;
  for (const rel of CONTRIBUTOR_INTAKE_SURFACES) {
    const source = await text(rel);
    assertEquals(
      inactive.test(source),
      !CONTRIBUTOR_AGREEMENTS_OFFERED,
      `${rel}: contributor-intake wording disagrees with CONTRIBUTOR_AGREEMENTS_OFFERED`,
    );
  }
  if (!CONTRIBUTOR_AGREEMENTS_OFFERED) {
    const guideOpening = (await text("CONTRIBUTING.md")).split("\n").slice(0, 6)
      .join("\n");
    assert(inactive.test(guideOpening));
  }
});

Deno.test("the pre-public redirect authorities are empty", async () => {
  const manualFiles = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#manual-redirects",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "manual frontmatter is the authored route-claim boundary for pre-public redirects",
      include: (rel) => rel.startsWith("project/manual/"),
    },
  });
  for (const rel of manualFiles) {
    assertEquals((await text(rel)).includes("\nredirect_from:\n"), false, rel);
  }
  assertEquals(STATIC_REDIRECTS, {});
});

Deno.test("public Windows support surfaces use the canonical WSL 2 name", async () => {
  const publicSupportFiles = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#wsl-2-wording",
    universe: "authored-text",
    narrow: {
      reason:
        "public support wording lives in the installer, workflows, README, site, Manual, and public Map",
      include: (rel) =>
        rel === "README.md" || rel === "install.sh" ||
        rel.startsWith(".github/") || rel.startsWith("site/") ||
        rel.startsWith("project/manual/") ||
        (rel.startsWith("project/map/") &&
          !rel.startsWith("project/map/_internal/") &&
          !rel.startsWith("project/map/_private/")),
    },
  });
  const noncanonical =
    /\bWSL2\b|Windows via WSL(?! 2)|Windows through WSL(?! 2)|Windows Subsystem for Linux(?! 2)/u;
  for (const rel of publicSupportFiles) {
    const source = await text(rel);
    assertEquals(noncanonical.test(source), false, `${rel}: use “WSL 2”`);
  }
});

Deno.test("current-tier map pages never link into the private overlay", async () => {
  const currentTierPages = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#private-overlay-links",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "only the configured map's current tier publishes, and the private overlay is absent from every published checkout",
      include: (rel) =>
        rel.startsWith("project/map/") && rel.endsWith(".md") &&
        mapPageKind(rel.slice("project/map/".length)) === "current",
    },
  });
  const mapAbs = join(REPO_ROOT, "project/map");
  const offences: string[] = [];
  for (const rel of currentTierPages) {
    const abs = join(REPO_ROOT, rel);
    for (const { target, line } of extractDocLinks(await text(rel))) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("/")) {
        continue;
      }
      const path = target.split("#")[0] ?? "";
      if (path === "") continue;
      const relToMap = relative(mapAbs, resolve(dirname(abs), path));
      if (relToMap.startsWith("..")) continue;
      const page = relToMap.toLowerCase().endsWith(".md")
        ? relToMap
        : join(relToMap, "README.md");
      if (mapPageKind(page) === "private") {
        offences.push(`${rel}:${line} ${target}`);
      }
    }
  }
  assertEquals(
    offences,
    [],
    "published checkouts never contain the private overlay: name the document without a link, or move it out of the private tier",
  );
});

Deno.test("repository art declares its product and development-only boundary", async () => {
  const source = await text("art/README.md");
  assert(source.includes("`art/terminal/`"));
  assert(source.includes("product source"));
  assert(source.includes("`art/browser/`"));
  assert(source.includes("loopback-only development gallery"));
  assert(source.includes("absent from the public site"));
  assertEquals(dirname("art/README.md"), "art");
});

Deno.test("the tracked TODO states its deliberate public-backlog posture", async () => {
  const source = await text("project/TODO.md");
  assert(source.includes("publishes with the repository by design"));
  assert(source.includes("not a promised roadmap"));
});

Deno.test("tracked TODO headings stay role-based", async () => {
  const headings = (await text("project/TODO.md")).split("\n")
    .filter((line) => /^## /u.test(line));
  for (const heading of headings) {
    assertEquals(
      personalTodoHeadingAttribution(heading),
      undefined,
      `${heading}: use a role- or work-based heading`,
    );
  }
});

Deno.test("the TODO heading guard catches personal attribution", () => {
  assertEquals(
    personalTodoHeadingAttribution("## Jack's notes"),
    "Jack",
  );
  assertEquals(
    personalTodoHeadingAttribution("## Jack Webb-Heller's notes"),
    "Jack Webb-Heller",
  );
});

Deno.test("every Map tier declares and obeys one publication posture", async () => {
  const mapFiles = await structuralGuardScope({
    guard: "tests/repository_hygiene_test.ts#map-publication-tiers",
    universe: "tracked-markdown",
    narrow: {
      reason:
        "Map publication posture is defined by each tracked top-level Map directory.",
      include: (rel) => rel.startsWith("project/map/"),
    },
  });
  const liveTiers = new Set(
    mapFiles.map((rel) => rel.slice("project/map/".length).split("/")[0])
      .filter((tier): tier is string =>
        tier !== undefined && !tier.endsWith(".md")
      )
      .map((tier) => /^\d{2}-/u.test(tier) ? "numbered" : tier),
  );
  assertEquals(
    [...liveTiers].sort(),
    MAP_TIER_PUBLICATION_POSTURES.map((entry) => entry.tier).sort(),
  );
  const internal = MAP_TIER_PUBLICATION_POSTURES.find((entry) =>
    entry.tier === "_internal"
  );
  assertEquals(internal?.posture, "repository-only");
  const preamble = (await text("project/map/_internal/brand/README.md"))
    .split("\n").slice(0, 8).join("\n");
  assert(
    preamble.includes("is tracked and publishes with the repository"),
  );
});
