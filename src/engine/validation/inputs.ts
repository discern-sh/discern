import {
  selectedValidationBoundary,
  selectedValidationInput,
  type ValidationInputSelection,
} from "./input_selection.ts";
/** Immutable Git subjects use the same content and executable-mode identity as live validation. */
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  SEPARATOR_PATTERN,
} from "@std/path";
import { z } from "@zod/zod";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { ObjectIdSchema } from "../completion/identity.ts";
import { PRODUCER_CAPTURE_BYTES } from "../jobs/captured.ts";
import {
  InputIdentityAccumulator,
  ValidationInputError,
  type ValidationInputIdentity,
} from "./input_identity.ts";
import type { ValidationInputs } from "./catalog.ts";

interface InputBlob {
  readonly path: string;
  readonly id: string;
  readonly mode: string;
  readonly size: number;
}

/** Object ids per `git cat-file --batch` request; the reply streams regardless of blob size. */
const INPUT_BATCH_ENTRIES = 1024;

/** A batch header is one short ASCII line; anything longer is not the requested protocol. */
const BATCH_HEADER_LIMIT = 256;

/**
 * Consume `git cat-file --batch` output as it arrives. Each requested object is
 * verified against its expected header before its bytes reach the identity
 * accumulator, so a blob of any size is observed without being retained. A
 * protocol mismatch is recorded, never thrown through the stream reader.
 */
class BatchFrameParser {
  readonly #entries: readonly InputBlob[];
  readonly #files: Record<string, ValidationInputIdentity>;
  #index = 0;
  #state: "header" | "body" | "trailer" | "done" = "header";
  #header: number[] = [];
  #remaining = 0;
  #identity: InputIdentityAccumulator | undefined;
  #settled: Promise<void> = Promise.resolve();
  failure: ValidationInputError | undefined;

  constructor(
    entries: readonly InputBlob[],
    files: Record<string, ValidationInputIdentity>,
  ) {
    this.#entries = entries;
    this.#files = files;
  }

  /** Feed arriving bytes; returns false once the batch can no longer be trusted. */
  feed(chunk: Uint8Array): boolean {
    if (this.failure !== undefined) return false;
    try {
      this.#consume(chunk);
      return true;
    } catch (error) {
      this.failure = error instanceof ValidationInputError
        ? error
        : new ValidationInputError(
          error instanceof Error ? error.message : String(error),
          undefined,
          { cause: error },
        );
      return false;
    }
  }

  /** Wait for every finished identity, then confirm the whole batch arrived. */
  async complete(): Promise<void> {
    await this.#settled;
    if (this.failure !== undefined) throw this.failure;
    if (this.#state !== "done") {
      throw new ValidationInputError(
        `Candidate input capture is truncated at ${
          JSON.stringify(this.#entries[this.#index]?.path ?? "the batch end")
        }.`,
        this.#entries[this.#index]?.path,
      );
    }
  }

  #consume(chunk: Uint8Array): void {
    let offset = 0;
    while (offset < chunk.length || this.#state === "body") {
      const entry = this.#entries[this.#index];
      if (this.#state === "done" || entry === undefined) {
        throw new ValidationInputError(
          "Candidate input capture contains unrequested bytes.",
        );
      }
      if (this.#state === "header") {
        const end = chunk.indexOf(10, offset);
        const stop = end < 0 ? chunk.length : end;
        for (let at = offset; at < stop; at += 1) {
          this.#header.push(chunk[at] ?? 0);
        }
        if (this.#header.length > BATCH_HEADER_LIMIT) {
          throw new ValidationInputError(
            `Candidate input capture names another Git object or size at ${
              JSON.stringify(entry.path)
            }.`,
            entry.path,
          );
        }
        if (end < 0) return;
        offset = end + 1;
        const header = new TextDecoder().decode(Uint8Array.from(this.#header));
        this.#header = [];
        if (header !== `${entry.id} blob ${entry.size}`) {
          throw new ValidationInputError(
            `Candidate input capture names another Git object or size at ${
              JSON.stringify(entry.path)
            }.`,
            entry.path,
          );
        }
        this.#identity = new InputIdentityAccumulator();
        this.#remaining = entry.size;
        this.#state = "body";
        continue;
      }
      if (this.#state === "body") {
        const take = Math.min(this.#remaining, chunk.length - offset);
        if (take > 0) {
          this.#identity?.update(chunk.subarray(offset, offset + take));
          offset += take;
          this.#remaining -= take;
        }
        if (this.#remaining > 0) return;
        const identity = this.#identity;
        this.#identity = undefined;
        if (identity !== undefined) {
          const { path, mode } = entry;
          this.#settled = this.#settled.then(async () => {
            this.#files[path] = await identity.finish(mode);
          });
        }
        this.#state = "trailer";
        continue;
      }
      if (chunk[offset] !== 10) {
        throw new ValidationInputError(
          `Candidate input capture is truncated at ${
            JSON.stringify(entry.path)
          }.`,
          entry.path,
        );
      }
      offset += 1;
      this.#index += 1;
      this.#state = this.#index === this.#entries.length ? "done" : "header";
    }
  }
}

/** Stream one batch of immutable blobs through the identity accumulator. */
async function readInputBatch(
  root: string,
  batch: readonly InputBlob[],
  files: Record<string, ValidationInputIdentity>,
): Promise<void> {
  const parser = new BatchFrameParser(batch, files);
  const abort = new AbortController();
  let result: GitResult | undefined;
  try {
    result = await runGit(["cat-file", "--batch"], {
      cwd: root,
      stdin: batch.map((entry) => entry.id).join("\n") + "\n",
      timeoutMs: 60_000,
      maxOutputBytes: PRODUCER_CAPTURE_BYTES,
      signal: abort.signal,
      stdoutSink: (chunk) => {
        if (!parser.feed(chunk)) abort.abort();
      },
    });
  } catch (error) {
    if (parser.failure === undefined) throw error;
  }
  await parser.complete();
  if (result === undefined || !result.success) {
    throw new ValidationInputError(
      "Candidate input capture was unavailable or exceeded its declared byte bound.",
    );
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
    throw new ValidationInputError(
      "Cannot enumerate the immutable candidate input tree.",
    );
  }
  const entries: InputBlob[] = result.stdout.split("\0").filter(Boolean).filter(
    (row) => {
      const tab = row.indexOf("\t");
      if (tab < 0) {
        throw new ValidationInputError(
          "Candidate input metadata is incomplete.",
        );
      }
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
        const tab = row.indexOf("\t");
        const path = tab < 0 ? undefined : row.slice(tab + 1);
        throw new ValidationInputError(
          `Candidate input ${
            path === undefined ? "" : `${JSON.stringify(path)} `
          }is not a supported complete Git blob. Commit or reconcile the nested repository before validating this source.`,
          path,
        );
      }
      const size = Number(match[3]);
      if (!Number.isSafeInteger(size)) {
        throw new ValidationInputError(
          `Candidate input ${
            JSON.stringify(match[4])
          } declares an unreadable size.`,
          match[4],
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
  const files: Record<string, ValidationInputIdentity> = {};
  for (let start = 0; start < entries.length; start += INPUT_BATCH_ENTRIES) {
    await readInputBatch(
      root,
      entries.slice(start, start + INPUT_BATCH_ENTRIES),
      files,
    );
  }
  return {
    files,
    complete: toolchain.every((path) => Object.hasOwn(files, path)),
  };
}

/** Checkout names are literal filesystem data outside Git administration. */
const CheckoutPathSchema = z.string().min(1).refine(
  (path) =>
    !isAbsolute(path) && normalize(path) === path &&
    !/[\0�]/u.test(path) &&
    !path.split(SEPARATOR_PATTERN).some((part) =>
      part === "" || part === "." || part === ".." ||
      part.toLowerCase() === ".git"
    ),
  "checkout file must be a literal relative path outside Git administration",
);

/** Resolve one checkout path only when no ancestor is a link or a non-directory. */
export async function containedCheckoutFile(
  root: string,
  path: string,
): Promise<string> {
  if (!CheckoutPathSchema.safeParse(path).success) {
    throw new ValidationInputError(
      `Invalid checkout path ${
        JSON.stringify(path)
      }: checkout file must be a literal relative path outside Git administration.`,
      path,
    );
  }
  let parent = dirname(path);
  while (parent !== ".") {
    try {
      const stat = await Deno.lstat(join(root, parent));
      if (!stat.isDirectory || stat.isSymlink) {
        throw new ValidationInputError(
          `Checkout path has a non-directory ancestor: ${path}`,
          path,
        );
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    parent = dirname(parent);
  }
  return join(root, path);
}
