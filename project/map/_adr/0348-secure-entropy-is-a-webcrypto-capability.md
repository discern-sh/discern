# ADR 0348: Secure entropy is a WebCrypto-backed capability

**Status**: accepted. Extends the host-boundary doctrine from [ADR 0336](0336-ambient-process-state-resolves-at-boundaries.md), exact boundary enrollment from [ADR 0344](0344-process-egress-and-termination-have-exact-boundaries.md), and the randomness separation in [ADR 0347](0347-clock-scheduler-and-jitter-are-explicit-capabilities.md).

## Context

Production code generated identifiers, nonce bytes, key material, continuation handles, and secure names through direct WebCrypto calls. The scattered calls obscured their security properties and prevented deterministic consumer tests.

Scheduling jitter already had an injected policy backed by `Math.random`. That source satisfies bounded retry variation. It cannot satisfy cryptographic unpredictability or collision resistance. A shared randomness interface would let a deterministic jitter fake reach security-sensitive consumers, or would give scheduling code a security capability it does not require.

These consumers also preserve formats, collision behavior, algorithms, and file permissions. Centralizing the host read could not change those contracts.

## Decision

[`SecureEntropy`](../../../src/shared/entropy.ts) provides cryptographic identifiers and caller-owned bytes through `uuid()` and `fillBytes(bytes)`. It exposes no float-valued random function. Production boundaries use the WebCrypto-backed `SYSTEM_SECURE_ENTROPY`.

Host-facing functions may default to the system implementation and pass it inward. Tests inject finite deterministic implementations at the same seams. The contract cannot accept scheduling jitter, `Math.random`, timestamps, counters, predictable input, or seeded pseudo-random generators.

Identifier representations, nonce lengths, worktree suffixes, continuation checksums and retries, and temporary names remain unchanged. Validation still imports a 32-byte key through WebCrypto. Its directory and file retain modes `0700` and `0600`. Crash reports retain mode `0600`.

`SECURE_ENTROPY_PRIMITIVE_BOUNDARIES` owns every direct production primitive by stable id, path, function, operation, security property, and reason. The structural rule covers live `crypto.randomUUID`, `crypto.getRandomValues`, and `crypto.subtle.generateKey` spellings, including wrappers. Calls and rows bind in both directions.

The `secure_entropy_primitive_boundaries` Standard holds the validated population at a down-only limit of 2. A separate jitter rule rejects a planted `Math.random` downgrade.

## Consequences

- Focused tests can select identifier values and byte sequences without changing global runtime state.
- Production callers retain WebCrypto as their default and cannot receive the weaker scheduling-jitter type through the secure-entropy seam.
- Persisted formats, collision behavior, key handling, and permissions remain compatible.
- A new WebCrypto entropy primitive fails until its security property and system owner enter the registry.
- Wrappers remain subject to enrollment, and the boundary population cannot grow without an owner decision.
- The capability parameter adds wiring below composition roots. That cost keeps host entropy visible and lets retry and collision behavior receive deterministic inputs.

## Alternatives considered

- **Use the jitter function for every random value.** Rejected because `Math.random` does not provide the security properties required by secrets, nonce values, universally unique identifiers, or collision-resistant names.
- **Provide a generic `random()` member backed by WebCrypto.** Rejected because a float does not express identifier or byte requirements and would make secure and non-security policy interchangeable at call sites.
- **Seed a production pseudo-random generator for repeatability.** Rejected because a predictable seed weakens cryptographic unpredictability.
- **Keep direct WebCrypto calls.** Rejected because consumers could not control collision and retry inputs, and future reads would remain unenrolled.
- **Permit any shared wrapper.** Rejected because a path-wide exemption could add another entropy authority without a security claim or census entry.
- **Redesign key algorithms or identifier formats during centralization.** Rejected because the task changes the entropy source boundary, while the existing algorithms and representations remain interoperable.
