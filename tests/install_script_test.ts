/** The remote installer must fail closed and leave a directly usable command. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

const INSTALL = fromFileUrl(new URL("../install.sh", import.meta.url));
const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const installSource = await Deno.readTextFile(INSTALL);
const gateSource = await Deno.readTextFile(GATE);
const DECODER = new TextDecoder();

interface InstallRun {
  binDir: string;
  downloaderLog: string;
  root: string;
  stderr: string;
  stdout: string;
  success: boolean;
  target: string;
}

/** Quote a value for the shell. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Return the command path. */
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

/** Return the release asset. */
function releaseAsset(): string {
  const arch = Deno.build.arch === "x86_64" ? "x86_64" : "aarch64";
  const os = Deno.build.os === "darwin" ? "apple-darwin" : "unknown-linux-gnu";
  return `discern-${arch}-${os}`;
}

/** Return the SHA-256. */
async function sha256(path: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Return the registered downloaders. */
function registeredDownloaders(): string[] {
  const match = installSource.match(/^DOWNLOADERS="([^"]+)"$/m);
  assert(match !== null, "install.sh declares its downloader registry");
  return match[1]?.split(/\s+/).filter(Boolean) ?? [];
}

/** Return the link tool. */
async function linkTool(dir: string, command: string): Promise<void> {
  await Deno.symlink(await commandPath(command), join(dir, command));
}

/** Return the run installer. */
async function runInstaller(
  downloader: string,
  options: { badChecksum?: boolean; binOnPath?: boolean } = {},
): Promise<InstallRun> {
  const root = await Deno.makeTempDir({ prefix: "discern-install-test-" });
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

  return {
    binDir,
    downloaderLog: await Deno.readTextFile(downloaderLog).catch(() => ""),
    root,
    stderr: DECODER.decode(result.stderr),
    stdout: DECODER.decode(result.stdout),
    success: result.success,
    target,
  };
}

Deno.test("every registered downloader gets both files with retry semantics", async () => {
  const downloaders = registeredDownloaders();
  assert(downloaders.length > 0, "at least one downloader is supported");
  for (const downloader of downloaders) {
    const run = await runInstaller(downloader);
    try {
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
    } finally {
      await Deno.remove(run.root, { recursive: true });
    }
  }
  assertStringIncludes(installSource, "--retry 3");
  assertStringIncludes(installSource, "--retry-all-errors");
  assertStringIncludes(installSource, "--tries=3");
});

Deno.test("a bad checksum preserves the existing installation", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  const run = await runInstaller(downloader, { badChecksum: true });
  try {
    assert(!run.success, "a checksum mismatch must stop installation");
    assertStringIncludes(run.stderr, "checksum verification failed");
    assertEquals(
      await Deno.readTextFile(run.target),
      "existing installation\n",
    );
  } finally {
    await Deno.remove(run.root, { recursive: true });
  }
});

Deno.test("next-step output appears only when discern resolves on PATH", async () => {
  const downloader = registeredDownloaders()[0];
  assert(downloader !== undefined);
  const offPath = await runInstaller(downloader);
  try {
    assert(offPath.success);
    assert(!offPath.stdout.includes("Next:"));
    assertStringIncludes(offPath.stderr, "shell profile");
    const onPath = await runInstaller(downloader, { binOnPath: true });
    try {
      assert(onPath.success);
      assertStringIncludes(onPath.stdout, "Next:");
    } finally {
      await Deno.remove(onPath.root, { recursive: true });
    }
  } finally {
    await Deno.remove(offPath.root, { recursive: true });
  }
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
