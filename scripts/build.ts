/**
 * Build the per-platform `discern` binaries via `deno compile`.
 *
 * Each target produces a single self-contained binary with two trees bundled:
 *  - `templates/` (`--include templates`), so the installed `discern` needs no
 *    Deno and no network to scaffold; and
 *  - discern's OWN documentation, staged into {@link BUNDLED_DOCS_STAGE_DIR}
 *    first (see {@link stageBundledDocs}) and `--include`d, so `discern help`
 *    serves it from any install. The PUBLIC subtrees plus the opt-in
 *    {@link BUNDLED_INTERNAL_DOC_DIRS} (the ADRs, reachable only via
 *    `discern help --adr`) are staged; `_internal`/`_private` are never
 *    embedded in a customer binary.
 *
 * Output goes to `dist/`.
 *
 * Run: `deno task build` (optionally `deno task build -- <target>` to build one).
 */

import { copy, ensureDir } from "@std/fs";
import { join } from "@std/path";
import { BUNDLED_DOCS_STAGE_DIR, isBundledDocEntry } from "../src/lib/paths.ts";

/** A compile target: Deno's triple and the binary file name we ship. */
interface Target {
  triple: string;
  /** Output binary name (Windows would need .exe; we ship the four POSIX ones). */
  output: string;
}

/** The four platforms the release pipeline produces. */
const TARGETS: Target[] = [
  { triple: "x86_64-apple-darwin", output: "discern-x86_64-apple-darwin" },
  { triple: "aarch64-apple-darwin", output: "discern-aarch64-apple-darwin" },
  {
    triple: "x86_64-unknown-linux-gnu",
    output: "discern-x86_64-unknown-linux-gnu",
  },
  {
    triple: "aarch64-unknown-linux-gnu",
    output: "discern-aarch64-unknown-linux-gnu",
  },
];

/** The least-privilege permissions the compiled binary carries. */
const PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-run",
];

/**
 * Stage discern's documentation into {@link BUNDLED_DOCS_STAGE_DIR} for embedding:
 * the PUBLIC subtrees plus exactly the opt-in {@link BUNDLED_INTERNAL_DOC_DIRS}
 * (the ADRs, surfaced only by `discern help --adr`). Every other `_`-prefixed
 * subtree (`_internal`, `_private`) is excluded, so internal/maintainer notes
 * never ship inside a customer binary — default-deny ({@link isBundledDocEntry}),
 * so a new private tree stays out until it is added to the allowlist on purpose.
 * The tree nests an inner `docs/` so the embedded path matches a checkout
 * (`docs/…`); {@link resolveBundledDocsDir} reads it back. Returns the staged
 * parent directory to `--include`. Curation is at the EMBED here; the view (the
 * default `includeInternal: false`, and the `--adr` allowlist) is the second line
 * of defence (ADR 0039).
 */
async function stageBundledDocs(): Promise<string> {
  await Deno.remove(BUNDLED_DOCS_STAGE_DIR, { recursive: true }).catch(
    () => {},
  );
  const stagedDocs = join(BUNDLED_DOCS_STAGE_DIR, "docs");
  await ensureDir(stagedDocs);
  for await (const entry of Deno.readDir("docs")) {
    if (!isBundledDocEntry(entry.name)) continue;
    await copy(join("docs", entry.name), join(stagedDocs, entry.name));
  }
  return BUNDLED_DOCS_STAGE_DIR;
}

/** Compile one target into `dist/`. Throws on a non-zero exit. */
async function compileTarget(
  target: Target,
  distDir: string,
  docsStageDir: string,
): Promise<void> {
  const outPath = `${distDir}/${target.output}`;
  const args = [
    "compile",
    ...PERMISSIONS,
    "--include",
    "templates",
    "--include",
    docsStageDir,
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

  const docsStageDir = await stageBundledDocs();
  try {
    for (const target of targets) {
      await compileTarget(target, distDir, docsStageDir);
    }
  } finally {
    // The staged docs are a transient embed input — never leave them behind to
    // dirty the tree or shadow the live docs/ in a later `deno task dev help`.
    await Deno.remove(docsStageDir, { recursive: true }).catch(() => {});
  }
  console.log(`✓ built ${targets.length} binary/binaries into ${distDir}/`);
}

if (import.meta.main) {
  await main();
}
