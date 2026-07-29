/** Execute the binary-only release seams before an artifact can be uploaded. */

import { ensureDir, exists } from "@std/fs";
import { isAbsolute, join, resolve } from "@std/path";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";

const DECODER = new TextDecoder();

interface CommandOutput {
  stderr: string;
  stdout: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<CommandOutput> {
  const result = await new Deno.Command(command, {
    args,
    cwd,
    env: { NO_COLOR: "1", ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = DECODER.decode(result.stdout);
  const stderr = DECODER.decode(result.stderr);
  if (!result.success) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.code}\n` +
        `${stdout}${stderr}`,
    );
  }
  return { stdout, stderr };
}

function resultEnvelope(
  stdout: string,
  label: string,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `${label} returned invalid JSON: ${String(error)}\n${stdout}`,
    );
  }
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${label} returned a non-green result: ${stdout}`);
  }
  return value;
}

function assertBundledDocs(envelope: Record<string, unknown>): void {
  const data = envelope.data;
  if (!isRecord(data) || !Array.isArray(data.docs)) {
    throw new Error("compiled docs result has no bundled docs list");
  }
  const hasRoot = data.docs.some((doc) =>
    isRecord(doc) && doc.path === "docs/README.md"
  );
  if (!hasRoot) {
    throw new Error("compiled docs result is missing docs/README.md");
  }
}

/** Run version, embedded-docs, and embedded-template probes against one binary. */
export async function smokeReleaseBinary(
  binaryPath: string,
  expectedVersion: string,
): Promise<void> {
  const binary = isAbsolute(binaryPath) ? binaryPath : resolve(binaryPath);
  if (!(await exists(binary, { isFile: true }))) {
    throw new Error(`release binary does not exist: ${binary}`);
  }

  const temp = await Deno.makeTempDir({ prefix: "discern-release-smoke-" });
  const gitEnv = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  try {
    const version = await run(binary, ["--version"], temp);
    if (version.stdout.trim() !== `discern ${expectedVersion}`) {
      throw new Error(
        `compiled version ${
          JSON.stringify(version.stdout.trim())
        } does not match ` +
          `discern ${expectedVersion}`,
      );
    }

    const docs = resultEnvelope(
      (await run(binary, ["docs", "--json"], temp)).stdout,
      "compiled docs",
    );
    assertBundledDocs(docs);

    const project = join(temp, "project");
    await ensureDir(project);
    await run("git", ["init", "-b", "main"], project, gitEnv);
    await run(
      "git",
      ["config", "user.name", "discern release smoke"],
      project,
      gitEnv,
    );
    await run(
      "git",
      ["config", "user.email", "release-smoke@discern.invalid"],
      project,
      gitEnv,
    );
    await run("git", ["config", "commit.gpgsign", "false"], project, gitEnv);
    await Deno.writeTextFile(join(project, "README.md"), "# Release smoke\n");
    await run("git", ["add", "README.md"], project, gitEnv);
    await run(
      "git",
      ["commit", "-m", "Create release smoke fixture"],
      project,
      gitEnv,
    );

    const setup = resultEnvelope(
      (await run(
        binary,
        [
          "setup",
          "begin",
          "--confirmed",
          "--json",
          "--slug",
          "release-smoke",
          "--agents",
          "codex",
        ],
        project,
        gitEnv,
      )).stdout,
      "compiled setup",
    );
    if (setup.verb !== "setup") {
      throw new Error(
        `compiled setup returned unexpected verb: ${String(setup.verb)}`,
      );
    }

    for (
      const relative of [
        "discern.toml",
        SOURCE_PATHS.guidance.defaultPath,
        join(SOURCE_PATHS.map.defaultPath, "README.md"),
      ]
    ) {
      if (!(await exists(join(project, relative)))) {
        throw new Error(`compiled setup did not scaffold ${relative}`);
      }
    }
    const config = await Deno.readTextFile(join(project, "discern.toml"));
    if (config.includes("{{")) {
      throw new Error("compiled setup left an unresolved template token");
    }
  } finally {
    await Deno.remove(temp, { recursive: true }).catch(() => {});
  }
}

async function main(): Promise<void> {
  const binary = Deno.args[0];
  const expectedVersion = Deno.args[1];
  if (binary === undefined || expectedVersion === undefined) {
    throw new Error(
      "usage: release_smoke.ts <binary-path> <expected-version>",
    );
  }
  await smokeReleaseBinary(binary, expectedVersion);
  console.log(`smoke passed: ${binary}`);
}

if (import.meta.main) {
  await main();
}
