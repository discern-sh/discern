/** Repository files whose membership carries publication or editor policy. */
import { BUNDLED_MANUAL_STAGE_DIR } from "../src/lib/paths.ts";

export interface EditorPathPolicy {
  readonly path: string;
  readonly kind: "generated-output" | "private-browser-state";
  readonly reason: string;
}

/** Non-authored paths shared editor configuration may hide or classify. */
export const EDITOR_PATH_POLICIES: readonly EditorPathPolicy[] = [
  {
    path: ".agents/skills",
    kind: "generated-output",
    reason: "discern refresh materializes the agent-neutral skill projection",
  },
  {
    path: ".claude/skills",
    kind: "generated-output",
    reason: "discern refresh materializes the Claude Code skill projection",
  },
  {
    path: BUNDLED_MANUAL_STAGE_DIR,
    kind: "generated-output",
    reason: "the binary build owns this transient manual include tree",
  },
  {
    path: ".scratch",
    kind: "generated-output",
    reason: "repository development commands own this ignored scratch tree",
  },
  {
    path: ".vale/Microsoft",
    kind: "generated-output",
    reason: "the pinned Vale sync task materializes this package",
  },
  {
    path: ".vale/proselint",
    kind: "generated-output",
    reason: "the pinned Vale sync task materializes this package",
  },
  {
    path: "AGENTS.md",
    kind: "generated-output",
    reason: "discern refresh compiles this agent instruction projection",
  },
  {
    path: "CLAUDE.md",
    kind: "generated-output",
    reason: "discern refresh compiles this agent instruction projection",
  },
  {
    path: "GEMINI.md",
    kind: "generated-output",
    reason: "discern refresh compiles this agent instruction projection",
  },
  {
    path: "coverage",
    kind: "generated-output",
    reason: "coverage runs materialize this report tree",
  },
  {
    path: "dist",
    kind: "generated-output",
    reason: "release builds materialize binary artifacts here",
  },
  {
    path: "node_modules",
    kind: "generated-output",
    reason: "JavaScript tooling may materialize this dependency cache",
  },
  {
    path: "site/pages/assets/design-system",
    kind: "generated-output",
    reason: "the site build compiles the design-system bundles here",
  },
  {
    path: "site/pages/index.html",
    kind: "generated-output",
    reason: "the site build renders the public landing page here",
  },
  {
    path: ".idea/gbrowser_project.xml",
    kind: "private-browser-state",
    reason: "the IDE browser plugin writes per-user tab state",
  },
] as const;

export interface DenoVisibleIgnorePattern {
  /**
   * The `.gitignore` pattern in the form `deno.json`'s `exclude` takes:
   * relative to the repository root, an unanchored pattern prefixed with
   * `**\/`, and a directory-only pattern keeping its trailing slash.
   */
  readonly pattern: string;
  /**
   * `deno-skips`: Deno's own file discovery never walks it, which the guard
   * proves. `rebuilt`: Deno walks it, including its JavaScript, but the gate's
   * build stage deletes and regenerates the whole root before lint, check, and
   * test run, so nothing stray survives into them; the guard holds the root to
   * the outputs the site build deletes. `non-module-files`: it names files
   * only, none with a JavaScript or TypeScript extension, so no Deno command
   * type-checks or tests them; the guard rejects a pattern that could end in
   * one. `re-included`: a later `.gitignore` negation re-includes tracked
   * files beneath it, which a top-level exclusion would hide from `deno fmt`
   * and which native `--ignore` cannot carry; the guard requires that
   * negation.
   */
  readonly discovery:
    | "deno-skips"
    | "rebuilt"
    | "non-module-files"
    | "re-included";
  readonly reason: string;
}

/**
 * Git-ignored patterns deliberately left out of `deno.json`'s top-level
 * `exclude`. Every other pattern any tracked `.gitignore` ignores is excluded
 * there, because `deno check` and `deno test` ignore `.gitignore` and would
 * otherwise type-check ignored scratch and build output.
 */
export const DENO_VISIBLE_IGNORE_PATTERNS: readonly DenoVisibleIgnorePattern[] =
  [
    {
      pattern: "**/.DS_Store",
      discovery: "non-module-files",
      reason: "macOS Finder writes per-directory metadata files",
    },
    {
      pattern: "**/*.log",
      discovery: "non-module-files",
      reason: "local tools write plain-text logs",
    },
    {
      pattern: "node_modules/",
      discovery: "deno-skips",
      reason:
        "npm resolution under nodeModulesDir reads it, and Deno's discovery already skips it",
    },
    {
      pattern: ".idea/gbrowsers.xml",
      discovery: "non-module-files",
      reason: "the IDE browser plugin writes per-user browser settings",
    },
    {
      pattern: ".idea/gbrowser_project.xml",
      discovery: "non-module-files",
      reason: "the IDE browser plugin writes per-user tab state",
    },
    {
      pattern: ".vale/*",
      discovery: "re-included",
      reason:
        "the pinned Vale sync writes only YAML style packages here, beside the tracked styles and vocabulary the negations re-include for deno fmt",
    },
    {
      pattern: "site/pages/index.html",
      discovery: "non-module-files",
      reason: "the site build renders this page for the deploy upload",
    },
    {
      pattern: "site/pages/agents.html",
      discovery: "non-module-files",
      reason: "the site build renders this page for the deploy upload",
    },
    {
      pattern: "site/pages/agents.md",
      discovery: "non-module-files",
      reason: "a retired site output that every site build removes",
    },
    {
      pattern: "site/pages/assets/design-system/",
      discovery: "rebuilt",
      reason:
        "the hosted deploy rebuilds and serves these CSS, JavaScript, and font bundles under this deno.json, so the live site's assets never depend on how deploy packaging treats excluded paths",
    },
    {
      pattern: "site/pages/v2.html",
      discovery: "non-module-files",
      reason: "a retired site output that every site build removes",
    },
    {
      pattern: ".claude/settings.local.json",
      discovery: "non-module-files",
      reason: "Claude Code keeps machine-local settings here",
    },
    {
      pattern: "site/pages/release-catalogue.json",
      discovery: "non-module-files",
      reason: "the site build writes the release catalogue the deploy serves",
    },
    {
      pattern: "site/release-publication.json",
      discovery: "non-module-files",
      reason:
        "deployment stages publication evidence here and re-includes it in the upload, which must never depend on Deno exclusions",
    },
    {
      pattern: ".idea/workspace.xml",
      discovery: "non-module-files",
      reason: "the IDE keeps per-user workspace state",
    },
    {
      pattern: ".idea/dataSources.local.xml",
      discovery: "non-module-files",
      reason: "the IDE keeps machine-local data source settings",
    },
  ] as const;

export interface CommunityFilePolicy {
  readonly path: string;
  readonly state: "tracked" | "intentionally-absent";
  readonly reason: string;
}

/** Every root community file and every file under `.github/`. */
export const REPOSITORY_COMMUNITY_FILE_POLICIES:
  readonly CommunityFilePolicy[] = [
    { path: "CCLA.md", state: "tracked", reason: "corporate agreement terms" },
    { path: "CLA.md", state: "tracked", reason: "individual agreement terms" },
    {
      path: "CODE_OF_CONDUCT.md",
      state: "tracked",
      reason: "community conduct and enforcement route",
    },
    {
      path: "CONTRIBUTING.md",
      state: "tracked",
      reason: "contributor intake status and eventual workflow",
    },
    { path: "LICENSE", state: "tracked", reason: "distribution terms" },
    { path: "NOTICE", state: "tracked", reason: "third-party notices" },
    {
      path: "SECURITY.md",
      state: "tracked",
      reason: "private security intake",
    },
    {
      path: ".github/ISSUE_TEMPLATE/bug_report.md",
      state: "tracked",
      reason: "public bug intake",
    },
    {
      path: ".github/ISSUE_TEMPLATE/change_proposal.md",
      state: "tracked",
      reason: "public problem proposals",
    },
    {
      path: ".github/ISSUE_TEMPLATE/config.yml",
      state: "tracked",
      reason: "issue chooser routes",
    },
    {
      path: ".github/ISSUE_TEMPLATE/setup_failure.md",
      state: "tracked",
      reason: "public setup-failure intake",
    },
    {
      path: ".github/PULL_REQUEST_TEMPLATE.md",
      state: "tracked",
      reason: "inactive pull-request guidance",
    },
    {
      path: ".github/actions/macos-gate/action.yml",
      state: "tracked",
      reason: "repository-owned hosted gate action",
    },
    {
      path: ".github/actions/policy-base/action.yml",
      state: "tracked",
      reason: "the hosted gate resolves the event's immutable policy base",
    },
    {
      path: ".github/actions/wsl-gate/action.yml",
      state: "tracked",
      reason: "repository-owned WSL 2 gate action",
    },
    {
      path: ".github/actions/wsl-gate/vm-samples.sh",
      state: "tracked",
      reason: "the VM sampler the WSL 2 gate action runs beside the gate",
    },
    {
      path: ".github/cla-assistant/README.md",
      state: "tracked",
      reason: "inactive hosted-agreement boundary",
    },
    {
      path: ".github/cla-assistant/metadata",
      state: "tracked",
      reason: "generated hosted-agreement payload",
    },
    {
      path: ".github/dependabot.yml",
      state: "tracked",
      reason: "GitHub Actions dependency updates",
    },
    {
      path: ".github/hooks/discern.json",
      state: "tracked",
      reason: "repository lifecycle hook bridge",
    },
    {
      path: ".github/workflows/gate.yml",
      state: "tracked",
      reason: "hosted quality gate",
    },
    {
      path: ".github/workflows/release-resume.yml",
      state: "tracked",
      reason: "successful complete gate runs resume unpublished release tags",
    },
    {
      path: ".github/workflows/site.yml",
      state: "tracked",
      reason: "manual website publication entry point",
    },
    {
      path: ".github/workflows/site-publish.yml",
      state: "tracked",
      reason: "shared verified production website publisher",
    },
    {
      path: ".github/workflows/release.yml",
      state: "tracked",
      reason: "release publication workflow",
    },
    {
      path: ".github/CODEOWNERS",
      state: "intentionally-absent",
      reason: "the founder-led repository has no separate ownership routing",
    },
    {
      path: ".github/FUNDING.yml",
      state: "intentionally-absent",
      reason: "the repository offers no public funding route",
    },
    {
      path: "SUPPORT.md",
      state: "intentionally-absent",
      reason: "issue routes and the manual own support guidance",
    },
  ] as const;

/** Public repository files that must expose the contributor-intake state. */
export const CONTRIBUTOR_INTAKE_SURFACES = [
  "CONTRIBUTING.md",
  "CLA.md",
  "CCLA.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/change_proposal.md",
  ".github/ISSUE_TEMPLATE/setup_failure.md",
  ".github/cla-assistant/README.md",
] as const;

/** Personal names that cannot classify work in the tracked public backlog. */
export const PERSONAL_TODO_HEADING_NAMES = [
  "Jack Webb-Heller",
  "Jack",
] as const;
