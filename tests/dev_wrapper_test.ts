/**
 * Behavioural guard for the local-dev `discern` wrapper (`scripts/discern`).
 *
 * The wrapper must run the engine of a real DISCERN checkout — identified by
 * discern's own identity in deno.json (`"name": "discern"`) — and must NOT be
 * fooled by an unrelated Deno project that merely shares the `src/main.ts` +
 * `deno.json` shape. These tests drive the real script with a stubbed `deno`
 * (and, for the `mcp` branch, a stubbed `git`) on PATH so we can observe which
 * engine it would exec, across all three detection sites: the cwd walk-up, the
 * `$DISCERN_HOME` fallback, and the `discern mcp` main-checkout resolution.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";

/** Absolute path to the wrapper under test. */
const WRAPPER = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "scripts",
  "discern",
);

/** Lay down a Deno project shaped like a discern checkout, named `denoName`. */
async function scaffoldProject(root: string, denoName: string): Promise<void> {
  await Deno.mkdir(join(root, "src"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "src", "main.ts"),
    "// stand-in engine entrypoint\n",
  );
  await Deno.writeTextFile(
    join(root, "deno.json"),
    `{\n  "name": "${denoName}",\n  "exports": "./src/main.ts"\n}\n`,
  );
}

/** Write an executable stub `name` into `dir` with the given shell `body`. */
async function writeStub(
  dir: string,
  name: string,
  body: string,
): Promise<void> {
  const path = join(dir, name);
  await Deno.writeTextFile(path, body);
  await Deno.chmod(path, 0o755);
}

/** A `deno` stub that echoes its argv so the test can see the chosen engine. */
const DENO_STUB = '#!/bin/sh\nprintf "%s\\n" "$@"\n';

/** A `git` stub whose `worktree list --porcelain` reports `mainRoot` first. */
function gitStub(mainRoot: string): string {
  return `#!/bin/sh\nprintf 'worktree %s\\nbranch refs/heads/main\\n\\n' '${mainRoot}'\n`;
}

interface WrapperRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the wrapper with `stubDir` shadowing the front of PATH and a clean env
 * (so a real `DISCERN_HOME` in the developer's shell can't leak in). Real
 * coreutils still resolve via the inherited PATH appended behind the stubs.
 */
async function runWrapper(opts: {
  args: string[];
  cwd: string;
  stubDir: string;
  discernHome?: string;
}): Promise<WrapperRun> {
  const env: Record<string, string> = {
    PATH: `${opts.stubDir}:${Deno.env.get("PATH") ?? ""}`,
  };
  if (opts.discernHome !== undefined) env.DISCERN_HOME = opts.discernHome;
  const { code, stdout, stderr } = await new Deno.Command("/bin/sh", {
    args: [WRAPPER, ...opts.args],
    cwd: opts.cwd,
    clearEnv: true,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { code, stdout: dec.decode(stdout), stderr: dec.decode(stderr) };
}

/**
 * Build the standard fixture inside one temp dir, resolved to its real path so
 * the engine paths the wrapper prints (derived from the shell's physical $PWD)
 * match what we assert on (macOS temp dirs are symlinks). Yields a discern
 * checkout, a same-shaped look-alike, an empty cwd, and a stub dir.
 */
async function withFixture(
  fn: (f: {
    discern: string;
    discernMain: string;
    lookalike: string;
    lookalikeMain: string;
    empty: string;
    stubDir: string;
  }) => Promise<void>,
): Promise<void> {
  await withTempDir(async (tmp) => {
    const base = await Deno.realPath(tmp);
    const discern = join(base, "discern-checkout");
    const lookalike = join(base, "look-alike");
    const empty = join(base, "empty");
    const stubDir = join(base, "stubs");
    await scaffoldProject(discern, "discern");
    await scaffoldProject(lookalike, "totally-not-discern");
    await Deno.mkdir(empty, { recursive: true });
    await Deno.mkdir(stubDir, { recursive: true });
    await writeStub(stubDir, "deno", DENO_STUB);
    await fn({
      discern,
      discernMain: join(discern, "src", "main.ts"),
      lookalike,
      lookalikeMain: join(lookalike, "src", "main.ts"),
      empty,
      stubDir,
    });
  });
}

Deno.test("wrapper: walks up to a real discern checkout and runs its engine", async () => {
  await withFixture(async (f) => {
    const nested = join(f.discern, "src", "engine");
    await Deno.mkdir(nested, { recursive: true });
    const run = await runWrapper({
      args: ["status"],
      cwd: nested,
      stubDir: f.stubDir,
    });
    assertEquals(run.code, 0);
    assertStringIncludes(run.stdout, f.discernMain);
  });
});

Deno.test("wrapper: a look-alike Deno project is not mistaken for a checkout", async () => {
  await withFixture(async (f) => {
    const run = await runWrapper({
      args: ["status"],
      cwd: f.lookalike,
      stubDir: f.stubDir,
      // No DISCERN_HOME: with the look-alike rejected there is nothing to run.
    });
    assertEquals(run.code, 1);
    assertStringIncludes(run.stderr, "no discern checkout");
    assert(
      !run.stdout.includes(f.lookalikeMain),
      "must not exec the look-alike project's src/main.ts",
    );
  });
});

Deno.test("wrapper: falls back to a discern DISCERN_HOME from inside a look-alike", async () => {
  await withFixture(async (f) => {
    const run = await runWrapper({
      args: ["status"],
      cwd: f.lookalike,
      stubDir: f.stubDir,
      discernHome: f.discern,
    });
    assertEquals(run.code, 0);
    assertStringIncludes(run.stdout, f.discernMain);
    assert(
      !run.stdout.includes(f.lookalikeMain),
      "must run DISCERN_HOME's engine, not the look-alike's",
    );
  });
});

Deno.test("wrapper: a DISCERN_HOME pointing at a non-discern project is rejected", async () => {
  await withFixture(async (f) => {
    const run = await runWrapper({
      args: ["status"],
      cwd: f.empty,
      stubDir: f.stubDir,
      discernHome: f.lookalike,
    });
    assertEquals(run.code, 1);
    assertStringIncludes(run.stderr, "no discern checkout");
  });
});

Deno.test("wrapper: `mcp` runs the main checkout when it is a discern checkout", async () => {
  await withFixture(async (f) => {
    await writeStub(f.stubDir, "git", gitStub(f.discern));
    const run = await runWrapper({
      args: ["mcp"],
      cwd: f.empty, // not itself a checkout: only the mcp branch can find discern
      stubDir: f.stubDir,
    });
    assertEquals(run.code, 0);
    assertStringIncludes(run.stdout, f.discernMain);
  });
});

Deno.test("wrapper: `mcp` does not run a look-alike main checkout", async () => {
  await withFixture(async (f) => {
    await writeStub(f.stubDir, "git", gitStub(f.lookalike));
    const run = await runWrapper({
      args: ["mcp"],
      cwd: f.empty,
      stubDir: f.stubDir,
      // No DISCERN_HOME: the look-alike main checkout must not be run.
    });
    assertEquals(run.code, 1);
    assert(
      !run.stdout.includes(f.lookalikeMain),
      "mcp must not exec the look-alike project's src/main.ts",
    );
  });
});
