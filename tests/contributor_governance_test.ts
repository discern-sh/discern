/**
 * Contributor governance is enforced where work enters the repository. Keep
 * the guide, proposal intake, and pull-request attestations aligned, and prove
 * repository-file links still resolve after map moves.
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join, relative } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import { extractDocLinks } from "../src/lib/docs_integrity.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  agreementChangeAdvancesVersion,
  CLA_ASSISTANT_GIST_FILES,
  CLA_ASSISTANT_METADATA_PATH,
  CONTRIBUTOR_AGREEMENT_ACCEPTANCE,
  CONTRIBUTOR_AGREEMENT_REGISTRY_PATH,
  CONTRIBUTOR_AGREEMENTS,
  CONTRIBUTOR_AGREEMENTS_OFFERED,
  contributorAgreementVersion,
  CORPORATE_CONTRIBUTOR_AGREEMENT,
  INDIVIDUAL_CONTRIBUTOR_AGREEMENT,
  renderClaAssistantMetadata,
} from "../scripts/contributor_agreement.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const CONTRIBUTING = join(REPO_ROOT, "CONTRIBUTING.md");
const INDIVIDUAL_CLA = join(REPO_ROOT, "CLA.md");
const CORPORATE_CLA = join(REPO_ROOT, "CCLA.md");
const PR_TEMPLATE = join(REPO_ROOT, ".github", "PULL_REQUEST_TEMPLATE.md");
const CLA_ASSISTANT_METADATA = join(
  REPO_ROOT,
  CLA_ASSISTANT_METADATA_PATH,
);
const RETIRED_CLA_WORKFLOW = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "cla.yml",
);
const ISSUE_TEMPLATE_DIR = join(REPO_ROOT, ".github", "ISSUE_TEMPLATE");
const PROPOSAL_TEMPLATE = join(
  ISSUE_TEMPLATE_DIR,
  "change_proposal.md",
);
const ISSUE_CONFIG = join(ISSUE_TEMPLATE_DIR, "config.yml");
const GATE_WORKFLOW = join(REPO_ROOT, ".github", "workflows", "gate.yml");
const DISCERN_CONFIG = join(REPO_ROOT, "discern.toml");

/** Resolve a governance link and report its source line when the target is not a file. */
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

/** Parse workflow YAML and narrow its root to the mapping shape governance checks require. */
function yamlRecord(yaml: string, source: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(yaml);
  assert(
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
    `${source} must contain a YAML object`,
  );
  return parsed as Record<string, unknown>;
}

/** Digest contributor-agreement bytes into the lowercase checksum stored by governance metadata. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Fail with a fetch remedy when the contributor-agreement comparison ref is unavailable. */
async function requireBaselineRef(ref: string): Promise<void> {
  const output = await new Deno.Command("git", {
    cwd: REPO_ROOT,
    args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!output.success) {
    throw new Error(
      `contributor agreement baseline ref ${ref} is unavailable; fetch it before running the gate`,
    );
  }
}

/** Read a path from a baseline commit, preserving absence as an expected comparison case. */
async function readGitFileAtRef(
  ref: string,
  path: string,
): Promise<string | undefined> {
  const exists = await new Deno.Command("git", {
    cwd: REPO_ROOT,
    args: ["cat-file", "-e", `${ref}:${path}`],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!exists.success) return undefined;

  const output = await new Deno.Command("git", {
    cwd: REPO_ROOT,
    args: ["show", `${ref}:${path}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `could not read ${ref}:${path}: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
  return new TextDecoder().decode(output.stdout);
}

Deno.test("the contribution guide carries the complete governance contract", async () => {
  const guide = await Deno.readTextFile(CONTRIBUTING);
  for (
    const statement of [
      "The project is founder-led",
      "Every pull request starts with an issue that a maintainer has accepted",
      "AI-assisted contributions are welcome",
      "`discern done` is the contribution contract",
      "[Individual Contributor License Agreement](CLA.md)",
      "You retain any copyright you hold in your Contributions",
      "[Corporate Contributor License Agreement](CCLA.md) privately",
      "[contributor agreement privacy notice](#contributor-agreement-privacy)",
      "Contributor agreement intake status: inactive",
      "Each version receives an irrevocable Apache-2.0 license",
      "second anniversary of the date that version was first made available",
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
      /- \[ \] I’ve read `CONTRIBUTING\.md` and agree to follow it\./,
      /- \[ \] I understand this change and can explain and defend every line\./,
      /- \[ \] `discern done` passes locally on the final tree\./,
    ]
  ) {
    assertMatch(template, attestation);
  }
  for (const legalChecklist of ["CLA.md", "CCLA.md", "privacy notice"]) {
    assert(
      !template.includes(legalChecklist),
      `the pull-request checklist should leave ${legalChecklist} to CONTRIBUTING.md and CLA Assistant`,
    );
  }
});

Deno.test("the hosted assistant accepts the individual agreement without a repository workflow", async () => {
  const individual = await Deno.readTextFile(INDIVIDUAL_CLA);
  const corporate = await Deno.readTextFile(CORPORATE_CLA);
  assertEquals(
    CONTRIBUTOR_AGREEMENT_ACCEPTANCE,
    "I have read and agreed to the discern Contributor License Agreement, version 1.0",
  );
  assertStringIncludes(individual, CONTRIBUTOR_AGREEMENT_ACCEPTANCE);
  assertStringIncludes(
    individual,
    "You retain any copyright you hold in your Contributions",
  );
  assertStringIncludes(individual, "the grant is non-exclusive");
  assertStringIncludes(corporate, "covers only that named entity");
  assertStringIncludes(
    corporate,
    "excluding any parent, subsidiary, affiliate",
  );
  assertStringIncludes(corporate, "authorized to enter into contracts");
  assertStringIncludes(corporate, "SHA-256 digest of the signed PDF");

  const metadataText = await Deno.readTextFile(CLA_ASSISTANT_METADATA);
  assertEquals(metadataText, renderClaAssistantMetadata());
  assertEquals(JSON.parse(metadataText), {
    agreement: {
      title: CONTRIBUTOR_AGREEMENT_ACCEPTANCE,
      type: "boolean",
      required: true,
    },
  });
  assertEquals(CLA_ASSISTANT_GIST_FILES, [
    { repoPath: "CLA.md", gistName: "CLA.md" },
    { repoPath: CLA_ASSISTANT_METADATA_PATH, gistName: "metadata" },
  ]);
  const hostedPaths = new Set<string>(
    CLA_ASSISTANT_GIST_FILES.map((file) => file.repoPath),
  );
  assert(
    !hostedPaths.has(CORPORATE_CONTRIBUTOR_AGREEMENT.repoPath),
    "the hosted assistant must accept only the individual agreement",
  );
  assertEquals(
    await Deno.stat(RETIRED_CLA_WORKFLOW).catch(() => undefined),
    undefined,
  );
});

const OFFERED_FLAG =
  /^export const CONTRIBUTOR_AGREEMENTS_OFFERED: boolean = (?:true|false);$/m;
const OFFERED_TRUE =
  /^export const CONTRIBUTOR_AGREEMENTS_OFFERED: boolean = true;$/m;

Deno.test("numeric agreement versions pin bytes, immutable once offered", async () => {
  assertEquals(CONTRIBUTOR_AGREEMENTS, [
    INDIVIDUAL_CONTRIBUTOR_AGREEMENT,
    CORPORATE_CONTRIBUTOR_AGREEMENT,
  ]);
  assert(
    !agreementChangeAdvancesVersion(
      "# discern Individual Contributor License Agreement, version 1.0\nchanged\n",
      "# discern Individual Contributor License Agreement, version 1.0\noriginal\n",
    ),
  );
  assert(
    agreementChangeAdvancesVersion(
      "# discern Individual Contributor License Agreement, version 1.1\nchanged\n",
      "# discern Individual Contributor License Agreement, version 1.0\noriginal\n",
    ),
  );

  for (const agreement of CONTRIBUTOR_AGREEMENTS) {
    const bytes = await Deno.readFile(join(REPO_ROOT, agreement.repoPath));
    assertEquals(
      await sha256Hex(bytes),
      agreement.sha256,
      `${agreement.repoPath} differs from its ${agreement.version} SHA-256 pin`,
    );
    const version = contributorAgreementVersion(
      new TextDecoder().decode(bytes),
    );
    assert(version !== undefined, `${agreement.repoPath} needs a version`);
    assertEquals(version.join("."), agreement.version);
  }

  const baseline = parseConfigOrThrow(
    await Deno.readTextFile(DISCERN_CONFIG),
  ).repository.trunk;
  await requireBaselineRef(baseline);
  assertEquals(
    await readGitFileAtRef(baseline, ".missing-agreement-control"),
    undefined,
    "a missing path at a valid baseline is distinct from a missing baseline",
  );
  const registrySource = await Deno.readTextFile(
    join(REPO_ROOT, CONTRIBUTOR_AGREEMENT_REGISTRY_PATH),
  );
  assertMatch(
    registrySource,
    OFFERED_FLAG,
    "the registry must declare CONTRIBUTOR_AGREEMENTS_OFFERED as a literal boolean so baseline checks can read it",
  );

  const previousRegistry = await readGitFileAtRef(
    baseline,
    CONTRIBUTOR_AGREEMENT_REGISTRY_PATH,
  );
  if (previousRegistry !== undefined) {
    if (OFFERED_TRUE.test(previousRegistry)) {
      assert(
        CONTRIBUTOR_AGREEMENTS_OFFERED,
        "CONTRIBUTOR_AGREEMENTS_OFFERED can never return to false once the agreements have been offered",
      );
      for (const agreement of CONTRIBUTOR_AGREEMENTS) {
        const previous = await readGitFileAtRef(baseline, agreement.repoPath);
        if (previous === undefined) continue;
        const current = await Deno.readTextFile(
          join(REPO_ROOT, agreement.repoPath),
        );
        assert(
          agreementChangeAdvancesVersion(current, previous),
          `${agreement.repoPath} bytes changed without advancing its numeric version`,
        );
      }
    }
  }

  await assertRejects(
    () => requireBaselineRef("refs/heads/missing-agreement-baseline"),
    Error,
    "baseline ref refs/heads/missing-agreement-baseline is unavailable",
  );
});

Deno.test("every CI gate materializes the agreement baseline as the local trunk", async () => {
  const source = await Deno.readTextFile(GATE_WORKFLOW);
  const workflow = yamlRecord(source, relative(REPO_ROOT, GATE_WORKFLOW));
  const jobs = workflow.jobs;
  assert(jobs !== null && typeof jobs === "object" && !Array.isArray(jobs));
  for (const name of ["gate", "macos", "standards"]) {
    const job = (jobs as Record<string, unknown>)[name];
    assert(job !== null && typeof job === "object" && !Array.isArray(job));
    const record = job as Record<string, unknown>;
    const steps = record.steps;
    assert(Array.isArray(steps), `${name} must declare steps`);
    const fetchStep = steps.find((step) =>
      step !== null && typeof step === "object" && !Array.isArray(step) &&
      String((step as Record<string, unknown>).run).includes(
        "+refs/heads/main:refs/remotes/origin/main",
      )
    );
    assert(
      fetchStep !== undefined,
      `${name} must fetch origin/main for baseline checks`,
    );
    assert(
      !String((fetchStep as Record<string, unknown>).run).includes("|| true"),
      `${name} must not silently skip a failed baseline fetch`,
    );
    assertStringIncludes(
      String((fetchStep as Record<string, unknown>).run),
      "git branch --force main refs/remotes/origin/main",
      `${name} must expose the fetched baseline as the configured local trunk`,
    );
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
  for (
    const source of [
      CONTRIBUTING,
      INDIVIDUAL_CLA,
      CORPORATE_CLA,
      PR_TEMPLATE,
      PROPOSAL_TEMPLATE,
    ]
  ) {
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
