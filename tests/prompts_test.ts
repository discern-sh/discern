/**
 * Unit tests for the `init` wizard's non-interactive surface (`src/lib/prompts.ts`).
 *
 * The interactive prompt bodies (Cliffy `Input`/`Checkbox`/`Confirm`) are
 * reached only on a TTY with `--yes` absent and are deliberately NOT exercised
 * here — mocking Cliffy is out of scope. These tests pin only the flag-driven
 * and error paths: `resolveBrief`'s literal/`@path`/missing-file behaviour,
 * `canPrompt`'s `--yes` short-circuit, and `resolveInitConfig` with prompts
 * suppressed (warnings on unknown agents, dropping the unknown, and the
 * empty-input fallbacks to defaults).
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  canPrompt,
  resolveBrief,
  resolveInitConfig,
} from "../src/lib/prompts.ts";
import { DEFAULTS } from "../src/lib/config.ts";
import { Logger } from "../src/lib/log.ts";
import { withTempDir } from "./helpers.ts";

/** A real, colourless, non-JSON logger as the wizard receives one. */
function logger(): Logger {
  return new Logger({ json: false, noColor: true });
}

/**
 * Run `fn` with `console.error` replaced by a sink that records each line, then
 * always restore the original — so a warning can be asserted without leaking.
 */
async function captureStderr(
  fn: (lines: string[]) => Promise<void>,
): Promise<void> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await fn(lines);
  } finally {
    console.error = original;
  }
}

// ---- resolveBrief ----------------------------------------------------------

Deno.test("resolveBrief returns a literal string unchanged", async () => {
  assertEquals(await resolveBrief("a plain brief"), "a plain brief");
  // An empty literal is still a literal, not a file read.
  assertEquals(await resolveBrief(""), "");
});

Deno.test("resolveBrief reads an @path value from disk", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "brief.md");
    await Deno.writeTextFile(path, "from a file\n");
    assertEquals(await resolveBrief(`@${path}`), "from a file\n");
  });
});

Deno.test("resolveBrief throws a clear error for a missing @path", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "does-not-exist.md");
    await assertRejects(
      () => resolveBrief(`@${missing}`),
      Error,
      `could not read brief file "${missing}"`,
    );
  });
});

// ---- canPrompt -------------------------------------------------------------

Deno.test("canPrompt(true) is false — --yes always suppresses prompts", () => {
  // `--yes` short-circuits before any TTY check, so this holds in CI too.
  assertEquals(canPrompt(true), false);
});

// ---- resolveInitConfig (prompts suppressed via flags.yes) ------------------

Deno.test("resolveInitConfig warns on an unknown agent, drops it, keeps the known one", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveInitConfig(
      { yes: true, agents: "bogus,claude_code" },
      logger(),
    );
    // The unknown name is dropped; the known one is kept.
    assertEquals(config.agents, ["claude_code"]);
    // A warning naming the unknown agent was emitted to stderr.
    const warning = lines.find((l) => l.includes("ignoring unknown agent"));
    assertExists(
      warning,
      `expected an unknown-agent warning; saw: ${JSON.stringify(lines)}`,
    );
    assertStringIncludes(warning, "bogus");
  });
});

Deno.test("resolveInitConfig falls back to default agents when all names are garbage", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveInitConfig(
      { yes: true, agents: "nope, , also-nope" },
      logger(),
    );
    // No valid agent survived parsing → the default set is used.
    assertEquals(config.agents, [...DEFAULTS.agents]);
    // The unknown names are still reported.
    assertEquals(
      lines.some((l) => l.includes("ignoring unknown agent")),
      true,
    );
  });
});

Deno.test("resolveInitConfig keeps a valid agents flag without warning", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveInitConfig(
      { yes: true, agents: "codex" },
      logger(),
    );
    assertEquals(config.agents, ["codex"]);
    // No unknowns → no warning line.
    assertEquals(
      lines.some((l) => l.includes("ignoring unknown agent")),
      false,
    );
  });
});

Deno.test("resolveInitConfig falls back to default source globs when the flag parses to empty", async () => {
  const config = await resolveInitConfig(
    { yes: true, sourceGlobs: " , ,, " },
    logger(),
  );
  // A flag that splits to nothing → defaults, not an empty array.
  assertEquals(config.sourceGlobs, [...DEFAULTS.sourceGlobs]);
});

Deno.test("resolveInitConfig honours explicit base flags non-interactively", async () => {
  const config = await resolveInitConfig(
    {
      yes: true,
      name: "My Project",
      slug: "my-proj",
      branchPrefix: "wt/",
      sourceGlobs: "lib/**, pkg/**",
      brief: "a literal brief",
    },
    logger(),
  );
  assertEquals(config.slug, "my-proj");
  assertEquals(config.branchPrefix, "wt/");
  assertEquals(config.sourceGlobs, ["lib/**", "pkg/**"]);
  assertEquals(config.brief, "a literal brief");
  // No agents flag → the default set, with prompts suppressed.
  assertEquals(config.agents, [...DEFAULTS.agents]);
});

Deno.test("resolveInitConfig resolves a @path brief flag non-interactively", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "b.md");
    await Deno.writeTextFile(path, "briefed from file");
    const config = await resolveInitConfig(
      { yes: true, brief: `@${path}` },
      logger(),
    );
    assertEquals(config.brief, "briefed from file");
  });
});

Deno.test("resolveInitConfig rejects an invalid explicit --slug", async () => {
  // An explicit bad slug is an error (no silent coercion of a chosen value).
  await assertRejects(
    () => resolveInitConfig({ yes: true, slug: "Bad Slug!" }, logger()),
    Error,
    'invalid --slug "Bad Slug!"',
  );
});

Deno.test("resolveInitConfig empty branch-prefix flag falls back to the default", async () => {
  const config = await resolveInitConfig(
    { yes: true, branchPrefix: "   " },
    logger(),
  );
  // A whitespace-only branch prefix trims to "" → the default applies.
  assertEquals(config.branchPrefix, DEFAULTS.branchPrefix);
});
