/** Repository files whose membership carries publication or editor policy. */

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
    path: ".discern-bundled-docs",
    kind: "generated-output",
    reason: "the bundled manual extractor owns this local cache",
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
      path: ".github/actions/wsl-gate/action.yml",
      state: "tracked",
      reason: "repository-owned WSL 2 gate action",
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
