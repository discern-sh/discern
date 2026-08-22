/**
 * Exhaustive guards for the Agent Benefit Canon (ADR 0311). The feature tree
 * owns product identity; this transposition must give every feature exactly
 * one coding-agent role — direct value, supporting mechanism, or a reasoned
 * human-only absence. It also enrols every agent-only hint and every public
 * claim classified for coding agents or both audiences.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  AGENT_BENEFIT_CANON,
  AGENT_BENEFIT_COVERAGE_ABSENCES,
  AGENT_HINT_COVERAGE_ABSENCES,
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
  renderFeatureCanonAgentBenefitsDoc,
} from "../scripts/feature_registry.ts";
import { CLAIMS, type ClaimSlug } from "../scripts/brand/claims.ts";
import { KNOWN_VERBS } from "../src/engine/dispatch.ts";
import { HINTS } from "../src/shared/hints.ts";

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPLETE_SENTENCE = /[.!?]$/u;
const INSTRUCTION_SENTENCE =
  /^(?:Always|Ask|Await|Call|Check|Choose|Continue|Do|Follow|Invoke|Keep|Let|Never|Pass|Repeat|Report|Respond|Resume|Run|Start|Stop|Use|Wait|Watch)\b/;
const COMMAND_MENTION = /`discern ([a-z][a-z-]*)/g;

/** Extract backticked discern command names from one mechanism or boundary. */
function mentionedVerbs(text: string): string[] {
  return [...text.matchAll(COMMAND_MENTION)].map((match) => match[1] ?? "");
}

Deno.test("agent-benefit ids are unique across all three canons and every outcome field is complete", () => {
  const occupied = new Set([
    ...allFeatureNodes().map(({ node }) => node.id),
    ...allHumanBenefitEntries().flatMap(({ cluster, entry }) => [
      cluster.id,
      entry.id,
    ]),
  ]);
  const seen = new Set<string>();
  assert(AGENT_BENEFIT_CANON.length > 0, "the agent canon has clusters");
  for (const cluster of AGENT_BENEFIT_CANON) {
    assert(
      KEBAB.test(cluster.id),
      `cluster id is not kebab-case: ${cluster.id}`,
    );
    assert(!occupied.has(cluster.id), `cluster id collides: ${cluster.id}`);
    assert(!seen.has(cluster.id), `duplicate agent-benefit id: ${cluster.id}`);
    seen.add(cluster.id);
    assert(cluster.title.trim() !== "", `empty cluster title: ${cluster.id}`);
    assert(
      !cluster.title.endsWith("."),
      `cluster title has a period: ${cluster.id}`,
    );
    assert(
      COMPLETE_SENTENCE.test(cluster.promise.trim()),
      `cluster promise is not a complete sentence: ${cluster.id}`,
    );
    assert(
      cluster.benefits.length > 0,
      `empty agent-benefit cluster: ${cluster.id}`,
    );
    for (const entry of cluster.benefits) {
      assert(KEBAB.test(entry.id), `benefit id is not kebab-case: ${entry.id}`);
      assert(!occupied.has(entry.id), `agent benefit id collides: ${entry.id}`);
      assert(!seen.has(entry.id), `duplicate agent-benefit id: ${entry.id}`);
      seen.add(entry.id);
      assert(entry.title.trim() !== "", `empty title: ${entry.id}`);
      assert(!entry.title.endsWith("."), `title has a period: ${entry.id}`);
      for (
        const [field, sentence] of [
          ["value", entry.value],
          ["whyItFollows", entry.whyItFollows],
          ["boundary", entry.boundary],
        ] as const
      ) {
        assert(
          COMPLETE_SENTENCE.test(sentence.trim()),
          `${entry.id}.${field} is not a complete sentence`,
        );
      }
      assert(
        entry.value.includes("coding agent"),
        `${entry.id}.value does not identify the beneficiary as a coding agent`,
      );
      assert(
        entry.drawsOn.length + (entry.supportedBy?.length ?? 0) > 0,
        `${entry.id} cites no product basis`,
      );
    }
  }
});

Deno.test("agent values stay outcome-first instead of becoming commands or implementation inventories", () => {
  const offenders: string[] = [];
  for (const { entry } of allAgentBenefitEntries()) {
    if (entry.value.includes("`")) {
      offenders.push(`${entry.id}: value contains code markup`);
    }
    for (const sentence of entry.value.split(/(?<=[.!?])\s+/)) {
      if (INSTRUCTION_SENTENCE.test(sentence)) {
        offenders.push(`${entry.id}: imperative value sentence: ${sentence}`);
      }
    }
    if (
      /\b(?:JSON|MCP|schema|registry|stdio|TypeScript)\b/u.test(entry.value)
    ) {
      offenders.push(`${entry.id}: value leads with implementation vocabulary`);
    }
  }
  assertEquals(
    offenders,
    [],
    "Agent value states the coding-agent outcome; mechanisms and live hints own implementation and instructions",
  );
});

Deno.test("every feature node has exactly one global agent-benefit role", () => {
  const direct = new Map<string, string[]>();
  const supporting = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, id: string, home: string): void => {
    map.set(id, [...(map.get(id) ?? []), home]);
  };
  for (const { entry } of allAgentBenefitEntries()) {
    for (const id of entry.drawsOn) add(direct, id, entry.id);
    for (const id of entry.supportedBy ?? []) add(supporting, id, entry.id);
  }
  const featureRows = allFeatureNodes();
  const live = new Set(featureRows.map(({ node }) => node.id));
  const offenders: string[] = [];
  for (const { node } of featureRows) {
    const roles = Number(direct.has(node.id)) +
      Number(supporting.has(node.id)) +
      Number(Object.hasOwn(AGENT_BENEFIT_COVERAGE_ABSENCES, node.id));
    if (roles !== 1) {
      offenders.push(`${node.id}: expected one role, found ${roles}`);
    }
    if ((direct.get(node.id)?.length ?? 0) > 1) {
      offenders.push(
        `${node.id}: multiple direct homes ${direct.get(node.id)?.join(", ")}`,
      );
    }
    if ((supporting.get(node.id)?.length ?? 0) > 1) {
      offenders.push(
        `${node.id}: multiple supporting homes ${
          supporting.get(node.id)?.join(", ")
        }`,
      );
    }
  }
  for (const id of [...direct.keys(), ...supporting.keys()]) {
    if (!live.has(id)) offenders.push(`${id}: citation names no live feature`);
  }
  for (const [id, reason] of Object.entries(AGENT_BENEFIT_COVERAGE_ABSENCES)) {
    if (!live.has(id)) offenders.push(`${id}: absence names no live feature`);
    if (reason.trim() === "") offenders.push(`${id}: absence has no reason`);
  }
  assertEquals(
    offenders,
    [],
    `Agent Benefit Canon feature roles are incomplete or ambiguous:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("supporting roles are leaf infrastructure under a directly cited parent", () => {
  const flat = allFeatureNodes();
  const byId = new Map(flat.map(({ node }) => [node.id, node]));
  const parentById = new Map(flat.map(({ node, parent }) => [node.id, parent]));
  const direct = new Set(
    allAgentBenefitEntries().flatMap(({ entry }) => [...entry.drawsOn]),
  );
  const supporting = new Set(
    allAgentBenefitEntries().flatMap((
      { entry },
    ) => [...(entry.supportedBy ?? [])]),
  );
  assert(supporting.size > 0, "the direct/supporting distinction has members");
  for (const id of supporting) {
    const node = byId.get(id);
    const parent = parentById.get(id);
    assert(node !== undefined, `${id}: supporting role is live`);
    assertEquals(
      node.children ?? [],
      [],
      `${id}: supporting role must be a leaf`,
    );
    assert(parent !== undefined, `${id}: supporting role has no parent`);
    assert(direct.has(parent), `${id}: parent ${parent} is not a direct role`);
  }
});

Deno.test("every registered agent-only hint is cited or deliberately absent", () => {
  const homes = new Map<string, string[]>();
  for (const { entry } of allAgentBenefitEntries()) {
    for (const id of entry.hints ?? []) {
      homes.set(id, [...(homes.get(id) ?? []), entry.id]);
    }
  }
  const agentHints = Object.values(HINTS).filter((hint) =>
    hint.audience === "agent"
  );
  const agentIds = new Set(agentHints.map((hint) => hint.id));
  const offenders: string[] = [];
  for (const hint of agentHints) {
    const roles = Number(homes.has(hint.id)) +
      Number(Object.hasOwn(AGENT_HINT_COVERAGE_ABSENCES, hint.id));
    if (roles !== 1) {
      offenders.push(`${hint.id}: expected one role, found ${roles}`);
    }
  }
  for (const id of homes.keys()) {
    if (!agentIds.has(id)) {
      offenders.push(`${id}: cited hint is not agent-only`);
    }
  }
  for (const [id, reason] of Object.entries(AGENT_HINT_COVERAGE_ABSENCES)) {
    if (!agentIds.has(id)) {
      offenders.push(`${id}: absence is not an agent-only hint`);
    }
    if (reason.trim() === "") {
      offenders.push(`${id}: hint absence has no reason`);
    }
  }
  assertEquals(
    offenders,
    [],
    `Agent-only hint coverage is incomplete or stale:\n${offenders.join("\n")}`,
  );
});

Deno.test("every coding-agent or shared public claim has an agent-benefit home", () => {
  const homes = new Map<ClaimSlug, string[]>();
  for (const { entry } of allAgentBenefitEntries()) {
    for (const slug of entry.claims ?? []) {
      homes.set(slug, [...(homes.get(slug) ?? []), entry.id]);
    }
  }
  const offenders: string[] = [];
  for (const [slug, claim] of Object.entries(CLAIMS)) {
    const carried = homes.has(slug as ClaimSlug);
    if (claim.audience === "human" && carried) {
      offenders.push(`${slug}: human-only claim appears in the agent canon`);
    }
    if (claim.audience !== "human" && !carried) {
      offenders.push(
        `${slug}: ${claim.audience} claim has no agent-benefit home`,
      );
    }
  }
  for (const slug of homes.keys()) {
    if (!Object.hasOwn(CLAIMS, slug)) {
      offenders.push(`${slug}: no live public claim`);
    }
  }
  assertEquals(
    offenders,
    [],
    `Agent and shared claim coverage is incomplete or stale:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("commands in agent mechanisms and boundaries name live verbs", () => {
  for (const { entry } of allAgentBenefitEntries()) {
    for (const text of [entry.whyItFollows, entry.boundary]) {
      for (const verb of mentionedVerbs(text)) {
        assert(
          KNOWN_VERBS.has(verb),
          `${entry.id} mentions \`discern ${verb}\`, which is not a live verb`,
        );
      }
    }
  }
});

Deno.test("the rendered Agent Benefit Canon carries every outcome, boundary, and traceability appendix", () => {
  const doc = renderFeatureCanonAgentBenefitsDoc();
  assertStringIncludes(doc, "<!-- GENERATED by `deno task codegen`");
  assertStringIncludes(doc, "# Agent Benefit Canon");
  assertStringIncludes(doc, "## Coverage and traceability");
  assertStringIncludes(doc, "### Agent-hint homes");
  assertStringIncludes(doc, "### Agent and shared claim homes");
  for (const cluster of AGENT_BENEFIT_CANON) {
    assertStringIncludes(doc, `## ${cluster.title}`);
  }
  for (const { entry } of allAgentBenefitEntries()) {
    assertStringIncludes(doc, `### ${entry.title}`);
    assertStringIncludes(doc, `* **Agent value:** ${entry.value}`);
    assertStringIncludes(doc, `* **Boundary:** ${entry.boundary}`);
  }
});
