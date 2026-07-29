/**
 * Landing-authority resolution: pure fail-closed coverage plus the pinned
 * trunk-read boundary that prevents a branch from granting itself trust.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { LANDING_CONSENT_SOURCES } from "../src/shared/consent.ts";
import {
  inspectLandingAuthority,
  resolveLandingAuthority,
} from "../src/engine/worktree/landing_authority.ts";
import {
  addWorktree,
  git,
  gitInit,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const DOCS_CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[scopes.map]",
  'paths = ["project/map/**"]',
  "neutral = true",
  "",
  "[scopes.engine]",
  'paths = ["src/**"]',
  "",
  "[acceptance]",
  'pre_authorized = ["map"]',
  "",
].join("\n");

const EXACT_CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[scopes.release]",
  'paths = ["release.txt"]',
  "",
  "[acceptance]",
  'pre_authorized = ["release"]',
  "",
].join("\n");

function classified(
  path: string,
  scopes: string[],
): { path: string; scopes: string[] } {
  return { path, scopes };
}

Deno.test("landing authority: effort wins; standing coverage is all-path and fail-closed", () => {
  assertEquals(LANDING_CONSENT_SOURCES, [
    "conversation",
    "standing-grant",
    "effort-grant",
  ]);
  const classifications = [
    classified("project/map/guide.md", ["map"]),
    classified("src/main.ts", ["engine"]),
  ];
  const effort = resolveLandingAuthority({
    effortGranted: true,
    classifications,
    grantedScopes: [],
    definedScopes: ["map", "engine"],
  });
  assertEquals(effort.kind, "authorized");
  assertEquals(
    effort.kind === "authorized" ? effort.consent : undefined,
    { source: "effort-grant" },
  );
  const blockedEffort = resolveLandingAuthority({
    effortGranted: true,
    classifications,
    grantedScopes: [],
    definedScopes: ["map", "engine"],
    blockingReason: "the trunk policy is malformed",
  });
  assertEquals(
    blockedEffort.kind,
    "conversation-required",
    "recorded effort authority cannot bypass blocking trunk-policy evidence",
  );

  const standing = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("project/map/guide.md", ["map"])],
    grantedScopes: ["map"],
    definedScopes: ["map", "engine"],
    trunkCommit: "trunk-sha",
    headCommit: "head-sha",
  });
  assertEquals(standing.kind, "authorized");
  assertEquals(
    standing.kind === "authorized" ? standing.consent : undefined,
    { source: "standing-grant", scopes: ["map"] },
  );

  const partial = resolveLandingAuthority({
    effortGranted: false,
    classifications,
    grantedScopes: ["map"],
    definedScopes: ["map", "engine"],
  });
  assertEquals(partial.kind, "conversation-required");
  assertEquals(partial.uncovered, [classified("src/main.ts", ["engine"])]);

  const unscoped = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("notes.txt", [])],
    grantedScopes: ["map"],
    definedScopes: ["map"],
  });
  assertEquals(unscoped.kind, "conversation-required");
  assertEquals(unscoped.uncovered, [classified("notes.txt", [])]);
});

Deno.test("landing authority: unknown grants cover nothing and say so", () => {
  const resolution = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("project/map/guide.md", ["map"])],
    grantedScopes: ["missing"],
    definedScopes: ["map"],
  });
  assertEquals(resolution.kind, "conversation-required");
  assertEquals(resolution.uncovered, [
    classified("project/map/guide.md", ["map"]),
  ]);
  assert(
    resolution.warnings.some((warning) =>
      warning.includes("unknown scope") && warning.includes("missing")
    ),
  );
});

Deno.test("landing authority reads standing grants only from the committed trunk", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      DOCS_CONFIG.replace(
        '\n[acceptance]\npre_authorized = ["map"]\n',
        "\n",
      ),
    );
    await gitInit(dir);
    const worktree = await addWorktree(dir, "self-grant");
    await writeConfig(worktree, DOCS_CONFIG);
    await Deno.mkdir(join(worktree, "project", "map"), { recursive: true });
    await Deno.writeTextFile(
      join(worktree, "project", "map", "guide.md"),
      "branch docs\n",
    );
    await git(worktree, "add", "-A");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "try self grant",
      "--no-gpg-sign",
    );

    const resolution = await inspectLandingAuthority(worktree, "main");
    assertEquals(resolution.kind, "conversation-required");
  });
});

Deno.test("landing authority covers neutral docs from the pinned trunk scope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, DOCS_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "covered-docs");
    await Deno.mkdir(join(worktree, "project", "map"), { recursive: true });
    await Deno.writeTextFile(
      join(worktree, "project", "map", "guide.md"),
      "covered docs\n",
    );
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-q", "-m", "write docs", "--no-gpg-sign");

    const resolution = await inspectLandingAuthority(worktree, "main");
    assertEquals(resolution.kind, "authorized");
    assertEquals(
      resolution.kind === "authorized" ? resolution.consent : undefined,
      { source: "standing-grant", scopes: ["map"] },
    );
    assert(
      resolution.trunkCommit !== undefined &&
        resolution.headCommit !== undefined,
      "standing authority must pin both sides of its decision",
    );
  });
});

Deno.test("landing authority classifies Git path bytes verbatim", async (t) => {
  const cases = [
    {
      name: "leading space outside a granted directory",
      config: DOCS_CONFIG,
      path: " project/map/guide.md",
      expected: "conversation-required",
    },
    {
      name: "leading newline outside a granted directory",
      config: DOCS_CONFIG,
      path: "\nproject/map/guide.md",
      expected: "conversation-required",
    },
    {
      name: "trailing space differs from a granted exact path",
      config: EXACT_CONFIG,
      path: "release.txt ",
      expected: "conversation-required",
    },
    {
      name: "trailing space inside a granted directory remains covered",
      config: DOCS_CONFIG,
      path: "project/map/guide.md ",
      expected: "authorized",
    },
    {
      name: "non-ASCII path inside a granted directory remains covered",
      config: DOCS_CONFIG,
      path: "project/map/añadir.md",
      expected: "authorized",
    },
  ] as const;

  for (const testCase of cases) {
    await t.step(testCase.name, async () => {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir);
        await writeConfig(dir, testCase.config);
        await gitInit(dir);
        const worktree = await addWorktree(dir, "path-bytes");
        const target = join(worktree, testCase.path);
        await Deno.mkdir(dirname(target), { recursive: true });
        await Deno.writeTextFile(target, "path fixture\n");
        await git(worktree, "add", "-A");
        await git(
          worktree,
          "commit",
          "-q",
          "-m",
          "add unusual path",
          "--no-gpg-sign",
        );

        const resolution = await inspectLandingAuthority(worktree, "main");
        assertEquals(resolution.kind, testCase.expected);
      });
    });
  }
});

Deno.test("landing authority treats a malformed trunk policy as blocking evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[acceptance\npre_authorized = [\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "repair-trunk");
    await writeConfig(worktree, DOCS_CONFIG);
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-q", "-m", "repair config", "--no-gpg-sign");

    const resolution = await inspectLandingAuthority(worktree, "main");
    assertEquals(resolution.kind, "conversation-required");
    assert(
      resolution.kind === "conversation-required" &&
        resolution.blockingReason !== undefined,
    );
    assert(
      resolution.warnings.some((warning) =>
        warning.includes("could not be checked")
      ),
    );
  });
});
