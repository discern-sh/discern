/**
 * Build one representative release target and emit its compiled binary size as a
 * discern ratchet metric.
 *
 * The default target is Linux x64: it avoids macOS codesigning differences while
 * still exercising the single-file release artifact users download.
 */

const target = Deno.args[0] ?? "x86_64-unknown-linux-gnu";
const outPath = `dist/discern-${target}`;

const build = await new Deno.Command(Deno.execPath(), {
  args: ["task", "build", target],
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (build.code !== 0) {
  throw new Error(`deno task build ${target} failed with exit ${build.code}`);
}

const stat = await Deno.stat(outPath);
if (!stat.isFile) {
  throw new Error(`${outPath} is not a file`);
}

console.error(`${outPath}: ${stat.size} bytes`);
console.log(`DISCERN_METRIC binary_size_bytes ${stat.size}`);
