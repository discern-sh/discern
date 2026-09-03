# ADR 0364: Public release follows a staged repository transition

**Status**: accepted

## Context

discern reaches its first public release from a private repository that still carries private planning history, a temporary personal-account repository slug, and release conditions needed only while GitHub reports the repository as private. Those facts cannot change atomically. A tag is immutable once pushed, repository transfer and visibility are owner-held effects, and a release produced between the wrong two steps would permanently advertise missing provenance or an inaccessible installer.

The repository also contains material with different publication roles. Numbered Map pages and decisions can publish as documentation, `_internal` contains useful maintainer authorities, and `_private` contains the launch overlay that must not enter the public graph. The issue tracker can open before the project is ready to accept outside code or contributor agreements.

## Decision

**The first release is a staged, stop-on-failure transition, and the release workflow enforces the irreversible boundary.**

- `DISCERN_REPOSITORY_SLUG` is the repository-identity authority. It remains `jackwh/discern` while the repository is private and changes to the permanent `discern-sh/discern` slug only after the owner scrubs and transfers the repository. TypeScript consumers and generated projections derive from it; standalone shell and authored-text projections are enumerated and structurally guarded. The public installation identity is already `curl -fsSL https://discern.sh/install | sh`; the raw GitHub command is a fallback and release-verification route.
- A `v*` tag is valid only after GitHub reports the repository as public. The release plan refuses a private tag before it creates a build matrix, and there is no dispatch flag or override. After visibility changes, a separate 8A transition removes the private-only provenance, macOS, and WSL 2 conditions before the first tag.
- Release membership derives from `BUILD_TARGETS`, and every workflow takes one exact Deno version from `.dvmrc`. discern publishes macOS and Linux binaries. WSL 2 runs the Linux binary and remains the only supported Windows path; no native Windows artifact or workflow is introduced.
- The `_internal` Map tier is deliberately tracked and publishes with the repository as inspectable maintainer guidance, while remaining outside the public documentation site and product contract. The `_private` tier is removed from the public history and restored locally from its separate access-controlled repository. The complete `art/` tree remains tracked: terminal art is product source and browser art is a loopback-only development gallery.
- `project/TODO.md` remains a public, evidence-backed account of outstanding work, including marketing and positioning work. Its entries are not a promised roadmap; personal heading taxonomy and stale completed work do not belong there, while private research stays in the `_private` overlay.
- Repository visibility does not activate contributor intake. Issues, the code of conduct, and security reporting are available at launch, while pull requests, hosted individual agreements, and private corporate-agreement intake remain inactive. A post-launch procedure activates those paths together before any external Contribution is accepted.
- The owner-operated history rewrite removes only lines beginning exactly `Claude-Session:` from commit messages, preserves the total `Co-Authored-By:` population, and performs the already-decided discern-bot identity normalization. No repository Git hook enforces this policy.

## Consequences

- One private-stage commit can prepare and test every local mechanism without pretending that transfer, visibility, hosted credentials, or history rewriting happened. The private repository cannot accidentally turn a tag into a partial release contract.
- The transfer requires one repository-authority change, regeneration, and updates to the explicit non-TypeScript projection registry. A missed literal or generated output fails locally before the change can land.
- Public repository readers can inspect the product's brand and release authorities, but internal market hypotheses are visibly maintainer material rather than public product documentation. The private overlay requires a separate archive and local reattachment after the rewrite.
- Windows users need WSL 2. A native Windows executable remains possible only as a later, separately designed support contract.
- The first public repository may receive issues but cannot accept outside code immediately. Contributor activation is intentionally a later operational milestone, not an implicit consequence of visibility.

## Alternatives considered

- **Tag while private and make the repository public afterward.** Rejected because private-repository conditions can skip artifacts or provenance on an immutable tag.
- **Flip every repository URL by search-and-replace.** Rejected because compiled and generated consumers would regain multiple authorities, and a future file could silently escape the sweep.
- **Hide `_internal` with the private overlay.** Rejected because the generated claim and voice authorities make the public repository more inspectable and contain no secret material; their repo-only posture states the boundary directly.
- **Activate contributor agreements at the same time as visibility.** Rejected because hosted acceptance, corporate records, privacy details, and required checks need an independent end-to-end verification before they can bind a contribution.
