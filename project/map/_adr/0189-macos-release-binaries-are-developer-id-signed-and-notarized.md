# ADR 0189: macOS release binaries are Developer ID signed and notarized

**Status**: accepted

## Context

discern publishes one standalone executable for each macOS architecture. The installer downloads that executable, verifies its checksum, makes it executable, and places it on `PATH`. Keeping the raw asset preserves one install contract across macOS and Linux.

`deno compile` gives a macOS executable an ad-hoc signature. That is enough for a command-line download without a quarantine attribute. Safari and other browsers add quarantine, so Gatekeeper can refuse the same release asset when someone downloads it from GitHub Releases. Making the installer the only supported route would leave a signed-download gap in a release surface whose checksums and build provenance are otherwise verifiable.

Apple notarization requires Developer ID signing, a secure timestamp, and Hardened Runtime. Deno embeds V8. Enabling Hardened Runtime without its JIT entitlement makes the compiled executable fail during V8 startup, before discern can print its version. Apple can issue a notarization ticket for a standalone executable submitted inside a ZIP, but `stapler` cannot attach that ticket to the executable.

## Decision

Every macOS release matrix job imports one Developer ID Application certificate and App Store Connect notary credentials from GitHub Actions secrets into a temporary keychain. The job then:

1. signs the compiled executable with a secure timestamp, Hardened Runtime, the identifier `sh.discern.cli`, and only `com.apple.security.cs.allow-jit`;
2. runs the release smoke against those signed bytes;
3. submits a temporary ZIP containing the executable to Apple's notary service and waits for acceptance;
4. verifies the code signature and online notarization ticket;
5. creates the checksum and build-provenance attestation for the signed bytes, then uploads them; and
6. deletes the temporary keychain, certificate file, and submission archive.

The release continues to publish the raw executable. There is no `.pkg`, disk image, Developer ID Installer certificate, or stapling stage. A browser-downloaded binary therefore needs access to Apple's notary service when Gatekeeper first assesses it.

The ordinary repository gate also runs in full on a native Apple-silicon runner. It needs no release credential and catches platform defects before a tag reaches the credentialed release path.

## Consequences

- Gatekeeper can authenticate browser-downloaded release binaries against the Developer ID signature and Apple's notarization ticket.
- The installer URL and asset names remain unchanged. Checksums and GitHub provenance cover the bytes users receive after signing.
- V8 retains the executable-memory permission its JIT needs. No broader Hardened Runtime exception is granted.
- First execution of the raw browser asset cannot prove notarization while offline. Supporting that case later requires a staple-capable outer format such as a signed installer package or disk image.
- Release publication now depends on Apple account availability, certificate validity, five GitHub secrets, the timestamp service, and the notary service. Missing credentials fail before any macOS artifact is uploaded.
- Each release consumes one notarization submission per macOS architecture.

## Alternatives considered

- **Support only the command-line installer.** Rejected because it leaves GitHub's browser-download surface behind Gatekeeper's unidentified-developer warning.
- **Publish a signed and stapled installer package.** Rejected for the first release because it adds a second certificate type, packaging format, and install transaction while the raw executable remains necessary for the cross-platform installer. A package can be added later without weakening this decision.
- **Omit Hardened Runtime from the signature.** Rejected because it fails Apple's notarization contract.
