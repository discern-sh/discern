/** Release artifacts and the native GitHub runner policy for each target. */

export interface BuildTarget {
  /** Deno compile target triple. */
  triple: string;
  /** Release asset filename. */
  output: string;
  /** GitHub-hosted runner whose architecture can execute the artifact. */
  runner: string;
  /** Installer platform facts that select this release asset. */
  installer: {
    /** Exact `uname -s` value accepted by the POSIX installer. */
    os: "Darwin" | "Linux";
    /** Public name used in the supported-target table. */
    operatingSystem: "macOS" | "GNU/Linux";
    /** Exact `uname -m` values accepted for this artifact. */
    architectures: readonly [string, ...string[]];
  };
}

/** Every binary the release workflow builds, executes, and publishes. */
export const BUILD_TARGETS: readonly BuildTarget[] = [
  {
    triple: "x86_64-apple-darwin",
    output: "discern-x86_64-apple-darwin",
    runner: "macos-15-intel",
    installer: {
      os: "Darwin",
      operatingSystem: "macOS",
      architectures: ["x86_64", "amd64"],
    },
  },
  {
    triple: "aarch64-apple-darwin",
    output: "discern-aarch64-apple-darwin",
    runner: "macos-15",
    installer: {
      os: "Darwin",
      operatingSystem: "macOS",
      architectures: ["arm64", "aarch64"],
    },
  },
  {
    triple: "x86_64-unknown-linux-gnu",
    output: "discern-x86_64-unknown-linux-gnu",
    runner: "ubuntu-24.04",
    installer: {
      os: "Linux",
      operatingSystem: "GNU/Linux",
      architectures: ["x86_64", "amd64"],
    },
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    output: "discern-aarch64-unknown-linux-gnu",
    runner: "ubuntu-24.04-arm",
    installer: {
      os: "Linux",
      operatingSystem: "GNU/Linux",
      architectures: ["arm64", "aarch64"],
    },
  },
];

/** The binary and checksum sidecar published for one target. */
export function releaseArtifactPaths(
  target: BuildTarget,
): readonly [string, string] {
  return [target.output, `${target.output}.sha256`];
}

export const SUPPORTED_TARGETS_BLOCK_START =
  "<!-- BEGIN GENERATED BUILD TARGETS -->";
export const SUPPORTED_TARGETS_BLOCK_END =
  "<!-- END GENERATED BUILD TARGETS -->";

/** Render the public target table from the release-build authority. */
export function renderSupportedTargetsTable(
  targets: readonly BuildTarget[] = BUILD_TARGETS,
): string {
  return [
    SUPPORTED_TARGETS_BLOCK_START,
    "| Operating system | Architecture labels accepted by the installer | Release asset |",
    "| --- | --- | --- |",
    ...targets.map((target) =>
      `| ${target.installer.operatingSystem} | ${
        target.installer.architectures.map((arch) => `\`${arch}\``).join(", ")
      } | \`${target.output}\` |`
    ),
    SUPPORTED_TARGETS_BLOCK_END,
  ].join("\n");
}

/** Replace one maintained supported-target table in an authored document. */
export function replaceSupportedTargetsTable(
  document: string,
  targets: readonly BuildTarget[] = BUILD_TARGETS,
): string {
  const start = document.indexOf(SUPPORTED_TARGETS_BLOCK_START);
  const end = document.indexOf(SUPPORTED_TARGETS_BLOCK_END);
  if (start < 0 || end < start) {
    throw new Error("document has no generated build-target block");
  }
  const after = end + SUPPORTED_TARGETS_BLOCK_END.length;
  return document.slice(0, start) + renderSupportedTargetsTable(targets) +
    document.slice(after);
}
