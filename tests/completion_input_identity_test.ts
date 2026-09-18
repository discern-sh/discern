/** Validation input identity streams complete bytes: no size ceiling, no anonymous failure. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { writeLargeInput } from "./large_input.ts";
import { growOnNextRead } from "./read_growth.ts";
import { BOUNDED_CAPTURE_BYTES } from "../src/shared/bounded_file.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { bytesDigest } from "../src/engine/validation/artifacts.ts";
import {
  InputIdentityAccumulator,
  validationInputDiagnostic,
  ValidationInputError,
  validationInputFile,
} from "../src/engine/validation/input_identity.ts";
import { observeCandidateInputs } from "../src/engine/validation/inputs.ts";
import { observeValidationInputs } from "../src/engine/validation/runtime.ts";

/** The identity one complete decode establishes: the reference every stream must equal. */
async function completeIdentity(
  bytes: Uint8Array,
  mode: string,
): Promise<{ digest: string; bytes: number; lines: number; words: number }> {
  const text = new TextDecoder().decode(bytes);
  return {
    digest: await sha256Hex(JSON.stringify([mode, await bytesDigest(bytes)])),
    bytes: bytes.length,
    lines: text.split("\n").length - 1,
    words: text.split(/\s+/u).filter(Boolean).length,
  };
}

/** Bytes that exercise every boundary a chunked decode can split. */
function adversarialBytes(): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    Uint8Array.of(0xef, 0xbb, 0xbf), // leading BOM, stripped by the decoder
    encoder.encode("word  two\tthree\r\nfour\n\n"),
    encoder.encode("no break line sep﻿bom"), // NBSP, LINE SEPARATOR, PARAGRAPH SEPARATOR, BOM
    encoder.encode(" \u{1F600}emoji\u{1F600} mixed\u{1F600}"),
    Uint8Array.of(0xff, 0x80, 0xc3), // invalid lead, lone continuation, truncated pair
    encoder.encode("afternext　ideographic\n"), // NEL, IDEOGRAPHIC SPACE
    Uint8Array.of(0, 0, 0x0a, 0),
    encoder.encode("tail"),
    Uint8Array.of(0xe2, 0x82), // truncated 3-byte sequence at EOF
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

Deno.test("streamed input identity equals one complete decode at every chunk boundary", async () => {
  const bytes = adversarialBytes();
  for (const mode of ["100644", "100755"]) {
    const expected = await completeIdentity(bytes, mode);
    assertEquals(await validationInputFile(bytes, mode), expected);
    for (const step of [1, 2, 3, 4, 5, 7, 11, 13, 17, 64, bytes.length + 1]) {
      const identity = new InputIdentityAccumulator();
      for (let offset = 0; offset < bytes.length; offset += step) {
        identity.update(bytes.subarray(offset, offset + step));
      }
      assertEquals(await identity.finish(mode), expected, `step ${step}`);
    }
  }
  assertEquals(
    await validationInputFile(new Uint8Array(), "100644"),
    await completeIdentity(new Uint8Array(), "100644"),
  );
});

Deno.test("checkout and candidate observers agree above the bounded-capture ceiling", async () => {
  await withTempDir(async (root) => {
    const size = BOUNDED_CAPTURE_BYTES + 1;
    await writeLargeInput(join(root, "large"), size);
    await Deno.writeTextFile(join(root, "small"), "one two\n");
    await gitInit(root);
    await writeLargeInput(join(root, "untracked"), size);
    const head = await gitOut(root, "rev-parse", "HEAD");
    const live = await observeValidationInputs(root);
    const candidate = await observeCandidateInputs(root, head);
    assertEquals(live.files.large, candidate.files.large);
    assertEquals(live.files.small, candidate.files.small);
    assertEquals(live.files.large, {
      digest: live.files.large?.digest ?? "",
      bytes: size,
      lines: 2,
      words: 4,
    });
    assertEquals(live.files.untracked?.bytes, size);
    assertEquals(candidate.files.untracked, undefined);
    assert(live.complete && candidate.complete);
  });
});

Deno.test("input observation failures name the input and present as diagnostics", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readable"), "ok\n");
    await Deno.writeTextFile(join(root, "sealed"), "secret\n");
    await gitInit(root);
    await Deno.chmod(join(root, "sealed"), 0o000);
    try {
      const error = await assertRejects(
        () => observeValidationInputs(root),
        ValidationInputError,
        "cannot be read",
      );
      assertEquals(error.path, "sealed");
      assertStringIncludes(error.message, '"sealed"');
      const diagnostic = validationInputDiagnostic(error);
      assertEquals(diagnostic.tool, "validation-inputs");
      assertEquals(diagnostic.file, "sealed");
      assertEquals(diagnostic.severity, "error");
      assertStringIncludes(diagnostic.reproduce_cmd, "git ls-files");
      assertStringIncludes(diagnostic.reproduce_cmd, "sealed");
    } finally {
      await Deno.chmod(join(root, "sealed"), 0o644);
    }
    await Deno.mkdir(join(root, "module"));
    await git(join(root, "module"), "init", "-q");
    const nested = await assertRejects(
      () => observeValidationInputs(root),
      ValidationInputError,
      "Git directory record",
    );
    assertEquals(nested.path, "module/");
    assertEquals(validationInputDiagnostic(nested).file, "module/");
    const enumeration = validationInputDiagnostic(
      new ValidationInputError("Validation inputs cannot be enumerated."),
    );
    assertEquals(enumeration.file, undefined);
    assertEquals(
      enumeration.reproduce_cmd,
      "git ls-files --cached --others --exclude-standard",
    );
  });
});

Deno.test("a checkout input that changes while observed is refused by name", async () => {
  await withTempDir(async (root) => {
    const moving = join(root, "moving");
    await Deno.writeTextFile(moving, "steady\n");
    await gitInit(root);
    const restore = await growOnNextRead(moving, "growth\n");
    try {
      const error = await assertRejects(
        () => observeValidationInputs(root),
        ValidationInputError,
        "changed while",
      );
      assertEquals(error.path, "moving");
    } finally {
      restore();
    }
  });
});
