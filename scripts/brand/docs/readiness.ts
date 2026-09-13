/** Render the question and feature views from the same Readiness relationships. */
import { relative } from "@std/path/posix";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
} from "../../feature_registry.ts";
import { PRACTICE_CANON } from "../../practice_registry.ts";

import {
  canonLink,
  READINESS_CANON,
  READINESS_ROUTES,
  type ReadinessFamily,
  readinessForFeature,
} from "../readiness.ts";

/** Fail at generation when a route outlives the canon member it cites. */
function requiredTitle(
  titles: ReadonlyMap<string, string>,
  id: string,
): string {
  const title = titles.get(id);
  if (title === undefined) {
    throw new Error(`Readiness cites unknown canon member: ${id}`);
  }
  return title;
}

/** The brand registry stamps provenance and resolves the shared claim tokens. */
export function renderReadinessCanonDoc(
  families: readonly ReadinessFamily[] = READINESS_CANON,
): string {
  const features = new Map(
    allFeatureNodes().map(({ node }) => [node.id, node.title]),
  );
  const human = new Map(
    allHumanBenefitEntries().map(({ entry }) => [entry.id, entry.title]),
  );
  const agentEntries = allAgentBenefitEntries();
  const agent = new Map(
    agentEntries.map(({ entry }) => [entry.id, entry.title]),
  );
  const lines = [
    "# Readiness canon",
    "",
    "People start depending on your software, and the next release matters in a new way. Will their work still open? Can they recover from a mistake? Have we checked the other places this change reaches?",
    "",
    "These questions belong to engineering practice whether a team or a coding agent carries the implementation. discern gives them a home in the project: checks that run, judgments that get asked, methods agents inherit, and evidence that returns with the work. The person can bring more of their experience to more of what gets built.",
    "",
    "Readiness is the practical expression of Consequential Code. It asks whether a change is fit for its intended next step, what supports that conclusion, and what still needs attention. The {{doc:positioning}} keeps the larger ambition; this canon connects recognizable questions to the practice that helps answer them.",
    "",
    "## How to use the questions",
    "",
    "Start with the purpose and the people the change serves. Select the concerns it raises, then follow a question to its documentation and a practical way to investigate it. The first feature in each route is its discovery destination. The family’s benefit and practice links come from those features’ existing canon entries.",
    "",
    "Feature names open the documentation; contribution labels open the feature’s question connections below. From this reference or the [feature canon](../feature-canon.md), a reader can follow the same relationship in either direction.",
    "",
    "Intent frames the effort. The concern families explore its consequences. Evidence qualifies the answers. Authority identifies who can permit the next action or accept an exception. Ready for review, landing, and deployment may call for different evidence. A small copy edit and a data migration deserve different attention; uncertainty about applicability is itself something to resolve.",
    "",
    "This is a reference for choosing and connecting the work. Reading the canon does not configure a project. During commissioning or a later improvement, the agent can turn selected concerns into project tests, Standards, instructions, Skills, or checkpoints. Use a machine check for a decidable condition, a taught method for recurring work, and a checkpoint for a judgment a matching change should prompt.",
    "",
    "## What supports an answer",
    "",
    "Project commands supply machine results. Checkpoints carry agent judgments as declarations, informed where appropriate by human review or a device exercise. Advisory findings guide investigation; Skills teach the method. Proof binds the recorded completion evidence to the change, and acceptance checks landing authority. A question can draw on several of these contributions.",
    "",
    "The project supplies its domain tests, specialist tools, and review criteria. Coupling finds habitual companions in repository history; it does not establish every semantic dependency. A declaration records a judgment rather than verifying its truth. Permission authorizes an action and leaves an accepted exception visible. These distinctions apply throughout the canon; public copy introduces them through the mechanism that earns its promise.",
    "",
    "**Claim basis:** {{claim:installs-a-practice}} · {{claim:one-instruction-source}} · {{claim:proof-exact-tree}} · {{claim:standards-cannot-loosen}} · {{claim:gate-grants-no-authority}}. The {{doc:claims-and-evidence}} and {{doc:boundary-canon}} retain their claim-level qualifications.",
    "",
    "## Find the question that matters to your change",
    "",
    "| Family | What it helps you build toward |",
    "| --- | --- |",
    ...families.map((family) =>
      `| ${canonLink("", family.title)} | ${family.promise} |`
    ),
    "",
  ];
  for (const family of families) {
    lines.push(
      `## ${family.title}`,
      "",
      family.promise,
      "",
      `**Where it applies:** ${family.applies}`,
      "",
    );
    const routeIds = [
      ...new Set(family.questions.flatMap((question) => question.routes)),
    ];
    for (const question of family.questions) {
      lines.push(
        `### ${question.question}`,
        "",
        question.approach,
        "",
        `**Start here:** ${
          question.routes.map((id) => {
            const route = READINESS_ROUTES[id];
            const path = relative("project/map/_internal/brand", route.doc);
            return `[${requiredTitle(features, id)}](${path}) (${
              canonLink(
                "",
                requiredTitle(features, id),
                route.contribution.toLowerCase(),
              )
            })`;
          }).join(" · ")
        }.`,
        "",
      );
    }
    const humanIds = [
      ...new Set(routeIds.map((id) => READINESS_ROUTES[id].humanBenefit)),
    ];
    const agentIds = [
      ...new Set(routeIds.map((id) => READINESS_ROUTES[id].agentBenefit)),
    ];
    lines.push(
      `**For the person:** ${
        humanIds.map((id) =>
          canonLink(
            "../feature-canon-human-benefits.md",
            requiredTitle(human, id),
          )
        ).join(" · ")
      }.`,
      "",
      `**For the agent:** ${
        agentIds.map((id) =>
          canonLink(
            "../feature-canon-agent-benefits.md",
            requiredTitle(agent, id),
          )
        ).join(" · ")
      }.`,
      "",
    );
    const tenets = PRACTICE_CANON.flatMap((tenet, index) =>
      tenet.mechanisms.some((id) => routeIds.some((route) => route === id))
        ? [
          canonLink(
            "../practice-canon.md",
            `${index + 1}. ${tenet.title}`,
            tenet.title,
          ),
        ]
        : []
    );
    if (tenets.length > 0) {
      lines.push(`**Practice connections:** ${tenets.join(" · ")}.`, "");
    }
  }
  lines.push(
    "## Start with a feature",
    "",
    "Give a feature a question worth answering. These connections show what each feature brings to the work, the questions it helps address, and the human and agent benefits already tied to it. Use a featured question to introduce the capability, then follow the full account when the reader wants to put it to work.",
    "",
    "Start here marks a question’s primary discovery destination. Also helps names another contribution to the same question. These roles come from the question’s route order; the connection remains the same whichever end you start from.",
    "",
  );
  for (const [id, route] of Object.entries(READINESS_ROUTES)) {
    const connections = readinessForFeature(id, families);
    if (connections.length === 0) continue;
    const title = requiredTitle(features, id);
    const agentEntry = agentEntries.find(({ entry }) =>
      entry.id === route.agentBenefit
    )?.entry;
    const agentRole = agentEntry?.drawsOn.includes(id)
      ? ""
      : " (supporting feature)";
    lines.push(
      `### ${title}`,
      "",
      route.invitation,
      "",
      route.how,
      "",
      `**Contribution:** ${route.contribution}. [Feature documentation](${
        relative("project/map/_internal/brand", route.doc)
      }).`,
      "",
      "| Readiness question | Family | Route |",
      "| --- | --- | --- |",
      ...connections.map(({ family, question, primary }) =>
        `| ${canonLink("", question.question)} | ${family.title} | ${
          primary ? "Start here" : "Also helps"
        } |`
      ),
      "",
      `**For the person:** ${
        canonLink(
          "../feature-canon-human-benefits.md",
          requiredTitle(human, route.humanBenefit),
        )
      }.`,
      "",
      `**For the agent:** ${
        canonLink(
          "../feature-canon-agent-benefits.md",
          requiredTitle(agent, route.agentBenefit),
        )
      }${agentRole}.`,
      "",
    );
  }
  lines.push(
    "## From recognition to discovery",
    "",
    "A question can introduce discern before the visitor knows any product names. Let someone recognize a concern, see the human benefit, and follow it to the mechanism. Keep the question’s wording and destination tied to its stable registry identity when building a future discovery surface.",
    "",
    "The question collection can support commissioning conversations, a change brief, review, or a question-led page. These are uses of this reference; a readiness report, automatic question selection, and an interactive landing page remain product or design work to evaluate separately. The project backlog records those explorations.",
    "",
    "## Ownership and traceability",
    "",
    "`scripts/brand/readiness.ts` owns the families, questions, approaches, feature routes, and feature introductions. `scripts/brand/docs/readiness.ts` renders the question and feature views; the feature canon derives its question links from the same records. Feature identities and names, human and agent benefits, and practice obligations remain in their own registries. The route names the benefit it introduces; its feature must occur in that benefit’s product basis, with the agent canon’s direct or supporting role retained. Practice connections derive from the tenets’ mechanism citations. Coverage runs from each question into the existing canons; unrelated features need no readiness question.",
    "",
    "`tests/readiness_canon_test.ts` checks live routes, benefit support, documentation destinations, question identity, reverse feature connections, and future-member rendering. The brand codegen guard keeps this page current. [ADR 0391](../../_adr/0391-readiness-connects-questions-to-the-practice.md) records the ownership and voice decision.",
    "",
  );
  return lines.join("\n");
}
