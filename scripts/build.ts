/**
 * Build the per-platform `icculus` binaries via `deno compile`.
 *
 * Each target produces a single self-contained binary with the `templates/`
 * tree bundled (`--include templates`), so the installed `icculus` needs no
 * Deno and no network to scaffold. Output goes to `dist/`.
 *
 * Run: `deno task build` (optionally `deno task build -- <target>` to build one).
 */

import { ensureDir } from "@std/fs";

/** A compile target: Deno's triple and the binary file name we ship. */
interface Target {
  triple: string;
  /** Output binary name (Windows would need .exe; we ship the four POSIX ones). */
  output: string;
}

/** The four platforms the release pipeline produces. */
const TARGETS: Target[] = [
  { triple: "x86_64-apple-darwin", output: "icculus-x86_64-apple-darwin" },
  { triple: "aarch64-apple-darwin", output: "icculus-aarch64-apple-darwin" },
  {
    triple: "x86_64-unknown-linux-gnu",
    output: "icculus-x86_64-unknown-linux-gnu",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    output: "icculus-aarch64-unknown-linux-gnu",
  },
];

/** The least-privilege permissions the compiled binary carries. */
const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/** Compile one target into `dist/`. Throws on a non-zero exit. */
async function compileTarget(target: Target, distDir: string): Promise<void> {
  const outPath = `${distDir}/${target.output}`;
  const args = [
    "compile",
    ...PERMISSIONS,
    "--include",
    "templates",
    "--target",
    target.triple,
    "--output",
    outPath,
    "src/main.ts",
  ];
  console.log(`→ compiling ${target.triple} → ${outPath}`);
  const command = new Deno.Command(Deno.execPath(), {
    args,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await command.output();
  if (code !== 0) {
    throw new Error(`compile failed for ${target.triple} (exit ${code})`);
  }
  await verifyDarwinSignature(target, outPath);
}

/**
 * A darwin binary must be at least ad-hoc signed or the arm64 kernel refuses to
 * run it ("Killed: 9"). `deno compile` ad-hoc signs darwin targets when it runs
 * ON macOS; verify that here so an unsigned binary fails the build loudly
 * instead of at a user's first launch. Only meaningful (and only runnable) on a
 * macOS host (where `codesign` exists); a no-op elsewhere.
 */
async function verifyDarwinSignature(
  target: Target,
  outPath: string,
): Promise<void> {
  if (!target.triple.endsWith("apple-darwin") || Deno.build.os !== "darwin") {
    return;
  }
  const verify = await new Deno.Command("codesign", {
    args: ["--verify", "--verbose=2", outPath],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (verify.code !== 0) {
    throw new Error(
      `codesign --verify failed for ${target.triple}: the binary is not signed and would be kernel-killed on arm64. ` +
        `Build the darwin targets on macOS (deno ad-hoc signs there), or sign with rcodesign.`,
    );
  }
  console.log(`  ✓ ${target.triple} is ad-hoc signed`);
}

/** Build all targets, or just the one named on the command line. */
async function main(): Promise<void> {
  const distDir = "dist";
  await ensureDir(distDir);

  const only = Deno.args[0];
  const targets = only ? TARGETS.filter((t) => t.triple === only) : TARGETS;
  if (only && targets.length === 0) {
    console.error(
      `unknown target "${only}". Known: ${
        TARGETS.map((t) => t.triple).join(", ")
      }`,
    );
    Deno.exit(1);
  }

  for (const target of targets) {
    await compileTarget(target, distDir);
  }
  console.log(`✓ built ${targets.length} binary/binaries into ${distDir}/`);
}

if (import.meta.main) {
  await main();
}
