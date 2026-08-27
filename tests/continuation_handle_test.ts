/** Agent-relay continuation handle grammar and typo-detection guard. */

import { assert, assertEquals } from "@std/assert";
import {
  CONTINUATION_HANDLE_LENGTH,
  CONTINUATION_HANDLE_PATTERN,
  createContinuationHandle,
  normalizeContinuationHandle,
} from "../src/shared/continuation_handle.ts";
import { ContinuationHandleSchema } from "../src/shared/result_schemas.ts";
import { fakeSecureEntropy } from "./fake_secure_entropy.ts";
import type { SecureEntropy } from "../src/shared/entropy.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SYMBOL_POSITIONS = [3, 4, 5, 6, 8, 9, 10, 11, 13, 14] as const;

/** Supply stable entropy so continuation wire-format assertions never depend on randomness. */
function deterministicEntropy(): SecureEntropy {
  return fakeSecureEntropy({
    byteFills: [new Uint8Array([1, 7, 12, 18, 23, 27, 29, 31])],
  });
}

Deno.test("continuation handles have one bounded canonical wire form", () => {
  const handle = createContinuationHandle(deterministicEntropy());
  assertEquals(handle, "C1-17CJ-QVXZ-HM");
  assertEquals(handle.length, CONTINUATION_HANDLE_LENGTH);
  assert(CONTINUATION_HANDLE_PATTERN.test(handle));
  assertEquals(normalizeContinuationHandle(handle), handle);
  assertEquals(normalizeContinuationHandle(handle.toLowerCase()), handle);
  assert(ContinuationHandleSchema.safeParse(handle).success);
  assertEquals(
    ContinuationHandleSchema.safeParse(`prefix-${handle}`).success,
    false,
  );
});

Deno.test("the continuation checksum rejects every one-symbol substitution", () => {
  const handle = createContinuationHandle(deterministicEntropy());
  for (const position of SYMBOL_POSITIONS) {
    const original = handle[position];
    assert(original !== undefined);
    for (const replacement of ALPHABET) {
      if (replacement === original) continue;
      const changed = `${handle.slice(0, position)}${replacement}${
        handle.slice(position + 1)
      }`;
      assertEquals(
        normalizeContinuationHandle(changed),
        undefined,
        `position ${position}: ${changed}`,
      );
    }
  }
});

Deno.test("the continuation checksum rejects every adjacent data transposition", () => {
  const handle = createContinuationHandle(deterministicEntropy());
  const dataPositions = SYMBOL_POSITIONS.slice(0, 8);
  for (let index = 0; index < dataPositions.length - 1; index++) {
    const left = dataPositions[index];
    const right = dataPositions[index + 1];
    assert(left !== undefined && right !== undefined);
    const chars = [...handle];
    const before = chars[left];
    const after = chars[right];
    assert(before !== undefined && after !== undefined && before !== after);
    chars[left] = after;
    chars[right] = before;
    assertEquals(normalizeContinuationHandle(chars.join("")), undefined);
  }
});
