/** Repository-common secret that makes validation evidence opaque. */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type { ValidationIncomplete } from "./validation.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";

export type ValidationKeyResult =
  | { key: Uint8Array }
  | { incomplete: ValidationIncomplete };

export interface ValidationKeyOptions {
  /** Resolution seam for proving that path failures remain fail-open. */
  readonly resolvePath?:
    | ((root: string) => Promise<string | undefined>)
    | undefined;
  /** Secure byte source for deterministic key-creation tests. */
  readonly entropy?: SecureEntropy;
}

type ExistingKey = ValidationKeyResult | { missing: true };

/** Whether metadata establishes the durable key's promised privacy invariant. */
function safeKeyInfo(info: Deno.FileInfo): boolean {
  return info.isFile && !info.isSymlink && info.size === 32 &&
    ((info.mode ?? 0) & 0o777) === 0o600;
}

/** Whether two observations identify the same regular filesystem object. */
function sameKeyFile(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return safeKeyInfo(left) && safeKeyInfo(right) &&
    left.dev === right.dev && left.ino === right.ino;
}

/** Read exactly one already-safe key without following an unchecked artifact. */
async function existingKey(path: string): Promise<ExistingKey> {
  let before: Deno.FileInfo;
  try {
    before = await Deno.lstat(path);
  } catch (error) {
    return error instanceof Deno.errors.NotFound
      ? { missing: true }
      : { incomplete: { category: "key", reason: "unreadable" } };
  }
  if (!safeKeyInfo(before)) {
    return { incomplete: { category: "key", reason: "invalid" } };
  }
  try {
    const file = await Deno.open(path, { read: true });
    try {
      const opened = await file.stat();
      if (!sameKeyFile(before, opened)) {
        return { incomplete: { category: "key", reason: "invalid" } };
      }
      const key = new Uint8Array(33);
      let offset = 0;
      while (offset < key.length) {
        const count = await file.read(key.subarray(offset));
        if (count === null) break;
        offset += count;
      }
      const after = await Deno.lstat(path);
      return offset === 32 && sameKeyFile(opened, after)
        ? { key: key.slice(0, 32) }
        : { incomplete: { category: "key", reason: "invalid" } };
    } finally {
      file.close();
    }
  } catch {
    return { incomplete: { category: "key", reason: "unreadable" } };
  }
}

/** Resolve, validate, or atomically mint the registered 32-byte HMAC key. */
export async function validationKey(
  root: string,
  options: ValidationKeyOptions = {},
): Promise<ValidationKeyResult> {
  try {
    const resolvePath = options.resolvePath ??
      ((candidate: string) =>
        gitAdminStatePath(candidate, "validationHmacKey"));
    const path = await resolvePath(root);
    if (path === undefined) {
      return { incomplete: { category: "key", reason: "unavailable" } };
    }
    const existing = await existingKey(path);
    if (!("missing" in existing)) return existing;

    await Deno.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const created = new Uint8Array(32);
    (options.entropy ?? SYSTEM_SECURE_ENTROPY).fillBytes(created);
    try {
      const file = await Deno.open(path, {
        createNew: true,
        write: true,
        mode: 0o600,
      });
      try {
        let offset = 0;
        while (offset < created.length) {
          offset += await file.write(created.subarray(offset));
        }
      } finally {
        file.close();
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        return { incomplete: { category: "key", reason: "unreadable" } };
      }
    }
    // Revalidate creation and createNew races through the same invariant. An
    // unsafe owner-visible artifact is never chmodded, replaced, or followed.
    const stored = await existingKey(path);
    return "missing" in stored
      ? { incomplete: { category: "key", reason: "unreadable" } }
      : stored;
  } catch {
    return { incomplete: { category: "key", reason: "unavailable" } };
  }
}
