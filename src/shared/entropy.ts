/** Cryptographically secure UUID and random-byte generation. */

/** The approved host primitive behind one secure-entropy operation. */
export type SecureEntropyPrimitiveOperation =
  | "crypto.getRandomValues"
  | "crypto.randomUUID"
  | "crypto.subtle.generateKey";

/** One exact direct host-entropy operation retained at the system boundary. */
export interface SecureEntropyPrimitiveBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: SecureEntropyPrimitiveOperation;
  readonly requiredSecurityProperty: string;
  readonly reason: string;
}

/** Preserve stable literal ids while checking the entropy registry shape. */
function defineSecureEntropyPrimitiveBoundaries<
  const Boundaries extends Readonly<
    Record<string, SecureEntropyPrimitiveBoundary>
  >,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Every direct secure-entropy primitive; consumers receive SecureEntropy. */
export const SECURE_ENTROPY_PRIMITIVE_BOUNDARIES =
  defineSecureEntropyPrimitiveBoundaries({
    "system-secure-byte-fill": {
      path: "src/shared/entropy.ts",
      enclosingFunction: "fillSystemSecureBytes",
      operation: "crypto.getRandomValues",
      requiredSecurityProperty:
        "cryptographic unpredictability for secret, nonce, and collision-resistant byte material",
      reason:
        "The system entropy adapter fills caller-owned bytes from WebCrypto without exposing a weaker source.",
    },
    "system-secure-uuid": {
      path: "src/shared/entropy.ts",
      enclosingFunction: "systemSecureUuid",
      operation: "crypto.randomUUID",
      requiredSecurityProperty:
        "cryptographic unpredictability and RFC 4122 UUID collision resistance",
      reason:
        "The system entropy adapter creates UUIDs through WebCrypto for secure and uniqueness-sensitive callers.",
    },
  });

/** Secure entropy only; scheduling jitter deliberately uses another type. */
export interface SecureEntropy {
  readonly uuid: () => string;
  readonly fillBytes: (bytes: Uint8Array<ArrayBuffer>) => void;
}

/** Generate one production UUID through the approved WebCrypto primitive. */
function systemSecureUuid(): string {
  return crypto.randomUUID();
}

/** Fill caller-owned production bytes through the approved WebCrypto primitive. */
function fillSystemSecureBytes(bytes: Uint8Array<ArrayBuffer>): void {
  crypto.getRandomValues(bytes);
}

/** Production secure entropy, backed solely by WebCrypto. */
export const SYSTEM_SECURE_ENTROPY: SecureEntropy = {
  uuid: systemSecureUuid,
  fillBytes: fillSystemSecureBytes,
};
