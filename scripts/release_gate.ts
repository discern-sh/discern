/** Select and verify complete hosted gate evidence before publishing a tag. */
import { z } from "@zod/zod";
import { parse as parseYaml } from "@std/yaml";
import { join } from "@std/path";
import type { EnvReader } from "../src/shared/env.ts";
import { runReleaseCommand } from "./release_command.ts";
import { withToolTempDir } from "./temp_dir.ts";

const SHA = z.string().regex(/^[a-f0-9]{40}$/u);
const RunSchema = z.object({
  id: z.number().int().positive(),
  head_sha: SHA,
  head_branch: z.string(),
  path: z.string(),
  event: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  run_attempt: z.number().int().positive(),
  head_repository: z.object({ full_name: z.string() }),
});
export type HostedGateRun = z.infer<typeof RunSchema>;
const RunsSchema = z.array(z.object({ workflow_runs: z.array(RunSchema) }));
const NeedsSchema = z.record(
  z.string(),
  z.object({ result: z.string() }).passthrough(),
);
const EvidenceSchema = z.object({ sha: SHA, policy: SHA, needs: NeedsSchema });
const WorkflowSchema = z.object({ jobs: z.record(z.string(), z.unknown()) });

export type ReleaseGateDecision =
  | { kind: "start" }
  | { kind: "wait" | "blocked" | "ready"; run: HostedGateRun };

/** Only the newest trusted non-PR attempt for this exact source may authorize release. */
export function releaseGateDecision(
  runs: readonly HostedGateRun[],
  sha: string,
  repository: string,
): ReleaseGateDecision {
  const run = runs.filter((candidate) =>
    candidate.head_sha === sha &&
    candidate.head_repository.full_name === repository &&
    candidate.path === ".github/workflows/gate.yml" &&
    ((candidate.event === "push" && candidate.head_branch === "main") ||
      candidate.event === "workflow_dispatch")
  ).sort((a, b) => b.id - a.id)[0];
  if (run === undefined) return { kind: "start" };
  if (run.status !== "completed") return { kind: "wait", run };
  return { kind: run.conclusion === "success" ? "ready" : "blocked", run };
}

/** Every gate job except the evidence publisher must be present and successful. */
export function verifyGateEvidence(
  input: unknown,
  sha: string,
  workflowSource: string,
): string {
  const evidence = EvidenceSchema.parse(input);
  if (evidence.sha !== sha) {
    throw new Error("Gate evidence names another commit.");
  }
  const workflow = WorkflowSchema.parse(parseYaml(workflowSource));
  const required = Object.keys(workflow.jobs).filter((job) =>
    job !== "evidence"
  ).sort();
  const actual = Object.keys(evidence.needs).sort();
  if (required.length === 0 || required.join("\n") !== actual.join("\n")) {
    throw new Error("Gate evidence does not cover every declared gate job.");
  }
  for (const job of required) {
    if (evidence.needs[job]?.result !== "success") {
      throw new Error(`Gate job ${job} did not succeed.`);
    }
  }
  return evidence.policy;
}

/** Run Git or GitHub with argument boundaries intact and retain actionable diagnostics. */
async function command(program: string, args: string[]): Promise<string> {
  return (await runReleaseCommand(program, args)).stdout.trim();
}

/** Fetch all attempts returned by the exact workflow and commit query. */
async function gateRuns(
  repository: string,
  sha: string,
): Promise<HostedGateRun[]> {
  const body = await command("gh", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repository}/actions/workflows/gate.yml/runs?head_sha=${sha}&per_page=100`,
  ]);
  return RunsSchema.parse(JSON.parse(body)).flatMap((page) =>
    page.workflow_runs
  );
}

/** Verify the current attempt's artifact and its immutable ancestor policy. */
async function verifyRun(run: HostedGateRun, sha: string): Promise<void> {
  await withToolTempDir("release-gate", async (root) => {
    await command("gh", [
      "run",
      "download",
      String(run.id),
      "--name",
      `gate-evidence-${run.run_attempt}`,
      "--dir",
      root,
    ]);
    const policy = verifyGateEvidence(
      JSON.parse(await Deno.readTextFile(join(root, "gate-evidence.json"))),
      sha,
      await Deno.readTextFile(".github/workflows/gate.yml"),
    );
    await command("git", ["merge-base", "--is-ancestor", policy, sha]);
    console.log(
      `Gate ${run.id}, attempt ${run.run_attempt}, passed for ${sha}; policy ${policy}.`,
    );
  });
}

/** A release always resolves an actual version tag to its peeled commit. */
async function tagCommit(tag: string): Promise<string> {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error("Release requires a version tag.");
  }
  return SHA.parse(
    await command("git", ["rev-parse", `refs/tags/${tag}^{commit}`]),
  );
}

/** Inspect or request evidence; a waiting release exits without building or publishing. */
async function requestRelease(
  repository: string,
  tag: string,
  output: string | undefined,
  requestedRun: string | undefined,
): Promise<void> {
  const sha = await tagCommit(tag);
  if (await command("git", ["rev-parse", "HEAD"]) !== sha) {
    throw new Error(
      "The checkout does not match the release tag. Dispatch on the tag.",
    );
  }
  const decision = releaseGateDecision(
    await gateRuns(repository, sha),
    sha,
    repository,
  );
  if (!output) throw new Error("The workflow output file is required.");
  if (decision.kind === "ready") {
    if (requestedRun && requestedRun !== String(decision.run.id)) {
      throw new Error(
        "A newer gate attempt supersedes the requested release evidence.",
      );
    }
    await verifyRun(decision.run, sha);
    await Deno.writeTextFile(output, "ready=true\n", { append: true });
    return;
  }
  await Deno.writeTextFile(output, "ready=false\n", { append: true });
  if (decision.kind === "start") {
    const policy = SHA.parse(await command("git", ["rev-parse", `${sha}^`]));
    await command("gh", [
      "workflow",
      "run",
      "gate.yml",
      "--ref",
      tag,
      "-f",
      `policy_base=${policy}`,
    ]);
    console.log(
      `Requested the complete gate for ${tag} at ${sha}. Publication resumes after success.`,
    );
  } else if (decision.kind === "wait") {
    console.log(
      `Waiting for gate ${decision.run.id}; its completion will resume ${tag}.`,
    );
  } else {
    throw new Error(
      `Gate ${decision.run.id} failed or was cancelled. Retry that gate; ${tag} remains unpublished.`,
    );
  }
}

/** A successful trusted gate resumes only unpublished tags on its exact commit. */
async function resumeRelease(repository: string, runId: string): Promise<void> {
  if (!/^\d+$/u.test(runId)) {
    throw new Error("A numeric gate run id is required.");
  }
  const run = RunSchema.parse(
    JSON.parse(
      await command("gh", ["api", `repos/${repository}/actions/runs/${runId}`]),
    ),
  );
  const decision = releaseGateDecision(
    await gateRuns(repository, run.head_sha),
    run.head_sha,
    repository,
  );
  if (decision.kind !== "ready" || decision.run.id !== run.id) return;
  const published = z.array(
    z.array(z.object({ tag_name: z.string(), draft: z.boolean() })),
  )
    .parse(
      JSON.parse(
        await command("gh", [
          "api",
          "--paginate",
          "--slurp",
          `repos/${repository}/releases?per_page=100`,
        ]),
      ),
    ).flat();
  const tags =
    (await command("git", ["tag", "--points-at", run.head_sha, "--list", "v*"]))
      .split("\n").filter(Boolean);
  for (const tag of tags) {
    if (
      published.some((release) => release.tag_name === tag && !release.draft)
    ) continue;
    if (await tagCommit(tag) !== run.head_sha) continue;
    await command("gh", [
      "workflow",
      "run",
      "release.yml",
      "--ref",
      tag,
      "-f",
      `gate_run=${run.id}`,
    ]);
  }
}

/** Resolve workflow environment once at the executable boundary. */
async function main(env: EnvReader = Deno.env): Promise<void> {
  const repository = env.get("GH_REPO");
  const [mode, subject, output] = Deno.args;
  if (!repository || !subject) {
    throw new Error("Repository, mode, and subject are required.");
  }
  if (mode === "request") {
    await requestRelease(
      repository,
      subject,
      output,
      env.get("RELEASE_GATE_RUN"),
    );
  } else if (mode === "resume") await resumeRelease(repository, subject);
  else throw new Error("Mode must be request or resume.");
}

if (import.meta.main) await main();
