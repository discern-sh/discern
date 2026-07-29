/** Source-backed Workflow grammar on the browser manual. */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { packageManifest } from "discern-design-system";
import { DESIGN_SYSTEM_BUNDLES } from "../site/design_system.ts";
import { loadDocsSite } from "../site/docs.ts";
import { handler } from "../site/serve.ts";
import { renderWorkflowMarkdown } from "../site/workflow.ts";
import {
  WORKFLOW_COMPONENTS,
  WORKFLOW_DIRECTIVES,
} from "../site/workflow_registry.ts";

const BROWSER = {
  accept: "text/html,application/xhtml+xml",
  "user-agent": "Mozilla/5.0 workflow contract",
};
const TEXT = { accept: "text/plain", "user-agent": "curl/8.6.0" };

interface WorkflowPage {
  readonly page: Awaited<ReturnType<typeof loadDocsSite>>["pages"][number];
  readonly raw: string;
}

function get(path: string, headers = BROWSER): Promise<Response> {
  return handler(new Request(`https://discern.sh${path}`, { headers }));
}

async function workflowPages(): Promise<readonly WorkflowPage[]> {
  const site = await loadDocsSite();
  const pages = await Promise.all(
    site.pages.map(async (page) => ({
      page,
      raw: await Deno.readTextFile(page.entry.absPath),
    })),
  );
  return pages.filter(({ raw }) => raw.includes("<!-- discern-workflow:"));
}

Deno.test("every Workflow directive has one source example and selected package roots", async () => {
  const source = (await workflowPages()).map(({ raw }) => raw).join("\n");
  for (const directive of WORKFLOW_DIRECTIVES) {
    assertStringIncludes(
      source,
      `<!-- discern-workflow:${directive.id} -->`,
      directive.id,
    );
  }

  const requested = new Set(WORKFLOW_COMPONENTS);
  assertEquals(
    WORKFLOW_COMPONENTS,
    packageManifest.components
      .filter((component) => requested.has(component.id))
      .map((component) => component.id),
  );
  assertEquals(
    DESIGN_SYSTEM_BUNDLES.docs.components.filter((id) => requested.has(id)),
    WORKFLOW_COMPONENTS,
  );
});

Deno.test("representative manual journeys render the complete Workflow dependency closure", async () => {
  const pages = await workflowPages();
  assert(pages.length > 0, "the manual has no Workflow journeys");
  const html = (
    await Promise.all(
      pages.map(async ({ page }) => await (await get(page.route)).text()),
    )
  ).join("\n");
  const selected = new Set(DESIGN_SYSTEM_BUNDLES.docs.components);
  const selectedGroups = new Set<string>(DESIGN_SYSTEM_BUNDLES.docs.groups);
  const resolved = new Set<string>();
  const visit = (id: string): void => {
    if (resolved.has(id)) return;
    const component = packageManifest.components.find((entry) =>
      entry.id === id
    );
    assert(component !== undefined, id);
    component.dependencies.forEach(visit);
    resolved.add(id);
  };
  for (const component of packageManifest.components) {
    if (
      selected.has(component.id) ||
      selectedGroups.has(component.group)
    ) {
      visit(component.id);
    }
  }
  const workflow = packageManifest.components.filter((component) =>
    component.group === "Workflow" && resolved.has(component.id)
  );
  assert(workflow.length > 0);
  const renderedWorkflow = packageManifest.components.filter((component) => {
    if (component.group !== "Workflow") return false;
    const root = component.ownedClasses.find((name) =>
      name === `discern-${component.id}`
    );
    if (root === undefined) return false;
    return new RegExp(`class="[^"]*\\b${root}\\b`).test(html);
  });
  assertEquals(
    renderedWorkflow.map((component) => component.id),
    workflow.map((component) => component.id),
    "rendered Workflow roots and the docs bundle must agree",
  );
});

Deno.test("Workflow-enhanced routes keep their pristine Markdown editions", async () => {
  for (const { page, raw } of await workflowPages()) {
    assertEquals(await (await get(page.route, TEXT)).text(), raw);
    assertEquals(await (await get(`${page.route}.md`)).text(), raw);
  }
});

Deno.test("static procedure prerequisites render as requirements, not status", async () => {
  const response = await get("/docs/getting-started/quickstart");
  const html = await response.text();
  const items = [
    ...html.matchAll(
      /<li class="discern-prerequisite-list__item" data-discern-state="([^"]+)">([\s\S]*?)<\/li>/g,
    ),
  ];
  assertEquals(items.length, 2);
  assertEquals(items.map((item) => item[1]), ["required", "required"]);
  assertEquals(
    items.map((item) =>
      /discern-prerequisite-list__marker"[^>]*>([^<]+)</.exec(
        item[2] ?? "",
      )?.[1]
    ),
    ["•", "•"],
  );
  assertEquals(
    items.map((item) =>
      /discern-prerequisite-list__state">([^<]+)</.exec(item[2] ?? "")
        ?.[1]
    ),
    ["Required", "Required"],
  );
  assertEquals(/\b(?:Unresolved|Satisfied)\b/.test(html), false);
});

Deno.test("malformed and unknown Workflow directives fail at the source boundary", () => {
  assertThrows(
    () => {
      renderWorkflowMarkdown(
        "<!-- discern-workflow:future-thing -->\ntext\n<!-- /discern-workflow -->",
        {},
        "fixture.md",
      );
    },
    Error,
    "unknown directive future-thing",
  );
  assertThrows(
    () => {
      renderWorkflowMarkdown(
        "<!-- discern-workflow:command -->\n```sh\ndiscern done\n```",
        {},
        "fixture.md",
      );
    },
    Error,
    "has no closing marker",
  );
  assertThrows(
    () => {
      renderWorkflowMarkdown(
        [
          "<!-- discern-workflow:procedure -->",
          "## Ship a change",
          "",
          "Take one change through the gate.",
          "",
          "**Before you start:**",
          "",
          "- [ ] The setup branch is landed.",
          "",
          "**Steps:**",
          "",
          "1. **Start.** Open a worktree.",
          "",
          "**You are done when:** The branch is landed.",
          "<!-- /discern-workflow -->",
        ].join("\n"),
        {},
        "fixture.md",
      );
    },
    Error,
    "invalid prerequisite line",
  );
});
