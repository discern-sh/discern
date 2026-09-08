import {
  selectedValidationBoundary,
  selectedValidationInput,
  type ValidationInputSelection,
} from "./input_selection.ts";
/** Immutable Git subjects use the same content and executable-mode identity as live validation. */
import { runGit } from "../../shared/subprocess.ts";
import { ObjectIdSchema } from "../completion/identity.ts";
import { PRODUCER_CAPTURE_BYTES } from "../jobs/captured.ts";
import { bytesDigest } from "./artifacts.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { ValidationInputs } from "./catalog.ts";

/** Git's portable file mode, complete bytes and extent counters define an input observation. */
export async function validationInputFile(
  bytes: Uint8Array,
  mode: string,
): Promise<ValidationInputs["files"][string]> {
  const text = new TextDecoder().decode(bytes);
  return {
    digest: await sha256Hex(JSON.stringify([mode, await bytesDigest(bytes)])),
    bytes: bytes.length,
    lines: text.split("\n").length - 1,
    words: text.split(/\s+/u).filter(Boolean).length,
  };
}

interface InputBlob {
  readonly path: string;
  readonly id: string;
  readonly mode: string;
  readonly size: number;
}

/** Batch reads stay byte bounded and verify every returned object before interpreting its bytes. */
async function readInputBatch(
  root: string,
  batch: readonly InputBlob[],
  files: Record<string, ValidationInputs["files"][string]>,
): Promise<void> {
  const result = await runGit(["cat-file", "--batch"], {
    cwd: root,
    stdin: batch.map((entry) => entry.id).join("\n") + "\n",
    timeoutMs: 60_000,
    maxOutputBytes: PRODUCER_CAPTURE_BYTES + 32_768,
  });
  if (!result.success || result.stdoutBytes === undefined) {
    throw new Error(
      "Candidate input capture was unavailable or exceeded its declared byte bound.",
    );
  }
  const bytes = result.stdoutBytes;
  let offset = 0;
  for (const entry of batch) {
    const end = bytes.indexOf(10, offset);
    if (
      end < 0 ||
      new TextDecoder().decode(bytes.subarray(offset, end)) !==
        `${entry.id} blob ${entry.size}`
    ) {
      throw new Error(
        "Candidate input capture names another Git object or size.",
      );
    }
    offset = end + 1;
    if (
      offset + entry.size >= bytes.length || bytes[offset + entry.size] !== 10
    ) throw new Error("Candidate input capture is truncated.");
    files[entry.path] = await validationInputFile(
      bytes.subarray(offset, offset + entry.size),
      entry.mode,
    );
    offset += entry.size + 1;
  }
  if (offset !== bytes.length) {
    throw new Error("Candidate input capture contains unrequested bytes.");
  }
}

/** Read a pinned tree without checking it out or trusting a restored source checkout's contents. */
export async function observeCandidateInputs(
  root: string,
  commit: string,
  toolchain: readonly string[] = [],
  selection?: ValidationInputSelection,
): Promise<ValidationInputs> {
  ObjectIdSchema.parse(commit);
  const result = await runGit(["ls-tree", "-r", "-l", "-z", commit], {
    cwd: root,
    timeoutMs: 60_000,
    maxOutputBytes: PRODUCER_CAPTURE_BYTES,
  });
  if (!result.success) {
    throw new Error("Cannot enumerate the immutable candidate input tree.");
  }
  const entries: InputBlob[] = result.stdout.split("\0").filter(Boolean).filter(
    (row) => {
      const tab = row.indexOf("\t");
      if (tab < 0) throw new Error("Candidate input metadata is incomplete.");
      return row.startsWith("160000 commit ")
        ? selectedValidationBoundary(row.slice(tab + 1), selection)
        : selectedValidationInput(row.slice(tab + 1), selection);
    },
  ).map(
    (row) => {
      const match =
        /^(100644|100755|120000) blob ([0-9a-f]+) +([0-9]+)\t([\s\S]+)$/u.exec(
          row,
        );
      if (
        match === null || match[1] === undefined || match[2] === undefined ||
        match[3] === undefined || match[4] === undefined
      ) {
        throw new Error(
          "Candidate input is not a supported complete Git blob.",
        );
      }
      const size = Number(match[3]);
      if (
        !Number.isSafeInteger(size) || size > PRODUCER_CAPTURE_BYTES
      ) {
        throw new Error(
          "A candidate input exceeds the complete capture bound.",
        );
      }
      return {
        mode: match[1],
        id: ObjectIdSchema.parse(match[2]),
        size,
        path: match[4],
      };
    },
  ).sort((a, b) => a.path.localeCompare(b.path));
  const files: Record<string, ValidationInputs["files"][string]> = {};
  let batch: InputBlob[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (
      batch.length >= 128 ||
      (batch.length > 0 && bytes + entry.size > PRODUCER_CAPTURE_BYTES)
    ) {
      await readInputBatch(root, batch, files);
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += entry.size;
  }
  if (batch.length > 0) await readInputBatch(root, batch, files);
  return {
    files,
    complete: toolchain.every((path) => Object.hasOwn(files, path)),
  };
}
