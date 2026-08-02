/**
 * Engine coverage for update-time generated-artifact convergence (ADR 0247):
 * declared generated conflicts resolve by regeneration, clean merges re-derive
 * stale outputs, mixed conflicts still refuse, and refresh-owned agent files
 * auto-resolve without a `[generated]` declaration.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import type { z } from "@zod/zod";
import { renderAgentFiles } from "../src/engine/guidance_render.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import {
  type UpdateData,
  UpdateOutputSchema,
} from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

type UpdateJson = Omit<z.infer<typeof UpdateOutputSchema>, "data"> & {
  data?: UpdateData;
};

const BUILTIN_REFRESH_GROUP = "discern:refresh";
const GENERATED_PATH = "generated/bundle.txt";
const GROUP_NAME = "bundle";

/** Validate update output against its public schema before returning typed fixture data. */
function parse(stdout: string): UpdateJson {
  const raw = JSON.parse(stdout);
  const parsed = UpdateOutputSchema.safeParse(raw);
  assert(
    parsed.success,
    `update --json drifted from UpdateOutputSchema:\n${
      JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
    }\n${stdout}`,
  );
  return parsed.data as UpdateJson;
}

/** Create parent directories before materializing a generated-update fixture file. */
async function write(path: string, body: string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, body);
}

/** Run the fixture's declared generator and surface stderr if it cannot rebuild outputs. */
async function regenerate(root: string): Promise<void> {
  const run = new Deno.Command("sh", {
    args: ["tools/generate.sh"],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await run.output();
  assert(
    output.success,
    `generator failed: ${new TextDecoder().decode(output.stderr)}`,
  );
}

/** Derive the generated bundle directly from both authoritative source files. */
async function expectedBundle(root: string): Promise<string> {
  const left = (await Deno.readTextFile(join(root, "source/left.txt"))).trim();
  const right = (await Deno.readTextFile(join(root, "source/right.txt")))
    .trim();
  return `left=${left}|right=${right}\n`;
}

/** Create a repository whose declared generator owns a conflictable output tree. */
async function scaffoldGeneratedProject(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      'agents = ["claude_code"]',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      `[generated.${GROUP_NAME}]`,
      'paths = ["generated/**"]',
      'run = "sh tools/generate.sh"',
      "timeout = 10",
      "",
    ].join("\n"),
  );
  await write(join(dir, "source/left.txt"), "base-left\n");
  await write(join(dir, "source/right.txt"), "base-right\n");
  await write(
    join(dir, "tools/generate.sh"),
    [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p generated",
      "left=$(cat source/left.txt)",
      "right=$(cat source/right.txt)",
      'printf \'left=%s|right=%s\\n\' "$left" "$right" > generated/bundle.txt',
      "",
    ].join("\n"),
  );
  await regenerate(dir);
  const refreshed = await runAgent(dir, ["refresh", "--json"]);
  assertEquals(refreshed.code, 0, refreshed.output);
  await gitInit(dir);
}

/** Commit the complete fixture tree at a named integration boundary. */
async function commitAll(root: string, message: string): Promise<void> {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", message, "--no-gpg-sign");
}

/** Resolve generated group names through the production config loader. */
async function configuredGroupNames(root: string): Promise<string[]> {
  return resolveGeneratedGroups(await loadConfig(root)).map((group) =>
    group.name
  );
}

/** Require update results to account for every configured generated group. */
function assertConfiguredGroupsRan(
  data: UpdateData,
  configured: readonly string[],
): void {
  for (const name of configured) {
    assert(
      data.regenerated?.includes(name),
      `expected regenerated to include configured group ${name}: ${
        JSON.stringify(data.regenerated)
      }`,
    );
  }
}

Deno.test("update regenerates a declared artifact instead of merging its conflicted bytes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "generated-conflict");

    await write(join(wt, "source/left.txt"), "worktree-left\n");
    await regenerate(wt);
    await commitAll(wt, "change left source");

    await write(join(dir, "source/right.txt"), "main-right\n");
    await regenerate(dir);
    await commitAll(dir, "change right source");

    const configured = await configuredGroupNames(wt);
    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = parse(result.stdout);
    const { data } = parsed;
    assert(data !== undefined, result.stdout);

    assertEquals(data.auto_resolved, [GENERATED_PATH]);
    assertConfiguredGroupsRan(data, configured);
    assert(data.regenerated?.includes(BUILTIN_REFRESH_GROUP));
    assertEquals(
      await Deno.readTextFile(join(wt, GENERATED_PATH)),
      await expectedBundle(wt),
    );
    assertEquals(
      await gitOut(wt, "status", "--porcelain"),
      "",
      result.stdout,
    );
    assert(data.range.after !== undefined, JSON.stringify(data.range));
    assert(data.overlap.includes(GENERATED_PATH));
  });
});

Deno.test("update regenerates a declared artifact after a clean merge and previews the work read-only", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "generated-clean");

    await write(join(wt, "source/left.txt"), "worktree-left\n");
    await regenerate(wt);
    await commitAll(wt, "change left source");

    // Main changes another source without rebuilding the artifact. Git can merge
    // this cleanly, but neither committed artifact represents the merged sources.
    await write(join(dir, "source/right.txt"), "main-right\n");
    await commitAll(dir, "change right source without regenerating");

    const configured = await configuredGroupNames(wt);
    const beforePreview = await Deno.readTextFile(join(wt, GENERATED_PATH));
    const previewRun = await runAgent(wt, [
      "update",
      "--dry-run",
      "--json",
    ]);
    assertEquals(previewRun.code, 0, previewRun.output);
    const preview = parse(previewRun.stdout);
    assertEquals(preview.dry_run, true);
    assert(
      preview.plan?.steps.some((step) =>
        step.label === `generated:${GROUP_NAME}` && step.kind === "job"
      ),
      previewRun.stdout,
    );
    assert(
      preview.plan?.steps.some((step) =>
        step.label === "commit regenerated artifacts" && step.kind === "git"
      ),
      previewRun.stdout,
    );
    assert(preview.data !== undefined, previewRun.stdout);
    assertConfiguredGroupsRan(preview.data, configured);
    assertEquals(
      await Deno.readTextFile(join(wt, GENERATED_PATH)),
      beforePreview,
      "dry-run must not regenerate the artifact",
    );

    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = parse(result.stdout);
    const { data } = parsed;
    assert(data !== undefined, result.stdout);
    assertEquals(data.auto_resolved ?? [], []);
    assertConfiguredGroupsRan(data, configured);
    assertEquals(
      await Deno.readTextFile(join(wt, GENERATED_PATH)),
      await expectedBundle(wt),
    );
    assertEquals(
      await gitOut(wt, "status", "--porcelain"),
      "",
      result.stdout,
    );
  });
});

Deno.test("update commits a regenerated attributes block after generated config changes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "generated-config-change");
    const configPath = join(dir, "discern.toml");
    await Deno.writeTextFile(
      configPath,
      (await Deno.readTextFile(configPath)).replace(
        'paths = ["generated/**"]',
        'paths = ["generated/*.txt"]',
      ),
    );
    await commitAll(dir, "narrow generated paths");

    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = parse(result.stdout);
    assert(
      parsed.steps?.some((step) =>
        step.label === "commit regenerated artifacts" &&
        step.note?.includes(".gitattributes")
      ),
      result.stdout,
    );
    const attributes = await Deno.readTextFile(join(wt, ".gitattributes"));
    assertStringIncludes(
      attributes,
      "generated/*.txt merge=discern-generated",
    );
    assertEquals(attributes.includes("generated/** merge="), false);
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
  });
});

Deno.test("update never treats project-owned attributes lines as generated conflicts", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "project-attributes-conflict");
    const attributesPath = join(wt, ".gitattributes");
    await Deno.writeTextFile(
      attributesPath,
      `${await Deno.readTextFile(attributesPath)}*.asset binary\n`,
    );
    await commitAll(wt, "set branch project attributes");

    const mainAttributesPath = join(dir, ".gitattributes");
    await Deno.writeTextFile(
      mainAttributesPath,
      `${await Deno.readTextFile(mainAttributesPath)}*.asset text\n`,
    );
    await commitAll(dir, "set main project attributes");

    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 1, result.output);
    const parsed = parse(result.stdout);
    assertEquals(parsed.error, "precondition_failed");
    assertStringIncludes(parsed.message ?? "", ".gitattributes");
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
    assertStringIncludes(
      await Deno.readTextFile(attributesPath),
      "*.asset binary",
    );
  });
});

Deno.test("update refuses a mixed generated and authored conflict and separates both path lists", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "generated-mixed");

    await write(join(wt, "source/left.txt"), "worktree-left\n");
    await regenerate(wt);
    await commitAll(wt, "change source in worktree");

    await write(join(dir, "source/left.txt"), "main-left\n");
    await regenerate(dir);
    await commitAll(dir, "change source on main");

    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 1, result.output);
    const parsed = parse(result.stdout);
    assertEquals(parsed.error, "precondition_failed");
    assert(parsed.message !== undefined, result.stdout);
    assertStringIncludes(
      parsed.message,
      "These paths need your judgment: source/left.txt.",
    );
    assertStringIncludes(
      parsed.message,
      `These generated paths would have self-resolved: ${GENERATED_PATH}.`,
    );
    assertEquals(
      await gitOut(wt, "status", "--porcelain"),
      "",
      result.stdout,
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "source/left.txt")),
      "worktree-left\n",
    );
  });
});

Deno.test("update records a failed declared generator without undoing the merge", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const wt = await addWorktree(dir, "generated-failure");

    await write(
      join(wt, "tools/generate.sh"),
      "#!/bin/sh\nexit 9\n",
    );
    await commitAll(wt, "make the generator fail");
    await write(join(dir, "upstream.txt"), "from main\n");
    await commitAll(dir, "add an upstream change");

    const configured = await configuredGroupNames(wt);
    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = parse(result.stdout);
    assertEquals(parsed.ok, false, result.stdout);
    assertEquals(
      await Deno.readTextFile(join(wt, "upstream.txt")),
      "from main\n",
      "merge must be kept",
    );
    assert(parsed.data !== undefined, result.stdout);
    assertConfiguredGroupsRan(parsed.data, configured);
    assert(
      parsed.steps?.some((step) =>
        step.label === `generated:${GROUP_NAME}` && step.outcome === "failed"
      ),
      result.stdout,
    );
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
  });
});

Deno.test("update resolves a refresh-owned agent-file conflict without generated config", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const rendered = await renderAgentFiles(dir);
    const agentPath = rendered.keys().next().value;
    assert(agentPath !== undefined, "scaffold must render an agent file");
    assertEquals(resolveGeneratedGroups(await loadConfig(dir)), []);
    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await gitInit(dir);
    const wt = await addWorktree(dir, "agent-file-conflict");

    await write(join(wt, agentPath), "worktree generated bytes\n");
    await commitAll(wt, "change generated agent file in worktree");
    await write(join(dir, agentPath), "main generated bytes\n");
    await commitAll(dir, "change generated agent file on main");

    const result = await runAgent(wt, ["update", "--json"]);
    assertEquals(result.code, 0, result.output);
    const parsed = parse(result.stdout);
    const { data } = parsed;
    assert(data !== undefined, result.stdout);
    assertEquals(data.auto_resolved, [agentPath]);
    assert(data.regenerated?.includes(BUILTIN_REFRESH_GROUP));
    assertEquals(
      await Deno.readTextFile(join(wt, agentPath)),
      (await renderAgentFiles(wt)).get(agentPath),
    );
    assertEquals(await gitOut(wt, "status", "--porcelain"), "");
  });
});
