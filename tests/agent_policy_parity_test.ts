/**
 * Policy parity guard for the two authored operating-model surfaces: the
 * bundled guidance templates (compiled into every project's agent files) and
 * the MCP server's instructions block. The two are deliberately redundant —
 * MCP instructions reach clients that never read an agent file — but they
 * are authored independently, and independent authorship drifts: the same
 * policy was already worded three different ways across surfaces before this
 * guard existed.
 *
 * The canonical set lives in `operating_policies.ts` (ADR 0181). MCP
 * instructions render its statements; guidance remains authored Markdown
 * verified by the same entries' probes. A generalization of the acceptance
 * anti-pattern scan in `agent_acceptance_instruction_test.ts`, which bans
 * wrong phrasings; this asserts the right ones exist.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { buildInstructions, TOOLS } from "../src/engine/mcp/server.ts";
import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import { type HintDef, HINTS } from "../src/shared/hints.ts";
import {
  OPERATING_POLICIES,
  OPERATING_POLICY_SURFACES,
  type OperatingPolicy,
  type OperatingPolicySurface,
} from "../src/shared/operating_policies.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** The bundled guidance templates as one searchable blob (source text, so
 * conditional sections are always present). */
async function guidanceBlob(): Promise<string> {
  const dir = join(REPO_ROOT, "templates", "guidance");
  const parts: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".md")) {
      parts.push(await Deno.readTextFile(join(dir, entry.name)));
    }
  }
  assert(parts.length > 0, "no guidance templates found — check the scan set");
  return parts.join("\n");
}

interface PolicySurfaceText {
  readonly label: string;
  readonly text: string;
  readonly rendered: boolean;
}

/** Check policy identifiers, statements, probes, and enrolled surfaces for registry contradictions. */
function registryFailures(
  policies: readonly OperatingPolicy[],
): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();
  const requiredSurfaces = [...OPERATING_POLICY_SURFACES].sort();
  for (const policy of policies) {
    if (ids.has(policy.id)) {
      failures.push(`duplicate operating policy id: ${policy.id}`);
    }
    ids.add(policy.id);
    if (policy.statement.trim().length === 0) {
      failures.push(`${policy.id}: empty statement`);
    }
    if (policy.probes.length === 0) {
      failures.push(`${policy.id}: no fidelity probes`);
    }
    const actualSurfaces = [...new Set(policy.surfaces)].sort();
    if (
      actualSurfaces.length !== requiredSurfaces.length ||
      actualSurfaces.some(
        (surface, index) => surface !== requiredSurfaces[index],
      )
    ) {
      failures.push(
        `${policy.id}: every core policy must name both authored surfaces`,
      );
    }
    for (const probe of policy.probes) {
      if (!new RegExp(probe).test(policy.statement)) {
        failures.push(
          `${policy.id}: canonical statement fails its own probe ${probe}`,
        );
      }
    }
  }
  return failures;
}

/** Prove every enrolled surface renders each policy statement and its semantic probes. */
function parityFailures(
  policies: readonly OperatingPolicy[],
  surfaces: Readonly<Record<OperatingPolicySurface, PolicySurfaceText>>,
): string[] {
  const failures: string[] = [];
  for (const policy of policies) {
    for (const surfaceId of policy.surfaces) {
      const surface = surfaces[surfaceId];
      if (surface.rendered && !surface.text.includes(policy.statement)) {
        failures.push(
          `${policy.id} is not rendered verbatim on ${surface.label}`,
        );
      }
      for (const probe of policy.probes) {
        if (!new RegExp(probe).test(surface.text)) {
          failures.push(
            `${policy.id} missing from ${surface.label} (probe ${probe})`,
          );
        }
      }
    }
  }
  return failures;
}

const AWAIT_CALLING_REQUIREMENTS = [
  {
    meaning: "active calls stay off the chat",
    pattern: /do not surface progress updates until it returns/i,
  },
  {
    meaning: "unmet continuations stay off the chat",
    pattern: /continue with `data\.resume` without surfacing an update/i,
  },
  {
    meaning: "only terminal states are reported",
    pattern: /Report only when the condition holds/,
  },
  {
    meaning: "direct user input still gets a response",
    pattern: /Always respond to new user input/,
  },
] as const;

/** Report await instructions that omit a required persistence or recovery contract. */
function awaitCallingFailures(
  surfaces: readonly { readonly label: string; readonly text: string }[],
): string[] {
  const failures: string[] = [];
  for (const surface of surfaces) {
    for (const requirement of AWAIT_CALLING_REQUIREMENTS) {
      if (!requirement.pattern.test(surface.text)) {
        failures.push(`${surface.label} missing: ${requirement.meaning}`);
      }
    }
  }
  return failures;
}

const WORKTREE_OWNERSHIP_REQUIREMENTS = [
  {
    meaning: "the effort that created a worktree keeps it",
    pattern: /only if this effort created it/i,
  },
  {
    meaning: "review feedback keeps the assignment",
    pattern: /review feedback/i,
  },
  {
    meaning: "resumed sessions keep the assignment",
    pattern: /resumed sessions/i,
  },
  {
    meaning: "another effort's worktree stays off limits",
    pattern: /another effort/i,
  },
] as const;

interface NamedText {
  readonly label: string;
  readonly text: string;
}

function policyRequirements(id: string): readonly {
  readonly meaning: string;
  readonly pattern: RegExp;
}[] {
  const policy = OPERATING_POLICIES.find((candidate) => candidate.id === id);
  if (policy === undefined) {
    throw new Error(`missing operating policy: ${id}`);
  }
  return policy.probes.map((pattern) => ({
    meaning: `${id} policy probe ${pattern}`,
    pattern,
  }));
}

function requirementFailures(
  requirements: readonly {
    readonly meaning: string;
    readonly pattern: RegExp;
  }[],
  surfaces: readonly NamedText[],
): string[] {
  const failures: string[] = [];
  for (const surface of surfaces) {
    for (const requirement of requirements) {
      if (!requirement.pattern.test(surface.text)) {
        failures.push(`${surface.label} missing: ${requirement.meaning}`);
      }
    }
  }
  return failures;
}

function renderedHintSurfaces(
  predicate: (hint: HintDef<unknown>) => boolean,
): NamedText[] {
  const definitions = Object.values(HINTS) as unknown as readonly HintDef<
    unknown
  >[];
  return definitions.filter(predicate).map((hint) => ({
    label: `hint ${hint.id}`,
    text: renderCommandRefsCli(hint.template(hint.example)),
  }));
}

Deno.test("the operating-policy registry is complete and self-consistent", () => {
  assertEquals(registryFailures(OPERATING_POLICIES), []);
});

Deno.test("both operating-model surfaces carry every registered policy", async () => {
  const surfaces: Record<OperatingPolicySurface, PolicySurfaceText> = {
    "guidance-templates": {
      label: "templates/guidance",
      text: await guidanceBlob(),
      rendered: false,
    },
    "mcp-instructions": {
      label: "mcp server instructions",
      text: buildInstructions(),
      rendered: true,
    },
  };
  const failures = parityFailures(OPERATING_POLICIES, surfaces);
  assertEquals(
    failures,
    [],
    "every registered policy must appear on every declared surface — restore " +
      "the wording, or update the statement and probe as one policy change:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("await calling surfaces keep active calls and unmet continuations off the chat", async () => {
  const policy = OPERATING_POLICIES.find((candidate) =>
    candidate.id === "await-longest-safe"
  );
  assert(
    policy !== undefined,
    "the await operating policy must remain registered",
  );
  const tool = TOOLS.find((candidate) => candidate.name === "discern_await");
  assert(tool !== undefined, "the await MCP tool must remain registered");
  const surfaces = [
    { label: "canonical await policy", text: policy.statement },
    { label: "bundled guidance", text: await guidanceBlob() },
    { label: "MCP instructions", text: buildInstructions() },
    { label: "await MCP tool", text: tool.description },
  ];
  assertEquals(
    awaitCallingFailures(surfaces),
    [],
    "every surface used by the calling agent must carry the await reporting contract",
  );
});

Deno.test("every worktree-entry surface keeps follow-up turns in the effort's existing worktree", async () => {
  const tool = TOOLS.find((candidate) => candidate.name === "discern_start");
  assert(tool !== undefined, "the start MCP tool must remain registered");
  const hintSurfaces = renderedHintSurfaces((hint) =>
    hint.family === "status-start-here" ||
    hint.followThrough?.family === "main-worktree-first" ||
    hint.id === "start-re-root" ||
    hint.id === "start-mcp-re-root"
  );
  assertEquals(
    hintSurfaces.map((surface) => surface.label).sort(),
    [
      "hint ensure-main-worktree-first",
      "hint start-mcp-re-root",
      "hint start-re-root",
      "hint status-start-off-trunk",
      "hint status-start-on-trunk",
    ],
    "the detector must cover every current entry and re-root hint",
  );
  const surfaces = [
    { label: "bundled guidance", text: await guidanceBlob() },
    { label: "MCP instructions", text: buildInstructions() },
    { label: "start MCP tool", text: tool.description },
    ...hintSurfaces,
  ];
  const failures = requirementFailures(
    policyRequirements("worktree-continuity"),
    surfaces,
  );
  assertEquals(
    failures,
    [],
    "a main-rooted follow-up must be told to resume its recorded worktree before any surface suggests a fresh one:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("control: worktree-continuity detector rejects renamed fresh-start advice", () => {
  const requirements = policyRequirements("worktree-continuity");
  const failures = requirementFailures(requirements, [
    {
      label: "future checkout launcher",
      text:
        "From the central checkout, run launch_branch to create a task checkout. Every listed checkout belongs to somebody else.",
    },
  ]);
  assertEquals(failures.length, requirements.length);
  assert(
    failures.every((failure) =>
      failure.startsWith("future checkout launcher missing:")
    ),
  );
});

Deno.test("fleet ownership distinguishes this effort's worktree from another effort's", () => {
  const surfaces = renderedHintSurfaces((hint) =>
    hint.id === "fleet-ownership"
  );
  assertEquals(surfaces.map((surface) => surface.label), [
    "hint fleet-ownership",
  ]);
  const failures = requirementFailures(
    WORKTREE_OWNERSHIP_REQUIREMENTS,
    surfaces,
  );
  assertEquals(
    failures,
    [],
    "the fleet rule must preserve ownership across turns without making every existing worktree foreign:\n  " +
      failures.join("\n  "),
  );
});

Deno.test("control: await calling detector rejects renamed heartbeat guidance", () => {
  const failures = awaitCallingFailures([
    {
      label: "future wait",
      text:
        "Use future_wait for one long call. Do not shorten it for progress reports. Resume a not-met result.",
    },
  ]);
  assertEquals(failures.length, AWAIT_CALLING_REQUIREMENTS.length);
  assert(
    failures.every((failure) => failure.startsWith("future wait missing:")),
  );
});

const CONTROL_POLICY: OperatingPolicy = {
  id: "future-policy",
  statement: "Carry the future-policy marker.",
  surfaces: OPERATING_POLICY_SURFACES,
  probes: [/future-policy marker/],
};

Deno.test("control: a statement changed away from its probe fails the registry", () => {
  assertEquals(
    registryFailures([
      { ...CONTROL_POLICY, statement: "A rewritten statement." },
    ]),
    [
      "future-policy: canonical statement fails its own probe /future-policy marker/",
    ],
  );
});

Deno.test("control: a future policy carried by only one surface fails parity", () => {
  assertEquals(
    parityFailures(
      [CONTROL_POLICY],
      {
        "guidance-templates": {
          label: "templates/guidance",
          text: "",
          rendered: false,
        },
        "mcp-instructions": {
          label: "mcp server instructions",
          text: CONTROL_POLICY.statement,
          rendered: true,
        },
      },
    ),
    [
      "future-policy missing from templates/guidance (probe /future-policy marker/)",
    ],
  );
});
