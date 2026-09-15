/** Secure-entropy production defaults, injection, formats, and separation. */

import { assertEquals, assertMatch } from "@std/assert";
import {
  SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
  SYSTEM_SECURE_ENTROPY,
} from "../src/shared/entropy.ts";
import { generateWorktreeId } from "../src/engine/worktree/identity.ts";
import { responseNonce } from "../site/seo.tsx";
import { mcpSessionId } from "../src/engine/mcp/server.ts";
import { fakeSecureEntropy, TEST_SECURE_UUID } from "./fake_secure_entropy.ts";

Deno.test("production secure entropy stays WebCrypto-shaped", () => {
  const uuid = SYSTEM_SECURE_ENTROPY.uuid();
  assertMatch(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );

  const bytes = new Uint8Array(32).fill(0xa5);
  SYSTEM_SECURE_ENTROPY.fillBytes(bytes);
  assertEquals(bytes.length, 32);
  assertEquals(Object.keys(SECURE_ENTROPY_PRIMITIVE_BOUNDARIES), [
    "system-secure-byte-fill",
    "system-secure-uuid",
  ]);
});

Deno.test("deterministic entropy preserves UUID, nonce, and worktree formats", () => {
  const observedByteLengths: number[] = [];
  const entropy = fakeSecureEntropy({
    uuids: [TEST_SECURE_UUID],
    byteFills: [
      Uint8Array.from({ length: 18 }, (_, index) => index),
      new Uint8Array(4),
      new Uint8Array(4),
      new Uint8Array([0xab, 0xcd, 0xef]),
    ],
    observedByteLengths,
  });

  assertEquals(mcpSessionId(entropy), "mcp:12345678");
  assertEquals(responseNonce(entropy), "AAECAwQFBgcICQoLDA0ODxAR");
  assertEquals(generateWorktreeId(undefined, entropy), {
    id: "amber-beacon-abcdef",
    source: "codename",
  });
  assertEquals(observedByteLengths, [18, 4, 4, 3]);
});

Deno.test("production defaults retain nonce and identity wire formats", () => {
  const nonce = responseNonce();
  assertEquals(
    Uint8Array.from(atob(nonce), (value) => value.charCodeAt(0)).length,
    18,
  );
  assertMatch(
    generateWorktreeId("secure entropy").id,
    /^secure-entropy-[0-9a-f]{6}$/u,
  );
});
