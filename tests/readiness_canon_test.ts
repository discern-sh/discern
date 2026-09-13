/**
 * The Readiness Canon routes every question to live product and benefit
 * identities. Its links must remain usable, and future questions must enter
 * the rendered reference without editing a second inventory (ADR 0391).
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, resolve } from "@std/path";
import {
  allAgentBenefitEntries,
  allFeatureNodes,
  allHumanBenefitEntries,
} from "../scripts/feature_registry.ts";
import {
  allReadinessQuestions,
  READINESS_CANON,
  READINESS_ROUTES,
  type ReadinessFamily,
  renderReadinessCanonDoc,
} from "../scripts/brand/readiness.ts";
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

Deno.test("each readiness route connects a live feature to benefits it directly supplies", async () => {
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
    assert(
      agent.get(route.agentBenefit)?.drawsOn.includes(id),
      `${id} does not supply agent benefit ${route.agentBenefit}`,
    );
    assert(
      (await Deno.stat(join(REPO_ROOT, route.doc))).isFile,
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
