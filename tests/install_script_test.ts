/** The remote installer must fail closed and leave a directly usable command. */

import { assertTerminalTextIncludes } from "./helpers.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { DISCERN_REPOSITORY_SLUG } from "../src/shared/brand.ts";
import { DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS } from "../src/shared/environment_variables.ts";

const INSTALL = fromFileUrl(new URL("../install.sh", import.meta.url));
const GATE = new URL("../.github/workflows/gate.yml", import.meta.url);
const installSource = await Deno.readTextFile(INSTALL);
const gateSource = await Deno.readTextFile(GATE);

import { withInstallerRun } from "./install_fixture.ts";
import { UPDATE_SEQUENCE } from "../src/shared/product_identity.ts";
import { releasePlan } from "../scripts/release_plan.ts";
import { parseReleaseRecords } from "../site/releases/records.ts";
import { parseVersionOutput } from "../src/lib/version.ts";

/** Read the installer's downloader registry so new adapters join the contract. */
function registeredDownloaders(): string[] {
  const match = installSource.match(/^DOWNLOADERS="([^"]+)"$/m);
  assert(match !== null, "install.sh declares its downloader registry");
  return match[1]?.split(/\s+/).filter(Boolean) ?? [];
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

Deno.test("first install and every replacement give the matching handoff", async () => {
  for (const downloader of registeredDownloaders()) {
    for (const codename of [undefined, "Test family"]) {
      await withInstallerRun(downloader, async (run) => {
        assert(run.success, run.stderr);
        assertEquals(await Deno.readTextFile(run.target), run.expectedBinary);
        assert(((await Deno.stat(run.target)).mode ?? 0) & 0o100);
        const version = await new Deno.Command(run.target, {
          args: ["--version"],
          stdout: "piped",
        }).output();
        assertEquals(
          parseVersionOutput(new TextDecoder().decode(version.stdout)),
          "1.2.3",
        );
        const first = run.invocations[0];
        assert(first !== undefined);
        assertStringIncludes(first.stdout, "installed");
        assertTerminalTextIncludes(first.stdout, "sets up the project");
        for (const replacement of run.invocations.slice(1)) {
          assert(replacement.success, replacement.stderr);
          assertStringIncludes(replacement.stdout, "updated");
          assert(!replacement.stdout.includes("sets up the project"));
          let previous = -1;
          for (const step of UPDATE_SEQUENCE.slice(2)) {
            const index = replacement.stdout.indexOf(step);
            assert(
              index > previous,
              `replacement follows the shared sequence: ${step}`,
            );
            previous = index;
          }
        }
      }, {
        binOnPath: true,
        repeat: 3,
        ...(codename === undefined ? {} : { codename }),
      });
    }
  }
});

Deno.test("every pre-commit installer failure preserves existing bytes and reports failure", async () => {
  for (const downloader of registeredDownloaders()) {
    for (
      const fail of ["binary", "checksum", "chmod", "mv", "mktemp"] as const
    ) {
      await withInstallerRun(downloader, async (run) => {
        assert(!run.success, `${fail} must fail`);
        assertEquals(
          await Deno.readTextFile(run.target),
          "existing installation\n",
        );
        assert(!run.stdout.includes("updated"));
        assert(!run.stdout.includes("installed"));
        assertStringIncludes(
          run.stderr,
          fail === "binary"
            ? "download failed"
            : fail === "checksum"
            ? "checksum download failed"
            : fail === "chmod"
            ? "executable"
            : fail === "mv"
            ? "replace"
            : "staging directory",
        );
      }, { fail, existing: true });
    }
  }
});

Deno.test("checksum verification binds exactly the selected staged asset", async () => {
  for (
    const checksumContent of ["other-file", "extra-file", "empty"] as const
  ) {
    await withInstallerRun("curl", async (run) => {
      assert(
        !run.success,
        `${checksumContent} cannot verify the selected asset`,
      );
      assertEquals(
        await Deno.readTextFile(run.target),
        "existing installation\n",
      );
      assertTerminalTextIncludes(run.stderr, "checksum verification failed");
    }, { checksumContent, existing: true });
  }
});

Deno.test("each supported platform alias downloads its canonical asset and sidecar", async () => {
  for (const target of BUILD_TARGETS) {
    for (const architecture of target.installer.architectures) {
      await withInstallerRun("curl", (run) => {
        assert(run.success, `${target.triple}/${architecture}: ${run.stderr}`);
        const urls = run.downloaderLog.trim().split("\n").map((line) =>
          line.split("|")[1]
        );
        assertEquals(
          urls,
          [target.output, `${target.output}.sha256`].map((asset) =>
            `https://github.com/${DISCERN_REPOSITORY_SLUG}/releases/latest/download/${asset}`
          ),
        );
      }, { target, architecture });
    }
  }
});

Deno.test("destination overrides and the Linux HOME default replace the selected path", async () => {
  const target = BUILD_TARGETS.find((target) =>
    target.installer.os === "Linux"
  );
  assert(target !== undefined);
  for (const destination of ["override", "relative", "home"] as const) {
    await withInstallerRun("curl", async (run) => {
      assert(run.success, run.stderr);
      assertEquals(await Deno.readTextFile(run.target), run.expectedBinary);
      assertStringIncludes(run.stdout, run.target);
      assertStringIncludes(run.stdout, "updated");
      assertEquals(run.stderr, "");
    }, { target, destination, existing: true, binOnPath: true });
  }
});

Deno.test("PATH shadowing identifies both executables before setup or project adoption", async () => {
  for (const existing of [false, true]) {
    await withInstallerRun("curl", (run) => {
      assert(run.success, run.stderr);
      assertStringIncludes(run.stderr, "/shadow/discern");
      assertStringIncludes(run.stderr, run.target);
      assertTerminalTextIncludes(run.stderr, "shell profile");
      assertTerminalTextIncludes(run.stderr, "command -v discern");
      assertTerminalTextIncludes(run.stderr, "discern --version");
      if (existing) assertStringIncludes(run.stdout, UPDATE_SEQUENCE[4]);
    }, { existing, shadow: true, binOnPath: true });
  }
});

Deno.test("published prereleases leave the default stable target intact and remain explicitly installable", async () => {
  const versions = ["1.2.3", "1.3.0-rc.1"];
  const records = parseReleaseRecords(versions.map((version) => ({
    path: `${version}.md`,
    markdown:
      "---\nsummary: Installer publication fixture\n---\nLocal release assets.",
  })));
  let latest: string | undefined;
  const published: { version: string; date: string }[] = [];
  for (const version of versions) {
    const plan = releasePlan(`v${version}`, {
      repositoryPrivate: false,
      version,
      records,
      published,
      ancestors: published.map((release) => release.version),
    });
    if (plan.makeLatest) latest = plan.version;
    published.push({ version, date: "2026-01-01" });
  }
  assertEquals(latest, versions[0]);
  for (const version of [undefined, "latest", "1.3.0-rc.1", "v1.3.0-rc.1"]) {
    await withInstallerRun("curl", async (run) => {
      assert(run.success, run.stderr);
      const defaultTarget = version === undefined || version === "latest";
      assertStringIncludes(
        run.downloaderLog,
        defaultTarget
          ? "/releases/latest/download/"
          : "/releases/download/v1.3.0-rc.1/",
      );
      const result = await new Deno.Command(run.target, {
        args: ["--version"],
        stdout: "piped",
      }).output();
      assertEquals(
        parseVersionOutput(new TextDecoder().decode(result.stdout)),
        defaultTarget ? latest : "1.3.0-rc.1",
      );
    }, {
      ...(version === undefined ? {} : { version }),
      publishedVersion: version === undefined || version === "latest"
        ? (latest ?? "")
        : "1.3.0-rc.1",
    });
  }
});

Deno.test("each checksum adapter verifies bytes and refuses a mismatched or unrelated sidecar", async () => {
  for (const checksumTool of ["sha256sum", "shasum"] as const) {
    for (const badChecksum of [false, true]) {
      await withInstallerRun("wget", async (run) => {
        assertEquals(run.success, !badChecksum, run.stderr);
        assertEquals(
          await Deno.readTextFile(run.target),
          badChecksum ? "existing installation\n" : run.expectedBinary,
        );
      }, { checksumTool, badChecksum, existing: true });
    }
    await withInstallerRun("wget", (run) => assert(!run.success), {
      checksumTool,
      checksumContent: "other-file",
      existing: true,
    });
  }
});

Deno.test("first-install failures leave no destination or setup claim", async () => {
  for (const fail of ["binary", "checksum", "chmod", "mv", "mktemp"] as const) {
    await withInstallerRun("curl", async (run) => {
      assert(!run.success);
      await assertRejects(() => Deno.lstat(run.target), Deno.errors.NotFound);
      assert(!run.stdout.includes("installed"));
      assert(!run.stdout.includes("Next:"));
    }, { fail });
  }
});

Deno.test("the installer effect guard rejects unrelated project writes, discovery, and binary commands", async () => {
  for (
    const effect of [
      "printf changed > unexpected-project-file",
      "git rev-parse --show-toplevel >/dev/null 2>&1 || :",
      "find . -name discern.toml >/dev/null 2>&1 || :",
      "discern upgrade >/dev/null 2>&1 || :",
    ]
  ) {
    const installerSource = installSource + "\n" + effect + "\n";
    await assertRejects(
      () =>
        withInstallerRun("curl", () => {}, {
          installerSource,
          binOnPath: true,
        }),
      Error,
      "installer writes only its selected bin/staging area",
    );
  }
});
