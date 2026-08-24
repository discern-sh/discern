/**
 * `discern start` correctness — the class of "worktree created from the wrong
 * place" defects. A new worktree must branch from the TRUNK (never whatever the
 * main checkout is parked on), `--from <ref>` overrides deliberately, and the
 * repo states a novice actually hits — no commits yet, `discern.toml` in a
 * subdirectory of its repo — are refused in plain language with NO debris left
 * behind (no registered-but-broken worktree for `status` to list as healthy).
 * `doctor` flags both broken layouts. Each bad state is one row of a
 * parameterized table, so a new bad state enrols by adding a row.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { HINTS } from "../src/shared/hints.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** Worktrees git currently registers for the repo at `dir` (paths, main first). */
async function registeredWorktrees(dir: string): Promise<string[]> {
  const out = await gitOut(dir, "worktree", "list", "--porcelain");
  return out.split("\n").filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

/** Assert a failed start left nothing behind: no extra registered worktree, no
 * `agent/*` branch, and no worktree directory on disk. */
async function assertNoStartDebris(dir: string, output: string): Promise<void> {
  assertEquals(
    (await registeredWorktrees(dir)).length,
    1,
    `a failed start must not leave a registered worktree\n${output}`,
  );
  const branches = await gitOut(
    dir,
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
  );
  assert(
    !branches.split("\n").some((b) => b.startsWith("agent/")),
    `a failed start must not leave an agent/* branch (${branches})\n${output}`,
  );
  // The worktree root (the `.worktrees` parent) may remain, but it must be empty —
  // no checkout directory left for a later session to stumble into.
  const entries: string[] = [];
  try {
    for await (const e of Deno.readDir(`${dir}.worktrees`)) {
      entries.push(e.name);
    }
  } catch {
    // absent entirely — even better
  }
  assertEquals(
    entries,
    [],
    `a failed start must not leave a worktree directory\n${output}`,
  );
}

Deno.test("start: one positional name serves --name syntax and changes nothing on every surface", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const before = await gitOut(dir, "status", "--porcelain=v1");

    for (const format of ["--json", "--markdown", undefined] as const) {
      const argv = ["start", "setup-probe"];
      if (format !== undefined) argv.push(format);
      const result = await runAgent(dir, argv);
      assertEquals(result.code, 2, result.output);
      assertStringIncludes(
        result.output,
        "discern start --name setup-probe",
      );
      if (format === "--json") {
        const envelope = JSON.parse(result.stdout) as {
          error?: string;
          message?: string;
        };
        assertEquals(envelope.error, "invalid_arguments");
        assertStringIncludes(
          envelope.message ?? "",
          "discern start --name setup-probe",
        );
      }
    }

    assertEquals(await gitOut(dir, "status", "--porcelain=v1"), before);
    await assertNoStartDebris(dir, "positional-name parser refusal");
  });
});

// ── the bad-state table: each row is one repo state `start` must refuse cleanly ──

interface BadState {
  name: string;
  /** Prepare the broken repo layout; returns the dir to run `start` from. */
  arrange(dir: string): Promise<string>;
  /** A phrase the refusal must contain (plain language, not a stack trace). */
  refusal: string;
  /** A phrase doctor's `repository shape` check must contain. */
  doctorDetail: string;
}

const BAD_STATES: BadState[] = [
  {
    name: "unborn HEAD (no commits yet)",
    arrange: async (dir) => {
      await scaffoldEngine(dir);
      await git(dir, "init", "-q");
      return dir;
    },
    refusal: "make your first commit first",
    doctorDetail: "no commits yet",
  },
  {
    name: "discern.toml in a subdirectory of the repo",
    arrange: async (dir) => {
      const project = join(dir, "app");
      await Deno.mkdir(project, { recursive: true });
      await scaffoldEngine(project);
      await gitInit(dir);
      return project;
    },
    refusal: "git repository's root",
    doctorDetail: "git repository's root",
  },
];

for (const state of BAD_STATES) {
  Deno.test(`start refuses cleanly on ${state.name} — no stack trace, no debris`, async () => {
    await withTempDir(async (dir) => {
      const project = await state.arrange(dir);
      const r = await runAgent(project, ["start", "--json"]);
      assertEquals(r.code, 1, r.output);
      const result = JSON.parse(r.stdout) as {
        ok: boolean;
        error: string;
        message: string;
      };
      assertEquals(result.ok, false);
      assertEquals(result.error, "precondition_failed", r.output);
      assertStringIncludes(result.message, state.refusal);
      assert(
        !r.output.includes("Uncaught"),
        `a refusal must never be a crash\n${r.output}`,
      );
      await assertNoStartDebris(project, r.output);
      assertEquals(
        await exists(`${project}.worktrees`),
        false,
        `a refused start must not create a worktree dir\n${r.output}`,
      );
    });
  });

  Deno.test(`doctor flags the broken layout: ${state.name}`, async () => {
    await withTempDir(async (dir) => {
      const project = await state.arrange(dir);
      const r = await runAgent(project, ["doctor", "--json"]);
      const result = JSON.parse(r.stdout) as {
        data: { checks: { name: string; ok: boolean; detail: string }[] };
      };
      const shape = result.data.checks.find((c) =>
        c.name === "repository shape"
      );
      assert(shape !== undefined, `doctor must check repo shape\n${r.stdout}`);
      assertEquals(shape.ok, false, r.stdout);
      assertStringIncludes(shape.detail, state.doctorDetail);
    });
  });
}

Deno.test("start works from a main checkout parked on an ORPHAN branch — the trunk is what matters", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Park main on an orphan branch: HEAD is unborn, but the trunk has full
    // history. Start forks from the trunk ref, never HEAD — refusing this
    // state with "this repository has no commits yet" was a lie.
    await git(dir, "checkout", "-q", "--orphan", "scratch");

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(
      !r.output.includes("no commits"),
      `an orphan HEAD beside a live trunk has commits\n${r.output}`,
    );
    const result = JSON.parse(r.stdout) as { data: { path: string } };
    // The worktree carries the trunk's content (gitInit committed the scaffold).
    assert(
      await exists(join(result.data.path, "discern.toml")),
      `the worktree must fork from the trunk\n${r.output}`,
    );

    // doctor agrees: this repository has commits, so its shape check passes.
    const doc = await runAgent(dir, ["doctor", "--json"]);
    const parsed = JSON.parse(doc.stdout) as {
      data: { checks: { name: string; ok: boolean; detail: string }[] };
    };
    const shape = parsed.data.checks.find((c) => c.name === "repository shape");
    assert(shape !== undefined, doc.stdout);
    assertEquals(shape.ok, true, JSON.stringify(shape));
  });
});

Deno.test("doctor's repository shape check passes on a healthy repo", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["doctor", "--json"]);
    const result = JSON.parse(r.stdout) as {
      data: { checks: { name: string; ok: boolean }[] };
    };
    const shape = result.data.checks.find((c) => c.name === "repository shape");
    assert(shape !== undefined, r.stdout);
    assertEquals(shape.ok, true, r.stdout);
  });
});

// ── off-trunk main checkout: the poison-commit class ─────────────────────────────

Deno.test("start branches from the trunk even when the main checkout is parked elsewhere", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Park the main checkout on a side branch carrying a poison commit.
    await git(dir, "switch", "-q", "-c", "parked-branch");
    await Deno.writeTextFile(join(dir, "poison.txt"), "off-trunk work\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "poison", "--no-gpg-sign");

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as {
      data: { path: string; from: string };
    };
    assertEquals(result.data.from, "main");
    assertEquals(
      await exists(join(result.data.path, "poison.txt")),
      false,
      `the parked branch's commit must not reach the new worktree\n${r.output}`,
    );
    // The worktree's HEAD is exactly the trunk tip.
    assertEquals(
      await gitOut(result.data.path, "rev-parse", "HEAD"),
      await gitOut(dir, "rev-parse", "main"),
      "the new worktree must sit on the trunk tip",
    );
    // The main checkout was not moved off its parked branch.
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "parked-branch",
    );
  });
});

// ── --from <ref>: the deliberate pull-axis override ──────────────────────────────

Deno.test("start --from <branch> forks the worktree from that ref", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await git(dir, "switch", "-q", "-c", "experiment");
    await Deno.writeTextFile(join(dir, "experiment.txt"), "phase 1\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "experiment work", "--no-gpg-sign");
    await git(dir, "switch", "-q", "main");

    const r = await runAgent(dir, ["start", "--json", "--from", "experiment"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as {
      data: { path: string; from: string };
    };
    assertEquals(result.data.from, "experiment");
    assert(
      await exists(join(result.data.path, "experiment.txt")),
      `the named ref's commits must reach the worktree\n${r.output}`,
    );
  });
});

Deno.test("start --from refuses an unknown ref in plain language", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runAgent(dir, ["start", "--json", "--from", "no-such-ref"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout) as { message: string };
    assertStringIncludes(result.message, "Unknown ref 'no-such-ref'");
    await assertNoStartDebris(dir, r.output);
  });
});

// ── a failed start discards its partial worktree ─────────────────────────────────

Deno.test("a start whose setup fails discards the partial worktree (no debris)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\n\n[repository]\ntrunk = "main"\n\n[worktree.setup]\nsteps = ["false"]\n',
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout) as { message: string };
    assertStringIncludes(result.message, "worktree setup step failed");
    await assertNoStartDebris(dir, r.output);
  });
});

// ── the dirty-main advisory ──────────────────────────────────────────────────────

Deno.test("start on a dirty main checkout says the changes stay behind", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await Deno.writeTextFile(join(dir, "wip.txt"), "uncommitted\n");
    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as {
      data: { path: string };
      hints?: string[];
    };
    assertHasHint(result, HINTS["start-main-changes-stay"], {
      changes: 1,
      startPoint: "main",
    });
    assertEquals(
      await exists(join(result.data.path, "wip.txt")),
      false,
      "uncommitted main-checkout work must not follow the worktree",
    );
  });
});
