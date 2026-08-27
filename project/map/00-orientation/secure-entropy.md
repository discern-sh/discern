---
title: Secure entropy
description: How discern generates security-sensitive identifiers and bytes without weakening production randomness for tests.
order: 40
aliases:
  - secure random values
  - WebCrypto
  - random bytes
---

# Secure entropy

_Production identifiers, nonce values, and key material use WebCrypto through one injectable capability._

## Production source

[`SecureEntropy`](../../../src/shared/entropy.ts) provides identifier generation and caller-owned byte filling. `SYSTEM_SECURE_ENTROPY` implements those operations with WebCrypto. The contract omits a float-valued random function, so scheduling jitter cannot satisfy a secure-entropy dependency.

Host-facing functions default to the system implementation and pass the selected capability inward. Tests can provide finite deterministic values at the same seams. Production callers still receive WebCrypto unless their trusted boundary supplies another `SecureEntropy` implementation.

## Preserved contracts

Centralizing the source leaves identifier formats, nonce lengths, collision retries, continuation checksums, temporary names, and hash-based message authentication unchanged. The validation key remains 32 bytes. Its directory uses mode `0700`, its file uses mode `0600`, and crash reports use mode `0600`.

## Enforcement

[`SECURE_ENTROPY_PRIMITIVE_BOUNDARIES`](../../../src/shared/entropy.ts) records each direct WebCrypto operation with its path, function, operation, required security property, and reason. The structural guard binds calls and rows in both directions. An unenrolled call, wrapper, stale row, missing security property, or `Math.random` downgrade fails.

The `secure_entropy_primitive_boundaries` Standard holds this registry at a down-only limit of 2. Secure entropy and scheduling jitter remain separate ([ADR 0348](../_adr/0348-secure-entropy-is-a-webcrypto-capability.md)).
