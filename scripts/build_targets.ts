/** Release artifacts and the native GitHub runner policy for each target. */

export interface BuildTarget {
  /** Deno compile target triple. */
  triple: string;
  /** Release asset filename. */
  output: string;
  /** GitHub-hosted runner whose architecture can execute the artifact. */
  runner: string;
  /** Run the full repository gate on this matrix row before compilation. */
  gateBeforeBuild?: boolean;
}

/** Every binary the release workflow builds, executes, and publishes. */
export const BUILD_TARGETS: readonly BuildTarget[] = [
  {
    triple: "x86_64-apple-darwin",
    output: "discern-x86_64-apple-darwin",
    runner: "macos-15-intel",
  },
  {
    triple: "aarch64-apple-darwin",
    output: "discern-aarch64-apple-darwin",
    runner: "macos-15",
    gateBeforeBuild: true,
  },
  {
    triple: "x86_64-unknown-linux-gnu",
    output: "discern-x86_64-unknown-linux-gnu",
    runner: "ubuntu-24.04",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    output: "discern-aarch64-unknown-linux-gnu",
    runner: "ubuntu-24.04-arm",
  },
];
