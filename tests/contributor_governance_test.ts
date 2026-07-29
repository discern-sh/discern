/**
 * Contributor governance is enforced where work enters the repository. Keep
 * the guide, proposal intake, and pull-request attestations aligned, and prove
 * repository-file links still resolve after map moves.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join, relative } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { extractDocLinks } from "../src/lib/docs_integrity.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const CONTRIBUTING = join(REPO_ROOT, "CONTRIBUTING.md");
const PR_TEMPLATE = join(REPO_ROOT, ".github", "PULL_REQUEST_TEMPLATE.md");
const ISSUE_TEMPLATE_DIR = join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");
const PROPOSAL_TEMPLATE = join(
  ISSUE_TEMPLATE_DIR,
  "change_proposal.md",
);
const ISSUE_CONFIG = join(ISSUE_TEMPLATE_DIR, "config.yml");

async function assertFile(
  path: string,
  source: string,
  line: number,
): Promise<void> {
  const info = await Deno.stat(path).catch(() => undefined);
  assert(
    info?.isFile,
    `${relative(REPO_ROOT, source)}:${line} links to missing file ${
      relative(REPO_ROOT, path)
    }`,
  );
}

function yamlRecord(yaml: string, source: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(yaml);
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    `${source} must contain a YAML object`,
  );
  return parsed as Record<string, unknown>;
}

Deno.test("the contribution guide carries the complete governance contract", async () => {
  const guide = await Deno.readTextFile(CONTRIBUTING);
  for (
    const statement of [
      "The project is founder-led",
      "Every pull request starts with an issue that a maintainer has accepted",
      "AI-assisted contributions are welcome",
      "`discern done` is the contribution contract",
      "Inbound and outbound contributions use Apache-2.0",
      "`git commit -s`",
    ]
  ) {
    assertStringIncludes(guide, statement);
  }

  let previous = -1;
  for (
    const approach of [
      "Explain existing behavior in the documentation",
      "existing project configuration",
      "Extend a configuration or integration point",
      "Change core behavior",
    ]
  ) {
    const index = guide.indexOf(approach);
    assert(index > previous, `${approach} is missing or out of order`);
    previous = index;
  }
});

Deno.test("the pull-request template requires every contribution attestation", async () => {
  const template = await Deno.readTextFile(PR_TEMPLATE);
  for (
    const attestation of [
      /- \[ \] I have read `CONTRIBUTING\.md`\./,
      /- \[ \] I understand this change and can explain and defend every line\./,
      /- \[ \] `discern done` passes locally on the final tree\./,
      /- \[ \] Every commit carries my Developer Certificate of Origin \(DCO\) sign-off \(`git commit -s`\)\./,
    ]
  ) {
    assertMatch(template, attestation);
  }
});

Deno.test("change proposals arrive before implementation and use the smallest-change ladder", async () => {
  const template = await Deno.readTextFile(PROPOSAL_TEMPLATE);
  assertStringIncludes(template, "Open this issue before implementation");
  assertStringIncludes(
    template,
    "- [ ] I am proposing this change before I intend to implement it.",
  );
  for (
    const approach of [
      "Explain existing behavior in the documentation",
      "Use existing project configuration or a supported agent integration",
      "Extend a configuration or integration point",
      "Change core behavior",
    ]
  ) {
    assertStringIncludes(template, approach);
  }
});

Deno.test("issue intake stays structured and every template has valid metadata", async () => {
  const config = yamlRecord(
    await Deno.readTextFile(ISSUE_CONFIG),
    relative(REPO_ROOT, ISSUE_CONFIG),
  );
  assertEquals(config.blank_issues_enabled, false);

  const names = new Set<string>();
  const entries = [];
  for await (const entry of Deno.readDir(ISSUE_TEMPLATE_DIR)) {
    if (entry.isFile && entry.name.endsWith(".md")) entries.push(entry.name);
  }
  entries.sort();
  for (const name of entries) {
    const path = join(ISSUE_TEMPLATE_DIR, name);
    const markdown = await Deno.readTextFile(path);
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    assert(match !== null, `${name} needs YAML frontmatter`);
    const yaml = match[1];
    assert(yaml !== undefined);
    const metadata = yamlRecord(yaml, name);
    assert(
      typeof metadata.name === "string" && metadata.name.length > 0,
      `${name} needs a non-empty name`,
    );
    assert(
      typeof metadata.about === "string" && metadata.about.length > 0,
      `${name} needs a non-empty about`,
    );
    assert(
      !names.has(metadata.name),
      `duplicate issue-template name: ${metadata.name}`,
    );
    names.add(metadata.name);
  }
  assert(
    names.has("Change proposal"),
    "change proposals need a dedicated issue template",
  );
});

Deno.test("repository-file links in contributor intake resolve", async () => {
  for (const source of [CONTRIBUTING, PR_TEMPLATE, PROPOSAL_TEMPLATE]) {
    const markdown = await Deno.readTextFile(source);
    for (const { target, line } of extractDocLinks(markdown)) {
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      const path = target.split("#", 1)[0];
      if (path === undefined || path === "") continue;
      await assertFile(join(dirname(source), path), source, line);
    }
  }

  const config = await Deno.readTextFile(ISSUE_CONFIG);
  const blobLinks = config.matchAll(
    /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/main\/([^\s]+)/g,
  );
  let found = false;
  for (const match of blobLinks) {
    const path = match[1];
    assert(path !== undefined);
    found = true;
    await assertFile(join(REPO_ROOT, path), ISSUE_CONFIG, 1);
  }
  assert(found, "issue config must keep its repository-file contact link");
});
