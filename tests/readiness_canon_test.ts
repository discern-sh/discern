/**
 * The Readiness Canon routes every question to live product and benefit
 * identities. Its links must remain usable, and future questions must enter
 * the rendered reference without editing a second inventory (ADR 0392).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "@std/path";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
  renderFeatureCanonDoc,
} from "../scripts/feature_registry.ts";
import {
  allReadinessQuestions,
  canonLink,
  READINESS_CANON,
  READINESS_ROUTES,
  type ReadinessFamily,
} from "../scripts/brand/readiness.ts";
import { renderReadinessCanonDoc } from "../scripts/brand/docs/readiness.ts";
import { renderBrandDoc } from "../scripts/brand_registry.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { assertFreshCanonIds } from "./canon_ids.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

Deno.test("readiness questions have distinct identities and actionable approaches", () => {
  const taken = new Set([
    ...allFeatureNodes().map(({ node }) => node.id),
    ...allHumanBenefitEntries().map(({ entry }) => entry.id),
    ...allAgentBenefitEntries().map(({ entry }) => entry.id),
  ]);
  assertFreshCanonIds("readiness", [
    ...READINESS_CANON.map((family) => family.id),
    ...allReadinessQuestions().map((question) => question.id),
  ], taken);
  for (const family of READINESS_CANON) {
    assert(family.questions.length > 0, `empty readiness family: ${family.id}`);
    assert(
      family.applies.trim().length > 0,
      `missing applicability: ${family.id}`,
    );
    for (const question of family.questions) {
      assert(question.question.endsWith("?"), `not a question: ${question.id}`);
      assert(
        question.approach.endsWith("."),
        `missing practical approach: ${question.id}`,
      );
      assertEquals(
        new Set(question.routes).size,
        question.routes.length,
        `duplicate route: ${question.id}`,
      );
    }
  }
});

Deno.test("each readiness route connects a live feature to benefits it supplies or supports", async () => {
  const features = new Set(allFeatureNodes().map(({ node }) => node.id));
  const human = new Map(
    allHumanBenefitEntries().map(({ entry }) => [entry.id, entry]),
  );
  const agent = new Map(
    allAgentBenefitEntries().map(({ entry }) => [entry.id, entry]),
  );
  const used = new Set<string>(
    allReadinessQuestions().flatMap((question) => question.routes),
  );
  for (const [id, route] of Object.entries(READINESS_ROUTES)) {
    assert(features.has(id), `readiness route names unknown feature: ${id}`);
    assert(used.has(id), `readiness route reaches no question: ${id}`);
    assert(
      human.get(route.humanBenefit)?.drawsOn.includes(id),
      `${id} does not supply human benefit ${route.humanBenefit}`,
    );
    const agentBenefit = agent.get(route.agentBenefit);
    assert(
      agentBenefit?.drawsOn.includes(id) ||
        agentBenefit?.supportedBy?.includes(id),
      `${id} does not supply or support agent benefit ${route.agentBenefit}`,
    );
    assert(
      route.invitation.trim().length > 0,
      `missing feature invitation: ${id}`,
    );
    assert(route.how.endsWith("."), `missing feature contribution: ${id}`);
    assert(
      (await Deno.stat(join(REPO_ROOT, route.doc.split("#")[0] ?? route.doc)))
        .isFile,
      `missing route documentation: ${id}`,
    );
  }
});

Deno.test("every readiness reference resolves to a real document and rendered heading", async () => {
  const page = join(
    REPO_ROOT,
    "project/map/_internal/brand/readiness-canon.md",
  );
  const markdown = renderBrandDoc("readiness-canon");
  const documents = new Map([[page, markdown]]);
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1];
    assert(href !== undefined);
    if (/^https?:/.test(href)) continue;
    const [path = "", anchor] = href.split("#");
    const target = path === "" ? page : resolve(dirname(page), path);
    let text = documents.get(target);
    if (text === undefined) {
      text = await Deno.readTextFile(target);
      documents.set(target, text);
    }
    if (anchor !== undefined) {
      assert(
        renderMarkdownHtml(text).headings.some((heading) =>
          heading.id === anchor
        ),
        `readiness link has no rendered heading: ${href}`,
      );
    }
  }
});

Deno.test("readiness rendering enrolls every family and question without a second list", () => {
  const rendered = renderReadinessCanonDoc();
  const headings = renderMarkdownHtml(rendered).headings;
  for (const family of READINESS_CANON) {
    assert(
      headings.some((heading) =>
        heading.depth === 2 && heading.text === family.title
      ),
      `missing readiness family: ${family.id}`,
    );
    for (const question of family.questions) {
      assertEquals(
        headings.filter((heading) =>
          heading.depth === 3 && heading.text === question.question
        ).length,
        1,
        `readiness question must render once: ${question.id}`,
      );
      assertStringIncludes(rendered, question.approach);
    }
  }
  const future: ReadinessFamily = {
    id: "future-readiness-family",
    title: "Future concern",
    role: "concern",
    promise: "Take a new concern into the next change.",
    applies: "Consider a newly introduced workflow.",
    questions: [{
      id: "future-readiness-question",
      question: "Will the new workflow hold up?",
      routes: ["gate"],
      approach: "Run the project's workflow checks.",
    }],
  };
  const extended = renderReadinessCanonDoc([...READINESS_CANON, future]);
  assertStringIncludes(extended, "[Future concern](#future-concern)");
  assertStringIncludes(extended, "### Will the new workflow hold up?");
  assertStringIncludes(extended, "Run the project's workflow checks.");
  assertStringIncludes(
    extended,
    "../../../manual/10-guides/finish-and-land-a-change.md",
  );
});

Deno.test("the related-places discovery question opens Coupling with advisory evidence", () => {
  const question = allReadinessQuestions().find((entry) =>
    entry.id === "check-related-places"
  );
  assert(question !== undefined);
  assertEquals(question.routes[0], "coupling");
  assertEquals(
    READINESS_ROUTES[question.routes[0]].contribution,
    "Advisory evidence",
  );
  assertEquals(
    READINESS_ROUTES[question.routes[0]].doc,
    "project/map/20-quality-gate/coupling.md",
  );
});

Deno.test("feature connections render every linked question and preserve its discovery role", () => {
  const future: ReadinessFamily = {
    id: "future-feature-connection",
    title: "Future feature connection",
    role: "concern",
    promise: "Carry a new question into the work.",
    applies: "Consider a newly connected concern.",
    questions: [{
      id: "future-question-with-shared-routes",
      question: "Does the new concern have the evidence it needs?",
      routes: ["coupling", "checkpoints"],
      approach: "Review the relevant findings and record the judgment.",
    }],
  };
  const families = [...READINESS_CANON, future];
  const rendered = renderReadinessCanonDoc(families);
  const featureView = rendered.split("## Start with a feature\n")[1];
  assert(featureView !== undefined);
  const features = new Map(
    allFeatureNodes().map(({ node }) => [node.id, node]),
  );
  for (const [id, route] of Object.entries(READINESS_ROUTES)) {
    const feature = features.get(id);
    assert(feature !== undefined);
    const section = featureView.split(`### ${feature.title}\n`)[1]?.split(
      "\n##",
    )[0];
    assert(section !== undefined, `missing feature view: ${id}`);
    assertStringIncludes(section, route.invitation);
    assertStringIncludes(section, route.how);
    const expected = families.flatMap((family) =>
      family.questions.flatMap((question) =>
        question.routes.some((featureId) => featureId === id)
          ? [
            `| ${canonLink("", question.question)} | ${family.title} | ${
              question.routes[0] === id ? "Start here" : "Also helps"
            } |`,
          ]
          : []
      )
    );
    const rows = section.split("\n").filter((line) => line.startsWith("| ["));
    assertEquals(rows, expected, `wrong question connections: ${id}`);
  }
});

Deno.test("readiness support lists render feature identities for every current and future question", () => {
  const future: ReadinessFamily = {
    id: "future-support-list-family",
    title: "Future support list",
    role: "concern",
    promise: "Keep the release question connected to the work.",
    applies: "Consider a new review concern.",
    questions: [{
      id: "future-support-list-question",
      question: "Has the revised account been reviewed?",
      routes: ["map-freshness", "checkpoints"],
      approach: "Compare the current explanation with the changed work.",
    }],
  };
  const families = [...READINESS_CANON, future];
  const rendered = renderReadinessCanonDoc(families);
  for (const question of allReadinessQuestions(families)) {
    const section = rendered.split(`### ${question.question}\n`)[1]?.split(
      "\n##",
    )[0];
    assert(section !== undefined, `missing question: ${question.id}`);
    const support = section.split("\n").find((line) =>
      line.startsWith("**Supporting features:**")
    );
    assert(support !== undefined, `missing feature identities: ${question.id}`);
    const slugs = [...support.matchAll(/\[`([^`]+)`\]\([^)]+\)/g)].map((
      match,
    ) => match[1]);
    assertEquals(
      slugs,
      [...question.routes],
      `wrong feature identities: ${question.id}`,
    );
  }
});

Deno.test("feature canon keeps Readiness in its introductory cross-reference", () => {
  const rendered = renderFeatureCanonDoc();
  const links = [
    ...rendered.matchAll(/\]\((brand\/readiness-canon\.md[^)]*)\)/g),
  ].map((match) => match[1]);
  assertEquals(links, ["brand/readiness-canon.md"]);
  for (const question of allReadinessQuestions()) {
    assert(
      !rendered.includes(question.question),
      `question leaked into feature entries: ${question.id}`,
    );
  }
});
