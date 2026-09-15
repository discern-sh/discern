/** Deliberate non-TypeScript projections of repository and installer identity. */

import { PUBLIC_SCHEMA_PUBLICATIONS } from "../src/shared/public_schemas.ts";

export type RepositoryLiteralKind =
  | "current-repository"
  | "permanent-repository"
  | "canonical-install-command"
  | "raw-install-command";

export interface RepositoryLiteralPolicy {
  readonly path: string;
  /** Exact occurrence counts keep each remaining literal bounded. */
  readonly counts: Readonly<Partial<Record<RepositoryLiteralKind, number>>>;
  readonly reason: string;
}

/**
 * Every deliberate literal outside the TypeScript identity authority.
 *
 * Generated projections remain listed because the guard validates their
 * committed bytes while their codegen sync tests prove how those bytes arose.
 */
export const REPOSITORY_LITERAL_POLICIES: readonly RepositoryLiteralPolicy[] = [
  {
    path: "CLA.md",
    counts: { "permanent-repository": 1 },
    reason:
      "the inactive agreement points at the post-transfer public privacy route",
  },
  {
    path: "README.md",
    counts: { "canonical-install-command": 1 },
    reason: "the repository front door prints the canonical install command",
  },
  {
    path: "SECURITY.md",
    counts: { "current-repository": 1 },
    reason:
      "private vulnerability reporting follows the current repository before the transfer",
  },
  {
    path: "install.sh",
    counts: {
      "current-repository": 3,
      "canonical-install-command": 1,
      "raw-install-command": 1,
    },
    reason:
      "POSIX shell cannot import TypeScript; its default and two documented entrypoints are parity-checked",
  },
  {
    path: "project/manual/00-start/first-success.md",
    counts: {
      "current-repository": 1,
      "canonical-install-command": 1,
      "raw-install-command": 1,
    },
    reason: "the product manual carries the canonical command and one fallback",
  },
  {
    path: "project/manual/30-reference/cli-reference.md",
    counts: { "current-repository": 2 },
    reason: "codegen projects repository source links into the CLI reference",
  },
  {
    path: "project/manual/30-reference/environment-variables.md",
    counts: { "current-repository": 1 },
    reason: "codegen projects the installer repository default",
  },
  {
    path: "project/manual/30-reference/licenses.md",
    counts: { "current-repository": 3 },
    reason: "the license reference links the repository legal documents",
  },
  {
    path: "project/manual/30-reference/logbook.md",
    counts: { "current-repository": 6 },
    reason: "the reference links Logbook authorities to their source",
  },
  {
    path: "project/manual/30-reference/mcp-and-results.md",
    counts: { "current-repository": PUBLIC_SCHEMA_PUBLICATIONS.length },
    reason:
      "codegen projects the public schema, contract manifest, and type source links",
  },
  {
    path: "project/manual/30-reference/platforms-and-providers.md",
    counts: { "current-repository": 3 },
    reason: "the reference gives exact release-verification commands",
  },
  {
    path: "project/manual/30-reference/proof-and-checkpoint-formats.md",
    counts: { "current-repository": 6 },
    reason: "the reference links Proof authorities to their source",
  },
  {
    path: "project/manual/30-reference/worktrees-and-status.md",
    counts: { "current-repository": 14 },
    reason:
      "the reference links worktree and status authorities to their source",
  },
  {
    path: "project/manual/40-troubleshooting/crashes-and-local-state.md",
    counts: { "current-repository": 2 },
    reason: "the troubleshooting page links the current issue tracker",
  },
  {
    path: "project/map/10-getting-started/quickstart.md",
    counts: { "canonical-install-command": 1 },
    reason: "the public Map quickstart prints the canonical install command",
  },
  {
    path: "project/map/10-getting-started/upgrade-discern.md",
    counts: { "canonical-install-command": 1 },
    reason: "the public Map upgrade procedure repeats the canonical command",
  },
  {
    path: "project/map/70-reference/crash-reports.md",
    counts: { "current-repository": 2 },
    reason: "the public Map links the current issue tracker",
  },
  {
    path: "project/map/70-reference/platforms-and-prereqs.md",
    counts: { "current-repository": 3 },
    reason: "the public Map carries exact release-verification commands",
  },
  {
    path: "project/map/_internal/registry-atlas.md",
    counts: { "current-repository": 3 },
    reason: "codegen projects the security-disclosure registry",
  },
  {
    path: "site/text/discern.txt",
    counts: {
      "current-repository": 1,
      "canonical-install-command": 1,
    },
    reason: "the public plain-text edition carries both destinations",
  },
  {
    path: "src/shared/product_identity.ts",
    counts: { "current-repository": 1 },
    reason: "this is the repository and installer identity authority",
  },
];
