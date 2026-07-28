/**
 * Landing-authority resolution: pure fail-closed coverage plus the pinned
 * trunk-read boundary that prevents a branch from granting itself trust.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
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
  "[scopes.docs]",
  'paths = ["project/map/**"]',
  "neutral = true",
  "",
  "[scopes.engine]",
  'paths = ["src/**"]',
  "",
  "[acceptance]",
  'pre_authorized = ["docs"]',
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
    classified("project/map/guide.md", ["docs"]),
    classified("src/main.ts", ["engine"]),
  ];
  const effort = resolveLandingAuthority({
    effortGranted: true,
    classifications,
    grantedScopes: [],
    definedScopes: ["docs", "engine"],
  });
  assertEquals(effort.kind, "authorized");
  assertEquals(
    effort.kind === "authorized" ? effort.consent : undefined,
    { source: "effort-grant" },
  );

  const standing = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("project/map/guide.md", ["docs"])],
    grantedScopes: ["docs"],
    definedScopes: ["docs", "engine"],
    trunkCommit: "trunk-sha",
    headCommit: "head-sha",
  });
  assertEquals(standing.kind, "authorized");
  assertEquals(
    standing.kind === "authorized" ? standing.consent : undefined,
    { source: "standing-grant", scopes: ["docs"] },
  );

  const partial = resolveLandingAuthority({
    effortGranted: false,
    classifications,
    grantedScopes: ["docs"],
    definedScopes: ["docs", "engine"],
  });
  assertEquals(partial.kind, "conversation-required");
  assertEquals(partial.uncovered, [classified("src/main.ts", ["engine"])]);

  const unscoped = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("notes.txt", [])],
    grantedScopes: ["docs"],
    definedScopes: ["docs"],
  });
  assertEquals(unscoped.kind, "conversation-required");
  assertEquals(unscoped.uncovered, [classified("notes.txt", [])]);
});

Deno.test("landing authority: unknown grants cover nothing and say so", () => {
  const resolution = resolveLandingAuthority({
    effortGranted: false,
    classifications: [classified("project/map/guide.md", ["docs"])],
    grantedScopes: ["missing"],
    definedScopes: ["docs"],
  });
  assertEquals(resolution.kind, "conversation-required");
  assertEquals(resolution.uncovered, [
    classified("project/map/guide.md", ["docs"]),
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
        '\n[acceptance]\npre_authorized = ["docs"]\n',
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
      { source: "standing-grant", scopes: ["docs"] },
    );
    assert(
      resolution.trunkCommit !== undefined &&
        resolution.headCommit !== undefined,
      "standing authority must pin both sides of its decision",
    );
  });
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
