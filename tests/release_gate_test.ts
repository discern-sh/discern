/** Release authorization covers the exact source, trusted run, and every gate job. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { withTempDir } from "./temp_dir.ts";
import { fromFileUrl, join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import {
  type HostedGateRun,
  releaseGateDecision,
  verifyGateEvidence,
} from "../scripts/release_gate.ts";

const SOURCE = "a".repeat(40);
const POLICY = "b".repeat(40);
const REPOSITORY = "owner/project";
const workflowSource = await Deno.readTextFile(
  new URL("../.github/workflows/gate.yml", import.meta.url),
);
const gate = parseYaml(workflowSource) as {
  jobs: Record<
    string,
    {
      needs?: string[];
      steps?: { uses?: string; with?: Record<string, unknown> }[];
    }
  >;
};

/** Supply an independent run observation, with one fact varied by each case. */
function run(overrides: Partial<HostedGateRun> = {}): HostedGateRun {
  return {
    id: 1,
    head_sha: SOURCE,
    head_branch: "main",
    path: ".github/workflows/gate.yml",
    event: "push",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    head_repository: { full_name: REPOSITORY },
    ...overrides,
  };
}

/** Derive evidence membership from the workflow rather than copying its lane list. */
function evidence(): {
  sha: string;
  policy: string;
  needs: Record<string, { result: string }>;
} {
  return {
    sha: SOURCE,
    policy: POLICY,
    needs: Object.fromEntries(
      Object.keys(gate.jobs).filter((job) => job !== "evidence")
        .map((job) => [job, { result: "success" }]),
    ),
  };
}

Deno.test("release gates accept only exact-source trusted complete runs", () => {
  assertEquals(releaseGateDecision([], SOURCE, REPOSITORY), { kind: "start" });
  for (
    const override of [
      { head_sha: POLICY },
      { head_repository: { full_name: "other/project" } },
      { path: ".github/workflows/lookalike.yml" },
      { event: "pull_request" },
      { event: "push", head_branch: "other" },
    ]
  ) {
    assertEquals(releaseGateDecision([run(override)], SOURCE, REPOSITORY), {
      kind: "start",
    });
  }
  assertEquals(releaseGateDecision([run()], SOURCE, REPOSITORY).kind, "ready");
  assertEquals(
    releaseGateDecision(
      [run({ event: "workflow_dispatch", head_branch: "v1.2.3" })],
      SOURCE,
      REPOSITORY,
    ).kind,
    "ready",
  );
  for (const status of ["queued", "in_progress", "waiting"]) {
    assertEquals(
      releaseGateDecision(
        [run({ status, conclusion: null })],
        SOURCE,
        REPOSITORY,
      ).kind,
      "wait",
    );
  }
  for (
    const conclusion of [
      "failure",
      "cancelled",
      "skipped",
      "neutral",
      "timed_out",
      null,
    ]
  ) {
    assertEquals(
      releaseGateDecision([run({ conclusion })], SOURCE, REPOSITORY).kind,
      "blocked",
    );
  }
});

Deno.test("a newer failure or in-flight attempt supersedes an older success", () => {
  for (
    const newer of [
      run({ id: 2, conclusion: "failure" }),
      run({ id: 2, status: "queued" }),
    ]
  ) {
    const decision = releaseGateDecision([newer, run()], SOURCE, REPOSITORY);
    assert(decision.kind === "blocked" || decision.kind === "wait");
    assertEquals(decision.run.id, 2);
  }
  const retry = run({ run_attempt: 2 });
  assertEquals(releaseGateDecision([retry], SOURCE, REPOSITORY), {
    kind: "ready",
    run: retry,
  });
});

Deno.test("evidence binds every current and future gate job to success", () => {
  assertEquals(verifyGateEvidence(evidence(), SOURCE, workflowSource), POLICY);
  for (const job of Object.keys(evidence().needs)) {
    const missing = evidence();
    delete missing.needs[job];
    assertThrows(() => verifyGateEvidence(missing, SOURCE, workflowSource));
    for (const result of ["failure", "skipped", "cancelled"]) {
      const failed = evidence();
      failed.needs[job] = { result };
      assertThrows(() => verifyGateEvidence(failed, SOURCE, workflowSource));
    }
  }
  assertThrows(() =>
    verifyGateEvidence({ ...evidence(), sha: POLICY }, SOURCE, workflowSource)
  );
  assertThrows(() =>
    verifyGateEvidence(
      { ...evidence(), policy: "main" },
      SOURCE,
      workflowSource,
    )
  );
  const future = workflowSource +
    "\n  independent-check:\n    runs-on: ubuntu-24.04\n";
  assertThrows(() => verifyGateEvidence(evidence(), SOURCE, future));
  const complete = evidence();
  complete.needs["independent-check"] = { result: "success" };
  assertEquals(verifyGateEvidence(complete, SOURCE, future), POLICY);
});

Deno.test("gate evidence waits for every lane and remains attempt-specific", () => {
  const publisher = gate.jobs.evidence;
  assertEquals(
    [...(publisher?.needs ?? [])].sort(),
    Object.keys(evidence().needs).sort(),
  );
  const upload = publisher?.steps?.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@")
  );
  assertEquals(upload?.with?.name, "gate-evidence-${{ github.run_attempt }}");
});

Deno.test("release builds require verified evidence and completion resumes the tagged workflow", async () => {
  const source = await Deno.readTextFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
  );
  const release = parseYaml(source) as {
    jobs: Record<
      string,
      {
        if?: string;
        needs?: string | string[];
        steps: { id?: string; run?: string; if?: string }[];
      }
    >;
  };
  assertEquals(release.jobs.build?.if, "needs.plan.outputs.ready == 'true'");
  assertEquals(release.jobs.build?.needs, "plan");
  assertEquals(release.jobs.release?.needs, ["plan", "build"]);
  const plan = release.jobs.plan?.steps ?? [];
  const index = plan.findIndex((step) => step.id === "gate");
  assert(index >= 0);
  for (const step of plan.slice(index + 1)) {
    assertEquals(step.if, "steps.gate.outputs.ready == 'true'");
  }
  assert(!source.includes("uses: ./.github/actions/macos-gate"));
  assert(!source.includes("uses: ./.github/actions/wsl-gate"));
  const resume = await Deno.readTextFile(
    new URL("../.github/workflows/release-resume.yml", import.meta.url),
  );
  assert(resume.includes("types: [completed]"));
  assert(
    resume.includes(
      "github.event.workflow_run.head_repository.full_name == github.repository",
    ),
  );
  assert(resume.includes('scripts/release_gate.ts resume "$GATE_RUN"'));
});

/** Exercise the executable coordinator with controlled GitHub and Git boundaries. */
Deno.test("release coordination reuses, dispatches, and refuses without publishing", async () => {
  await withTempDir(async (root) => {
    const bin = join(root, "bin");
    await Deno.mkdir(bin);
    await Deno.mkdir(join(root, ".github/workflows"), { recursive: true });
    await Deno.writeTextFile(
      join(root, ".github/workflows/gate.yml"),
      workflowSource,
    );
    const artifact = join(root, "artifact.json");
    await Deno.writeTextFile(artifact, JSON.stringify(evidence()));
    const calls = join(root, "calls");
    const output = join(root, "output");
    const gh = join(bin, "gh");
    await Deno.writeTextFile(
      gh,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$RELEASE_CALLS"
case "$1 $2" in
  'api --paginate')
    case "$*" in
      */releases*) printf '%s' "$RELEASE_PUBLISHED" ;;
      *) printf '%s' "$RELEASE_RUNS" ;;
    esac ;;
  'api repos/'*) printf '%s' "$RELEASE_RUN" ;;
  'run download')
    while [ "$1" != '--dir' ]; do shift; done
    cp "$RELEASE_ARTIFACT" "$2/gate-evidence.json" ;;
  'workflow run') ;;
  *) exit 99 ;;
esac
`,
    );
    const git = join(bin, "git");
    await Deno.writeTextFile(
      git,
      `#!/bin/sh
case "$1" in
  rev-parse)
    case "$2" in
      HEAD) printf '%s' "\${RELEASE_CHECKOUT_SHA:-$RELEASE_SHA}" ;;
      *'^{commit}') printf '%s' "$RELEASE_SHA" ;;
      *) printf '%s' "$RELEASE_POLICY" ;;
    esac ;;
  merge-base) exit "\${RELEASE_ANCESTOR_STATUS:-0}" ;;
  tag) printf '%s' "$RELEASE_TAGS" ;;
  *) exit 99 ;;
esac
`,
    );
    await Deno.chmod(gh, 0o700);
    await Deno.chmod(git, 0o700);
    /** Run one state without retaining outputs from the preceding attempt. */
    const execute = async (
      runs: HostedGateRun[],
      mode = "request",
      extra: Record<string, string> = {},
    ): Promise<{ success: boolean; output: string; calls: string }> => {
      await Deno.writeTextFile(calls, "");
      await Deno.writeTextFile(output, "");
      const result = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          fromFileUrl(new URL("../scripts/release_gate.ts", import.meta.url)),
          mode,
          mode === "request" ? "v1.2.3" : "1",
          output,
        ],
        cwd: root,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          GH_REPO: REPOSITORY,
          RELEASE_GATE_RUN: "",
          RELEASE_CALLS: calls,
          RELEASE_ARTIFACT: artifact,
          RELEASE_RUNS: JSON.stringify([{ workflow_runs: runs }]),
          RELEASE_RUN: JSON.stringify(run()),
          RELEASE_PUBLISHED: "[[]]",
          RELEASE_TAGS: "v1.2.3",
          RELEASE_SHA: SOURCE,
          RELEASE_POLICY: POLICY,
          ...extra,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        success: result.success,
        output: await Deno.readTextFile(output),
        calls: await Deno.readTextFile(calls),
      };
    };
    const reused = await execute([run()]);
    assert(reused.success);
    assertEquals(reused.output, "ready=true\n");
    assert(reused.calls.includes("run download 1 --name gate-evidence-1"));
    assert(!reused.calls.includes("workflow run"));
    const started = await execute([]);
    assert(started.success);
    assertEquals(started.output, "ready=false\n");
    assert(
      started.calls.includes(
        `workflow run gate.yml --ref v1.2.3 -f policy_base=${POLICY}`,
      ),
    );
    for (
      const state of [
        run({ status: "in_progress", conclusion: null }),
        run({ conclusion: "failure" }),
      ]
    ) {
      const pending = await execute([state]);
      assertEquals(pending.success, state.status !== "completed");
      assertEquals(pending.output, "ready=false\n");
      assert(!pending.calls.includes("workflow run"));
    }
    for (
      const extra of [{ RELEASE_ANCESTOR_STATUS: "1" }, {
        RELEASE_GATE_RUN: "2",
      }]
    ) {
      const refused = await execute([run()], "request", extra);
      assert(!refused.success);
      assert(!refused.output.includes("ready=true"));
    }
    const resumed = await execute([run()], "resume");
    assert(resumed.success);
    assert(
      resumed.calls.includes(
        "workflow run release.yml --ref v1.2.3 -f gate_run=1",
      ),
    );
    const published = await execute([run()], "resume", {
      RELEASE_PUBLISHED: '[[{"tag_name":"v1.2.3","draft":false}]]',
    });
    assert(published.success);
    assert(!published.calls.includes("workflow run"));
    await Deno.writeTextFile(
      artifact,
      JSON.stringify({ ...evidence(), sha: POLICY }),
    );
    const mismatched = await execute([run()]);
    assert(!mismatched.success);
    assert(!mismatched.output.includes("ready=true"));
  });
});
