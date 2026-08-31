/**
 * Project Script namespace guard — every file in `[scripts].dir` is a command.
 *
 * The configured script directory is not a place for project-related code. It
 * is a command namespace: `discern scripts` lists what it finds there, and the
 * Desk offers every one of those files to run. A module that merely happens to
 * be project-owned — a checkpoint matcher the config invokes with `deno run`, a
 * library a sibling imports — is not a command, and putting one here publishes
 * it as a broken menu entry whose only offered remedy (`chmod +x`) produces a
 * listed command that still cannot run.
 *
 * The law: every file directly inside the configured directory is executable in
 * Git's index, starts with a shebang, and carries a `# desc:` line.
 *
 * Each clause answers a different failure. The **index** mode is what other
 * checkouts receive, so a file executable only on the author's disk still fails
 * here rather than arriving inert for everyone else. The **shebang** is what
 * separates a command that lost its bit from a module that was never a command
 * — without it, `chmod +x` would be enough to satisfy the guard, which is
 * precisely the wrong lesson. The **`# desc:` line** is the text both the
 * listing and the Desk render, so a new command arrives self-describing instead
 * of as a bare name in a menu.
 *
 * The escape is not an exemption list. A file that fails this guard is either
 * an implementation module — move it to the repository's ordinary source tree
 * and let a shim in the namespace call it, the shape `canary-audit` has — or a
 * real command missing one of the three clauses.
 *
 * Subdirectories are outside the law because discovery does not recurse: the
 * engine reads regular files at the top level only, so nothing nested is ever
 * presented as a command. That is deliberately not a lib/ escape hatch; it is
 * the same set the engine itself walks.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { runGit } from "../src/shared/subprocess.ts";

const NAMESPACE_FILES = await structuralGuardScope({
  guard: "tests/project_scripts_namespace_test.ts#command-namespace",
  universe: "authored-text",
  narrow: {
    reason:
      "The Project Script command namespace is the one directory whose every file discern presents as a runnable command.",
    include: (rel) => {
      const prefix = `${REPO_AUTHORED_PATHS.scriptsRel}/`;
      return rel.startsWith(prefix) && !rel.slice(prefix.length).includes("/");
    },
  },
});

/** How a namespace file will reach another checkout. */
interface NamespaceFile {
  readonly rel: string;
  readonly source: string;
  /** Git's recorded mode, or undefined while the file is untracked. */
  readonly indexMode: string | undefined;
  /** Whether the working-tree file carries any executable bit. */
  readonly executableOnDisk: boolean;
}

/**
 * Every clause `file` fails, phrased as the repair its author must make.
 *
 * Pure over the observed facts so the planted fixtures below exercise the same
 * predicate the live namespace runs through.
 */
export function commandViolations(file: NamespaceFile): string[] {
  const failures: string[] = [];
  if (file.indexMode === undefined) {
    if (!file.executableOnDisk) {
      failures.push(`not executable — run: chmod +x ${file.rel}`);
    }
  } else if (file.indexMode !== "100755") {
    failures.push(
      `Git records mode ${file.indexMode}, so it arrives inert in every other ` +
        `checkout — run: git add --chmod=+x ${file.rel}`,
    );
  }
  if (!file.source.startsWith("#!")) {
    failures.push(
      "no shebang — a Project Script is spawned directly, so it must name its own interpreter",
    );
  }
  if (!/^# desc:/m.test(file.source)) {
    failures.push(
      "no `# desc:` line — the listing and the Desk render that text beside the name",
    );
  }
  return failures;
}

/** Git's recorded mode for every tracked file in the namespace. */
async function trackedModes(): Promise<Map<string, string>> {
  const modes = new Map<string, string>();
  const result = await runGit(
    ["ls-files", "-s", "-z", "--", REPO_AUTHORED_PATHS.scriptsRel],
    { cwd: REPO_ROOT },
  );
  assert(result.success, `git ls-files failed: ${result.stderr}`);
  for (const entry of result.stdout.split("\0")) {
    if (entry.length === 0) continue;
    const [meta, path] = entry.split("\t");
    const mode = meta?.split(" ")[0];
    if (mode !== undefined && path !== undefined) modes.set(path, mode);
  }
  return modes;
}

/** Observe one namespace file's mode and text as the guard reads them. */
async function observe(
  rel: string,
  modes: Map<string, string>,
): Promise<NamespaceFile> {
  const stat = await Deno.stat(join(REPO_ROOT, rel));
  return {
    rel,
    source: await Deno.readTextFile(join(REPO_ROOT, rel)),
    indexMode: modes.get(rel),
    executableOnDisk: ((stat.mode ?? 0) & 0o111) !== 0,
  };
}

Deno.test("every file in the Project Script namespace is a runnable command", async () => {
  assert(
    NAMESPACE_FILES.length > 0,
    `no files found under ${REPO_AUTHORED_PATHS.scriptsRel}; the guard is scanning nothing`,
  );
  const modes = await trackedModes();
  const findings: string[] = [];
  for (const rel of NAMESPACE_FILES) {
    for (const failure of commandViolations(await observe(rel, modes))) {
      findings.push(`${rel}: ${failure}`);
    }
  }
  assertEquals(
    findings,
    [],
    `${REPO_AUTHORED_PATHS.scriptsRel} is discern's Project Script command namespace: ` +
      `every file in it is listed by \`discern scripts\` and offered by the Desk as a ` +
      `command.\n\n${findings.join("\n")}\n\n` +
      `An implementation module does not belong here. Move it into the repository's ` +
      `source tree and, if it needs a by-hand entry point, leave an executable shim ` +
      `in the namespace that calls it — the shape \`canary-audit\` has.`,
  );
});

const VALID_SCRIPT = "#!/usr/bin/env sh\n# desc: does the thing\nexit 0\n";

Deno.test("the namespace predicate accepts a well-formed command", () => {
  assertEquals(
    commandViolations({
      rel: "d/ok",
      source: VALID_SCRIPT,
      indexMode: "100755",
      executableOnDisk: true,
    }),
    [],
  );
});

Deno.test("the namespace predicate names each missing clause", () => {
  const module = commandViolations({
    rel: "d/matcher.ts",
    source: "import { thing } from './other.ts';\n",
    indexMode: "100644",
    executableOnDisk: false,
  });
  assertEquals(module.length, 3);

  // The Desk's own remedy for a disabled entry, applied to a module: the bit is
  // now set, and the file is still not a command.
  const chmodded = commandViolations({
    rel: "d/matcher.ts",
    source: "import { thing } from './other.ts';\n",
    indexMode: "100755",
    executableOnDisk: true,
  });
  assertEquals(chmodded.length, 2);
  assert(chmodded.every((failure) => !failure.includes("chmod +x")));

  const undescribed = commandViolations({
    rel: "d/quiet",
    source: "#!/usr/bin/env sh\nexit 0\n",
    indexMode: "100755",
    executableOnDisk: true,
  });
  assertEquals(undescribed.length, 1);
  assert(undescribed[0]?.includes("# desc:"));
});

Deno.test("a locally executable file still fails on the mode Git records", () => {
  const failures = commandViolations({
    rel: "d/shim",
    source: VALID_SCRIPT,
    indexMode: "100644",
    executableOnDisk: true,
  });
  assertEquals(failures.length, 1);
  assert(failures[0]?.includes("git add --chmod=+x"));
});
