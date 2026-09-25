/** Every caller of a reusable workflow delivers the secrets that workflow reads. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { z } from "@zod/zod";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const LOCAL_WORKFLOW = "./.github/workflows/";
/** GitHub mints this token for every job, including jobs in a called workflow. */
const MINTED_SECRETS = new Set(["GITHUB_TOKEN"]);
const SECRET_READ = /\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g;

const WorkflowSchema = z.object({
  on: z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.string(), z.unknown()),
  ]),
  jobs: z.record(
    z.string(),
    z.object({
      uses: z.string().optional(),
      secrets: z.union([
        z.literal("inherit"),
        z.record(z.string(), z.unknown()),
      ]).optional(),
    }).passthrough(),
  ),
}).passthrough();
const CallTriggerSchema = z.object({
  secrets: z.record(z.string(), z.unknown()).optional(),
}).passthrough().nullable();

type Workflow = z.infer<typeof WorkflowSchema>;

interface ReusableContract {
  /** Secret names the workflow reads, apart from the minted run token. */
  readonly reads: readonly string[];
  /** Secret names declared under `on.workflow_call.secrets`. */
  readonly declared: ReadonlySet<string>;
}

/** Locate a `workflow_call` trigger and its body in any trigger syntax. */
function callTrigger(on: Workflow["on"]): { found: boolean; body: unknown } {
  if (typeof on === "string") {
    return { found: on === "workflow_call", body: null };
  }
  if (Array.isArray(on)) {
    return { found: on.includes("workflow_call"), body: null };
  }
  return { found: "workflow_call" in on, body: on["workflow_call"] ?? null };
}

/** Describe what a reusable workflow needs from its callers. */
function reusableContract(
  workflow: Workflow,
  source: string,
): ReusableContract | undefined {
  const trigger = callTrigger(workflow.on);
  if (!trigger.found) return undefined;
  const declared = CallTriggerSchema.parse(trigger.body)?.secrets ?? {};
  const reads = new Set(
    [...source.matchAll(SECRET_READ)].flatMap((match) =>
      match[1] === undefined || MINTED_SECRETS.has(match[1]) ? [] : [match[1]]
    ),
  );
  return {
    reads: [...reads].sort(),
    declared: new Set(Object.keys(declared)),
  };
}

/**
 * Name each local reusable-workflow call that withholds a secret the workflow
 * reads. A called workflow sees only what its caller passes, even for a job
 * that names an environment; `secrets: inherit` passes everything.
 */
function undeliveredWorkflowSecrets(
  sources: ReadonlyMap<string, string>,
): string[] {
  const workflows = new Map<string, Workflow>();
  const contracts = new Map<string, ReusableContract>();
  for (const [rel, source] of sources) {
    const workflow = WorkflowSchema.parse(parseYaml(source));
    workflows.set(rel, workflow);
    const contract = reusableContract(workflow, source);
    if (contract !== undefined) contracts.set(rel, contract);
  }
  const failures: string[] = [];
  for (const [rel, workflow] of workflows) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (!job.uses?.startsWith(LOCAL_WORKFLOW)) continue;
      const called = `.github/workflows/${
        job.uses.slice(LOCAL_WORKFLOW.length)
      }`;
      const contract = contracts.get(called);
      if (contract === undefined) {
        failures.push(
          `${rel} job ${id} calls ${called}, which declares no workflow_call trigger`,
        );
        continue;
      }
      if (job.secrets === "inherit") continue;
      const passed = new Set(Object.keys(job.secrets ?? {}));
      for (const name of contract.reads) {
        if (!passed.has(name)) {
          failures.push(
            `${rel} job ${id} calls ${called}, which reads secrets.${name}, without passing it; add \`secrets: inherit\``,
          );
        } else if (!contract.declared.has(name)) {
          failures.push(
            `${called} reads secrets.${name} from ${rel} job ${id} without declaring it under on.workflow_call.secrets`,
          );
        }
      }
    }
  }
  return failures;
}

Deno.test("every reusable workflow receives the secrets it reads", async () => {
  const files = await structuralGuardScope({
    guard: "tests/workflow_secrets_test.ts#reusable-workflow-secrets",
    universe: "authored-text",
    narrow: {
      reason:
        "Secret delivery binds every GitHub workflow caller to the reusable workflow it runs.",
      include: (rel) =>
        rel.startsWith(".github/workflows/") && /\.ya?ml$/.test(rel),
    },
  });
  const sources = new Map<string, string>();
  for (const rel of files) {
    sources.set(rel, await Deno.readTextFile(join(REPO_ROOT, rel)));
  }
  assertEquals(undeliveredWorkflowSecrets(sources), []);
});

Deno.test("a future reusable workflow call auto-enrols in the secrets guard", () => {
  const publisher = `on:
  workflow_call:
jobs:
  deploy:
    environment: production
    runs-on: ubuntu-24.04
    steps:
      - run: deploy
        env:
          TOKEN: \${{ secrets.TOKEN }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
  const declared = `on:
  workflow_call:
    secrets:
      TOKEN:
        required: true
jobs:
  deploy:
    runs-on: ubuntu-24.04
    steps:
      - run: deploy \${{ secrets.TOKEN }}
`;
  const caller = (target: string, secrets: string): string =>
    `on: push
jobs:
  publish:
    uses: ./.github/workflows/${target}${secrets}
`;
  const named = "\n    secrets:\n      TOKEN: x";
  const sources = new Map([
    [".github/workflows/publisher.yml", publisher],
    [".github/workflows/declared.yml", declared],
    [".github/workflows/silent.yml", caller("publisher.yml", "")],
    [
      ".github/workflows/inherits.yml",
      caller("publisher.yml", "\n    secrets: inherit"),
    ],
    [".github/workflows/named.yml", caller("publisher.yml", named)],
    [".github/workflows/declared-caller.yml", caller("declared.yml", named)],
    [".github/workflows/stray.yml", caller("silent.yml", "")],
  ]);
  assertEquals(undeliveredWorkflowSecrets(sources), [
    ".github/workflows/silent.yml job publish calls .github/workflows/publisher.yml, which reads secrets.TOKEN, without passing it; add `secrets: inherit`",
    ".github/workflows/publisher.yml reads secrets.TOKEN from .github/workflows/named.yml job publish without declaring it under on.workflow_call.secrets",
    ".github/workflows/stray.yml job publish calls .github/workflows/silent.yml, which declares no workflow_call trigger",
  ]);
});
