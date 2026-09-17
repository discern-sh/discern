/** One streaming identity for every validation input: complete bytes, no size ceiling. */
import { createHash, type Hash } from "crypto";
import { quoteCommandWord } from "../../shared/command_evidence.ts";
import type { Diagnostic } from "../../shared/result.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { ValidationInputs } from "./catalog.ts";

export type ValidationInputIdentity = ValidationInputs["files"][string];

/**
 * An observation that cannot establish a declared input's identity. The
 * message names the input so the reader can act on it; `path` carries the
 * same name for the diagnostic's file field.
 */
export class ValidationInputError extends Error {
  readonly path: string | undefined;
  constructor(message: string, path?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidationInputError";
    this.path = path;
  }
}

/** The tool label every validation-input diagnostic carries. */
export const VALIDATION_INPUTS_TOOL = "validation-inputs";

/** The stable class identifier a metadata-only reduction keeps. */
export const VALIDATION_INPUT_RULE = "validation-input";

/** Present one observation failure as a gate diagnostic. */
export function validationInputDiagnostic(
  error: ValidationInputError,
): Diagnostic {
  return {
    tool: VALIDATION_INPUTS_TOOL,
    severity: "error",
    message: error.message,
    rule: VALIDATION_INPUT_RULE,
    reproduce_cmd: [
      "git ls-files --cached --others --exclude-standard",
      ...(error.path === undefined ? [] : ["--", quoteCommandWord(error.path)]),
    ].join(" "),
    ...(error.path === undefined ? {} : { file: error.path }),
  };
}

const WHITESPACE_RUN = /\s+/u;
const LEADING_WHITESPACE = /^\s/u;
const TRAILING_WHITESPACE = /\s$/u;

/**
 * Accumulate an input's identity from its bytes in arrival order. The digest,
 * line count and word count equal those of one decode of the complete bytes,
 * while the accumulator retains only the hash state and one decoder.
 */
export class InputIdentityAccumulator {
  readonly #hash: Hash = createHash("sha256");
  readonly #decoder = new TextDecoder();
  #bytes = 0;
  #lines = 0;
  #words = 0;
  /** Whether the decoded text so far ends inside a word. */
  #openWord = false;

  update(chunk: Uint8Array): void {
    this.#bytes += chunk.length;
    this.#hash.update(chunk);
    this.#count(this.#decoder.decode(chunk, { stream: true }));
  }

  /** Git's portable file mode joins the content digest to form the identity. */
  async finish(mode: string): Promise<ValidationInputIdentity> {
    this.#count(this.#decoder.decode());
    return {
      digest: await sha256Hex(
        JSON.stringify([mode, this.#hash.digest("hex")]),
      ),
      bytes: this.#bytes,
      lines: this.#lines,
      words: this.#words,
    };
  }

  #count(text: string): void {
    if (text === "") return;
    let at = text.indexOf("\n");
    while (at !== -1) {
      this.#lines += 1;
      at = text.indexOf("\n", at + 1);
    }
    let words = 0;
    for (const part of text.split(WHITESPACE_RUN)) {
      if (part !== "") words += 1;
    }
    // A word continuing across the chunk boundary was already counted.
    if (this.#openWord && !LEADING_WHITESPACE.test(text)) words -= 1;
    this.#words += words;
    this.#openWord = !TRAILING_WHITESPACE.test(text);
  }
}

/** Identity of bytes already in memory: link text and immutable Git blobs. */
export async function validationInputFile(
  bytes: Uint8Array,
  mode: string,
): Promise<ValidationInputIdentity> {
  const identity = new InputIdentityAccumulator();
  identity.update(bytes);
  return await identity.finish(mode);
}

/** Bytes read per step; a checkout observation holds at most one step in memory. */
const IDENTITY_READ_BYTES = 1024 * 1024;

/** The file's inode, size or timestamps moved between the first and last look. */
function changedWhileObserved(path: string): ValidationInputError {
  return new ValidationInputError(
    `Validation input ${
      JSON.stringify(path)
    } changed while its identity was being observed. Let concurrent writers settle, then re-run the current discern command.`,
    path,
  );
}

/**
 * Observe one regular checkout file's complete identity while it stays the
 * same inode with unchanged size, mtime and ctime through EOF. `observed` is
 * the caller's lstat of the same path, which supplies the executable mode.
 */
export async function observeCheckoutInputFile(
  safe: string,
  path: string,
  observed: Deno.FileInfo,
): Promise<ValidationInputIdentity> {
  const mode = ((observed.mode ?? 0) & 0o111) === 0 ? "100644" : "100755";
  let file: Deno.FsFile;
  try {
    file = await Deno.open(safe, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw changedWhileObserved(path);
    throw new ValidationInputError(
      `Validation input ${JSON.stringify(path)} cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }. Restore read access to the file or move it outside the checkout, then re-run the current discern command.`,
      path,
      { cause: error },
    );
  }
  try {
    const before = await file.stat();
    if (
      !before.isFile || before.ino !== observed.ino ||
      before.dev !== observed.dev
    ) throw changedWhileObserved(path);
    const identity = new InputIdentityAccumulator();
    const buffer = new Uint8Array(IDENTITY_READ_BYTES);
    let length = 0;
    while (true) {
      const read = await file.read(buffer);
      if (read === null) break;
      length += read;
      if (length > before.size) throw changedWhileObserved(path);
      identity.update(buffer.subarray(0, read));
    }
    const after = await file.stat();
    let current: Deno.FileInfo;
    try {
      current = await Deno.lstat(safe);
    } catch {
      throw changedWhileObserved(path);
    }
    if (
      current.isSymlink || current.ino !== before.ino ||
      current.dev !== before.dev ||
      length !== before.size || after.size !== before.size ||
      after.mtime?.getTime() !== before.mtime?.getTime() ||
      after.ctime?.getTime() !== before.ctime?.getTime()
    ) throw changedWhileObserved(path);
    return await identity.finish(mode);
  } finally {
    file.close();
  }
}
