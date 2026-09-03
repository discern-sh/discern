/** Execute the binary-only release seams before an artifact can be uploaded. */

import { ensureDir } from "@std/fs";
import { fileExists, targetExists } from "../src/shared/fs_presence.ts";
import { fromFileUrl, isAbsolute, join, resolve } from "@std/path";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { FIRST_PARTY_LEGAL_DOCUMENTS } from "../src/shared/license_registry.ts";
import { withToolTempDir } from "./temp_dir.ts";
import { canonicalDocTarget, discoverDocs } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";

const DECODER = new TextDecoder();
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

export interface ReleasePathLeak {
  readonly label:
    | "checkout"
    | "home"
    | "workspace"
    | "runner temp"
    | "package cache";
  readonly path: string;
}

export interface ReleaseSmokeOptions {
  /** Test seam for the hosted environment whose paths must not reach bytes. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

interface CommandOutput {
  stderr: string;
  stdout: string;
}

/** Collect every local build path whose bytes would disclose the build host. */
export function releasePathLeaks(
  environment: Readonly<Record<string, string | undefined>> = Deno.env
    .toObject(),
): readonly ReleasePathLeak[] {
  const candidates: ReleasePathLeak[] = [
    { label: "checkout", path: REPO_ROOT.replace(/\/$/u, "") },
  ];
  const add = (label: ReleasePathLeak["label"], path: string | undefined) => {
    if (path === undefined || path.trim() === "" || path === "/") return;
    candidates.push({ label, path: path.replace(/\/$/u, "") });
  };
  add("workspace", environment.GITHUB_WORKSPACE);
  add("home", environment.HOME);
  add("runner temp", environment.RUNNER_TEMP);
  add("package cache", environment.DENO_DIR);
  add("package cache", environment.XDG_CACHE_HOME);
  add("package cache", environment.NPM_CONFIG_CACHE);
  add("package cache", environment.npm_config_cache);
  if (environment.HOME !== undefined) {
    add("package cache", join(environment.HOME, ".cache", "deno"));
    add("package cache", join(environment.HOME, ".npm"));
  }
  const seen = new Set<string>();
  return candidates.filter(({ path }) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

/** Return whether `haystack` contains one exact byte sequence. */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer:
  for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** Refuse a release binary containing any host-specific build path. */
export async function assertNoReleasePathLeaks(
  binary: string,
  candidates: readonly ReleasePathLeak[],
): Promise<void> {
  const bytes = await Deno.readFile(binary);
  const encoder = new TextEncoder();
  const leaks = candidates.filter(({ path }) =>
    containsBytes(bytes, encoder.encode(path))
  );
  if (leaks.length > 0) {
    throw new Error(
      `release binary contains local ${leaks[0]?.label ?? "build"} path ` +
        `${JSON.stringify(leaks[0]?.path)}`,
    );
  }
}

/** Narrow decoded JSON to a non-null, non-array record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Run a release probe without color, capturing both streams and throwing with full failure evidence. */
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

/** Parse a binary's JSON stdout and require a green result envelope. */
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
      { cause: error },
    );
  }
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${label} returned a non-green result: ${stdout}`);
  }
  return value;
}

/** Require the compiled docs result to equal the canonical published manual. */
async function assertBundledDocs(
  envelope: Record<string, unknown>,
): Promise<void> {
  const data = envelope.data;
  if (!isRecord(data) || !Array.isArray(data.docs)) {
    throw new Error("compiled docs result has no bundled docs list");
  }

  const manualDir = resolveRepositoryManualDir(REPO_ROOT).abs;
  const tree = await discoverDocs({ cwd: REPO_ROOT, dir: manualDir });
  if (tree === undefined) {
    throw new Error(`release smoke cannot discover ${manualDir}`);
  }
  const manual = await buildManualProjection(tree.entries);
  const expected = manual.pages.map((page) => ({
    target: canonicalDocTarget(page.entry),
    page_id: page.id,
    manual_kind: page.kind,
    path: `docs/${page.entry.relToDocs}`,
  }));
  if (data.docs.length !== expected.length || data.count !== expected.length) {
    throw new Error(
      `compiled docs result does not match the canonical manual set: got ` +
        `${data.docs.length} rows and count ${String(data.count)}, expected ` +
        `${expected.length}`,
    );
  }
  for (const [index, identity] of expected.entries()) {
    const actual = data.docs[index];
    if (!isRecord(actual)) {
      throw new Error(
        `compiled docs result is missing canonical row ${identity.target}`,
      );
    }
    for (const [field, expectedValue] of Object.entries(identity)) {
      if (actual[field] !== expectedValue) {
        throw new Error(
          `compiled docs result row ${index} has ${field} ` +
            `${JSON.stringify(actual[field])}; expected ` +
            `${JSON.stringify(expectedValue)} for ${identity.target}`,
        );
      }
    }
  }
}

/** Byte-match every embedded first-party legal document to its repository source. */
async function assertBundledFirstPartyLicenses(
  envelope: Record<string, unknown>,
): Promise<void> {
  const data = envelope.data;
  if (!isRecord(data) || !Array.isArray(data.documents)) {
    throw new Error(
      "compiled licenses result has no first-party documents list",
    );
  }

  for (const [index, declaration] of FIRST_PARTY_LEGAL_DOCUMENTS.entries()) {
    const document = data.documents[index];
    if (!isRecord(document)) {
      throw new Error(
        `compiled licenses result is missing ${declaration.key} at index ${index}`,
      );
    }
    const expected = {
      key: declaration.key,
      kind: declaration.kind,
      identifier: declaration.identifier,
      title: declaration.title,
      path: declaration.path,
      text: await Deno.readTextFile(join(REPO_ROOT, declaration.path)),
    };
    const actualFields = Object.keys(document).sort();
    const expectedFields = Object.keys(expected).sort();
    if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
      throw new Error(
        `compiled licenses document ${declaration.key} has fields ` +
          `[${actualFields.join(", ")}], expected [${
            expectedFields.join(", ")
          }]`,
      );
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (document[field] !== expectedValue) {
        throw new Error(
          `compiled licenses document ${declaration.key}.${field} differs ` +
            `from ${declaration.path}`,
        );
      }
    }
  }

  if (data.documents.length !== FIRST_PARTY_LEGAL_DOCUMENTS.length) {
    throw new Error(
      `compiled licenses result has ${data.documents.length} first-party ` +
        `documents, expected ${FIRST_PARTY_LEGAL_DOCUMENTS.length}`,
    );
  }
}

/** Require human license output to contain the complete committed notices document. */
async function assertBundledThirdPartyNotices(output: string): Promise<void> {
  const notices = await Deno.readTextFile(
    join(REPO_ROOT, "THIRD_PARTY_NOTICES"),
  );
  if (!output.includes(notices)) {
    throw new Error(
      "compiled licenses human output is missing the complete committed " +
        "THIRD_PARTY_NOTICES",
    );
  }
}

/** Run version, legal, embedded-docs, and template probes against one binary. */
export async function smokeReleaseBinary(
  binaryPath: string,
  expectedVersion: string,
  options: ReleaseSmokeOptions = {},
  processEnvironment: Readonly<Record<string, string | undefined>> = Deno.env
    .toObject(),
): Promise<void> {
  const binary = isAbsolute(binaryPath) ? binaryPath : resolve(binaryPath);
  if (!(await fileExists(binary))) {
    throw new Error(`release binary does not exist: ${binary}`);
  }
  await assertNoReleasePathLeaks(
    binary,
    releasePathLeaks(options.environment ?? processEnvironment),
  );

  await withToolTempDir("release-smoke", async (temp) => {
    const gitEnv = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    };
    const version = await run(binary, ["--version"], temp);
    if (version.stdout.trim() !== `discern ${expectedVersion}`) {
      throw new Error(
        `compiled version ${
          JSON.stringify(version.stdout.trim())
        } does not match ` +
          `discern ${expectedVersion}`,
      );
    }

    const licenses = resultEnvelope(
      (await run(binary, ["licenses", "--json"], temp)).stdout,
      "compiled licenses",
    );
    await assertBundledFirstPartyLicenses(licenses);
    await assertBundledThirdPartyNotices(
      (await run(binary, ["licenses"], temp)).stdout,
    );

    const docs = resultEnvelope(
      (await run(binary, ["docs", "--json"], temp)).stdout,
      "compiled docs",
    );
    await assertBundledDocs(docs);
    const rawTarget = "30-reference/config-reference";
    const raw = await run(binary, ["docs", rawTarget, "--raw"], temp);
    const expectedRaw = await Deno.readTextFile(
      join(resolveRepositoryManualDir(REPO_ROOT).abs, `${rawTarget}.md`),
    );
    if (raw.stdout !== expectedRaw) {
      throw new Error(
        `compiled docs raw output differs from ${rawTarget}.md`,
      );
    }

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
        SOURCE_PATHS.instructions.defaultPath,
        join(SOURCE_PATHS.map.defaultPath, "README.md"),
      ]
    ) {
      if (!(await targetExists(join(project, relative)))) {
        throw new Error(`compiled setup did not scaffold ${relative}`);
      }
    }
    const config = await Deno.readTextFile(join(project, "discern.toml"));
    if (config.includes("{{")) {
      throw new Error("compiled setup left an unresolved template token");
    }
    for (const document of FIRST_PARTY_LEGAL_DOCUMENTS) {
      if (await targetExists(join(project, document.path))) {
        throw new Error(
          `compiled setup materialized legal file ${document.path}`,
        );
      }
    }
  });
}

/** Smoke-test the requested binary and version before reporting the artifact as releasable. */
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
