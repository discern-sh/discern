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

const AWAIT_REPORTING_REQUIREMENTS = [
  "do not surface progress updates until it returns",
  "continue with `data.resume` without surfacing an update",
  "Report only when the condition holds",
  "Always respond to new user input",
] as const;

function awaitReportingFailures(
  surfaces: readonly { readonly label: string; readonly text: string }[],
): string[] {
  const failures: string[] = [];
  for (const surface of surfaces) {
    for (const requirement of AWAIT_REPORTING_REQUIREMENTS) {
      if (!surface.text.includes(requirement)) {
        failures.push(`${surface.label} missing: ${requirement}`);
      }
    }
  }
  return failures;
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

Deno.test("await policy keeps active calls and unmet continuations off the chat", async () => {
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
    {
      label: "delegate-work skill",
      text: await Deno.readTextFile(
        join(
          REPO_ROOT,
          "templates",
          "skills",
          "discern-delegate-work",
          "SKILL.md",
        ),
      ),
    },
    {
      label: "feature canon source",
      text: await Deno.readTextFile(
        join(REPO_ROOT, "scripts", "feature_registry.ts"),
      ),
    },
  ];
  assertEquals(
    awaitReportingFailures(surfaces),
    [],
    "every await policy surface must suppress active-call and continuation updates",
  );
});

Deno.test("control: await reporting detector rejects renamed heartbeat guidance", () => {
  const failures = awaitReportingFailures([
    {
      label: "future wait",
      text:
        "Use future_wait for one long call. Do not shorten it for progress reports. Resume a not-met result.",
    },
  ]);
  assertEquals(failures.length, AWAIT_REPORTING_REQUIREMENTS.length);
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
