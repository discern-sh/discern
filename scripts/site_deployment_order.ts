/** Refuse a website source that would roll back any successful production source. */
import { z } from "@zod/zod";
import type { EnvReader } from "../src/shared/env.ts";
import { runReleaseCommand } from "./release_command.ts";

const DeploymentsSchema = z.array(z.array(z.object({
  id: z.number().int().positive(),
  sha: z.string().regex(/^[a-f0-9]{40}$/u),
})));
const StatusesSchema = z.array(z.array(z.object({ state: z.string() })));

/** Check every successful source; ordering and inactive status cannot hide a rollback. */
export async function verifySiteDeploymentOrder(
  repository: string,
  source: string,
  command: (program: string, args: string[]) => Promise<{ stdout: string }> =
    runReleaseCommand,
): Promise<void> {
  z.string().regex(/^[a-f0-9]{40}$/u).parse(source);
  const query = async (path: string): Promise<unknown> =>
    JSON.parse(
      (await command("gh", [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/${path}`,
      ])).stdout,
    );
  const deployments = DeploymentsSchema.parse(
    await query("deployments?environment=production&per_page=100"),
  ).flat();
  const checked = new Set<string>();
  for (const deployment of deployments) {
    if (checked.has(deployment.sha)) continue;
    const statuses = StatusesSchema.parse(
      await query(`deployments/${deployment.id}/statuses?per_page=100`),
    ).flat();
    if (!statuses.some((status) => status.state === "success")) continue;
    await command("git", [
      "merge-base",
      "--is-ancestor",
      deployment.sha,
      source,
    ]);
    checked.add(deployment.sha);
  }
}

/** Observe environment history only inside the serialized production job. */
async function main(env: EnvReader = Deno.env): Promise<void> {
  const repository = env.get("GH_REPO");
  const source = Deno.args[0];
  if (!repository || !source) {
    throw new Error("Repository and source SHA are required.");
  }
  await verifySiteDeploymentOrder(repository, source);
}

if (import.meta.main) await main();
