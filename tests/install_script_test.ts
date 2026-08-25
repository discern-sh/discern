/** The remote installer must fail closed and leave a directly usable command. */

import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";

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

/** Derive the binary asset name for the test host's supported architecture and OS. */
function releaseAsset(): string {
  const arch = Deno.build.arch === "x86_64" ? "x86_64" : "aarch64";
  const os = Deno.build.os === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  return `discern-${arch}-${os}`;
}

/** Hash the local release fixture exactly as the installer checksum manifest does. */
async function sha256(path: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  options: { badChecksum?: boolean; binOnPath?: boolean } = {},
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
    const fixtureChecksum = join(root, "fixture.sha256");
    const hash = options.badChecksum
      ? "0".repeat(64)
      : await sha256(fixtureBinary);
    await Deno.writeTextFile(fixtureChecksum, `${hash}  ${asset}\n`);

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
    if (options.badChecksum) {
      await Deno.writeTextFile(target, "existing installation\n");
      await Deno.chmod(target, 0o755);
    }

    const path = options.binOnPath ? `${binDir}:${tools}` : tools;
    const result = await new Deno.Command("/bin/sh", {
      args: [INSTALL],
      clearEnv: true,
      env: {
        DISCERN_BIN_DIR: binDir,
        DISCERN_REPO: "example/discern",
        DISCERN_VERSION: "v1.2.3",
        HOME: root,
        NO_COLOR: "1",
        PATH: path,
      },
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

Deno.test("Darwin prefers a writable conventional PATH directory", () => {
  const selection = installSource.slice(
    installSource.indexOf("# --- choose an install dir"),
    installSource.indexOf("# --- download"),
  );
  const conventional = selection.indexOf('bin_dir="/usr/local/bin"');
  const local = selection.indexOf('bin_dir="$HOME/.local/bin"');
  assert(conventional >= 0, "the Darwin path selects /usr/local/bin");
  assert(
    local > conventional,
    "/usr/local/bin is considered before ~/.local/bin",
  );
});

Deno.test("CI shellchecks the standalone installer", () => {
  assertStringIncludes(gateSource, "shellcheck install.sh");
});
