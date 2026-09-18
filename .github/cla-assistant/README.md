# CLA Assistant payload

Contributor intake is inactive. Nothing in this directory configures or activates a GitHub App, check, webhook, or hosted service.

[`metadata`](metadata) is a generated source file for the private Gist that CLA Assistant may read after activation. Its producer is [`scripts/contributor_agreement.ts`](../../scripts/contributor_agreement.ts); `deno task codegen` refreshes it. The agreement itself remains at [`CLA.md`](../../CLA.md).

The maintainer's private release runbook owns the later activation sequence. Do not create the Gist, install or configure CLA Assistant, or accept an external contribution until that sequence records the storage and privacy details and changes the repository's intake status coherently.
