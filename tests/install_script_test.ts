/** The remote installer must fail closed and leave a directly usable command. */

import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { DISCERN_REPOSITORY_SLUG } from "../src/shared/brand.ts";
import { DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS } from "../src/shared/environment_variables.ts";
import { createWorkflowChecksum } from "./release_workflow_fixture.ts";

const INSTALL = fromFileUrl(new URL("../install.sh", import.meta.url));
const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const installSource = await Deno.readTextFile(INSTALL);
const gateSource = await Deno.readTextFile(GATE);
const DECODER = new TextDecoder();

interface InstallRun {
  binDir: string;
  downloaderLog: string;
  stderr: string;
  stdout: string;
  success: boolean;
  target: string;
}

/** Single-quote fixture paths safely for generated POSIX shell wrappers. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Resolve a required host utility and fail with its missing command name. */
async function commandPath(command: string): Promise<string> {
  const result = await new Deno.Command("which", {
    args: [command],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(`test host is missing ${command}`);
  }
  return DECODER.decode(result.stdout).trim();
}

/** Select the host artifact from the same target registry the release uses. */
function releaseAsset(): string {
  const os = Deno.build.os === "darwin" ? "Darwin" : "Linux";
  const target = BUILD_TARGETS.find((candidate) =>
    candidate.installer.os === os &&
    candidate.installer.architectures.includes(Deno.build.arch)
  );
  assert(
    target !== undefined,
    `no release target for ${os}/${Deno.build.arch}`,
  );
  return target.output;
}

/** Read the installer's canonical downloader list from its shell registry. */
function registeredDownloaders(): string[] {
  const match = installSource.match(/^DOWNLOADERS="([^"]+)"$/m);
  assert(match !== null, "install.sh declares its downloader registry");
  return match[1]?.split(/\s+/).filter(Boolean) ?? [];
}

/** Expose one real host utility inside the installer's deliberately minimal PATH. */
async function linkTool(dir: string, command: string): Promise<void> {
  await Deno.symlink(await commandPath(command), join(dir, command));
}

/** Execute the installer inside one owned local release fixture. */
async function withInstallerRun<T>(
  downloader: string,
  fn: (run: InstallRun) => T | Promise<T>,
  options: {
    badChecksum?: boolean;
    binOnPath?: boolean;
    destinationDirectory?: boolean;
    repository?: string | undefined;
    version?: string;
  } = {},
): Promise<T> {
  return await withTempDir(async (root) => {
    const tools = join(root, "tools");
    const binDir = join(root, "bin");
    await Deno.mkdir(tools);
    await Deno.mkdir(binDir);

    for (const tool of ["chmod", "mkdir", "mktemp", "mv", "rm", "uname"]) {
      await linkTool(tools, tool);
    }
    const checksumTool = Deno.build.os === "darwin" ? "shasum" : "sha256sum";
    await linkTool(tools, checksumTool);

    const fixtureBinary = join(root, "fixture-discern");
    await Deno.writeTextFile(
      fixtureBinary,
      "#!/bin/sh\nprintf '%s\\n' 'discern test fixture'\n",
    );
    await Deno.chmod(fixtureBinary, 0o755);
    const asset = releaseAsset();
    const dist = join(root, "dist");
    await Deno.mkdir(dist);
    await Deno.copyFile(fixtureBinary, join(dist, asset));
    const fixtureChecksum = await createWorkflowChecksum(root, asset);
    if (options.badChecksum) {
      await Deno.writeTextFile(
        fixtureChecksum,
        `${"0".repeat(64)}  ${asset}\n`,
      );
    }

    const downloaderLog = join(root, "downloads.log");
    const copy = await commandPath("cp");
    const fakeDownloader = join(tools, downloader);
    await Deno.writeTextFile(
      fakeDownloader,
      `#!/bin/sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o|-O|-qO) shift; out="$1" ;;
        *) url="$1" ;;
    esac
    shift
done
printf '%s|%s\\n' "$out" "$url" >> ${shellQuote(downloaderLog)}
case "$url" in
    *.sha256) ${shellQuote(copy)} ${shellQuote(fixtureChecksum)} "$out" ;;
    *) ${shellQuote(copy)} ${shellQuote(fixtureBinary)} "$out" ;;
esac
`,
    );
    await Deno.chmod(fakeDownloader, 0o755);

    const target = join(binDir, "discern");
    if (options.destinationDirectory) {
      await Deno.mkdir(target);
    } else if (options.badChecksum) {
      await Deno.writeTextFile(target, "existing installation\n");
      await Deno.chmod(target, 0o755);
    }

    const path = options.binOnPath ? `${binDir}:${tools}` : tools;
    const env: Record<string, string> = {
      DISCERN_BIN_DIR: binDir,
      DISCERN_VERSION: options.version ?? "v1.2.3",
      HOME: root,
      NO_COLOR: "1",
      PATH: path,
    };
    if (options.repository !== undefined) {
      env.DISCERN_REPO = options.repository;
    }
    const result = await new Deno.Command("/bin/sh", {
      args: [INSTALL],
      clearEnv: true,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();

    return await fn({
      binDir,
      downloaderLog: (await readTextIfExists(downloaderLog)) ?? "",
      stderr: DECODER.decode(result.stderr),
      stdout: DECODER.decode(result.stdout),
      success: result.success,
      target,
    });
  }, { prefix: "discern-install-test-" });
}

Deno.test("every registered downloader gets both files with retry semantics", async () => {
  const downloaders = registeredDownloaders();
  assert(downloaders.length > 0, "at least one downloader is supported");
  for (const downloader of downloaders) {
    await withInstallerRun(downloader, (run) => {
      assert(run.success, `${downloader} installer path failed: ${run.stderr}`);
      const downloads = run.downloaderLog.trim().split("\n");
      assertEquals(
        downloads.length,
        2,
        `${downloader} fetches binary + checksum`,
      );
      for (const entry of downloads) {
        const [output] = entry.split("|");
        assertStringIncludes(
          output ?? "",
          `${run.binDir}/.discern-install.`,
          `${downloader} stages on the destination filesystem`,
        );
      }
    });
  }
  assertStringIncludes(installSource, "--retry 3");
  assertStringIncludes(installSource, "--retry-all-errors");
  assertStringIncludes(installSource, "--tries=3");
});

Deno.test("installer cases cover the BUILD_TARGETS operating-system and architecture product", () => {
  const osCase = installSource.match(
    /case "\$os" in([\s\S]*?)\nesac/,
  )?.[1] ?? "";
  const archCase = installSource.match(
    /case "\$arch" in([\s\S]*?)\nesac/,
  )?.[1] ?? "";
  const osParts = new Map(
    [...osCase.matchAll(/^\s*([^*)]+)\)\s+os_part="([^"]+)"/gm)].map(
      (match) => [match[1]?.trim() ?? "", match[2] ?? ""],
    ),
  );
  const archParts = new Map<string, string>();
  for (
    const match of archCase.matchAll(
      /^\s*([^*)]+)\)\s+arch_part="([^"]+)"/gm,
    )
  ) {
    for (const alias of (match[1] ?? "").split("|")) {
      archParts.set(alias.trim(), match[2] ?? "");
    }
  }

  const observed = [...osParts].flatMap(([os, osPart]) =>
    [...archParts].map(([arch, archPart]) => ({
      os,
      arch,
      output: `discern-${archPart}-${osPart}`,
    }))
  ).sort((a, b) => `${a.os}/${a.arch}`.localeCompare(`${b.os}/${b.arch}`));
  const expected = BUILD_TARGETS.flatMap((target) =>
    target.installer.architectures.map((arch) => ({
      os: target.installer.os,
      arch,
      output: target.output,
    }))
  ).sort((a, b) => `${a.os}/${a.arch}`.localeCompare(`${b.os}/${b.arch}`));
  assertEquals(observed, expected);
});

Deno.test("a bad checksum preserves the existing installation", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  await withInstallerRun(downloader, async (run) => {
    assert(!run.success, "a checksum mismatch must stop installation");
    assertTerminalTextIncludes(run.stderr, "checksum verification failed");
    assertEquals(
      await Deno.readTextFile(run.target),
      "existing installation\n",
    );
  }, { badChecksum: true });
});

Deno.test("bare and v-prefixed DISCERN_VERSION values resolve to the same release tag", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  for (const version of ["1.2.3", "v1.2.3"]) {
    await withInstallerRun(downloader, (run) => {
      assert(run.success, run.stderr);
      assertStringIncludes(
        run.downloaderLog,
        "/releases/download/v1.2.3/",
      );
    }, { repository: "example/discern", version });
  }
});

Deno.test("the installer default repository follows the repository authority", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  await withInstallerRun(downloader, (run) => {
    assert(run.success, run.stderr);
    assertStringIncludes(
      run.downloaderLog,
      `https://github.com/${DISCERN_REPOSITORY_SLUG}/releases/`,
    );
  });
});

Deno.test("an install destination that is a directory is refused before download", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  await withInstallerRun(downloader, (run) => {
    assert(!run.success);
    assertTerminalTextIncludes(
      run.stderr,
      "install destination is a directory",
    );
    assertEquals(run.downloaderLog, "");
  }, { destinationDirectory: true });
});

Deno.test("next-step output appears only when discern resolves on PATH", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  await withInstallerRun(downloader, async (offPath) => {
    assert(offPath.success);
    assert(!offPath.stdout.includes("Next:"));
    assertTerminalTextIncludes(offPath.stderr, "shell profile");
    await withInstallerRun(downloader, (onPath) => {
      assert(onPath.success);
      assertStringIncludes(onPath.stdout, "Next:");
    }, { binOnPath: true });
  });
});

Deno.test("Darwin preserves the exact install destination order", () => {
  const selection = installSource.slice(
    installSource.indexOf("# --- choose an install dir"),
    installSource.indexOf("# --- download"),
  );
  const override = selection.indexOf(
    'if [ -n "${DISCERN_BIN_DIR:-}" ]; then',
  );
  const conventional = selection.indexOf('bin_dir="/usr/local/bin"');
  const local = selection.indexOf('bin_dir="$HOME/.local/bin"');
  assert(override >= 0, "DISCERN_BIN_DIR is the first candidate");
  assert(conventional >= 0, "the Darwin path selects /usr/local/bin");
  assert(
    override < conventional && conventional < local,
    "DISCERN_BIN_DIR, /usr/local/bin, then ~/.local/bin keep their order",
  );
  assertStringIncludes(
    selection,
    '[ "$os" = "Darwin" ] && [ -d /usr/local/bin ] && [ -w /usr/local/bin ]',
  );
  assertEquals(
    selection.includes("/opt/homebrew/bin"),
    false,
    "the raw installer never writes an unmanaged Homebrew-prefix binary",
  );
});

Deno.test("installer DISCERN_* inputs exactly match the installation registry group", () => {
  const observed = [
    ...new Set(
      installSource.match(/\bDISCERN_[A-Z][A-Z0-9_]*\b/g) ?? [],
    ),
  ].sort();
  const expected = Object.values(DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS)
    .filter((definition) => definition.group === "installation")
    .map((definition) => definition.name)
    .sort();
  assertEquals(observed, expected);
});

Deno.test("CI shellchecks the standalone installer", () => {
  assertStringIncludes(gateSource, "shellcheck install.sh");
});
