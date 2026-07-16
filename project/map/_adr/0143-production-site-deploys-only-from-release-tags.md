# ADR 0143: The production site deploys only from release tags

**Status**: accepted

## Context

The installed binary embeds help from a released source snapshot, but the
initial Deno Deploy plan linked production to the repository's default branch.
That lets documentation on `main` describe behavior users cannot install yet.
The drift is subtle because both revisions can be individually correct while
their public claims disagree.

Deno Deploy supports both GitHub-linked automatic builds and local-source CLI
deploys. Automatic builds are convenient, but their branch trigger is the
failure mode this decision must remove. Preview environments and a version
selector would solve a broader problem the site does not have until two
materially different released versions exist.

## Decision

Production is a local-source Deno Deploy application, not a GitHub-linked
default-branch application. The existing release workflow is the only production
publisher: a `v*` tag builds and publishes the binaries, then the site job
checks out that exact tag, verifies it matches `deno.json`'s version, builds the
site, and runs `deno deploy --prod`. The job authenticates with a
production-environment organization token and names the organization and app
through repository environment variables.

There is no production deploy on `main`, no preview deployment, no version
selector, and no manual deploy from an arbitrary checkout. Re-running the
release workflow for an existing tag is the recovery path.

## Consequences

- The public docs can lag an in-progress change on `main`, but can never lead
  the software users can install.
- A release tag is one source revision for binaries and site. A tag/version
  mismatch stops before production deployment.
- Deno Deploy must be created without automatic GitHub source builds, and the
  GitHub `production` environment must hold the token, organization, and app
  configuration.
- A failed site deployment leaves the previous release serving; there is no
  preview URL in this first release model.
