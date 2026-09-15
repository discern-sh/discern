/** Local assets and a closed tool PATH drive the real POSIX installer. */
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { BUILD_TARGETS, type BuildTarget } from "../scripts/build_targets.ts";
import { humanVersion } from "../src/lib/version.ts";
import { DISCERN_REPOSITORY_SLUG } from "../src/shared/product_identity.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import { writeExecutable } from "./engine_helpers.ts";
import { createWorkflowChecksum } from "./release_workflow_fixture.ts";

const INSTALL = fromFileUrl(new URL("../install.sh", import.meta.url));
const DECODER = new TextDecoder();

export interface InstallRun {
  project: string;
  binDir: string;
  downloaderLog: string;
  stderr: string;
  stdout: string;
  success: boolean;
  target: string;
  expectedBinary: string;
  invocations: readonly { success: boolean; stdout: string; stderr: string }[];
}

interface InstallOptions {
  /** Source-CLI payload for the composed adoption journey; default cases stay inert. */
  binaryCommand?: readonly string[];
  /** Prepare project and prior process identity before the protected-tree snapshot. */
  beforeInstall?: (project: string, target: string) => Promise<void>;
  installerSource?: string;
  badChecksum?: boolean;
  checksumContent?: "other-file" | "extra-file" | "empty";
  binOnPath?: boolean;
  shadow?: boolean;
  destinationDirectory?: boolean;
  existing?: boolean;
  repository?: string | undefined;
  version?: string;
  publishedVersion?: string;
  codename?: string;
  target?: BuildTarget;
  architecture?: string;
  checksumTool?: "shasum" | "sha256sum";
  fail?: "binary" | "checksum" | "chmod" | "mv" | "mktemp";
  repeat?: number;
  destination?: "override" | "relative" | "home";
}

/** Single-quote fixture paths safely for generated POSIX shell wrappers. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Resolve host utilities before closing PATH to fake downloads and known tools. */
async function commandPath(command: string): Promise<string> {
  const result = await new Deno.Command("which", {
    args: [command],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(result.success, `test host is missing ${command}`);
  return DECODER.decode(result.stdout).trim();
}

/** Capture every fixture byte and mode outside the installer's permitted area. */
async function protectedTree(
  root: string,
  excluded: ReadonlySet<string>,
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  /** Recurse through protected fixture paths without following symlinks. */
  async function visit(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (excluded.has(path)) continue;
      const stat = await Deno.lstat(path);
      snapshot[path] = stat.isSymlink
        ? await Deno.readLink(path)
        : stat.isDirectory
        ? `directory:${stat.mode}`
        : `${stat.mode}:${await Deno.readTextFile(path)}`;
      if (entry.isDirectory) await visit(path);
    }
  }
  await visit(root);
  return snapshot;
}

/** Run without network or real installed binaries, and audit project state. */
export async function withInstallerRun<T>(
  downloader: string,
  fn: (run: InstallRun) => T | Promise<T>,
  options: InstallOptions = {},
): Promise<T> {
  return await withTempDir(async (temporaryRoot) => {
    const root = await Deno.realPath(temporaryRoot);
    const tools = join(root, "tools");
    const project = join(root, "project");
    const home = join(root, "home");
    const binDir = options.destination === "home"
      ? join(home, ".local", "bin")
      : join(root, "chosen bin");
    for (const dir of [tools, project, home, binDir]) {
      await Deno.mkdir(dir, { recursive: true });
    }
    const admin = join(project, ".git", "discern");
    await Deno.mkdir(admin, { recursive: true });
    await Deno.writeTextFile(
      join(project, "discern.toml"),
      "[meta]\nmanaged_version = '0.9.7'\n",
    );
    await Deno.writeTextFile(
      join(admin, "release-check.json"),
      '{"first_seen_at":"2026-01-01"}\n',
    );
    await Deno.writeTextFile(
      join(project, "AGENTS.md"),
      "Project instructions\n",
    );
    await Deno.writeTextFile(join(home, ".profile"), "# Keep my PATH\n");
    for (const command of ["git", "find"]) {
      const path = join(tools, command);
      await writeExecutable(
        path,
        `#!/bin/sh\nprintf '%s\\n' ${shellQuote(command)} >> ${
          shellQuote(join(root, "unexpected-commands.log"))
        }\nexit 99\n`,
      );
    }
    const target = options.target ??
      BUILD_TARGETS.find((candidate) =>
        candidate.installer.os ===
          (Deno.build.os === "darwin" ? "Darwin" : "Linux") &&
        candidate.installer.architectures.includes(Deno.build.arch)
      );
    assert(target !== undefined, "fixture has a supported release target");
    const asset = target.output;
    for (const tool of ["chmod", "mkdir", "mktemp", "mv", "rm"]) {
      const path = join(tools, tool);
      if (options.fail === tool) {
        await writeExecutable(path, "#!/bin/sh\nexit 1\n");
      } else {
        await Deno.symlink(await commandPath(tool), path);
      }
    }
    await writeExecutable(
      join(tools, "uname"),
      `#!/bin/sh
case "$1" in
-s) printf '%s\\n' ${shellQuote(target.installer.os)} ;;
-m) printf '%s\\n' ${
        shellQuote(options.architecture ?? target.installer.architectures[0])
      } ;;
*) exit 1 ;;
esac
`,
    );
    const hostChecksumTool = Deno.build.os === "darwin"
      ? "shasum"
      : "sha256sum";
    const checksumTool = options.checksumTool ?? hostChecksumTool;
    const checksumCommand = await commandPath(hostChecksumTool);
    const checksumAdapter = join(tools, checksumTool);
    if (checksumTool === hostChecksumTool) {
      await Deno.symlink(checksumCommand, checksumAdapter);
    } else {
      // Exercise both command interfaces without requiring an extra host package.
      const adapt = checksumTool === "sha256sum"
        ? `exec ${shellQuote(checksumCommand)} -a 256 "$@"`
        : `[ "$1" = -a ] && [ "$2" = 256 ] || exit 93\nshift 2\nexec ${
          shellQuote(checksumCommand)
        } "$@"`;
      await writeExecutable(
        checksumAdapter,
        `#!/bin/sh\nset -eu\n${adapt}\n`,
      );
    }
    const version = options.version ?? "latest";
    const installedVersion = options.publishedVersion ??
      (version === "latest" ? "1.2.3" : version.replace(/^v/, ""));
    const versionOutput = humanVersion({
      version: installedVersion,
      ...(options.codename === undefined ? {} : { codename: options.codename }),
    });
    const expectedBinary = options.binaryCommand === undefined
      ? `#!/bin/sh\nprintf '%s\\n' "$*" >> ${
        shellQuote(join(root, "binary-invocations.log"))
      }\nprintf '%s\\n' ${shellQuote(versionOutput)}\n`
      : `#!/bin/sh\nexec ${
        options.binaryCommand.map(shellQuote).join(" ")
      } "$@"\n`;
    const fixtureBinary = join(root, "fixture-discern");
    await Deno.writeTextFile(fixtureBinary, expectedBinary);
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
    if (options.checksumContent !== undefined) {
      const manifest = await Deno.readTextFile(fixtureChecksum);
      // A valid checksum of unrelated bytes must not license this asset's replacement.
      const unrelatedName = "unrelated-integrity-input";
      const unrelatedPath = join(dist, unrelatedName);
      await Deno.writeTextFile(
        unrelatedPath,
        "Other verified bytes\n",
      );
      const unrelated = (await Deno.readTextFile(
        await createWorkflowChecksum(root, unrelatedName),
      )).replace(unrelatedName, unrelatedPath);
      await Deno.writeTextFile(
        fixtureChecksum,
        options.checksumContent === "empty"
          ? ""
          : options.checksumContent === "other-file"
          ? unrelated
          : manifest + unrelated,
      );
    }
    const downloaderLog = join(root, "downloads.log");
    const copy = await commandPath("cp");
    const stat = await commandPath("stat");
    const statArgs = Deno.build.os === "darwin" ? "-f '%Lp'" : "-c '%a'";
    const repository = options.repository ?? DISCERN_REPOSITORY_SLUG;
    const base = `https://github.com/${repository}/releases/`;
    const selected = version === "latest"
      ? "latest/download"
      : `download/v${version.replace(/^v/, "")}`;
    const url = `${base}${selected}/${asset}`;
    const fakeDownloader = join(tools, downloader);
    await writeExecutable(
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
[ "$(${shellQuote(stat)} ${statArgs} "\${out%/*}")" = 700 ] || exit 91
case "$url" in
    ${shellQuote(url + ".sha256")}) ${
        options.fail === "checksum"
          ? 'printf partial > "$out"; exit 1'
          : `${shellQuote(copy)} ${shellQuote(fixtureChecksum)} "$out"`
      } ;;
    ${shellQuote(url)}) ${
        options.fail === "binary"
          ? 'printf partial > "$out"; exit 1'
          : `${shellQuote(copy)} ${shellQuote(fixtureBinary)} "$out"`
      } ;;
    *) exit 92 ;;
esac
`,
    );
    const dest = join(binDir, "discern");
    if (options.destinationDirectory) await Deno.mkdir(dest);
    else if (options.existing || options.badChecksum) {
      await writeExecutable(dest, "existing installation\n");
    }
    const shadowDir = join(root, "shadow");
    await Deno.mkdir(shadowDir);
    await writeExecutable(
      join(shadowDir, "discern"),
      "#!/bin/sh\nexit 99\n",
    );
    const path = [
      options.shadow ? shadowDir : undefined,
      options.binOnPath ? binDir : undefined,
      tools,
    ].filter(Boolean).join(":");
    const env: Record<string, string> = {
      HOME: home,
      NO_COLOR: "1",
      PATH: path,
    };
    if (options.destination !== "home") {
      env.DISCERN_BIN_DIR = options.destination === "relative"
        ? "../chosen bin"
        : binDir;
    } else {
      assertEquals(
        target.installer.os,
        "Linux",
        "HOME default tests cannot touch host /usr/local/bin",
      );
    }
    if (options.version !== undefined) env.DISCERN_VERSION = options.version;
    if (options.repository !== undefined) env.DISCERN_REPO = options.repository;
    let installer = INSTALL;
    if (options.installerSource !== undefined) {
      installer = join(root, "installer-under-test.sh");
      await Deno.writeTextFile(installer, options.installerSource);
    }
    await options.beforeInstall?.(project, dest);
    const excluded = new Set([binDir, downloaderLog]);
    const before = await protectedTree(root, excluded);
    const invocations = [];
    for (let i = 0; i < (options.repeat ?? 1); i++) {
      const result = await new Deno.Command("/bin/sh", {
        args: [installer],
        cwd: project,
        clearEnv: true,
        env,
        stdout: "piped",
        stderr: "piped",
      }).output();
      invocations.push({
        success: result.success,
        stdout: DECODER.decode(result.stdout),
        stderr: DECODER.decode(result.stderr),
      });
      assertEquals(
        await protectedTree(root, excluded),
        before,
        "installer writes only its selected bin/staging area; projects, Git-admin state, and shell profiles stay intact",
      );
      for await (const entry of Deno.readDir(binDir)) {
        assertEquals(
          entry.name,
          "discern",
          "each invocation cleans staging, including failures",
        );
      }
    }
    const last = invocations.at(-1);
    assert(last !== undefined);
    return await fn({
      project,
      binDir,
      downloaderLog: (await readTextIfExists(downloaderLog)) ?? "",
      ...last,
      target: dest,
      expectedBinary,
      invocations,
    });
  }, { prefix: "discern-install-test-" });
}
