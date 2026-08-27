/** Deterministic SecureEntropy implementations for focused consumer tests. */

import type { SecureEntropy } from "../src/shared/entropy.ts";

export const TEST_SECURE_UUID = "12345678-1234-4123-8123-123456789abc";

export interface FakeSecureEntropyOptions {
  readonly uuids?: readonly string[];
  readonly byteFills?: readonly (number | Uint8Array)[];
  readonly observedByteLengths?: number[];
}

/** Return a finite deterministic entropy sequence that fails on over-consumption. */
export function fakeSecureEntropy(
  options: FakeSecureEntropyOptions = {},
): SecureEntropy {
  let uuidIndex = 0;
  let fillIndex = 0;
  return {
    uuid: (): string => {
      const values = options.uuids ?? [TEST_SECURE_UUID];
      const value = values[uuidIndex];
      uuidIndex += 1;
      if (value === undefined) {
        throw new Error("deterministic UUID sequence exhausted");
      }
      return value;
    },
    fillBytes: (target: Uint8Array): void => {
      options.observedByteLengths?.push(target.length);
      const fills = options.byteFills ?? [0];
      const value = fills[fillIndex];
      fillIndex += 1;
      if (value === undefined) {
        throw new Error("deterministic byte sequence exhausted");
      }
      if (typeof value === "number") {
        target.fill(value);
        return;
      }
      if (value.length !== target.length) {
        throw new Error(
          `deterministic byte sequence has ${value.length} bytes; expected ${target.length}`,
        );
      }
      target.set(value);
    },
  };
}
